# RateShield Architecture Specification

## 1. System Overview

**RateShield** is a distributed rate limiter and API Gateway designed for microservice ecosystems. It enforces fine-grained quotas, tenant isolation, and circuit breaking across gateway instances.

```
+-------------------------------------------------------------------------+
|                              Client Traffic                             |
+-------------------------------------------------------------------------+
                                     │
                                     ▼
                   +──────────────────────────────────+
                   |  RateShield Gateway Data Plane   |
                   |             (:8080)              |
                   +──────────────────────────────────+
                                     │
                                     │
                                     ▼
                   +---------------------------------------+
                   | Redis Lua Distributed Rate Limiter   |
                   +---------------------------------------+
                                     │
                          (Allowed request)
                                     ▼
                   +──────────────────────────────────+
                   |      Circuit Breaker & Proxy     |
                   |   (Round-Robin Load Balancer)    |
                   +──────────────────────────────────+
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
    +──────────────────+   +──────────────────+   +──────────────────+
    | User Service     |   | Order Service    |   | Payment Service  |
    | (:9001)          |   | (:9002)          |   | (:9003)          |
    +──────────────────+   +──────────────────+   +──────────────────+
```

## 2. Core Subsystems

### 2.1 Gateway Data Plane (`backend/internal/gateway`)
- **Port**: `:8080`
- **Routing Engine**: High-performance routing table supporting prioritized exact matching, glob wildcard matching (e.g. `*`, `?`, `/*`), and prefix matching cached in atomic memory (`sync/atomic` + `RWMutex`).
- **Reverse Proxy**: Optimized `httputil.ReverseProxy` with HTTP connection pooling, configurable idle connection limits, keep-alive, and transport timeouts.
- **Backend Selection**: Chooses healthy targets according to the configured selection policy.
- **Circuit Breaker**: Three-state state machine (CLOSED, OPEN, HALF-OPEN) monitoring rolling error rates per backend target. Trips on error spikes and fast-fails requests with `503 Service Unavailable` without taxing failing upstreams.

### 2.2 Distributed Rate Limiting Engine (`backend/internal/ratelimiter`)
- **Distributed Quota Authority**: Redis Lua scripts evaluate quotas atomically across gateway instances. The gateway does not apply the advertised local pre-filter tier.
- **Supported Algorithms**:
  1. **Token Bucket**: Burstable capacity with steady refill.
  2. **Sliding Window Counter**: Memory-efficient weighted interpolation between previous and current windows.
  3. **Sliding Window Log**: Exact timestamp logging in Redis sorted sets for zero-tolerance operations.
  4. **Fixed Window**: Low-overhead atomic counters with TTL for brute-force mitigation.
- **Failure Resilience**: Configurable fallback modes:
  - `fail_open`: Allows requests through if Redis is temporarily unreachable (availability first).
  - `fail_closed`: Rejects requests on Redis failure (strict protection).
  - `local_fallback`: Degrades to local memory token buckets when Redis connectivity drops.

### 2.3 Control Plane REST API (`backend/internal/controlplane`)
- **Port**: `:8081`
- **Responsibilities**:
  - CRUD operations for Policies, Routes, Upstream Backends, Tenants, API Keys.
  - Zero-downtime hot configuration reload trigger (`/api/v1/admin/reload`).
  - Real-time Server-Sent Events (SSE) telemetry stream (`/api/v1/stream/metrics` and `/api/v1/events`).
  - Immutable audit logging of administrative changes.

### 2.4 Control Plane Dashboard (`frontend`)
- **Port**: `:3000` (Docker) / `:5173` (Vite Dev)
- **Tech Stack**: React 18, TypeScript, Tailwind CSS, Recharts, Lucide Icons.
- **Features**: Live metrics, visual policy builder, route manager, API key manager, and an interactive **Live Token Bucket Sandbox Simulator**.
