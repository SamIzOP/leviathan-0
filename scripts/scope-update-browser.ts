import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const base = process.env.TEST_URL ?? 'http://localhost:5173';
const results: Record<string, unknown> = {},
  errors: string[] = [];
await mkdir('docs/screens', { recursive: true });
async function phase(page: Page, p: string) {
  await page.waitForFunction(
    (p) => Reflect.get(window, 'leviathan')?.room?.phase === p,
    p,
  );
}
async function checkLayout(page: Page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    'Horizontal overflow',
  );
  if ((page.viewportSize()?.width ?? 0) >= 1280) {
    const clipped = await page
      .locator('.slab:visible, .settings-grid:visible')
      .evaluateAll((elements) =>
        elements
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.top < 0 || r.bottom > innerHeight + 1;
          })
          .map((el) => el.className),
      );
    assert.deepEqual(clipped, [], 'Desktop panel clipped vertically');
  }
}
try {
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const suffix = `${size.width}x${size.height}`;
    const capture = async (name: string) => {
      await checkLayout(page);
      await page.screenshot({ path: `docs/screens/${name}-${suffix}.png` });
    };
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => Reflect.get(window, 'leviathan')?.devTools === true,
    );
    await page.waitForTimeout(2200);
    await capture('title');
    results[`background-${suffix}`] = await page.evaluate(
      () => Reflect.get(window, 'leviathan').background,
    );
    await page
      .locator('summary')
      .filter({ hasText: 'OPERATOR SETTINGS' })
      .click();
    await capture('settings');
    await page.goto(base + '/?solo=1&name=Affan');
    await phase(page, 'PLAYING');
    await page.waitForFunction(
      () => Reflect.get(window, 'leviathan').background.active === false,
    );
    assert.equal(
      await page.evaluate(
        () => Reflect.get(window, 'leviathan').background.width,
      ),
      1,
    );
    const id = await page.evaluate(
      () => Reflect.get(window, 'leviathan').playerId,
    );
    assert.equal(
      await page.evaluate(
        () => Reflect.get(window, 'leviathan').devState.timerEnabled,
      ),
      false,
    );
    assert.equal(await page.locator('.paused').count(), 0);
    results[`solo-${suffix}`] = true;
    await page.reload();
    await phase(page, 'PLAYING');
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'leviathan').playerId),
      id,
    );
    assert.equal(await page.locator('.paused').count(), 0);
    results[`refresh-${suffix}`] = true;
    await page
      .getByRole('button', { name: 'CLICK TO CAPTURE MOUSE', exact: true })
      .click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press('F4');
    await page.locator('#dev-panel').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.pointerLockElement);
    for (let i = 0; i < 3; i++) {
      await page
        .getByRole('button', { name: 'ADD BOT PLAYER (+1)', exact: true })
        .click();
      await page.waitForFunction(
        (n) => Reflect.get(window, 'leviathan').room.players.length === n,
        i + 2,
      );
    }
    await page.keyboard.press('F3');
    await page.locator('#debug').waitFor({ state: 'visible' });
    await capture('match-dev');
    results[`fourPlayers-${suffix}`] = true;
    await page.keyboard.press('F4');
    await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press('Backquote');
    await page.waitForFunction(() => !document.pointerLockElement);
    results[`pointerLock-${suffix}`] = true;
    await page
      .getByRole('button', { name: 'RETURN TO LOBBY', exact: true })
      .click();
    await phase(page, 'LOBBY');
    await page.keyboard.press('F4');
    await page.keyboard.press('F3');
    await capture('lobby');
    await page.getByRole('button', { name: 'READY', exact: true }).click();
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await phase(page, 'COUNTDOWN');
    await capture('countdown');
    await phase(page, 'PLAYING');
    await page.keyboard.press('F4');
    await page.getByRole('button', { name: 'END MATCH', exact: true }).click();
    await phase(page, 'ENDED');
    await page.keyboard.press('F4');
    await capture('ended');
    await page.keyboard.press('F4');
    await page.getByRole('button', { name: 'RESTART', exact: true }).click();
    await phase(page, 'PLAYING');
    await page
      .locator('#dev-panel summary')
      .filter({ hasText: 'NETWORK' })
      .click();
    await page
      .getByRole('button', { name: 'DISCONNECT 20 SECONDS', exact: true })
      .click();
    await page.locator('#reconnecting').waitFor({ state: 'visible' });
    await capture('reconnecting');
    await page
      .locator('#reconnecting')
      .waitFor({ state: 'hidden', timeout: 35000 });
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'leviathan').playerId),
      id,
    );
    results[`reconnect-${suffix}`] = true;
    await context.close();
  }
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(base);
    await page
      .getByRole('button', { name: 'SOLO TEST', exact: true })
      .waitFor();
    await checkLayout(page);
    await page
      .locator('summary')
      .filter({ hasText: 'OPERATOR SETTINGS' })
      .click();
    await checkLayout(page);
    await page.getByRole('button', { name: '×', exact: true }).click();
    await page.getByRole('button', { name: 'SOLO TEST', exact: true }).click();
    await phase(page, 'PLAYING');
    assert.equal(
      await page.evaluate(
        () => Reflect.get(window, 'leviathan').room.players[0].name,
      ),
      'TESTER',
    );
    await page.reload();
    await phase(page, 'PLAYING');
    await page.waitForFunction(() => !document.querySelector('.paused'));
    await page.keyboard.press('F4');
    await page.getByRole('button', { name: 'ADD 7 BOTS', exact: true }).click();
    await page.waitForFunction(
      () => Reflect.get(window, 'leviathan').room.players.length === 8,
    );
    await page
      .getByRole('button', { name: 'RETURN TO LOBBY', exact: true })
      .click();
    await phase(page, 'LOBBY');
    await page.keyboard.press('F4');
    await checkLayout(page);
    results[`layout-eight-players-${viewport.width}`] = true;
    await context.close();
  }
  const narrow = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await narrow.newPage();
  await page.goto(base);
  await page.waitForTimeout(1000);
  await checkLayout(page);
  const frames = await page.evaluate(
    () => Reflect.get(window, 'leviathan').background.frames,
  );
  await page.waitForTimeout(600);
  assert.equal(
    await page.evaluate(
      () => Reflect.get(window, 'leviathan').background.frames,
    ),
    frames,
  );
  results.reducedMotion = true;
  await narrow.close();
  assert.deepEqual(errors, []);
  results.browserErrors = errors;
  results.pass = true;
} catch (error) {
  results.pass = false;
  results.error = error instanceof Error ? error.stack : String(error);
  console.error(error);
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/scope-update-browser.json',
    JSON.stringify(results, null, 2),
  );
  console.log(results);
  await browser.close();
}
process.exitCode = results.pass ? 0 : 1;
