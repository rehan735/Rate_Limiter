# Rate Limiting Algorithms & Mathematical Models

This document details the rate limiting algorithms implemented in RateShield, their mathematical formulations, Redis Lua scripts, memory profiles, and algorithmic trade-offs.

---

## 1. Token Bucket (`token_bucket`)

### Mathematical Model
A bucket has a maximum capacity $B$ and refills continuously at rate $r$ tokens/second:

$$\text{refilled\_tokens} = \min\left(B, \text{current\_tokens} + \Delta t \times r\right)$$

Where:
- $\Delta t = t_{\text{current}} - t_{\text{last\_refill}}$ (in seconds)
- Cost $c$ is subtracted if $\text{refilled\_tokens} \ge c$.

### Redis Data Structure & Lua Mechanics
- **Key**: String hash storing `tokens` and `last_updated_ms`.
- **TTL**: $\lceil B / r \rceil + 60$ seconds.
- **Complexity**: $O(1)$ time, ~64 bytes memory per key.
- **Strengths**: Accommodates natural traffic bursts up to $B$ while maintaining long-term average rate $r$.

---

## 2. Sliding Window Counter (`sliding_window`)

### Mathematical Model
Overcomes the boundary double-spike weakness of Fixed Window without the storage cost of Sliding Log.
Given a window duration $W$, current window count $C_{\text{curr}}$, previous window count $C_{\text{prev}}$, and elapsed time in current window $t_{\text{elapsed}}$:

$$\text{estimated\_count} = C_{\text{prev}} \times \left(1 - \frac{t_{\text{elapsed}}}{W}\right) + C_{\text{curr}}$$

If $\text{estimated\_count} + \text{cost} \le \text{limit}$, the request is permitted.

### Redis Data Structure & Lua Mechanics
- **Keys**: Two atomic counters representing current window key and previous window key (e.g. `rl:sw:user1:294829` and `rl:sw:user1:294828`).
- **Complexity**: $O(1)$ time, ~128 bytes memory per key.
- **Strengths**: Smooth boundary transitions with negligible memory overhead.

---

## 3. Sliding Window Log (`sliding_window_log`)

### Mathematical Model
Exact precision rate limiting. Every request timestamp is recorded into a sorted set:

$$\text{active\_requests} = \left| \{ t \in \text{Set} \mid t > t_{\text{now}} - W \} \right|$$

If $\text{active\_requests} + \text{cost} \le \text{limit}$, the timestamp $t_{\text{now}}$ is appended.

### Redis Data Structure & Lua Mechanics
- **Key**: Redis Sorted Set (`ZSET`) where score = timestamp in milliseconds.
- **Cleanup**: `ZREMRANGEBYSCORE key 0 (now_ms - window_ms)`.
- **Complexity**: $O(\log N + M)$ where $N$ is set size and $M$ is purged elements.
- **Strengths**: 100% strict mathematical precision. Ideal for financial transaction endpoints.

---

## 4. Fixed Window (`fixed_window`)

### Mathematical Model
Window timestamp is partitioned into discrete buckets: $\text{bucket\_id} = \lfloor t_{\text{now}} / W \rfloor$.

$$\text{count} = \text{INCRBY}(key, \text{cost})$$

If $\text{count} \le \text{limit}$, allowed.

### Redis Data Structure & Lua Mechanics
- **Key**: String counter with Redis `EXPIRE`.
- **Complexity**: $O(1)$ time, ~32 bytes memory per key.
- **Strengths**: Minimal overhead; useful for rate-limiting failed password login attempts per IP.

---

## Comparative Matrix

| Feature | Token Bucket | Sliding Window Counter | Sliding Window Log | Fixed Window |
|---|---|---|---|---|
| **Burst Handling** | Smooth burst up to cap | Smooth interpolation | Strict threshold | Boundary double-spike |
| **Time Complexity** | $O(1)$ | $O(1)$ | $O(\log N)$ | $O(1)$ |
| **Storage / Key** | ~64 bytes | ~128 bytes | $O(\text{reqs})$ | ~32 bytes |
| **Mathematical Precision** | High (Continuous) | Approximate (99.5%) | 100% Exact | Low (Step function) |
| **Recommended For** | Public APIs | Tenant SaaS Quotas | Payments / Fraud | Auth Login Guards |
