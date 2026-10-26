#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# RateShield Benchmark Suite Runner
# =============================================================================

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
OUTPUT_DIR="$(dirname "$0")/results"
mkdir -p "${OUTPUT_DIR}"

echo "=========================================================="
echo " Starting RateShield Gateway Load Test Suite"
echo " Target Gateway: ${GATEWAY_URL}"
echo "=========================================================="

echo "[1/4] Running Token Bucket Burst Saturation Scenario..."
k6 run --env GATEWAY_URL="${GATEWAY_URL}" \
  --summary-export="${OUTPUT_DIR}/token_bucket_results.json" \
  "$(dirname "$0")/k6/scenarios/token_bucket_burst.js"

echo "[2/4] Running Sliding Window Counter Saturation Scenario..."
k6 run --env GATEWAY_URL="${GATEWAY_URL}" \
  --summary-export="${OUTPUT_DIR}/sliding_window_results.json" \
  "$(dirname "$0")/k6/scenarios/sliding_window_saturation.js"

echo "[3/4] Running Multi-Tenant Fairness Scenario..."
k6 run --env GATEWAY_URL="${GATEWAY_URL}" \
  --summary-export="${OUTPUT_DIR}/multi_tenant_results.json" \
  "$(dirname "$0")/k6/scenarios/multi_tenant_fairness.js"

echo "[4/4] Running Circuit Breaker Trip Scenario..."
k6 run --env GATEWAY_URL="${GATEWAY_URL}" \
  --summary-export="${OUTPUT_DIR}/circuit_breaker_results.json" \
  "$(dirname "$0")/k6/scenarios/circuit_breaker_trip.js"

echo "=========================================================="
echo " All Benchmarks Completed! Results saved in ${OUTPUT_DIR}"
echo "=========================================================="
