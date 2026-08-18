#!/usr/bin/env node
// A tiny stand-in for the plugin's WebSocket bridge, for testing the gm/
// service with no real Minecraft server. Performs the same auth handshake
// as the real bridge, answers the commands the conversation fast path
// uses (npc_list / story_get / npc_say / story_set), then emits a scripted
// sequence of fake events.
//
// Default timeline (MOCK_BRIDGE_SCRIPT unset or "default"):
//   t=50ms   player_join
//   t=150ms  player_chat  (1st of 2 rapid messages, proves debouncing)
//   t=300ms  player_chat  (2nd rapid message - still inside the default
//                          debounce window used by the smoke test)
//   t=2000ms npc_death    (well outside the window -> its own turn)
//
// "conversation" timeline (MOCK_BRIDGE_SCRIPT=conversation), for the fast
// path test — purely conversational events aimed at one NPC:
//   t=100ms  npc_interact (right-click on Poppy)
//   t=200ms  player_chat  "Hey Poppy"
//
// Env:
//   MOCK_BRIDGE_PORT    port to listen on (default 8799)
//   MOCK_BRIDGE_TOKEN   expected auth token (default "test-token")
//   MOCK_BRIDGE_SCRIPT  "default" | "conversation"

import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_BRIDGE_PORT || 8799);
const TOKEN = process.env.MOCK_BRIDGE_TOKEN || "test-token";
const SCRIPT = process.env.MOCK_BRIDGE_SCRIPT || "default";

const ROSTER = {
  npcs: [
    {
      id: "poppy-wayfinder",
      name: "Poppy the Wayfinder",
      role: "Hobble's official greeter, stationed on the spawn peak.",
      dead: false,
      alive: true,
    },
    { id: "sella", name: "Sella", role: "Smith on the edge of bronze.", dead: false, alive: true },
  ],
};

const wss = new WebSocketServer({ port: PORT });

function send(sock, msg) {
  if (sock.readyState === sock.OPEN) sock.send(JSON.stringify(msg));
}

wss.on("connection", (sock) => {
  sock.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.cmd) {
      case "auth": {
        const ok = msg.args && msg.args.token === TOKEN;
        send(sock, { id: msg.id, ok, error: ok ? undefined : "bad token" });
        if (ok) scheduleEvents(sock);
        return;
      }
      case "npc_list":
        send(sock, { id: msg.id, ok: true, data: ROSTER });
        return;
      case "story_get":
        send(sock, { id: msg.id, ok: true, data: { greeted: [] } });
        return;
      case "npc_say":
        // surface the call as a JSON log line so the smoke test can assert on it
        console.error(JSON.stringify({ msg: "npc_say_received", id: msg.args.id, text: msg.args.text }));
        send(sock, { id: msg.id, ok: true, data: { playersHeard: 1 } });
        return;
      case "story_set":
        console.error(JSON.stringify({ msg: "story_set_received", state: msg.args.state }));
        send(sock, { id: msg.id, ok: true, data: {} });
        return;
      default:
        // any other command - reply ok:true defensively so nothing hangs
        send(sock, { id: msg.id, ok: true, data: {} });
    }
  });
});

function scheduleEvents(sock) {
  const timelines = {
    default: [
      [50, "player_join", { player: "Steve", location: { x: 480, y: 75, z: 5, world: "world" } }],
      [150, "player_chat", { player: "Steve", message: "hello?", location: { x: 480, y: 75, z: 5 } }],
      [300, "player_chat", { player: "Steve", message: "anyone home?", location: { x: 481, y: 75, z: 5 } }],
      [2000, "npc_death", { npcId: "sella", npcName: "Sella", dead: true, location: { x: 502, y: 75, z: 2 } }],
    ],
    conversation: [
      [100, "npc_interact", {
        player: "Steve", npcId: "poppy-wayfinder", npcName: "Poppy the Wayfinder",
        npcRole: "Hobble's official greeter, stationed on the spawn peak.",
      }],
      [200, "player_chat", { player: "Steve", message: "Hey Poppy", location: { x: 0, y: 120, z: 3 } }],
    ],
  };
  for (const [delay, event, data] of timelines[SCRIPT] || timelines.default) {
    setTimeout(() => send(sock, { event, data }), delay);
  }
}

console.error(`[mock-bridge] listening on ws://127.0.0.1:${PORT} (script=${SCRIPT})`);
