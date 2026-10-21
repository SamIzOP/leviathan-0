import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { Entity, RoomView } from '@leviathan/shared';
interface Diagnostics {
  room?: RoomView;
  playerId: string;
  predicted: Entity;
  pending: number;
  predictionError: number;
  tick: number;
  snapshotHz: number;
  entities: Entity[];
  rendered: { id: string; position: number[] }[];
  audio: { events: Record<string, number>; assets: number; fallbacks: number };
}
async function state(page: Page): Promise<Diagnostics> {
  return page.evaluate(() => Reflect.get(window, 'leviathan') as Diagnostics);
}
const executable =
  process.env.CHROMIUM_PATH ??
  resolve(
    process.env.LOCALAPPDATA ?? '',
    'ms-playwright/chromium-1200/chrome-win64/chrome.exe',
  );
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(executable) ? { executablePath: executable } : {}),
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const base = process.env.TEST_URL ?? 'http://localhost:3000';
const a = await browser.newContext({ viewport: { width: 900, height: 650 } }),
  b = await browser.newContext({ viewport: { width: 900, height: 650 } });
const host = await a.newPage(),
  guest = await b.newPage();
const errors: string[] = [];
for (const page of [host, guest])
  page.on('pageerror', (e) => errors.push(e.message));
for (const page of [host, guest])
  page.on('websocket', (ws) => {
    ws.on('socketerror', (error) => console.log('WebSocket error:', error));
  });
const checks: Record<string, boolean | number | string> = {};
async function openResumedTab(page: Page) {
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    // Chromium may cancel the first new-tab navigation after an offline context
    // is restored. Retry navigation once; identity/phase assertions remain below.
    if (!(error instanceof Error) || !error.message.includes('ERR_ABORTED'))
      throw error;
    checks.navigationRetries = Number(checks.navigationRetries ?? 0) + 1;
    await page.goto(base, { waitUntil: 'domcontentloaded' });
  }
}
async function phase(page: Page, value: string) {
  await page.waitForFunction(
    (p) => Reflect.get(window, 'leviathan')?.room?.phase === p,
    value,
    { timeout: 35000 },
  );
}
async function readyStart() {
  await host.getByRole('button', { name: 'READY', exact: true }).click();
  await guest.getByRole('button', { name: 'READY', exact: true }).click();
  await host.waitForFunction(() =>
    Reflect.get(window, 'leviathan').room.players.every(
      (p: { ready: boolean }) => p.ready,
    ),
  );
  await host.getByRole('button', { name: 'START', exact: true }).click();
  await phase(host, 'PLAYING');
  await phase(guest, 'PLAYING');
}
try {
  await mkdir('test-results', { recursive: true });
  await host.goto(base + '/?lag=150&loss=3');
  await host.getByLabel('Callsign').fill('Kainos One');
  await host.getByRole('button', { name: 'CREATE ROOM', exact: true }).click();
  await phase(host, 'LOBBY');
  const code = (await state(host)).room!.code;
  await guest.goto(base + `/?room=${code}`);
  assert.equal(await guest.getByLabel('Room code').inputValue(), code);
  await guest.getByLabel('Callsign').fill('Kainos Two');
  await guest.getByRole('button', { name: 'JOIN ROOM', exact: true }).click();
  await phase(guest, 'LOBBY');
  await host.waitForFunction(
    () => Reflect.get(window, 'leviathan').room.players.length === 2,
  );
  checks.inviteAndJoin = true;
  await host.screenshot({ path: 'test-results/lobby.png' });
  await readyStart();
  await host.getByRole('button', { name: 'CLICK TO RESUME' }).click();
  await host.waitForFunction(() => !!document.pointerLockElement);
  const initial = (await state(host)).predicted.position;
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(1600);
  await host.keyboard.up('KeyW');
  await host.waitForTimeout(800);
  const moved = await state(host);
  console.log('Movement diagnostic', {
    initial,
    position: moved.predicted.position,
    pending: moved.pending,
    error: moved.predictionError,
  });
  assert.ok(
    Math.hypot(
      moved.predicted.position.x - initial.x,
      moved.predicted.position.z - initial.z,
    ) > 2,
  );
  const other = await state(guest);
  const seen = other.entities.find((e) => e.id === moved.playerId)!;
  assert.ok(Math.abs(seen.position.z - moved.predicted.position.z) < 0.25);
  const rendered = other.rendered.find((e) => e.id === moved.playerId)!;
  assert.ok(Math.abs(rendered.position[2]! - moved.predicted.position.z) < 0.3);
  assert.ok(moved.predictionError < 0.25);
  checks.movementAt150ms = true;
  checks.predictionError = moved.predictionError;
  checks.remoteInterpolation = true;
  await host.keyboard.press('Space');
  await host.waitForTimeout(500);
  await host.keyboard.press('F3');
  await host.locator('#debug').waitFor({ state: 'visible' });
  assert.equal(await host.locator('#debug').isVisible(), true);
  assert.ok((await host.locator('#debug').innerText()).includes('SNAPSHOTS'));
  await host.keyboard.press('F9');
  await guest.waitForFunction(() =>
    Reflect.get(window, 'leviathan').entities.some(
      (e: { type: string }) => e.type === 'robot',
    ),
  );
  checks.debugAndDummy = true;
  await host.screenshot({ path: 'test-results/arena.png' });
  const originalId = (await state(guest)).playerId;
  const originalPosition = (await state(guest)).predicted.position;
  await b.setOffline(true);
  await host.waitForTimeout(21000);
  assert.ok(
    (await state(host)).room!.players.find((p) => p.id === originalId)
      ?.connected === false,
  );
  await b.setOffline(false);
  await guest.waitForFunction(
    (id) =>
      Reflect.get(window, 'leviathan')?.playerId === id &&
      document.querySelector('#reconnecting')?.hasAttribute('hidden'),
    originalId,
    { timeout: 20000 },
  );
  assert.equal((await state(guest)).playerId, originalId);
  assert.deepEqual((await state(guest)).predicted.position, originalPosition);
  checks.offline20Seconds = true;
  const replacement = await b.newPage();
  await openResumedTab(replacement);
  await phase(replacement, 'PLAYING');
  assert.equal((await state(replacement)).playerId, originalId);
  await guest.getByText(/uplink was replaced/).waitFor();
  checks.newestTabWins = true;
  await guest.close();
  await replacement.close();
  const reopened = await b.newPage();
  await openResumedTab(reopened);
  await phase(reopened, 'PLAYING');
  assert.equal((await state(reopened)).playerId, originalId);
  checks.tabReopen = true;
  await host.keyboard.press('F8');
  await phase(host, 'ENDED');
  await phase(reopened, 'ENDED');
  await host.getByRole('button', { name: 'NEXT FACTORY', exact: true }).click();
  await reopened.getByRole('button', { name: 'REPLAY', exact: true }).click();
  await host.screenshot({ path: 'test-results/vote.png' });
  await phase(host, 'COUNTDOWN');
  assert.equal((await state(host)).room!.mission, 1);
  await phase(host, 'PLAYING');
  checks.hostTieNext = true;
  await host.getByRole('button', { name: 'CLICK TO RESUME' }).click();
  await host.keyboard.press('F8');
  await phase(host, 'ENDED');
  await host.getByRole('button', { name: 'REPLAY', exact: true }).click();
  await reopened.getByRole('button', { name: 'REPLAY', exact: true }).click();
  await phase(host, 'COUNTDOWN');
  assert.equal((await state(host)).room!.mission, 1);
  checks.replay = true;
  const audio = (await state(host)).audio;
  for (const event of [
    'ui_click',
    'countdown_tick',
    'match_start',
    'match_end',
    'jump',
    'footstep',
    'vote_cast',
    'rain_ambient',
  ])
    assert.ok(audio.events[event], `Missing audio ${event}`);
  assert.ok(audio.fallbacks > 0);
  checks.audioFallback = true;
  checks.liveSnapshotHz = (await state(host)).snapshotHz;
  // Supply a real WAV via the network boundary, proving manifest asset resolution.
  const audioContext = await browser.newContext({
    viewport: { width: 900, height: 650 },
  });
  const audioPage = await audioContext.newPage();
  const wav = Buffer.alloc(44 + 8000);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(8000, 40);
  await audioPage.route('**/audio/ui_click.wav', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }),
  );
  await audioPage.goto(base);
  await audioPage.getByLabel('Callsign').fill('Audio operator');
  await audioPage.locator('.settings > summary').click();
  await audioPage
    .getByRole('button', { name: 'CREATE ROOM', exact: true })
    .click();
  await audioPage.waitForFunction(
    () => Reflect.get(window, 'leviathan').audio.assets > 0,
  );
  checks.audioAsset = (await state(audioPage)).audio.assets > 0;
  assert.equal(checks.audioAsset, true);
  assert.deepEqual(errors, []);
  checks.browserErrors = 0;
  checks.pass = true;
} catch (e) {
  checks.pass = false;
  checks.failure = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await host.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
} finally {
  await writeFile('test-results/browser.json', JSON.stringify(checks, null, 2));
  console.log(checks);
  await browser.close();
}
process.exitCode = checks.pass ? 0 : 1;
