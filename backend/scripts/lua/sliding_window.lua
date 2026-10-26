--[[
  sliding_window.lua — Atomic sliding-window counter rate-limiter.

  Approximation: Combines current and previous window counts to estimate usage
  over a sliding interval. The formula is:
      estimated = prev_count * (1 - elapsed/window) + curr_count

  This avoids O(n) memory per key (unlike the log approach) at the cost of
  slight over- or under-counting near window boundaries (~10% error worst case).
  Document this limitation clearly in operational runbooks.

  KEYS[1] — Current window key
  KEYS[2] — Previous window key
  ARGV[1] — Limit (max requests)
  ARGV[2] — Cost
  ARGV[3] — Window duration in seconds
  ARGV[4] — Current Unix timestamp in seconds

  Returns:
    [1] allowed        (1=yes, 0=no)
    [2] estimated      (estimated count as integer)
    [3] remaining      (floor estimate of remaining capacity)
    [4] reset_at_secs  (end of current window)
    [5] retry_after_ms (0 if allowed)
]]

local limit       = tonumber(ARGV[1])
local cost        = tonumber(ARGV[2])
local window_secs = tonumber(ARGV[3])
local now_secs    = tonumber(ARGV[4])

if not limit or limit <= 0 then
    return redis.error_reply("ERR invalid limit")
end
if not cost or cost < 1 then
    cost = 1
end
if not window_secs or window_secs <= 0 then
    return redis.error_reply("ERR invalid window_secs")
end

local window_start  = math.floor(now_secs / window_secs) * window_secs
local elapsed       = now_secs - window_start
local reset_at      = window_start + window_secs
local prev_weight   = 1.0 - (elapsed / window_secs)

local curr_key = KEYS[1]
local prev_key = KEYS[2]

local curr_count = tonumber(redis.call("GET", curr_key) or "0")
local prev_count = tonumber(redis.call("GET", prev_key) or "0")

local estimated = math.floor(prev_count * prev_weight + curr_count)

local allowed
local retry_after_ms

if (estimated + cost) <= limit then
    redis.call("INCRBY", curr_key, cost)
    redis.call("EXPIRE", curr_key, window_secs * 2 + 1)
    allowed = 1
    retry_after_ms = 0
else
    allowed = 0
    -- Rough estimate: wait until estimated drops below (limit - cost)
    local target_prev_contrib = limit - cost - curr_count
    if target_prev_contrib < 0 then
        retry_after_ms = (reset_at - now_secs) * 1000
    else
        -- prev_count * (1 - t/W) <= target  =>  t >= W * (1 - target/prev_count)
        if prev_count > 0 then
            local t = window_secs * (1.0 - target_prev_contrib / prev_count)
            retry_after_ms = math.max(0, math.ceil((t - elapsed) * 1000))
        else
            retry_after_ms = (reset_at - now_secs) * 1000
        end
    end
end

local remaining = math.max(0, limit - estimated)

return { allowed, estimated, remaining, reset_at, retry_after_ms }
