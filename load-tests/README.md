# RateShield Load Testing & Benchmarking Suite

This directory contains reproducible performance tests for the **RateShield Distributed Rate Limiter & API Gateway** using [k6](https://k6.io/).

## Scenarios

| Scenario Script | Tested Algorithm / Feature | Key Metrics |
|---|---|---|
| `token_bucket_burst.js` | Token Bucket | Burst absorption, token refill dynamics, 429 threshold |
| `sliding_window_saturation.js` | Sliding Window Counter | High-RPS sustained load, weighted window accuracy |
| `multi_tenant_fairness.js` | Multi-Tenant Isolation | Quota protection, zero cross-tenant noisy neighbor impact |
| `circuit_breaker_trip.js` | Circuit Breaker & Failover | Error threshold trip, fast-fail 503, automatic recovery |

## Prerequisites

- Install `k6` ([k6 installation guide](https://k6.io/docs/get-started/installation/))
  ```bash
  # macOS
  brew install k6
  # Windows
  winget install k6 --source winget
  # Linux
  sudo apt-get install k6
  ```
- RateShield Docker environment running:
  ```bash
  docker compose up -d
  ```

## Running the Benchmarks

### Automated Runner (Bash)
```bash
# Bash
chmod +x ./load-tests/run-benchmarks.sh
./load-tests/run-benchmarks.sh

```

### Option 2: Execute Specific Scenario
```bash
k6 run --env GATEWAY_URL=http://localhost:8080 ./load-tests/k6/scenarios/token_bucket_burst.js
```

## Results

The scenarios are workload scripts, not evidence of measured throughput or latency. Record host specs, configuration, and k6 output before publishing benchmark claims.
