import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage(),
  errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('docs/screens/revision', { recursive: true });
await context.addInitScript(() => {
  localStorage.setItem(
    'graphics',
    JSON.stringify({ quality: 'MEDIUM', grain: 0.018, bloom: 0.16 }),
  );
  HTMLCanvasElement.prototype.requestPointerLock = () =>
    new Promise<void>(() => {});
});
try {
  await page.goto(base + '/?solo=1');
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
    undefined,
    { timeout: 120000 },
  );
  await page
    .getByRole('button', { name: 'CLICK TO CAPTURE MOUSE', exact: true })
    .click();
  await page.waitForFunction(
    () => !!document.querySelector('.input-mode'),
    undefined,
    { timeout: 5000 },
  );
  await page.keyboard.press('Escape');
  await page
    .getByText('MOUSE CAPTURE UNAVAILABLE IN THIS BROWSER.', { exact: false })
    .waitFor();
  await page.getByRole('button', { name: 'DISMISS', exact: true }).click();
  assert.equal(await page.locator('.capture-notice').count(), 0);
  await page
    .getByRole('button', { name: 'CLICK TO RESUME', exact: true })
    .click();
  await page.waitForFunction(() => !!document.querySelector('.input-mode'));
  const state = () =>
    page.evaluate(() => Reflect.get(window, 'leviathan').predicted);
  const move = async (axis: 'x' | 'z', target: number) => {
    const before = await state(),
      positive = target > before.position[axis];
    const key =
      axis === 'x' ? (positive ? 'KeyD' : 'KeyA') : positive ? 'KeyS' : 'KeyW';
    await page.keyboard.down(key);
    try {
      const until = Date.now() + 35000;
      while (Date.now() < until) {
        const p = (await state()).position[axis];
        if (positive ? p >= target : p <= target) return;
        await page.waitForTimeout(50);
      }
      throw new Error(
        `Blocked moving ${axis} to ${target}: ${JSON.stringify(await state())}`,
      );
    } finally {
      await page.keyboard.up(key);
    }
  };
  await move('x', 42);
  await move('z', -18);
  await move('x', 0);
  await move('z', -26);
  await move('x', 42);
  await page.screenshot({
    path: 'docs/screens/revision/stair-climb-before.png',
  });
  const before = await state();
  await move('z', -35);
  const after = await state();
  assert(after.position.y - before.position.y > 4, 'stair climb without jump');
  assert(after.flags & 1, 'grounded on stairs');
  await page.screenshot({
    path: 'docs/screens/revision/stair-climb-after.png',
  });
  await move('z', -26);
  assert((await state()).position.y < 0.2, 'walked down stairs');
  await page.goto(base + '/?gallery=1');
  await page.waitForFunction(
    () => Reflect.get(window, 'forgeGallery')?.ready,
    undefined,
    { timeout: 90000 },
  );
  const select = page.getByLabel('Forge asset and variant');
  assert.equal(await select.locator('option').count(), 189);
  await select.selectOption('sedan:1');
  await page.getByLabel('Turntable', { exact: true }).uncheck();
  await page.getByLabel('Forge seed').fill('42');
  await page.getByLabel('Forge seed').press('Tab');
  assert.equal(
    (await page.evaluate(() => Reflect.get(window, 'forgeGallery'))).seed,
    42,
  );
  await page.getByLabel('Collider overlay').check();
  await page.getByLabel('Wireframe', { exact: true }).check();
  await page.screenshot({
    path: 'docs/screens/revision/gallery-wireframe.png',
  });
  await page.getByLabel('Collider overlay').uncheck();
  await page.getByLabel('Wireframe', { exact: true }).uncheck();
  await page.screenshot({ path: 'docs/screens/revision/gallery.png' });
  assert.deepEqual(errors, []);
  await writeFile(
    'docs/perf/revision-features.json',
    JSON.stringify(
      {
        pass: true,
        timeoutFallback: true,
        noticeDismissible: true,
        stairClimb: { before, after },
        galleryVariants: 189,
        seedControl: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
