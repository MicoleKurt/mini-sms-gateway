"""The message state machine.

    ACCEPTED -> QUEUED -> SUBMITTED -> DELIVERED | UNDELIVERED | EXPIRED
                      \\-> FAILED

`ALLOWED` is the only definition of which moves exist. `transition()` in
`gateway.messages` turns it into a compare-and-set in SQL, so a late or
repeated event cannot move a message backwards: its source state no longer
matches and the UPDATE touches zero rows.
"""

from __future__ import annotations

from typing import Final

ACCEPTED: Final = "ACCEPTED"
QUEUED: Final = "QUEUED"
SUBMITTED: Final = "SUBMITTED"
DELIVERED: Final = "DELIVERED"
UNDELIVERED: Final = "UNDELIVERED"
EXPIRED: Final = "EXPIRED"
FAILED: Final = "FAILED"

ALL_STATUSES: Final = (ACCEPTED, QUEUED, SUBMITTED, DELIVERED, UNDELIVERED, EXPIRED, FAILED)
FINAL_STATUSES: Final = frozenset({DELIVERED, UNDELIVERED, EXPIRED, FAILED})

#: target status -> the statuses it may be entered from.
ALLOWED: Final[dict[str, tuple[str, ...]]] = {
    QUEUED: (ACCEPTED,),
    SUBMITTED: (QUEUED,),
    FAILED: (QUEUED,),
    DELIVERED: (SUBMITTED,),
    UNDELIVERED: (SUBMITTED,),
    EXPIRED: (SUBMITTED,),
}

#: Carrier DLR status -> our final status.
DLR_STATUS: Final[dict[str, str]] = {
    "DELIVRD": DELIVERED,
    "UNDELIV": UNDELIVERED,
    "EXPIRED": EXPIRED,
}
