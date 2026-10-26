package middleware

import (
	"context"
	"net/http"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/rate-limiter/gateway/internal/auth"
	"github.com/rate-limiter/gateway/internal/models"
)

type contextKey string

const (
	ContextKeyRequestID  contextKey = "request_id"
	ContextKeyUser       contextKey = "user_claims"
	ContextKeyAPIKey     contextKey = "api_key"
	ContextKeyClientIP   contextKey = "client_ip"
)

// RequestID injects a unique request ID into every request context and response.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.New().String()
		}
		ctx := context.WithValue(r.Context(), ContextKeyRequestID, id)
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetRequestID retrieves the request ID from the context.
func GetRequestID(ctx context.Context) string {
	if id, ok := ctx.Value(ContextKeyRequestID).(string); ok {
		return id
	}
	return ""
}

// StructuredLogger logs each request as a structured JSON event.
// Sensitive headers (Authorization, X-API-Key) are never logged.
func StructuredLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rid := GetRequestID(r.Context())

		wrapped := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(wrapped, r)

		log.Info().
			Str("request_id", rid).
			Str("method", r.Method).
			Str("path", r.URL.Path).
			Int("status", wrapped.status).
			Int64("bytes", wrapped.bytes).
			Dur("latency", time.Since(start)).
			Str("ip", GetClientIP(r.Context())).
			Msg("request")
	})
}

// responseWriter wraps http.ResponseWriter to capture status and bytes written.
type responseWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.bytes += int64(n)
	return n, err
}

// JWTAuth validates Bearer tokens and stores claims in the context.
// Returns 401 if the token is missing or invalid.
func JWTAuth(authSvc *auth.Service, required bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" || !strings.HasPrefix(header, "Bearer ") {
				if required {
					writeAuthError(w, "missing or invalid authorization header")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			tokenStr := strings.TrimPrefix(header, "Bearer ")
			claims, err := authSvc.ValidateToken(r.Context(), tokenStr)
			if err != nil {
				if required {
					writeAuthError(w, "invalid or expired token")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			ctx := context.WithValue(r.Context(), ContextKeyUser, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRole rejects requests where the authenticated user lacks the required role.
// Call after JWTAuth.
func RequireRole(roles ...models.Role) func(http.Handler) http.Handler {
	allowed := make(map[models.Role]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := GetUserClaims(r.Context())
			if claims == nil {
				writeAuthError(w, "authentication required")
				return
			}
			if !allowed[claims.Role] {
				writeForbiddenError(w, "insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// GetUserClaims retrieves JWT claims from the context.
func GetUserClaims(ctx context.Context) *auth.Claims {
	if claims, ok := ctx.Value(ContextKeyUser).(*auth.Claims); ok {
		return claims
	}
	return nil
}

// TrustedClientIP extracts the real client IP from X-Forwarded-For or X-Real-IP,
// but only if the request originates from a trusted proxy. Otherwise uses RemoteAddr.
// This prevents IP spoofing from untrusted clients.
func TrustedClientIP(trustedProxies []string) func(http.Handler) http.Handler {
	trusted := make([]*net.IPNet, 0, len(trustedProxies))
	for _, p := range trustedProxies {
		p = strings.TrimSpace(p)
		if ip := net.ParseIP(p); ip != nil {
			bits := 128
			if ip.To4() != nil { bits = 32; ip = ip.To4() }
			trusted = append(trusted, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		} else if _, block, err := net.ParseCIDR(p); err == nil {
			trusted = append(trusted, block)
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			remoteIP := extractIP(r.RemoteAddr)
			clientIP := remoteIP

			if isTrusted(remoteIP, trusted) {
				if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
					parts := strings.Split(xff, ",")
					for i := len(parts)-1; i >= 0; i-- {
						candidate := strings.TrimSpace(parts[i])
						if net.ParseIP(candidate) == nil { continue }
						clientIP = candidate
						if !isTrusted(candidate, trusted) { break }
					}
				} else if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(xri) != nil {
					clientIP = xri
				}
			}

			ctx := context.WithValue(r.Context(), ContextKeyClientIP, clientIP)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetClientIP retrieves the extracted client IP from context.
func GetClientIP(ctx context.Context) string {
	if ip, ok := ctx.Value(ContextKeyClientIP).(string); ok {
		return ip
	}
	return ""
}

func extractIP(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return strings.Trim(addr, "[]")
}

func isTrusted(ip string, ranges []*net.IPNet) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil { return false }
	for _, block := range ranges { if block.Contains(parsed) { return true } }
	return false
}

func writeAuthError(w http.ResponseWriter, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"type":"https://httpstatuses.io/401","title":"Unauthorized","status":401,"detail":"` + detail + `"}`))
}

func writeForbiddenError(w http.ResponseWriter, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusForbidden)
	w.Write([]byte(`{"type":"https://httpstatuses.io/403","title":"Forbidden","status":403,"detail":"` + detail + `"}`))
}

// RequestSizeLimit enforces a maximum request body size.
func RequestSizeLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

// Logger creates a zerolog logger with request context fields.
func Logger(ctx context.Context) zerolog.Logger {
	rid := GetRequestID(ctx)
	return log.With().Str("request_id", rid).Logger()
}
