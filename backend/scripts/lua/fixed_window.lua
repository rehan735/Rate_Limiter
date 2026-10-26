--[[
  fixed_window.lua — Atomic fixed-window rate-limiter.

  Consistency guarantee: atomic on a single Redis node/slot.

  Weakness: Burst at window boundary — a client can make twice the limit of requests
  in a short window straddling two intervals. This is documented and expected.
  Use sliding_window.lua if boundary bursts are unacceptable.

  KEYS[1]  — The counter key (includes window start time for automatic uniqueness)
  ARGV[1]  — Maximum requests allowed per window
  ARGV[2]  — Request cost
  ARGV[3]  — Window duration in seconds
  ARGV[4]  — Current Unix timestamp in seconds

  Returns:
    [1] allowed        (1=yes, 0=no)
    [2] count          (current count after this request)
    [3] remaining      (requests remaining in window)
    [4] reset_at_secs  (Unix timestamp when window resets)
    [5] retry_after_ms (0 if allowed)
]]

local limit        = tonumber(ARGV[1])
local cost         = tonumber(ARGV[2])
local window_secs  = tonumber(ARGV[3])
local now_secs     = tonumber(ARGV[4])

if not limit or limit <= 0 then
    return redis.error_reply("ERR invalid limit")
end
if not cost or cost < 1 then
    cost = 1
end
if not window_secs or window_secs <= 0 then
    return redis.error_reply("ERR invalid window_secs")
end

-- Compute window start (floor division) and build a windowed key
local window_start = math.floor(now_secs / window_secs) * window_secs
local reset_at     = window_start + window_secs
local ttl          = reset_at - now_secs

-- key already includes the window boundary (caller should embed it)
local key = KEYS[1] .. ":" .. window_start

local current = redis.call("GET", key)
if current == false then
    current = 0
else
    current = tonumber(current)
end

local allowed
local retry_after_ms
local new_count

if (current + cost) <= limit then
    new_count = redis.call("INCRBY", key, cost)
    redis.call("EXPIRE", key, ttl + 1)  -- +1 to avoid expiry race
    allowed = 1
    retry_after_ms = 0
else
    new_count = current
    allowed = 0
    retry_after_ms = (reset_at - now_secs) * 1000
end

local remaining = math.max(0, limit - new_count)

return { allowed, new_count, remaining, reset_at, retry_after_ms }
