# Foundry Row redesign measurements

GPU: ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11). Native Intel UHD via ANGLE; not software-rendering estimates. Each preset follows the 60-second camera path through all seven zones after stationary views. Browser frame pacing was approximately 60 Hz. The path crosses geometry between review stations; this is a repeatable rendering benchmark, not a walkable navigation route.

| Preset | Viewport    | Mean fps | Worst frame ms | Peak calls | Peak triangles | Reported GPU ms |
| ------ | ----------- | -------: | -------------: | ---------: | -------------: | --------------: |
| LOW    | 1280 × 720  |    60.01 |          17.60 |        399 |        537,330 |            4.25 |
| MEDIUM | 1920 × 1080 |    60.01 |          17.50 |        422 |        558,562 |            9.09 |
| HIGH   | 1920 × 1080 |    59.67 |          50.00 |        838 |      1,046,502 |           11.26 |

LOW meets the 60 fps target within measurement rounding. MEDIUM exceeds 50 fps. HIGH has no requested minimum; its 50 ms worst frame is retained here rather than hidden behind its average. GPU time is a sampled timer result, not a frame-time percentile. Measurements preceded the final clearance adjustment to one ornament; that change adds no solid geometry, textures, material types or render pass.

## Per-view rendering cost

| Preset | View             | Calls | Triangles | Sampled GPU ms |
| ------ | ---------------- | ----: | --------: | -------------: |
| LOW    | composition      |   406 |   475,104 |           6.14 |
| LOW    | entrance-player  |   383 |   471,056 |           3.64 |
| LOW    | tenements-player |   360 |   370,382 |           3.78 |
| LOW    | rail-player      |   381 |   454,028 |           5.01 |
| LOW    | pumps-player     |   234 |   316,530 |           7.92 |
| LOW    | slag-player      |   268 |   367,648 |           5.03 |
| LOW    | hall-player      |   340 |   429,092 |           4.23 |
| LOW    | core-player      |   335 |   374,084 |           3.61 |
| MEDIUM | composition      |   439 |   517,336 |           8.29 |
| MEDIUM | entrance-player  |   416 |   512,640 |           6.55 |
| MEDIUM | tenements-player |   375 |   384,294 |           8.62 |
| MEDIUM | rail-player      |   391 |   484,732 |           7.01 |
| MEDIUM | pumps-player     |   245 |   333,594 |           7.23 |
| MEDIUM | slag-player      |   279 |   400,368 |           8.00 |
| MEDIUM | hall-player      |   351 |   448,608 |           7.28 |
| MEDIUM | core-player      |   347 |   385,680 |           7.22 |
| HIGH   | composition      |   876 | 1,038,068 |          11.12 |
| HIGH   | entrance-player  |   826 | 1,027,646 |          11.49 |
| HIGH   | tenements-player |   744 |   772,242 |           8.02 |
| HIGH   | rail-player      |   391 |   486,652 |           8.21 |
| HIGH   | pumps-player     |   245 |   335,514 |          10.17 |
| HIGH   | slag-player      |   279 |   402,288 |           9.64 |
| HIGH   | hall-player      |   351 |   450,528 |           8.35 |
| HIGH   | core-player      |   689 |   771,824 |          10.69 |

## Server and lifecycle

- Eight-player server CPU: mean 0.1169 ms, p95 0.2160 ms, p99 0.3614 ms, maximum 0.7575 ms over 3,600 measured ticks. All six movement states exercised. See [movement-server.json](movement-server.json).
- Isolated production stress: eight bots, 181.142 seconds, 25 reconnects, 36,321 snapshot comparisons, p95 prediction error 0 m, maximum 1.1167 m, RSS increase 82.57 MiB. See [redesign-stress.json](redesign-stress.json). The earlier development-server RSS failure is recorded in DECISIONS.md; it was not relabeled as passing.
- Ten replay cycles and nine quality switches: see [revision-replay-cycles.json](revision-replay-cycles.json) and [quality-cycles.json](quality-cycles.json).
- Single-port production: 17 development commands rejected, no development UI or gallery, HTTP and WebSocket on port 3004. See [redesign-production.json](redesign-production.json).
- All client JS/CSS chunks, including lazy gallery and audit: 1030.20 kB raw / 301.95 kB gzip. Main game chunks are approximately 289.31 kB gzip plus 4.29 kB CSS. [Exact file sizes](redesign-bundle.json). Server bundle: 236.5 KiB.
- Forge export: 267 GLBs, 17,111,952 bytes total. Optional exports are separate from the JS bundle. Empty-assets manifest check and actual browser startup passed, followed by successful water-tower/gantry GLB overrides.

These measurements do not certify the visual-art acceptance criteria; see [the visual review](../layout/REVIEW.md).
