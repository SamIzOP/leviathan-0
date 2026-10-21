# LEVIATHAN 0 — multiplayer foundation

Browser co-op foundation for 2–8 Kainos operators. Rooms, authoritative movement, prediction, reconnect, rematches and audio are implemented. Foundry Row adds a playable industrial world, procedural weather/materials and environment audio. The movement stage adds sprint, crouch, slide, slide-jump, air jump, wall-run, wall-jump and mantle. Weapons and combat AI remain deferred.

## Run locally

Install Node 20.19+ (Node 22 recommended), then from this folder:

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. The client development server proxies `/ws` to port 3000. No `.env` is required. Development tools are ON by default under `npm run dev`; `DEV_TOOLS=false` explicitly disables them. Copy `.env.example` to `.env` only to customize defaults. Restart after changing environment settings. `PORT` changes the server port; use the production command below when testing a custom port.

For the single-port production build:

```sh
npm run build
npm start
```

Open `http://localhost:3000`; `/health` returns server status. Production tools default OFF: the server rejects every development command and the client hides development controls. Only explicit `DEV_TOOLS=true` enables them. `DEV_SOLO` is retired.

## Solo testing and service terminal

Open [solo mode](http://localhost:5173/?solo=1) or [solo as Affan](http://localhost:5173/?solo=1&name=Affan), or press **SOLO TEST** on the title screen. An empty callsign becomes TESTER. The arena starts immediately, without a countdown; its timer is disabled. Refresh resumes the same identity through the existing reconnect path. Browser mouse capture still requires a click; the arena itself is already running.

**F4** or **backtick** opens the developer terminal and releases the mouse; closing it captures the mouse again. **F3** remains the independent telemetry overlay. **H** opens the controls legend, also shown in the lobby and paused overlay with the current sensitivity.

- **MATCH:** end, restart, timer enable/freeze, results and return to lobby.
- **PLAYERS:** add one or seven synthetic players, remove the newest bot and inspect pings. Bots occupy real room slots, up to eight total, and generate placeholder movement inputs.
- **ENTITIES:** spawn one or ten existing diagnostic capsules at your position, clear them and inspect the live count. The existing sixteen-dummy cap remains.
- **NETWORK:** change simulated round-trip latency (0–400ms) and gameplay-message loss (0–20%); disconnect immediately or for twenty seconds. Explicit legacy `lag`/`loss` URL settings retain precedence on page load.
- **PLAYER:** teleport, reset state, adjust placeholder walk/sprint/jump-height/gravity values for this dev room, and restore defaults. The server and prediction use the same temporary adapter; production movement is unchanged.
- **DEBUG DRAW:** colliders, authoritative self ghost, raw remote positions and velocity vectors. A top-down self inset keeps the server/client comparison visible when the first-person camera is inside its own capsule.

Room-changing controls require the host. Network/draw preferences and collapsed sections are saved on this device. Timer/freeze preferences are stored locally and their authoritative room state survives refresh/reconnect; a fresh solo room always starts with its timer disabled. Tuning is room-local and never changes production defaults. Bots disappear when the last retained human slot leaves/expires.

## Interface and menu art

All 2D screens use opaque concrete slabs, square corners, hard borders/shadows, local Oswald and IBM Plex Mono fonts, and cold monochrome tokens. The menu-only Canvas street scene includes rain, fog, drifting smoke, grain, cars, a white van, a water tower and three stacks. It caps drawing at 30fps, DPR at 1.5, and resolution at 1600×1000; it pauses in hidden tabs, freezes under reduced motion, and releases its canvases when a match starts.

Optional replacement art goes at `packages/client/public/assets/menu-bg.webp` or `menu-bg.jpg` (WebP takes priority). No replacement file or external image service is needed. Bundled fonts and their licenses are in `packages/client/public/fonts`. The playable 3D world now follows the world art bible below.

## Play with friends

Enter a 2–16 character callsign, create a room, and copy the invite link. Friends join, everyone presses READY, then the host presses START. A five-second countdown leads into the Foundry Row. WASD moves, mouse looks, Space jumps, Shift sprints, C crouches/slides (see Movement below). Click to capture the mouse; Esc releases it. Settings persist locally. F3 toggles telemetry. With `DEV_TOOLS=true`, F8 ends the mission and F9 spawns a synchronized diagnostic robot capsule.

After the mission, vote REPLAY or NEXT FACTORY. The vote lasts 20 seconds. The host breaks ties; no votes defaults to replay. A new countdown starts automatically if at least two operators are connected. NEXT changes the mission label and its level/weather variant.

A dropped connection automatically retries; the slot freezes for 45 seconds. Refresh or reopen a tab to resume. A new tab with the same token replaces the old tab. For two independent local operators use separate browser profiles/incognito contexts, or Leave before creating another identity. For friends outside your machine use the public HTTPS deployment, not a localhost invite. Local LAN testing may require firewall approval and browser secure-context support for clipboard/pointer lock.

## Verify

```sh
npm test
npm run lint
npm run build
```

The two-change acceptance harness captures fourteen screenshots in `docs/screens` and checks solo entry/refresh, four-player bots, pointer lock, reconnect, reduced motion and responsive layout:

```sh
npx tsx scripts/scope-update-browser.ts
```

Its default URL is `http://localhost:5173`. `scripts/scope-production.ts` verifies the production gate through real sockets and Chromium (`TEST_URL` defaults to `http://localhost:3001`). Both accept `CHROMIUM_PATH`. See `ACCEPTANCE.md` for the completed runs and the two-minute regression report.

Real browser acceptance test, against a running server with `DEV_TOOLS=true`, `MATCH_MS=720000`, and the default 20-second vote window:

```sh
npx playwright install chromium
npm run test:browser
```

Optional `CHROMIUM_PATH` points at an existing Chromium executable; `TEST_URL` defaults to `http://localhost:3000`. The harness checks actual UI creation/join/start, motion under `?lag=150&loss=3`, remote entity rendering, 20-second offline recovery, tab replacement/reopen, votes, debug data, and synthesized/manifest audio. Artifacts go to `test-results`.

Eight-player, ten-minute real-socket soak against a running server:

```sh
npm run bots -- --count 8 --duration 600 --chaos --lag 150 --loss 3
```

Set `MATCH_MS=720000` before starting the server to keep the entire soak within one match. To fill a human-created lobby:

```sh
npm run bots -- --room ABCD --count 7
```

The human host readies and starts that room. `--url ws://localhost:3000/ws` selects the endpoint. Bots report snapshot rates, reconnects, server memory and prediction error to `test-results/bots.json`. Defaults are 600 seconds, 150ms simulated round-trip latency and 3% gameplay-message loss. `--chaos` reconnects random bots throughout the run.

## Build on this

Read `GAME_BIBLE.md`, `ARCHITECTURE.md`, and `DECISIONS.md` before adding gameplay. All movement math lives in shared; all input reading in client/input; JSON in shared/codec; audio asset references in public/audio/manifest.json.

Deployment instructions are in `DEPLOY.md`, with Docker and a Render Blueprint. Account creation and repository authorization are the only unavoidable provider setup steps. This workspace has not been published to a cloud host.

## Foundry Row world / look

Open [Factory 1 solo](http://localhost:5173/?solo=1). A fresh session starts in Factory 1; a retained session resumes its current mission. No external assets are required. If the embedded browser rejects mouse capture, click to focus, use WASD and drag to look.

F4 → WORLD / LOOK → **COMPOSITION CAMERA** shows the signature street view. **PLAYER CAMERA** returns to play. **FREE-FLY CAMERA** uses WASD, mouse/drag look, Space up and Ctrl down; its speed slider changes camera speed while the operator stays still. Existing debug wireframes and the new spawn markers expose collision and facing data.

WORLD / LOOK also controls fog, rain, smoke, reflections, exposure, tint, and each post effect. Its live readout includes draw calls, triangles, surface-texture memory estimate, GPU time when available, frame time, particles and active preset. LOW omits AO; HIGH adds half-resolution road reflection and subtle edge droplets. AUTO benchmarks load, starts at MEDIUM and steps down under sustained load. It never automatically steps up. Operator Settings → Graphics saves quality, grain and bloom.

[Performance path](http://localhost:5173/?solo=1&perf=1) flies all five zones for 60 seconds, logs its result and saves `docs/perf/<preset>.json` through a development-only endpoint. `?camera=composition` selects the signature view. These URL tools require the server's DEV_TOOLS flag.

Validation: `npm run level:check` and `npm run assets:check`. The optional asset paths, formats and local decoder licenses are documented in ASSETS.md. `scripts/world-browser.ts` runs `screens`, `perf`, or `cycles` against TEST_URL (default port 3002). The cycle harness expects an isolated test server with DEV_TOOLS=true and short VOTE_MS/COUNTDOWN_MS values. It never changes normal game timing. Evidence and current limits are recorded in ACCEPTANCE.md.

## Revised compound and model forge

Play at [Factory 1](http://localhost:5173/?solo=1), or inspect models at [Asset Gallery](http://localhost:5173/?gallery=1). No manual setup beyond the existing local run command is needed. Gallery mode requires server DEV_TOOLS and is hidden in normal production. Select an asset/variant and seed, drag to orbit, zoom, or enable turntable, wireframe and collider overlays.

For full mouse look, open the game in Chrome or Edge. When embedded browsers deny mouse capture or leave the request pending, WASD and drag look remain available; pause/controls show a dismissible explanation. A successful native capture hides that notice. Collider wireframes default off.

The enlarged factory is visibly sealed and all spawns/recovery points are at its entrance. Stairs and low obstacles up to 0.5 m are walked automatically, with camera smoothing; higher ledges still require the existing jump. F4 retains composition/free camera and world controls.

Export editable models with npm run forge:export. Outputs: packages/client/public/assets/models/generated/*.glb plus manifest.json (63 assets × 3 variants). See ASSETS.md for override behavior and export contents. Verification commands include npm test, npm run level:check, npm run assets:check, npm run lint and npm run build. scripts/boundary-test.ts checks confinement; scripts/revision-features.ts checks actual stair walking and pointer-lock timeout; scripts/gallery-test.ts checks gallery rendering; scripts/revision-browser.ts captures views, benchmarks and replay cycles. Evidence is in docs/screens/revision and docs/perf.

## Movement

| Key                | Action                                                                         |
| ------------------ | ------------------------------------------------------------------------------ |
| W A S D / mouse    | Move / look                                                                    |
| Space              | Jump; again in the air for the air jump; during a wall-run, wall-jump          |
| Left Shift (hold)  | Sprint (with AUTO-SPRINT on, Shift walks instead)                              |
| C (hold)           | Crouch; while sprinting, slide. Space during a slide is a slide-jump           |
| Left Ctrl (opt-in) | Alternative crouch key; off by default because Ctrl+W closes a browser tab     |
| Jump along a wall  | Wall-run on marked long walls (street facades, run walls, containers, hall)    |
| Jump at a ledge    | Mantle onto real ledges (roofs, containers, crates, cars, catwalks); C cancels |

Operator Settings → MOVEMENT / CAMERA (saved on this device): crouch HOLD/TOGGLE, sprint HOLD/AUTO, field of view 80–110 (default 95, horizontal at 4:3), camera roll, head bob and FOV speed kick (0–100 %), REDUCE MOTION, an optional speedometer, and the Left Ctrl option. With Ctrl enabled, capturing the mouse also enters fullscreen and requests the browser's Keyboard Lock where supported. F3 shows the movement state and speed.

[Movement Lab](http://localhost:5173/?solo=1&level=lab) (development only, requires DEV_TOOLS): rulers every 5 m, a ledge row at 0.5–2.6 m (plus 4.0 m and an unflagged block), a stair run, a 40 m wall-run wall, L-shaped and concave corners, a gapped wall, an unflagged wall, a 2/4/6/8 m gap course, a 1.2 m tunnel, a slide strip and a chain-finish mantle block. Return to Foundry Row with [solo mode](http://localhost:5173/?solo=1).

F4 → MOVEMENT TUNING adjusts every movement constant live for the dev room (server and prediction use the same values), with DEFAULT, FLOATY, HEAVY and RESET. DEBUG DRAW adds the movement state label, velocity arrow, wall and mantle probes with targets, ground contact and a 10-second speed graph. Browser tests drive the client through the dev-only `window.leviathanTest.inject([...])` hook.

```sh
npm run movement:harness   # headless measures vs. ranges (MOVE_TARGETS)
npm run test:boundary      # perimeter: bots plus adversarial full-movement search
npm run test:movement      # Playwright chain + frames (dev server running)
npm run movement:perf      # server CPU per tick, eight traversing players
npm run level:check -- --advanced
```

Optional movement audio files go under `packages/client/public/assets/audio` using the `movement.*` keys in `asset-manifest.json`; synthesized fallbacks play otherwise. Evidence is in ACCEPTANCE.md and docs/perf/movement-*.json; frames are in docs/screens/movement.
