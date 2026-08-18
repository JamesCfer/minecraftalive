// Tracks cumulative daily token usage in gm/state/usage.json, resetting at
// UTC midnight. Deliberately file-backed (not just in-memory) so a service
// restart mid-day doesn't quietly reset the budget.

import fs from "node:fs/promises";
import path from "node:path";

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export class UsageTracker {
  constructor(stateDir, dailyBudget) {
    this.file = path.join(stateDir, "usage.json");
    this.stateDir = stateDir;
    this.dailyBudget = dailyBudget;
    this.date = todayUtc();
    this.tokens = 0;
    this._loaded = false;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const data = JSON.parse(raw);
      if (data.date === todayUtc()) {
        this.date = data.date;
        this.tokens = data.tokens || 0;
      } else {
        this.date = todayUtc();
        this.tokens = 0;
      }
    } catch {
      this.date = todayUtc();
      this.tokens = 0;
    }
    this._loaded = true;
    return this;
  }

  async _persist() {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ date: this.date, tokens: this.tokens }, null, 1));
  }

  _rollIfNewDay() {
    const t = todayUtc();
    if (t !== this.date) {
      this.date = t;
      this.tokens = 0;
    }
  }

  isOverBudget() {
    this._rollIfNewDay();
    return this.tokens >= this.dailyBudget;
  }

  remaining() {
    this._rollIfNewDay();
    return Math.max(0, this.dailyBudget - this.tokens);
  }

  async addTokens(n) {
    this._rollIfNewDay();
    this.tokens += Math.max(0, n | 0);
    await this._persist();
    return this.tokens;
  }
}
