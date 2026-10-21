import { chromium } from 'playwright';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CONFIG, DEV_ACTIONS, decodeServer, encode } from '@leviathan/shared';
import type { ServerMessage, ClientMessage } from '@leviathan/shared';
const base = process.env.TEST_URL ?? 'http://localhost:3001';
const messages: ServerMessage[] = [];
const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
ws.on('message', (raw) => {
  const m = decodeServer(String(raw));
  if (m.type === 'ping') ws.send(encode({ type: 'pong', time: m.time }));
  else messages.push(m);
});
async function waitFor(predicate: (m: ServerMessage) => boolean) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const i = messages.findIndex(predicate);
    if (i >= 0) return messages.splice(i, 1)[0]!;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected server response did not arrive');
}
const report: Record<string, unknown> = {};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  assert.equal(
    (
      (await waitFor((m) => m.type === 'hello')) as Extract<
        ServerMessage,
        { type: 'hello' }
      >
    ).devTools,
    false,
  );
  ws.send(
    encode({ type: 'create', protocol: CONFIG.protocol, name: 'PRODUCTION' }),
  );
  const welcome = (await waitFor((m) => m.type === 'welcome')) as Extract<
    ServerMessage,
    { type: 'welcome' }
  >;
  assert.equal(welcome.devTools, false);
  const commands: ClientMessage[] = [
    ...DEV_ACTIONS.map((action) => ({ type: 'dev' as const, action })),
    { type: 'dev-solo', protocol: CONFIG.protocol, name: 'FORBIDDEN' },
    // The Movement Lab is not part of production at all.
    {
      type: 'dev-solo',
      protocol: CONFIG.protocol,
      name: 'FORBIDDEN',
      level: 'lab',
    },
    { type: 'debug', action: 'end' },
    { type: 'debug', action: 'robot' },
  ];
  for (const command of commands) {
    ws.send(encode(command));
    const response = await waitFor((m) => m.type === 'error');
    assert.equal(
      response.type === 'error' && response.message,
      'Developer tools are disabled on this server.',
    );
  }
  report.rejectedDevCommands = commands.length;
  ws.send(encode({ type: 'ready', ready: true }));
  ws.send(encode({ type: 'start' }));
  assert.equal((await waitFor((m) => m.type === 'error')).type, 'error');
  report.onePlayerRejected = true;
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/?solo=1&devTools=true');
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.devTools === false,
  );
  assert.equal(
    await page.getByRole('button', { name: 'SOLO TEST', exact: true }).count(),
    0,
  );
  await page.keyboard.press('F4');
  assert.equal(await page.locator('#dev-panel').isVisible(), false);
  assert.equal(
    await page.evaluate(() => Reflect.get(window, 'leviathan').room),
    undefined,
  );
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(
      () =>
        document.fonts.check('700 16px Oswald') &&
        document.fonts.check('12px "IBM Plex Mono"'),
    ),
    true,
  );
  assert.equal(
    (await (await page.request.get(base + '/health')).json()).ok,
    true,
  );
  assert.deepEqual(errors, []);
  report.noDevUI = true;
  report.fontsAndSinglePort = true;
  await page.goto(base + '/?gallery=1');
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.devTools === false,
  );
  assert.equal(await page.locator('.forge-gallery').count(), 0);
  report.galleryDisabled = true;
  report.pass = true;
} finally {
  ws.close();
  await browser.close();
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/scope-production.json',
    JSON.stringify(report, null, 2),
  );
  console.log(report);
}
