// Loads gm/lore/*.md (sorted by filename) and concatenates them into the
// system prompt. Call watchLore() to re-read on a timer so edits to the
// lore files land without restarting the service.

import fs from "node:fs/promises";
import path from "node:path";

export async function loadLore(loreDir) {
  let entries;
  try {
    entries = await fs.readdir(loreDir);
  } catch {
    return "";
  }
  const files = entries.filter((f) => f.toLowerCase().endsWith(".md")).sort();
  const parts = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(loreDir, f), "utf8");
    parts.push(text.trim());
  }
  return parts.join("\n\n---\n\n");
}

/**
 * Polls `loreDir` every `intervalMs` and calls `onChange(newText)` whenever
 * the concatenated content differs from what was last loaded. Returns a
 * `{ stop }` handle and the initial text is available synchronously via
 * `state.value` right after the returned promise resolves.
 */
export function watchLore(loreDir, intervalMs, onChange) {
  let current = null;
  const tick = async () => {
    try {
      const text = await loadLore(loreDir);
      if (text !== current) {
        current = text;
        onChange(text);
      }
    } catch (e) {
      // Keep serving the last-known-good lore on read errors.
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
