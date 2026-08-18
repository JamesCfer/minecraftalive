# MinecraftAlive

A Paper plugin + MCP bridge that lets Claude act as a **living game master** for your Minecraft server: spawning NPCs with jobs and daily routines, speaking through them, editing the world, running quests, and reacting to what players do — all through MCP tools.

```
Claude (Claude Code / Desktop)
   │  MCP stdio
   ▼
mcp/server.mjs  ── WebSocket (token auth) ──►  MinecraftAlive plugin  ──►  Paper 1.21 server
                                                    │
                                                    └─ NPC routines tick on their own;
                                                       Claude directs the story
```

## Parts

- **`plugin/`** — Paper 1.21 plugin. Built jar: `plugin/target/MinecraftAlive-0.1.0.jar`. Embeds a WebSocket server (default `ws://127.0.0.1:8765`) and runs NPC daily routines, persistence, and event forwarding.
- **`mcp/`** — Node MCP server (stdio) exposing 29 game-master tools that talk to the plugin.

## Setup

### 1. Install the plugin

Drop `plugin/target/MinecraftAlive-0.1.0.jar` into your Paper 1.21.x server's `plugins/` folder and start the server once. Then edit `plugins/MinecraftAlive/config.yml`:

```yaml
bridge:
  host: 127.0.0.1
  port: 8765
  token: pick-a-long-random-token   # CHANGE THIS
allow-console-commands: false        # true = Claude may run console commands
```

Restart the server. The log should show `MinecraftAlive bridge listening on ws://127.0.0.1:8765`.

### 2. Register the MCP server with Claude

```bash
cd mcp && npm install
```

Then add it to Claude Code (from any directory):

```bash
claude mcp add minecraftalive -e MCALIVE_TOKEN=pick-a-long-random-token -- node J:/Desktop/Celestia/Development/Mods/minecraftalive/mcp/server.mjs
```

Or for Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "minecraftalive": {
      "command": "node",
      "args": ["J:/Desktop/Celestia/Development/Mods/minecraftalive/mcp/server.mjs"],
      "env": { "MCALIVE_TOKEN": "pick-a-long-random-token" }
    }
  }
}
```

`MCALIVE_URL` can be set too if the server is not on `ws://127.0.0.1:8765`.

### 3. Play

Start a Claude session and say something like:

> You are the game master of my Minecraft world. Check `get_server_info` and `list_players`, then build a small village near me, populate it with 3 NPCs who have names, jobs, personalities, and daily schedules. Poll `get_events` regularly — when a player right-clicks an NPC, answer through `npc_say` in character. Keep long-term plot state in `story_set`.

A `/loop` (Claude Code) or a recurring "check events" nudge keeps the world alive while players play.

## What Claude can do

| Area | Tools |
|---|---|
| Sense the world | `get_server_info`, `list_players`, `get_block`, `get_events` (chat, joins, NPC interactions, deaths...) |
| Edit the world | `set_block`, `fill_region` (hollow option, volume-capped), `set_time`, `set_weather`, `spawn_entity` |
| Living NPCs | `npc_spawn` (name, role sheet, home/work, daily schedule), `npc_update`, `npc_say`, `npc_move_to`, `npc_list`, `npc_get`, `npc_remove` |
| Direct players | `give_item` (custom names/lore), `send_message`, `broadcast`, `show_title`, `play_sound`, `spawn_particles`, `apply_effect`, `teleport_player` |
| Story | `story_get`/`story_set` (persistent JSON memory), `bossbar_set`/`bossbar_remove`, `run_command` (config-gated) |

NPCs persist across restarts (`plugins/MinecraftAlive/npcs.json`), respawn if their entity goes missing, and follow their schedule autonomously — walking to work at dawn, wandering their workplace, heading home at dusk — so the world keeps living between Claude's decisions.

### NPC schedule format

World time: 0 = dawn, 6000 = noon, 12000 ≈ dusk, 18000 = midnight.

```json
[
  { "start": 0,     "action": "goto_work" },
  { "start": 2000,  "action": "wander", "radius": 10 },
  { "start": 12500, "action": "goto_home" },
  { "start": 14000, "action": "idle" }
]
```

## Building from source

Requires JDK 21+ and Maven:

```bash
mvn -f plugin/pom.xml package
```

## Security notes

- The bridge binds to `127.0.0.1` by default and requires the token before accepting any command.
- `run_command` (arbitrary console commands) is **off** by default; everything else is limited to the game APIs above.
- `fill_region` is capped by `max-fill-volume` (default 100k blocks) so a bad call can't freeze the server.
