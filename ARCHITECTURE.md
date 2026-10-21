# Architecture

## Packages and ownership

- `packages/shared/src`: configuration, wire types, codec/schema, entity/world interfaces, pure `stepPlayer`, reconciliation helper. No browser or Node dependency except the Zod codec.
- `packages/server/src`: `Game` owns rooms, players, secrets, state transitions and simulation. `index.ts` adapts HTTP/ws, validates traffic, runs clocks, enforces heartbeat and backpressure. `names.ts` owns the replaceable filter.
- `packages/client/src`: `main.ts` coordinates UI/prediction; `input.ts` is the sole keyboard/mouse reader; `network.ts` owns sockets, session storage, retry and fault injection; `renderer.ts` owns Three.js/interpolation; `audio.ts` owns Web Audio buses and manifests; `theme.ts` owns palette tokens.
- `tests/core.test.ts`: deterministic state-machine and movement checks. `scripts/bots.ts`: real socket load/reconnect harness. `scripts/browser-test.ts`: actual two-context browser workflow.

## Simulation and replication

One Node process, one HTTP server and one WebSocket endpoint `/ws`. A high-resolution accumulator advances the authoritative sim at 60 Hz. A separate accumulator sends full snapshots at 30 Hz; both rates are configurable and announced by the server. Catch-up is capped at 250 ms to avoid a spiral under CPU stalls. Timer deadlines use server wall-clock milliseconds.

Clients send only inputs. Each server tick consumes at most one queued command per connected player; extra commands cannot buy extra simulation time. Pending queues cap at 30. Duplicate/non-increasing sequences are discarded. Axes and angles are sanitized. Missing commands simulate zero movement axes with gravity. Disconnected entities are fully frozen and flagged. Snapshots contain generic entities and per-player acknowledged sequences, never tokens.

Client prediction advances the same `stepPlayer(state,input,dt,world)` with fixed dt and records each input. On snapshot, the client rewinds to authoritative state, discards acknowledged commands, and replays the remainder. A decaying camera correction hides small reconciliation steps without changing simulation state. Input history is bounded. The input transport repeats up to twelve recent commands, allowing simulated message drops to recover.

Other entities interpolate between snapshots at an estimated server time 100 ms behind. The offset includes observed one-way transport delay, so buffering does not depend on synchronized machine clocks. No extrapolation is used. Client snapshot history caps at 60; removed entity meshes/textures are disposed.

## Protocol v2

Protocol v2 (movement stage) is additive over v1; see "Movement stage" below for the new fields. JSON encoding/decoding lives only in `shared/codec.ts`. Incoming client messages are validated against a strict discriminated Zod union. Handshake version mismatch returns `VERSION` and asks for refresh. Sizes cap at 16 KiB; more than 120 messages/second, repeated malformed messages, or excessive socket backpressure disconnects a peer.

Client → server:

| Type     | Fields                                                                     |
| -------- | -------------------------------------------------------------------------- |
| `create` | `protocol`, `name`                                                         |
| `join`   | `protocol`, `name`, `code` (case-insensitive)                              |
| `resume` | `protocol`, `code`, `token`                                                |
| `ready`  | `ready: boolean`                                                           |
| `start`  | none (host only, connected/ready quorum)                                   |
| `leave`  | none (explicitly releases slot)                                            |
| `lobby`  | none (host reopens lobby from ENDED for new arrivals)                      |
| `inputs` | `inputs[]`: `seq`, `tick`, `x`, `z`, `yaw`, `pitch`, `buttons`; at most 12 |
| `vote`   | `vote: REPLAY or NEXT`                                                     |
| `pong`   | exact echoed `time` from server ping                                       |
| `debug`  | `action: end or robot`; development host only                              |

Input axes are local strafe/forward; angles are radians; button bits are jump=1, sprint=2, crouch=4 (v2). Jump and crouch are held states; the shared module derives presses. Sequence identifies command ordering; the server does not trust client tick as simulation time.

Server → client:

| Type       | Fields                                                                    |
| ---------- | ------------------------------------------------------------------------- |
| `hello`    | `protocol`, `tickRate`, `snapshotRate`, `dev`                             |
| `welcome`  | private `token`, `playerId`, `seq` (last acknowledged input), `room`      |
| `room`     | `room`                                                                    |
| `snapshot` | `tick`, `time` (server epoch ms), `entities[]`, `acks` keyed by player ID |
| `error`    | `code: VERSION / SESSION_EXPIRED / REQUEST`, `message`                    |
| `event`    | `event: join / leave / disconnect / reconnect`, `name`                    |
| `replaced` | none; client stops automatic reconnection                                 |
| `ping`     | `time`                                                                    |

`RoomView`: `code`, `hostId`, `phase`, `mission` (zero-based), `deadline`, `players[]`, nullable `result {survived,present}`, nullable `lastVote {choice,mission}`. Each public player contains `id,name,ready,connected,ping,vote`.

`Entity`: `id,type,position{x,y,z},velocity{x,y,z},yaw,pitch,health,flags`. Type is player/robot/projectile/pickup. Flags are grounded=1, disconnected=2. `World` has `floor` and a list of axis-aligned boxes with `min`/`max` vectors.

## Room and match lifecycle

Create/join → LOBBY → host start → COUNTDOWN (5s) → PLAYING (300s) → ENDED (20s voting) → COUNTDOWN for replay/next, or LOBBY if connected quorum is lost. NEXT increments/wraps the shared mission index. The ENDED results and vote remain public on reconnect. During a countdown or match, new identities cannot join; existing tokens may resume any phase. A room in LOBBY accepts replacements for freed slots.

Host is the oldest retained player. Explicit leave or 45-second expiry migrates host; temporary disconnection keeps ownership. Empty rooms expire after 60 seconds. Every player receives joins/leaves/disconnects/reconnects as toast events.

Transport disconnect → retain token/entity/slot for 45s and freeze entity → valid resume attaches same identity and immediately sends a full snapshot → expiry removes slot. Newest connection for a token wins, closes/replaces the old peer, and protects against the old close callback detaching the new peer. Heartbeat every 2s, dead connection after 8s without an echoed pong. Retry starts at 250ms, doubles to a 5s cap. Session token and room code persist in sessionStorage and localStorage. There is no persistence across server restart.

## Extension points

The solo/UI update adds `dev-solo {protocol,name}` and host-only `dev {action,enabled?,count?,tuning?}` commands, plus `dev-state {state,reset?}` responses. All require server `DEV_TOOLS`; hello/welcome announce `devTools`. Production rejects both new commands and legacy debug actions. `dev-entry.ts` supplies development defaults; production uses `index.ts` directly. `dev-tools.ts` owns synthetic peers and room controls; shared `dev.ts` temporarily adapts the unchanged movement function for room tuning. `ui.ts`, `menu-background.ts`, `dev-panel.ts` and `debug-draw.ts` isolate presentation and development overlays. Existing protocol entries above retain their fields and semantics.

Movement: replace shared movement internals, preserving purity/fixed dt and a versioned collision interface. Introduce movement flags/states in the entity contract, then update protocol version when needed.

Weapons: shared input button definitions and command schema are the entry point. Add server-side weapon/ammo state and authoritative hit checks to the sim. Never accept client damage, hit outcomes or positions.

Robots: add server AI systems returning entity state; the debug dummy demonstrates the existing replication path. Projectiles/pickups can use the same entity interface and dedicated server systems.

Levels: extend the shared validated level descriptions and mission-to-level mapping. Both simulation and renderer consume that immutable data; visual-only decor remains outside collision.

Audio: change `public/audio/manifest.json` event paths/buses/gains/loop flags and drop assets into `public/audio`. `AudioManager.play(event,{position?})` supplies HRTF spatialization. Update listener orientation each frame. Music and voice buses are ready for later systems; no voice chat is implemented.

Deployment/scaling: one instance is required. Add shared room routing and durable session storage before horizontal scaling. Binary codec, snapshot deltas and interest management can replace full JSON snapshots later without changing gameplay authority.

## Foundry Row world stage

`shared/level.ts` is immutable, seeded pure data validated with Zod. `metrics.ts` defines design clearance and jump-chain dimensions. The level contains bounds, AABB colliders/surface metadata, player and dormant future markers, visual decor, lights, weather, atmosphere, audio emitters, interior volumes and inspection cameras. `MISSION_LEVELS` maps the existing mission indices. `RoomView.levelId` and `.levelSeed` are additive; geometry never travels over the network. Server movement, dummy movement, client prediction and debug wireframes all resolve `levelWorld` from the same definition. Server safety checks choose an unoccupied spawn before/after simulation when an operator leaves bounds or crosses killY.

`renderer.ts` owns lifecycle and entity rendering; `WorldView` owns each level's scene resources. Static AABBs and ornaments are grouped into spatial instancing buckets with frustum culling; small ornament buckets disappear at preset-dependent distance. Seeded canvas maps provide albedo, world-projected bump and puddle roughness. Grime, damp lower walls and height haze augment standard materials. A procedural dome and PMREM environment provide diffuse overcast lighting/reflections; imported HDR/EXR is optional. No hard shadow maps are used. Particle meshes supply bounded rain, smoke, steam and ripples. The final merged pass combines depth AO, threshold bloom, softness, edge aberration, cold grade, grain and vignette. HIGH uses a half-resolution masked road reflector and subtle screen-edge droplets.

`graphics.ts` persists overrides and shared settings controls. AUTO samples GPU time when timer queries are available (frame time otherwise), and steps down after sustained slow frames; zero automatic up-steps is deliberate. `gpu-timer.ts` uses asynchronous disjoint timer queries. Performance reports record actual frame intervals, including stalls, and maximum scene draw calls/triangles over a fixed 60-second camera path. The Vite-only report endpoint writes under docs/perf; production has no filesystem-writing endpoint.

`WorldAssets` reads public/asset-manifest.json, probes local paths, and falls back on missing/invalid files. GLTFLoader has local Draco, Meshopt and KTX2 decoders. Imported props scale to collider extents and snap their bottom to the collider ground; only successfully loaded props hide the procedural instance and wheels. The shared collider remains authoritative. Source materials receive the world grade and grime. World teardown disposes targets, textures, materials, geometries, particle resources, loader workers, query objects and renderer render lists. Preparing worlds are generation-guarded against late asynchronous attachment.

`WorldAudio` extends AudioManager's existing SFX/master buses. Seeded filtered stereo noise supplies rain/wind/roof loops, positional filtered noise supplies machinery/steam, and a slow oscillator modulates crane creak. Interior volumes lower rain filtering from 3500 Hz toward 550 Hz and raise hollow roof rain. Surface lookup chooses footsteps; wet exterior steps add splashes. Long randomized intervals trigger quiet booms. Optional manifest files replace synthesis. Leave, disconnect and match transitions dispose world loops; one-shot nodes disconnect on completion. Physical speaker output is distinct from browser Web Audio validation.

## World revision architecture

Shared movement now permits grounded step-up up to PHYSICS.stepHeight (0.5 m), subject to full body clearance, and snaps grounded descending steps down by the same limit. Jump, walk, sprint and gravity parameters retain their previous values. Step height is measured from the start of the tick, preventing chained lifts within one update. Airborne entities cannot step. The local renderer applies a 95 ms vertical exponential smoothing only while grounded; authority and prediction retain exact positions.

The immutable eight-metre XZ spatial grid returns original collider indices in order. Both server and client receive the same query through levelWorld. Invalid initially embedded states use a full scan to retain resolution ordering. Tests compare grid and full-scan trajectories. Shared stairRun produces the exact treads used by level collision and forge visuals.

foundry-layout.ts authors compound geometry; buildings.ts supplies deterministic facade parameters, with client facadeDetails adding ornaments. Validation combines the surface jump-chain graph with a one-metre multilayer clearance flood and real-integrator elevated jump probes near the perimeter. This is sampled verification, not a continuous mathematical proof.

forge-data.ts contains 63 pure-data environment recipes and three catalog variants each. Recipes define primitives, paint/metal/wood recipes, detail flags, seeded serials and generated AABB sets. forge.ts creates UV-equipped bevels, cylinders, tubes, lathed geometry, tapered cabins, paths and panel cutouts, plus mirror/array and merge helpers. Gameplay batches the same parts into material/spatial instances; optional manifest models take precedence. Surface colour variants share maps instead of allocating duplicate textures.

The gallery entry requests the existing server hello and loads only if devTools is true. It offers a turntable, all 189 variants, seed control, wireframe, AABB overlay, dimensions and triangle counts beside a 1.8 m reference. Production falls through to the ordinary entry UI. forge:export runs GLTFExporter in Node with a binary FileReader adapter; no browser, canvas or remote service is needed. It writes 189 optional GLBs and a manifest under public/assets/models/generated. Exported geometry/material factors are editable in Blender; runtime procedural canvas maps are supplied by the game and are not baked into exported GLBs.

## Movement stage (protocol v2)

### State machine

`shared/movement.ts` is a pure, fixed-step state machine: `stepPlayer(state, input, dt, world, tune = MOVE)` returns a new entity and reads nothing outside its arguments (no clocks, no randomness, no module state). Server, client prediction, bots, harnesses and validators all call it. `shared/config.ts` holds every feel constant in `MOVE` (with dev bounds in `MOVE_LIMITS` and harness ranges in `MOVE_TARGETS`); `PLACEHOLDER` and `basePlaceholderJumpHeight` keep the retired values for the conservative level validators.

States: `GROUND`, `CROUCH`, `SLIDE`, `AIR`, `WALLRUN`, `MANTLE`. The complete sub-state lives in `entity.move` (`MoveState`): mode, previous held buttons (edge detection), air jumps left, coyote and jump-buffer ticks, crouched hull, slide ticks and cooldown ticks, the current wall contact (collider id, axis, side, face plane, run direction, run ticks, rise speed), per-wall lockout ticks and the mantle path (ticks, total, from, to, axis, side). All timers are tick counters (`round(seconds / dt)`). Hulls are 0.4 m radius, 1.8 m standing and 1.0 m crouched/sliding. `Box` gains optional `id`, `wallRunnable`, `runFaces` (per-face restriction by outward normal) and `mantleable`; level colliders already carry them, so the spatial grid returns flagged boxes unchanged.

### Order of operations per tick

1. Copy the state (deep copy of `move`); frozen (disconnected) entities return unchanged. Sanitize input; compute forward/right vectors from yaw once; derive jump/crouch presses from the stored previous buttons.
2. Count down coyote, buffer, slide cooldown and lockouts; a jump press arms the buffer.
3. One spatial-grid query covering the swept move plus every probe (speed·dt + radius + 1.8 m).
4. State logic: MANTLE advances its scripted path (or cancels on crouch); GROUND/CROUCH choose slide/crouch/stand and apply ground acceleration, then a buffered jump; SLIDE applies slide-jump, release, decay and limited steering; WALLRUN applies wall-jump, crouch drop, along-wall easing, rise drift then reduced gravity, time limit; AIR applies coyote jump, air jump with partial steer, and capped air control. Gravity follows for non-wall-run states. Jump impulses add half a step of gravity so the fixed-step apex equals the analytic one.
5. Swept horizontal motion, x then z: the nearest face ahead of the leading side clamps the move; boxes already overlapping never block (embedded states can escape). Grounded states may step up to 0.5 m measured from the start of the tick when the hull fits on top.
6. Swept vertical motion: landing on the highest top crossed, or stopping at the lowest ceiling crossed. Grounded states then snap down up to 0.5 m.
7. Post-move transitions: leaving ground (coyote armed), landing (slide if crouch is held at speed, crouch, or stand), concave-corner turn or wall continuation/end, mantle detection, then wall-run latch (settled flush with a swept move). An obstacle that stops a slide ends it.
8. Hard 16 m/s horizontal cap, grounded flag, compact `motion` bits.

Step-up and ground snap run only in GROUND, CROUCH and SLIDE. Collisions only remove velocity components, so wall contact never adds energy.

### Prediction, snapshots, validation

The client records the predicted state after every command. On a snapshot it compares the prediction at the acknowledged sequence with the authoritative state (position within 0.1 mm, velocity within 1 mm/s, and every discrete sub-state field exactly). On a match it only drops acknowledged history; on any mismatch it rewinds to authority, replays unacknowledged commands and blends the position difference into the existing 75 ms decaying camera correction. The tolerance absorbs last-ulp `Math.sin`/`Math.cos` differences between JavaScript engines for the per-tick yaw vectors; all other per-tick math is IEEE-exact arithmetic and `Math.sqrt`/`Math.hypot`.

Snapshot entities carry `motion` bits (state index 0–5, crouched=8, wall on the right=16, sliding=32) for remote poses; `move` is stripped from entities. Each recipient's snapshot adds its own `move` field, so the server builds one base snapshot per room and appends the owner's sub-state per peer. `dev-state` resets carry the full entity. Interpolation is unchanged. Missing server input repeats the last held buttons with zero axes, so starvation never fabricates a press. Input sanitization masks buttons to the three defined bits; one command per tick and the queue cap are unchanged.

Protocol v2 changes: input bit crouch=4; `Entity.motion`; `Snapshot.move`; `dev-solo.level` (dev-only `lab`); dev `tune` accepts any subset of the named `MOVE` constants within `MOVE_LIMITS`. Older clients are refused with `VERSION` and asked to refresh.

### Client presentation

`input.ts` remains the only keyboard/mouse reader: held jump/crouch with one-command tap latches, HOLD/TOGGLE crouch, HOLD/AUTO sprint, optional Left Ctrl crouch with fullscreen keyboard lock, and a dev-only injected-input queue for browser tests. `movement-settings.ts` persists operator preferences and builds the OPERATOR SETTINGS fieldset. `camera-feel.ts` applies eye height, speed FOV kick, wall-run roll, landing dip, mantle pitch pull and head bob as visual offsets only; the aim stays the input yaw/pitch. `renderer.ts` eases remote capsule poses from `motion` bits. `movement-audio.ts` produces surface-aware slide, wall-run, air-jump, wall-jump, mantle, landing, wind and crouch sounds (optional `movement.*` files in asset-manifest.json replace synthesis); remote events are positional and rate-limited.

### Movement Lab

`shared/movement-lab.ts` is development-only data. The development server entry registers it; the production server bundle (`src/index.ts`) never imports it, and the client imports it behind `import.meta.env.DEV`, so production bundles omit it. `dev-solo {level:'lab'}` sets a room's level override; plain solo restarts clear it. It is absent from `LEVELS` and mission lists.
