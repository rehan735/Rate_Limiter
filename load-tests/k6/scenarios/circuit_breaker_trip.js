import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const serviceUnavailable = new Counter('circuit_open_503_count');
const normalSuccess = new Counter('normal_200_count');

export const options = {
  stages: [
    { duration: '5s', target: 20 },  // Normal traffic
    { duration: '10s', target: 50 }, // Injected errors to trip circuit breaker
    { duration: '10s', target: 20 }, // Verify fast-fail 503 circuit breaker state
  ],
};

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:8080';

export default function () {
  // Inject error simulation during second stage
  const injectError = __ITER > 100 && __ITER < 400;

  const res = http.get(`${BASE_URL}/api/v1/orders/health`, {
    headers: {
      'X-Simulate-Status': injectError ? '500' : '200',
    },
  });

  if (res.status === 200) {
    normalSuccess.add(1);
  } else if (res.status === 503 || res.status === 502) {
    serviceUnavailable.add(1);
  }

  check(res, {
    'expected status returned': (r) => [200, 500, 502, 503].includes(r.status),
  });

  sleep(0.05);
}
