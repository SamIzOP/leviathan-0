import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const phase = process.argv[2] ?? 'after';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto((process.env.TEST_URL ?? 'http://localhost:5173') + '/?solo=1');
await page.waitForFunction(
  () =>
    Reflect.get(window, 'leviathan')?.world?.ready &&
    Reflect.get(window, 'leviathanTest')?.inputDiagnostics,
  undefined,
  { timeout: 180000 },
);
await page.waitForTimeout(3000);
await page.evaluate(async () => {
  const h = Reflect.get(window, 'leviathanTest');
  h.diagnostics?.(true);
  h.inputDiagnostics.reset();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  let n = 0;
  const timer = setInterval(() => {
    h.mouse(1, n % 2 ? 0.25 : -0.25);
    if (++n === 500) clearInterval(timer);
  }, 8);
});
await page.waitForTimeout(6000);
const data = (await page.evaluate(() => {
  const h = Reflect.get(window, 'leviathanTest');
  h.inputDiagnostics.recording = false;
  return {
    frames: h.inputDiagnostics.frames,
    events: h.inputDiagnostics.events,
    world: Reflect.get(window, 'leviathan').world,
  };
})) as {
  frames: {
    time: number;
    ms: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  }[];
  events: { time: number; x: number; y: number }[];
  world: unknown;
};
const frames = data.frames.slice(1);
const xs = frames.map((f) => f.x),
  ys = frames.map((f, i) => -(f.yaw - data.frames[i]!.yaw) / 0.002);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const mx = mean(xs),
  my = mean(ys);
const corr =
  xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) /
  Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
      ys.reduce((s, y) => s + (y - my) ** 2, 0),
  );
const pitchErrors = frames.map((f, i) =>
  Math.abs(f.pitch - data.frames[i]!.pitch + f.y * 0.002),
);
const mismatchedFrames = xs.filter(
  (x, i) => Math.abs(x - ys[i]!) > 1e-8,
).length;
const report = {
  phase,
  events: data.events.length,
  frames: frames.length,
  raw: xs.reduce((s, x) => s + x, 0),
  observed: ys.reduce((s, x) => s + x, 0),
  correlation: corr,
  mismatchedFrames,
  maxPitchError: Math.max(...pitchErrors),
  maxAddedFrames: mismatchedFrames === 0 ? 0 : null,
  inputVisibleOnNextFrame: mismatchedFrames === 0,
  over20: frames.filter((f) => f.ms > 20).length,
  over33: frames.filter((f) => f.ms > 33).length,
  worstMs: Math.max(...frames.map((f) => f.ms)),
  maxEventToRenderMs: Math.max(
    ...data.events.map(
      (e) =>
        (data.frames.find((f) => f.time >= e.time)?.time ?? e.time) - e.time,
    ),
  ),
  world: data.world,
};
await mkdir('docs/screens/movement', { recursive: true });
await writeFile(
  `docs/screens/movement/mouse-${phase}.json`,
  JSON.stringify({ report, ...data }, null, 2),
);
await page.keyboard.press('F3');
await page.screenshot({ path: `docs/screens/movement/input-${phase}.png` });
console.log(JSON.stringify(report, null, 2));
await browser.close();
assert.equal(data.events.length, 500);
assert.equal(report.raw, 500);
assert(Math.abs(report.observed - report.raw) < 1e-8);
assert(report.correlation > 0.99999);
assert.equal(report.mismatchedFrames, 0);
assert(report.maxPitchError < 1e-8);
