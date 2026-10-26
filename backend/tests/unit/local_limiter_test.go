package unit

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rate-limiter/gateway/internal/ratelimiter"
)

func TestLocalTokenBucket_Allow(t *testing.T) {
	limiter := ratelimiter.NewLocalLimiter(5, 10.0) // capacity 5, 10 tokens/sec

	ctx := context.Background()
	policy := &ratelimiter.Policy{
		ID:            "test-pol",
		Algorithm:     ratelimiter.AlgoTokenBucket,
		Limit:         5,
		BurstCapacity: 5,
		RefillRate:    10.0,
		RequestCost:   1,
	}

	req := ratelimiter.Request{
		Key:    "test-key-1",
		Cost:   1,
		Policy: policy,
	}

	// Consume 5 tokens in rapid succession - should all succeed
	for i := 0; i < 5; i++ {
		dec, err := limiter.Allow(ctx, req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !dec.Allowed {
			t.Fatalf("expected request %d to be allowed", i)
		}
	}

	// 6th request must be rejected (bucket empty)
	dec, err := limiter.Allow(ctx, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dec.Allowed {
		t.Fatalf("expected request 6 to be rate limited (429)")
	}
	if dec.Remaining != 0 {
		t.Errorf("expected remaining 0, got %d", dec.Remaining)
	}

	// Wait 200ms to allow refill (2 tokens should refill at 10 tokens/sec)
	time.Sleep(250 * time.Millisecond)

	dec, err = limiter.Allow(ctx, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !dec.Allowed {
		t.Errorf("expected request after refill to be allowed")
	}
}

func TestLocalTokenBucket_ConcurrentSafety(t *testing.T) {
	limiter := ratelimiter.NewLocalLimiter(100, 0.0) // No refill during test to measure exact count

	ctx := context.Background()
	policy := &ratelimiter.Policy{
		ID:            "concurrent-pol",
		Algorithm:     ratelimiter.AlgoTokenBucket,
		Limit:         100,
		BurstCapacity: 100,
		RefillRate:    0.0,
		RequestCost:   1,
	}

	req := ratelimiter.Request{
		Key:    "concurrent-key",
		Cost:   1,
		Policy: policy,
	}

	var allowedCount int32
	var blockedCount int32
	var wg sync.WaitGroup

	numGoroutines := 200
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			dec, err := limiter.Allow(ctx, req)
			if err != nil {
				return
			}
			if dec.Allowed {
				atomic.AddInt32(&allowedCount, 1)
			} else {
				atomic.AddInt32(&blockedCount, 1)
			}
		}()
	}

	wg.Wait()

	if allowedCount != 100 {
		t.Errorf("expected exactly 100 allowed requests, got %d", allowedCount)
	}
	if blockedCount != 100 {
		t.Errorf("expected exactly 100 blocked requests, got %d", blockedCount)
	}
}
