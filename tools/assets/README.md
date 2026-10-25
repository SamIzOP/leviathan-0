# CC0 asset pipeline

Turns a list of asset IDs into optimized, registered runtime assets. Only CC0
sources are supported: [Poly Haven](https://polyhaven.com) (models, HDRIs,
texture fallback) and [ambientCG](https://ambientcg.com) (PBR materials). Both
publish their whole catalogue as CC0. Each asset's licence, author and source
page are recorded, and any asset that declares a non-CC0 licence aborts the run.

```sh
npm run assets:pipeline     # fetch + optimize the Foundry Row list
npm run assets:fetch        # download only (cached, skips verified files)
npm run assets:optimize     # rebuild outputs, manifest and catalog from the cache

# any list file; --only limits a run to some source IDs
npx tsx tools/assets/fetch.ts tools/assets/lists/<factory>.json
npx tsx tools/assets/optimize.ts tools/assets/lists/<factory>.json [--only id,id]
```

## What gets written

| Kind     | Output                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| model    | `packages/client/public/assets/models/cc0/<id>.glb` (single GLB, embedded textures)                                         |
| material | `packages/client/public/assets/textures/cc0/<key>/{albedo,normal,roughness,ao,metalness,opacity}_{1024,512}.jpg`            |
| hdri     | `packages/client/public/assets/hdri/<id>_1k.hdr`                                                                            |
| registry | `packages/client/public/asset-manifest.json` (merged) and `packages/shared/src/asset-catalog.ts` (generated, do not edit)   |
| raw      | `tools/assets/.cache/<source>/<id>/` with `info.json` (git-ignored); `report-<list>.json` holds per-asset numbers and notes |

Only the optimized outputs, the manifest, the generated catalog, the lists and
the scripts are committed. Never commit `tools/assets/.cache/`.

## Adding a new factory

1. Copy `lists/foundry-row.json` to `lists/<factory>.json` and change `name`.
2. Find IDs through the APIs (never guess; IDs are case-sensitive, e.g. Poly Haven
   has `barrel_03`, not `Barrel_03`):
   - Poly Haven: `https://api.polyhaven.com/assets?t=models|textures|hdris`
     (filter on `categories`, `tags`, `category`), details at `/info/<id>`,
     downloads at `/files/<id>`. Thumbnails:
     `https://cdn.polyhaven.com/asset_img/thumbs/<id>.png?width=256&height=256`.
   - ambientCG: `https://ambientcg.com/api/v2/full_json?type=Material&q=<words>&limit=100&sort=Popular`;
     add `&id=<id>&include=downloadData` for the download list.
3. Run `fetch.ts`, then `optimize.ts`, on the new list, then `npm run assets:check`.
   Rerunning a list replaces its entries. Entries that were removed from that
   list are dropped from the manifest and their files deleted, unless another
   list still uses them. Hand-written manifest keys are never touched.

## List format

```jsonc
{
  "name": "foundry-row", // used to track which list owns which outputs
  "description": "...",
  "assets": [
    {
      "id": "barrel_03", // exact source ID
      "source": "polyhaven", // "polyhaven" | "ambientcg"
      "kind": "model", // "model" | "material" | "hdri"
      "category": "drum", // models: one word from the vocabulary below
      "triCap": 3000, // models: default 3000; up to 8000 for big or hero pieces
      "textureSize": 512, // models: 512 small props, 1024 large/hero (256 allowed)
      "notes": "free text",
    },
    {
      "id": "Bricks097",
      "source": "ambientcg",
      "kind": "material",
      "key": "brick.red", // materials: manifest key (one material per key)
      "textureSize": 1024,
    },
    { "id": "abandoned_slipway", "source": "polyhaven", "kind": "hdri" },
  ],
}
```

Optional model fields:

- `pick`: node names to keep from multi-object files (kits, side-by-side
  variants). `*` is a wildcard, e.g. `["preset_02_*"]`. Unmatched names fail
  the run and list the available nodes.
- `variant`: output suffix when one source yields several props. The output ID
  becomes `<id>-<variant>`.
- `fallback`: procedural forge family without the `prop.` prefix. It defaults
  per category (see `CATEGORY_FALLBACK` in `lib.ts`).
- `scale`: uniform scale fix. When omitted, the scale is checked against the
  source's published dimensions and corrected automatically when it is off by a
  consistent factor (`steel_frame_shelves_01` is authored at 10x).

Optional material field: `tile` (metres). Otherwise the tile size comes from
ambientCG/Poly Haven dimensions when published, or a default per type (`DEFAULT_TILE`).

Model categories: barrel, drum, crate, box, pallet, pipe, tank, gas-cylinder,
electrical, fence, light, trolley, machinery, barrier, dumpster, tire, ladder,
vent, antenna, shelf, toolbox, bucket, cone, sign, cable, workbench, generator,
debris, beam, sack, furniture, vehicle, hydrant, container, misc.

Material keys used so far: asphalt.wet, concrete.clean, concrete.stained,
concrete.floor, brick.red, brick.soot, metal.rusted, metal.painted,
metal.plates, metal.corrugated, metal.grating, metal.dark, wood.planks,
rock.rubble, plaster.dirty. Any `family.variant` key is accepted.

## Processing

fetch.ts

- Downloads the 1k glTF, its `.bin` and 1k textures, plus any separately
  published `*_opacity`/`*_alpha` maps, for each model. Downloads the 1K-JPG zip
  for each material and extracts only flat-named images. Downloads the 1k
  `.hdr` for each HDRI.
- Treats downloads as untrusted data. Hosts are pinned (`dl.polyhaven.org`,
  `ambientcg.com`) and remote relative paths are validated. Poly Haven files
  are md5-checked; zip entries are size-limited. Nothing downloaded is ever
  executed.

optimize.ts, models

1. Strip unsupported extensions. Transmission glass becomes alpha blend.
2. Apply `pick`, then merge separate opacity maps into the base colour of
   non-opaque materials.
3. Run dedup and prune, then bake all transforms, join primitives by material
   and weld.
4. Simplify with meshoptimizer until triangles <= `triCap`, gentlest settings
   first. The escalation is: a larger error budget, then removing small
   disconnected parts before simplifying, then collapsing across UV seams,
   then sloppy clustering. The hard cap is 8000; the run errors if it can't
   be met.
5. Drop tangents, skins and morph targets. Rescale to metres if needed and
   recentre (AABB centred on X/Z, min Y = 0, Y-up).
6. Resize textures to `textureSize`. JPEG is used, with 4:4:4 chroma for
   normal and ORM maps. Alpha textures are PNG, capped at 512.

optimize.ts, materials

- Writes the albedo, OpenGL normal, roughness, AO, metalness and opacity maps
  that exist, at 1024 and 512. Data maps are greyscale JPEGs. Displacement is
  dropped.

Manifest additions:

- `models["cc0.<category>.<id>"]`: the GLB path.
- `materials[key]`: `{ id, size, tile, maps, low }`.
- `hdri`: new paths first.
- `catalog[id]`: id, kind, source, sourceUrl, license, author, tris,
  textureSize, category/key, prop, path, size, bytes, fallback, lists.

The game ignores keys it doesn't use and falls back to procedural content for
any missing file.
