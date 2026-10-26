// Package gateway implements the data-plane HTTP proxy with rate limiting,
// circuit breaking, load balancing, and observability.
package gateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	stdpath "path"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"

	"github.com/rate-limiter/gateway/internal/auth"
	"github.com/rate-limiter/gateway/internal/config"
	mw "github.com/rate-limiter/gateway/internal/middleware"
	"github.com/rate-limiter/gateway/internal/models"
	"github.com/rate-limiter/gateway/internal/observability"
	"github.com/rate-limiter/gateway/internal/ratelimiter"
	"github.com/rate-limiter/gateway/internal/storage"
)

// RouteConfig is the in-memory representation of a configured route.
type RouteConfig struct {
	models.Route
	Backend *BackendConfig
	Policy  *ratelimiter.Policy
}

// BackendConfig is the in-memory backend with round-robin and circuit breaker state.
type BackendConfig struct {
	models.BackendService
	counter         uint64 // atomic round-robin counter
	healthy         map[string]bool
	circuitBreakers map[string]*gobreaker.CircuitBreaker
	transports      map[string]*http.Transport
	mu              sync.RWMutex
}

// nextTarget returns the next backend target using atomic round-robin.
func (b *BackendConfig) nextTarget() (string, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	targets := b.Targets
	if len(targets) == 0 {
		return "", fmt.Errorf("backend %s has no targets", b.Name)
	}

	// Find a healthy target. Weighted pools currently have equal configured
	// weights, so they preserve round-robin behavior until per-target weights exist.
	seed := atomic.AddUint64(&b.counter, 1) - 1
	start := int(seed % uint64(len(targets)))
	if b.LoadBalancingPolicy == models.LBRandom {
		seed ^= seed >> 12
		seed ^= seed << 25
		seed ^= seed >> 27
		start = int((seed * 2685821657736338717) % uint64(len(targets)))
	}
	for i := 0; i < len(targets); i++ {
		target := targets[(start+i)%len(targets)]
		if healthy, known := b.healthy[target]; !known || healthy {
			return target, nil
		}
	}

	// All unhealthy — use round-robin anyway with a warning
	return "", fmt.Errorf("backend %s has no healthy targets", b.Name)
}

// getCircuitBreaker returns or initializes a circuit breaker for the given target.
func (b *BackendConfig) getCircuitBreaker(target string) *gobreaker.CircuitBreaker {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.circuitBreakers == nil {
		b.circuitBreakers = make(map[string]*gobreaker.CircuitBreaker)
	}
	if cb, ok := b.circuitBreakers[target]; ok {
		return cb
	}

	cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
		Name:        fmt.Sprintf("%s-%s", b.Name, target),
		MaxRequests: 3,
		Interval:    10 * time.Second,
		Timeout:     15 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
			return counts.Requests >= 5 && failureRatio >= 0.5
		},
		OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
			log.Warn().Str("circuit_breaker", name).Str("from", from.String()).Str("to", to.String()).Msg("circuit breaker state transition")
			if to == gobreaker.StateOpen {
				observability.CircuitBreakersTripped.Inc()
			}
		},
	})
	b.circuitBreakers[target] = cb
	return cb
}

func (b *BackendConfig) getTransport(target string, dial func(context.Context, string, string) (net.Conn, error), responseTimeout time.Duration) *http.Transport {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.transports == nil { b.transports = make(map[string]*http.Transport) }
	if transport := b.transports[target]; transport != nil { return transport }
	transport := &http.Transport{
		DialContext: dial, MaxIdleConns: 100, MaxIdleConnsPerHost: 32,
		IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 10 * time.Second,
		ExpectContinueTimeout: time.Second, ResponseHeaderTimeout: responseTimeout,
	}
	b.transports[target] = transport
	return transport
}

// Server is the gateway data-plane server.
type Server struct {
	cfg            *config.Config
	authSvc        *auth.Service
	limiterFactory *ratelimiter.Factory
	routeStore     *storage.RouteStore
	backendStore   *storage.BackendStore
	policyStore    *storage.PolicyStore
	apiKeyStore    *storage.APIKeyStore

	mu       sync.RWMutex
	routes   []*RouteConfig
	backends map[string]*BackendConfig // key: backend ID string
	semaphore chan struct{}
	ready     uint32
}

// NewServer creates the gateway data-plane server.
func NewServer(
	cfg *config.Config,
	authSvc *auth.Service,
	limiterFactory *ratelimiter.Factory,
	routeStore *storage.RouteStore,
	backendStore *storage.BackendStore,
	policyStore *storage.PolicyStore,
	apiKeyStores ...*storage.APIKeyStore,
) *Server {
	maxConcurrent := 10000
	if cfg != nil && cfg.Gateway.MaxConcurrentRequests > 0 { maxConcurrent = cfg.Gateway.MaxConcurrentRequests }
	s := &Server{
		cfg:            cfg,
		authSvc:        authSvc,
		limiterFactory: limiterFactory,
		routeStore:     routeStore,
		backendStore:   backendStore,
		policyStore:    policyStore,
		backends:       make(map[string]*BackendConfig),
		semaphore:      make(chan struct{}, maxConcurrent),
	}
	if len(apiKeyStores) > 0 { s.apiKeyStore = apiKeyStores[0] }
	return s
}

// LoadRoutes loads all active routes and backends from the database into memory.
func (s *Server) LoadRoutes(ctx context.Context) error {
	routes, err := s.routeStore.ListActive(ctx)
	if err != nil {
		return fmt.Errorf("load routes: %w", err)
	}

	backends, err := s.backendStore.ListActive(ctx)
	if err != nil {
		return fmt.Errorf("load backends: %w", err)
	}

	policies, err := s.policyStore.ListActive(ctx)
	if err != nil {
		return fmt.Errorf("load policies: %w", err)
	}

	// Index backends and policies
	backendMap := make(map[string]*BackendConfig, len(backends))
	for _, b := range backends {
		healthy := make(map[string]bool, len(b.Targets))
		for _, t := range b.Targets {
			healthy[t] = true
		}
		backendMap[b.ID.String()] = &BackendConfig{
			BackendService: *b,
			healthy:        healthy,
		}
	}

	policyMap := make(map[string]*ratelimiter.Policy, len(policies))
	for _, p := range policies {
		policyMap[p.ID.String()] = modelPolicyToRLPolicy(p)
	}

	newRoutes := make([]*RouteConfig, 0, len(routes))
	for _, r := range routes {
		rc := &RouteConfig{Route: *r}
		if backend, ok := backendMap[r.BackendID.String()]; ok {
			rc.Backend = backend
		}
		if r.PolicyID != nil {
			if policy, ok := policyMap[r.PolicyID.String()]; ok {
				rc.Policy = policy
			}
		}
		newRoutes = append(newRoutes, rc)
	}

	s.mu.Lock()
	s.routes = newRoutes
	s.backends = backendMap
	s.mu.Unlock()
	atomic.StoreUint32(&s.ready, 1)

	observability.ConfigReloads.WithLabelValues("success").Inc()
	log.Info().Int("routes", len(newRoutes)).Int("backends", len(backendMap)).Msg("gateway routes loaded")
	return nil
}

// SetRoutesManually configures routes in-memory for testing and dynamic setup.
func (s *Server) SetRoutesManually(routes []*RouteConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.routes = routes
}


// PeriodicReload reloads routes from the database at fixed intervals.
func (s *Server) PeriodicReload(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.LoadRoutes(ctx); err != nil {
				log.Error().Err(err).Msg("periodic route reload failed")
				observability.ConfigReloads.WithLabelValues("failure").Inc()
			}
		}
	}
}

// PeriodicHealthCheck probes configured targets and removes failed targets
// from rotation. It performs an immediate probe before waiting for the ticker.
func (s *Server) PeriodicHealthCheck(ctx context.Context, interval time.Duration) {
	if interval <= 0 { interval = 10 * time.Second }
	probe := func() {
		s.mu.RLock()
		backends := make([]*BackendConfig, 0, len(s.backends))
		for _, backend := range s.backends { backends = append(backends, backend) }
		s.mu.RUnlock()
		for _, backend := range backends {
			path := backend.HealthCheckPath
			if path == "" { path = "/healthz" }
			transport := &http.Transport{DialContext: s.safeDialContext(2*time.Second), TLSHandshakeTimeout: 2*time.Second}
			client := &http.Client{Transport: transport, Timeout: 3*time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			for _, target := range backend.Targets {
				base, err := url.Parse(target)
				if err == nil && base.Scheme == "" { base, err = url.Parse("http://" + target) }
				healthy := false
				if err == nil {
					base.Path = strings.TrimRight(base.Path, "/") + "/" + strings.TrimLeft(path, "/")
					request, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
					if reqErr == nil {
						response, callErr := client.Do(request)
						if callErr == nil { healthy = response.StatusCode >= 200 && response.StatusCode < 400; response.Body.Close() }
					}
				}
				backend.mu.Lock(); backend.healthy[target] = healthy; backend.mu.Unlock()
			}
			transport.CloseIdleConnections()
		}
	}
	probe()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for { select { case <-ctx.Done(): return; case <-ticker.C: probe() } }
}

// BuildHTTPHandler returns the main gateway HTTP handler.
func (s *Server) BuildHTTPHandler() http.Handler {
	r := chi.NewRouter()

	r.Use(mw.RequestID)
	r.Use(mw.TrustedClientIP(s.cfg.Gateway.TrustedProxies))
	r.Use(mw.StructuredLogger)
	r.Use(mw.RequestSizeLimit(s.cfg.Gateway.MaxRequestSize))

	// Health checks (unauthenticated)
	r.Get("/healthz", observability.ReadinessHandler())
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if atomic.LoadUint32(&s.ready) == 0 {
			http.Error(w, `{"status":"not_ready"}`, http.StatusServiceUnavailable)
			return
		}
		observability.ReadinessHandler()(w, r)
	})

	// All other traffic goes through the proxy handler
	r.HandleFunc("/*", s.handleProxy)

	return r
}

// handleProxy matches the incoming request against configured routes,
// applies rate limiting, checks circuit breakers, and proxies to the backend.
func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	observability.ActiveRequests.Inc()
	defer observability.ActiveRequests.Dec()
	select {
	case s.semaphore <- struct{}{}:
		defer func() { <-s.semaphore }()
	default:
		writeGatewayError(w, http.StatusServiceUnavailable, "gateway concurrency limit reached")
		return
	}

	route := s.matchRoute(r)
	if route == nil {
		http.Error(w, `{"error":"no matching route"}`, http.StatusNotFound)
		return
	}

	routeName := route.Name

	// Authentication check
	if route.RequiresAuth || r.Header.Get("X-API-Key") != "" || strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		claims, err := s.extractClaims(r)
		var apiKey *models.APIKey
		if claims == nil && err == nil {
			apiKey, err = s.extractAPIKey(r)
		}
		if err != nil || (claims == nil && apiKey == nil) {
			w.Header().Set("Content-Type", "application/problem+json")
			writeGatewayError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		ctx := context.WithValue(r.Context(), mw.ContextKeyUser, claims)
		if claims == nil { ctx = context.WithValue(r.Context(), mw.ContextKeyAPIKey, apiKey) }
		r = r.WithContext(ctx)
	}

	// Rate limiting
	if route.Policy != nil {
		decision, err := s.applyRateLimit(r, route)
		if err != nil {
			log.Error().Err(err).Str("route", routeName).Msg("rate limit error")
			failureMode := route.Policy.FailureMode
			if failureMode == "" && s.cfg != nil {
				failureMode = ratelimiter.FailureMode(s.cfg.Redis.FailurePolicy)
			}
			if failureMode == ratelimiter.FailClosed {
				w.Header().Set("Content-Type", "application/problem+json")
				w.Header().Set("Retry-After", "5")
				w.Header().Set("X-RateLimit-Policy", route.Policy.Name)
				observability.RecordRateLimit(routeName, string(route.Policy.Algorithm), route.Policy.ID, false, "limiter_error_fail_closed")
				writeGatewayError(w, http.StatusServiceUnavailable, "rate limit evaluation failed: service temporarily unavailable")
				observability.RecordRequest(r.Method, routeName, http.StatusServiceUnavailable, time.Since(start))
				return
			}
		}

		if decision != nil && !decision.Allowed {
			// Write standard rate-limit headers
			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", decision.Limit))
			w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", decision.Remaining))
			w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", decision.ResetAt.Unix()))
			w.Header().Set("X-RateLimit-Policy", route.Policy.Name)
			w.Header().Set("X-RateLimit-Algorithm", decision.Algorithm)
			if decision.RetryAfter > 0 {
				w.Header().Set("Retry-After", fmt.Sprintf("%.0f", decision.RetryAfter.Seconds()))
			}

			observability.RecordRateLimit(routeName, decision.Algorithm, decision.PolicyID, false, decision.Reason)

			w.Header().Set("Content-Type", "application/problem+json")
			status := http.StatusTooManyRequests
			msg := "rate limit exceeded"
			if decision.InfraError != nil {
				status = http.StatusServiceUnavailable
				msg = "rate limit check failed: service temporarily unavailable"
			}
			writeGatewayError(w, status, msg)
			observability.RecordRequest(r.Method, routeName, status, time.Since(start))
			return
		}

		if decision != nil {
			observability.RecordRateLimit(routeName, decision.Algorithm, decision.PolicyID, true, "")
			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", decision.Limit))
			w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", decision.Remaining))
			w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", decision.ResetAt.Unix()))
		}
	}

	// Backend selection
	if route.Backend == nil {
		writeGatewayError(w, http.StatusBadGateway, "no backend configured")
		return
	}

	target, err := route.Backend.nextTarget()
	if err != nil {
		writeGatewayError(w, http.StatusBadGateway, "no available backend")
		return
	}

	// Circuit breaker inspection
	cb := route.Backend.getCircuitBreaker(target)
	if cb != nil && cb.State() == gobreaker.StateOpen {
		w.Header().Set("Content-Type", "application/problem+json")
		writeGatewayError(w, http.StatusServiceUnavailable, "circuit breaker open: backend unavailable")
		observability.RecordRequest(r.Method, routeName, http.StatusServiceUnavailable, time.Since(start))
		return
	}

	// Reverse proxy target URL normalization
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = "http://" + target
	}
	backendURL, err := url.Parse(target)
	if err != nil {
		log.Error().Err(err).Str("target", target).Msg("invalid backend URL")
		writeGatewayError(w, http.StatusInternalServerError, "invalid backend URL")
		return
	}

	proxy := s.buildProxy(backendURL, route)
	if route.MaxBodySize > 0 {
		if r.ContentLength > route.MaxBodySize {
			writeGatewayError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, route.MaxBodySize)
	}
	if route.Timeout > 0 {
		ctx, cancel := context.WithTimeout(r.Context(), route.Timeout)
		defer cancel()
		r = r.WithContext(ctx)
	}
	wrapped := &observability.StatusRecordingWriter{ResponseWriter: w}
	proxy.ServeHTTP(wrapped, r)

	duration := time.Since(start)
	statusCode := wrapped.StatusCode()
	if statusCode == 0 {
		statusCode = http.StatusOK
	}

	// Update Circuit Breaker state
	if cb != nil {
		if statusCode >= 500 {
			_, _ = cb.Execute(func() (interface{}, error) {
				return nil, fmt.Errorf("backend error status: %d", statusCode)
			})
		} else {
			_, _ = cb.Execute(func() (interface{}, error) {
				return nil, nil
			})
		}
	}

	observability.RecordRequest(r.Method, routeName, statusCode, duration)
	observability.BackendRequestDuration.WithLabelValues(route.Backend.Name, r.Method).Observe(duration.Seconds())
	observability.BackendRequestsTotal.WithLabelValues(
		route.Backend.Name, r.Method, observability.StatusClass(statusCode),
	).Inc()
}

func (s *Server) matchRoute(r *http.Request) *RouteConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	path := r.URL.Path
	method := r.Method

	// Routes are sorted by priority DESC from the database
	for _, route := range s.routes {
		if !route.IsActive {
			continue
		}

		// Method check
		if !methodAllowed(route.Methods, method) {
			continue
		}

		// Exact path match (higher priority)
		if route.ExactPath != "" && route.ExactPath == path {
			return route
		}

		// Glob match on ExactPath (e.g. /api/*/users or /v1/*)
		if route.ExactPath != "" && strings.ContainsAny(route.ExactPath, "*?[") {
			if matchGlob(route.ExactPath, path) {
				return route
			}
		}

		// Glob match on PathPrefix
		if route.PathPrefix != "" && strings.ContainsAny(route.PathPrefix, "*?[") {
			if matchGlob(route.PathPrefix, path) {
				return route
			}
		}

		// Prefix match
		if route.PathPrefix != "" && strings.HasPrefix(path, route.PathPrefix) {
			return route
		}
	}
	return nil
}

func matchGlob(pattern, target string) bool {
	if matched, err := stdpath.Match(pattern, target); err == nil && matched {
		return true
	}
	if strings.HasSuffix(pattern, "/*") {
		basePrefix := strings.TrimSuffix(pattern, "/*")
		if target == basePrefix || strings.HasPrefix(target, basePrefix+"/") {
			return true
		}
	}
	return false
}

func methodAllowed(methods []string, method string) bool {
	if len(methods) == 0 {
		return true
	}
	for _, m := range methods {
		if m == method {
			return true
		}
	}
	return false
}

func (s *Server) applyRateLimit(r *http.Request, route *RouteConfig) (*ratelimiter.Decision, error) {
	policy := route.Policy
	if policy == nil {
		return nil, nil
	}

	limiter, err := s.limiterFactory.ForPolicy(policy)
	if err != nil {
		failureMode := policy.FailureMode
		if failureMode == "" && s.cfg != nil {
			failureMode = ratelimiter.FailureMode(s.cfg.Redis.FailurePolicy)
		}
		if failureMode == ratelimiter.FailClosed {
			return &ratelimiter.Decision{
				Allowed:    false,
				Algorithm:  string(policy.Algorithm),
				PolicyID:   policy.ID,
				InfraError: err,
				Reason:     "limiter_init_fail_closed",
				RetryAfter: 5 * time.Second,
			}, err
		}
		return nil, err
	}

	clientIP := mw.GetClientIP(r.Context())
	key := buildRateLimitKey(policy, route.Name, clientIP, r)
	cost := route.RequestCost
	if cost < 1 {
		cost = 1
	}

	return limiter.Allow(r.Context(), ratelimiter.Request{
		Key:    key,
		Cost:   cost,
		Policy: policy,
	})
}

// buildRateLimitKey constructs a Redis key based on the policy's key pattern.
// Correctly substitutes {ip}, {route}, {method}, {user}, {tenant}, {api_key},
// and custom {header:...} dimensions, guaranteeing no unreplaced placeholders remain.
func buildRateLimitKey(policy *ratelimiter.Policy, routeName, clientIP string, r *http.Request) string {
	pattern := policy.KeyPattern
	if pattern == "" {
		pattern = "{ip}"
	}

	claims := mw.GetUserClaims(r.Context())

	// IP substitution
	pattern = strings.ReplaceAll(pattern, "{ip}", clientIP)
	// Route substitution
	pattern = strings.ReplaceAll(pattern, "{route}", routeName)
	// HTTP Method substitution
	pattern = strings.ReplaceAll(pattern, "{method}", r.Method)

	// User substitution
	userID := ""
	if claims != nil {
		userID = claims.UserID.String()
	} else if key, ok := r.Context().Value(mw.ContextKeyAPIKey).(*models.APIKey); ok && key.UserID != nil {
		userID = key.UserID.String()
	}
	if userID == "" {
		userID = "anon_user"
	}
	pattern = strings.ReplaceAll(pattern, "{user}", userID)

	// Tenant substitution
	tenantID := ""
	if claims != nil && claims.TenantID != nil {
		tenantID = claims.TenantID.String()
	} else if key, ok := r.Context().Value(mw.ContextKeyAPIKey).(*models.APIKey); ok {
		tenantID = key.TenantID.String()
	}
	if tenantID == "" {
		tenantID = "anon_tenant"
	}
	pattern = strings.ReplaceAll(pattern, "{tenant}", tenantID)

	// API Key substitution
	// Caller-provided API keys are not identities until validated by the gateway.
	apiKey := "no_key"
	if key, ok := r.Context().Value(mw.ContextKeyAPIKey).(*models.APIKey); ok { apiKey = key.ID.String() }
	pattern = strings.ReplaceAll(pattern, "{api_key}", apiKey)

	// Custom Header dimensions (e.g. {header:Idempotency-Key})
	for _, dim := range policy.Dimensions {
		if strings.HasPrefix(dim, "header:") {
			hdrName := strings.TrimPrefix(dim, "header:")
			val := r.Header.Get(hdrName)
			switch strings.ToLower(hdrName) {
			case "x-tenant-id", "x-user-id", "x-api-key", "authorization":
				val = "untrusted_identity_header"
			}
			if val == "" {
				val = "empty"
			}
			hash := sha256.Sum256([]byte(val))
			val = hex.EncodeToString(hash[:12])
			pattern = strings.ReplaceAll(pattern, "{"+dim+"}", val)
		}
	}

	// Wrap in hash tags {...} for Redis Cluster slot compatibility
	return fmt.Sprintf("rl:%s:{%s}:%s", policy.Algorithm, pattern, policy.ID)
}

func (s *Server) extractClaims(r *http.Request) (*auth.Claims, error) {
	header := r.Header.Get("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		token := strings.TrimPrefix(header, "Bearer ")
		return s.authSvc.ValidateToken(r.Context(), token)
	}
	return nil, nil
}

func (s *Server) extractAPIKey(r *http.Request) (*models.APIKey, error) {
	raw := r.Header.Get("X-API-Key")
	if raw == "" || s.apiKeyStore == nil { return nil, nil }
	key, err := s.apiKeyStore.GetByHash(r.Context(), auth.HashAPIKey(raw))
	if err != nil { return nil, err }
	if !key.IsValid() { return nil, fmt.Errorf("api key is expired or revoked") }
	_ = s.apiKeyStore.UpdateLastUsed(r.Context(), key.ID)
	return key, nil
}

func (s *Server) buildProxy(backendURL *url.URL, route *RouteConfig) *httputil.ReverseProxy {
	connectTimeout := route.Backend.ConnectTimeout
	if connectTimeout <= 0 {
		connectTimeout = 5 * time.Second
	}
	transport := route.Backend.getTransport(backendURL.Host, s.safeDialContext(connectTimeout), route.Backend.ResponseTimeout)

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = backendURL.Scheme
			req.URL.Host = backendURL.Host

			if route.StripPrefix && route.PathPrefix != "" {
				req.URL.Path = strings.TrimPrefix(req.URL.Path, route.PathPrefix)
				req.URL.RawPath = "" // Clear RawPath so URL encoding does not leak unstripped prefix
				if req.URL.Path == "" {
					req.URL.Path = "/"
				}
			}

			// Forwarded headers
			req.Header.Set("X-Forwarded-Host", req.Host)
			req.Header.Set("X-Forwarded-Proto", "http")
			req.Header.Set("X-Request-ID", mw.GetRequestID(req.Context()))

			// Request header transformations
			for k, v := range route.RequestHeaders {
				if sv, ok := v.(string); ok {
					req.Header.Set(k, sv)
				}
			}
		},
		Transport: transport,
		ErrorHandler: func(w http.ResponseWriter, req *http.Request, err error) {
			log.Error().Err(err).
				Str("backend", backendURL.Host).
				Str("path", req.URL.Path).
				Msg("proxy error")

			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				writeGatewayError(w, http.StatusRequestEntityTooLarge, "request body too large")
			} else if isTimeoutError(err) {
				observability.UpstreamTimeouts.WithLabelValues(backendURL.Host).Inc()
				writeGatewayError(w, http.StatusGatewayTimeout, "upstream timeout")
			} else {
				observability.BackendErrors.WithLabelValues(backendURL.Host, "proxy_error").Inc()
				writeGatewayError(w, http.StatusBadGateway, "upstream error")
			}
		},
		ModifyResponse: func(response *http.Response) error {
			for key, value := range route.ResponseHeaders {
				if text, ok := value.(string); ok { response.Header.Set(key, text) }
			}
			return nil
		},
	}

	return proxy
}

func (s *Server) safeDialContext(timeout time.Duration) func(context.Context, string, string) (net.Conn, error) {
	if timeout <= 0 { timeout = 5 * time.Second }
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	allowPrivate := s.cfg != nil && s.cfg.Gateway.AllowPrivateBackends
	var privateRanges []*net.IPNet
	if s.cfg != nil {
		for _, cidr := range s.cfg.Gateway.BackendAllowedCIDRs {
			if _, block, err := net.ParseCIDR(cidr); err == nil { privateRanges = append(privateRanges, block) }
		}
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil { return nil, err }
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil { return nil, err }
		var lastErr error
		for _, resolved := range ips {
			if !allowedBackendIP(resolved.IP, allowPrivate, privateRanges) { continue }
			conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.IP.String(), port))
			if dialErr == nil { return conn, nil }
			lastErr = dialErr
		}
		if lastErr != nil { return nil, lastErr }
		return nil, fmt.Errorf("backend host resolved only to prohibited addresses")
	}
}

func allowedBackendIP(ip net.IP, allowPrivate bool, allowedRanges []*net.IPNet) bool {
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() { return false }
	if ip.IsPrivate() {
		if allowPrivate { return true }
		for _, block := range allowedRanges { if block.Contains(ip) { return true } }
		return false
	}
	return true
}

func isTimeoutError(err error) bool {
	if netErr, ok := err.(net.Error); ok {
		return netErr.Timeout()
	}
	return strings.Contains(err.Error(), "timeout")
}

func writeGatewayError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	fmt.Fprintf(w, `{"type":"https://httpstatuses.io/%d","title":"%s","status":%d}`,
		status, message, status)
}

func modelPolicyToRLPolicy(m *models.Policy) *ratelimiter.Policy {
	dims := make([]string, len(m.Dimensions))
	for i, d := range m.Dimensions {
		dims[i] = string(d)
	}

	refillRate := m.RefillRate
	if refillRate <= 0 && m.WindowSeconds > 0 {
		refillRate = float64(m.Limit) / float64(m.WindowSeconds)
	}

	burstCap := m.BurstCapacity
	if burstCap <= 0 {
		burstCap = m.Limit
	}


	return &ratelimiter.Policy{
		ID:            m.ID.String(),
		Name:          m.Name,
		Algorithm:     ratelimiter.Algorithm(m.Algorithm),
		Limit:         m.Limit,
		WindowSeconds: m.WindowSeconds,
		BurstCapacity: burstCap,
		RefillRate:    refillRate,
		RequestCost:   m.RequestCost,
		KeyPattern:    m.KeyPattern,
		FailureMode:   ratelimiter.FailureMode(m.FailureMode),
		Dimensions:    dims,
	}
}
