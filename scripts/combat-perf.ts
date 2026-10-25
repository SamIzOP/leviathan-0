/** Firefight performance (Prompt 4): eight operators firing.
 * 1. Server: a dev room with 7 firing bots + the host firing + 16 dummies; time
 *    every Game.step() for 60 s of simulated ticks.
 * 2. Client (TEST_URL, default :5173): LOW 1280×720, the same firefight with the
 *    local operator also firing; frame times, draw calls, triangles and combat FX
 *    pool counts over SECONDS (default 20), against a quiet baseline.
 * Writes docs/combat/perf-<preset>.json. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { Game, type Peer } from '../packages/server/src/game';
import { CONFIG, FIRE_BUTTON } from '@leviathan/shared';
const preset = process.env.PRESET ?? 'LOW',
  seconds = Number(process.env.SECONDS ?? 20),
  url = process.env.TEST_URL ?? 'http://localhost:5173';
await mkdir('docs/combat', { recursive: true });
// --- 1. Server tick cost ----------------------------------------------------------
let time = 1000;
const game = new Game({ devTools: true }, () => time);
const peer: Peer = { id: 'host', send: () => {}, close: () => {} };
game.handle(peer, {
  type: 'dev-solo',
  protocol: CONFIG.protocol,
  name: 'TESTER',
});
const room = peer.room!;
for (const action of ['bots-fire', 'infinite-ammo', 'moving-dummies'] as const)
  game.handle(peer, { type: 'dev', action, enabled: true });
game.handle(peer, { type: 'dev', action: 'add-bots', count: 7 });
for (let i = 0; i < 3; i++)
  game.handle(peer, { type: 'dev', action: 'spawn-range', count: 5 });
game.handle(peer, { type: 'dev', action: 'spawn-range', count: 1 });
const stepMs: number[] = [];
let seq = 0;
const counts = { shots: 0, events: 0 };
for (let t = 0; t < 60 * 60; t++) {
  const me = peer.player!.entity;
  game.handle(peer, {
    type: 'inputs',
    inputs: [
      {
        seq: ++seq,
        tick: game.tick + 1,
        x: 0,
        z: 0,
        yaw: me.yaw,
        pitch: -0.05,
        buttons: FIRE_BUTTON.fire,
        weapon: 1,
        view: game.tick,
      },
    ],
  });
  time += 1000 / 60;
  const start = performance.now();
  game.step();
  stepMs.push(performance.now() - start);
  if (t % 2 === 0) {
    counts.events += room.combat?.events.length ?? 0;
    game.sendSnapshots(room);
  }
}
counts.shots = room.combat?.stats.shots ?? 0;
const sorted = [...stepMs].sort((a, b) => a - b);
const server = {
  ticks: stepMs.length,
  shooters: room.players.length,
  dummies: room.robots.length,
  shots: counts.shots,
  events: counts.events,
  hits: room.combat?.stats.hits,
  meanMs: stepMs.reduce((a, b) => a + b, 0) / stepMs.length,
  p99Ms: sorted[Math.floor(sorted.length * 0.99)],
  maxMs: sorted.at(-1),
  budgetMs: 1000 / 60,
};
console.log('SERVER', JSON.stringify(server));
// --- 2. Client frame cost -----------------------------------------------------------
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
});
const resolution = preset === 'LOW' ? [1280, 720] : [1920, 1080];
const page = await browser.newPage({
  viewport: { width: resolution[0]!, height: resolution[1]! },
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((p) => {
  localStorage.setItem(
    'graphics',
    JSON.stringify({ quality: p, grain: 0.018, bloom: 0.16 }),
  );
  localStorage.removeItem('devPreferences');
  HTMLCanvasElement.prototype.requestPointerLock = () =>
    new Promise<void>(() => {});
}, preset);
await page.goto(`${url}/?solo=1`);
await page.waitForFunction(
  () =>
    Reflect.get(window, 'leviathan')?.world?.ready &&
    Reflect.get(window, 'leviathan').predicted,
  undefined,
  { timeout: 180000 },
);
const gpu = await page.evaluate(() => {
  const gl = document
      .querySelector<HTMLCanvasElement>('#arena')!
      .getContext('webgl2')!,
    ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
});
const click = (label: string) =>
  page.evaluate((l) => {
    Array.from(
      document.querySelectorAll<HTMLButtonElement>('#dev-panel button'),
    )
      .find((b) => b.textContent === l)
      ?.click();
  }, label);
const check = (control: string, value: boolean) =>
  page.evaluate(
    ({ control, value }) => {
      const i = document.querySelector<HTMLInputElement>(
        `#dev-panel [data-control="${control}"]`,
      )!;
      i.checked = value;
      i.dispatchEvent(new Event('change'));
    },
    { control, value },
  );
/** Frame deltas from rAF plus renderer counters, sampled in the page. */
async function measure(label: string, firing: boolean) {
  // String-injected sampler (tsx helpers must not leak into page functions),
  // function-scoped so it can be injected once per measurement.
  await page.addScriptTag({
    content: `(() => {
      window.__frames = []; window.__draws = []; window.__fx = [];
      let last = performance.now();
      window.__run = true;
      const loop = (t) => {
        window.__frames.push(t - last);
        last = t;
        const l = window.leviathan;
        window.__draws.push([l.world?.drawCalls ?? 0, l.world?.triangles ?? 0]);
        if (window.__frames.length % 30 === 0) window.__fx.push(l.combat?.fx);
        if (window.__run) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    })();`,
  });
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (firing)
      await page.evaluate(() =>
        Reflect.get(window, 'leviathanTest').inject([
          { ticks: 30, buttons: 8, weapon: 1, pitch: -0.03 },
        ]),
      );
    await page.waitForTimeout(450);
  }
  const data = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__run = false;
    return {
      frames: w.__frames as number[],
      draws: w.__draws as number[][],
      fx: w.__fx as Record<string, number>[],
    };
  });
  const frames = data.frames.slice(10).sort((a, b) => a - b);
  const fxPeak: Record<string, number> = {};
  for (const f of data.fx)
    for (const [k, v] of Object.entries(f ?? {}))
      fxPeak[k] = Math.max(fxPeak[k] ?? 0, v);
  return {
    label,
    frames: frames.length,
    meanMs: frames.reduce((a, b) => a + b, 0) / frames.length,
    p95Ms: frames[Math.floor(frames.length * 0.95)],
    p99Ms: frames[Math.floor(frames.length * 0.99)],
    worstMs: frames.at(-1),
    fps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length),
    drawCallsMax: Math.max(...data.draws.map((d) => d[0]!)),
    drawCallsMean:
      data.draws.reduce((s, d) => s + d[0]!, 0) / data.draws.length,
    trianglesMax: Math.max(...data.draws.map((d) => d[1]!)),
    fxPeak,
  };
}
const quiet = await measure('quiet (no firing)', false);
console.log('CLIENT', JSON.stringify(quiet));
await check('combat-infinite-ammo', true);
await click('ADD 7 BOTS');
await page.waitForTimeout(500);
for (let i = 0; i < 3; i++) await click('SPAWN RANGE ROW');
await check('combat-moving-dummies', true);
await check('combat-bots-fire', true);
await page.waitForTimeout(1500);
const firefight = await measure('firefight (8 operators firing)', true);
console.log('CLIENT', JSON.stringify(firefight));
const report = { preset, resolution, gpu, server, quiet, firefight, errors };
await writeFile(
  `docs/combat/perf-${preset.toLowerCase()}.json`,
  JSON.stringify(report, null, 2),
);
await browser.close();
if (errors.length) process.exitCode = 1;
