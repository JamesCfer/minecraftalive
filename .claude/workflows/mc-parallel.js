export const meta = {
  name: 'mc-parallel',
  description: 'Fan out MinecraftAlive MCP operation manifests to parallel haiku executor agents',
  whenToUse: 'Any bulk world change: village builds, terraforming, mass NPC spawning. The main loop plans coordinates/rosters, then passes manifests here for fast parallel execution.',
  phases: [{ title: 'Execute', detail: 'one haiku agent per manifest', model: 'haiku' }],
}

// args: { manifests: [{ label: 'walls', ops: [{ tool: 'fill_region', args: {...} }, ...] }, ...] }
// Each manifest becomes one haiku agent. Ops within a manifest run concurrently unless
// the manifest has sequential: true. Keep manifests to ~15-40 ops each.

const manifests = args && args.manifests
if (!manifests || !manifests.length) throw new Error('args.manifests required')

const PROTOCOL = `You are a Minecraft build executor. Execute the JSON operations below against the minecraftalive MCP server, exactly as given.
1. First action: ONE ToolSearch call loading every tool the ops name, comma-separated, e.g. "select:mcp__minecraftalive__fill_region,mcp__minecraftalive__set_block".
2. Fire many independent tool calls per message (10+). ORDER: concurrent unless SEQUENTIAL:true appears below, then strictly in order.
3. Never verify, never improvise extra content, never narrate.
4. On error: retry once, then note and continue.
Return ONLY: "ok: <n>" plus one line per failure (args + error).`

phase('Execute')
log(`Dispatching ${manifests.length} manifests`)
const results = await parallel(manifests.map((m, i) => () =>
  agent(
    `${PROTOCOL}\n\nSEQUENTIAL:${m.sequential === true}\nOPS:\n${JSON.stringify(m.ops)}`,
    { label: m.label || `batch-${i}`, phase: 'Execute', model: 'haiku', effort: 'low' }
  )
))

const failures = results
  .map((r, i) => ({ label: manifests[i].label || `batch-${i}`, report: r }))
  .filter(r => r.report === null || !/^ok: \d+\s*$/.test(String(r.report).trim()))
return { batches: results.length, failures }
