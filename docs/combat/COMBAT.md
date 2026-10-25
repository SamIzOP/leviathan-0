# Weapons and combat core (Prompt 4) — 2026-10-25

Five weapon tiers, an oil/fire mechanic, Fingers of God, ammo pickups and dev tools, all server-authoritative with client prediction and lag compensation. Nothing is committed or pushed; this work sits on top of the uncommitted Prompt 3.7 changes.

Everything below says how it was checked. **NEEDS HUMAN REVIEW** marks subjective feel and the Intel UHD frame rate, which could not be measured on this machine.

## 1. Assumptions (the design notes were blank)

Every gameplay number lives in [packages/shared/src/weapons.ts](../../packages/shared/src/weapons.ts), and each assumption is marked `ASSUMPTION` in a code comment there.

| Area           | Assumption                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weapon roster  | Five prototype tiers for a co-op shooter against industrial robots: sidearm, SMG, pump shotgun, marksman rifle and an incendiary launcher (table in §2).                                                                                                                                                                                                                                       |
| Loadout        | Production rooms start with tiers 1–2; dev/solo rooms own all five. Tier unlocks belong to the later progression prompt.                                                                                                                                                                                                                                                                       |
| Oil            | A thrown **oil flask** (G, 2 carried, max 3) bursts into a 3 m slick that lasts 25 s and coats targets within 2.5 m for 12 s. The level's 7 `oil` markers hold permanent spills that refill 30 s after burning away.                                                                                                                                                                           |
| Ignition       | Incendiary hits ignite oil: Slag Launcher impacts and splash, Fingers of God beams, burning targets walking into oil, and fire spreading between slicks. Plain bullets do not ignite oil.                                                                                                                                                                                                      |
| Fire           | Fire burns only where there is fuel. An oil fire lasts 7 s and deals 22 DPS. Anyone inside keeps burning for 3.5 s afterwards at 10 DPS; oiled targets burn for 7 s at ×1.5. A blast with no oil under it leaves a 2.5 s bare fire (1.6 m) that cannot spread. Fire jumps to another slick whose edge is ≤ 1 m away, after 0.4 s.                                                              |
| Rain           | Outdoor burn time × (1 − rain × 0.45): Factory 1 rain 0.55 → ×0.75, Factory 2 rain 0.95 → ×0.57. Fires inside a room's bounds are sheltered (×1).                                                                                                                                                                                                                                              |
| Fingers of God | An ultimate (Q). It charges 1 point per point of damage dealt to hostiles plus 2/s, and is full at 600. When used, five beams fall from the sky in a hand-shaped fan around the aim point (150 m range). Each lands after a 1 s telegraph, staggered 0.12 s, dealing 160 damage (down to 40% at 3 m), igniting oil and leaving a bare fire. A roof above the point stops the beam at the roof. |
| Pickups        | An ammo crate adds 40% of max reserve to every owned weapon plus one flask. World crates sit on the level's 7 `ammo` markers and respawn after 20 s. Robots and dummies drop a 25% crate on death (30 s lifetime, at most 16).                                                                                                                                                                 |
| Team damage    | Set by the match mode in data: co-op has friendly fire **off**. A dev toggle overrides it. Self-splash is off, and fire hurts operators only when friendly fire is on.                                                                                                                                                                                                                         |
| Health         | 100 HP with no regeneration. Death respawns the operator after 3 s with a fresh loadout (owned tiers kept). Range dummies have 200 HP and reset 2 s after death; F9 wandering robots have 100 HP and are removed on death.                                                                                                                                                                     |
| Sprint         | Pulling the trigger or aiming from a ground sprint ends the sprint. The weapon raises for `sprintToFire` (0.10–0.30 s), and sprint stays blocked 0.35 s after each shot. This is the only movement hook, and it applies on the ground only: slides, wall-runs, air and mantles are untouched.                                                                                                  |
| ADS            | Holding aim scales ground speed by `adsMoveSpeed`, tightens spread to `spreadAds`, zooms by `adsZoom` and cuts view kick by 35%. ADS sensitivity is a separate setting (default 1.0, normalised by zoom).                                                                                                                                                                                      |

## 2. Weapon stats (generated from the data file)

| Tier | Weapon        | Role                      | Mode | Delivery   | Damage                      | Fire rate          | Mag / reserve (start) | Reload               | Falloff         | Head × | Spread hip / ADS | Move / ADS move | ADS zoom |
| ---: | ------------- | ------------------------- | ---- | ---------- | --------------------------- | ------------------ | --------------------- | -------------------- | --------------- | -----: | ---------------- | --------------- | -------: |
|    1 | RIVET P-12    | Sidearm                   | semi | hitscan    | 30                          | 360 rpm (10 ticks) | 12 / 84 (48)          | 1.25 s               | 18→40 m to 60%  |      2 | 1.2° / 0.25°     | 1 / 0.85        |     1.25 |
|    2 | SPOOL SMG     | Close-range automatic     | auto | hitscan    | 13                          | 900 rpm (4 ticks)  | 36 / 216 (144)        | 1.6 s                | 10→28 m to 50%  |    1.5 | 2.6° / 1°        | 1 / 0.8         |      1.2 |
|    3 | BREAKER 8-GA  | Pump shotgun              | pump | hitscan    | 8 × 12                      | 70 rpm (51 ticks)  | 6 / 36 (24)           | 0.3 s + 0.48 s/shell | 5→16 m to 25%   |   1.25 | 4.5° / 3.2°      | 0.97 / 0.85     |     1.15 |
|    4 | LONGLINE DMR  | Marksman rifle            | semi | hitscan    | 52                          | 150 rpm (24 ticks) | 8 / 48 (32)           | 2.1 s                | 45→100 m to 75% |   2.25 | 2° / 0.05°       | 0.93 / 0.7      |      2.4 |
|    5 | SLAG LAUNCHER | Heavy incendiary launcher | semi | projectile | 85 direct + 70 splash (4 m) | 60 rpm (60 ticks)  | 4 / 16 (8)            | 2.8 s                | 48 m/s, g 9     |      1 | 0.6° / 0.2°      | 0.85 / 0.75     |     1.35 |

Fire intervals are whole 60 Hz ticks. Spread grows by `bloomPerShot` up to `bloomMax`, and by `spreadMove` × min(1, speed / 8 m/s) (+0.5 airborne). Every numeric stat can be live-edited in the dev panel within the bounds in `WEAPON_LIMITS`.

## 3. How it works

- **One shared step.** [`stepCombatant`](../../packages/shared/src/combat.ts) is the per-tick step for both server and client prediction:
  1. the weapon slowdown hook (strips ground sprint while firing or aiming; scales walk/sprint/crouch speed through tuning);
  2. the unchanged `stepPlayer` movement step;
  3. the weapon step (switch, ADS, reload, trigger, spread from a seeded RNG, flask and Fingers activation).

  Timers are whole ticks, so prediction is bit-exact. `movement.ts` is unchanged.

- **Protocol 3.** Inputs carry:
  - combat button bits (fire 8, ADS 16, reload 32, flask 64, Fingers 128);
  - the wanted `weapon` slot;
  - `view`, the server tick the client was rendering remote entities at.

  Snapshots carry the owner's `combat` state, combat entities (projectiles, hazards, crates, strike telegraphs) and an `events` list (shots, hits, blasts, ignitions, pickups, respawns and dev hit-debug rays).

- **Authority.** The server ([combat-server.ts](../../packages/server/src/combat-server.ts)) owns:
  - hits and damage, ammo and kills;
  - projectiles, hazards and pickups;
  - deaths and respawns.

  The client predicts ammo, fire rate, recoil, tracers, muzzle and world impacts. It reconciles weapon state exactly like movement: any mismatch replays from the server's state. Hit markers and damage numbers come only from the server's confirmed `hit` events.

- **Hit detection.** Hitscan rays use a world raycast over the broadphase grid and capsule-sized body + head boxes. The Slag Launcher and the oil flask are server-simulated projectiles with gravity, swept each tick against the world and current targets. Hit shapes support a `weak` zone with its own multiplier for Prompt 5 robots.
- **Presentation** (`packages/client/src/combat/`):
  - **Viewmodel:** five placeholder weapon shapes in their own pass, with sway, bob, slide/wall-run tilt, sprint-lowered and ADS poses, switch drop and raise, and procedural reloads (shell by shell on the shotgun). Each shot kicks the gun and flashes the muzzle, and the DMR has a scope overlay.
  - **Effects:** instanced, pooled effects: tracers, impact decals, sparks, blasts, flames, oil slicks, projectiles, crates and Fingers telegraphs.
  - **Audio:** procedural WebAudio for every weapon, cue, hit, blast, fire and pickup.
  - **HUD:**
    - weapon panel with magazine, reserve, slots, reload, flask count and Fingers meter;
    - health;
    - a spread-driven crosshair, hit markers and floating damage numbers;
    - damage-direction arcs, heavy-hit and burning edge glows;
    - kill feed, death/respawn overlay and +AMMO toast.

  Hit feedback is server-confirmed.

- **Lag compensation.**
  - The server keeps 40 ticks of target positions and rewinds hitscan targets to the client's `view` tick, interpolating between ticks, capped at 300 ms.
  - Shooter origin and walls are never rewound.
  - Two netcode problems found by measuring this are fixed (§5).

## 4. Tests

| File                                |    Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/combat.test.ts`              |       25 | **Falloff:** exact values per weapon, and server damage at exact distances. **Head/body/weak zones:** shapes and server headshot damage. **Ammo and reload:** exact reload ticks and reserve accounting, auto-reload on empty and the dry click, switching cancels a reload, shell-by-shell reload interrupted by firing, no reload without reserve, infinite ammo. **Fire rate:** exact rate for every weapon; semi-auto needs a re-press. **Server validation:** a 600-input flood cannot beat the RPM; banked catch-up credit is rejected by the wall-clock guard; the codec rejects out-of-range slots and forged `ammo`/`combat` fields; reload spam creates no ammo; no shot from an empty weapon; no hits through a real level wall (`gate-workshop/side-1`) for every hitscan weapon and the launcher; a 2 s-old view is clamped to 300 ms. |
| `tests/combat-net.test.ts`          |        1 | Lag-compensated hits over a jittery 100 ms link, compensation on vs off (numbers in §5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/oil-fire.test.ts`            |       13 | **Ignition:** flask slick and coating, launcher ignition, bare fire, Fingers ignition, a burning target walking into oil. **Damage:** fire DPS, afterburn, oiled ×1.5 / 7 s, friendly-fire rule. **Expiry and weather:** exact expiry of fire and slick; rain vs sheltered rooms on the real level. **Spread:** inside vs beyond the gap. **Caps:** exact `maxFires` / `maxPuddles` counts, a 900-tick barrage, level spills never evicted and refilling.                                                                                                                                                                                                                                                                                                                                                                                           |
| `tests/fingers.test.ts`             |        3 | Charge from damage, no activation below full, five staggered beams (telegraph and stagger ticks, public strike entities) that damage and ignite within the fire cap, and a roof stopping the beams.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/dev-tools.test.ts` (updated) |        — | Server and client still step identically under dev tuning, now through the shared combat step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/combat-browser.ts`         | 5 phases | Real client: firing in every movement state; ammo edge cases and an ammo crate; lag compensation through the dev panel sliders; a live stat edit applied exactly by the server; the debug overlay; HURT SELF. Writes `docs/combat/browser.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The whole suite is **163 tests in 13 files, all passing**. TypeScript and ESLint are clean.

The existing regression checks also pass:

- the movement harness (20/20 targets);
- the mouse-capture browser test (both viewports, no errors).

`movement.ts` and `look-pipeline.ts` are byte-identical to the last commit.

## 5. Lag compensation measured

| Check                                                                                   | Link                                                                         | Compensation on                                  | Off                   |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | --------------------- |
| `tests/combat-net.test.ts` (in-process client, JSON wire, interpolating renderer model) | 50 ms ± 15 ms each way, 240 shots at a strafing dummy                        | **240/240 (100%)**, mean rewind 226 ms (max 230) | 101/240 (42.1%)       |
| `scripts/combat-browser.ts` (real client, dev panel sliders)                            | latency 100 ms + jitter 20 ms, 40 rivet shots at the rendered strafing dummy | **40/40 (100%)**, mean rewind 254–260 ms         | 13–15/40 (32.5–37.5%) |

The server's rewound dummy matched the client-rendered position within 2–5 cm on every probed shot.

Two netcode problems surfaced while measuring, both fixed in `game.ts`/`combat-server.ts`:

1. **A permanent input backlog.**
   - **Problem:** a client hitch made the server run idle ticks, then the catch-up burst sat in a queue that drained one input per tick. Here that left about 17–23 queued inputs (≈300 ms) even at 0 ms latency, which pushed every rewind past the cap. It predates this stage.
   - **Fix:** idle ticks now earn catch-up credit, and a backlog may process up to two extra inputs per tick. Total input steps can never exceed elapsed ticks.
   - **Result:** unacknowledged inputs at 0 ms dropped from 17 to 3, and the requested rewind fell from 393 ms to 143 ms.
2. **Catch-up must not raise the fire rate.**
   - **Problem:** catch-up inputs could fire faster than the weapon allows.
   - **Fix:** a wall-clock guard per operator (a token bucket refilling at the weapon's own rate, capacity 2) rejects shots beyond the real-time rate. Ammo is still spent, as predicted.
   - **Result:** tests show a banked-credit flood is rejected while normal fire never is.

## 6. Performance

Two harnesses produced these numbers:

- `scripts/combat-perf.ts` writes [perf-low.json](perf-low.json).
- `scripts/combat-browser.ts` writes [browser.json](browser.json).

**Server.** A dev room with the host plus 7 bots firing at 16 strafing dummies, simulated for 60 s (3,600 ticks):

- **Load:** 3,456 shots and 2,347 hits.
- **Tick time:** mean **0.094 ms**, p99 0.25 ms, worst 3.18 ms, against a 16.7 ms budget.

**Client, LOW 1280×720**, measured on an RTX 5070 Ti (ANGLE D3D11) over 20 s per phase:

| Phase                                                               | Frames |    Mean | p95 / p99    |             Worst | Draw calls (mean / max) | Triangles max | Combat FX peaks                                                                                          |
| ------------------------------------------------------------------- | -----: | ------: | ------------ | ----------------: | ----------------------- | ------------: | -------------------------------------------------------------------------------------------------------- |
| Quiet                                                               |  5,682 | 3.57 ms | 3.7 / 3.7 ms |            4.4 ms | 381 / 381               |          196k | 7 oil spills, 7 crates; FX 2 draws + viewmodel 8                                                         |
| Firefight: 7 bots firing at 15 strafing dummies, plus the local SMG |  5,704 | 3.58 ms | 3.7 / 3.7 ms | 21.4 ms (1 frame) | 426 / 430               |          201k | tracers 12; decals 48 and particles 192, both at their LOW caps; voices 9; FX 5 draws + viewmodel 9 = 14 |

Reading these numbers:

- **Frame time:** 3.57 ms is this display's 280 Hz refresh, so it says nothing about GPU headroom.
- **Draw calls:** the 45–49 added in the firefight are mostly the 7 bot and 15 dummy capsules (2 draws each). Combat FX and the viewmodel together peak at 14.
- **Shader compiles:** all six program links happened in the first 0.9 s after bots and dummies appeared, before the measured window, and none occurred during sustained firing. The single 21 ms frame was not a shader compile.
- **3.7 dressing caps:** they still hold with combat present: 146–387 draw calls per review view, ≤ 253k triangles, ≤ 89.4 MiB textures per zone.

**Caps (LOW / MEDIUM / HIGH):**

| Pool            | LOW | MEDIUM | HIGH |
| --------------- | --: | -----: | ---: |
| Tracers         |  48 |     96 |  128 |
| Impact decals   |  48 |     96 |  160 |
| Particles       | 192 |    384 |  512 |
| Flames per fire |   4 |      7 |   10 |

- **Fixed pools:**
  - 12 remote muzzle flashes;
  - 8 blasts;
  - 8 local projectiles;
  - 48 crates;
  - 16 flasks;
  - 24 damage numbers;
  - 8 damage arcs;
  - 24 audio voices.
- **Server caps:**
  - 24 active fires and 24 oil slicks;
  - 16 dropped crates;
  - 16 robots/dummies.
- **Rendering rules:** all effects are instanced (one draw per pool), no dynamic lights are used, and the viewmodel shaders compile before first use.

**Intel UHD: NEEDS HUMAN REVIEW (not measured).** This machine has only an RTX 5070 Ti.

- **Previous UHD run:** the pre-dressing build held 60 fps at LOW with up to 399 draw calls and 537k triangles on the fly-through ([docs/perf/redesign-low.json](../perf/redesign-low.json)).
- **This firefight:** 430 draw calls (about 8% over that envelope) and 201k triangles.
- **To confirm on the UHD laptop:**

```sh
CHROMIUM_PATH=<chrome> TEST_URL=http://localhost:5175 npx tsx scripts/combat-perf.ts
```

Check that the firefight mean stays at or below 16.7 ms.

## 7. Dev tools (dev panel → WEAPONS, NETWORK, DEBUG DRAW)

- **Loadout and ammo:**
  - give any tier (T1–T5) or GIVE ALL;
  - REFILL AMMO;
  - FILL FINGERS OF GOD;
  - INFINITE AMMO (predicted on the client too).
- **Rules:**
  - DAMAGE MULTIPLIER (0–5);
  - FRIENDLY FIRE;
  - LAG COMPENSATION on/off.
- **Targets:**
  - SPAWN TARGET DUMMY (one 200 HP dummy 8 m ahead, pulled in until in clear sight);
  - SPAWN RANGE ROW (8 / 15 / 25 / 40 / 60 m);
  - MOVING DUMMIES (fixed ±2.5 m strafe);
  - BOTS FIRE (bot operators fire bursts at dummies in sight, for firefight load);
  - HURT SELF (25 damage from ahead-left).
- **Live stats:** pick a weapon and drag any stat. The server and client prediction switch to the new value together; RESET WEAPON STATS restores the data file.
- **Network:** a new JITTER slider (0–100 ms, order preserved) next to latency and loss.
- **Debug draw:**
  - HITBOXES (body grey, head pale);
  - HIT RAYS + REWIND (SERVER): server rays, the rewound target boxes and the rewind in ms, kept for 2 s.

## 8. How to test by hand

1. Run `npm run dev` and open `http://localhost:5175/?solo=1` (5173 on this machine). Click to capture the mouse.
2. Basic controls:
   - **Fire:** left mouse (F when mouse capture is unavailable).
   - **Aim:** right mouse.
   - **Reload:** R.
   - **Switch:** 1–5 or the wheel.
   - **Oil flask:** G.
   - **Fingers of God:** Q, once the meter reads READY.
3. Open the dev panel (` or F4) → WEAPONS → SPAWN RANGE ROW. Shoot the dummies with each tier and watch damage numbers, hit markers (pale = headshot) and kills in the kill feed.
4. Reloads:
   - Empty a magazine to see the automatic reload.
   - Press R, then switch weapons mid-reload: the magazine stays as it was.
   - On the BREAKER, fire mid-reload to interrupt the shell-by-shell load.
5. Oil and fire:
   - Throw a flask (G) at the dummies, then fire the SLAG LAUNCHER (5) into the slick to set it burning.
   - Watch the fire spread to a second slick thrown next to it.
6. Fingers of God: FILL FINGERS OF GOD, aim at the range and press Q. Watch the telegraph rings, then the five beams.
7. Movement: fire the SMG while sliding, wall-running, double-jumping and mantling (the Movement Lab is `/?solo=1&level=lab`). From a sprint, a trigger pull stops the sprint and fires after a short raise.
8. Lag compensation:
   - Set NETWORK → LATENCY 100, JITTER 20, then WEAPONS → MOVING DUMMIES.
   - Shoot the strafing dummy: hits register where you see it. With LAG COMPENSATION off you must lead the target.
   - DEBUG DRAW → HIT RAYS + REWIND shows the rewound boxes.
9. Feedback: HURT SELF shows the damage-direction arc and health loss; four presses show the death overlay and the respawn.
10. Ammo crate: the entrance crate is at the plaza (x 0, z 10); walk over it with a depleted reserve.
11. Live stats: WEAPONS → LIVE STATS → set the RIVET's DAMAGE to 45. One body shot on a fresh dummy removes exactly 45 HP.

## 9. Known issues

1. **Intel UHD at 60 fps is not measured** (§6), and the firefight's 430 draw calls exceed the earlier UHD envelope (399) by about 8%. If it misses 60 fps there:
   - first lower the LOW effect caps;
   - then lower the capsule count (bots/dummies), which drives most of the increase.
2. **The movement browser test's Foundry street segment fails, and that predates this work.** Its scripted run from (9.2, 74) lands at (12.4, 61) with no wall-runnable surface in reach.
   - The same chain replayed in Node gives the identical landing with and without the 3.7 props, and against the committed HEAD level and code (checked in a temporary worktree).
   - The Movement Lab segment passes fully: every state reached, 0 reconciliations, 0 prediction error across 727 matched snapshots.
   - The test's route needs updating; that was out of scope here.
3. **Lag compensation near its cap.** At 100 ms + 20 ms jitter, rewinds reach about 290 ms, close to the 300 ms cap. Above roughly 150 ms round trip, shots are only partly compensated and players must lead moving targets.
4. **Area hazards ignore walls.** Fire and oil radii (and ignition reach) use distance only, so a floor fire next to a thin wall can burn someone just behind it. Direct and splash damage do check line of sight.
5. **`firesCapped` counts attempts, not slicks.** It increments every tick while a scheduled ignition waits on a full cap.
6. **Visuals:**
   - The weapons are placeholders with no hands.
   - The viewmodel draws after post-processing, so it gets no grain or vignette.
   - A remote shooter's muzzle is estimated from their eye height.
   - A remote slag shot shows only its flash; the slug comes from the server projectile.
   - Decals recycle without fading.
   - Burn ticks do not trigger hit markers; kills always do.
7. **Audio is procedural and has not been listened to:** headless runs only confirm it plays without errors. **NEEDS HUMAN REVIEW.**
8. **Expected reconciles.** Server-side additions to weapon state cause one reconcile each: Fingers of God charge from damage, crates, dev give/refill. Each replays a few inputs; steady firing causes none (measured: 0 in 3 s idle, 0 in 3 s firing).
9. **Dead dummies.** A dummy is untargetable for its 2 s reset; dummies have no AI, and robots arrive in Prompt 5.
10. **Unlocks.** Production rooms start with tiers 1–2 and have no weapon pickups yet; only dev tools grant tiers 3–5. Unlocks belong to progression.
11. **Subjective — NEEDS HUMAN REVIEW:**
    - weapon feel and recoil;
    - ADS and the scope;
    - viewmodel look and animation;
    - effect readability;
    - HUD readability;
    - audio.
12. **Uncommitted.** Nothing is committed: Prompt 4 sits on top of the uncommitted Prompt 3.7 work.
