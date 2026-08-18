export const meta = {
  name: 'mc-relocate-npcs',
  description: 'Move NPCs to explicit safe coordinates, preserving their identity',
  whenToUse: 'When NPCs are stuck in terrain/walls (suffocating) and must be re-placed at verified-open positions.',
  phases: [{ title: 'Relocate', detail: 'batch of NPCs per agent' }],
}

// args: { placements: [{id, x, y, z}], batchSize?: number }
const placements = (args && args.placements) || []
if (!placements.length) throw new Error('args.placements required')
const size = (args && args.batchSize) || 5

const batches = []
for (let i = 0; i < placements.length; i += size) batches.push(placements.slice(i, i + size))

const instructions = (batch) => `Relocate these MinecraftAlive NPCs to exact safe coordinates: ${JSON.stringify(batch)}

They are currently suffocating inside blocks. Move each to the given x/y/z EXACTLY as specified - do not adjust, round, or "improve" the coordinates.

Step 1 (one call): ToolSearch "select:mcp__minecraftalive__npc_get,mcp__minecraftalive__npc_remove,mcp__minecraftalive__npc_spawn"
Step 2 (one message): npc_get for EVERY id in parallel. Record each NPC's name, role, home, work, schedule.
Step 3 (one message): npc_remove for every id in parallel.
Step 4 (one message): npc_spawn for every id in parallel, each with:
  id (same), name (same), role (SAME TEXT copied verbatim, never paraphrase or shorten),
  entityType: "MANNEQUIN", x/y/z = the coordinates given for that id above,
  home, work, schedule = exactly what npc_get returned for that NPC.
  Do NOT pass profession.

Never verify afterwards, never narrate. Return ONLY "ok: <n>" plus one line per failure (id + error).`

phase('Relocate')
log(`Relocating ${placements.length} NPCs in ${batches.length} batches`)
const results = await parallel(batches.map((b, i) => () =>
  agent(instructions(b), { label: `relocate-${i + 1}`, phase: 'Relocate', model: 'sonnet', effort: 'low' })
))

const failures = results
  .map((r, i) => ({ batch: i + 1, report: r }))
  .filter(r => r.report === null || !/^ok: \d+\s*$/.test(String(r.report).trim()))
return { batches: results.length, relocated: placements.length, failures }
