import { readFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
// Per-area dressing tables (markdown) from the level data and the LOW capture
// written by scripts/dressing-capture.ts. Usage: tsx scripts/dressing-report.ts
const level = getLevel();
const AREAS: Record<string, { name: string; zones: string[]; views: string }> =
  {
    street: { name: 'Spawn street', zones: ['entrance'], views: 'street' },
    rooftops: { name: 'Rooftops', zones: ['tenements'], views: 'roofs' },
    yard: { name: 'Container yard', zones: ['rail'], views: 'yard' },
    stacks: {
      name: 'Smokestack yard',
      zones: ['slag', 'pumps'],
      views: 'stacks',
    },
    hall: { name: 'Foundry hall', zones: ['hall', 'core'], views: 'hall' },
  };
type Capture = {
  preset: string;
  gpu: string;
  caps: Record<string, number> | null;
  overCaps: string[];
  cameras: { name: string; drawCalls: number; triangles: number }[];
  props: {
    zones: Record<
      string,
      { props: number; drawCalls: number; triangles: number }
    >;
    textureMiB: number;
  };
  zoneTextureMiB: Record<string, number>;
};
const capture = JSON.parse(
  await readFile(process.argv[2] ?? 'docs/dressing/capture-low.json', 'utf8'),
) as Capture;
const props = [
  ...level.solids!.filter((s) => s.prop).map((s) => ({ ...s, solid: true })),
  ...level.decor
    .filter((d) => d.prop)
    .map((d) => ({ ...d, zone: d.zone ?? 'boundary', solid: false })),
];
const rows = [
  '| Area | Zones | Props | Types | CC0 props / types | Blocking / decor | On roofs | Landmark |',
  '| --- | --- | --: | --: | --: | --: | --: | --- |',
];
const perf = [
  `| Area | Review views (draw calls) | Review views (triangles) | Zone player view | Prop meshes in zone | Prop triangles in zone | Textures, ${capture.preset} (MiB) |`,
  '| --- | --- | --- | --- | --: | --: | --- |',
];
const k = (n: number) => `${Math.round(n / 1000)}k`;
for (const area of Object.values(AREAS)) {
  const own = props.filter((p) => area.zones.includes(p.zone)),
    cc0 = own.filter((p) => p.prop!.startsWith('cc0.'));
  const landmarks = level
    .landmarks!.filter((l) => area.zones.includes(l.zone))
    .map((l) => `${l.id} (${l.height} m)`);
  rows.push(
    `| ${area.name} | ${area.zones.join(', ')} | ${own.length} | ${new Set(own.map((p) => p.prop)).size} | ${cc0.length} / ${new Set(cc0.map((p) => p.prop)).size} | ${own.filter((p) => p.solid).length} / ${own.filter((p) => !p.solid).length} | ${own.filter((p) => p.id.includes('/roof-prop-')).length} | ${landmarks.join(', ')} |`,
  );
  const views = capture.cameras.filter((c) =>
      c.name.startsWith(`dress-${area.views}-`),
    ),
    player = capture.cameras.filter((c) =>
      area.zones.some((z) => c.name === `${z}-player`),
    );
  const zoneStats = area.zones.map((z) => capture.props.zones[z]!);
  perf.push(
    `| ${area.name} | ${views.map((v) => v.drawCalls).join(' / ')} | ${views.map((v) => k(v.triangles)).join(' / ')} | ${player.map((v) => `${v.drawCalls} dc, ${k(v.triangles)}`).join('; ')} | ${zoneStats.reduce((s, z) => s + z.drawCalls, 0)} | ${k(zoneStats.reduce((s, z) => s + z.triangles, 0))} | ${area.zones.map((z) => `${z} ${capture.zoneTextureMiB[z]}`).join(', ')} |`,
  );
}
const all = new Set(props.map((p) => p.prop));
console.log(
  [
    `Totals: ${props.length} props, ${all.size} types (${[...all].filter((p) => p!.startsWith('cc0.')).length} CC0 models), ${props.filter((p) => p.id.includes('/roof-prop-')).length} on roofs.`,
    '',
    ...rows,
    '',
    `Measured on ${capture.gpu}, preset ${capture.preset}. Caps: ${JSON.stringify(capture.caps)}; over caps: ${capture.overCaps.length ? capture.overCaps.join(', ') : 'none'}.`,
    '',
    ...perf,
  ].join('\n'),
);
