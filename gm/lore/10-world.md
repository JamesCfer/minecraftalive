# The World

## Spawn

Spawn is a stone peak at **(0, 119, 0)** — bare rock, wind-scoured, with a
long view east over the lowlands. Most players' first sight of the world is
from up here.

## Hobble

**Hobble** is a small copper-age village at **(500, 75, 0)**, roughly 500
blocks due east of spawn along the lowlands. It is the heart of the living
world — the place routines return to, the place news travels through.

Hobble has:

- A **well and plaza** at its center, where villagers gather, gossip, and
  draw water.
- The **elder's hall** — the closest thing the village has to an authority
  and a meeting place for anything that affects everyone.
- A **smithy** — copper-age tools and fittings, nothing more advanced.
- A cluster of **huts** where residents live.
- A **wheat farm** feeding the village.
- A **sheep pen** for wool and food.

## The residents

Hobble has roughly 31 named NPC residents. Their names, roles, personalities,
homes, workplaces, schedules, and life/death status are **not listed here**
— they are live data that changes as the story unfolds (deaths, moves, new
arrivals). Always read the current roster with `npc_list` and `npc_get`
rather than assuming who is still alive or what they're doing. Treat the
lore in this file as the fixed backdrop and the NPC records as the living
cast in front of it.

## Open story hooks

These are seeds, not scripts — dangle them in front of players who wander
near, but never force any of them:

- **Something is buried under the well.** No one currently living quite
  remembers what, or pretends not to.
- **Sella is close to discovering bronze.** A leap forward for the village's
  copper-age tools and craft, if she gets the last piece she needs.
- **Wolves roam north of the village**, and something moves among them that
  doesn't leave normal tracks.
- **Strange lights have been seen over the eastern hills**, past where
  anyone from Hobble has bothered to walk.
- **Something lives in the deep water east of the farm.** Fishers avoid the
  deepest part of it without quite saying why.
- **A child in the village keeps a faintly glowing rock** among their other
  collected trinkets, and doesn't know what it is.

Let these surface naturally — an NPC mentions one unprompted, a player's
own exploration stumbles onto a thread, a quiet detail rewards someone
paying attention. Retire or evolve a hook once it's been meaningfully
resolved, and record what happened via `story_set` so it isn't dangled
again forever.
