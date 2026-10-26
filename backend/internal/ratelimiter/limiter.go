// Package ratelimiter defines the core interfaces and types for the rate-limiting engine.
// It supports pluggable algorithms behind a common interface, enabling the data plane
// to swap implementations without changing callsites.
package ratelimiter

import (
	"context"
	"time"
)

// Decision is the result of a rate-limit check.
type Decision struct {
	// Allowed indicates whether the request should be forwarded.
	Allowed bool

	// Remaining is the number of requests/tokens remaining in the current window.
	Remaining int

	// Limit is the maximum configured for this policy.
	Limit int

	// ResetAt is when the rate-limit counter/bucket will reset.
	ResetAt time.Time

	// RetryAfter is the suggested wait duration when Allowed is false.
	// Zero means no suggestion (e.g., fail-open scenario).
	RetryAfter time.Duration

	// Algorithm identifies which algorithm produced this decision.
	Algorithm string

	// PolicyID is the policy that was evaluated.
	PolicyID string

	// Reason provides a machine-readable rejection reason.
	Reason string

	// InfraError is non-nil when the decision was influenced by infrastructure
	// failure (e.g., Redis unavailable). The caller should distinguish this from
	// a genuine quota exhaustion.
	InfraError error
}

// Request contains per-request context needed to evaluate rate-limit policies.
type Request struct {
	// Key is the unique rate-limit key (e.g., "rl:tb:{tenant_abc}:GET:/v1/users").
	Key string

	// Cost is the number of tokens this request consumes. Defaults to 1.
	Cost int

	// Policy is the resolved policy for this request.
	Policy *Policy

	// NowMS is the current Unix timestamp in milliseconds. If zero, the limiter
	// uses time.Now(). Providing it explicitly enables testing.
	NowMS int64
}

// Policy is the resolved, in-memory representation of a rate-limit policy.
// It is loaded from PostgreSQL and cached; Redis stores ephemeral counters only.
type Policy struct {
	ID            string
	Name          string
	Algorithm     Algorithm
	Limit         int
	WindowSeconds int
	BurstCapacity int
	RefillRate    float64
	RequestCost   int
	KeyPattern    string
	FailureMode   FailureMode
	Dimensions    []string
}

type Algorithm string

const (
	AlgoTokenBucket      Algorithm = "token_bucket"
	AlgoFixedWindow      Algorithm = "fixed_window"
	AlgoSlidingWindow    Algorithm = "sliding_window"
	AlgoSlidingWindowLog Algorithm = "sliding_window_log"
)

type FailureMode string

const (
	FailOpen          FailureMode = "fail_open"
	FailClosed        FailureMode = "fail_closed"
	FailLocalFallback FailureMode = "local_fallback"
)

// Limiter is the primary interface for all rate-limit algorithms.
type Limiter interface {
	// Allow evaluates whether the request should be permitted.
	Allow(ctx context.Context, req Request) (*Decision, error)

	// Algorithm returns the identifier of the implemented algorithm.
	Algorithm() Algorithm

	// Reset clears the rate-limit state for the given key.
	// Used for administrative overrides and testing.
	Reset(ctx context.Context, key string) error
}

// MultiDimensionalLimiter evaluates a request against multiple policies simultaneously.
// It uses a reservation/refund strategy: tokens are not consumed if a later
// mandatory policy would reject the request. This is documented and tested.
type MultiDimensionalLimiter interface {
	// Allow checks all applicable policies for a request and returns the most
	// restrictive decision. Policies are evaluated in priority order.
	Allow(ctx context.Context, req MultiRequest) (*MultiDecision, error)
}

// MultiRequest contains all policy checks to evaluate for a single HTTP request.
type MultiRequest struct {
	Checks []PolicyCheck
}

// PolicyCheck is one dimension of a multi-dimensional rate-limit evaluation.
type PolicyCheck struct {
	Key    string
	Cost   int
	Policy *Policy
}

// MultiDecision aggregates results from multiple policy checks.
type MultiDecision struct {
	// Allowed is false if ANY mandatory check failed.
	Allowed bool

	// Decisions is the individual result per policy check, in evaluation order.
	Decisions []*Decision

	// FailedPolicy is the first policy that rejected the request (nil if allowed).
	FailedPolicy *Policy
}

// HealthChecker is implemented by limiters that can report their backing store health.
type HealthChecker interface {
	Healthy(ctx context.Context) bool
}
