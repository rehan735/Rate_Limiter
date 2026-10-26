export type Algorithm = 'token_bucket' | 'fixed_window' | 'sliding_window' | 'sliding_window_log'
export type FailureMode = 'fail_open' | 'fail_closed' | 'local_fallback'

export interface RateLimitPolicy {
  id: string
  name: string
  description?: string
  algorithm: Algorithm
  limit: number
  window_seconds: number
  burst_capacity: number
  refill_rate: number
  request_cost: number
  key_pattern: string
  failure_mode: FailureMode
  dimensions: string[]
  created_at?: string
  updated_at?: string
}

export interface BackendService {
  id: string
  name: string
  scheme: 'http' | 'https'
  targets: string[]
  health_check_path: string
  timeout_ms: number
  max_conns?: number
  circuit_breaker_enabled?: boolean
  failure_threshold_pct?: number
  created_at?: string
}

export interface Route {
  id: string
  name: string
  path_pattern: string
  methods: string[]
  backend_id: string
  backend_name?: string
  policy_id: string
  policy_name?: string
  strip_prefix: boolean
  active?: boolean
  cors_enabled: boolean
  created_at?: string
}

export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  tenant_id: string
  tenant_name?: string
  role?: 'admin' | 'write' | 'read'
  rate_limit_override_id?: string
  expires_at?: string
  revoked: boolean
  created_at: string
}

export interface Tenant {
  id: string
  name: string
  slug: string
  tier?: 'free' | 'pro' | 'enterprise'
  active?: boolean
  max_rps?: number
  created_at: string
}

export interface MetricsDataPoint {
  timestamp: string
  allowed_rps: number
  blocked_rps: number
  latency_p50: number
  latency_p95: number
  latency_p99: number
}

export interface SystemMetricsSummary {
  total_requests: number
  allowed_requests: number
  blocked_requests: number
  error_requests: number
  current_rps: number
  p50_latency_ms: number
  p95_latency_ms: number
  p99_latency_ms: number
  redis_status: 'healthy' | 'degraded' | 'offline' | 'unknown'
  redis_memory_used_mb: number
  redis_connected_clients: number
  active_policies_count: number
  active_routes_count: number
  circuit_breaker_tripped_count: number
  uptime_seconds: number
}

export interface AuditLogEntry {
  id: string
  timestamp: string
  actor: string
  action: string
  resource_type: string
  resource_id: string
  details: string
  ip_address: string
}

export interface SandboxRequestConfig {
  method: string
  path: string
  tenant_id?: string
  api_key?: string
  client_ip?: string
  burst_count: number
  concurrency: number
}

export interface SandboxResponseResult {
  request_index: number
  status_code: number
  allowed: boolean
  latency_ms: number
  limit: number
  remaining: number
  reset_in_seconds: number
  retry_after?: number
  timestamp: string
}
