#!/usr/bin/env node
// MinecraftAlive MCP bridge: connects to the plugin's WebSocket and exposes
// game-master tools to Claude over MCP stdio.
//
// Env vars:
//   MCALIVE_URL    ws URL of the plugin bridge (default ws://127.0.0.1:8765)
//   MCALIVE_TOKEN  auth token matching plugins/MinecraftAlive/config.yml

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const URL_ = process.env.MCALIVE_URL || "ws://127.0.0.1:8765";
const TOKEN = process.env.MCALIVE_TOKEN || "change-me";

// ---------------- WebSocket bridge client ----------------

let ws = null;
let wsReady = null; // promise resolving when authed
const pending = new Map(); // id -> {resolve, reject}
const events = []; // buffered events from the server
const MAX_EVENTS = 500;
let seq = 0;

function connect() {
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve, reject) => {
    const sock = new WebSocket(URL_);
    const authId = "auth-" + Math.random().toString(36).slice(2);
    let authed = false;

    sock.onopen = () => {
      sock.send(JSON.stringify({ id: authId, cmd: "auth", args: { token: TOKEN } }));
    };
    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.event) {
        events.push({ at: new Date().toISOString(), event: msg.event, data: msg.data });
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
        return;
      }
      if (msg.id === authId) {
        if (msg.ok) { authed = true; ws = sock; resolve(sock); }
        else { reject(new Error("auth failed: " + msg.error)); }
        return;
      }
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.data ?? {});
        else p.reject(new Error(msg.error || "unknown error"));
      }
    };
    sock.onclose = () => {
      ws = null;
      wsReady = null;
      for (const [, p] of pending) p.reject(new Error("connection to Minecraft server lost"));
      pending.clear();
      if (!authed) reject(new Error(`could not connect to ${URL_} - is the server running with the MinecraftAlive plugin?`));
    };
    sock.onerror = () => { /* onclose fires after */ };
  });
  return wsReady;
}

async function call(cmd, args = {}) {
  await connect();
  const id = "r" + (++seq);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, cmd, args }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timed out waiting for server reply to " + cmd));
      }
    }, 15000);
  });
}

// ---------------- MCP server ----------------

const server = new McpServer({ name: "minecraftalive", version: "0.1.0" });

function tool(name, description, shape, handler) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      const data = await handler(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 1) }] };
    } catch (e) {
      return { content: [{ type: "text", text: "ERROR: " + e.message }], isError: true };
    }
  });
}

// passthrough tool: same command name on the plugin side
function pt(name, description, shape) {
  tool(name, description, shape, (args) => call(name, args));
}

const pos = {
  x: z.number(), y: z.number(), z: z.number(),
  world: z.string().optional().describe("world name; defaults to the main world"),
};
const posObj = z.object(pos);

// --- events / status ---
tool("get_events",
  "Drain buffered game events (player_chat, player_join, player_quit, npc_interact, npc_attacked, npc_death, player_death). Call this regularly to see what is happening in the world and react as game master.",
  { filter: z.string().optional().describe("only return events of this type") },
  (a) => {
    const out = a.filter ? events.filter((e) => e.event === a.filter) : [...events];
    if (a.filter) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].event === a.filter) events.splice(i, 1);
    } else {
      events.length = 0;
    }
    return { count: out.length, events: out };
  });

pt("get_server_info", "Server version, worlds with time/weather, and online player count.", {});

// --- world ---
pt("set_block", "Set a single block.", { ...pos, material: z.string().describe("e.g. stone, oak_planks, chest") });
pt("get_block", "Read the block at a position.", pos);
pt("fill_region", "Fill a cuboid region with a material (capped volume). Set hollow=true for walls-only, and use material=air to clear.", {
  x1: z.number(), y1: z.number(), z1: z.number(),
  x2: z.number(), y2: z.number(), z2: z.number(),
  material: z.string(),
  hollow: z.boolean().optional(),
  world: z.string().optional(),
});
pt("set_time", "Set world time: 0=dawn, 6000=noon, 13000=dusk, 18000=midnight.", { time: z.number(), world: z.string().optional() });
pt("set_weather", "Set weather to clear, rain, or thunder.", { weather: z.enum(["clear", "rain", "thunder"]), world: z.string().optional() });
pt("spawn_entity", "Spawn a plain (non-NPC) entity, e.g. ZOMBIE, SHEEP, IRON_GOLEM.", { ...pos, type: z.string() });
pt("remove_entity", "Remove a loaded entity by uuid (from spawn_entity or npc records). Cannot remove players.", { uuid: z.string() });

// --- NPCs ---
const scheduleEntry = z.object({
  start: z.number().describe("world time 0-23999 when this activity begins"),
  action: z.enum(["goto_home", "goto_work", "wander", "idle"]),
  radius: z.number().optional().describe("wander radius, default 8"),
});
pt("npc_spawn",
  "Create a living NPC with a name, role (their character sheet - personality, job, goals), home/work places, and a daily schedule the plugin runs automatically. Example schedule: [{start:0, action:'goto_work'}, {start:6000, action:'wander'}, {start:12500, action:'goto_home'}, {start:14000, action:'idle'}]",
  {
    id: z.string().describe("unique short id, e.g. 'mara-baker'"),
    name: z.string().describe("display name, e.g. 'Mara the Baker'"),
    ...pos,
    entityType: z.string().optional().describe("default MANNEQUIN (player-style body); or VILLAGER, or any living entity type"),
    skin: z.string().optional().describe("Minecraft username whose skin a MANNEQUIN NPC wears, e.g. 'jeb_'"),
    profession: z.string().optional().describe("VILLAGER NPCs only - villager profession: farmer, librarian, weaponsmith..."),
    role: z.string().optional().describe("character sheet: personality, backstory, goals, secrets"),
    home: posObj.optional(),
    work: posObj.optional(),
    schedule: z.array(scheduleEntry).optional(),
  });
pt("npc_update", "Update an NPC's name, role, home, work, schedule, or look. Changing entityType, skin, or profession respawns the backing entity in place (use this to migrate a VILLAGER NPC to a player-style MANNEQUIN).", {
  id: z.string(),
  name: z.string().optional(),
  role: z.string().optional(),
  entityType: z.string().optional().describe("e.g. MANNEQUIN for a player-style body"),
  skin: z.string().optional().describe("Minecraft username whose skin a MANNEQUIN wears"),
  profession: z.string().optional(),
  home: posObj.optional(),
  work: posObj.optional(),
  schedule: z.array(scheduleEntry).optional(),
});
pt("npc_remove", "Remove an NPC permanently.", { id: z.string() });
pt("npc_revive", "Bring a dead NPC back to life at a location (defaults to where they died / their home). Dead NPCs never auto-respawn, so this is the only way back.", {
  id: z.string(),
  x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
  world: z.string().optional(),
});
pt("npc_list", "List all NPCs with their roles, places, schedules, and whether they are alive.", {});
pt("npc_get", "Full record of one NPC.", { id: z.string() });
pt("npc_say", "Make an NPC speak. Nearby players see 'Name: text' in chat and the NPC turns to face the closest player. Use this for dialogue when a player interacts with an NPC.", {
  id: z.string(),
  text: z.string(),
});
pt("npc_move_to", "Walk an NPC to a position (pauses its daily routine for holdSeconds).", {
  id: z.string(), ...pos,
  speed: z.number().optional().describe("1.0 = walk, 1.5 = hurry"),
  holdSeconds: z.number().optional().describe("routine pause, default 60"),
});

// --- players ---
pt("list_players", "Online players with location, health, hunger, level, held item.", {});
pt("give_item", "Give a player an item, optionally with a custom name and lore (great for quest items).", {
  player: z.string(), material: z.string(), amount: z.number().optional(),
  displayName: z.string().optional().describe("MiniMessage formatting allowed, e.g. <gold>Sunfire Key</gold>"),
  lore: z.string().optional(),
});
pt("send_message", "Private message to one player. MiniMessage formatting: <gold>, <italic>, <gray>...", { player: z.string(), text: z.string() });
pt("broadcast", "Message to everyone - use for narration, e.g. '<i><gray>Thunder rolls over the valley...'", { text: z.string() });
pt("show_title", "Large title + subtitle on screen (one player, or everyone if player omitted). Good for chapter headings.", {
  title: z.string(), subtitle: z.string().optional(), player: z.string().optional(),
  seconds: z.number().optional(),
});
pt("play_sound", "Play a sound at a position or to a player. Keys like entity.ender_dragon.growl, ambient.cave, block.bell.use, music_disc.pigstep.", {
  sound: z.string(), player: z.string().optional(),
  x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), world: z.string().optional(),
  volume: z.number().optional(), pitch: z.number().optional(),
});
pt("spawn_particles", "Particle burst at a position. Particles like FLAME, SOUL, HEART, ENCHANT, PORTAL, CLOUD.", {
  ...pos, particle: z.string(), count: z.number().optional(), spread: z.number().optional(),
});
pt("apply_effect", "Apply a potion effect to a player, e.g. speed, glowing, slowness, night_vision.", {
  player: z.string(), effect: z.string(), seconds: z.number().optional(), amplifier: z.number().optional(),
});
pt("teleport_player", "Teleport a player.", { player: z.string(), ...pos });

// --- story ---
pt("story_get", "Read persistent story memory (arbitrary JSON you control). Survives server and session restarts - keep plot state, quest progress, NPC relationships here.", {});
pt("story_set", "Merge keys into story memory. Set a key to null to delete it.", {
  state: z.record(z.any()).describe("keys to merge into the story state"),
});
pt("bossbar_set", "Create/update a boss bar shown to all players - quest headers, tension meters, countdowns.", {
  id: z.string(), text: z.string(), progress: z.number().optional().describe("0..1"),
  color: z.enum(["PINK", "BLUE", "RED", "GREEN", "YELLOW", "PURPLE", "WHITE"]).optional(),
});
pt("bossbar_remove", "Remove a boss bar.", { id: z.string() });
pt("run_command", "Run a console command (only if allow-console-commands is enabled in the plugin config).", { command: z.string() });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[minecraftalive-mcp] ready, bridging to ${URL_}`);
