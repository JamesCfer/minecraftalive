#!/usr/bin/env node
// Smoke test for the gm/ service. Boots the mock bridge, runs the real
// service (index.mjs) against it with GM_DRY_RUN=1 (no Anthropic call, no
// API key needed), and asserts:
//
//   1. auth against the bridge succeeded
//   2. the two rapid player_chat messages were batched into ONE turn
//      alongside the player_join that preceded them
//   3. a later, well-separated event (npc_death) starts its own turn
//   4. the kill switch (GM_DISABLED_FILE present) blocks turns entirely
//   5. the denied tools (run_command, set_time, fill_region) are absent
//      from the allowlist / present in the deny-list, fully namespaced
//
// Exits non-zero on any failure.

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildDeniedToolNames, namespacedTool, MCP_SERVER_NAME } from "../lib/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GM_DIR = path.resolve(__dirname, "..");

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok - ${msg}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${msg}`);
  }
}

function readJsonLines(chunk, sink) {
  for (const line of chunk.toString("utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      sink.push(JSON.parse(trimmed));
    } catch {
      // non-JSON output (e.g. a stray console line) - ignore for parsing,
      // but still surface it for debugging.
      if (process.env.SMOKE_VERBOSE) console.error("[raw]", trimmed);
    }
  }
}

function spawnNode(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: GM_DIR,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (d) => readJsonLines(d, logs));
  child.stderr.on("data", (d) => readJsonLines(d, logs));
  return { child, logs };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(logs, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (logs.some(predicate)) return true;
    await wait(50);
  }
  return false;
}

async function main() {
  console.log("1. Pure config checks (no process needed)");
  const denied = buildDeniedToolNames(["run_command", "set_time", "fill_region"], MCP_SERVER_NAME);
  assert(denied.includes(namespacedTool("run_command")), "run_command is namespaced and denied");
  assert(denied.includes(namespacedTool("set_time")), "set_time is namespaced and denied");
  assert(denied.includes(namespacedTool("fill_region")), "fill_region is namespaced and denied");
  assert(!denied.includes(namespacedTool("npc_say")), "npc_say (a storytelling tool) is NOT denied");
  assert(!denied.includes(namespacedTool("broadcast")), "broadcast (a storytelling tool) is NOT denied");

  console.log("\n2. Debounced batching + reconnect-free happy path");
  const port1 = 8799;
  const bridge1 = spawnNode([path.join(GM_DIR, "test", "mock-bridge.mjs")], {
    MOCK_BRIDGE_PORT: String(port1),
    MOCK_BRIDGE_TOKEN: "test-token",
  });
  await wait(300); // let the mock bridge start listening

  const gm1 = spawnNode([path.join(GM_DIR, "index.mjs")], {
    MCALIVE_URL: `ws://127.0.0.1:${port1}`,
    MCALIVE_TOKEN: "test-token",
    GM_DEBOUNCE_MS: "300",
    GM_DRY_RUN: "1",
    GM_ENABLED: "1",
    GM_LORE_REFRESH_MS: "600000",
    GM_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "gm-usage-")),
  });

  const authed = await waitFor(gm1.logs, (l) => l.msg === "bridge_auth_ok", 5000);
  assert(authed, "gm service authenticated against the bridge");

  const gotFirstTurn = await waitFor(gm1.logs, (l) => l.msg === "turn_starting", 5000);
  assert(gotFirstTurn, "first debounced turn started");

  const turnStarts = gm1.logs.filter((l) => l.msg === "turn_starting");
  const first = turnStarts[0];
  assert(!!first, "captured the first turn_starting log");
  if (first) {
    assert(first.batchSize === 3, `first turn batched all 3 events preceding the gap (got batchSize=${first.batchSize})`);
    const chatCount = first.events.filter((e) => e === "player_chat").length;
    assert(chatCount === 2, `first turn contains both rapid player_chat messages as ONE turn (got ${chatCount})`);
    assert(first.events.includes("player_join"), "first turn also includes the player_join");
  }

  const countTurnStarts = () => gm1.logs.filter((l) => l.msg === "turn_starting").length;
  const gotSecondTurn = await waitFor(gm1.logs, () => countTurnStarts() >= 2, 3000);
  assert(gotSecondTurn, "a second, separate turn started for the later npc_death event");
  const second = gm1.logs.filter((l) => l.msg === "turn_starting")[1];
  if (second) {
    assert(second.events.includes("npc_death"), "second turn is for the npc_death event");
    assert(second.batchSize === 1, `second turn was not merged with the first (batchSize=${second.batchSize})`);
  }

  gm1.child.kill();
  bridge1.child.kill();

  console.log("\n3. Kill switch blocks turns entirely");
  const port2 = 8800;
  const bridge2 = spawnNode([path.join(GM_DIR, "test", "mock-bridge.mjs")], {
    MOCK_BRIDGE_PORT: String(port2),
    MOCK_BRIDGE_TOKEN: "test-token",
  });
  await wait(300);

  const disabledFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gm-disabled-")), "DISABLED");
  fs.writeFileSync(disabledFile, "");

  const gm2 = spawnNode([path.join(GM_DIR, "index.mjs")], {
    MCALIVE_URL: `ws://127.0.0.1:${port2}`,
    MCALIVE_TOKEN: "test-token",
    GM_DEBOUNCE_MS: "300",
    GM_DRY_RUN: "1",
    GM_ENABLED: "1",
    GM_DISABLED_FILE: disabledFile,
    GM_LORE_REFRESH_MS: "600000",
    GM_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "gm-usage-")),
  });

  const authed2 = await waitFor(gm2.logs, (l) => l.msg === "bridge_auth_ok", 5000);
  assert(authed2, "second gm instance authenticated against the bridge");

  const sawSkip = await waitFor(gm2.logs, (l) => l.msg === "turn_skipped_kill_switch", 3000);
  assert(sawSkip, "kill switch skip was logged for the player_join event");
  const sawTurnStart2 = gm2.logs.some((l) => l.msg === "turn_starting");
  assert(!sawTurnStart2, "no agent turn was started while the kill switch file exists");

  gm2.child.kill();
  bridge2.child.kill();

  console.log("\n4. Connect failure keeps retrying instead of exiting");
  const deadPort = 8801; // nothing listening here
  const gm3 = spawnNode([path.join(GM_DIR, "index.mjs")], {
    MCALIVE_URL: `ws://127.0.0.1:${deadPort}`,
    MCALIVE_TOKEN: "test-token",
    GM_DEBOUNCE_MS: "300",
    GM_DRY_RUN: "1",
    GM_ENABLED: "1",
    GM_LORE_REFRESH_MS: "600000",
    GM_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "gm-usage-")),
  });

  const sawTwoRetries = await waitFor(
    gm3.logs,
    () => gm3.logs.filter((l) => l.msg === "bridge_reconnect_scheduled").length >= 2,
    3500
  );
  assert(sawTwoRetries, "at least 2 reconnect attempts were logged within 3.5s");
  assert(gm3.child.exitCode === null, "gm process is still running after repeated connect failures");

  gm3.child.kill();

  console.log("\n5. Conversation fast path answers through npc_say in one API call");
  // A fake Anthropic Messages API that always answers as Poppy.
  const apiPort = 8802;
  let apiCalls = 0;
  const fakeApi = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      apiCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        content: [{
          type: "text",
          text: JSON.stringify({
            lines: [{ npcId: "poppy-wayfinder", text: "Welcome, traveler! Hobble is east, follow the sun downhill." }],
            remember: null,
          }),
        }],
        usage: { input_tokens: 120, output_tokens: 25 },
      }));
    });
  });
  await new Promise((resolve) => fakeApi.listen(apiPort, resolve));

  const port3 = 8803;
  const bridge4 = spawnNode([path.join(GM_DIR, "test", "mock-bridge.mjs")], {
    MOCK_BRIDGE_PORT: String(port3),
    MOCK_BRIDGE_TOKEN: "test-token",
    MOCK_BRIDGE_SCRIPT: "conversation",
  });
  await wait(300);

  const gm4 = spawnNode([path.join(GM_DIR, "index.mjs")], {
    MCALIVE_URL: `ws://127.0.0.1:${port3}`,
    MCALIVE_TOKEN: "test-token",
    GM_DEBOUNCE_MS: "300",
    GM_DRY_RUN: "0",
    GM_FAST_PATH: "1",
    GM_ENABLED: "1",
    GM_LORE_REFRESH_MS: "600000",
    GM_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "gm-usage-")),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
    ANTHROPIC_API_KEY: "test-key",
  });

  const fastDone = await waitFor(gm4.logs, (l) => l.msg === "turn_complete_fast", 8000);
  assert(fastDone, "fast path completed a conversational turn");
  const fastLog = gm4.logs.find((l) => l.msg === "turn_complete_fast");
  if (fastLog) {
    assert(fastLog.linesSpoken === 1, `fast path spoke exactly one line (got ${fastLog.linesSpoken})`);
    assert(fastLog.totalTokens === 145, `fast path reported API token usage (got ${fastLog.totalTokens})`);
  }
  const said = await waitFor(bridge4.logs, (l) => l.msg === "npc_say_received", 2000);
  assert(said, "bridge received an npc_say for the reply");
  const sayLog = bridge4.logs.find((l) => l.msg === "npc_say_received");
  if (sayLog) {
    assert(sayLog.id === "poppy-wayfinder", `npc_say targeted the addressed NPC (got ${sayLog.id})`);
    assert(typeof sayLog.text === "string" && sayLog.text.includes("Welcome"), "npc_say carried the model's line");
  }
  assert(apiCalls === 1, `the whole conversational batch cost exactly one API call (got ${apiCalls})`);
  const noSdkTurn = !gm4.logs.some((l) => l.msg === "fast_path_declined" || l.msg === "fast_path_failed");
  assert(noSdkTurn, "fast path neither declined nor failed (no fallback to a full agent turn)");

  gm4.child.kill();
  bridge4.child.kill();
  fakeApi.close();

  await wait(200);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(1);
});
