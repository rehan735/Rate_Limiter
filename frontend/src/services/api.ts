import axios from 'axios'
import {
  RateLimitPolicy,
  BackendService,
  Route,
  ApiKey,
  Tenant,
  SystemMetricsSummary,
  AuditLogEntry,
  SandboxRequestConfig,
  SandboxResponseResult
} from '../types/api'
import {
  INITIAL_POLICIES,
  INITIAL_BACKENDS,
  INITIAL_ROUTES,
  INITIAL_API_KEYS,
  INITIAL_TENANTS,
  INITIAL_METRICS_SUMMARY,
  INITIAL_AUDIT_LOGS
} from './mockData'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || '/gateway'
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

const getErrorMessage = (error: unknown, fallback: string): string => {
  const err = error as { response?: { data?: { detail?: string; message?: string; error?: string } }; message?: string }
  return err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error || err.message || fallback
}

const TOKEN_KEY = 'rateshield_access_token'
const USER_KEY = 'rateshield_user'

let accessToken: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
})()

const client = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json'
  }
})

const rows = <T,>(response: { data: { data?: T[]; items?: T[] } | T[] }): T[] => {
  const body = response.data
  if (Array.isArray(body)) return body
  return body.data ?? body.items ?? []
}

const toBackend = (value: BackendService) => ({
  name: value.name,
  targets: value.targets.map(target => /^https?:\/\//i.test(target) ? target : `${value.scheme}://${target}`),
  health_check_path: value.health_check_path,
  connect_timeout: value.timeout_ms * 1_000_000,
  response_timeout: value.timeout_ms * 1_000_000,
  load_balancing_policy: 'round_robin',
  max_retries: 0,
  retry_on: [],
  is_active: true
})

const fromBackend = (raw: Record<string, unknown>): BackendService => {
  const targets = (raw.targets as string[] | undefined) ?? []
  return {
    id: String(raw.id ?? ''), name: String(raw.name ?? ''), targets,
    scheme: targets[0]?.startsWith('https://') ? 'https' : 'http',
    health_check_path: String(raw.health_check_path ?? '/healthz'),
    timeout_ms: Number(raw.response_timeout ?? 30_000_000_000) / 1_000_000,
    max_conns: 0,
    circuit_breaker_enabled: true,
    created_at: String(raw.created_at ?? '')
  }
}

const toRoute = (value: Partial<Route>) => {
  const pattern = value.path_pattern ?? ''
  const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : ''
  return {
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(value.path_pattern !== undefined ? { path_prefix: prefix, exact_path: prefix ? '' : pattern } : {}),
    ...(value.methods !== undefined ? { methods: value.methods } : {}),
    ...(value.backend_id !== undefined ? { backend_id: value.backend_id } : {}),
    ...(value.policy_id !== undefined ? { policy_id: value.policy_id || null } : {}),
    ...(value.strip_prefix !== undefined ? { strip_prefix: value.strip_prefix } : {}),
    ...(value.active !== undefined ? { is_active: value.active } : {})
  }
}

const fromRoute = (raw: Record<string, unknown>): Route => {
  const prefix = String(raw.path_prefix ?? '')
  const exact = String(raw.exact_path ?? '')
  return {
    id: String(raw.id ?? ''), name: String(raw.name ?? ''),
    path_pattern: exact || (prefix ? `${prefix}*` : ''),
    methods: (raw.methods as string[] | undefined) ?? [],
    backend_id: String(raw.backend_id ?? ''), policy_id: String(raw.policy_id ?? ''),
    strip_prefix: Boolean(raw.strip_prefix), active: Boolean(raw.is_active), cors_enabled: false,
    created_at: String(raw.created_at ?? '')
  }
}

client.interceptors.request.use(config => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

// Store locally for fallback if backend is unreachable
class StorageCache {
  private static getKey<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(`rateshield_${key}`)
      return item ? JSON.parse(item) : defaultValue
    } catch {
      return defaultValue
    }
  }

  private static setKey<T>(key: string, val: T): void {
    try {
      localStorage.setItem(`rateshield_${key}`, JSON.stringify(val))
    } catch {
      // ignore
    }
  }

  static getPolicies(): RateLimitPolicy[] {
    return this.getKey('policies', INITIAL_POLICIES)
  }
  static setPolicies(val: RateLimitPolicy[]): void {
    this.setKey('policies', val)
  }

  static getBackends(): BackendService[] {
    return this.getKey('backends', INITIAL_BACKENDS)
  }
  static setBackends(val: BackendService[]): void {
    this.setKey('backends', val)
  }

  static getRoutes(): Route[] {
    return this.getKey('routes', INITIAL_ROUTES)
  }
  static setRoutes(val: Route[]): void {
    this.setKey('routes', val)
  }

  static getApiKeys(): ApiKey[] {
    return this.getKey('api_keys', INITIAL_API_KEYS)
  }
  static setApiKeys(val: ApiKey[]): void {
    this.setKey('api_keys', val)
  }

  static getTenants(): Tenant[] {
    return this.getKey('tenants', INITIAL_TENANTS)
  }
  static setTenants(val: Tenant[]): void {
    this.setKey('tenants', val)
  }

  static getAuditLogs(): AuditLogEntry[] {
    return this.getKey('audit_logs', INITIAL_AUDIT_LOGS)
  }
  static addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    const list = this.getAuditLogs()
    list.unshift({
      ...entry,
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString()
    })
    this.setKey('audit_logs', list.slice(0, 100))
  }
}

export const apiService = {
  isAuthenticated(): boolean {
    if (accessToken) return true
    try {
      const stored = localStorage.getItem(TOKEN_KEY)
      if (stored) {
        accessToken = stored
        return true
      }
    } catch {
      // ignore
    }
    return false
  },

  getCurrentUser(): { email: string; name: string; role: string; mode?: string } {
    try {
      const raw = localStorage.getItem(USER_KEY)
      if (raw) return JSON.parse(raw)
    } catch {
      // ignore
    }
    return { email: 'admin@example.com', name: 'Lead Architect', role: 'ADMIN' }
  },

  async login(email: string, password: string): Promise<{ access_token: string; user?: unknown }> {
    const cleanEmail = email.trim()
    try {
      const response = await client.post('/auth/login', { email: cleanEmail, password })
      accessToken = response.data.access_token || response.data.token || 'gateway-session-token'
      try {
        localStorage.setItem(TOKEN_KEY, accessToken!)
        const user = response.data.user || {
          email: cleanEmail,
          name: cleanEmail.split('@')[0],
          role: 'ADMIN'
        }
        localStorage.setItem(USER_KEY, JSON.stringify(user))
      } catch {
        // ignore storage error
      }
      return response.data
    } catch (networkOrAuthErr: unknown) {
      // Check if backend returned 401 or 403 explicitly
      const err = networkOrAuthErr as { response?: { status: number; data?: { message?: string; error?: string; detail?: string } } }
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        throw new Error(err.response.data?.detail || err.response.data?.message || err.response.data?.error || 'Invalid email or password.')
      }

      // Explicit Demo Mode fallback only
      if (DEMO_MODE) {
        const dummyToken = `demo_token_${btoa(cleanEmail || 'admin')}_${Date.now()}`
        accessToken = dummyToken
        const mockUser = {
          email: cleanEmail || 'admin@example.com',
          name: cleanEmail ? cleanEmail.split('@')[0] : 'admin',
          role: 'ADMIN',
          mode: 'demo_mode'
        }
        try {
          localStorage.setItem(TOKEN_KEY, dummyToken)
          localStorage.setItem(USER_KEY, JSON.stringify(mockUser))
          StorageCache.addAuditLog({
            actor: cleanEmail || 'admin@example.com',
            action: 'LOGIN',
            resource_type: 'Session',
            resource_id: 'session',
            details: 'Signed in via RateShield Console (Demo Mode)',
            ip_address: '127.0.0.1'
          })
        } catch {
          // ignore storage error
        }
        return { access_token: dummyToken, user: mockUser }
      }

      throw new Error(
        err.response?.data?.detail ||
        err.response?.data?.message ||
        'Unable to connect to RateShield backend API. Please verify the backend service is running.'
      )
    }
  },

  logout(): void {
    accessToken = null
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    } catch {
      // ignore
    }
  },
  // Policies
  async getPolicies(): Promise<RateLimitPolicy[]> {
    try {
      const res = await client.get('/policies')
      return res.data?.data || res.data?.items || res.data || []
    } catch (error) {
      if (DEMO_MODE) {
        return StorageCache.getPolicies()
      }
      throw new Error(getErrorMessage(error, 'Failed to fetch policies from server'))
    }
  },

  async createPolicy(policy: Omit<RateLimitPolicy, 'id'>): Promise<RateLimitPolicy> {
    try {
      const res = await client.post('/policies', policy)
      return res.data
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getPolicies()
        const newPolicy: RateLimitPolicy = {
          ...policy,
          id: `pol-${Date.now()}`,
          created_at: new Date().toISOString()
        }
        list.push(newPolicy)
        StorageCache.setPolicies(list)
        StorageCache.addAuditLog({
          actor: 'admin@example.com',
          action: 'POLICY_CREATE',
          resource_type: 'RateLimitPolicy',
          resource_id: newPolicy.id,
          details: `Created policy ${newPolicy.name} with algorithm ${newPolicy.algorithm}`,
          ip_address: '127.0.0.1'
        })
        return newPolicy
      }
      throw new Error(getErrorMessage(error, 'Failed to create policy on server'))
    }
  },

  async updatePolicy(id: string, updates: Partial<RateLimitPolicy>): Promise<RateLimitPolicy> {
    try {
      const res = await client.put(`/policies/${id}`, updates)
      return res.data
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getPolicies()
        const idx = list.findIndex(p => p.id === id)
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...updates, updated_at: new Date().toISOString() }
          StorageCache.setPolicies(list)
          StorageCache.addAuditLog({
            actor: 'admin@example.com',
            action: 'POLICY_UPDATE',
            resource_type: 'RateLimitPolicy',
            resource_id: id,
            details: `Updated policy parameters: limit=${list[idx].limit}, burst=${list[idx].burst_capacity}`,
            ip_address: '127.0.0.1'
          })
          return list[idx]
        }
        throw new Error('Policy not found')
      }
      throw new Error(getErrorMessage(error, 'Failed to update policy on server'))
    }
  },

  async deletePolicy(id: string): Promise<void> {
    try {
      await client.delete(`/policies/${id}`)
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getPolicies().filter(p => p.id !== id)
        StorageCache.setPolicies(list)
        StorageCache.addAuditLog({
          actor: 'admin@example.com',
          action: 'POLICY_DELETE',
          resource_type: 'RateLimitPolicy',
          resource_id: id,
          details: `Deleted policy ID ${id}`,
          ip_address: '127.0.0.1'
        })
        return
      }
      throw new Error(getErrorMessage(error, 'Failed to delete policy on server'))
    }
  },

  // Routes
  async getRoutes(): Promise<Route[]> {
    try {
      const res = await client.get('/routes')
      return rows<Record<string, unknown>>(res).map(fromRoute)
    } catch (error) {
      if (DEMO_MODE) {
        return StorageCache.getRoutes()
      }
      throw new Error(getErrorMessage(error, 'Failed to fetch routes from server'))
    }
  },

  async createRoute(route: Omit<Route, 'id'>): Promise<Route> {
    try {
      const res = await client.post('/routes', toRoute(route))
      return fromRoute(res.data)
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getRoutes()
        const newRoute: Route = {
          ...route,
          id: `route-${Date.now()}`,
          created_at: new Date().toISOString()
        }
        list.push(newRoute)
        StorageCache.setRoutes(list)
        StorageCache.addAuditLog({
          actor: 'admin@example.com',
          action: 'ROUTE_CREATE',
          resource_type: 'Route',
          resource_id: newRoute.id,
          details: `Created route ${newRoute.path_pattern} -> backend ${newRoute.backend_name || newRoute.backend_id}`,
          ip_address: '127.0.0.1'
        })
        return newRoute
      }
      throw new Error(getErrorMessage(error, 'Failed to create route on server'))
    }
  },

  async updateRoute(id: string, updates: Partial<Route>): Promise<Route> {
    try {
      const res = await client.put(`/routes/${id}`, toRoute(updates))
      return fromRoute(res.data)
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getRoutes()
        const idx = list.findIndex(r => r.id === id)
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...updates }
          StorageCache.setRoutes(list)
          return list[idx]
        }
        throw new Error('Route not found')
      }
      throw new Error(getErrorMessage(error, 'Failed to update route on server'))
    }
  },

  async deleteRoute(id: string): Promise<void> {
    try {
      await client.delete(`/routes/${id}`)
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getRoutes().filter(r => r.id !== id)
        StorageCache.setRoutes(list)
        StorageCache.addAuditLog({
          actor: 'admin@example.com',
          action: 'ROUTE_DELETE',
          resource_type: 'Route',
          resource_id: id,
          details: `Deleted route ${id}`,
          ip_address: '127.0.0.1'
        })
        return
      }
      throw new Error(getErrorMessage(error, 'Failed to delete route on server'))
    }
  },

  // Backends
  async getBackends(): Promise<BackendService[]> {
    try {
      const res = await client.get('/backends')
      return rows<Record<string, unknown>>(res).map(fromBackend)
    } catch (error) {
      if (DEMO_MODE) {
        return StorageCache.getBackends()
      }
      throw new Error(getErrorMessage(error, 'Failed to fetch backends from server'))
    }
  },

  async createBackend(backend: Omit<BackendService, 'id'>): Promise<BackendService> {
    try {
      const res = await client.post('/backends', toBackend(backend as BackendService))
      return fromBackend(res.data)
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getBackends()
        const newBackend: BackendService = {
          ...backend,
          id: `backend-${Date.now()}`,
          created_at: new Date().toISOString()
        }
        list.push(newBackend)
        StorageCache.setBackends(list)
        return newBackend
      }
      throw new Error(getErrorMessage(error, 'Failed to create backend on server'))
    }
  },

  async deleteBackend(id: string): Promise<void> {
    try {
      await client.delete(`/backends/${id}`)
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getBackends().filter(b => b.id !== id)
        StorageCache.setBackends(list)
        return
      }
      throw new Error(getErrorMessage(error, 'Failed to delete backend on server'))
    }
  },

  // API Keys
  async getApiKeys(): Promise<ApiKey[]> {
    try {
      const res = await client.get('/api-keys')
      return rows<Record<string, unknown>>(res).map(raw => ({
        id: String(raw.id ?? ''), name: String(raw.name ?? ''), key_prefix: String(raw.key_prefix ?? ''),
        tenant_id: String(raw.tenant_id ?? ''), tenant_name: String(raw.tenant_name ?? ''),
        expires_at: raw.expires_at ? String(raw.expires_at) : undefined,
        revoked: Boolean(raw.revoked_at), created_at: String(raw.created_at ?? '')
      }))
    } catch (error) {
      if (DEMO_MODE) {
        return StorageCache.getApiKeys()
      }
      throw new Error(getErrorMessage(error, 'Failed to fetch API keys from server'))
    }
  },

  async createApiKey(keyData: { name: string; tenant_id: string; role?: 'admin' | 'write' | 'read' }): Promise<{ apiKey: ApiKey; secretKey: string }> {
    try {
      const res = await client.post('/api-keys', { name: keyData.name, tenant_id: keyData.tenant_id })
      const { secret, ...key } = res.data
      return { apiKey: key as ApiKey, secretKey: secret }
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getApiKeys()
        const secret = `rs_live_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`
        const newKey: ApiKey = {
          id: `key-${Date.now()}`,
          name: keyData.name,
          key_prefix: secret.substring(0, 10) + '...',
          tenant_id: keyData.tenant_id,
          tenant_name: StorageCache.getTenants().find(t => t.id === keyData.tenant_id)?.name || 'Default Tenant',
          role: keyData.role ?? 'read',
          revoked: false,
          created_at: new Date().toISOString()
        }
        list.push(newKey)
        StorageCache.setApiKeys(list)
        StorageCache.addAuditLog({
          actor: 'admin@example.com',
          action: 'API_KEY_CREATE',
          resource_type: 'ApiKey',
          resource_id: newKey.id,
          details: `Issued new API Key: ${newKey.name} (${newKey.role})`,
          ip_address: '127.0.0.1'
        })
        return { apiKey: newKey, secretKey: secret }
      }
      throw new Error(getErrorMessage(error, 'Failed to create API key on server'))
    }
  },

  async revokeApiKey(id: string): Promise<void> {
    try {
      await client.delete(`/api-keys/${id}`)
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getApiKeys()
        const key = list.find(k => k.id === id)
        if (key) {
          key.revoked = true
          StorageCache.setApiKeys(list)
          StorageCache.addAuditLog({
            actor: 'admin@example.com',
            action: 'API_KEY_REVOKE',
            resource_type: 'ApiKey',
            resource_id: id,
            details: `Revoked key ${key.name}`,
            ip_address: '127.0.0.1'
          })
        }
        return
      }
      throw new Error(getErrorMessage(error, 'Failed to revoke API key on server'))
    }
  },

  // Tenants
  async getTenants(): Promise<Tenant[]> {
    try {
      const res = await client.get('/tenants')
      return rows<Record<string, unknown>>(res).map(raw => ({
        id: String(raw.id ?? ''), name: String(raw.name ?? ''), slug: String(raw.slug ?? ''),
        active: Boolean(raw.is_active), created_at: String(raw.created_at ?? '')
      }))
    } catch (error) {
      if (DEMO_MODE) {
        return StorageCache.getTenants()
      }
      throw new Error(getErrorMessage(error, 'Failed to fetch tenants from server'))
    }
  },

  async createTenant(tenant: Omit<Tenant, 'id' | 'created_at'>): Promise<Tenant> {
    try {
      const res = await client.post('/tenants', { name: tenant.name, slug: tenant.slug })
      return { id: res.data.id, name: res.data.name, slug: res.data.slug, active: res.data.is_active, created_at: res.data.created_at }
    } catch (error) {
      if (DEMO_MODE) {
        const list = StorageCache.getTenants()
        const newTenant: Tenant = {
          ...tenant,
          id: `tenant-${Date.now()}`,
          created_at: new Date().toISOString()
        }
        list.push(newTenant)
        StorageCache.setTenants(list)
        return newTenant
      }
      throw new Error(getErrorMessage(error, 'Failed to create tenant on server'))
    }
  },

  // Metrics Summary
  async getMetricsSummary(): Promise<SystemMetricsSummary> {
    try {
      const res = await client.get('/metrics/summary')
      return res.data
    } catch (error) {
      if (DEMO_MODE) {
        const base = INITIAL_METRICS_SUMMARY
        const rpsDelta = (Math.random() - 0.45) * 60
        const newRps = Math.max(800, Math.round(base.current_rps + rpsDelta))
        return {
          ...base,
          current_rps: newRps,
          total_requests: base.total_requests + Math.floor(Math.random() * 25),
          allowed_requests: base.allowed_requests + Math.floor(Math.random() * 23),
          blocked_requests: base.blocked_requests + Math.floor(Math.random() * 2),
          p50_latency_ms: +(1.2 + Math.random() * 0.5).toFixed(2),
          p95_latency_ms: +(4.2 + Math.random() * 1.2).toFixed(2),
          p99_latency_ms: +(9.5 + Math.random() * 3.5).toFixed(2)
        }
      }
      throw new Error(getErrorMessage(error, 'Failed to fetch metrics summary from server'))
    }
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLogEntry[]> {
    try {
      const res = await client.get('/audit-logs')
      return res.data?.data || res.data?.items || res.data || []
    } catch (error) {
      if (DEMO_MODE) {
        return StorageCache.getAuditLogs()
      }
      throw new Error(getErrorMessage(error, 'Failed to fetch audit logs from server'))
    }
  },

  // Reload Gateway Config
  async reloadGatewayConfig(): Promise<{ success: boolean; message: string; elapsed_ms: number }> {
    try {
      const res = await client.post('/admin/reload')
      return res.data
    } catch (error) {
      if (DEMO_MODE) {
        StorageCache.addAuditLog({
          actor: 'admin@example.com',
          action: 'GATEWAY_CONFIG_RELOAD',
          resource_type: 'GatewayEngine',
          resource_id: 'cluster-master',
          details: 'Zero-downtime hot reload completed across all proxy workers in 1.1ms',
          ip_address: '127.0.0.1'
        })
        return {
          success: true,
          message: 'Routes, policies, and circuit breaker configurations hot-reloaded successfully.',
          elapsed_ms: 1.15
        }
      }
      throw new Error(getErrorMessage(error, 'Failed to reload gateway configuration on server'))
    }
  },

  // Interactive Sandbox Simulator
  // Sends request through actual gateway or simulates precise token bucket math
  async runSandboxTest(
    config: SandboxRequestConfig,
    policy: RateLimitPolicy,
    onProgress?: (result: SandboxResponseResult) => void
  ): Promise<SandboxResponseResult[]> {
    const results: SandboxResponseResult[] = []
    let currentTokens = policy.burst_capacity > 0 ? policy.burst_capacity : policy.limit
    const limit = policy.limit
    const cost = policy.request_cost || 1

    for (let i = 1; i <= config.burst_count; i++) {
      const startTime = performance.now()
      let statusCode = 200
      let allowed = true
      let remaining = 0
      let retryAfter = 0

      // Try actual gateway fetch if possible
      try {
        const response = await axios({
          method: config.method,
          url: `${GATEWAY_URL}${config.path}`,
          headers: {
            'X-API-Key': config.api_key || '',
            'X-Tenant-ID': config.tenant_id || 'tenant-default',
            'X-Forwarded-For': config.client_ip || '127.0.0.1'
          },
          timeout: 2000,
          validateStatus: () => true // Don't throw on 429
        })

        statusCode = response.status
        allowed = response.status !== 429
        const rlRemaining = response.headers['x-ratelimit-remaining']
        remaining = rlRemaining ? parseInt(rlRemaining, 10) : 0
        const rlRetry = response.headers['retry-after']
        retryAfter = rlRetry ? parseInt(rlRetry, 10) : 0
      } catch (error) {
        if (DEMO_MODE) {
          // Fallback simulation using the exact algorithm math in demo mode
          if (currentTokens >= cost) {
            currentTokens -= cost
            allowed = true
            statusCode = 200
            remaining = currentTokens
          } else {
            allowed = false
            statusCode = 429
            remaining = 0
            retryAfter = Math.ceil(cost / (policy.refill_rate || 1))
          }
        } else {
          statusCode = 503
          allowed = false
          remaining = 0
          retryAfter = 5
        }
      }

      const elapsed = +(performance.now() - startTime).toFixed(1)
      const res: SandboxResponseResult = {
        request_index: i,
        status_code: statusCode,
        allowed,
        latency_ms: Math.max(0.8, elapsed),
        limit,
        remaining,
        reset_in_seconds: 60,
        retry_after: allowed ? undefined : retryAfter,
        timestamp: new Date().toISOString()
      }

      results.push(res)
      if (onProgress) {
        onProgress(res)
      }

      // Small delay between bursts to visualize animation
      await new Promise(r => setTimeout(r, 60))
    }

    return results
  }
}
