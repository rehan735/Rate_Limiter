package ratelimiter

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// ============================================================
// Fixed Window Limiter
// ============================================================

// RedisFixedWindowLimiter implements a fixed-window counter using an atomic Redis Lua script.
type RedisFixedWindowLimiter struct {
	client        *redis.Client
	script        *redis.Script
	failureMode   FailureMode
	localFallback *LocalLimiter
}

const fixedWindowScript = `
local limit        = tonumber(ARGV[1])
local cost         = tonumber(ARGV[2])
local window_secs  = tonumber(ARGV[3])
local now_secs     = tonumber(ARGV[4])
if not limit or limit <= 0 then return redis.error_reply("ERR invalid limit") end
if not cost or cost < 1 then cost = 1 end
if not window_secs or window_secs <= 0 then return redis.error_reply("ERR invalid window") end
local window_start = math.floor(now_secs / window_secs) * window_secs
local reset_at     = window_start + window_secs
local ttl          = math.max(1, reset_at - now_secs)
local key          = KEYS[1]
local current      = tonumber(redis.call("GET", key) or "0")
local allowed
local retry_after_ms
local new_count
if (current + cost) <= limit then
    new_count = redis.call("INCRBY", key, cost)
    redis.call("EXPIRE", key, ttl + 1)
    allowed = 1
    retry_after_ms = 0
else
    new_count = current
    allowed = 0
    retry_after_ms = (reset_at - now_secs) * 1000
end
local remaining = math.max(0, limit - new_count)
return { allowed, new_count, remaining, reset_at, retry_after_ms }
`

func NewRedisFixedWindowLimiter(client *redis.Client, failureMode FailureMode, fallback *LocalLimiter) *RedisFixedWindowLimiter {
	return &RedisFixedWindowLimiter{
		client:        client,
		script:        redis.NewScript(fixedWindowScript),
		failureMode:   failureMode,
		localFallback: fallback,
	}
}

func (r *RedisFixedWindowLimiter) Allow(ctx context.Context, req Request) (*Decision, error) {
	policy := req.Policy
	if policy == nil {
		return &Decision{Allowed: true, Algorithm: string(AlgoFixedWindow)}, nil
	}
	cost := req.Cost
	if cost <= 0 {
		cost = policy.RequestCost
	}
	if cost <= 0 {
		cost = 1
	}
	nowSecs := time.Now().Unix()
	windowStart := (nowSecs / int64(policy.WindowSeconds)) * int64(policy.WindowSeconds)
	key := fmt.Sprintf("{%s}:%d", req.Key, windowStart)

	result, err := r.script.Run(ctx, r.client,
		[]string{key},
		policy.Limit, cost, policy.WindowSeconds, nowSecs,
	).Slice()
	if err != nil {
		return r.handleError(ctx, req, err, policy)
	}
	if len(result) < 5 {
		return nil, fmt.Errorf("fixed_window: unexpected result length %d", len(result))
	}

	allowed := toInt64(result[0]) == 1
	remaining := int(toInt64(result[2]))
	resetAtSecs := toInt64(result[3])
	retryAfterMS := toInt64(result[4])

	d := &Decision{
		Allowed:   allowed,
		Remaining: remaining,
		Limit:     policy.Limit,
		ResetAt:   time.Unix(resetAtSecs, 0),
		Algorithm: string(AlgoFixedWindow),
		PolicyID:  policy.ID,
	}
	if !allowed {
		d.RetryAfter = time.Duration(retryAfterMS) * time.Millisecond
		d.Reason = "fixed_window_limit_reached"
	}
	return d, nil
}

func (r *RedisFixedWindowLimiter) handleError(ctx context.Context, req Request, err error, policy *Policy) (*Decision, error) {
	mode := r.failureMode
	if policy != nil && policy.FailureMode != "" {
		mode = policy.FailureMode
	}
	switch mode {
	case FailOpen:
		return &Decision{Allowed: true, Algorithm: string(AlgoFixedWindow), PolicyID: policy.ID, InfraError: err, Reason: "redis_failure_open"}, nil
	case FailClosed:
		return &Decision{Allowed: false, Algorithm: string(AlgoFixedWindow), PolicyID: policy.ID, InfraError: err, Reason: "redis_failure_closed", RetryAfter: 5 * time.Second}, nil
	case FailLocalFallback:
		if r.localFallback != nil {
			d, localErr := r.localFallback.Allow(ctx, req)
			if localErr == nil {
				d.InfraError = err
				d.Reason = "local_fallback"
				return d, nil
			}
		}
		return &Decision{Allowed: true, Algorithm: string(AlgoFixedWindow), PolicyID: policy.ID, InfraError: err, Reason: "local_fallback_error_open"}, nil
	default:
		return &Decision{Allowed: true, Algorithm: string(AlgoFixedWindow), PolicyID: policy.ID, InfraError: err}, nil
	}
}

func (r *RedisFixedWindowLimiter) Algorithm() Algorithm { return AlgoFixedWindow }

func (r *RedisFixedWindowLimiter) Reset(ctx context.Context, key string) error {
	keys, err := r.client.Keys(ctx, fmt.Sprintf("{%s}:*", key)).Result()
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	return r.client.Del(ctx, keys...).Err()
}

// ============================================================
// Sliding Window Counter
// ============================================================

// RedisSlidingWindowLimiter implements an approximate sliding-window counter.
type RedisSlidingWindowLimiter struct {
	client        *redis.Client
	script        *redis.Script
	failureMode   FailureMode
	localFallback *LocalLimiter
}

const slidingWindowScript = `
local limit       = tonumber(ARGV[1])
local cost        = tonumber(ARGV[2])
local window_secs = tonumber(ARGV[3])
local now_secs    = tonumber(ARGV[4])
if not limit or limit <= 0 then return redis.error_reply("ERR invalid limit") end
if not cost or cost < 1 then cost = 1 end
if not window_secs or window_secs <= 0 then return redis.error_reply("ERR invalid window") end
local window_start = math.floor(now_secs / window_secs) * window_secs
local elapsed      = now_secs - window_start
local reset_at     = window_start + window_secs
local prev_weight  = 1.0 - (elapsed / window_secs)
local curr_key = KEYS[1]
local prev_key = KEYS[2]
local curr_count = tonumber(redis.call("GET", curr_key) or "0")
local prev_count = tonumber(redis.call("GET", prev_key) or "0")
local estimated  = math.floor(prev_count * prev_weight + curr_count)
local allowed
local retry_after_ms
if (estimated + cost) <= limit then
    redis.call("INCRBY", curr_key, cost)
    redis.call("EXPIRE", curr_key, window_secs * 2 + 1)
    allowed = 1
    retry_after_ms = 0
else
    allowed = 0
    local target = limit - cost - curr_count
    if prev_count > 0 and target >= 0 then
        local t = window_secs * (1.0 - target / prev_count)
        retry_after_ms = math.max(0, math.ceil((t - elapsed) * 1000))
    else
        retry_after_ms = (reset_at - now_secs) * 1000
    end
end
local remaining = math.max(0, limit - estimated)
return { allowed, estimated, remaining, reset_at, retry_after_ms }
`

func NewRedisSlidingWindowLimiter(client *redis.Client, failureMode FailureMode, fallback *LocalLimiter) *RedisSlidingWindowLimiter {
	return &RedisSlidingWindowLimiter{
		client:        client,
		script:        redis.NewScript(slidingWindowScript),
		failureMode:   failureMode,
		localFallback: fallback,
	}
}

func (r *RedisSlidingWindowLimiter) Allow(ctx context.Context, req Request) (*Decision, error) {
	policy := req.Policy
	if policy == nil {
		return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindow)}, nil
	}
	cost := req.Cost
	if cost <= 0 {
		cost = policy.RequestCost
	}
	if cost <= 0 {
		cost = 1
	}
	nowSecs := time.Now().Unix()
	windowStart := (nowSecs / int64(policy.WindowSeconds)) * int64(policy.WindowSeconds)
	prevStart := windowStart - int64(policy.WindowSeconds)

	// Hash-tagged keys for Redis Cluster slot compatibility
	currKey := fmt.Sprintf("{%s}:curr:%d", req.Key, windowStart)
	prevKey := fmt.Sprintf("{%s}:curr:%d", req.Key, prevStart)

	result, err := r.script.Run(ctx, r.client,
		[]string{currKey, prevKey},
		policy.Limit, cost, policy.WindowSeconds, nowSecs,
	).Slice()
	if err != nil {
		mode := r.failureMode
		if policy.FailureMode != "" {
			mode = policy.FailureMode
		}
		switch mode {
		case FailOpen:
			return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindow), PolicyID: policy.ID, InfraError: err, Reason: "redis_failure_open"}, nil
		case FailClosed:
			return &Decision{Allowed: false, Algorithm: string(AlgoSlidingWindow), PolicyID: policy.ID, InfraError: err, Reason: "redis_failure_closed"}, nil
		case FailLocalFallback:
			if r.localFallback != nil {
				d, localErr := r.localFallback.Allow(ctx, req)
				if localErr == nil {
					d.InfraError = err
					d.Reason = "local_fallback"
					return d, nil
				}
			}
			return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindow), PolicyID: policy.ID, InfraError: err, Reason: "local_fallback_error_open"}, nil
		default:
			return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindow), PolicyID: policy.ID, InfraError: err}, nil
		}
	}
	if len(result) < 5 {
		return nil, fmt.Errorf("sliding_window: unexpected result length %d", len(result))
	}

	allowed := toInt64(result[0]) == 1
	remaining := int(toInt64(result[2]))
	resetAtSecs := toInt64(result[3])
	retryAfterMS := toInt64(result[4])

	d := &Decision{
		Allowed:   allowed,
		Remaining: remaining,
		Limit:     policy.Limit,
		ResetAt:   time.Unix(resetAtSecs, 0),
		Algorithm: string(AlgoSlidingWindow),
		PolicyID:  policy.ID,
	}
	if !allowed {
		d.RetryAfter = time.Duration(retryAfterMS) * time.Millisecond
		d.Reason = "sliding_window_limit_reached"
	}
	return d, nil
}

func (r *RedisSlidingWindowLimiter) Algorithm() Algorithm { return AlgoSlidingWindow }

func (r *RedisSlidingWindowLimiter) Reset(ctx context.Context, key string) error {
	keys, err := r.client.Keys(ctx, fmt.Sprintf("{%s}:curr:*", key)).Result()
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}
	return r.client.Del(ctx, keys...).Err()
}

// ============================================================
// Sliding Window Log (Exact Millisecond Precision)
// ============================================================

// RedisSlidingWindowLogLimiter implements exact sliding window using Redis Sorted Sets.
type RedisSlidingWindowLogLimiter struct {
	client        *redis.Client
	script        *redis.Script
	failureMode   FailureMode
	localFallback *LocalLimiter
}

const slidingWindowLogScript = `
local key       = KEYS[1]
local limit     = tonumber(ARGV[1])
local cost      = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])
local now_ms    = tonumber(ARGV[4])
local req_id    = ARGV[5]

if not limit or limit <= 0 then return redis.error_reply("ERR invalid limit") end
if not cost or cost < 1 then cost = 1 end
if not window_ms or window_ms <= 0 then return redis.error_reply("ERR invalid window") end

-- Purge elements older than the current rolling window
local clear_before = now_ms - window_ms
redis.call("ZREMRANGEBYSCORE", key, 0, clear_before)

local current = tonumber(redis.call("ZCARD", key) or 0)
local allowed = 0
local retry_after_ms = 0
local reset_at_ms = now_ms + window_ms

if (current + cost) <= limit then
    for i = 1, cost do
        redis.call("ZADD", key, now_ms, req_id .. ":" .. i)
    end
    redis.call("PEXPIRE", key, window_ms * 2)
    allowed = 1
    retry_after_ms = 0
else
    allowed = 0
    -- Query the oldest active timestamp in the current window
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    if #oldest >= 2 then
        local oldest_ts = tonumber(oldest[2])
        retry_after_ms = math.max(0, math.ceil((oldest_ts + window_ms) - now_ms))
        reset_at_ms = oldest_ts + window_ms
    else
        retry_after_ms = window_ms
    end
end

local remaining = math.max(0, limit - current - (allowed * cost))
return { allowed, remaining, reset_at_ms, retry_after_ms }
`

func NewRedisSlidingWindowLogLimiter(client *redis.Client, failureMode FailureMode, fallback *LocalLimiter) *RedisSlidingWindowLogLimiter {
	return &RedisSlidingWindowLogLimiter{
		client:        client,
		script:        redis.NewScript(slidingWindowLogScript),
		failureMode:   failureMode,
		localFallback: fallback,
	}
}

func (r *RedisSlidingWindowLogLimiter) Allow(ctx context.Context, req Request) (*Decision, error) {
	policy := req.Policy
	if policy == nil {
		return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindowLog)}, nil
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
	windowMS := int64(policy.WindowSeconds) * 1000
	reqID := uuid.New().String()

	result, err := r.script.Run(ctx, r.client,
		[]string{req.Key},
		policy.Limit, cost, windowMS, nowMS, reqID,
	).Slice()
	if err != nil {
		mode := r.failureMode
		if policy.FailureMode != "" {
			mode = policy.FailureMode
		}
		switch mode {
		case FailOpen:
			return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindowLog), PolicyID: policy.ID, InfraError: err, Reason: "redis_failure_open"}, nil
		case FailClosed:
			return &Decision{Allowed: false, Algorithm: string(AlgoSlidingWindowLog), PolicyID: policy.ID, InfraError: err, Reason: "redis_failure_closed"}, nil
		case FailLocalFallback:
			if r.localFallback != nil {
				d, localErr := r.localFallback.Allow(ctx, req)
				if localErr == nil {
					d.InfraError = err
					d.Reason = "local_fallback"
					return d, nil
				}
			}
			return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindowLog), PolicyID: policy.ID, InfraError: err, Reason: "local_fallback_error_open"}, nil
		default:
			return &Decision{Allowed: true, Algorithm: string(AlgoSlidingWindowLog), PolicyID: policy.ID, InfraError: err}, nil
		}
	}

	if len(result) < 4 {
		return nil, fmt.Errorf("sliding_window_log: unexpected result length %d", len(result))
	}

	allowed := toInt64(result[0]) == 1
	remaining := int(toInt64(result[1]))
	resetAtMS := toInt64(result[2])
	retryAfterMS := toInt64(result[3])

	d := &Decision{
		Allowed:   allowed,
		Remaining: remaining,
		Limit:     policy.Limit,
		ResetAt:   time.UnixMilli(resetAtMS),
		Algorithm: string(AlgoSlidingWindowLog),
		PolicyID:  policy.ID,
	}
	if !allowed {
		d.RetryAfter = time.Duration(retryAfterMS) * time.Millisecond
		d.Reason = "sliding_window_log_limit_reached"
	}
	return d, nil
}

func (r *RedisSlidingWindowLogLimiter) Algorithm() Algorithm { return AlgoSlidingWindowLog }

func (r *RedisSlidingWindowLogLimiter) Reset(ctx context.Context, key string) error {
	return r.client.Del(ctx, key).Err()
}
