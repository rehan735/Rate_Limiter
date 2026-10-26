import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const allowedRate = new Rate('sw_allowed_rate');
const throttledRate = new Rate('sw_throttled_rate');
const latencyTrend = new Trend('sw_latency');

export const options = {
  scenarios: {
    constant_rate_test: {
      executor: 'constant-arrival-rate',
      rate: 150,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 100,
      maxVUs: 250,
    },
  },
  thresholds: {
    'http_req_duration': ['p(99)<25'],
  },
};

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:8080';

export default function () {
  const ipSuffix = __VU % 5 + 1; // 5 distinct simulated clients
  const url = `${BASE_URL}/api/v1/orders/catalog`;
  const params = {
    headers: {
      'X-Forwarded-For': `10.0.0.${ipSuffix}`,
      'X-Tenant-ID': `tenant-${ipSuffix}`,
    },
    tags: { name: 'SlidingWindowSaturation' },
  };

  const res = http.get(url, params);
  latencyTrend.add(res.timings.duration);

  allowedRate.add(res.status === 200);
  throttledRate.add(res.status === 429);

  check(res, {
    'valid response code (200 or 429)': (r) => r.status === 200 || r.status === 429,
  });
}
