// Central place for env-driven configuration and the pure helpers around it,
// so the smoke test can import and assert on them without booting the
// whole service.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GM_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(GM_ROOT, "..");

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool01(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

// The name the game-tools MCP server is registered under. Tool names as
// seen by the model are namespaced "mcp__<this>__<toolName>".
export const MCP_SERVER_NAME = "minecraftalive";

// Tools denied by default and why:
//   run_command  - arbitrary console commands; unattended + no human review
//   set_time     - rule #1 of the lore is "rarely if ever change the time of day"
//   fill_region  - large-volume world edits; too easy for an ambient reactive
//                  loop to accidentally reshape the map with no one watching
export const DEFAULT_DENIED_TOOLS = "run_command,set_time,fill_region";

export const WAKE_EVENTS = new Set([
  "player_join",
  "player_chat",
  "npc_interact",
  "npc_death",
  "player_death",
]);

export function loadConfig(env = process.env) {
  return {
    mcaliveUrl: env.MCALIVE_URL || "ws://127.0.0.1:8765",
    mcaliveToken: env.MCALIVE_TOKEN || "change-me",

    debounceMs: num("GM_DEBOUNCE_MS", 2500),
    loreRefreshMs: num("GM_LORE_REFRESH_MS", 600000),
    dailyTokenBudget: num("GM_DAILY_TOKEN_BUDGET", 500000),
    maxTurnsPerMin: num("GM_MAX_TURNS_PER_MIN", 6),
    deniedTools: (env.GM_DENIED_TOOLS ?? DEFAULT_DENIED_TOOLS)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    model: env.GM_MODEL || "claude-haiku-4-5-20251001",
    enabled: bool01("GM_ENABLED", true),
    dryRun: bool01("GM_DRY_RUN", false),
    loreDir: env.GM_LORE_DIR || path.join(GM_ROOT, "lore"),
    stateDir: env.GM_STATE_DIR || path.join(GM_ROOT, "state"),
    disabledFile: env.GM_DISABLED_FILE || path.join(GM_ROOT, "DISABLED"),
    mcpServerPath: env.GM_MCP_SERVER_PATH || path.join(REPO_ROOT, "mcp", "server.mjs"),
    maxTurns: num("GM_MAX_AGENT_STEPS", 12),
    reconnectBaseMs: num("GM_RECONNECT_BASE_MS", 1000),
    reconnectMaxMs: num("GM_RECONNECT_MAX_MS", 30000),
  };
}

/** Turn a bare tool-command name into the fully-namespaced MCP tool name the model sees. */
export function namespacedTool(toolName, serverName = MCP_SERVER_NAME) {
  return `mcp__${serverName}__${toolName}`;
}

export function buildDeniedToolNames(deniedTools, serverName = MCP_SERVER_NAME) {
  return deniedTools.map((t) => namespacedTool(t, serverName));
}
