// Simple sliding-window rate limiter: at most `max` calls to tryAcquire()
// may return true within any trailing `windowMs` window.

export class RateLimiter {
  constructor(max, windowMs = 60000) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = [];
  }

  _prune(now) {
    const cutoff = now - this.windowMs;
    while (this.hits.length && this.hits[0] <= cutoff) this.hits.shift();
  }

  tryAcquire(now = Date.now()) {
    this._prune(now);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }

  msUntilSlot(now = Date.now()) {
    this._prune(now);
    if (this.hits.length < this.max) return 0;
    return this.hits[0] + this.windowMs - now;
  }
}
