--[[
  token_bucket.lua — Atomic token bucket rate-limiter implemented as a Redis Lua script.

  Consistency guarantee: Because this script executes atomically on a single Redis node
  (or within a single hash slot in Redis Cluster), it guarantees that the check-and-update
  is performed without race conditions between concurrent calls using the SAME KEY.

  Limitation: Multiple independent buckets cannot be updated in a single transaction.
  For multi-dimensional limiting, each dimension is checked sequentially; see the
  multi_dimension.lua script and its documented reservation/refund strategy.

  KEYS[1] — The rate-limit bucket key (e.g., "rl:tb:{tenant_id}:route_id")
  ARGV[1] — Bucket capacity (positive integer)
  ARGV[2] — Refill rate in tokens per second (positive float)
  ARGV[3] — Request cost (positive integer, default 1)
  ARGV[4] — Current Unix timestamp in milliseconds (integer)
  ARGV[5] — TTL in seconds for the key (integer, e.g., 3600)

  Returns an array:
    [1] allowed  (1=yes, 0=no)
    [2] tokens_remaining (float, floor-rounded)
    [3] reset_at_ms (Unix ms when bucket will be full)
    [4] retry_after_ms (0 if allowed, else ms to wait)
]]

local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local cost       = tonumber(ARGV[3])
local now_ms     = tonumber(ARGV[4])
local ttl_secs   = tonumber(ARGV[5])

-- Input validation
if not capacity or capacity <= 0 then
    return redis.error_reply("ERR invalid capacity")
end
if not refill_rate or refill_rate <= 0 then
    return redis.error_reply("ERR invalid refill_rate")
end
if not cost or cost < 1 then
    cost = 1
end
if not now_ms or now_ms <= 0 then
    return redis.error_reply("ERR invalid timestamp")
end

-- Load existing bucket state (stored as a hash with fields: tokens, last_ms)
local tokens_str  = redis.call("HGET", key, "tokens")
local last_ms_str = redis.call("HGET", key, "last_ms")

local tokens
local last_ms

if tokens_str == false or last_ms_str == false then
    -- First request: initialize bucket to full capacity
    tokens  = capacity
    last_ms = now_ms
else
    tokens  = tonumber(tokens_str)
    last_ms = tonumber(last_ms_str)

    -- Protect against clock skew: never go backwards
    if now_ms > last_ms then
        local elapsed_sec = (now_ms - last_ms) / 1000.0
        -- Refill: tokens += refill_rate * elapsed_sec, capped at capacity
        local refilled = tokens + (refill_rate * elapsed_sec)
        if refilled > capacity then
            tokens = capacity
        else
            tokens = refilled
        end
        last_ms = now_ms
    end
    -- If now_ms <= last_ms, use existing state without refill (clock went backwards)
end

local allowed
local retry_after_ms

if tokens >= cost then
    tokens  = tokens - cost
    allowed = 1
    retry_after_ms = 0
else
    allowed = 0
    -- Compute how long until enough tokens accrue
    local deficit = cost - tokens
    -- time_needed = deficit / refill_rate  (in seconds)
    local time_needed_ms = math.ceil((deficit / refill_rate) * 1000)
    retry_after_ms = time_needed_ms
end

-- Persist updated state
redis.call("HSET", key, "tokens", tokens, "last_ms", last_ms)
redis.call("EXPIRE", key, ttl_secs)

-- Calculate when bucket will be full (for Retry-After / X-RateLimit-Reset)
local tokens_needed_for_full = capacity - tokens
local ms_to_full
if tokens_needed_for_full <= 0 then
    ms_to_full = 0
else
    ms_to_full = math.ceil((tokens_needed_for_full / refill_rate) * 1000)
end
local reset_at_ms = last_ms + ms_to_full

-- Return values as integers/strings compatible with Redis multi-bulk reply
return {
    allowed,
    math.floor(tokens),
    reset_at_ms,
    retry_after_ms
}
