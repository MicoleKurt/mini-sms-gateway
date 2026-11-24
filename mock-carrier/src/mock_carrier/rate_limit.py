import time
from collections import deque
from collections.abc import Callable

WINDOW_SECONDS = 1.0


class SlidingWindow:
    """Admits at most `limit` submits in any one-second span.

    Only admitted submits are remembered, so a rejected submit does not push the
    window forward and a client that keeps hammering is not locked out for longer.
    """

    def __init__(self, limit: int, clock: Callable[[], float] = time.monotonic) -> None:
        self._limit = limit
        self._clock = clock
        self._admitted_at: deque[float] = deque()

    def try_admit(self) -> bool:
        now = self._clock()
        while self._admitted_at and now - self._admitted_at[0] >= WINDOW_SECONDS:
            self._admitted_at.popleft()
        if len(self._admitted_at) >= self._limit:
            return False
        self._admitted_at.append(now)
        return True

    def __len__(self) -> int:
        """Admitted submits still inside the window as of the last try_admit call."""
        return len(self._admitted_at)
