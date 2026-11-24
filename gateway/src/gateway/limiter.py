"""The carrier rate limit, shared by every worker process.

GCRA (generic cell rate algorithm), stored as one integer in Redis/Valkey:
the "theoretical arrival time" (TAT) of the next submit. Each submit pushes
the TAT forward by one emission interval (1 / rate). A submit is allowed
while the TAT is no more than `burst - 1` intervals ahead of now.

Why GCRA and not a counter per second:
  * it paces submits evenly instead of sending 50 at the top of each second,
    so a message that arrives mid-second (an OTP) waits about one interval,
    not up to a full second;
  * in any window of one second it can hand out at most rate + burst tokens,
    whatever the window's alignment. That is the property the carrier checks.

The script runs atomically in Redis and uses the Redis clock, so workers
with different clocks cannot disagree. State is a single key: if Redis is
wiped, the limiter starts from "now", which is safe.
"""

from __future__ import annotations

from typing import Any

# KEYS[1] = TAT key (microseconds since epoch)
# ARGV[1] = emission interval in microseconds
# ARGV[2] = burst (tokens that may be taken back to back)
# ARGV[3] = tokens wanted
# Returns { granted, wait_microseconds }
_ACQUIRE = """
local interval = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local wanted = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000000 + tonumber(t[2])
local tat = tonumber(redis.call('GET', KEYS[1]) or now)
if tat < now then tat = now end
local tolerance = (burst - 1) * interval
local available = math.floor((now + tolerance - tat) / interval) + 1
if available <= 0 then
  return { 0, tat - tolerance - now }
end
local granted = math.min(available, wanted)
tat = tat + granted * interval
redis.call('SET', KEYS[1], string.format('%.0f', tat), 'PX', 60000)
return { granted, 0 }
"""

# ARGV[1] = microseconds to move the TAT by (negative gives tokens back)
# ARGV[2] = 1 to measure from now (a penalty), 0 to shift the stored TAT (a release)
_SHIFT = """
local delta = tonumber(ARGV[1])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000000 + tonumber(t[2])
local tat = tonumber(redis.call('GET', KEYS[1]) or now)
if tat < now then tat = now end
if ARGV[2] == '1' then
  if now + delta > tat then tat = now + delta end
else
  tat = tat + delta
  if tat < now then tat = now end
end
redis.call('SET', KEYS[1], string.format('%.0f', tat), 'PX', 60000)
return 1
"""


class RateLimiter:
    def __init__(
        self, redis: Any, *, rate_per_second: float, burst: int, key: str = "smsgw:carrier:tat"
    ) -> None:
        if rate_per_second <= 0 or burst < 1:
            raise ValueError("rate must be positive and burst at least 1")
        self._interval_us = round(1_000_000 / rate_per_second)
        self._burst = burst
        self._key = key
        self._acquire = redis.register_script(_ACQUIRE)
        self._shift = redis.register_script(_SHIFT)

    @property
    def burst(self) -> int:
        return self._burst

    async def acquire(self, wanted: int = 1) -> tuple[int, float]:
        """Take up to `wanted` tokens. Return (granted, seconds to wait if granted == 0)."""
        granted, wait_us = await self._acquire(
            keys=[self._key], args=[self._interval_us, self._burst, wanted]
        )
        return int(granted), int(wait_us) / 1_000_000

    async def release(self, tokens: int) -> None:
        """Give back tokens that were taken but not used (no message was ready)."""
        if tokens > 0:
            await self._shift(keys=[self._key], args=[-tokens * self._interval_us, 0])

    async def penalize(self, seconds: float) -> None:
        """Stop every worker for `seconds`. Used when the carrier answers 429:
        its view of the window is the one that counts, not ours."""
        await self._shift(keys=[self._key], args=[round(seconds * 1_000_000), 1])
