package models

import (
	"time"

	"github.com/google/uuid"
)

// ============================================================
// Users and Authentication
// ============================================================

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
	RoleDeveloper Role = "developer"
	RoleViewer   Role = "viewer"
)

type User struct {
	ID           uuid.UUID  `db:"id" json:"id"`
	Email        string     `db:"email" json:"email"`
	PasswordHash string     `db:"password_hash" json:"-"`
	Role         Role       `db:"role" json:"role"`
	TenantID     *uuid.UUID `db:"tenant_id" json:"tenant_id,omitempty"`
	IsActive     bool       `db:"is_active" json:"is_active"`
	LastLoginAt  *time.Time `db:"last_login_at" json:"last_login_at,omitempty"`
	CreatedAt    time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time  `db:"updated_at" json:"updated_at"`
	DeletedAt    *time.Time `db:"deleted_at" json:"deleted_at,omitempty"`
}

type RefreshToken struct {
	ID        uuid.UUID  `db:"id" json:"id"`
	UserID    uuid.UUID  `db:"user_id" json:"user_id"`
	TokenHash string     `db:"token_hash" json:"-"`
	ExpiresAt time.Time  `db:"expires_at" json:"expires_at"`
	RevokedAt *time.Time `db:"revoked_at" json:"revoked_at,omitempty"`
	CreatedAt time.Time  `db:"created_at" json:"created_at"`
}

// ============================================================
// Tenants and Plans
// ============================================================

type Tenant struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	Name        string     `db:"name" json:"name"`
	Slug        string     `db:"slug" json:"slug"`
	PlanID      *uuid.UUID `db:"plan_id" json:"plan_id,omitempty"`
	IsActive    bool       `db:"is_active" json:"is_active"`
	Metadata    JSONB      `db:"metadata" json:"metadata,omitempty"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
	DeletedAt   *time.Time `db:"deleted_at" json:"deleted_at,omitempty"`
}

type SubscriptionPlan struct {
	ID               uuid.UUID `db:"id" json:"id"`
	Name             string    `db:"name" json:"name"`
	RequestsPerMinute int      `db:"requests_per_minute" json:"requests_per_minute"`
	RequestsPerDay   int       `db:"requests_per_day" json:"requests_per_day"`
	BurstCapacity    int       `db:"burst_capacity" json:"burst_capacity"`
	MaxAPIKeys       int       `db:"max_api_keys" json:"max_api_keys"`
	IsActive         bool      `db:"is_active" json:"is_active"`
	CreatedAt        time.Time `db:"created_at" json:"created_at"`
	UpdatedAt        time.Time `db:"updated_at" json:"updated_at"`
}

// ============================================================
// API Keys
// ============================================================

type APIKey struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	Name        string     `db:"name" json:"name"`
	Description string     `db:"description" json:"description"`
	KeyHash     string     `db:"key_hash" json:"-"`
	KeyPrefix   string     `db:"key_prefix" json:"key_prefix"`
	TenantID    uuid.UUID  `db:"tenant_id" json:"tenant_id"`
	UserID      *uuid.UUID `db:"user_id" json:"user_id,omitempty"`
	PolicyID    *uuid.UUID `db:"policy_id" json:"policy_id,omitempty"`
	ExpiresAt   *time.Time `db:"expires_at" json:"expires_at,omitempty"`
	LastUsedAt  *time.Time `db:"last_used_at" json:"last_used_at,omitempty"`
	RevokedAt   *time.Time `db:"revoked_at" json:"revoked_at,omitempty"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
}

func (k *APIKey) IsRevoked() bool {
	return k.RevokedAt != nil
}

func (k *APIKey) IsExpired() bool {
	return k.ExpiresAt != nil && time.Now().After(*k.ExpiresAt)
}

func (k *APIKey) IsValid() bool {
	return !k.IsRevoked() && !k.IsExpired()
}

// ============================================================
// Backend Services
// ============================================================

type LoadBalancingPolicy string

const (
	LBRoundRobin LoadBalancingPolicy = "round_robin"
	LBWeighted   LoadBalancingPolicy = "weighted"
	LBRandom     LoadBalancingPolicy = "random"
)

type BackendService struct {
	ID                  uuid.UUID           `db:"id" json:"id"`
	Name                string              `db:"name" json:"name"`
	Description         string              `db:"description" json:"description"`
	Targets             StringArray         `db:"targets" json:"targets"`
	LoadBalancingPolicy LoadBalancingPolicy `db:"load_balancing_policy" json:"load_balancing_policy"`
	HealthCheckPath     string              `db:"health_check_path" json:"health_check_path"`
	HealthCheckInterval time.Duration       `db:"health_check_interval" json:"health_check_interval"`
	ConnectTimeout      time.Duration       `db:"connect_timeout" json:"connect_timeout"`
	ResponseTimeout     time.Duration       `db:"response_timeout" json:"response_timeout"`
	MaxRetries          int                 `db:"max_retries" json:"max_retries"`
	RetryOn             StringArray         `db:"retry_on" json:"retry_on"`
	IsActive            bool                `db:"is_active" json:"is_active"`
	CreatedAt           time.Time           `db:"created_at" json:"created_at"`
	UpdatedAt           time.Time           `db:"updated_at" json:"updated_at"`
	DeletedAt           *time.Time          `db:"deleted_at" json:"deleted_at,omitempty"`
}

// ============================================================
// Routes
// ============================================================

type HTTPMethod string

const (
	MethodGET    HTTPMethod = "GET"
	MethodPOST   HTTPMethod = "POST"
	MethodPUT    HTTPMethod = "PUT"
	MethodPATCH  HTTPMethod = "PATCH"
	MethodDELETE HTTPMethod = "DELETE"
	MethodHEAD   HTTPMethod = "HEAD"
	MethodOPTIONS HTTPMethod = "OPTIONS"
)

type Route struct {
	ID              uuid.UUID   `db:"id" json:"id"`
	Name            string      `db:"name" json:"name"`
	Description     string      `db:"description" json:"description"`
	PathPrefix      string      `db:"path_prefix" json:"path_prefix"`
	ExactPath       string      `db:"exact_path" json:"exact_path"`
	Methods         StringArray `db:"methods" json:"methods"`
	BackendID       uuid.UUID   `db:"backend_id" json:"backend_id"`
	StripPrefix     bool        `db:"strip_prefix" json:"strip_prefix"`
	PolicyID        *uuid.UUID  `db:"policy_id" json:"policy_id,omitempty"`
	RequestCost     int         `db:"request_cost" json:"request_cost"`
	RequiresAuth    bool        `db:"requires_auth" json:"requires_auth"`
	AllowedRoles    StringArray `db:"allowed_roles" json:"allowed_roles,omitempty"`
	RequestHeaders  JSONB       `db:"request_headers" json:"request_headers,omitempty"`
	ResponseHeaders JSONB       `db:"response_headers" json:"response_headers,omitempty"`
	MaxBodySize     int64       `db:"max_body_size" json:"max_body_size"`
	Timeout         time.Duration `db:"timeout" json:"timeout"`
	IsActive        bool        `db:"is_active" json:"is_active"`
	Priority        int         `db:"priority" json:"priority"`
	CreatedAt       time.Time   `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time   `db:"updated_at" json:"updated_at"`
	DeletedAt       *time.Time  `db:"deleted_at" json:"deleted_at,omitempty"`
}

// ============================================================
// Rate-Limit Policies
// ============================================================

type Algorithm string

const (
	AlgoTokenBucket       Algorithm = "token_bucket"
	AlgoFixedWindow       Algorithm = "fixed_window"
	AlgoSlidingWindow     Algorithm = "sliding_window"
	AlgoSlidingWindowLog  Algorithm = "sliding_window_log"
)

type FailureMode string

const (
	FailureOpen     FailureMode = "fail_open"
	FailureClosed   FailureMode = "fail_closed"
	FailureLocalFallback FailureMode = "local_fallback"
)

type Policy struct {
	ID              uuid.UUID   `db:"id" json:"id"`
	Name            string      `db:"name" json:"name"`
	Description     string      `db:"description" json:"description"`
	Algorithm       Algorithm   `db:"algorithm" json:"algorithm"`
	Limit           int         `db:"limit_count" json:"limit"`
	WindowSeconds   int         `db:"window_seconds" json:"window_seconds"`
	BurstCapacity   int         `db:"burst_capacity" json:"burst_capacity"`
	RefillRate      float64     `db:"refill_rate" json:"refill_rate"`
	RequestCost     int         `db:"request_cost" json:"request_cost"`
	KeyPattern      string      `db:"key_pattern" json:"key_pattern"`
	FailureMode     FailureMode `db:"failure_mode" json:"failure_mode"`
	Dimensions      StringArray `db:"dimensions" json:"dimensions"`
	IsActive        bool        `db:"is_active" json:"is_active"`
	CreatedAt       time.Time   `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time   `db:"updated_at" json:"updated_at"`
	DeletedAt       *time.Time  `db:"deleted_at" json:"deleted_at,omitempty"`
}

// ============================================================
// Gateway Instances
// ============================================================

type GatewayInstance struct {
	ID               uuid.UUID `db:"id" json:"id"`
	Hostname         string    `db:"hostname" json:"hostname"`
	IPAddress        string    `db:"ip_address" json:"ip_address"`
	Port             int       `db:"port" json:"port"`
	Version          string    `db:"version" json:"version"`
	ConfigVersion    int64     `db:"config_version" json:"config_version"`
	Status           string    `db:"status" json:"status"`
	LastHeartbeatAt  time.Time `db:"last_heartbeat_at" json:"last_heartbeat_at"`
	StartedAt        time.Time `db:"started_at" json:"started_at"`
	CreatedAt        time.Time `db:"created_at" json:"created_at"`
	UpdatedAt        time.Time `db:"updated_at" json:"updated_at"`
}

// ============================================================
// Audit Logs
// ============================================================

type AuditLog struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	UserID      *uuid.UUID `db:"user_id" json:"user_id,omitempty"`
	TenantID    *uuid.UUID `db:"tenant_id" json:"tenant_id,omitempty"`
	Action      string     `db:"action" json:"action"`
	Resource    string     `db:"resource" json:"resource"`
	ResourceID  string     `db:"resource_id" json:"resource_id"`
	IPAddress   string     `db:"ip_address" json:"ip_address"`
	UserAgent   string     `db:"user_agent" json:"user_agent"`
	Changes     JSONB      `db:"changes" json:"changes,omitempty"`
	Status      string     `db:"status" json:"status"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
}

// ============================================================
// Custom DB types
// ============================================================

// JSONB and StringArray are defined in types.go

// ============================================================
// API Request / Response DTOs
// ============================================================

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

type LoginResponse struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	User         UserInfo  `json:"user"`
}

type UserInfo struct {
	ID       uuid.UUID `json:"id"`
	Email    string    `json:"email"`
	Role     Role      `json:"role"`
	TenantID *uuid.UUID `json:"tenant_id,omitempty"`
}

type PaginatedResponse[T any] struct {
	Data       []T   `json:"data"`
	Total      int64 `json:"total"`
	Page       int   `json:"page"`
	PageSize   int   `json:"page_size"`
	TotalPages int   `json:"total_pages"`
}

type ErrorResponse struct {
	Type     string            `json:"type"`
	Title    string            `json:"title"`
	Status   int               `json:"status"`
	Detail   string            `json:"detail,omitempty"`
	Instance string            `json:"instance,omitempty"`
	Errors   map[string]string `json:"errors,omitempty"`
}

type RateLimitHeaders struct {
	Limit     int       `json:"limit"`
	Remaining int       `json:"remaining"`
	Reset     time.Time `json:"reset"`
	RetryAfter int      `json:"retry_after,omitempty"`
	Policy    string    `json:"policy"`
	Algorithm string    `json:"algorithm"`
}

type DashboardSummary struct {
	TotalRequests   int64   `json:"total_requests"`
	RequestsPerSec  float64 `json:"requests_per_sec"`
	AllowedRequests int64   `json:"allowed_requests"`
	RejectedRequests int64  `json:"rejected_requests"`
	RejectionRate   float64 `json:"rejection_rate"`
	P50Latency      float64 `json:"p50_latency_ms"`
	P95Latency      float64 `json:"p95_latency_ms"`
	P99Latency      float64 `json:"p99_latency_ms"`
	ErrorRate       float64 `json:"error_rate"`
	ActiveInstances int     `json:"active_instances"`
	RedisHealthy    bool    `json:"redis_healthy"`
	BackendHealthy  bool    `json:"backend_healthy"`
}

type SystemMetricsSummary struct {
	TotalRequests              int64   `json:"total_requests"`
	AllowedRequests            int64   `json:"allowed_requests"`
	BlockedRequests            int64   `json:"blocked_requests"`
	ErrorRequests              int64   `json:"error_requests"`
	CurrentRPS                 float64 `json:"current_rps"`
	P50LatencyMS               float64 `json:"p50_latency_ms"`
	P95LatencyMS               float64 `json:"p95_latency_ms"`
	P99LatencyMS               float64 `json:"p99_latency_ms"`
	RedisStatus                string  `json:"redis_status"`
	RedisMemoryUsedMB          float64 `json:"redis_memory_used_mb"`
	RedisConnectedClients      int     `json:"redis_connected_clients"`
	ActivePoliciesCount        int     `json:"active_policies_count"`
	ActiveRoutesCount          int     `json:"active_routes_count"`
	CircuitBreakerTrippedCount int     `json:"circuit_breaker_tripped_count"`
	UptimeSeconds              int64   `json:"uptime_seconds"`
}

