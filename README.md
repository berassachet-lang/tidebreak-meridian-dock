# TIDEBREAK — Meridian Dock

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/berassachet-lang/tidebreak-meridian-dock/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/berassachet-lang/tidebreak-meridian-dock/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

A round-based tactical FPS for the [make.fun threejs-fps-01 bounty](https://make.fun/bounty/threejs-fps-01):
two teams, short rounds, money between rounds, and gunfire where accuracy
counts more than speed.

## The game

**TIDEBREAK — Meridian Dock** is set in a dusk container terminal on the
harbor. You are Harbor Watch, defending the dock. The Tidebreak crew attacks
in waves of four bots, trying to plant a charge at **Site A (Quay Gate)** or
**Site B (Cold Store)**. Hold the sites, wipe their squad, or defuse the
charge — first to 7 rounds takes the match.

- **First-person combat** — mouse look, WASD movement with acceleration,
  crouching, collision with the map. Stopping to aim pays: spread grows while
  you move and with every shot, and recovers when you hold still.
- **Gunplay** — hitscan weapons with head/body hitboxes (headshots 2.5×),
  recoil, bloom, tracers and a muzzle flash. Pistol, carbine, SMG and
  scattergun, plus frag and smoke grenades.
- **Tactics** — an objective beyond killing (plant/defuse), money earned each
  round and spent in a buy menu (`B`), and bots that follow lanes through
  the map, hold angles, react to gunfire they hear, and plant the charge.
- **The map** — an original 56×44 m dockyard: container canyons, a gantry
  crane, an open-fronted Cold Store warehouse, the Quay Gate office hut,
  sodium floodlights and the harbor water beyond the north quay.
- **HUD** — health, armor, ammunition, round timer, score, money, team
  status, kill feed, objective text and a live minimap.
- **Sound** — every effect is synthesized with WebAudio at runtime; the game
  ships no audio files and makes no network request.

## How to play

Open `game/index.html` in desktop Chrome (serve `game/` with any static
server, e.g. `node serve.ts` if you add one, or `npx serve game`), click
**Deploy**, and play. No build step, no network: everything runs from these
files. Three.js 0.187.0 is vendored under `game/`.

| Key | Action |
| --- | ------ |
| W A S D | Move |
| Mouse | Look · click to fire |
| R | Reload |
| Ctrl / C | Crouch |
| B | Buy menu (during buy phase) |
| 1 / 2 / 3 | Switch weapon |
| 4 / 5 | Select frag / smoke grenade |
| G | Throw selected grenade |
| E | Hold to defuse the charge |

## Layout

- `game/` — the playable game: `index.html` plus ES modules under `src/`
  (`boot.js` entry, `game.js` rounds and economy, `bots.js` AI, `map.js` the
  dockyard, `player.js` movement, `weapons.js` gunplay and grenades,
  `audio.js` synthesized sound, `hud.js` HUD and minimap). Three.js 0.187.0
  is vendored as `game/three.module.min.js` / `game/three.core.min.js`.
- `screenshots/` — real renders of the game's own code.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.
- `main.ts` — the entry program (Node 22, stdlib only): copies `game/` and
  `screenshots/` to the output directory and writes `dossier.json`.

## License

MIT — see [LICENSE](LICENSE).
