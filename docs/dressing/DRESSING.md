# Asset pipeline and dressing pass (Prompt 3.7) — 2026-10-24

Foundry Row now uses CC0 models, materials and HDRIs from Poly Haven and ambientCG, plus the
procedural forge, in all five play areas. Nothing was committed or pushed. Items that need a
person's judgement or other hardware are marked **NEEDS HUMAN REVIEW**. Every number here
was measured, and each one says where it came from.

## 1. Network test and route

- **Result:** the network works, so this pass took the **download route**. Every asset is a CC0 download.
- **Poly Haven:** `api.polyhaven.com/assets?t=models|textures|hdris` returns 200 (521 models), and `/info/{id}` and `/files/{id}` return 200.
  - The API has no licence field; the whole site is CC0.
  - IDs are case-sensitive: `/info/Barrel_03` returns 404, while `barrel_03` exists. Assets were found by category and tag queries, not guessed IDs.
- **ambientCG:** `ambientcg.com/api/v2/full_json?id=<ID>&include=downloadData` returns the download list. The 1K-JPG zip is `https://ambientcg.com/get?file=<ID>_1K-JPG.zip`.
- **Integrity:** Poly Haven downloads are md5-verified.
- **Other sources:** ShareTextures and cgbookcase were not needed.

## 2. Pipeline

The scripts live in `tools/assets/`; full documentation is in [tools/assets/README.md](../../tools/assets/README.md).

1. **Fetch** downloads a list of IDs into a git-ignored cache. A run aborts on any asset that declares a non-CC0 licence.
2. **Optimize** produces one GLB per model. It simplifies to a 3k-triangle target (8k hard cap), downscales textures to 512 or 1024 px, and strips unused data and unsupported extensions. Materials become 1024 px and 512 px JPEG sets; HDRIs stay as 1k `.hdr`.
3. **Register:** optimize merges the results into `asset-manifest.json`, regenerates `packages/shared/src/asset-catalog.ts`, and prunes entries (and their files) that have left the list.

Each manifest entry records the id, source site, source URL, licence (CC0), author, triangle count, texture size, category, procedural fallback and byte size.

### Commands (also for future factories)

```sh
npm run assets:pipeline                                  # fetch + optimize the Foundry Row list
npx tsx tools/assets/fetch.ts tools/assets/lists/<factory>.json
npx tsx tools/assets/optimize.ts tools/assets/lists/<factory>.json [--only id,id]
npm run assets:check                                     # every manifest path: real or fallback
npx vitest run tests/dressing.test.ts                    # CC0/source/usage, counts, clearance, budgets
CHROMIUM_PATH=<chrome> GAME_URL=http://localhost:5175 npm run dressing:capture            # LOW 720p shots, stats, caps
CHROMIUM_PATH=<chrome> GAME_URL=http://localhost:5175 PRESET=MEDIUM NO_SHOTS=1 npm run dressing:capture
CHROMIUM_PATH=<chrome> GAME_URL=... BLOCK_ASSETS='assets.(models.cc0|textures.cc0|hdri).' NO_SHOTS=1 npm run dressing:capture  # missing-asset run
npm run dressing:report                                  # per-area markdown tables from the capture
CHROMIUM_PATH=<chrome> TEST_URL=http://localhost:5175 npm run level:collision-audit
```

**Notes on running these:**

- This machine served Vite on 5173, so these runs used `GAME_URL`/`TEST_URL=http://localhost:5173`.
- In Git Bash, keep the leading `/` out of `BLOCK_ASSETS`: MSYS rewrites values that start with `/` into Windows paths.

**Adding a new factory:**

1. Write `tools/assets/lists/<factory>.json`.
2. Add zone entries to `ZONE_MATERIALS` (`packages/client/src/world-materials.ts`) and to `ZONE_PALETTES` (`packages/shared/src/foundry-props.ts`).
3. Run the commands above.

### What shipped

| Kind      | Count | Size     | Notes                                                                                                                                       |
| --------- | ----: | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Models    |    54 | 21.45 MB | 152,186 triangles in total; the largest is 5.0k (`old_military_compressor`). 29 categories. All 54 are placed in the level (test-enforced). |
| Materials |    13 | 10.92 MB | ambientCG, 1024 px and 512 px albedo/normal/roughness/AO sets. All 13 are used by zone sets (test-enforced).                                |
| HDRIs     |     2 | 3.11 MB  | `abandoned_slipway`, `petit_port` (1k). Lighting and reflections only; graded at load (§4).                                                 |

The raw download cache (`tools/assets/.cache/`, about 282 MB) is git-ignored.

**Rejected at download:**

- Bright or toy-like: Barrel_02, the plastic crates, the propane tank and the wet-floor sign.
- Not industrial: wine barrels, the monobloc chair, the school desk, compost bags.
- Wrong era: Victorian lamps and gates.
- Duplicates.
- The Korean payphone.

**Removed after the dressing review** (pruned with the optimizer):

| Asset                             | Reason                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `modular_electric_cables-conduit` | 4 cm footprint; it only padded the counts.                                   |
| `overhead_crane`                  | Simplification broke the hoist cables, and at 12.5 m nothing could place it. |
| `MetalWalkway014`                 | Needs alpha-tested opacity, and no surface class uses it.                    |
| `PaintedPlaster016`               | Read as camouflage on tenement roofs.                                        |
| `covered_car`                     | At 4.4 m it never fit beside the routes.                                     |
| `ladder_sectioned_01`             | Never passed clearance.                                                      |
| `modular_fire_escape-ladder`      | A free-standing 6.5 m kit piece.                                             |

## 3. Dressing by area

The prompt's five areas sit on the seven layout zones as shown in the area column below. Prop counts include:

- the 3.6 cover blocks, converted in place (same colliders),
- new beside-route clusters,
- roof props on all 11 room roofs,
- a coverage pass that places every catalog model at least once.

Blocking props get a simple box collider equal to their footprint. Tiny loose items are decorative only (`reason: 'small'`).

Totals: 2,915 props of 112 types (54 CC0 models and 58 procedural forge families). 85 of them stand on roofs.

| Area            | Zones       | Props | Types | CC0 props / types | Blocking / decor | On roofs | Landmark                                                                       |
| --------------- | ----------- | ----: | ----: | ----------------: | ---------------: | -------: | ------------------------------------------------------------------------------ |
| Spawn street    | entrance    |   216 |    55 |           38 / 25 |        116 / 100 |       12 | water-tower (65.2 m)                                                           |
| Rooftops        | tenements   |   394 |    51 |           43 / 27 |        150 / 244 |       17 | bracken-signal (61.2 m)                                                        |
| Container yard  | rail        |   489 |    40 |           41 / 18 |        176 / 313 |       11 | freight-gantry (50.2 m)                                                        |
| Smokestack yard | slag, pumps |   788 |    69 |           83 / 29 |        311 / 477 |       22 | vale-gasholder (55.2 m), stack-0 (83.2 m), stack-1 (98.2 m), stack-2 (113.2 m) |
| Foundry hall    | hall, core  |  1028 |    61 |           82 / 30 |        368 / 660 |       23 | ore-bridge (73.2 m), vesper-furnace (73.2 m)                                   |

### Material sets

Each set maps a surface class to a CC0 material key. Ground slabs span several zones, so the client draws each zone's part of a slab with that zone's ground material. The slab itself stays as the hidden collider proxy.

| Area            | Ground                                                              | Concrete                                                    | Brick                              | Metal                                                 |
| --------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Spawn street    | asphalt.wet (Asphalt025C)                                           | concrete.stained (Concrete035)                              | brick.red (Bricks097)              | metal.painted (PaintedMetal014)                       |
| Rooftops        | asphalt.wet                                                         | concrete.stained                                            | brick.soot (Bricks058)             | metal.rusted (Metal053C)                              |
| Container yard  | asphalt.wet                                                         | concrete.stained                                            | brick.red                          | metal.corrugated (CorrugatedSteel005)                 |
| Smokestack yard | slag: rock.rubble (Ground111); pumps: concrete.floor (Concrete047A) | slag: concrete.stained; pumps: concrete.clean (Concrete046) | slag: brick.soot; pumps: brick.red | slag: metal.dark (Metal046B); pumps: metal.painted    |
| Foundry hall    | concrete.floor                                                      | hall: concrete.floor; core: concrete.stained                | brick.soot                         | hall: metal.plates (MetalPlates013); core: metal.dark |

Wood uses wood.planks (Wood080) everywhere. Procedural prop recipes also use the CC0 sets:

| Recipe      | CC0 material     |
| ----------- | ---------------- |
| steel, pale | metal.painted    |
| rust        | metal.rusted     |
| galvanized  | metal.plates     |
| iron        | metal.dark       |
| concrete    | concrete.stained |
| brick       | brick.red        |
| wood        | wood.planks      |

Every architectural solid with a face of at least 50 m² (294 of them) resolves to a CC0 material (test-enforced).

## 4. Rendering changes

- **Prop layer** (`packages/client/src/prop-layer.ts`): each prototype loads once, either the GLB or its forge fallback.
  - **Imported models:** instanced per 48 m cell. They are desaturated 80% toward the monochrome palette and tinted with a seeded per-instance grey.
  - **Procedural props:** share 11 recipe materials, so they are merged statically per cell and material. This bounds draw calls however many families a cell mixes; it cut prop draw calls by about a third.
  - **Distance culling** per cell: LOW 55 m, MEDIUM 100 m, HIGH 140 m (×1.8 for large props).
  - **Missing files:** a missing or failing GLB falls back to its forge family.
- **Collision contract:** a blocking prop keeps the shared solid's nominal box or cylinder as a hidden mesh tagged with its solid id. The existing collision sweep audits it unchanged, and the model is fitted inside that footprint.
- **Prop picker:** stretch is capped at 1.6× per axis for imported models and 2.5× for forge props. Picks are least-used first, then a coverage pass places any model still unused. Thin blocking panels get colliders at least 12 cm deep.
- **HDRI:** graded at load. The grade desaturates it 75%, soft-clips the sun and pulls each row 80% toward its azimuthal mean, so wet ground cannot mirror one bright side. Its intensity is scaled so the upper hemisphere matches the procedural sky dome. It is used only as the environment; the fogged procedural sky stays the visible background.
- **Zone materials:** world-projected at each material's physical tile size. They use real roughness and macro breakup (the albedo sampled again at about 11× scale) and are desaturated 35%.
- **LOW texture tier:**
  - Imported prop textures are capped at 512 px, or 256 px for props under 1 m.
  - Prop normal maps are dropped.
  - All prop and zone textures upload during loading.
- **Fixed during measurement:**

| Problem                                                                                   | Fix                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Switching quality preset dropped the zone materials.                                      | Zone materials now survive preset changes.                                                              |
| Two lamp materials compiled shaders mid-run (an 89 ms hitch).                             | The loading warm-up frame now draws every prop, and blended double-sided props render in a single pass. |
| The perf fly-through crashed when the first frame's timestamp came before the start time. | The path index is clamped (`Math.max(0, …)`). This bug predates this pass.                              |

## 5. Performance

**Caps, enforced by `dressing:capture` (it exits 1 on any breach), at LOW 1280×720:**

- **≤ 406 draw calls and ≤ 475k triangles per view.** This is the envelope the pre-dressing build held at a locked 60 fps on Intel UHD in [docs/perf/redesign-low.json](../perf/redesign-low.json).
- **≤ 96 MiB of decoded textures per zone.**

`tests/dressing.test.ts` adds static per-48 m-cell budgets: at most 140 props and 40 prop types per cell.

**LOW capture** ([capture-low.json](capture-low.json)), RTX 5070 Ti. No cap was exceeded:

- 23 views: the 15 review views, the `composition` view and the seven zone player views.
- Draw calls per view: 144–385.
- Triangles per view: 142k–253k.

| Area            | Review views (draw calls) | Review views (triangles) | Zone player view           | Prop meshes in zone | Prop triangles in zone | Textures, LOW (MiB)   |
| --------------- | ------------------------- | ------------------------ | -------------------------- | ------------------: | ---------------------: | --------------------- |
| Spawn street    | 374 / 237 / 345           | 192k / 180k / 191k       | 368 dc, 185k               |                 108 |                   171k | entrance 89.4         |
| Rooftops        | 254 / 287 / 174           | 184k / 173k / 149k       | 335 dc, 142k               |                 171 |                   237k | tenements 80.1        |
| Container yard  | 157 / 276 / 169           | 144k / 157k / 153k       | 360 dc, 191k               |                 195 |                   264k | rail 74.5             |
| Smokestack yard | 285 / 312 / 331           | 238k / 188k / 253k       | 256 dc, 214k; 273 dc, 228k |                 277 |                   478k | slag 63.2, pumps 62.2 |
| Foundry hall    | 144 / 172 / 257           | 188k / 192k / 241k       | 329 dc, 209k; 308 dc, 171k |                 375 |                   571k | hall 80.1, core 71.2  |

**MEDIUM 1920×1080** ([capture-medium.json](capture-medium.json)), reported but not capped:

- Draw calls per view: 175–497.
- Triangles per view: 179k–407k.
- Textures: 174–256 MiB per zone.

**Fly-through** (the repo's 60 s `perf` camera path; [perf-path-low.json](perf-path-low.json), [-medium](perf-path-medium.json), [-high](perf-path-high.json)), on the RTX 5070 Ti:

| Preset       | Frames | Average |  Worst | Peak draw calls | Peak triangles |
| ------------ | -----: | ------: | -----: | --------------: | -------------: |
| LOW 720p     | 16,799 | 3.57 ms | 4.2 ms |             390 |           256k |
| MEDIUM 1080p | 16,798 | 3.57 ms | 4.8 ms |             495 |           429k |
| HIGH 1080p   | 16,769 | 3.58 ms | 7.3 ms |           1,173 |          1.18M |

The averages sit at this display's 280 Hz refresh. The pre-dressing Intel UHD run of the same path peaked at 399 draw calls and 537k triangles at LOW, with a 16.66 ms (60 fps) average.

**Intel UHD at 60 fps: NEEDS HUMAN REVIEW (not measured).**

- This machine has only the RTX 5070 Ti; the iGPU is disabled, so no measurement on Intel UHD was possible here.
- What was measured: the dressed LOW build stays inside the draw-call and triangle envelope that the earlier UHD run held at 60 fps, and its texture budget is enforced.
- That evidence is indirect. To confirm on the UHD laptop, run:

```sh
CHROMIUM_PATH=<chrome> GAME_URL=http://localhost:5175 npm run dressing:capture
```

Then run `scripts/redesign-perf.ts` there and compare its LOW `averageMs` with 16.7 ms.

**Missing assets:** with every CC0 model, material and HDRI request answered 404 (82 requests), the game loaded with no page errors. All 2,915 props fell back to procedural models.

## 6. Screenshots (LOW 1280×720, HUD hidden)

All 15 are fixed cameras in the level (`dress-<area>-<n>`); regenerate them with `npm run dressing:capture`.
Each area's identity and whether it reads as empty are **NEEDS HUMAN REVIEW**.

**Spawn street:** [1](dress-street-1.png) · [2](dress-street-2.png) · [3](dress-street-3.png)

- **View 1** looks down the avenue toward the hall. Red-brick tenements run on both sides, with the water tower and the three stacks behind. A van wreck, a substation, fencing and utility boxes line the kerbs, and cables run overhead.
- **View 2** stands at the dispatch corner, with a CC0 crate stack in the foreground. Tyres, drums, a utility cabinet and pallets sit at the building base.
- **View 3** is an elevated overview of the square: gantry walkways, scattered crates, barriers and poles.
- **Weakness:** the wet asphalt is even and plain at distance, and the middle of the street is deliberately clear for the route.

**Rooftops:** [1](dress-roofs-1.png) · [2](dress-roofs-2.png) · [3](dress-roofs-3.png)

- **View 1** is on the Bracken tenement roof: rusted tanks, a vent stack, a generator cart and a drum on stained concrete, with a sooty brick parapet.
- **View 2** looks from the communal workshop roof across the lower tenement roofs, with a pipe run on the roof edge.
- **View 3** is an elevated view over the tenement block, showing the fire-stair tower and roof plant against the signal tower.
- **Weakness:** roof dressing is sparse (17 props across the tenement roofs). The signal tower's crown in view 2 floats above the fog line because its thin legs fade (3.6 geometry).

**Container yard:** [1](dress-yard-1.png) · [2](dress-yard-2.png) · [3](dress-yard-3.png)

- **View 1** looks across the rail yard. Compressors, generators, carts and drum clusters line the facades.
- **View 2** looks toward the container row, with lamp posts, a barrel and crate stack, and corrugated metal.
- **View 3** is elevated over the yard's clusters and signage.
- **Weakness:** this is the weakest area. Big plain warehouse facades dominate, and the only containers are the 15 primitive container boxes from 3.6; Poly Haven has no suitable CC0 container. **NEEDS HUMAN REVIEW.**

**Smokestack yard:** [1](dress-stacks-1.png) · [2](dress-stacks-2.png) · [3](dress-stacks-3.png)

- **View 1** looks up at the three stacks, with pipe gantries and signage.
- **View 2** shows the pumps yard on poured concrete: a pipe-and-valve plant cluster, pallets, crates and cabinets.
- **View 3** is elevated over the slag yard: rubble ground, a drum cluster, poles and cabling.
- **Weakness:** the zone seam between asphalt and rubble is a straight line.

**Foundry hall:** [1](dress-hall-1.png) · [2](dress-hall-2.png) · [3](dress-hall-3.png)

- **View 1** looks down the hall nave on concrete floor, with crate stacks, a compressor, tool carts, shelves and racks under the gallery.
- **View 2** has a rusted drum in the foreground with pallets, crates and barrels across the floor.
- **View 3** is at the core entrance: a dumpster, a workbench and overhead cable runs.
- **Weakness:** the floor is pale and even far into the fog.

## 7. Weak spots

1. Intel UHD 60 fps was not measured on this machine (§5).
2. The container yard still reads as a broad plaza; there is no CC0 shipping container.
3. 204 converted 3.6 cover blocks keep their gameplay collider sizes, so their procedural stand-ins stretch up to 4× on one axis. Imported models never stretch more than 1.6×.
4. Subjective: does the world still look empty, are the area identities readable, and are the materials consistent? **NEEDS HUMAN REVIEW.**
5. Zone ground changes along straight zone bounds.
6. A few props still carry colour after the 80% desaturation: a red pallet and a blue-violet slab in the pumps yard.
7. Rooftop dressing is light: 85 roof props across 11 roofs.
8. Nine of the 13 ambientCG materials publish no physical size, so they use default 2–2.5 m tiles.
9. Four models needed UV-seam collapse during simplification, so texture stretching at seams is possible (hand truck, power box, welding cart, generator).
10. At LOW, props lose their normal maps and small props use 256 px maps. MEDIUM keeps the full maps.
11. Caps are enforced by the capture script, not by CI. At runtime only distance culling and the texture tier bound the cost.
12. The repo-wide `prettier --check` fails on this Windows checkout because of CRLF working copies (`core.autocrlf=true`). With `--end-of-line auto`, every file passes.
