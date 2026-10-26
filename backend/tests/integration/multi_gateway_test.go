package integration

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/rate-limiter/gateway/internal/auth"
	"github.com/rate-limiter/gateway/internal/config"
	"github.com/rate-limiter/gateway/internal/gateway"
	"github.com/rate-limiter/gateway/internal/models"
	"github.com/rate-limiter/gateway/internal/ratelimiter"
)

func getTestRedis(t *testing.T) *redis.Client {
	rdb := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not reachable at localhost:6379 (%v) - skipping integration tests", err)
	}
	return rdb
}

func setupTestUpstream() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"success","service":"orders-backend"}`))
	}))
}

func createTestGateway(
	t *testing.T,
	rdb *redis.Client,
	failMode ratelimiter.FailureMode,
	routes []*gateway.RouteConfig,
) (*httptest.Server, *gateway.Server) {
	cfg := &config.Config{
		Gateway: config.GatewayConfig{
			MaxRequestSize: 1048576,
			TrustedProxies: []string{"127.0.0.1", "::1"},
		},
		Redis: config.RedisConfig{
			FailurePolicy: string(failMode),
		},
	}
	authSvc, err := auth.NewService(config.JWTConfig{
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 7 * 24 * time.Hour,
		Issuer:          "rateshield-test",
		AllowEphemeral:  true,
	})
	require.NoError(t, err)

	limiterFactory := ratelimiter.NewFactory(rdb, failMode)
	gw := gateway.NewServer(cfg, authSvc, limiterFactory, nil, nil, nil)
	gw.SetRoutesManually(routes)

	ts := httptest.NewServer(gw.BuildHTTPHandler())
	return ts, gw
}

// TestMultiGatewayConcurrentDistributedRateLimiting verifies that multiple
// gateway instances connected to the same Redis instance strictly enforce the rate
// limit collectively across concurrent requests from the same client identity.
func TestMultiGatewayConcurrentDistributedRateLimiting(t *testing.T) {
	rdb := getTestRedis(t)
	defer rdb.Close()

	upstream := setupTestUpstream()
	defer upstream.Close()

	algorithms := []struct {
		name      string
		algorithm ratelimiter.Algorithm
	}{
		{"TokenBucket", ratelimiter.AlgoTokenBucket},
		{"FixedWindow", ratelimiter.AlgoFixedWindow},
		{"SlidingWindow", ratelimiter.AlgoSlidingWindow},
		{"SlidingWindowLog", ratelimiter.AlgoSlidingWindowLog},
	}

	for _, tc := range algorithms {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			policyID := uuid.New()
			backendID := uuid.New()
			limit := 25
			windowSecs := 60

			backendCfg := &gateway.BackendConfig{
				BackendService: models.BackendService{
					ID:      backendID,
					Name:    "orders-service",
					Targets: []string{upstream.URL},
				},
			}

			rlPolicy := &ratelimiter.Policy{
				ID:            policyID.String(),
				Name:          fmt.Sprintf("multi-gw-test-%s", tc.name),
				Algorithm:     tc.algorithm,
				Limit:         limit,
				WindowSeconds: windowSecs,
				BurstCapacity: limit,
				RequestCost:   1,
				Dimensions:    []string{"tenant"},
				FailureMode:   ratelimiter.FailClosed,
			}

			routes := []*gateway.RouteConfig{
				{
					Route: models.Route{
						ID:           uuid.New(),
						Name:         "orders-route",
						PathPrefix:   "/api/orders",
						BackendID:    backendID,
						PolicyID:     &policyID,
						RequiresAuth: false,
						IsActive:     true,
					},
					Backend: backendCfg,
					Policy:  rlPolicy,
				},
			}

			// Clean up any stale keys in Redis
			ctx := context.Background()
			iter := rdb.Scan(ctx, 0, fmt.Sprintf("*%s*", policyID.String()), 0).Iterator()
			for iter.Next(ctx) {
				_ = rdb.Del(ctx, iter.Val())
			}

			// Spin up Gateway 1 and Gateway 2 connected to the same Redis deployment
			gwA, _ := createTestGateway(t, rdb, ratelimiter.FailClosed, routes)
			defer gwA.Close()

			gwB, _ := createTestGateway(t, rdb, ratelimiter.FailClosed, routes)
			defer gwB.Close()

			// Concurrently send 100 requests split evenly between Gateway A and Gateway B
			totalRequests := 100
			tenantID := fmt.Sprintf("tenant-%s-%d", tc.name, time.Now().UnixNano())

			var acceptedCount int64
			var rejectedCount int64
			var otherCount int64

			var wg sync.WaitGroup
			wg.Add(totalRequests)

			client := &http.Client{Timeout: 5 * time.Second}

			for i := 0; i < totalRequests; i++ {
				targetURL := gwA.URL + "/api/orders"
				if i%2 == 1 {
					targetURL = gwB.URL + "/api/orders"
				}

				go func(url string) {
					defer wg.Done()
					req, err := http.NewRequest("GET", url, nil)
					if err != nil {
						atomic.AddInt64(&otherCount, 1)
						return
					}
					req.Header.Set("X-Tenant-ID", tenantID)

					resp, err := client.Do(req)
					if err != nil {
						atomic.AddInt64(&otherCount, 1)
						return
					}
					defer resp.Body.Close()

					if resp.StatusCode == http.StatusOK {
						atomic.AddInt64(&acceptedCount, 1)
						assert.NotEmpty(t, resp.Header.Get("X-RateLimit-Limit"))
					} else if resp.StatusCode == http.StatusTooManyRequests {
						atomic.AddInt64(&rejectedCount, 1)
						assert.Equal(t, fmt.Sprintf("%d", limit), resp.Header.Get("X-RateLimit-Limit"))
						assert.NotEmpty(t, resp.Header.Get("X-RateLimit-Reset"))
					} else {
						atomic.AddInt64(&otherCount, 1)
					}
				}(targetURL)
			}

			wg.Wait()

			t.Logf("[%s] Total Requests: %d | Accepted: %d | Rejected: %d | Other: %d",
				tc.name, totalRequests, acceptedCount, rejectedCount, otherCount)

			assert.Equal(t, int64(0), otherCount, "No unexpected error statuses")
			assert.Equal(t, int64(limit), acceptedCount,
				"Distributed quota must be strictly enforced across both gateway instances")
			assert.Equal(t, int64(totalRequests-limit), rejectedCount,
				"Excess concurrent requests must be rejected with HTTP 429")
		})
	}
}

// TestRedisFailureModes verifies the behavior of the rate limiter during
// Redis failure (Fail-Open vs Fail-Closed vs Local-Fallback).
func TestRedisFailureModes(t *testing.T) {
	upstream := setupTestUpstream()
	defer upstream.Close()

	// Dead redis client on an unassigned port
	deadRdb := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:54321",
		DialTimeout: 50 * time.Millisecond,
		ReadTimeout: 50 * time.Millisecond,
	})
	defer deadRdb.Close()

	t.Run("FailOpen", func(t *testing.T) {
		policyID := uuid.New()
		backendID := uuid.New()

		backendCfg := &gateway.BackendConfig{
			BackendService: models.BackendService{
				ID:      backendID,
				Name:    "orders-service",
				Targets: []string{upstream.URL},
			},
		}

		rlPolicy := &ratelimiter.Policy{
			ID:            policyID.String(),
			Name:          "fail-open-policy",
			Algorithm:     ratelimiter.AlgoTokenBucket,
			Limit:         5,
			WindowSeconds: 60,
			BurstCapacity: 5,
			Dimensions:    []string{"tenant"},
			FailureMode:   ratelimiter.FailOpen,
		}

		routes := []*gateway.RouteConfig{
			{
				Route: models.Route{
					ID:           uuid.New(),
					Name:         "fail-open-route",
					PathPrefix:   "/api/orders",
					BackendID:    backendID,
					PolicyID:     &policyID,
					RequiresAuth: false,
					IsActive:     true,
				},
				Backend: backendCfg,
				Policy:  rlPolicy,
			},
		}

		gw, _ := createTestGateway(t, deadRdb, ratelimiter.FailOpen, routes)
		defer gw.Close()

		client := &http.Client{Timeout: 2 * time.Second}
		req, _ := http.NewRequest("GET", gw.URL+"/api/orders", nil)
		req.Header.Set("X-Tenant-ID", "tenant-failopen")

		// With fail-open, request must succeed (200 OK) even though Redis is completely down
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusOK, resp.StatusCode, "Fail-open policy must allow traffic during Redis failure")
	})

	t.Run("FailClosed", func(t *testing.T) {
		policyID := uuid.New()
		backendID := uuid.New()

		backendCfg := &gateway.BackendConfig{
			BackendService: models.BackendService{
				ID:      backendID,
				Name:    "orders-service",
				Targets: []string{upstream.URL},
			},
		}

		rlPolicy := &ratelimiter.Policy{
			ID:            policyID.String(),
			Name:          "fail-closed-policy",
			Algorithm:     ratelimiter.AlgoTokenBucket,
			Limit:         5,
			WindowSeconds: 60,
			BurstCapacity: 5,
			Dimensions:    []string{"tenant"},
			FailureMode:   ratelimiter.FailClosed,
		}

		routes := []*gateway.RouteConfig{
			{
				Route: models.Route{
					ID:           uuid.New(),
					Name:         "fail-closed-route",
					PathPrefix:   "/api/orders",
					BackendID:    backendID,
					PolicyID:     &policyID,
					RequiresAuth: false,
					IsActive:     true,
				},
				Backend: backendCfg,
				Policy:  rlPolicy,
			},
		}

		gw, _ := createTestGateway(t, deadRdb, ratelimiter.FailClosed, routes)
		defer gw.Close()

		client := &http.Client{Timeout: 2 * time.Second}
		req, _ := http.NewRequest("GET", gw.URL+"/api/orders", nil)
		req.Header.Set("X-Tenant-ID", "tenant-failclosed")

		// With fail-closed, request must be rejected (429 Too Many Requests)
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusTooManyRequests, resp.StatusCode,
			"Fail-closed policy must block traffic during Redis failure")
	})

	t.Run("LocalFallback", func(t *testing.T) {
		policyID := uuid.New()
		backendID := uuid.New()

		backendCfg := &gateway.BackendConfig{
			BackendService: models.BackendService{
				ID:      backendID,
				Name:    "orders-service",
				Targets: []string{upstream.URL},
			},
		}

		limit := 3
		rlPolicy := &ratelimiter.Policy{
			ID:            policyID.String(),
			Name:          "local-fallback-policy",
			Algorithm:     ratelimiter.AlgoTokenBucket,
			Limit:         limit,
			WindowSeconds: 60,
			BurstCapacity: limit,
			Dimensions:    []string{"tenant"},
			FailureMode:   ratelimiter.FailLocalFallback,
		}

		routes := []*gateway.RouteConfig{
			{
				Route: models.Route{
					ID:           uuid.New(),
					Name:         "local-fallback-route",
					PathPrefix:   "/api/orders",
					BackendID:    backendID,
					PolicyID:     &policyID,
					RequiresAuth: false,
					IsActive:     true,
				},
				Backend: backendCfg,
				Policy:  rlPolicy,
			},
		}

		gw, _ := createTestGateway(t, deadRdb, ratelimiter.FailLocalFallback, routes)
		defer gw.Close()

		client := &http.Client{Timeout: 2 * time.Second}

		// First `limit` requests must succeed via local fallback
		for i := 0; i < limit; i++ {
			req, _ := http.NewRequest("GET", gw.URL+"/api/orders", nil)
			req.Header.Set("X-Tenant-ID", "tenant-fallback")
			resp, err := client.Do(req)
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, resp.StatusCode, "Local fallback must allow up to limit")
			_ = resp.Body.Close()
		}

		// Next request must be rejected by local fallback limiter
		req, _ := http.NewRequest("GET", gw.URL+"/api/orders", nil)
		req.Header.Set("X-Tenant-ID", "tenant-fallback")
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, http.StatusTooManyRequests, resp.StatusCode,
			"Local fallback must reject requests exceeding local capacity")
	})
}
