import { mkdir, writeFile, stat } from 'node:fs/promises';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FORGE_CATALOG } from '../packages/shared/src/forge-data';
import {
  forgeModel,
  disposeForge,
  triangleCount,
} from '../packages/client/src/forge';
// GLTFExporter only needs FileReader for binary buffer assembly (no DOM/textures).
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
Object.defineProperty(globalThis, 'FileReader', {
  value: NodeFileReader,
  configurable: true,
});
const directory = 'packages/client/public/assets/models/generated';
await mkdir(directory, { recursive: true });
const exporter = new GLTFExporter(),
  manifest: Record<string, { path: string; bytes: number; triangles: number }> =
    {};
for (const key of FORGE_CATALOG)
  for (let variant = 0; variant < 3; variant++) {
    const model = forgeModel(key, variant),
      name = `${key}-${variant + 1}.glb`;
    const result = await exporter.parseAsync(model, { binary: true });
    await writeFile(`${directory}/${name}`, Buffer.from(result as ArrayBuffer));
    manifest[`${key}/${variant + 1}`] = {
      path: `/assets/models/generated/${name}`,
      bytes: (await stat(`${directory}/${name}`)).size,
      triangles: triangleCount(model),
    };
    disposeForge(model);
  }
await writeFile(
  `${directory}/manifest.json`,
  JSON.stringify(manifest, null, 2),
);
await mkdir('docs/perf', { recursive: true });
const report = {
  count: Object.keys(manifest).length,
  totalBytes: Object.values(manifest).reduce(
    (sum, item) => sum + item.bytes,
    0,
  ),
  directory,
};
await writeFile('docs/perf/forge-export.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
