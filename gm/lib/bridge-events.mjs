// A second, independent WebSocket connection to the plugin bridge, used
// purely to RECEIVE pushed events (the "wake up" signal for the GM). This
// mirrors the auth handshake in mcp/server.mjs but never issues commands -
// game actions go through the Agent SDK's own MCP stdio connection to
// mcp/server.mjs instead. Auto-reconnects with exponential backoff.

import { log } from "./logger.mjs";

export class BridgeEventClient {
  /**
   * @param {object} opts
   * @param {string} opts.url
   * @param {string} opts.token
   * @param {number} [opts.baseMs] initial reconnect delay
   * @param {number} [opts.maxMs] max reconnect delay
   * @param {(event: string, data: any) => void} opts.onEvent
   * @param {(ok: boolean) => void} [opts.onAuth]
   */
  constructor({ url, token, baseMs = 1000, maxMs = 30000, onEvent, onAuth }) {
    this.url = url;
    this.token = token;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.onEvent = onEvent;
    this.onAuth = onAuth || (() => {});
    this.attempt = 0;
    this.stopped = false;
    this.ws = null;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** this.attempt);
    this.attempt += 1;
    log.warn("bridge_reconnect_scheduled", { attempt: this.attempt, delayMs: delay, url: this.url });
    // Intentionally NOT unref'd: this timer is what keeps the process alive
    // while the bridge is unreachable. Unref'ing it lets the event loop
    // drain to empty (nothing else is pending once a connect attempt fails
    // synchronously/immediately) and the process exits with code 0 instead
    // of retrying.
    this._reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  _connect() {
    if (this.stopped) return;
    const authId = "gm-auth-" + Math.random().toString(36).slice(2);
    let authed = false;
    let sock;
    try {
      sock = new WebSocket(this.url);
    } catch (e) {
      log.error("bridge_connect_failed", { error: String(e) });
      this._scheduleReconnect();
      return;
    }
    this.ws = sock;

    sock.onopen = () => {
      sock.send(JSON.stringify({ id: authId, cmd: "auth", args: { token: this.token } }));
    };

    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id === authId) {
        authed = !!msg.ok;
        if (authed) {
          this.attempt = 0; // reset backoff on a clean connection
          log.info("bridge_auth_ok", { url: this.url });
        } else {
          log.error("bridge_auth_failed", { error: msg.error });
        }
        this.onAuth(authed);
        return;
      }
      if (msg.event) {
        this.onEvent(msg.event, msg.data);
      }
    };

    sock.onclose = () => {
      this.ws = null;
      if (!this.stopped) this._scheduleReconnect();
    };
    sock.onerror = () => { /* onclose follows */ };
  }
}
