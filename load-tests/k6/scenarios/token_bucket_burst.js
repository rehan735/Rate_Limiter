import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const allowedRate = new Rate('allowed_rate');
const throttledRate = new Rate('throttled_429_rate');
const latencyTrend = new Trend('gateway_response_latency');
const tokenRemainingTrend = new Trend('token_remaining_header');

export const options = {
  scenarios: {
    burst_saturation: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: '10s', target: 50 },  // Within limit
        { duration: '20s', target: 300 }, // Deliberate burst overload
        { duration: '10s', target: 20 },  // Cool-down recovery
      ],
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<15'], // P95 latency must remain under 15ms
    'allowed_rate': ['rate>0.4'],
  },
};

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:8080';

export default function () {
  const url = `${BASE_URL}/api/v1/users/profile`;
  const params = {
    headers: {
      'X-Forwarded-For': `192.168.10.${__VU % 10 + 1}`,
      'X-Tenant-ID': 'tenant-acme',
      'X-API-Key': 'rs_live_89f2test',
    },
    tags: { name: 'TokenBucketBurstTest' },
  };

  const res = http.get(url, params);
  latencyTrend.add(res.timings.duration);

  const isAllowed = res.status === 200;
  const isThrottled = res.status === 429;

  allowedRate.add(isAllowed);
  throttledRate.add(isThrottled);

  if (res.headers['X-Ratelimit-Remaining']) {
    tokenRemainingTrend.add(parseInt(res.headers['X-Ratelimit-Remaining'], 10));
  }

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has ratelimit headers': (r) => r.headers['X-Ratelimit-Limit'] !== undefined,
    'retry-after present on 429': (r) => (r.status === 429 ? r.headers['Retry-After'] !== undefined : true),
  });
}
