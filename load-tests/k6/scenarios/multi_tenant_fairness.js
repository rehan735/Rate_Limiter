import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const enterpriseAllowed = new Counter('enterprise_allowed_count');
const enterpriseThrottled = new Counter('enterprise_throttled_count');
const freeTierAllowed = new Counter('free_allowed_count');
const freeTierThrottled = new Counter('free_throttled_count');

export const options = {
  scenarios: {
    enterprise_tenant: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 50,
      env: { TENANT_TIER: 'enterprise', TENANT_ID: 'tenant-acme' },
    },
    free_tenant: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 50,
      env: { TENANT_TIER: 'free', TENANT_ID: 'tenant-free-trial' },
    },
  },
};

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:8080';

export default function () {
  const isEnterprise = __ENV.TENANT_TIER === 'enterprise';
  const tenantId = __ENV.TENANT_ID;

  const res = http.get(`${BASE_URL}/api/v1/users/list`, {
    headers: {
      'X-Tenant-ID': tenantId,
      'X-Forwarded-For': isEnterprise ? '172.16.0.1' : '192.168.1.1',
    },
  });

  if (isEnterprise) {
    if (res.status === 200) enterpriseAllowed.add(1);
    else if (res.status === 429) enterpriseThrottled.add(1);
  } else {
    if (res.status === 200) freeTierAllowed.add(1);
    else if (res.status === 429) freeTierThrottled.add(1);
  }

  check(res, {
    'rate limit headers injected': (r) => r.headers['X-Ratelimit-Limit'] !== undefined,
  });
}
