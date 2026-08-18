export const meta = {
  name: 'mc-migrate-npcs',
  description: 'Migrate existing MinecraftAlive NPCs to player-style MANNEQUIN bodies, preserving identity',
  whenToUse: 'After a plugin upgrade that changes NPC entity types. Agents read each NPC record from the server, so character sheets never pass through the planner.',
  phases: [{ title: 'Migrate', detail: 'batch of NPC ids per agent' }],
}

// args: { ids: [...], batchSize?: number, skins?: { id: skinName } }
const ids = (args && args.ids) || []
if (!ids.length) throw new Error('args.ids required')
const size = (args && args.batchSize) || 5
const skins = (args && args.skins) || {}

const batches = []
for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size))

const instructions = (batch) => `Migrate these MinecraftAlive NPCs to player-style bodies: ${JSON.stringify(batch)}
${Object.keys(skins).length ? `Skins by id: ${JSON.stringify(skins)}` : ''}

Step 1 (one call): ToolSearch "select:mcp__minecraftalive__npc_get,mcp__minecraftalive__npc_remove,mcp__minecraftalive__npc_spawn"
Step 2 (one message): npc_get for EVERY id, in parallel. Record each NPC's name, role, home, work, schedule, lastLocation.
Step 3 (one message): npc_remove for every id, in parallel.
Step 4 (one message): npc_spawn for every id, in parallel, each with:
  id (same), name (same), role (SAME TEXT, copied verbatim character-for-character - never paraphrase or shorten),
  entityType: "MANNEQUIN", x/y/z from that NPC's lastLocation (fall back to home),
  home, work, schedule (all identical to what npc_get returned)${Object.keys(skins).length ? ',\n  skin: the value mapped to that id above' : ''}
  Do NOT pass profession.

Never verify afterwards, never narrate. Return ONLY "ok: <n>" plus one line per failure (id + error).`

phase('Migrate')
log(`Migrating ${ids.length} NPCs in ${batches.length} batches`)
const results = await parallel(batches.map((b, i) => () =>
  agent(instructions(b), { label: `migrate-${i + 1}`, phase: 'Migrate', model: 'sonnet', effort: 'low' })
))

const failures = results
  .map((r, i) => ({ batch: i + 1, report: r }))
  .filter(r => r.report === null || !/^ok: \d+\s*$/.test(String(r.report).trim()))
return { batches: results.length, migrated: ids.length, failures }
