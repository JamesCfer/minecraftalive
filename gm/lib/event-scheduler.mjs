// Debounces incoming wake-events into batches and hands each batch to a
// single agent turn, one at a time. Events that arrive while a turn is in
// flight are queued for the next turn rather than dropped or run
// concurrently.

import { log } from "./logger.mjs";

export class EventScheduler {
  /**
   * @param {object} opts
   * @param {number} opts.debounceMs
   * @param {(batch: Array<{event:string, data:any, at:string}>) => Promise<void>} opts.runTurn
   */
  constructor({ debounceMs, runTurn }) {
    this.debounceMs = debounceMs;
    this.runTurn = runTurn;
    this.pending = [];
    this.timer = null;
    this.turnRunning = false;
    this.turnsStarted = 0; // exposed for tests
  }

  push(event, data) {
    this.pending.push({ event, data, at: new Date().toISOString() });
    if (!this.timer) {
      this.timer = setTimeout(() => this._flush(), this.debounceMs);
      if (typeof this.timer.unref === "function") this.timer.unref();
    }
  }

  _flush() {
    this.timer = null;
    if (this.pending.length === 0) return;
    if (this.turnRunning) {
      // A turn is mid-flight; try again shortly rather than running two
      // turns concurrently. The events already sitting in `pending` will
      // be picked up whenever that turn finishes and this fires.
      this.timer = setTimeout(() => this._flush(), 250);
      if (typeof this.timer.unref === "function") this.timer.unref();
      return;
    }
    const batch = this.pending;
    this.pending = [];
    this.turnRunning = true;
    this.turnsStarted += 1;
    Promise.resolve()
      .then(() => this.runTurn(batch))
      .catch((e) => log.error("turn_failed", { error: String(e && e.stack || e) }))
      .finally(() => {
        this.turnRunning = false;
        if (this.pending.length > 0) {
          this.timer = setTimeout(() => this._flush(), this.debounceMs);
          if (typeof this.timer.unref === "function") this.timer.unref();
        }
      });
  }
}
