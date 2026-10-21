import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  });
  const page = await context.newPage();
  await page.goto('http://localhost:5173');
  await page.getByLabel('Callsign').fill('Dev operator');
  await page.getByRole('button', { name: 'CREATE ROOM', exact: true }).click();
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.room?.phase === 'LOBBY',
  );
  assert.match(await page.locator('.code').innerText(), /^[A-Z2-9]{4}$/);
  const health = await page.request.get('http://localhost:5173/health');
  assert.equal(((await health.json()) as { ok: boolean }).ok, true);
  console.log(
    'PASS: Vite page, TypeScript client, proxy, WebSocket room creation and health endpoint.',
  );
} finally {
  await browser.close();
}
