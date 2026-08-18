# gm/ — Autonomous Game Master

An always-on, event-driven service that lets the world keep living when no
one is running a Claude Code session. It watches the plugin bridge for
things happening in the world (players joining, chatting, talking to NPCs,
dying; NPCs dying) and reacts through the same game tools a human-driven
Claude Code session would use — narrating small, believable touches through
NPCs, never forcing anything on players.

It does **not** reimplement any game ability. All game actions go through
the existing `mcp/server.mjs` bridge, loaded as a stdio MCP server for the
Claude Agent SDK, exactly as a Claude Code session would use it.

```
plugin bridge (ws://.../8765)
   │
   ├─ gm/index.mjs's OWN ws connection ──► just listens for pushed events
   │                                        (wake-up signal, auto-reconnect)
   │
   └─ mcp/server.mjs, spawned by the      ──► actually calls game tools
      Agent SDK as a stdio MCP server        (npc_say, story_set, ...)
         ▲
         │ query({ prompt, options }) — one call per debounced event batch
    @anthropic-ai/claude-agent-sdk
```

## The conversation fast path

A full agent turn spawns a Claude Code subprocess and makes 4–7 sequential
tool-call round-trips (`npc_list` → `npc_get` → `story_get` → `npc_say` →
wrap-up), which lands at 20–60 seconds — fine for ambient storytelling,
hopeless for a player standing in front of an NPC waiting for an answer.

So batches that are *purely conversational* (only `player_chat` /
`npc_interact` events, addressed at a living NPC — right-clicked, or named
in chat) skip the Agent SDK entirely. The GM pre-loads the same context
(the addressed NPCs' records, story memory, a rolling log of recent
dialogue) into a single prompt, makes **one** direct Messages API call, and
delivers the reply via `npc_say` over its own bridge command connection
(`lib/bridge-commands.mjs` — same `{id, cmd, args}` protocol as
`mcp/server.mjs`, no game logic reimplemented). Typical reply latency is
the debounce window plus one model round-trip: **3–5 seconds**.

The fast path can also persist durable facts (a promise made, a name
learned) via `story_set`, and it falls back to a full agent turn whenever
it can't confidently handle a batch (no NPC addressed, mixed event types,
bridge/API errors). All guardrails below (budget, rate limit, kill switch)
apply to fast-path turns exactly as to full turns. Disable it with
`GM_FAST_PATH=0`.

## Why event-driven, not polling

Idle costs zero tokens. The service only starts an agent turn when
something happens (see "Wake events" below) and batches bursts of activity
into a single turn via debouncing, so e.g. a chatty player firing off five
chat messages in two seconds costs one turn, not five.

## Setup

### 1. Get an API key

The Agent SDK needs `ANTHROPIC_API_KEY` in the environment the service runs
in (create one at https://console.anthropic.com/settings/keys). It is read
from the process environment automatically — there's nothing to configure
in this repo for it.

### 2. Install dependencies

```bash
cd gm
npm install
```

### 3. Configure env vars

At minimum, point it at your plugin bridge (same values as `mcp/`'s
`MCALIVE_URL` / `MCALIVE_TOKEN`):

```bash
export MCALIVE_URL=ws://127.0.0.1:8765
export MCALIVE_TOKEN=pick-a-long-random-token   # must match plugins/MinecraftAlive/config.yml
export ANTHROPIC_API_KEY=sk-ant-...
```

See [Environment variables](#environment-variables) below for everything
else, all of which has sane defaults.

### 4. Run it

```bash
npm start
```

Run this under whatever keeps a process alive on your machine (a systemd
unit, pm2, a `screen`/`tmux` session, NSSM/Task Scheduler on Windows,
etc.) — `gm/` is deliberately just a plain Node script with no daemonizing
of its own.

## Guardrails

This runs completely unattended with world-editing power, so it is
deliberately more locked down than an interactive Claude Code session:

| Guardrail | Default | Env override |
|---|---|---|
| Tool deny-list | `run_command,set_time,fill_region` | `GM_DENIED_TOOLS` (comma-separated) |
| Daily token budget | 500,000 tokens/day (UTC) | `GM_DAILY_TOKEN_BUDGET` |
| Rate limit | 6 agent turns/minute | `GM_MAX_TURNS_PER_MIN` |
| Kill switch | off (service runs) | `GM_ENABLED=0`, or create the file `gm/DISABLED` |
| Model | `claude-haiku-4-5-20251001` | `GM_MODEL` |

**Why `run_command` and `set_time` are denied by default:** `run_command`
is arbitrary console access with no human reviewing it. `set_time` is
denied because the lore's rule #1 is "rarely if ever change the time of
day" — an ambient loop with `set_time` available will eventually reach for
it as a cheap dramatic beat, which is exactly what the rule exists to
prevent.

**Why `fill_region` is denied by default:** it's the one tool that can
reshape a large volume of the map in a single call. `mcp/server.mjs` caps
its volume server-side, but that cap is sized for a deliberate, watched
build — not for an ambient reactive loop making unsupervised judgment calls
about the map, where a bad decision could still visibly scar the world
before anyone notices. Re-enable it (via `GM_DENIED_TOOLS`) only if you're
comfortable with that.

The kill switch is checked on every debounced batch: while active, the
service still connects to the bridge and logs incoming events (so you can
see what it *would* have reacted to), it just never starts an agent turn.

**Raising the model for bigger story beats:** `GM_MODEL` defaults to Haiku
because ambient reactions (an NPC waving, a one-line remark) should be
cheap. For a planned, larger story beat (a village-shaking event, kicking
off a new quest arc), either temporarily set `GM_MODEL=claude-sonnet-5` (or
`claude-opus-4-8`) before restarting the service, or just drive that beat
yourself from an interactive Claude Code session pointed at `mcp/` — the
two are not mutually exclusive, and persistent state (`story_get`/`set`)
is shared between them.

## Lore (`gm/lore/`)

Everything in `gm/lore/*.md` is loaded, sorted by filename, and
concatenated into the agent's system prompt:

- `00-rules.md` — the game master's standing operating rules (pacing,
  how to speak through NPCs, permanence of death, tone/power level).
- `10-world.md` — spawn, the village of Hobble, and the open story hooks.

Edit these files freely — the service re-reads `gm/lore/` on a timer
(`GM_LORE_REFRESH_MS`, default 10 minutes) and picks up changes without a
restart. Add more numbered files if you want to grow the lore further; the
numeric prefix just controls read order.

The NPC roster itself is **not** hardcoded in lore — it's live data read
via the `npc_list` / `npc_get` tools, since it changes as NPCs are added,
move, or die.

## Testing (no API key, no Minecraft server required)

```bash
npm test
```

This boots `gm/test/mock-bridge.mjs` (a minimal WebSocket server that
performs the real auth handshake and then emits a scripted sequence of
fake events), runs `gm/index.mjs` against it with `GM_DRY_RUN=1`, and
asserts:

- the auth handshake against the bridge succeeds
- two rapid `player_chat` events get batched into a single agent turn
  together with the `player_join` that preceded them
- a later, well-separated event starts its own, separate turn
- the kill switch (`GM_DISABLED_FILE` / `gm/DISABLED`) blocks turns
  entirely while still connecting and logging events
- the denied tools are absent from the allowlist (present, fully
  namespaced, in the deny-list) while storytelling tools are not
- a purely conversational batch (right-click + "Hey Poppy") is answered by
  the fast path in exactly one API call (against a fake local Messages API)
  and lands as an `npc_say` on the bridge

It exits non-zero if any assertion fails.

### Dry run against a real server

Set `GM_DRY_RUN=1` (with real `MCALIVE_URL`/`MCALIVE_TOKEN` pointed at your
actual plugin bridge) to see exactly what prompt + system prompt the
service *would* send for real events, without spending any tokens or
touching the Anthropic API at all:

```bash
GM_DRY_RUN=1 npm start
```

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `MCALIVE_URL` | `ws://127.0.0.1:8765` | Plugin bridge WebSocket URL (both for the GM's own event connection and the MCP tool server it spawns) |
| `MCALIVE_TOKEN` | `change-me` | Auth token matching `plugins/MinecraftAlive/config.yml` |
| `GM_DEBOUNCE_MS` | `2500` | How long to collect events into a batch before starting one agent turn |
| `GM_LORE_REFRESH_MS` | `600000` | How often to re-read `gm/lore/*.md` |
| `GM_DAILY_TOKEN_BUDGET` | `500000` | Cumulative input+output tokens/day (resets at UTC midnight) before new turns stop starting |
| `GM_MAX_TURNS_PER_MIN` | `6` | Max agent turns started per rolling 60s window |
| `GM_DENIED_TOOLS` | `run_command,set_time,fill_region` | Comma-separated bare tool names to deny |
| `GM_MODEL` | `claude-haiku-4-5-20251001` | Model used for ambient turns |
| `GM_FAST_PATH` | `1` | `0` disables the conversation fast path (everything goes through full agent turns) |
| `GM_FAST_PATH_MAX_TOKENS` | `800` | `max_tokens` for the single fast-path API call |
| `GM_FAST_PATH_TIMEOUT_MS` | `20000` | Abort the fast-path API call after this long (falls back to a full turn) |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | API base URL for the fast path (the smoke test points this at a fake) |
| `GM_ENABLED` | `1` | Set to `0` as a kill switch (equivalent to the `gm/DISABLED` file) |
| `GM_DRY_RUN` | `0` | `1` = log the prompt/system prompt instead of calling the Anthropic API |
| `GM_LORE_DIR` | `gm/lore` | Where lore `.md` files are read from |
| `GM_STATE_DIR` | `gm/state` | Where `usage.json` (daily token counter) is kept |
| `GM_DISABLED_FILE` | `gm/DISABLED` | Presence of this file is the kill switch |
| `GM_MCP_SERVER_PATH` | `mcp/server.mjs` (sibling dir) | Path to the stdio MCP server the Agent SDK spawns for game tools |
| `GM_MAX_AGENT_STEPS` | `12` | `maxTurns` passed to the Agent SDK per batch (tool-call steps within one turn, not to be confused with `GM_MAX_TURNS_PER_MIN`) |
| `GM_RECONNECT_BASE_MS` / `GM_RECONNECT_MAX_MS` | `1000` / `30000` | Exponential backoff bounds for reconnecting to the plugin bridge |

## Files

- `index.mjs` — wires everything together: bridge event connection, event
  debouncer, guardrail checks, and the agent turn call.
- `lib/config.mjs` — env parsing and pure helpers (tool namespacing/deny
  list) shared with the smoke test.
- `lib/bridge-events.mjs` — the GM's own WebSocket client, auth handshake,
  auto-reconnect with exponential backoff.
- `lib/event-scheduler.mjs` — debouncing + the "never run two turns
  concurrently, queue what arrives mid-turn" logic.
- `lib/agent-turn.mjs` — builds the prompt and calls the Claude Agent SDK
  (or logs it and returns early under `GM_DRY_RUN`).
- `lib/fast-path.mjs` — the conversation fast path: one direct Messages API
  call for purely conversational batches (see above).
- `lib/bridge-commands.mjs` — the fast path's own command connection to the
  plugin bridge (`npc_list`/`story_get`/`npc_say`/`story_set`).
- `lib/usage-tracker.mjs` — daily token budget, persisted to
  `gm/state/usage.json`.
- `lib/rate-limiter.mjs` — sliding-window turns-per-minute limiter.
  `lib/lore.mjs` — loads and watches `gm/lore/*.md`.
- `lore/` — the world's lore, loaded into the system prompt (see above).
- `test/mock-bridge.mjs`, `test/smoke.mjs` — see Testing above.
