# RateShield API Reference & Specification

## Data Plane (`:8080`)

All proxy traffic flows through the data plane at port `8080`.

### Standard Response Headers

Every forwarded or rejected request contains standard rate-limiting headers:

| Header | Description | Example |
|---|---|---|
| `X-RateLimit-Limit` | Maximum allowed quota in current window | `100` |
| `X-RateLimit-Remaining` | Remaining request quota in current window | `84` |
| `X-RateLimit-Reset` | Seconds until quota bucket replenishes | `42` |
| `Retry-After` | (Only on 429) Wait time in seconds before retry | `5` |

### Health Endpoints

- `GET /healthz` — Gateway liveness probe (returns 200 OK)
- `GET /readyz` — Gateway readiness probe (verifies database & Redis connectivity)

---

## Control Plane REST API (`:8081`)

Base URL: `http://localhost:8081/api/v1`

### Authentication
- `POST /auth/login` — Authenticate and receive RS256 JWT access and refresh tokens.
  ```json
  { "email": "admin@example.com", "password": "Admin123!" }
  ```
- `POST /auth/refresh` — Refresh expired access token.

### Rate Limit Policies
- `GET /policies` — List all configured policies.
- `POST /policies` — Create new policy.
- `GET /policies/{id}` — Get policy by ID.
- `PUT /policies/{id}` — Update policy parameters.
- `DELETE /policies/{id}` — Delete policy.

### Gateway Routes
- `GET /routes` — List all route rules.
- `POST /routes` — Register new route.
- `PUT /routes/{id}` — Update route.
- `DELETE /routes/{id}` — Delete route.

### Upstream Backends
- `GET /backends` — List upstream services.
- `POST /backends` — Register new upstream target pool.
- `DELETE /backends/{id}` — Delete upstream service.

### Multi-Tenancy & API Keys
- `GET /tenants` — List tenants.
- `POST /tenants` — Create tenant.
- `GET /api-keys` — List issued API keys.
- `POST /api-keys` — Generate cryptographically secure API key.
- `DELETE /api-keys/{id}` — Revoke API key.

### Telemetry & Admin
- `GET /metrics/summary` — JSON high-level metrics summary.
- `GET /stream/metrics` (or `/events`) — Server-Sent Events (SSE) live telemetry feed.
- `POST /admin/reload` — Zero-downtime hot reload of gateway route and policy tables.
- `GET /audit-logs` — Immutable audit log trail.
