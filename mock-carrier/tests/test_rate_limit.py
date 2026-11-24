from mock_carrier.rate_limit import SlidingWindow


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_admits_up_to_the_limit_inside_one_second() -> None:
    clock = FakeClock()
    window = SlidingWindow(limit=3, clock=clock)

    admitted = []
    for now in (0.0, 0.3, 0.6, 0.9):
        clock.now = now
        admitted.append(window.try_admit())

    assert admitted == [True, True, True, False]
    assert len(window) == 3


def test_a_slot_frees_up_exactly_one_second_after_its_submit() -> None:
    clock = FakeClock()
    window = SlidingWindow(limit=1, clock=clock)
    assert window.try_admit()

    clock.now = 0.999
    assert not window.try_admit()
    clock.now = 1.0
    assert window.try_admit()


def test_window_slides_instead_of_resetting_on_the_second() -> None:
    clock = FakeClock()
    window = SlidingWindow(limit=2, clock=clock)
    clock.now = 0.75
    assert window.try_admit()
    assert window.try_admit()

    # A fixed one-second bucket would start fresh at 1.0 and let this one through.
    clock.now = 1.25
    assert not window.try_admit()
    clock.now = 1.75
    assert window.try_admit()


def test_rejected_submit_does_not_count_toward_the_window() -> None:
    clock = FakeClock()
    window = SlidingWindow(limit=1, clock=clock)
    assert window.try_admit()

    clock.now = 0.5
    assert not window.try_admit()

    # If the rejection at 0.5 had been remembered, this one would be rejected too.
    clock.now = 1.0
    assert window.try_admit()
