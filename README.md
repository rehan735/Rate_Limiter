# RateShield: High-Performance Distributed Rate Limiter & API Gateway

[![Go Version](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat&logo=go)](https://golang.org)
[![Redis](https://img.shields.io/badge/Redis-7.0-DC382D?style=flat&logo=redis)](https://redis.io)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?style=flat&logo=prometheus)](https://prometheus.io)
[![Grafana](https://img.shields.io/badge/Grafana-Dashboards-F46800?style=flat&logo=grafana)](https://grafana.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat&logo=docker)](https://docker.com)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**RateShield** is a distributed rate limiter and API gateway for microservice systems. It uses Go, Redis Lua scripts, PostgreSQL, React, and OpenTelemetry to provide quota enforcement, tenant-aware control-plane operations, and reverse proxying.

---

## 🌟 Key Architectural Features

### 1. Distributed Rate Limiting
- Redis Lua scripts evaluate global quotas atomically across gateway replicas.
- **Configurable Fallback**: Choose between `fail_open` (availability first), `fail_closed` (strict security), or `local_fallback` (seamless in-memory degradation during Redis outages).

### 2. Four Pluggable Rate-Limiting Algorithms
- **Token Bucket**: Burstable capacity with steady refill; ideal for user-facing REST APIs.
- **Sliding Window Counter**: Smooth rate interpolation eliminating boundary double-spike flaws with minimal memory.
- **Sliding Window Log**: Exact millisecond precision via Redis Sorted Sets; ideal for payments and sensitive credentials.
- **Fixed Window Counter**: Ultra-lightweight atomic counters for brute-force mitigation on authentication endpoints.

### 3. Resilient API Gateway Data Plane
- **Reverse Proxy**: Dynamic path matching (glob/prefix), header injection, prefix stripping, and connection pooling.
- **Load Balancing**: Backend selection with active health checks.
- **Circuit Breaker**: Automatic tripping on failure rate thresholds with fast-fail `503 Service Unavailable` responses to prevent cascading outages.
- **Zero-Downtime Reload**: Atomic configuration reload (`/api/v1/admin/reload`) with zero connection drops.

### 4. Rich Observability & Control Plane Dashboard
- **Web UI Dashboard**: Modern dark-mode glassmorphic interface with real-time Recharts visualizations, visual policy builder, route manager, API key manager, and an interactive **Live Token Bucket Sandbox Simulator**.
- **Metrics & Tracing**: Prometheus metrics exporter (`:9090`), provisioned Grafana dashboards (`:3001`), and Jaeger tracing (`:16686`).

---

## 🏗️ System Architecture

```text
Client Request
      |
      v
RateShield Gateway (:8080) ---> Redis Lua rate limiter
      |
      v
Circuit breaker and backend selection
      |
      +---- User service (:9001)
      +---- Order service (:9002)
      +---- Payment service (:9003)

Control plane API (:8081) ---> PostgreSQL (:5432)
Dashboard (:3000) ---> Control plane API
Prometheus, Grafana, and Jaeger provide observability
```
---

## 🚀 Quick Start

### 1. Launch the Complete Stack with Docker Compose
```bash
# Clone the repository
git clone https://github.com/rate-limiter/gateway.git
cd gateway

# Start all services (PostgreSQL, Redis, Gateway, Frontend, Prometheus, Grafana, Jaeger, Mocks)
docker compose up --build -d
```

Set `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, and `GRAFANA_PASSWORD` in `.env` before starting Compose. Local Compose explicitly enables ephemeral JWT keys and private Docker-network backends; do not reuse those settings in production. Production must mount a persistent matching JWT key pair, keep `JWT_ALLOW_EPHEMERAL=false`, set `GATEWAY_TRUSTED_PROXIES` to the actual proxy CIDRs, and list only required internal upstream networks in `GATEWAY_BACKEND_ALLOWED_CIDRS`. Forwarded client IP headers are ignored unless the immediate peer is trusted.

### 2. Access the Interfaces
- **Gateway Data Plane**: [http://localhost:8080](http://localhost:8080)
- **Control Plane Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Control Plane API**: [http://localhost:8081](http://localhost:8081)
- **Grafana Monitoring**: [http://localhost:3001](http://localhost:3001) (User: `admin`, password from `GRAFANA_PASSWORD`)
- **Prometheus Metrics**: [http://localhost:9091](http://localhost:9091)
- **Jaeger Tracing**: [http://localhost:16686](http://localhost:16686)

### 3. Verify Proxying & Rate Limiting
```bash
# Send test requests through the gateway
curl -i http://localhost:8080/api/v1/users/profile

# Response Headers:
# HTTP/1.1 200 OK
# X-RateLimit-Limit: 60
# X-RateLimit-Remaining: 59
# X-RateLimit-Reset: 58
```

### 4. Hot Config Reload
```bash
TOKEN=$(curl -sS -H 'Content-Type: application/json' \\
  -d '{"email":"admin@example.com","password":"<ADMIN_PASSWORD>"}' \\
  http://localhost:8081/api/v1/auth/login | jq -r .access_token)
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8081/api/v1/admin/reload
```

---

## ⚡ Load Testing

The k6 scenarios and run instructions are in [load-tests/README.md](load-tests/README.md). This repository does not contain reproducible measurement output, so no benchmark results are claimed.

---

## 📁 Repository Structure

```
├── backend/                  # Go Gateway & Control Plane Service
│   ├── cmd/gateway/main.go   # Primary binary entrypoint
│   ├── internal/
│   │   ├── auth/             # RS256 JWT & Argon2id service
│   │   ├── config/           # Environment & YAML configurations
│   │   ├── controlplane/     # Management REST API & SSE streaming
│   │   ├── gateway/          # Reverse proxy, route matcher & load balancer
│   │   ├── middleware/       # Correlation ID, logger & security middleware
│   │   ├── models/           # Domain entities & database schemas
│   │   ├── observability/    # Prometheus metrics & OpenTelemetry
│   │   ├── ratelimiter/      # Token bucket, sliding window, & local limiters
│   │   └── storage/          # PostgreSQL store repositories
│   ├── migrations/           # SQL migration files
│   └── tests/                # Unit & Integration tests
├── frontend/                 # React 18 / TypeScript / Tailwind CSS Dashboard
│   ├── src/
│   │   ├── components/       # Reusable layout & glassmorphism components
│   │   ├── pages/            # Dashboard, Sandbox, Policies, Routes, Keys
│   │   ├── services/         # Axios API & mock fallback engine
│   │   └── types/            # TypeScript data contracts
│   └── Dockerfile            # Multi-stage production Nginx image
├── services/                 # Upstream Mock Microservices
│   ├── mock-user-service/    # User service with chaos injection (:9001)
│   ├── mock-order-service/   # Order service with chaos injection (:9002)
│   └── mock-payment-service/ # Payment service with chaos injection (:9003)
├── deploy/
│   ├── grafana/              # Pre-provisioned dashboards & datasources
│   ├── prometheus/           # Scrape target configurations
├── load-tests/               # k6 benchmark suite & scenario scripts
├── docs/                     # Technical documentation & runbooks
├── docker-compose.yml        # Multi-container local orchestration
└── README.md
```

---

## 📜 Documentation Index

- [Architecture & Data Flow Details](docs/ARCHITECTURE.md)
- [Rate Limiting Algorithms & Lua Deep Dive](docs/RATE_LIMITING_ALGORITHMS.md)
- [Complete API Reference](docs/API_REFERENCE.md)
- [Operations Runbook & Troubleshooting](docs/RUNBOOK.md)
- [Load Testing & Benchmark Reproduction](load-tests/README.md)

---

## 📄 License
This project is licensed under the Apache 2.0 License.
