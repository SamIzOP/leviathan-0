import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
// Dressing review: three fixed cameras per play area and per-camera render stats.
// The collision sweep runs separately (npm run level:collision-audit).
// GAME_URL defaults to the documented dev port.
const url = process.env.GAME_URL ?? 'http://localhost:5175',
  preset = process.env.PRESET ?? 'LOW',
  out = 'docs/dressing';
const resolution = preset === 'LOW' ? [1280, 720] : [1920, 1080];
/** LOW caps: the envelope the pre-dressing build held at 60 fps on Intel UHD
 * (docs/perf/redesign-low.json), and a per-zone decoded texture budget. */
const CAPS: Record<
  string,
  { drawCalls: number; triangles: number; zoneTextureMiB: number }
> = { LOW: { drawCalls: 406, triangles: 475_000, zoneTextureMiB: 96 } };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
});
try {
  const context = await browser.newContext({
    viewport: { width: resolution[0]!, height: resolution[1]! },
  });
  await context.addInitScript(
    (p) =>
      localStorage.setItem(
        'graphics',
        JSON.stringify({ quality: p, grain: 0.018, bloom: 0.16 }),
      ),
    preset,
  );
  const page = await context.newPage(),
    errors: string[] = [],
    failed: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.status() >= 400 && failed.push(r.url()));
  // Missing-asset check: BLOCK_ASSETS=<regex> answers matching requests with 404.
  if (process.env.BLOCK_ASSETS)
    await page.route(new RegExp(process.env.BLOCK_ASSETS), (r) =>
      r.fulfill({ status: 404, body: '' }),
    );
  const started = Date.now();
  await page.goto(`${url}/?solo=1`);
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
    undefined,
    { timeout: 240000 },
  );
  const loadSeconds = (Date.now() - started) / 1000;
  const gpu = await page.evaluate(() => {
    const gl = document
        .querySelector<HTMLCanvasElement>('#arena')!
        .getContext('webgl2')!,
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  // Review shots show the world only; HUD and prompts are hidden.
  await page.addStyleTag({
    content:
      'body *{visibility:hidden!important}#arena{visibility:visible!important}',
  });
  const filter = new RegExp(process.env.CAMERAS ?? '^dress-'),
    cameras = [];
  for (const name of Object.keys(getLevel().cameras).filter((n) =>
    filter.test(n),
  )) {
    await page.evaluate(
      (n) => Reflect.get(window, 'leviathan').worldDebug.camera(n),
      name,
    );
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 3500));
    const w = await page.evaluate(() => Reflect.get(window, 'leviathan').world);
    if (name.startsWith('dress-') && !process.env.NO_SHOTS)
      await page.screenshot({ path: `${out}/${name}.png` });
    cameras.push({
      name,
      drawCalls: w.drawCalls,
      triangles: w.triangles,
      frameMs: Math.round(w.frameMs * 100) / 100,
      gpuMs: w.gpuMs,
      textures: w.textures,
      geometries: w.geometries,
      preset: w.preset,
    });
    console.log(JSON.stringify(cameras.at(-1)));
  }
  const final = await page.evaluate(
    () => Reflect.get(window, 'leviathan').world,
  );
  const cap = CAPS[preset],
    over = cap
      ? [
          ...cameras.flatMap((c) =>
            c.drawCalls > cap.drawCalls || c.triangles > cap.triangles
              ? [`${c.name}: ${c.drawCalls} draws, ${c.triangles} tris`]
              : [],
          ),
          ...Object.entries(final.zoneTextureMiB as Record<string, number>)
            .filter(([, mib]) => mib > cap.zoneTextureMiB)
            .map(([zone, mib]) => `${zone}: ${mib} MiB textures`),
        ]
      : [];
  const report = {
    preset,
    resolution,
    gpu,
    loadSeconds,
    caps: cap ?? null,
    overCaps: over,
    cameras,
    props: final.props,
    zoneTextureMiB: final.zoneTextureMiB,
    textureMiB: final.textureMiB,
    assets: final.assets,
    errors,
    failed: [...new Set(failed)],
  };
  await writeFile(
    `${out}/capture-${process.env.REPORT ?? preset.toLowerCase()}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({ gpu, loadSeconds, over, errors, failed: report.failed }),
  );
  if (errors.length || over.length) process.exitCode = 1;
} finally {
  await browser.close();
}
