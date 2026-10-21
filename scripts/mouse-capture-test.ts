import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
const results: Record<string, unknown>[] = [];
try {
  for (const viewport of [
    { width: 714, height: 715 },
    { width: 1366, height: 768 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.bringToFront();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      (process.env.TEST_URL ?? 'http://localhost:5173') + '/?solo=1',
    );
    const button = page.getByRole('button', {
      name: 'CLICK TO CAPTURE MOUSE',
      exact: true,
    });
    await button.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const before = (await button.boundingBox())!;
    const originalButton = (await button.elementHandle())!;
    await page.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    );
    // A real held press exposes the old transform conflict; a fast click missed it.
    await page.mouse.down();
    await page.waitForTimeout(2300);
    assert.equal(
      await originalButton.evaluate((e) => e.isConnected),
      true,
      'Clock updates replaced the pressed button',
    );
    const pressed = (await button.boundingBox())!;
    assert.ok(
      Math.abs(pressed.x - before.x - 2) < 0.1,
      JSON.stringify({ viewport, before, pressed }),
    );
    assert.ok(
      Math.abs(pressed.y - before.y - 2) < 0.1,
      JSON.stringify({ viewport, before, pressed }),
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => document.pointerLockElement?.id === 'arena',
    );
    await page.waitForTimeout(250);
    assert.equal(await button.count(), 0);
    // Release/resume and overlay capture must continue to work after the fix.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.pointerLockElement);
    assert.equal(await page.locator('.capture-notice').count(), 0);
    await page
      .getByRole('button', { name: 'CLICK TO RESUME', exact: true })
      .click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press('F4');
    await page.waitForFunction(() => !document.pointerLockElement);
    await page.keyboard.press('F4');
    await page.waitForFunction(() => !!document.pointerLockElement);
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      pressedOffset: { x: pressed.x - before.x, y: pressed.y - before.y },
      capture: true,
      resume: true,
      panelRecapture: true,
      errors,
    });
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement);
    await context.close();
  }
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/mouse-capture.json',
    JSON.stringify({ pass: true, results }, null, 2),
  );
  console.log(JSON.stringify({ pass: true, results }, null, 2));
} finally {
  await browser.close();
}
