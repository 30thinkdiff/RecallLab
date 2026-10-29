import type { AttemptTiming } from './evidence';
// Tracks only this page. Long timer gaps/idle periods are never treated as active recall.
export class AttemptClock {
  private timing: AttemptTiming;
  private last: number;
  private activity: number;
  private focused = true;
  private visible = true;
  constructor(now: number, presentedAt: string, saved?: AttemptTiming) {
    this.last = now;
    this.activity = now;
    this.timing = saved
      ? structuredClone(saved)
      : {
          version: 'active-v1',
          presentedAt,
          attemptedAt: null,
          observedAt: new Date(now).toISOString(),
          activeMs: 0,
          backgroundMs: 0,
          idleMs: 0,
          unknownMs: Math.max(0, now - Date.parse(presentedAt)),
          interruptions: 0,
        };
    if (saved) {
      this.timing.unknownMs += Math.max(0, now - Date.parse(saved.observedAt));
      this.timing.interruptions++;
    }
  }
  advance(now: number) {
    const delta = now - this.last;
    if (delta < 0) {
      this.timing.interruptions++;
      this.timing.unknownMs += 1000;
    } else if (delta > 10000) {
      this.timing.unknownMs += delta;
      this.timing.interruptions++;
    } else if (!this.visible || !this.focused) this.timing.backgroundMs += delta;
    else if (this.timing.attemptedAt) {
      const active = Math.min(delta, Math.max(0, this.activity + 30000 - this.last));
      this.timing.activeMs += active;
      this.timing.idleMs += delta - active;
    } else this.timing.unknownMs += delta;
    this.last = now;
    this.timing.observedAt = new Date(now).toISOString();
  }
  interact(now: number) {
    this.advance(now);
    this.activity = now;
    if (!this.timing.attemptedAt) this.timing.attemptedAt = new Date(now).toISOString();
  }
  environment(now: number, visible: boolean, focused: boolean) {
    this.advance(now);
    if (visible !== this.visible || focused !== this.focused) this.timing.interruptions++;
    this.visible = visible;
    this.focused = focused;
  }
  snapshot(now: number) {
    this.advance(now);
    return structuredClone(this.timing);
  }
}
