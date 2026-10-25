import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
try {
  for (const preset of ['LOW', 'MEDIUM', 'HIGH']) {
    const resolution = preset === 'LOW' ? [1280, 720] : [1920, 1080];
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
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5175/?solo=1');
    await page.waitForFunction(
      () => Reflect.get(window, 'leviathan')?.world?.ready,
      undefined,
      { timeout: 180000 },
    );
    const gpu = await page.evaluate(() => {
      const gl = document
          .querySelector<HTMLCanvasElement>('#arena')!
          .getContext('webgl2')!,
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    });
    const zones = [];
    for (const name of [
      'composition',
      ...getLevel().zones.map((z) => `${z.id}-player`),
    ]) {
      await page.evaluate(
        (n) => Reflect.get(window, 'leviathan').worldDebug.camera(n),
        name,
      );
      await page.waitForTimeout(3500);
      zones.push({
        name,
        ...(await page.evaluate(() => Reflect.get(window, 'leviathan').world)),
      });
    }
    await page.evaluate(() =>
      Reflect.get(window, 'leviathan').worldDebug.camera('perf'),
    );
    let state;
    for (let i = 0; i < 18; i++) {
      await page.waitForTimeout(5000);
      state = await page.evaluate(() => {
        const s = Reflect.get(window, 'leviathan');
        return { perf: s.perf, world: s.world, phase: s.room?.phase };
      });
      console.log(
        preset,
        i,
        JSON.stringify({
          phase: state.phase,
          mode: state.world?.mode,
          ready: state.world?.ready,
          ms: state.world?.frameMs,
          errors,
        }),
      );
      if (state.perf) break;
    }
    const report = {
      preset,
      resolution,
      gpu,
      zones,
      path: state?.perf ?? null,
      errors,
      lastState: state,
    };
    await writeFile(
      `docs/perf/redesign-${preset.toLowerCase()}.json`,
      JSON.stringify(report, null, 2),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
