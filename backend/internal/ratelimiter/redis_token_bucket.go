package ratelimiter

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// RedisTokenBucketLimiter implements the token-bucket algorithm using a Redis
// Lua script for atomic execution. It is the primary distributed limiter.
//
// Consistency guarantee: Atomic on a single Redis node or within a single hash slot
// in Redis Cluster. The Lua script guarantees no race condition between concurrent
// Allow() calls for the same key on the same node.
//
// Failure behavior: Controlled by the policy's FailureMode field.
type RedisTokenBucketLimiter struct {
	client      *redis.Client
	script      *redis.Script
	failureMode FailureMode
	localFallback *LocalLimiter
}

// tokenBucketScript is the Lua script loaded at startup for atomic operations.
// See backend/scripts/lua/token_bucket.lua for the full implementation.
const tokenBucketScript = `
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local cost       = tonumber(ARGV[3])
local now_ms     = tonumber(ARGV[4])
local ttl_secs   = tonumber(ARGV[5])

if not capacity or capacity <= 0 then return redis.error_reply("ERR invalid capacity") end
if not refill_rate or refill_rate <= 0 then return redis.error_reply("ERR invalid refill_rate") end
if not cost or cost < 1 then cost = 1 end
if not now_ms or now_ms <= 0 then return redis.error_reply("ERR invalid timestamp") end

local tokens_str  = redis.call("HGET", key, "tokens")
local last_ms_str = redis.call("HGET", key, "last_ms")

local tokens
local last_ms

if tokens_str == false or last_ms_str == false then
    tokens  = capacity
    last_ms = now_ms
else
    tokens  = tonumber(tokens_str)
    last_ms = tonumber(last_ms_str)
    if now_ms > last_ms then
        local elapsed_sec = (now_ms - last_ms) / 1000.0
        local refilled = tokens + (refill_rate * elapsed_sec)
        if refilled > capacity then tokens = capacity else tokens = refilled end
        last_ms = now_ms
    end
end

local allowed
local retry_after_ms

if tokens >= cost then
    tokens  = tokens - cost
    allowed = 1
    retry_after_ms = 0
else
    allowed = 0
    local deficit = cost - tokens
    retry_after_ms = math.ceil((deficit / refill_rate) * 1000)
end

redis.call("HSET", key, "tokens", tokens, "last_ms", last_ms)
redis.call("EXPIRE", key, ttl_secs)

local tokens_needed = capacity - tokens
local ms_to_full
if tokens_needed <= 0 then ms_to_full = 0 else ms_to_full = math.ceil((tokens_needed / refill_rate) * 1000) end
local reset_at_ms = last_ms + ms_to_full

return { allowed, math.floor(tokens), reset_at_ms, retry_after_ms }
`

func NewRedisTokenBucketLimiter(
	client *redis.Client,
	failureMode FailureMode,
	fallback *LocalLimiter,
) *RedisTokenBucketLimiter {
	return &RedisTokenBucketLimiter{
		client:        client,
		script:        redis.NewScript(tokenBucketScript),
		failureMode:   failureMode,
		localFallback: fallback,
	}
}

func (r *RedisTokenBucketLimiter) Allow(ctx context.Context, req Request) (*Decision, error) {
	policy := req.Policy
	if policy == nil {
		return &Decision{Allowed: true, Algorithm: string(AlgoTokenBucket)}, nil
	}

	cost := req.Cost
	if cost <= 0 {
		cost = policy.RequestCost
	}
	if cost <= 0 {
		cost = 1
	}

	nowMS := req.NowMS
	if nowMS == 0 {
		nowMS = time.Now().UnixMilli()
	}

	capacity := policy.BurstCapacity
	if capacity <= 0 {
		capacity = policy.Limit
	}

	refillRate := policy.RefillRate
	if refillRate <= 0 {
		// Default: refill at limit/window per second to handle steady state
		if policy.WindowSeconds > 0 {
			refillRate = float64(policy.Limit) / float64(policy.WindowSeconds)
		} else {
			refillRate = float64(policy.Limit) / 60.0
		}
	}

	// TTL should be at least one full window for state survival across requests
	ttlSecs := policy.WindowSeconds * 3
	if ttlSecs < 60 {
		ttlSecs = 60
	}

	result, err := r.script.Run(ctx, r.client,
		[]string{req.Key},
		capacity, refillRate, cost, nowMS, ttlSecs,
	).Slice()

	if err != nil {
		return r.handleRedisError(ctx, req, err)
	}

	return r.parseResult(result, policy, cost, capacity)
}

func (r *RedisTokenBucketLimiter) parseResult(
	result []interface{},
	policy *Policy,
	cost, capacity int,
) (*Decision, error) {
	if len(result) < 4 {
		return nil, fmt.Errorf("unexpected script result length: %d", len(result))
	}

	allowed := toInt64(result[0]) == 1
	remaining := int(toInt64(result[1]))
	resetAtMS := toInt64(result[2])
	retryAfterMS := toInt64(result[3])

	d := &Decision{
		Allowed:   allowed,
		Remaining: remaining,
		Limit:     capacity,
		ResetAt:   time.UnixMilli(resetAtMS),
		Algorithm: string(AlgoTokenBucket),
		PolicyID:  policy.ID,
	}
	if !allowed {
		d.RetryAfter = time.Duration(retryAfterMS) * time.Millisecond
		d.Reason = "token_bucket_exhausted"
	}
	return d, nil
}

func (r *RedisTokenBucketLimiter) handleRedisError(
	ctx context.Context,
	req Request,
	err error,
) (*Decision, error) {
	log.Error().Err(err).Str("key", req.Key).Msg("redis rate-limit error")

	mode := r.failureMode
	if req.Policy != nil && req.Policy.FailureMode != "" {
		mode = req.Policy.FailureMode
	}

	switch mode {
	case FailOpen:
		// Allow the request; log the infrastructure error for alerting.
		return &Decision{
			Allowed:    true,
			Algorithm:  string(AlgoTokenBucket),
			PolicyID:   req.Policy.ID,
			InfraError: err,
			Reason:     "redis_failure_open",
		}, nil

	case FailClosed:
		return &Decision{
			Allowed:    false,
			Algorithm:  string(AlgoTokenBucket),
			PolicyID:   req.Policy.ID,
			InfraError: err,
			Reason:     "redis_failure_closed",
			RetryAfter: 5 * time.Second,
		}, nil

	case FailLocalFallback:
		if r.localFallback != nil {
			d, localErr := r.localFallback.Allow(ctx, req)
			if localErr != nil {
				// Local fallback also failed; fail open as last resort.
				return &Decision{
					Allowed:    true,
					Algorithm:  string(AlgoTokenBucket),
					PolicyID:   req.Policy.ID,
					InfraError: fmt.Errorf("redis: %w; local: %v", err, localErr),
					Reason:     "local_fallback_error_open",
				}, nil
			}
			d.InfraError = err
			if d.Reason == "" {
				d.Reason = "local_fallback"
			}
			return d, nil
		}
		// No fallback configured; fail open
		return &Decision{
			Allowed:    true,
			Algorithm:  string(AlgoTokenBucket),
			PolicyID:   req.Policy.ID,
			InfraError: err,
			Reason:     "local_fallback_not_configured_open",
		}, nil

	default:
		return &Decision{
			Allowed:    true,
			InfraError: err,
			Reason:     "unknown_failure_mode_open",
		}, nil
	}
}

func (r *RedisTokenBucketLimiter) Algorithm() Algorithm {
	return AlgoTokenBucket
}

func (r *RedisTokenBucketLimiter) Reset(ctx context.Context, key string) error {
	return r.client.Del(ctx, key).Err()
}

func (r *RedisTokenBucketLimiter) Healthy(ctx context.Context) bool {
	return r.client.Ping(ctx).Err() == nil
}

func toInt64(v interface{}) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case float64:
		return int64(x)
	default:
		return 0
	}
}
