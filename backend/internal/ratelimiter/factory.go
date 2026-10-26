package ratelimiter

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Factory creates Limiter instances for the configured algorithm.
// It holds one instance of each algorithm type to avoid repeated script loading.
type Factory struct {
	tokenBucket      *RedisTokenBucketLimiter
	fixedWindow      *RedisFixedWindowLimiter
	slidingWindow    *RedisSlidingWindowLimiter
	slidingWindowLog *RedisSlidingWindowLogLimiter
	localLimiter     *LocalLimiter
	defaultFailure   FailureMode
}

func NewFactory(client *redis.Client, failureMode FailureMode) *Factory {
	local := NewLocalLimiter(1000, 100)
	return &Factory{
		tokenBucket:      NewRedisTokenBucketLimiter(client, failureMode, local),
		fixedWindow:      NewRedisFixedWindowLimiter(client, failureMode, local),
		slidingWindow:    NewRedisSlidingWindowLimiter(client, failureMode, local),
		slidingWindowLog: NewRedisSlidingWindowLogLimiter(client, failureMode, local),
		localLimiter:     local,
		defaultFailure:   failureMode,
	}
}

// ForAlgorithm returns the Limiter for the given algorithm.
func (f *Factory) ForAlgorithm(algo Algorithm) (Limiter, error) {
	switch algo {
	case AlgoTokenBucket:
		return f.tokenBucket, nil
	case AlgoFixedWindow:
		return f.fixedWindow, nil
	case AlgoSlidingWindow:
		return f.slidingWindow, nil
	case AlgoSlidingWindowLog:
		return f.slidingWindowLog, nil
	default:
		return nil, fmt.Errorf("unknown algorithm: %s", algo)
	}
}

// LocalLimiter returns the shared local limiter (first stage).
func (f *Factory) LocalLimiter() *LocalLimiter {
	return f.localLimiter
}

// ForPolicy returns a Limiter configured for the given policy's algorithm.
func (f *Factory) ForPolicy(policy *Policy) (Limiter, error) {
	return f.ForAlgorithm(policy.Algorithm)
}

// BuildTwoStage constructs a two-stage limiter for a given policy.
func (f *Factory) BuildTwoStage(policy *Policy, localEnabled bool) (*TwoStageLimiter, error) {
	global, err := f.ForPolicy(policy)
	if err != nil {
		return nil, err
	}
	return NewTwoStageLimiter(f.localLimiter, global, localEnabled), nil
}

// MultiDimLimiter evaluates multiple policy checks for a single request.
type MultiDimLimiterImpl struct {
	factory *Factory
}

func NewMultiDimLimiter(factory *Factory) *MultiDimLimiterImpl {
	return &MultiDimLimiterImpl{factory: factory}
}

func (m *MultiDimLimiterImpl) Allow(ctx context.Context, req MultiRequest) (*MultiDecision, error) {
	decisions := make([]*Decision, 0, len(req.Checks))

	for i, check := range req.Checks {
		limiter, err := m.factory.ForPolicy(check.Policy)
		if err != nil {
			return nil, fmt.Errorf("multi-dim limiter: check %d: %w", i, err)
		}

		d, err := limiter.Allow(ctx, Request{
			Key:    check.Key,
			Cost:   check.Cost,
			Policy: check.Policy,
		})
		if err != nil {
			return nil, fmt.Errorf("multi-dim limiter: check %d allow: %w", i, err)
		}

		decisions = append(decisions, d)

		if !d.Allowed {
			return &MultiDecision{
				Allowed:      false,
				Decisions:    decisions,
				FailedPolicy: check.Policy,
			}, nil
		}
	}

	return &MultiDecision{
		Allowed:   true,
		Decisions: decisions,
	}, nil
}
