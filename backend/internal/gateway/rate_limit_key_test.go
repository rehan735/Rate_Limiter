package gateway

import (
	"net/http/httptest"
	"testing"

	"github.com/rate-limiter/gateway/internal/ratelimiter"
)

func TestBuildRateLimitKeyDoesNotTrustCallerIdentityHeaders(t *testing.T) {
	policy := &ratelimiter.Policy{
		ID: "policy-id",
		KeyPattern: "{tenant}:{user}:{api_key}:{header:X-Tenant-ID}",
		Dimensions: []string{"header:X-Tenant-ID"},
	}
	first := httptest.NewRequest("GET", "/", nil)
	first.Header.Set("X-Tenant-ID", "tenant-a")
	first.Header.Set("X-User-ID", "user-a")
	first.Header.Set("X-API-Key", "secret-a")
	second := httptest.NewRequest("GET", "/", nil)
	second.Header.Set("X-Tenant-ID", "tenant-b")
	second.Header.Set("X-User-ID", "user-b")
	second.Header.Set("X-API-Key", "secret-b")

	keyA := buildRateLimitKey(policy, "route", "192.0.2.1", first)
	keyB := buildRateLimitKey(policy, "route", "192.0.2.1", second)
	if keyA != keyB { t.Fatalf("unauthenticated identity headers changed quota key: %q != %q", keyA, keyB) }
	if keyA == "" { t.Fatal("expected non-empty rate limit key") }
}
