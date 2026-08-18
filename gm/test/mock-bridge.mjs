#!/usr/bin/env node
// A tiny stand-in for the plugin's WebSocket bridge, for testing the gm/
// service with no real Minecraft server. Performs the same auth handshake
// as the real bridge, then emits a scripted sequence of fake events:
//
//   t=50ms   player_join
//   t=150ms  player_chat  (1st of 2 rapid messages, proves debouncing)
//   t=300ms  player_chat  (2nd rapid message - still inside the default
//                          debounce window used by the smoke test)
//   t=2000ms npc_death    (well outside the window -> its own turn)
//
// Env:
//   MOCK_BRIDGE_PORT   port to listen on (default 8799)
//   MOCK_BRIDGE_TOKEN  expected auth token (default "test-token")

import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_BRIDGE_PORT || 8799);
const TOKEN = process.env.MOCK_BRIDGE_TOKEN || "test-token";

const wss = new WebSocketServer({ port: PORT });

function send(sock, msg) {
  if (sock.readyState === sock.OPEN) sock.send(JSON.stringify(msg));
}

wss.on("connection", (sock) => {
  sock.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.cmd === "auth") {
      const ok = msg.args && msg.args.token === TOKEN;
      send(sock, { id: msg.id, ok, error: ok ? undefined : "bad token" });
      if (ok) scheduleEvents(sock);
      return;
    }
    // Any other command (a real game tool call) - not expected in the
    // smoke test since GM_DRY_RUN=1 never spawns the real MCP tool server,
    // but reply ok:true defensively so nothing hangs.
    send(sock, { id: msg.id, ok: true, data: {} });
  });
});

function scheduleEvents(sock) {
  const timeline = [
    [50, "player_join", { player: "Steve", location: { x: 480, y: 75, z: 5, world: "world" } }],
    [150, "player_chat", { player: "Steve", message: "hello?", location: { x: 480, y: 75, z: 5 } }],
    [300, "player_chat", { player: "Steve", message: "anyone home?", location: { x: 481, y: 75, z: 5 } }],
    [2000, "npc_death", { npcId: "sella", npcName: "Sella", dead: true, location: { x: 502, y: 75, z: 2 } }],
  ];
  for (const [delay, event, data] of timeline) {
    setTimeout(() => send(sock, { event, data }), delay);
  }
}

console.error(`[mock-bridge] listening on ws://127.0.0.1:${PORT}`);
