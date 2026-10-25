# Foundry Row — seven-beat redesign

This replaces the playable `foundry-row` layout with a 420 × 340 m compound (x −210…210, z −250…90), seed 71017. The entrance player spawns and yaw are retained. `foundry-row-overcast` uses the same structural data with its weather variant. Combat markers and gates have no new behavior.

![Current compound map](map-after.svg)

## Progression and timing

| Beat            | Bounds / area                     | Intended route | Purpose, identity and circulation                                                                                                                                                                                                                |
| --------------- | --------------------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ravel Gate      | 120 × 90 m                        |          131 m | Arrival plaza and brick workshops; water tower and three-stack composition. Main street plus parallel east flank, enterable gate workshop and dispatch office, shallow stairs to the workshop roof.                                              |
| Bracken Courts  | 150 × 160 m                       |          320 m | Dense brick court and signal tower; a firebreak folds the street around two enterable buildings. Court flank, 48 m wall-run face, 18 m roof link and a workshop mezzanine.                                                                       |
| Kainos Freight  | 150 × 180 m                       |          490 m | Corrugated rail sheds, gantry, freight assemblies and container tiers. Alternating loading walls force a serpentine route. Secondary loading lane, −3 m flooded yard, +4 m rail embankment with two stair approaches, three optional jump lanes. |
| Vale Condensers | 120 × 140 m                       |          210 m | Pale concrete, cool green-grey machinery, gas holder and tank crowns. Main boiler loop and 4 m service flank; 1.3 m clearance slide tunnel, two enterable pump buildings, steam emitter and thick physical pipe racks.                           |
| Ash Transfer    | 120 × 110 m                       |          305 m | Soot-dark screens, three unequal stacks, flooded slag yard and hoppers. Folded main path and west flank; low yard stairs, control room, distributed low/medium/high cover.                                                                       |
| Narrow Iron     | 150 × 180 m                       |          410 m | Vaulted industrial hall, ore bridge, warehouse, pillars and vats. Ground circulation surrounds the furnace spine. Catwalks at 6/12/18 m connect around the south end and use a stair tower.                                                      |
| Vesper Core     | 150 × 160 m                       |          385 m | Dark platework and furnace silhouette. Wide circulation wraps the central divider; east service flank, enterable control room, workstations, burn point and exit-machine marker.                                                                 |
| **Total**       | **142,800 m² bounding footprint** |    **2,251 m** | **32 ordered waypoints through all seven beats.**                                                                                                                                                                                                |

The intended path takes **140.6875 s at a constant 16 m/s cap**, or **281.375 s at a constant 8 m/s sprint**. The actual shared movement integrator completes all 31 segments in **284.05 s**, including acceleration and turns. These are intended-route times, not a claim that every possible shortcut has that duration. Future encounters supply the remaining mission pacing; this stage adds no enemies or combat behavior.

The half-metre ground graph measures 1,625 m using cardinal steps to the final waypoint. This is a Manhattan graph distance, not a shortest full-movement speedrun. Closing each of the six progression throats disconnects all later districts. A separate sampled bot search uses slide-jumps, double jumps, mantle attempts and both wall-chain directions at district seams. See `progression-audit.json` for its 1,296 probes and limitations. This is sampled verification, not a mathematical proof over all possible input sequences.

## Clearances and traversal

All authored primary reservations are 8 m wide; secondary reservations are 4 m. Gate openings are 10 m wide and 7 m high. Rooms have two 4 × 3.6 m doorways. The main and secondary routes are swept at one-metre intervals for a 3.2 m standing clearance, including their full width and a longitudinal hull margin. Both ends of every flank touch the main route; the slide and jump lanes are explicitly optional shortcuts.

Ground slabs have real openings over the two −3 m yards. Rail stairs reach +4 m. Required roof routes use the 14.4 m gate workshop and 18 m tenement. Gate workshop and tenement have internal 6 m mezzanines; the hall supplies three further gallery levels. Other roofs are optional surfaces, not compulsory navigation destinations. Stair treads are 0.42 m deep, at least 4 m wide, with risers at most 0.15 m. No sloped collision was added.

Three authored wall-run faces are 48 m long. Jump pads are 6 m apart centre-to-centre with 4 m clear gaps. Cover supplies mantle-sized edges; perimeter and partition walls are not wall-runnable or mantleable. Every structural object, including furniture, posts, steps and protruding sills, is authored in shared level data.

## Dressing and future-combat data

Each zone reserves a minimum number of seeded solid dressing clusters: 40 / 100 / 130 / 110 / 100 / 160 / 120. The density metadata sets 12 clusters per 1,000 m²; the actual solids and visual objects are listed per zone in `check.json`. Stair treads, façade skins and repeated trim inflate raw object counts; they are not presented as independent storytelling props. Fourteen composed vehicle, freight, pipe, hopper, vat and workstation arrangements complement the seeded cover and surface wear.

There are **80 enemy spawn markers** (70 ground, 7 interior, 3 elevated), **168 cover points**, 21 pickup locations, 7 checkpoint positions, 7 encounter definitions and the burn/exit objectives. They remain inert. The development overlay uses salmon for enemies, cyan for cover, violet for pickups, orange for burn, green for exit and gold for the path. Encounter bounds are wire boxes. The SVG map includes all these categories and object tooltips.

## Collision contract

`LevelKit` emits matching solid visual records and shared colliders. Round primitives use crossed inset strips following the actual twelve-sided mesh. The audit checks shape-aware volume coverage, collider protrusion, classification and overhead clearance. Overhead clearance includes optional physical tops across the full ornament footprint; the `platform` flag is not an exemption. Decorative stand-offs are below the 0.3 m horizontal-size threshold.

The client sweep uses actual instanced geometries at 0.3/1.0/1.7 m, a 1 m grid and eight directions. It compares 3,445,464 rays, allowing the requested 0.1 m surface discrepancy. A 50 micrometre box-edge tolerance handles float32 instance transforms. An origin inside the permitted inset skin is compared to its nearest boundary before outward distances are compared. Missing geometry is not suppressed. Mismatches include object IDs, position and direction. The wall-walk audit isolates each substantial solid and approaches all four faces through the real movement integrator, preventing a neighboring wall from concealing a missing collider.

## Review evidence and limits

`before/` preserves the baseline captures, `after/` contains 1920 × 1080 redesign views and gallery captures, and `contact/` provides inspection sheets. `CRITIQUE.md` records the original measured problems; `REVIEW.md` compares them with the final state. The camera catalogue contains player and elevated views of every zone, three interiors, stairs, wall-run face, slide tunnel, seal and distant landmark views. `view-variety.json` reports pairwise image differences and actual mesh-occlusion probes.

The distant landmark stations are 165 m away. The signal tower, freight gantry and gas holder use elevated free-fly stations; the furnace station is also elevated. They must not be described as proven ground-level 165 m sightlines. The tall district partitions remain visually dominant in some views. These constraints are recorded in the acceptance report rather than hidden by the camera tests.
