package unit

import (
	"net/http"
	"net/http/httptest"
	"testing"

	mw "github.com/rate-limiter/gateway/internal/middleware"
)

func TestTrustedClientIPIgnoresForwardedHeadersFromUntrustedPeers(t *testing.T) {
	got := clientIP(t, nil, "203.0.113.9:4123", "198.51.100.7, 192.0.2.4", "198.51.100.7")
	if got != "203.0.113.9" { t.Fatalf("client IP = %q, want remote peer", got) }

	got = clientIP(t, []string{"10.0.0.0/8"}, "203.0.113.9:4123", "198.51.100.7", "")
	if got != "203.0.113.9" { t.Fatalf("client IP = %q, want remote peer", got) }
}

func TestTrustedClientIPWalksTrustedProxyChainAndSupportsIPv6(t *testing.T) {
	got := clientIP(t, []string{"10.0.0.0/8"}, "10.1.2.3:8080", "198.51.100.7, 10.2.3.4", "")
	if got != "198.51.100.7" { t.Fatalf("client IP = %q, want first untrusted hop", got) }

	got = clientIP(t, []string{"2001:db8::/32"}, "[2001:db8::2]:8080", "2001:db8::1", "")
	if got != "2001:db8::1" { t.Fatalf("client IP = %q, want forwarded IPv6 client", got) }
}

func clientIP(t *testing.T, trusted []string, remote, xff, xri string) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = remote
	if xff != "" { request.Header.Set("X-Forwarded-For", xff) }
	if xri != "" { request.Header.Set("X-Real-IP", xri) }
	var got string
	handler := mw.TrustedClientIP(trusted)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = mw.GetClientIP(r.Context())
	}))
	handler.ServeHTTP(httptest.NewRecorder(), request)
	return got
}
