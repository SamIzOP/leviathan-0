import { chromium } from 'playwright';
import type { Page } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const report: Record<string, unknown> = {};
async function contrast(page: Page) {
  const values = await page.evaluate(() => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (v: number[]) =>
      v
        .slice(0, 3)
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0);
    return Array.from(
      document.querySelectorAll<HTMLElement>('#app *, #dev-panel *, #debug'),
    )
      .filter(
        (e) =>
          e.checkVisibility() &&
          e.className !== 'crosshair' &&
          Array.from(e.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          ),
      )
      .map((e) => {
        const color = rgb(getComputedStyle(e).color);
        let ancestor: HTMLElement | null = e;
        let bg = [10, 14, 17];
        while (ancestor) {
          const candidate = rgb(getComputedStyle(ancestor).backgroundColor);
          if (candidate.length === 3 || candidate[3] === 1) {
            bg = candidate;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        const a = luminance(color),
          b = luminance(bg);
        return {
          text: e.textContent?.trim().slice(0, 35),
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
  });
  assert.deepEqual(
    values.filter((v) => v.ratio < 4.5),
    [],
  );
  return Math.min(...values.map((v) => v.ratio));
}
try {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  await page.addInitScript('window.__name = (value) => value');
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: 'SOLO TEST', exact: true }).waitFor();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByLabel('Callsign')
      .evaluate((e) => e === document.activeElement),
    true,
  );
  assert.equal(
    await page
      .getByLabel('Callsign')
      .evaluate((e) => getComputedStyle(e).outlineStyle),
    'solid',
  );
  report.titleContrast = await contrast(page);
  await page.getByLabel('Callsign').fill('KEYBOARD');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').room?.phase === 'LOBBY',
  );
  report.enterCreates = true;
  const settings = page
    .locator('summary')
    .filter({ hasText: 'OPERATOR SETTINGS' });
  await settings.focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('slider', { name: 'Mouse sensitivity', exact: true })
    .focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('sensitivity')),
    '0.0021',
  );
  assert.match(
    await page.locator('.sensitivity-readout').innerText(),
    /0.0021/,
  );
  report.settingsContrast = await contrast(page);
  await page.getByRole('button', { name: '×', exact: true }).click();
  // Exercise the background's hidden-tab event handler without browser-specific
  // headless tab visibility behavior affecting the check.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const frames = await page.evaluate(
    () => Reflect.get(window, 'leviathan').background.frames,
  );
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(
      () => Reflect.get(window, 'leviathan').background.frames,
    ),
    frames,
  );
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  report.visibilityHandler = true;
  await page.keyboard.press('F4');
  await page.getByRole('button', { name: 'RESTART', exact: true }).click();
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').room.phase === 'PLAYING',
  );
  await page
    .locator('#dev-panel summary')
    .filter({ hasText: /^PLAYER$/ })
    .click();
  const walk = page.getByRole('slider', { name: 'WALK SPEED', exact: true });
  await walk.evaluate((e) => {
    (e as HTMLInputElement).value = '9';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').devState.tuning.walk === 9,
  );
  await page
    .getByRole('button', { name: 'RESET TO DEFAULTS', exact: true })
    .click();
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').devState.tuning.walk === 5,
  );
  await walk.evaluate((e) => {
    (e as HTMLInputElement).value = '6';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').devState.tuning.walk === 6,
  );
  await page
    .getByRole('button', { name: 'RESET TO DEFAULTS', exact: true })
    .click();
  report.liveTuning = true;
  await page
    .locator('#dev-panel summary')
    .filter({ hasText: 'ENTITIES' })
    .click();
  await page.getByRole('button', { name: 'SPAWN 10', exact: true }).click();
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').entities.length === 11,
  );
  await page
    .getByRole('button', { name: 'CLEAR DUMMIES', exact: true })
    .click();
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').entities.length === 1,
  );
  await page
    .locator('#dev-panel summary')
    .filter({ hasText: 'DEBUG DRAW' })
    .click();
  for (const key of ['colliders', 'ghost', 'raw', 'velocity'])
    await page.locator(`[data-control="${key}"]`).check();
  await page.locator('#debug-draw').waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#debug-draw').evaluate((canvas) => {
      const c = canvas as HTMLCanvasElement;
      return c
        .getContext('2d')!
        .getImageData(24, innerHeight - 224, 192, 192)
        .data.some((v) => v !== 0);
    }),
    true,
  );
  report.devContrast = await contrast(page);
  await page.reload();
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan').room?.phase === 'PLAYING',
  );
  await page.keyboard.press('F4');
  for (const key of ['colliders', 'ghost', 'raw', 'velocity'])
    assert.equal(
      await page.locator(`[data-control="${key}"]`).isChecked(),
      true,
    );
  report.drawPersistence = true;
  await page.keyboard.press('KeyH');
  await page.locator('.controls-overlay').waitFor();
  assert.match(await page.locator('.controls-overlay').innerText(), /0.0021/);
  report.controlsContrast = await contrast(page);
  await page.screenshot({ path: 'docs/screens/controls-1366x768.png' });
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.evaluate(() => document.exitPointerLock());
  await page.locator('.paused').waitFor();
  report.pausedContrast = await contrast(page);
  await page.screenshot({ path: 'docs/screens/paused-1366x768.png' });
  report.pass = true;
} finally {
  await browser.close();
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/scope-interface.json',
    JSON.stringify(report, null, 2),
  );
  console.log(report);
}
