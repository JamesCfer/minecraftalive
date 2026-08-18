// Conversation fast path: when a debounced batch is purely conversational
// (player_chat / npc_interact), answer it with ONE direct Anthropic
// Messages API call instead of a full Agent SDK turn. A full turn spawns a
// Claude Code subprocess and makes 4-7 sequential tool-call round-trips
// (npc_list -> npc_get -> story_get -> npc_say -> ...), which lands at
// 20-60s; this path pre-loads the same context (NPC records, story state,
// recent dialogue) into a single prompt, so a reply costs one model
// round-trip and arrives in a few seconds.
//
// Anything non-conversational — and any conversational batch this path
// can't confidently handle (no NPC addressed, API/bridge error) — falls
// back to the full agent turn in agent-turn.mjs.

import { log } from "./logger.mjs";

export const FAST_PATH_EVENTS = new Set(["player_chat", "npc_interact"]);

/** Cheap pre-check: is this batch made only of conversational events? */
export function isFastPathCandidate(batch) {
  return batch.length > 0 && batch.every((e) => FAST_PATH_EVENTS.has(e.event));
}

/**
 * Which living NPCs is this batch talking to? Right-clicked NPCs count
 * directly; chat messages count when they contain a living NPC's name (or
 * its first word, so "Hey Poppy" reaches "Poppy the Wayfinder").
 * @returns {Map<string, object>} npcId -> npc record
 */
export function matchTargets(batch, roster) {
  const byId = new Map();
  for (const npc of roster) {
    if (npc && npc.id && !npc.dead) byId.set(npc.id, npc);
  }
  const targets = new Map();
  for (const { event, data } of batch) {
    if (event === "npc_interact" && data && byId.has(data.npcId)) {
      targets.set(data.npcId, byId.get(data.npcId));
    }
    if (event === "player_chat" && data && typeof data.message === "string") {
      const msg = data.message.toLowerCase();
      for (const npc of byId.values()) {
        const first = String(npc.name || "").split(/\s+/)[0].toLowerCase();
        if (first && msg.includes(first)) targets.set(npc.id, npc);
      }
    }
  }
  return targets;
}

/** Collapse right-click spam into one line per NPC with a count. */
function describeBatch(batch) {
  const out = [];
  const interactCounts = new Map(); // npcId -> {npcName, player, count}
  for (const { event, data, at } of batch) {
    if (event === "npc_interact" && data) {
      const cur = interactCounts.get(data.npcId) || { npcName: data.npcName, player: data.player, count: 0 };
      cur.count += 1;
      interactCounts.set(data.npcId, cur);
    } else if (event === "player_chat" && data) {
      out.push({ at, event, player: data.player, message: data.message, location: data.location });
    }
  }
  for (const [npcId, c] of interactCounts) {
    out.push({ event: "npc_interact", npcId, npcName: c.npcName, player: c.player, times: c.count });
  }
  return out;
}

const FAST_PATH_INSTRUCTIONS = `
FAST CONVERSATION MODE. A player is talking to (or right-clicking) one or
more NPCs right now and expects an in-character answer within seconds. You
are answering AS those NPCs, per your standing rules (speak through NPCs,
stay in character, copper-age tone, never railroad).

Respond with ONLY a JSON object, no prose and no code fences:
{
  "lines": [{"npcId": "<id>", "text": "<what the NPC says in chat>"}],
  "remember": {"<story key>": <value>} | null
}

- 1-2 short lines is almost always right; an NPC talks like a person, not a
  quest log. Split longer thoughts across multiple lines.
- Only use npcId values from the "NPCs being addressed" records provided.
- "remember" is merged into persistent story memory via story_set; use it
  only when something durable happened (a promise, a name learned, a hook
  raised), else null.
- If the messages genuinely need no reply, return {"lines": [], "remember": null}.
`.trim();

export function buildFastPrompt({ batch, targets, story, memory }) {
  const parts = [];
  parts.push("NPCs being addressed (full records):");
  parts.push(JSON.stringify([...targets.values()], null, 1));
  parts.push("\nPersistent story memory (story_get):");
  parts.push(JSON.stringify(story ?? {}, null, 1));
  if (memory.length > 0) {
    parts.push("\nRecent dialogue (oldest first, from this GM process):");
    parts.push(memory.map((m) => `${m.speaker}: ${m.text}`).join("\n"));
  }
  parts.push("\nWhat just happened (debounced batch, right-click spam collapsed):");
  parts.push(JSON.stringify(describeBatch(batch), null, 1));
  parts.push("\n" + FAST_PATH_INSTRUCTIONS);
  return parts.join("\n");
}

function parseModelJson(text) {
  let t = String(text).trim();
  // tolerate a fenced block despite the instructions
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1];
  return JSON.parse(t);
}

function pushMemory(memory, speaker, text, cap = 40) {
  memory.push({ speaker, text });
  if (memory.length > cap) memory.splice(0, memory.length - cap);
}

/**
 * @param {object} params
 * @param {Array<{event:string,data:any,at:string}>} params.batch
 * @param {object} params.config - loadConfig() result
 * @param {import("./bridge-commands.mjs").BridgeCommandClient} params.bridge
 * @param {string} params.loreText - concatenated lore (system prompt)
 * @param {Array<{speaker:string,text:string}>} params.memory - rolling dialogue log, mutated in place
 * @returns {Promise<{handled:boolean, reason?:string, inputTokens?:number, outputTokens?:number, totalTokens?:number}>}
 */
export async function runFastPath({ batch, config, bridge, loreText, memory }) {
  if (!isFastPathCandidate(batch)) return { handled: false, reason: "non_conversational_event" };
  if (!config.anthropicApiKey) return { handled: false, reason: "no_api_key" };

  const rosterData = await bridge.call("npc_list");
  const roster = Array.isArray(rosterData && rosterData.npcs) ? rosterData.npcs : [];
  const targets = matchTargets(batch, roster);
  if (targets.size === 0) return { handled: false, reason: "no_npc_addressed" };

  const story = await bridge.call("story_get").catch(() => ({}));
  const prompt = buildFastPrompt({ batch, targets, story, memory });

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), config.fastPathTimeoutMs);
  if (typeof deadline.unref === "function") deadline.unref();
  let res;
  try {
    res = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.fastPathMaxTokens,
        system: loreText,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(deadline);
  }
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const reply = parseModelJson(text);
  const lines = Array.isArray(reply.lines) ? reply.lines : [];

  // record what the players said before what the NPCs answer
  for (const { event, data: d } of batch) {
    if (event === "player_chat" && d) pushMemory(memory, d.player, d.message);
  }

  let spoke = 0;
  for (const line of lines) {
    if (!line || typeof line.text !== "string" || !targets.has(line.npcId)) {
      log.warn("fast_path_line_skipped", { line });
      continue;
    }
    await bridge.call("npc_say", { id: line.npcId, text: line.text });
    pushMemory(memory, targets.get(line.npcId).name, line.text);
    spoke += 1;
  }
  if (reply.remember && typeof reply.remember === "object" && Object.keys(reply.remember).length > 0) {
    await bridge.call("story_set", { state: reply.remember }).catch((e) =>
      log.warn("fast_path_story_set_failed", { error: String(e) }));
  }

  const usage = data.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  log.info("turn_complete_fast", {
    linesSpoken: spoke,
    npcs: [...targets.keys()],
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  });
  return { handled: true, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}
