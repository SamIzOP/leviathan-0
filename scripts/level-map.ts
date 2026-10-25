import { mkdir, writeFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
const phase = process.argv[2] ?? 'after',
  level = getLevel();
const min = level.bounds.min,
  max = level.bounds.max;
const w = max.x - min.x,
  h = max.z - min.z;
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${min.x - 15} ${min.z - 22} ${w + 30} ${h + 40}" width="1400" height="1100"><rect x="${min.x - 15}" y="${min.z - 22}" width="${w + 30}" height="${h + 40}" fill="#101920"/><style>text{font:3px monospace;fill:#edf1ec}.label{paint-order:stroke;stroke:#101920;stroke-width:1px}</style><text x="${min.x}" y="${min.z - 12}" style="font-size:6px">FOUNDRY ROW // ${phase.toUpperCase()} // ${w} × ${h} m</text>`,
];
for (const b of [...level.colliders].sort((a, b) => a.max.y - b.max.y)) {
  const color =
    b.max.y <= 0
      ? '#263840'
      : b.max.y < 4
        ? '#536d74'
        : b.max.y < 12
          ? '#849597'
          : b.max.y < 30
            ? '#bec7be'
            : '#c2aa70';
  parts.push(
    `<rect x="${b.min.x}" y="${b.min.z}" width="${b.max.x - b.min.x}" height="${b.max.z - b.min.z}" fill="${color}" opacity="${b.clip ? 0.3 : 0.9}"><title>${esc(b.id)} / ${b.max.y} m</title></rect>`,
  );
}
for (const z of level.zones)
  parts.push(
    `<circle cx="${z.position.x}" cy="${z.position.z}" r="2" fill="#85c5c7"/><text class="label" x="${z.position.x + 3}" y="${z.position.z}">${esc(z.id)}</text>`,
  );
for (const s of level.spawns)
  parts.push(
    `<circle cx="${s.position.x}" cy="${s.position.z}" r="${s.type === 'player' ? 1 : 0.5}" fill="${s.type === 'player' ? '#a5d4aa' : '#d6b08d'}"/>`,
  );
for (const g of level.gates)
  parts.push(
    `<path d="M${g.position.x - 2},${g.position.z - 2}l4,4m-4,0l4,-4" stroke="#edba69" stroke-width="0.7"/>`,
  );
const extra = level as typeof level & {
  criticalPath?: { x: number; y: number; z: number }[];
  landmarks?: { id: string; position: { x: number; z: number } }[];
  coverPoints?: { position: { x: number; z: number } }[];
};
if (extra.criticalPath)
  parts.push(
    `<polyline points="${extra.criticalPath.map((p) => `${p.x},${p.z}`).join(' ')}" fill="none" stroke="#d9d386" stroke-width="1.2"/>`,
  );
for (const l of extra.landmarks ?? [])
  parts.push(
    `<text class="label" x="${l.position.x}" y="${l.position.z}">◆ ${esc(l.id)}</text>`,
  );
for (const c of extra.coverPoints ?? [])
  parts.push(
    `<rect x="${c.position.x}" y="${c.position.z}" width="0.7" height="0.7" fill="#79c9c7"/>`,
  );
for (const e of level.encounters ?? [])
  parts.push(
    `<rect x="${e.bounds.min.x + 2}" y="${e.bounds.min.z + 2}" width="${e.bounds.max.x - e.bounds.min.x - 4}" height="${e.bounds.max.z - e.bounds.min.z - 4}" fill="none" stroke="#a7b8bd" stroke-width=".4" stroke-dasharray="2 2"><title>${e.id}; wave ${e.waveSize}; intensity ${e.intensity}; gate ${e.entryGate}</title></rect>`,
  );
for (const m of level.markers ?? []) {
  const color =
    m.kind === 'enemySpawn'
      ? '#db947b'
      : m.kind === 'burn'
        ? '#e2a86e'
        : m.kind === 'exit'
          ? '#a4d681'
          : m.kind === 'checkpoint'
            ? '#d5ce88'
            : '#a7afff';
  parts.push(
    `<circle cx="${m.position.x}" cy="${m.position.z}" r="${m.kind === 'enemySpawn' ? 0.7 : 1.3}" fill="${color}"><title>${m.id} / ${m.kind} / ${m.hint ?? ''} / y ${m.position.y}</title></circle>`,
  );
}
parts.push(
  `<text x="${min.x}" y="${max.z + 14}">SALMON enemy / VIOLET pickups / ORANGE burn / GREEN exit / YELLOW checkpoint / DASHED encounter bounds</text>`,
);
parts.push(
  `<text x="${min.x}" y="${max.z + 9}">HEIGHT: DARK floor / BLUE &lt;4 / GREY &lt;12 / PALE &lt;30 / OCHRE tall | GOLD path/gates | CYAN zones/cover</text></svg>`,
);
await mkdir('docs/layout', { recursive: true });
await writeFile(`docs/layout/map-${phase}.svg`, parts.join('\n'));
await writeFile(
  `docs/layout/level-${phase}.json`,
  JSON.stringify(level, null, 2),
);
console.log(
  `docs/layout/map-${phase}.svg; ${level.colliders.length} colliders; ${level.decor.length} authored dressing objects`,
);
