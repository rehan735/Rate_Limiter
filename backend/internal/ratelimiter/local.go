package ratelimiter

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// localTokenBucket is an in-process token bucket for the first stage of the
// two-stage rate-limiting pipeline. It is NOT a substitute for global distributed
// limiting; it is an optimization to shed obvious excess load without a Redis call.
//
// Trade-off: The local bucket does not share state across gateway instances.
// Two instances can each allow up to `capacity` requests per refill interval
// before the global limiter catches excess. This is intentional and documented.
// The effective global burst is (instances × local_burst) in the worst case.
type localTokenBucket struct {
	mu          sync.Mutex
	tokens      float64
	capacity    float64
	refillRate  float64 // tokens per second
	lastRefill  time.Time
}

func newLocalTokenBucket(capacity int, refillRate float64) *localTokenBucket {
	return &localTokenBucket{
		tokens:     float64(capacity),
		capacity:   float64(capacity),
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
}

// Allow checks if n tokens are available and consumes them atomically.
// Returns remaining tokens after consumption, or -1 if rejected.
func (b *localTokenBucket) Allow(cost int) (remaining float64, ok bool) {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed > 0 {
		b.tokens = min64(b.capacity, b.tokens+b.refillRate*elapsed)
		b.lastRefill = now
	}

	fc := float64(cost)
	if b.tokens >= fc {
		b.tokens -= fc
		return b.tokens, true
	}
	return b.tokens, false
}

func min64(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// LocalBucketStore manages per-key local buckets with LRU-style cleanup.
// It uses a simple map protected by a mutex. For high-cardinality deployments,
// replace with a proper LRU cache bounded by max entries.
type LocalBucketStore struct {
	mu       sync.Mutex
	buckets  map[string]*localTokenBucket
	capacity int
	rate     float64
	maxKeys  int
}

func NewLocalBucketStore(capacity int, refillRate float64, maxKeys int) *LocalBucketStore {
	if maxKeys <= 0 {
		maxKeys = 10000
	}
	return &LocalBucketStore{
		buckets:  make(map[string]*localTokenBucket, maxKeys),
		capacity: capacity,
		rate:     refillRate,
		maxKeys:  maxKeys,
	}
}

// Allow checks the local bucket for key and returns whether the request is permitted.
// If capacity or rate are > 0, they override the store defaults for new buckets.
func (s *LocalBucketStore) Allow(key string, cost int, capacity int, rate float64) (bool, float64) {
	s.mu.Lock()
	bucket, ok := s.buckets[key]
	if !ok {
		if len(s.buckets) >= s.maxKeys {
			// Simple eviction: remove one arbitrary entry
			for k := range s.buckets {
				delete(s.buckets, k)
				break
			}
		}
		cap := s.capacity
		if capacity > 0 {
			cap = capacity
		}
		r := s.rate
		if rate > 0 {
			r = rate
		}
		bucket = newLocalTokenBucket(cap, r)
		s.buckets[key] = bucket
	}
	s.mu.Unlock()

	remaining, allowed := bucket.Allow(cost)
	return allowed, remaining
}

// LocalLimiter implements Limiter using only in-process token buckets.
// Used for benchmarking and as the local stage of the two-stage pipeline.
type LocalLimiter struct {
	store *LocalBucketStore
}

func NewLocalLimiter(capacity int, refillRate float64) *LocalLimiter {
	return &LocalLimiter{
		store: NewLocalBucketStore(capacity, refillRate, 50000),
	}
}

func (l *LocalLimiter) Allow(ctx context.Context, req Request) (*Decision, error) {
	cost := req.Cost
	if cost <= 0 {
		cost = 1
	}

	capacity := l.store.capacity
	rate := l.store.rate
	limit := capacity

	if req.Policy != nil {
		if req.Policy.BurstCapacity > 0 {
			capacity = req.Policy.BurstCapacity
		} else if req.Policy.Limit > 0 {
			capacity = req.Policy.Limit
		}
		limit = capacity

		if req.Policy.RefillRate > 0 {
			rate = req.Policy.RefillRate
		} else if req.Policy.WindowSeconds > 0 {
			rate = float64(req.Policy.Limit) / float64(req.Policy.WindowSeconds)
		}
	}

	allowed, remaining := l.store.Allow(req.Key, cost, capacity, rate)

	d := &Decision{
		Allowed:   allowed,
		Remaining: int(remaining),
		Limit:     limit,
		Algorithm: string(AlgoTokenBucket),
	}
	if req.Policy != nil {
		d.PolicyID = req.Policy.ID
	}

	if !allowed {
		d.Reason = "local_quota_exceeded"
		d.RetryAfter = time.Second
	}

	return d, nil
}

func (l *LocalLimiter) Algorithm() Algorithm {
	return AlgoTokenBucket
}

func (l *LocalLimiter) Reset(ctx context.Context, key string) error {
	l.store.mu.Lock()
	delete(l.store.buckets, key)
	l.store.mu.Unlock()
	return nil
}

// TwoStageLimiter implements the primary high-performance architecture:
// local token bucket → global distributed limiter.
//
// Stage 1 (local): Rejects obvious excess without a Redis call.
// Stage 2 (global): Coordinates quotas across gateway instances.
//
// Note: The global limit is the authoritative limit. The local stage is
// an optimization only and does NOT enforce an additional independent quota.
// Configure local capacity as a fraction of the global limit per instance.
type TwoStageLimiter struct {
	local          *LocalLimiter
	global         Limiter
	localEnabled   bool
}

func NewTwoStageLimiter(local *LocalLimiter, global Limiter, localEnabled bool) *TwoStageLimiter {
	return &TwoStageLimiter{
		local:        local,
		global:       global,
		localEnabled: localEnabled,
	}
}

func (t *TwoStageLimiter) Allow(ctx context.Context, req Request) (*Decision, error) {
	if t.localEnabled && t.local != nil {
		localDecision, err := t.local.Allow(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("local limiter: %w", err)
		}
		if !localDecision.Allowed {
			localDecision.Reason = "local_quota_exceeded"
			return localDecision, nil
		}
	}

	return t.global.Allow(ctx, req)
}

func (t *TwoStageLimiter) Algorithm() Algorithm {
	return t.global.Algorithm()
}

func (t *TwoStageLimiter) Reset(ctx context.Context, key string) error {
	if t.local != nil {
		_ = t.local.Reset(ctx, key)
	}
	return t.global.Reset(ctx, key)
}
