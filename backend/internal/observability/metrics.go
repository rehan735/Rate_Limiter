// Package observability provides Prometheus metrics, OpenTelemetry tracing,
// and health/readiness endpoints for the gateway.
package observability

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/rate-limiter/gateway/internal/config"
)

// ============================================================
// Prometheus Metrics
// ============================================================

var (
	// Gateway request metrics
	RequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_requests_total",
		Help: "Total number of requests processed by the gateway.",
	}, []string{"method", "route", "status_class"})

	RequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "gateway_request_duration_seconds",
		Help:    "Request duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "route", "status_class"})

	ActiveRequests = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "gateway_active_requests",
		Help: "Number of requests currently being processed.",
	})

	// Rate limit metrics — note: no user ID or API key in labels (cardinality)
	RateLimitAllowed = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "rate_limit_allowed_total",
		Help: "Total requests allowed through rate limiting.",
	}, []string{"route", "algorithm", "policy_id"})

	RateLimitRejected = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "rate_limit_rejected_total",
		Help: "Total requests rejected by rate limiting.",
	}, []string{"route", "algorithm", "reason"})

	RateLimitErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "rate_limit_errors_total",
		Help: "Total rate-limit infrastructure errors (Redis failures, etc.).",
	}, []string{"algorithm", "failure_mode"})

	// Redis operation metrics
	RedisOpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "redis_operation_duration_seconds",
		Help:    "Duration of Redis operations.",
		Buckets: []float64{0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1},
	}, []string{"operation"})

	RedisErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "redis_errors_total",
		Help: "Total Redis operation errors.",
	}, []string{"operation"})

	// Backend metrics
	BackendRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "backend_requests_total",
		Help: "Total requests forwarded to backend services.",
	}, []string{"backend", "method", "status_class"})

	BackendRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "backend_request_duration_seconds",
		Help:    "Backend request duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"backend", "method"})

	BackendErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "backend_errors_total",
		Help: "Total backend errors by type.",
	}, []string{"backend", "error_type"})

	// Gateway operational metrics
	ConfigReloads = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_config_reload_total",
		Help: "Total configuration reload events.",
	}, []string{"status"})

	UpstreamTimeouts = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_upstream_timeouts_total",
		Help: "Total upstream timeout events.",
	}, []string{"backend"})

	CircuitBreakersTripped = promauto.NewCounter(prometheus.CounterOpts{
		Name: "gateway_circuit_breakers_tripped_total",
		Help: "Total circuit breaker trip events.",
	})
)

// StatusClass converts an HTTP status code to a class string (2xx, 4xx, etc.).
func StatusClass(code int) string {
	switch {
	case code < 200:
		return "1xx"
	case code < 300:
		return "2xx"
	case code < 400:
		return "3xx"
	case code < 500:
		return "4xx"
	default:
		return "5xx"
	}
}

// RecordRequest records standard request metrics.
func RecordRequest(method, route string, status int, duration time.Duration) {
	sc := StatusClass(status)
	RequestsTotal.WithLabelValues(method, route, sc).Inc()
	RequestDuration.WithLabelValues(method, route, sc).Observe(duration.Seconds())
}

// TrafficSnapshot reads the process-local Prometheus counters and histogram.
// Values are intentionally aggregated without tenant or API-key dimensions.
type TrafficSnapshot struct {
	Total, Allowed, Blocked, Errors float64
	P50MS, P95MS, P99MS float64
	CircuitBreakers float64
}

func GetTrafficSnapshot() TrafficSnapshot {
	var snapshot TrafficSnapshot
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil { return snapshot }
	buckets := map[float64]uint64{}
	var observations uint64
	for _, family := range families {
		switch family.GetName() {
		case "gateway_requests_total":
			for _, metric := range family.Metric {
				count := metric.GetCounter().GetValue()
				snapshot.Total += count
				status := ""
				for _, label := range metric.Label { if label.GetName() == "status_class" { status = label.GetValue(); break } }
				if status == "5xx" { snapshot.Errors += count }
			}
		case "rate_limit_rejected_total":
			for _, metric := range family.Metric { snapshot.Blocked += metric.GetCounter().GetValue() }
		case "gateway_request_duration_seconds":
			for _, metric := range family.Metric {
				h := metric.GetHistogram(); observations += h.GetSampleCount()
				for _, bucket := range h.Bucket { buckets[bucket.GetUpperBound()] += bucket.GetCumulativeCount() }
			}
		case "gateway_circuit_breakers_tripped_total":
			for _, metric := range family.Metric { snapshot.CircuitBreakers += metric.GetCounter().GetValue() }
		}
	}
	snapshot.Allowed = snapshot.Total - snapshot.Blocked - snapshot.Errors
	if snapshot.Allowed < 0 { snapshot.Allowed = 0 }
	quantile := func(q float64) float64 {
		if observations == 0 { return 0 }
		bounds := make([]float64, 0, len(buckets)); for bound := range buckets { bounds = append(bounds, bound) }
		sort.Float64s(bounds)
		target := uint64(float64(observations)*q); if target == 0 { target = 1 }
		for _, bound := range bounds { if buckets[bound] >= target { if math.IsInf(bound, 1) { break }; return bound*1000 } }
		return 0
	}
	snapshot.P50MS, snapshot.P95MS, snapshot.P99MS = quantile(.50), quantile(.95), quantile(.99)
	return snapshot
}

// RecordRateLimit records a rate-limit decision metric.
func RecordRateLimit(route, algorithm, policyID string, allowed bool, reason string) {
	if allowed {
		RateLimitAllowed.WithLabelValues(route, algorithm, policyID).Inc()
	} else {
		RateLimitRejected.WithLabelValues(route, algorithm, reason).Inc()
	}
}

// ============================================================
// OpenTelemetry Tracing
// ============================================================

var tracer trace.Tracer

// InitTracing sets up the OpenTelemetry trace provider with OTLP/gRPC export.
// Returns a shutdown function that must be called before process exit.
func InitTracing(cfg config.ObservabilityConfig) (func(context.Context) error, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, cfg.OTLPEndpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		// Tracing export failure is non-fatal; return a no-op shutdown
		tracer = otel.Tracer(cfg.ServiceName)
		return func(context.Context) error { return nil }, nil
	}

	exp, err := otlptracegrpc.New(ctx, otlptracegrpc.WithGRPCConn(conn))
	if err != nil {
		return nil, err
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(cfg.ServiceName),
			semconv.ServiceVersion(cfg.ServiceVersion),
		),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	otel.SetTracerProvider(tp)
	tracer = tp.Tracer(cfg.ServiceName)

	return tp.Shutdown, nil
}

// StartSpan starts a trace span.
func StartSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	if tracer == nil {
		tracer = otel.Tracer("gateway")
	}
	return tracer.Start(ctx, name, trace.WithAttributes(attrs...))
}

// MetricsHandler returns the Prometheus metrics HTTP handler.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// ============================================================
// Health / Readiness
// ============================================================

// HealthChecker is a function that returns true if a dependency is healthy.
type HealthChecker func(ctx context.Context) bool

// HealthStatus aggregates health of all dependencies.
type HealthStatus struct {
	Status      string                 `json:"status"`
	Checks      map[string]CheckResult `json:"checks"`
	Timestamp   time.Time              `json:"timestamp"`
}

type CheckResult struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// HealthHandler returns an HTTP handler that reports system health.
func HealthHandler(checks map[string]HealthChecker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		results := make(map[string]CheckResult, len(checks))
		allOK := true

		for name, check := range checks {
			if check(ctx) {
				results[name] = CheckResult{Status: "healthy"}
			} else {
				results[name] = CheckResult{Status: "unhealthy", Error: "check failed"}
				allOK = false
			}
		}

		status := "healthy"
		httpStatus := http.StatusOK
		if !allOK {
			status = "degraded"
			httpStatus = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		w.Write(marshalHealth(HealthStatus{
			Status:    status,
			Checks:    results,
			Timestamp: time.Now(),
		}))
	}
}

func marshalHealth(h HealthStatus) []byte {
	checks := ""
	i := 0
	for k, v := range h.Checks {
		if i > 0 {
			checks += ","
		}
		errStr := ""
		if v.Error != "" {
			errStr = `,"error":"` + v.Error + `"`
		}
		checks += `"` + k + `":{"status":"` + v.Status + `"` + errStr + `}`
		i++
	}
	return []byte(`{"status":"` + h.Status + `","checks":{` + checks +
		`},"timestamp":"` + h.Timestamp.UTC().Format(time.RFC3339) + `"}`)
}

// ReadinessHandler is a lightweight check that the process is ready to serve.
func ReadinessHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ready","timestamp":"` + time.Now().UTC().Format(time.RFC3339) + `"}`))
	}
}

// InstrumentHandler wraps an http.Handler with request metrics and tracing.
func InstrumentHandler(route string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ActiveRequests.Inc()
		defer ActiveRequests.Dec()

		_, span := StartSpan(r.Context(), route,
			attribute.String("http.method", r.Method),
			attribute.String("http.route", route),
		)
		defer span.End()

		wrapped := &metricsWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(wrapped, r)

		duration := time.Since(start)
		span.SetAttributes(attribute.Int("http.status_code", wrapped.status))
		RecordRequest(r.Method, route, wrapped.status, duration)
	})
}

type metricsWriter struct {
	http.ResponseWriter
	status int
}

func (m *metricsWriter) WriteHeader(code int) {
	m.status = code
	m.ResponseWriter.WriteHeader(code)
}

func (m *metricsWriter) Write(b []byte) (int, error) {
	return m.ResponseWriter.Write(b)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
