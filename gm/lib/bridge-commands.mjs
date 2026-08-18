// A lightweight COMMAND connection to the plugin bridge, used only by the
// conversation fast path (npc_list / npc_get / story_get / npc_say /
// story_set). Speaks the same {id, cmd, args} -> {id, ok, data|error}
// protocol as mcp/server.mjs; all game logic still lives on the plugin
// side — this sends the exact same commands the MCP tools would.
//
// Connects lazily on the first call() and reconnects transparently on the
// next call() after a drop.

export class BridgeCommandClient {
  /**
   * @param {object} opts
   * @param {string} opts.url
   * @param {string} opts.token
   * @param {number} [opts.callTimeoutMs]
   */
  constructor({ url, token, callTimeoutMs = 10000 }) {
    this.url = url;
    this.token = token;
    this.callTimeoutMs = callTimeoutMs;
    this.ws = null;
    this.wsReady = null; // promise resolving to an authed socket
    this.pending = new Map(); // id -> {resolve, reject}
    this.seq = 0;
  }

  _connect() {
    if (this.wsReady) return this.wsReady;
    this.wsReady = new Promise((resolve, reject) => {
      const authId = "gmc-auth-" + Math.random().toString(36).slice(2);
      let authed = false;
      let sock;
      try {
        sock = new WebSocket(this.url);
      } catch (e) {
        this.wsReady = null;
        reject(e);
        return;
      }

      sock.onopen = () => {
        sock.send(JSON.stringify({ id: authId, cmd: "auth", args: { token: this.token } }));
      };
      sock.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.event) return; // this connection ignores pushed events
        if (msg.id === authId) {
          if (msg.ok) { authed = true; this.ws = sock; resolve(sock); }
          else reject(new Error("bridge command auth failed: " + msg.error));
          return;
        }
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.ok) p.resolve(msg.data ?? {});
          else p.reject(new Error(msg.error || "unknown bridge error"));
        }
      };
      sock.onclose = () => {
        this.ws = null;
        this.wsReady = null;
        for (const [, p] of this.pending) p.reject(new Error("bridge command connection lost"));
        this.pending.clear();
        if (!authed) reject(new Error(`could not connect to ${this.url}`));
      };
      sock.onerror = () => { /* onclose follows */ };
    });
    return this.wsReady;
  }

  async call(cmd, args = {}) {
    await this._connect();
    const id = "gmc" + (++this.seq);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, cmd, args }));
      const t = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("timed out waiting for bridge reply to " + cmd));
        }
      }, this.callTimeoutMs);
      if (typeof t.unref === "function") t.unref();
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
    }
    this.ws = null;
    this.wsReady = null;
  }
}
