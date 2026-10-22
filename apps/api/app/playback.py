"""Wall time to fixed simulation steps; playback is applied exactly once."""
import time


class PlaybackClock:
    def __init__(self, now=None):
        self.last = time.perf_counter() if now is None else now
        self.pending_s = 0.

    def accrue(self, speed, paused, now=None):
        now = time.perf_counter() if now is None else now
        if not paused:
            self.pending_s += max(0., now-self.last)*speed
        self.last = now

    def take_steps(self, step_s, limit=40):
        count = min(limit, int((self.pending_s+1e-9)/step_s))
        self.pending_s = max(0., self.pending_s-count*step_s)
        return count

    def reset(self):
        self.last = time.perf_counter()
        self.pending_s = 0.
