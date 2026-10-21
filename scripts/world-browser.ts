import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const mode = process.argv[2] ?? 'screens',
  base = process.env.TEST_URL ?? 'http://localhost:3002';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    ...(process.env.SOFTWARE_RENDERING === '1'
      ? ['--use-angle=swiftshader']
      : []),
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
});
await context.addInitScript(() => {
  localStorage.setItem(
    'graphics',
    JSON.stringify({ quality: 'MEDIUM', grain: 0.018, bloom: 0.16 }),
  );
  const Native = WebSocket;
  window.WebSocket = class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      Reflect.set(window, 'testSocket', this);
    }
  };
});
const page = await context.newPage(),
  errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => Reflect.get(window, 'leviathan'));
async function ready() {
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
    undefined,
    { timeout: 180000 },
  );
}
async function camera(name: string) {
  await page.evaluate(
    (n) => Reflect.get(window, 'leviathan').worldDebug.camera(n),
    name,
  );
  await page.waitForTimeout(700);
}
async function quality(preset: string) {
  await page.keyboard.press('F4');
  await page
    .locator('#dev-panel details')
    .filter({ has: page.locator('summary', { hasText: 'WORLD / LOOK' }) })
    .evaluate((e) => e.setAttribute('open', ''));
  await page
    .locator('#dev-panel')
    .getByLabel('Graphics quality')
    .selectOption(preset);
  await page.keyboard.press('F4');
}
async function cycle(next: boolean) {
  const before = await state(),
    previous = before.room.mission,
    loadedAt = before.world.loadedAt;
  await page.evaluate((v) => {
    const ws = Reflect.get(window, 'testSocket') as WebSocket;
    ws.send(JSON.stringify({ type: 'dev', action: 'end' }));
    ws.send(JSON.stringify({ type: 'vote', vote: v ? 'NEXT' : 'REPLAY' }));
  }, next);
  await page.waitForFunction(
    (m) => Reflect.get(window, 'leviathan')?.room?.lastVote?.mission === m,
    (previous + (next ? 1 : 0)) % 7,
    { timeout: 40000 },
  );
  await page.waitForFunction(
    (t) =>
      Reflect.get(window, 'leviathan')?.world?.ready &&
      Reflect.get(window, 'leviathan').world.loadedAt !== t,
    loadedAt,
    { timeout: 180000 },
  );
  await page.waitForTimeout(1000);
}
async function screenshot(name: string) {
  await page.addStyleTag({
    content:
      'body[data-photo="yes"] #app,body[data-photo="yes"] #toast,body[data-photo="yes"] #dev-panel,body[data-photo="yes"] #debug{visibility:hidden}',
  });
  await page.evaluate(() => (document.body.dataset.photo = 'yes'));
  await page.screenshot({ path: `docs/screens/look/${name}.png` });
  await page.evaluate(() => delete document.body.dataset.photo);
}
try {
  await mkdir('docs/screens/look', { recursive: true });
  await mkdir('docs/perf', { recursive: true });
  await page.goto(base + '/?solo=1' + (mode === 'perf' ? '&perf=1' : ''));
  await ready();
  const gpu = await page.evaluate(() => {
    const gl = document
        .querySelector<HTMLCanvasElement>('#arena')!
        .getContext('webgl2')!,
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'Unavailable';
  });
  if (mode === 'screens') {
    const shots: Record<string, unknown> = {};
    for (const name of [
      'composition',
      'spawn',
      'van',
      'containers',
      'stacks',
      'hall',
      'puddle',
    ]) {
      if (name === 'puddle') await quality('HIGH');
      await camera(name);
      await screenshot(name);
      shots[name] = (await state()).world;
      console.log('SCREEN', name, JSON.stringify(shots[name]));
    }
    await quality('MEDIUM');
    await cycle(true);
    await camera('composition');
    await screenshot('factory-2');
    shots['factory-2'] = (await state()).world;
    await writeFile(
      'docs/perf/screens.json',
      JSON.stringify({ gpu, shots, errors }, null, 2),
    );
  } else if (mode === 'perf') {
    for (const preset of ['LOW', 'MEDIUM', 'HIGH']) {
      const resolution = preset === 'LOW' ? [1280, 720] : [1920, 1080];
      await page.setViewportSize({
        width: resolution[0]!,
        height: resolution[1]!,
      });
      await page.keyboard.press('F4');
      await page
        .locator('#dev-panel details')
        .filter({ has: page.locator('summary', { hasText: 'WORLD / LOOK' }) })
        .evaluate((e) => e.setAttribute('open', ''));
      await page
        .locator('#dev-panel')
        .getByLabel('Graphics quality')
        .selectOption(preset);
      await page.keyboard.press('F4');
      await camera('perf');
      await page.waitForFunction(
        () => !!Reflect.get(window, 'leviathan')?.perf,
        undefined,
        { timeout: 180000 },
      );
      const finalState = await state();
      const report = finalState.perf;
      await writeFile(
        `docs/perf/${preset.toLowerCase()}.json`,
        JSON.stringify(
          {
            ...report,
            gpu,
            softwareRendering: /SwiftShader/i.test(gpu),
            resolution,
            textureMiB: finalState.world.textureMiB,
          },
          null,
          2,
        ),
      );
      console.log('PERF', JSON.stringify(report));
    }
  } else if (mode === 'cycles') {
    const cdp = await context.newCDPSession(page);
    const samples: unknown[] = [];
    let first:
      { geometries: number; textures: number; heap: number } | undefined;
    for (let i = 0; i <= 10; i++) {
      if (i) await cycle(i % 2 === 1);
      await camera('composition');
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
      const world = (await state()).world;
      const sample = {
        cycle: i,
        geometries: world.geometries,
        textures: world.textures,
        heap,
        level: world.level,
      };
      samples.push(sample);
      console.log('CYCLE', JSON.stringify(sample));
      if (i === 2) first = sample;
      if (i === 10 && first) {
        assert.ok(sample.geometries <= first.geometries + 4, 'Geometry growth');
        assert.ok(sample.textures <= first.textures + 4, 'Texture growth');
        assert.ok(
          heap <= first.heap * 1.15 + 2_000_000,
          'Retained JS heap growth',
        );
      }
    }
    await writeFile(
      'docs/perf/replay-cycles.json',
      JSON.stringify({ pass: true, gpu, samples, errors }, null, 2),
    );
    const qualitySamples: {
      preset: string;
      textureMiB: number;
      textures: number;
      heap: number;
    }[] = [];
    for (const preset of [
      'HIGH',
      'LOW',
      'MEDIUM',
      'HIGH',
      'LOW',
      'MEDIUM',
      'HIGH',
      'LOW',
      'MEDIUM',
    ]) {
      await quality(preset);
      await page.waitForTimeout(500);
      await cdp.send('HeapProfiler.collectGarbage');
      const world = (await state()).world;
      qualitySamples.push({
        preset,
        textureMiB: world.textureMiB,
        textures: world.textures,
        heap: (await cdp.send('Runtime.getHeapUsage')).usedSize,
      });
    }
    for (const preset of ['HIGH', 'LOW', 'MEDIUM']) {
      const values = qualitySamples.filter((s) => s.preset === preset);
      assert.equal(
        values.at(-1)!.textureMiB,
        values[0]!.textureMiB,
        'Quality texture memory grew',
      );
      assert.ok(
        values.at(-1)!.textures <= values[0]!.textures + 2,
        'Quality GPU textures grew',
      );
    }
    await writeFile(
      'docs/perf/quality-cycles.json',
      JSON.stringify({ pass: true, qualitySamples }, null, 2),
    );
  }
  assert.deepEqual(errors, []);
  console.log('PASS', mode);
} finally {
  await browser.close();
}
