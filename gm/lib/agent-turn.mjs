// Runs exactly one agent turn for a batch of debounced world events,
// through the Claude Agent SDK's query(). The GM's game abilities come
// entirely from mcp/server.mjs, wired in as a stdio MCP server - this
// module never reimplements a game tool.
//
// Verified against @anthropic-ai/claude-agent-sdk 0.3.234's sdk.d.ts.

import { log } from "./logger.mjs";
import { buildDeniedToolNames, MCP_SERVER_NAME } from "./config.mjs";

const STANDING_REMINDER = `You are the autonomous, always-on game master for this Minecraft world.
The JSON below is a batch of world events that happened just now while no
human operator was watching. Follow your lore/system-prompt rules exactly:
weave small, believable narrative touches around what players actually did,
never force anything on them, speak through NPCs with npc_say, and prefer
restraint over grand interventions. Use npc_list / npc_get to read the
current NPC roster and story_get to read persistent plot state before
inventing anything. If nothing warrants a reaction, it is fine to do
nothing at all.`;

export function buildPrompt(batch) {
  return `${STANDING_REMINDER}\n\nEvents batch (JSON):\n${JSON.stringify(batch, null, 1)}`;
}

/**
 * @param {object} params
 * @param {Array} params.batch - debounced events
 * @param {string} params.systemPrompt - concatenated lore
 * @param {object} params.config - loadConfig() result
 * @returns {Promise<{ inputTokens: number, outputTokens: number, totalTokens: number, dryRun: boolean }>}
 */
export async function runAgentTurn({ batch, systemPrompt, config }) {
  const prompt = buildPrompt(batch);
  const disallowedTools = buildDeniedToolNames(config.deniedTools, MCP_SERVER_NAME);

  if (config.dryRun) {
    log.info("dry_run_turn", {
      systemPrompt,
      prompt,
      model: config.model,
      disallowedTools,
    });
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, dryRun: true };
  }

  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const options = {
    model: config.model,
    systemPrompt,
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "stdio",
        command: "node",
        args: [config.mcpServerPath],
        env: {
          MCALIVE_URL: config.mcaliveUrl,
          MCALIVE_TOKEN: config.mcaliveToken,
        },
      },
    },
    // No built-in Claude Code tools (Bash/Read/Write/Edit/...) - this is a
    // game master, not a coding agent, and it runs completely unattended.
    tools: [],
    disallowedTools,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: config.maxTurns,
  };

  let usage = { input_tokens: 0, output_tokens: 0 };
  let resultText = null;
  for await (const msg of query({ prompt, options })) {
    if (msg.type === "result") {
      usage = msg.usage || usage;
      resultText = msg.subtype === "success" ? msg.result : `error: ${msg.subtype}`;
    }
  }

  const inputTokens = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;
  log.info("turn_complete", {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    result: resultText,
  });
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, dryRun: false };
}
