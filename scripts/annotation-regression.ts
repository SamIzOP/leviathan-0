import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Entity } from '@leviathan/shared';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
const results: Record<string, unknown>[] = [];
const state = (page: Page): Promise<Entity> =>
  page.evaluate(() => Reflect.get(window, 'leviathan').predicted);
const distance = (a: Entity, b: Entity) =>
  Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

try {
  await mkdir('test-results', { recursive: true });
  for (const viewport of [
    { width: 714, height: 715 },
    { width: 1366, height: 768 },
  ]) {
    const context = await browser.newContext({ viewport });
    // Reproduce the in-app browser's rejected capture request without depending
    // on a specific desktop host. Native capture has a separate regression.
    await context.addInitScript(() => {
      Element.prototype.requestPointerLock = () =>
        Promise.reject(new DOMException('Capture unavailable', 'UnknownError'));
    });
    const page = await context.newPage();
    await page.bringToFront();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      (process.env.TEST_URL ?? 'http://localhost:5173') + '/?solo=1',
    );
    await page
      .getByRole('button', { name: 'CLICK TO CAPTURE MOUSE', exact: true })
      .click();
    await page.locator('.input-mode').waitFor();
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      'arena',
    );
    const before = await state(page);
    await page.keyboard.down('d');
    await page.waitForTimeout(1000);
    await page.keyboard.up('d');
    await page.waitForTimeout(300);
    const after = await state(page);
    assert.ok(
      distance(before, after) > 1,
      'Fallback WASD did not move the player',
    );
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 100, center.y + 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const looked = await state(page);
    assert.ok(
      Math.abs(looked.yaw - after.yaw) > 0.1,
      'Drag did not turn the view',
    );
    assert.ok(
      Math.abs(looked.pitch - after.pitch) > 0.02,
      'Drag did not tilt the view',
    );
    await page.mouse.move(center.x - 100, center.y);
    await page.waitForTimeout(100);
    const yawDelta = (await state(page)).yaw - looked.yaw;
    assert.ok(
      Math.abs(Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta))) < 0.001,
      'Unheld mouse moved the view',
    );
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'CLICK TO RESUME', exact: true })
      .waitFor();
    const paused = await state(page);
    await page.keyboard.down('d');
    await page.waitForTimeout(400);
    await page.keyboard.up('d');
    assert.ok(
      distance(paused, await state(page)) < 0.05,
      'Paused input moved the player',
    );
    await page
      .getByRole('button', { name: 'CLICK TO RESUME', exact: true })
      .click();
    await page.locator('.input-mode').waitFor();
    await page.keyboard.press('F4');
    await page
      .getByRole('button', { name: 'END MATCH', exact: true })
      .waitFor();
    const inPanel = await state(page);
    await page.keyboard.down('d');
    await page.waitForTimeout(400);
    await page.keyboard.up('d');
    assert.ok(
      distance(inPanel, await state(page)) < 0.05,
      'Overlay input moved the player',
    );
    await page.keyboard.press('F4');
    await page.locator('.input-mode').waitFor();
    await page.keyboard.down('d');
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('d');
    await page
      .getByRole('button', { name: 'CLICK TO RESUME', exact: true })
      .waitFor();
    await page.waitForTimeout(300);
    const blurred = await state(page);
    await page.waitForTimeout(400);
    assert.ok(
      distance(blurred, await state(page)) < 0.05,
      'Blur left movement stuck',
    );
    await page
      .getByRole('button', { name: 'CLICK TO RESUME', exact: true })
      .click();
    await page.locator('.input-mode').waitFor();
    await page.keyboard.press('F8');
    const replay = page.getByRole('button', { name: 'REPLAY', exact: true });
    const next = page.getByRole('button', {
      name: 'NEXT FACTORY',
      exact: true,
    });
    await replay.waitFor();
    assert.deepEqual(
      await page
        .locator('.vote-option')
        .evaluateAll((es) => es.map((e) => e.getAttribute('aria-pressed'))),
      ['false', 'false'],
    );
    for (const name of ['NEXT FACTORY', 'REPLAY', 'NEXT FACTORY']) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForFunction(
        (label) =>
          document
            .querySelector('.vote-option[aria-pressed="true"]')
            ?.getAttribute('aria-label') === label,
        name,
      );
      assert.equal(
        await page.locator('.vote-option[aria-pressed="true"]').count(),
        1,
      );
    }
    // Hovering the other choice must not give it the selected fill.
    await replay.hover();
    const styles = await page.locator('.vote-option').evaluateAll((es) =>
      es.map((e) => ({
        pressed: e.getAttribute('aria-pressed'),
        background: getComputedStyle(e).backgroundColor,
      })),
    );
    assert.equal(styles.length, 2);
    assert.notEqual(styles[0]!.background, styles[1]!.background);
    assert.equal(await next.getAttribute('aria-pressed'), 'true');
    await page.screenshot({
      path: `test-results/vote-selection-${viewport.width}.png`,
    });
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      movement: distance(before, after),
      dragLook: true,
      pauseResume: true,
      panelResume: true,
      blurStopsMovement: true,
      exclusiveVote: true,
      errors,
    });
    await context.close();
  }
  await writeFile(
    'test-results/annotation-regression.json',
    JSON.stringify({ pass: true, results }, null, 2),
  );
  console.log(JSON.stringify({ pass: true, results }, null, 2));
} finally {
  await browser.close();
}
