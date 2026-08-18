#!/usr/bin/env node
// MinecraftAlive autonomous game master.
//
// Opens a WebSocket connection to the plugin bridge purely to receive
// pushed events (the wake-up signal). Debounces bursts of events into a
// single batch and hands each batch to one Claude Agent SDK turn, which
// gets its game abilities exclusively through mcp/server.mjs (loaded as a
// stdio MCP server) - never by reimplementing tools here.
//
// See gm/README.md for env vars and guardrails.

import fs from "node:fs";
import { loadConfig, WAKE_EVENTS } from "./lib/config.mjs";
import { log } from "./lib/logger.mjs";
import { loadLore, watchLore } from "./lib/lore.mjs";
import { UsageTracker } from "./lib/usage-tracker.mjs";
import { RateLimiter } from "./lib/rate-limiter.mjs";
import { BridgeEventClient } from "./lib/bridge-events.mjs";
import { BridgeCommandClient } from "./lib/bridge-commands.mjs";
import { EventScheduler } from "./lib/event-scheduler.mjs";
import { runAgentTurn } from "./lib/agent-turn.mjs";
import { isFastPathCandidate, runFastPath } from "./lib/fast-path.mjs";

export async function main(env = process.env) {
  const config = loadConfig(env);

  log.info("gm_starting", {
    model: config.model,
    dryRun: config.dryRun,
    enabled: config.enabled,
    debounceMs: config.debounceMs,
    dailyTokenBudget: config.dailyTokenBudget,
    maxTurnsPerMin: config.maxTurnsPerMin,
    deniedTools: config.deniedTools,
    fastPath: config.fastPath,
    mcaliveUrl: config.mcaliveUrl,
  });

  const usage = await new UsageTracker(config.stateDir, config.dailyTokenBudget).load();
  const rateLimiter = new RateLimiter(config.maxTurnsPerMin, 60000);

  const lore = { text: await loadLore(config.loreDir) };
  const loreWatch = watchLore(config.loreDir, config.loreRefreshMs, (text) => {
    lore.text = text;
    log.info("lore_reloaded", { bytes: text.length });
  });

  const onlinePlayers = new Set();
  // Lazy command connection + rolling dialogue log for the conversation
  // fast path. The log only survives as long as this process, but the fast
  // path can also persist durable facts via story_set.
  const commandBridge = new BridgeCommandClient({ url: config.mcaliveUrl, token: config.mcaliveToken });
  const dialogueMemory = [];

  function isKillSwitchActive() {
    if (!config.enabled) return true;
    try {
      return fs.existsSync(config.disabledFile);
    } catch {
      return false;
    }
  }

  async function runTurn(batch) {
    if (isKillSwitchActive()) {
      log.warn("turn_skipped_kill_switch", { batchSize: batch.length });
      return;
    }
    if (usage.isOverBudget()) {
      log.warn("turn_skipped_budget_exceeded", {
        tokensUsed: usage.tokens,
        dailyTokenBudget: config.dailyTokenBudget,
      });
      return;
    }
    if (!rateLimiter.tryAcquire()) {
      log.warn("turn_skipped_rate_limited", {
        maxTurnsPerMin: config.maxTurnsPerMin,
        retryInMs: rateLimiter.msUntilSlot(),
      });
      // Re-queue: put the events back so the next debounce cycle retries them.
      scheduler.pending.unshift(...batch);
      return;
    }

    log.info("turn_starting", {
      batchSize: batch.length,
      events: batch.map((e) => e.event),
    });

    if (config.fastPath && !config.dryRun && isFastPathCandidate(batch)) {
      try {
        const fast = await runFastPath({
          batch, config, bridge: commandBridge, loreText: lore.text, memory: dialogueMemory,
        });
        if (fast.handled) {
          if (fast.totalTokens > 0) await usage.addTokens(fast.totalTokens);
          return;
        }
        log.info("fast_path_declined", { reason: fast.reason });
      } catch (e) {
        log.warn("fast_path_failed", { error: String(e && e.stack || e) });
      }
      // fall through to a full agent turn
    }

    const result = await runAgentTurn({ batch, systemPrompt: lore.text, config });
    if (result.totalTokens > 0) {
      await usage.addTokens(result.totalTokens);
    }
  }

  const scheduler = new EventScheduler({ debounceMs: config.debounceMs, runTurn });

  const bridge = new BridgeEventClient({
    url: config.mcaliveUrl,
    token: config.mcaliveToken,
    baseMs: config.reconnectBaseMs,
    maxMs: config.reconnectMaxMs,
    onEvent(event, data) {
      log.info("event_received", { event, data });
      if (event === "player_join" && data && data.player) onlinePlayers.add(data.player);
      if (event === "player_quit") {
        if (data && data.player) onlinePlayers.delete(data.player);
        return; // update state only, never wakes the GM
      }
      if (!WAKE_EVENTS.has(event)) return;
      scheduler.push(event, data);
    },
  });
  bridge.start();

  return {
    config,
    usage,
    rateLimiter,
    scheduler,
    bridge,
    stop() {
      bridge.stop();
      commandBridge.close();
      loreWatch.stop();
    },
  };
}

main().catch((e) => {
  log.error("gm_fatal", { error: String(e && e.stack || e) });
  process.exit(1);
});
