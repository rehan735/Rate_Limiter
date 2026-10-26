--[[
  sliding_window_log.lua — Exact sliding-window log using a Redis Sorted Set.

  Accuracy: Exact (no approximation). Every request timestamp is recorded.
  Memory cost: O(n) per key where n = number of requests in the window.
  Computational cost: O(log n) per ZADD; O(log n + expired) per ZREMRANGEBYSCORE.

  Use this mode when exact rate enforcement is critical and traffic per key is low.
  For high-traffic keys, use sliding_window.lua instead to avoid memory pressure.

  KEYS[1] — Sorted set key for this rate-limit dimension
  ARGV[1] — Limit (max requests in window)
  ARGV[2] — Cost (number of "slots" to consume per request)
  ARGV[3] — Window duration in seconds
  ARGV[4] — Current Unix timestamp in milliseconds

  Returns:
    [1] allowed        (1=yes, 0=no)
    [2] count          (requests in window after this one)
    [3] remaining      (slots remaining)
    [4] oldest_ms      (timestamp of oldest request in window; 0 if empty)
    [5] retry_after_ms (0 if allowed)
]]

local key         = KEYS[1]
local limit       = tonumber(ARGV[1])
local cost        = tonumber(ARGV[2])
local window_secs = tonumber(ARGV[3])
local now_ms      = tonumber(ARGV[4])

if not limit or limit <= 0 then
    return redis.error_reply("ERR invalid limit")
end
if not cost or cost < 1 then
    cost = 1
end
if not window_secs or window_secs <= 0 then
    return redis.error_reply("ERR invalid window_secs")
end

local window_ms   = window_secs * 1000
local cutoff_ms   = now_ms - window_ms

-- Remove entries outside the window
redis.call("ZREMRANGEBYSCORE", key, "-inf", cutoff_ms)

-- Count remaining entries
local count = redis.call("ZCARD", key)

local allowed
local retry_after_ms
local oldest_ms = 0

if (count + cost) <= limit then
    -- Add cost entries with scores = now_ms (unique scores via member UUID suffix)
    for i = 1, cost do
        local member = now_ms .. ":" .. i .. ":" .. math.random(1000000)
        redis.call("ZADD", key, now_ms, member)
    end
    -- Set TTL: window duration + small buffer
    redis.call("EXPIRE", key, window_secs + 1)
    allowed = 1
    retry_after_ms = 0
    count = count + cost
else
    allowed = 0
    -- Retry after: time until the oldest entry expires
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    if #oldest >= 2 then
        oldest_ms = tonumber(oldest[2])
        local expire_at_ms = oldest_ms + window_ms
        retry_after_ms = math.max(0, math.ceil(expire_at_ms - now_ms))
    else
        retry_after_ms = window_ms
    end
end

local remaining = math.max(0, limit - count)

return { allowed, count, remaining, oldest_ms, retry_after_ms }
