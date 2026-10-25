import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const mode = process.argv[2] ?? 'empty';
const base = process.env.TEST_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'devPreferences',
      JSON.stringify({
        draw: { colliders: true },
      }),
    );
    localStorage.setItem('graphics', JSON.stringify({ quality: 'MEDIUM' }));
  });
  if (mode === 'overrides') {
    const manifest = JSON.parse(
      await readFile('packages/client/public/asset-manifest.json', 'utf8'),
    );
    manifest.models['prop.water-tower'] =
      '/assets/models/generated/water-tower-1.glb';
    manifest.models['prop.gantry-crane'] =
      '/assets/models/generated/gantry-crane-1.glb';
    await page.route('**/asset-manifest.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(manifest),
      }),
    );
  }
  await page.goto(base + '/?solo=1');
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
    undefined,
    { timeout: 120000 },
  );
  await page.keyboard.press('F4');
  assert.equal(
    await page.getByLabel('COLLIDER WIREFRAMES', { exact: true }).isChecked(),
    false,
  );
  await page.keyboard.press('F4');
  await page.evaluate(() =>
    Reflect.get(window, 'leviathan').worldDebug.camera('composition'),
  );
  await page.waitForTimeout(1000);
  const world = await page.evaluate(
    () => Reflect.get(window, 'leviathan').world,
  );
  assert(world.triangles > 10000);
  if (mode === 'empty') {
    assert(
      Object.values(world.assets).every((s) =>
        String(s).startsWith('procedural'),
      ),
    );
    await page.screenshot({ path: 'docs/screens/revision/empty-assets.png' });
  } else {
    assert.equal(
      world.assets['prop.water-tower'],
      '/assets/models/generated/water-tower-1.glb',
    );
    assert.equal(
      world.assets['prop.gantry-crane'],
      '/assets/models/generated/gantry-crane-1.glb',
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `docs/perf/revision-assets-${mode}.json`,
    JSON.stringify(
      {
        pass: true,
        colliderWireframesDefaultOff: true,
        world,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('PASS asset verification', mode);
} finally {
  await browser.close();
}
