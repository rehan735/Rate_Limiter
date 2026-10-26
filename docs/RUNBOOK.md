# RateShield Operations Runbook & Troubleshooting

## 1. Quick Start / Running the Stack

```bash
# Clone and enter workspace
cd /path/to/Rate_limiter

# Start the full stack (PostgreSQL, Redis, Gateway, Frontend, Prometheus, Grafana, Jaeger, Mocks)
docker compose up --build -d

# Verify all containers are healthy
docker compose ps
```

Before starting, create `.env` from `.env.example` and replace `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, and `GRAFANA_PASSWORD`. Compose requires them. For production, use persistent JWT keys, configure trusted proxy CIDRs, and allow only the private backend CIDRs the gateway needs.

### Port Mappings
| Service | Host Port | Protocol | Purpose |
|---|---|---|---|
| **RateShield Gateway** | `8080` | HTTP | Data Plane Reverse Proxy & Rate Limiter |
| **Control Plane API** | `8081` | HTTP | Management REST API |
| **Control Plane Dashboard**| `3000` | HTTP | Web UI Dashboard |
| **Prometheus** | `9091` | HTTP | Prometheus UI; gateway scrape port stays internal |
| **Grafana** | `3001` | HTTP | Dashboards; password is `GRAFANA_PASSWORD` |
| **Jaeger UI** | `16686` | HTTP | Distributed Tracing UI |
| **Redis** | `6379` | TCP | Cluster Rate Counter Storage |
| **PostgreSQL** | `5432` | TCP | Relational Persistent Config |

---

## 2. Zero-Downtime Hot Reload

To push updated routing tables or rate-limiting rules without dropping active in-flight TCP connections:

```bash
TOKEN=$(curl -sS -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<ADMIN_PASSWORD>"}' \
  http://localhost:8081/api/v1/auth/login | jq -r .access_token)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8081/api/v1/admin/reload
```

---

## 3. Disaster Recovery & Redis Outage Runbook

### Symptom: Redis Cluster Offline or Unreachable
- **Behavior with `fail_open` (Default)**: Gateway logs Redis failure warning at level `WARN`, increments `ratelimit_infra_errors_total` metric, and permits traffic through to protect business availability.
- **Behavior with `local_fallback`**: Gateway falls back immediately to in-memory local token buckets, maintaining rate limiting at the instance level.
- **Behavior with `fail_closed`**: Gateway immediately returns HTTP 429/500 to protect backends from potential DDoS.

### Recommended Recovery Action
1. Inspect Redis logs:
   ```bash
   docker logs rl_redis --tail 100
   ```
2. Verify Redis memory limit:
   ```bash
   docker exec -it rl_redis redis-cli info memory
   ```
3. If Redis reached `maxmemory`:
   Ensure `maxmemory-policy allkeys-lru` is enabled so expired ephemeral rate counter keys are evicted.

---

## 4. Key Prometheus Alert Rules

- **High Rate of 429s Spike**:
  ```promql
  sum(rate(rate_limit_rejected_total[5m])) / sum(rate(gateway_requests_total[5m])) > 0.35
  ```
- **Redis Lua Latency Degradation**:
  ```promql
  histogram_quantile(0.99, sum(rate(ratelimit_evaluation_duration_seconds_bucket[5m])) by (le)) > 0.010
  ```
- **Circuit Breaker Tripped**:
  ```promql
  sum(gateway_circuit_breakers_tripped_total) > 0
  ```
