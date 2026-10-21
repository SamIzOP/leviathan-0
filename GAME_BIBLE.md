# LEVIATHAN 0

A browser-based cooperative first-person shooter for 2–8 PC players. Operators open a public link, choose a callsign, and create or join a four-character room. No accounts, installation, or login. Each player has an independent screen synchronized to an authoritative server. Sessions will last about five minutes.

The Kainos are humans with discreet mechanical limbs. Their home is the artificial planet Leviathan 0. Corrupted industrial robots obey VANE SS, a rogue scientist robot. Crews will fight through roughly six factories before the final confrontation. Names and assets are original.

## Direction

Near-monochrome cold greys, steel blues, desaturated browns and a single pale accent. Rain, fog, wet reflective streets, heavy depth haze, subtle film grain, restrained condensed typography. Lonely, damp, industrial. Foundry Row now supplies the playable industrial district; player and dummy capsule bodies retain their diagnostic appearance.

### Final 2D interface rules

Brutalist concrete slabs with a cold industrial edge: left-anchored entry panel, stenciled serial labels, an inverted oversized 0, technical registration marks, tabular rosters, full-screen countdown and hard-edged vote progress. Every panel is opaque. All corners are square; borders are 2–3px, with selected heavier edges. Shadows are hard 8px offsets without blur. No glass, UI gradients, glow or bouncy motion. Button inversion and 2px press movement use 80–100ms steps. Respect reduced motion and retain visible pale keyboard focus.

| Token        | Hex     | Role                                     |
| ------------ | ------- | ---------------------------------------- |
| ink          | #0A0E11 | Deep background, reverse type            |
| concrete-900 | #11171B | Main slabs                               |
| concrete-800 | #192026 | Secondary surfaces                       |
| concrete-700 | #242E36 | Structural framing                       |
| steel        | #3A4A56 | Dividers and tracks                      |
| mist         | #8A98A1 | Secondary text                           |
| pale         | #D3D9DB | Primary text, focus, inverted buttons    |
| brown-dust   | #4B4137 | Sparse weathering                        |
| warning      | #C9B458 | Hazard markings and critical alerts only |

Use these CSS variables from the theme module. Preloaded, locally bundled Oswald 700 is the condensed uppercase display face; IBM Plex Mono 400 is the body/label/numeral face. Use an 8px structural spacing grid, compact 9–13px technical labels, 32–48px section headings and oversized 64–112px entry lettering, with responsive adjustments. Pale/mist text sits on dark solid surfaces; pale buttons use ink text.

Menu art is a separate capped Canvas dead street: one-point perspective, darker right-hand buildings, brick variation, left water tower, three central stacks, distant haze, washed-out sky, wet pale road, parked cars and one white van. Slow smoke/fog drift, fine rain and low-rate grain provide restrained motion. Local `/assets/menu-bg.webp` or `.jpg` can replace it. Freeze for reduced motion, pause in hidden tabs and stop/release canvases during a match. These interface rules apply to 2D menus/HUD; the world art bible below defines the 3D environment.

## Foundation delivered

Rooms, host migration, ready states, invite links, server countdown and match timers, results, replay/next-factory voting, reconnect grace, replacement-tab handling, heartbeat and ping, input validation, rate limits, prediction/reconciliation, interpolation, debugging, volume and sensitivity settings, manifest audio and synthesized fallbacks. Generic player/robot/projectile/pickup entities; only players and a development-only wandering dummy are simulated.

## Later milestones (not implemented)

- Ammo-based weapons, world ammo pickups and authoritative hit detection.
- Server-controlled robot waves, mission objectives and a final boss encounter.
- Additional distinctive factories, final imported assets and authored sound design.
- Future phone/gamepad support through the isolated input-command boundary. No mobile controls now.

After a mission, operators vote REPLAY or NEXT FACTORY. A strict count of cast votes determines the result; ties use the host's vote, then replay. NEXT changes the configured mission index and selects its shared level/weather variant.

## World stage: full art bible

Game: LEVIATHAN 0, a co-op first-person shooter on an artificial planet. The environment is a dead, rainy industrial district. The mood is lonely, damp and quiet, like the city is holding its breath.

Composition (the signature view; build a dev "composition camera" that jumps to it):

- Elevated, slightly high-angle view looking down a narrow street that recedes toward the horizon in strong one-point perspective.
- Row houses and brick buildings frame both sides. The RIGHT side is darker and closer, creating a natural vignette.
- Middle distance: a water tower on the LEFT, three tall smokestacks in the CENTER, and a hazy city skyline behind them.

Color and light:

- Almost monochrome: cold greys, steel blues and desaturated browns, with one cool tint over everything.
- Soft, diffused overcast light with NO hard shadows.
- The sky is bright, washed-out white-grey at the top and gets darker and heavier toward the smoke.
- The wet street is the brightest ground surface, reflecting the sky, so the road reads as a pale ribbon leading the eye into the distance.

Atmosphere:

- Heavy depth fog: distant buildings fade into haze, which gives scale and mood.
- Dark smoke or steam drifts from the stacks across the upper right and adds weight.
- Fine rain and moisture in the air.
- A soft, slightly blurry, filmic look, like a grainy lens.

Details that sell it:

- A few parked cars and one white van on the street for scale and a lived-in working-class feel.
- Small, dim windows and weathered brick suggest a rundown neighborhood.
- A lone bright accent (the white van and the pale road) against the dark surroundings.

Hard rules for the look:

- Use the palette tokens from the existing theme module (extend it with a "world" palette if needed). No saturated colors anywhere in the world. The only warm tones are desaturated browns and, very sparingly, dim lamp light.
- No hard shadows, no bright colorful props, no cartoonish proportions, no glossy plastic look. Everything should look worn, damp, dirty and serious. Nothing may look toy-like or childish.

## Foundry Row zones

Factory 1 is a sealed 220 × 180 m district: the entrance street leads through connected row-house rooftops, the west container yard and crane, the central smokestack yard and boiler house, and the northern Foundry Hall. The hall has three catwalk levels and a casting pit with two exits. Every usable elevated surface has an ordinary stair or jump-chain route; future traversal flags are metadata only. Factory 2 reuses Foundry Row with heavier rain, denser fog and a colder, darker grade. Remaining mission labels reuse these variants until a later stage.

## World revision: scale, confinement and personality

Foundry Row now occupies 220 × 180 metres. The street has 20 metres between facades, including 3.5-metre sidewalks. Twelve player spawns cluster at the locked entrance, looking into the complex. Visible 12-metre perimeter walls, locked gates, shutters and rubble barriers separate the playable compound from the city. Gate markers remain closed data only. Factory 2 shares this confinement.

Buildings have 6–16 metre frontages and four to eight 3.6-metre floors. Nine facade archetypes occur across the signature street: brick/shutter, render/stoop, panel/ribbon, dark brick/boarded, cladding/garage, brick/shop, render/irregular, panel/bricked and dark brick/balcony. Opposite sides use different width, height and roof sequences. Service stairs, patched masonry, boarded windows, balconies, drainpipes, cables, original shop signs, antennas and roof tanks break repetition. The right side remains darker.

The container lanes reach three 2.6-metre levels. The gantry is 28 metres tall. Three stacks rise 80–110 metres above their bases. The boiler is 21.6 metres high; the hall spans approximately 100 × 60 metres beneath a 30-metre ceiling, with catwalks at 6, 12 and 18 metres. Ordinary stairs reach roofs and gantries; ladders are visual future-access markers, not a new climb mechanic. Rear roof barriers prevent jumping over the lower perimeter wall.

The forge supplies environment models, including five vehicle silhouettes and their wrecks, utilities, storage, machinery, structural fittings and industrial landmarks. It remains procedural game art, with no downloaded models.

## Movement

Kainos operators move like trained couriers with mechanical legs: fast, heavy and exact. Traversal is the first system players master, so it must read instantly and never surprise.

Design pillars:

- **Momentum is earned and kept.** Sprint builds in a quarter second; slides, slide-jumps and wall-jumps carry speed forward; landing never stops you dead. Nothing grants unlimited speed: strafing adds none, a hard 16 m/s cap holds, and slide entry is capped.
- **Weight without sluggishness.** High gravity, short airtime, quick ground response, gently bleeding overspeed. One air jump, not a floaty glide.
- **Readable surfaces.** Only flagged long walls take a wall-run and only real ledges take a mantle; everything else is plain collision. Step-up handles stairs and kerbs.
- **Forgiving input, exact simulation.** Coyote time and jump buffering are tick-counted and identical on server and client; prediction stays exact.
- **Subtle presentation.** Camera roll, FOV kick, slide height, landing dip and head bob are small, eased and individually adjustable, with a REDUCE MOTION switch. No trails, glows or coloured effects.

Final tuned values (shared `MOVE` constants; measured by `npm run movement:harness`):

| Area      | Values                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hull      | radius 0.4 m; height 1.8 m standing, 1.0 m crouched/sliding; eye 1.65 / 1.1 / 0.9 m                                                                                                               |
| Ground    | walk 5.0, sprint 8.0 (walk→sprint 0.25 s at 12 m/s²), crouch 2.8 m/s; accel 40, brake/turn 50, overspeed bleed 9 m/s²; step-up 0.5 m                                                              |
| Jumping   | gravity 24 m/s²; jump apex 1.28 m (placeholder 1.225); one air jump at 6.9 m/s (reach ≈ 2.27 m) with 50% steer; air accel 14 m/s² up to 6.5 m/s; cap 16 m/s; coyote 0.10 s; buffer 0.12 s         |
| Slide     | sprint (≥ 6 m/s) + crouch press; entry max(speed, 8) × 1.15 capped at 11; decay 3.7 m/s² to 4 m/s (≈ 1.4 s, ≈ 9.3 m from a sprint); steer 0.6 rad/s; cooldown 0.35 s; slide-jump +1.0 m/s         |
| Wall-run  | flagged faces; airborne, ≥ 5.5 m/s, ≤ 0.1 m away, < 70° from the plane, ≥ 0.5 m up; eases to 9 m/s; 2 m/s rise over 0.6 s, then 15 % gravity (sink ≤ 1.6 m/s); 2.2 s max; 1.2 s same-wall lockout |
| Wall-jump | 5 m/s away, 7 m/s up, along-wall speed kept, air jump restored                                                                                                                                    |
| Mantle    | flagged ledges 0.6–2.3 m above the feet, within 0.35 m, facing ≤ 60°, airborne or jumping, standing room on top; 0.45 s eased climb; 4.5 m/s exit; crouch cancels                                 |
