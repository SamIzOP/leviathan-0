import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
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
  await page.goto(
    (process.env.TEST_URL ?? 'http://localhost:3002') + '/?gallery=1',
  );
  await page.waitForFunction(() => Reflect.get(window, 'forgeGallery')?.ready);
  assert(await page.locator('#arena').isVisible(), 'Gallery canvas visible');
  await page.getByLabel('Turntable', { exact: true }).uncheck();
  for (const key of [
    'sedan',
    'container',
    'boiler',
    'gantry-crane',
    'water-tower',
  ]) {
    await page.getByLabel('Forge asset and variant').selectOption(`${key}:1`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `docs/screens/revision/gallery-${key}.png` });
  }
  await page.getByLabel('Forge asset and variant').selectOption('sedan:2');
  await page.getByLabel('Forge seed').fill('42');
  await page.getByLabel('Forge seed').press('Tab');
  assert.equal(
    (await page.evaluate(() => Reflect.get(window, 'forgeGallery'))).seed,
    42,
  );
  await page.getByLabel('Wireframe', { exact: true }).check();
  await page.getByLabel('Collider overlay').check();
  await page.screenshot({
    path: 'docs/screens/revision/gallery-wireframe.png',
  });
  await page.getByLabel('Wireframe', { exact: true }).uncheck();
  await page.getByLabel('Collider overlay').uncheck();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/screens/revision/gallery.png' });
  assert.deepEqual(errors, []);
  await writeFile(
    'docs/perf/revision-gallery.json',
    JSON.stringify(
      {
        pass: true,
        visibleCanvas: true,
        variants: await page.locator('select option').count(),
        seedControl: true,
        wireframe: true,
        colliders: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
