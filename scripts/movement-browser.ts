/** Movement acceptance through the real client: default keys, a continuous traversal
 * chain in the Movement Lab and on Foundry Row, camera frames, and prediction under
 * 0/150/300 ms latency with 3% loss. Requires a dev server (TEST_URL, default :5173). */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_URL ?? 'http://localhost:5173';
const out = 'docs/screens/movement';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
});
await context.addInitScript(() => {
  localStorage.setItem(
    'graphics',
    JSON.stringify({ quality: 'MEDIUM', grain: 0.018, bloom: 0.16 }),
  );
  // Native capture stays pending, so the client uses its keyboard/drag fallback.
  HTMLCanvasElement.prototype.requestPointerLock = () =>
    new Promise<void>(() => {});
});
const page = await context.newPage(),
  errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir(out, { recursive: true });
type Movement = {
  mode: string;
  speed: number;
  reached: string[];
  reconciliations: number;
  matchedSnapshots: number;
  maxPredictionError: number;
  camera: {
    fovVertical: number;
    eye: number;
    rollDegrees: number;
    fovKick: number;
    pull: number;
    dip: number;
  };
  audio?: { counts: Record<string, number> };
};
const movement = () =>
  page.evaluate(() => Reflect.get(window, 'leviathan').movement as Movement);
async function enter(url: string, level: string) {
  await page.goto(base + url);
  await page.waitForFunction(
    (id) => {
      const l = Reflect.get(window, 'leviathan');
      return l?.world?.ready && l.predicted && l.room?.levelId === id;
    },
    level,
    { timeout: 180000 },
  );
  const hint = page.getByRole('button', {
    name: 'CLICK TO CAPTURE MOUSE',
    exact: true,
  });
  if (await hint.count()) await hint.click();
  await page.waitForFunction(() => !!document.querySelector('.input-mode'));
  // Keep camera frames clean of the capture banner; the HUD stays.
  await page.addStyleTag({ content: '.input-mode{display:none!important}' });
  // Plain script text: bundler helpers must not leak into page-side functions.
  await page.addScriptTag({ content: PAGE_HELPERS });
}
/** Screenshot when the predicate first holds (polled while the chain runs). */
async function frameWhen(name: string, predicate: string, timeout = 20000) {
  await page.waitForFunction(
    (p) => {
      const l = Reflect.get(window, 'leviathan');
      return new Function('s', 'm', 'c', `return ${p}`)(
        l.predicted,
        l.predicted.move ?? {},
        l.movement.camera,
      );
    },
    predicate,
    { timeout, polling: 'raf' },
  );
  const camera = (await movement()).camera;
  await page.screenshot({ path: `${out}/${name}.png` });
  return camera;
}
/** In-page helpers: closed-loop steering and a predicate-driven, tick-accurate chain. */
const PAGE_HELPERS = `
window.sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
window.testHook = () => window.leviathanTest;
window.selfState = () => window.leviathan.predicted;
window.goTo = async (x, z, face) => {
  for (let i = 0; i < 600; i++) {
    const p = selfState().position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.35) break;
    testHook().inject([{ ticks: 3, z: Math.min(1, d / 1.2 + 0.15), yaw: Math.atan2(-dx, -dz), buttons: d > 4 ? 2 : 0 }]);
    await sleepMs(50);
  }
  testHook().clear();
  testHook().inject([Object.assign({ ticks: 30, z: 0 }, face === undefined ? {} : { yaw: face })]);
  await sleepMs(600);
};
window.transitions = [];
window.lastMode = '';
setInterval(() => {
  const s = window.leviathan && window.leviathan.predicted;
  if (!s || !s.move) return;
  const key = s.move.mode + (s.move.wall ? ':' + s.move.wall.id : '');
  if (key !== window.lastMode) {
    window.lastMode = key;
    window.transitions.push([key, +s.position.x.toFixed(1), +s.position.y.toFixed(2), +s.position.z.toFixed(1), +s.velocity.y.toFixed(1)]);
    if (window.transitions.length > 80) window.transitions.shift();
  }
}, 8);
window.cameraPeak = { roll: 0, kick: 0 };
setInterval(() => {
  const c = window.leviathan && window.leviathan.movement && window.leviathan.movement.camera;
  if (!c) return;
  window.cameraPeak.roll = Math.max(window.cameraPeak.roll, Math.abs(c.rollDegrees));
  window.cameraPeak.kick = Math.max(window.cameraPeak.kick, c.fovKick);
}, 16);
window.chain = async (plan) => {
  const log = [];
  for (const step of plan) {
    const done = new Function('s', 'm', 'return ' + step.until);
    let n = 0;
    for (; n < step.max; n++) {
      const s = selfState();
      if (done(s, s.move || {})) break;
      testHook().inject([Object.assign({ ticks: 1 }, step.input)]);
      while (testHook().remaining() > 0) await sleepMs(4);
    }
    log.push(step.until + ' -> ' + n);
  }
  return log;
};
`;
const J = 1,
  S = 2,
  C = 4;
// Lab chain: from the long wall's approach run through to the chain ledge mantle.
const LAB_CHAIN = [
  { until: 'false', input: { z: 1, yaw: 0, buttons: S }, max: 32 },
  {
    until: "m.mode === 'SLIDE' && m.slideTicks > 10",
    input: { z: 1, yaw: 0, buttons: S | C },
    max: 40,
  },
  {
    until: "m.mode === 'AIR'",
    input: { z: 1, yaw: 0, buttons: S | J },
    max: 4,
  },
  {
    until: 's.velocity.y <= 1.5',
    input: { z: 1, yaw: 0, buttons: S },
    max: 60,
  },
  // Air jump while steering in: the latch happens on the way up, as a player would.
  {
    until: 'm.airJumps === 0',
    input: { z: 1, x: 1, yaw: 0, buttons: S | J },
    max: 4,
  },
  {
    until: "m.mode === 'WALLRUN'",
    input: { z: 1, x: 1, yaw: 0, buttons: S },
    max: 90,
  },
  {
    until: "m.mode === 'WALLRUN' && m.wall.ticks > 30",
    input: { z: 1, yaw: 0, buttons: S },
    max: 90,
  },
  {
    until: "m.mode === 'AIR' && s.velocity.y > 4",
    input: { z: 1, yaw: 0, buttons: S | J },
    max: 4,
  },
  { until: "m.mode !== 'AIR'", input: { z: 1, yaw: 0, buttons: S }, max: 120 },
];
/** Jump and air jump in place: the camera frame at the air jump's apex. */
const APEX = [
  { until: "m.mode === 'AIR'", input: { buttons: J }, max: 4 },
  { until: 's.velocity.y <= 0', input: {}, max: 60 },
  { until: 'm.airJumps === 0', input: { buttons: J }, max: 4 },
  { until: "m.mode !== 'AIR'", input: {}, max: 120 },
];
async function labChain(capture: boolean) {
  await page.evaluate(() =>
    Reflect.set(window, 'cameraPeak', { roll: 0, kick: 0 }),
  );
  await page.evaluate(() => Reflect.get(window, 'leviathanTest').resetStats());
  await page.evaluate(() =>
    (
      window as unknown as { goTo: (x: number, z: number) => Promise<void> }
    ).goTo(-2.5, 57),
  );
  await page.evaluate(() =>
    (
      window as unknown as { goTo: (x: number, z: number) => Promise<void> }
    ).goTo(-2.5, 44),
  );
  await page.evaluate(() =>
    (
      window as unknown as {
        goTo: (x: number, z: number, f: number) => Promise<void>;
      }
    ).goTo(-39.4, 24, 0),
  );
  const frames: Record<string, unknown> = {};
  const apex = page.evaluate(
    (plan) =>
      (window as unknown as { chain: (p: unknown) => Promise<string[]> }).chain(
        plan,
      ),
    APEX,
  );
  if (capture)
    frames.apex = await frameWhen(
      'lab-double-jump-apex',
      "m.mode === 'AIR' && m.airJumps === 0 && Math.abs(s.velocity.y) < 0.6",
    );
  await apex;
  const run = page.evaluate(
    (plan) =>
      (window as unknown as { chain: (p: unknown) => Promise<string[]> }).chain(
        plan,
      ),
    LAB_CHAIN,
  );
  if (capture) {
    frames.slide = await frameWhen(
      'lab-slide',
      "m.mode === 'SLIDE' && m.slideTicks > 6",
    );
    frames.wallrun = await frameWhen(
      'lab-wall-run',
      "m.mode === 'WALLRUN' && m.wall.ticks > 22 && Math.abs(c.rollDegrees) > 8",
    );
  }
  const log = await run;
  // Finish: sprint at the chain ledge and jump into a mantle.
  await page.evaluate(() =>
    (
      window as unknown as {
        goTo: (x: number, z: number, f: number) => Promise<void>;
      }
    ).goTo(-43, -25, 0),
  );
  const mantle = page.evaluate(
    (plan) =>
      (window as unknown as { chain: (p: unknown) => Promise<string[]> }).chain(
        plan,
      ),
    [
      {
        until: 's.position.z < -28.4',
        input: { z: 1, yaw: 0, buttons: S },
        max: 90,
      },
      {
        until: "m.mode === 'MANTLE'",
        input: { z: 1, yaw: 0, buttons: S | J },
        max: 30,
      },
      {
        until: "m.mode !== 'MANTLE'",
        input: { z: 1, yaw: 0, buttons: S },
        max: 60,
      },
    ],
  );
  if (capture)
    frames.mantle = await frameWhen(
      'lab-mantle',
      "m.mode === 'MANTLE' && m.mantle.ticks > 12",
    );
  log.push(...(await mantle));
  const transitions = await page.evaluate(() =>
    Reflect.get(window, 'transitions'),
  );
  const peak = await page.evaluate(() => Reflect.get(window, 'cameraPeak'));
  return {
    log,
    frames,
    transitions,
    maxRoll: peak.roll as number,
    maxKick: peak.kick as number,
    movement: await movement(),
  };
}
const report: Record<string, unknown> = {};
try {
  // 1. Movement Lab: default keys, then the full chain with camera frames.
  await enter('/?solo=1&level=lab', 'movement-lab');
  await page.evaluate(() => Reflect.get(window, 'leviathanTest').resetStats());
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(900);
  await page.keyboard.down('KeyC');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await page.keyboard.up('KeyC');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  for (const key of ['KeyW', 'ShiftLeft']) await page.keyboard.up(key);
  await page.waitForTimeout(400);
  const keys = await movement();
  assert(keys.reached.includes('SLIDE'), 'C slides from a Shift sprint');
  assert(keys.reached.includes('AIR'), 'Space jumps');
  assert(
    (keys.audio?.counts.doublejump ?? 0) >= 1,
    'second Space is an air jump',
  );
  report.defaultKeys = { reached: keys.reached, audio: keys.audio?.counts };
  const lab = await labChain(true);
  report.lab = lab;
  for (const state of ['GROUND', 'SLIDE', 'AIR', 'WALLRUN', 'MANTLE'])
    assert(lab.movement.reached.includes(state), 'lab chain reached ' + state);
  assert(
    (lab.movement.audio?.counts['walljump.brick'] ?? 0) >= 1,
    'wall-jump fired',
  );
  assert((lab.movement.audio?.counts.doublejump ?? 0) >= 1, 'air jump fired');
  report.lab = lab;
  // 2. Foundry Row: sidewalk run, slide-jump, air jump into the right-hand facade,
  // wall-run, wall-jump into the street, then mantle onto a parked car.
  await enter('/?solo=1', 'foundry-row');
  await page.evaluate(() => Reflect.get(window, 'leviathanTest').resetStats());
  await page.evaluate(() =>
    (
      window as unknown as {
        goTo: (x: number, z: number, f: number) => Promise<void>;
      }
    ).goTo(9.2, 74, 0),
  );
  const foundry: Record<string, unknown> = {};
  const hop = page.evaluate(
    (plan) =>
      (window as unknown as { chain: (p: unknown) => Promise<string[]> }).chain(
        plan,
      ),
    APEX,
  );
  foundry.apex = await frameWhen(
    'foundry-double-jump-apex',
    "m.mode === 'AIR' && m.airJumps === 0 && Math.abs(s.velocity.y) < 0.6",
  );
  await hop;
  const street = page.evaluate(
    (plan) =>
      (window as unknown as { chain: (p: unknown) => Promise<string[]> }).chain(
        plan,
      ),
    LAB_CHAIN,
  );
  foundry.slide = await frameWhen(
    'foundry-slide',
    "m.mode === 'SLIDE' && m.slideTicks > 6",
  );
  foundry.wallrun = await frameWhen(
    'foundry-wall-run',
    "m.mode === 'WALLRUN' && m.wall.ticks > 22 && Math.abs(c.rollDegrees) > 8",
  );
  foundry.log = await street;
  await page.evaluate(() =>
    (
      window as unknown as {
        goTo: (x: number, z: number, f: number) => Promise<void>;
      }
    ).goTo(0.2, 57, Math.PI / 2),
  );
  const climb = page.evaluate(
    (plan) =>
      (window as unknown as { chain: (p: unknown) => Promise<string[]> }).chain(
        plan,
      ),
    [
      {
        until: 's.position.x < -2.9',
        input: { z: 1, yaw: Math.PI / 2, buttons: S },
        max: 90,
      },
      {
        until: "m.mode === 'MANTLE'",
        input: { z: 1, yaw: Math.PI / 2, buttons: S | J },
        max: 30,
      },
      {
        until: "m.mode !== 'MANTLE'",
        input: { z: 1, yaw: Math.PI / 2, buttons: 0 },
        max: 60,
      },
    ],
  );
  foundry.mantle = await frameWhen(
    'foundry-mantle',
    "m.mode === 'MANTLE' && m.mantle.ticks > 12",
  );
  foundry.climbLog = await climb;
  const f = await movement();
  for (const state of ['GROUND', 'SLIDE', 'AIR', 'WALLRUN', 'MANTLE'])
    assert(f.reached.includes(state), 'foundry chain reached ' + state);
  assert(
    Object.keys(f.audio?.counts ?? {}).some((k) => k.startsWith('walljump.')),
    'foundry wall-jump fired',
  );
  assert((f.audio?.counts.doublejump ?? 0) >= 1, 'foundry air jump fired');
  foundry.movement = f;
  report.foundry = foundry;
  // 3. Prediction under latency and loss, lab chain without captures.
  const prediction: Record<string, unknown>[] = [];
  for (const lag of [0, 150, 300]) {
    await enter(`/?solo=1&level=lab&lag=${lag}&loss=3`, 'movement-lab');
    const result = await labChain(false);
    prediction.push({
      lag,
      loss: 3,
      reached: result.movement.reached,
      maxPredictionError: result.movement.maxPredictionError,
      reconciliations: result.movement.reconciliations,
      matchedSnapshots: result.movement.matchedSnapshots,
    });
    assert(
      result.movement.reached.includes('WALLRUN'),
      `wall-run at ${lag} ms`,
    );
    assert(result.movement.reached.includes('MANTLE'), `mantle at ${lag} ms`);
  }
  report.prediction = prediction;
  // 4. Operator settings through the real drawer: FOV, REDUCE MOTION, speedometer.
  await enter('/?solo=1&level=lab', 'movement-lab');
  const baseFov = (await movement()).camera.fovVertical;
  await page.keyboard.press('Escape');
  await page.locator('details.settings > summary').click();
  const setRange = async (label: string, value: number) =>
    page
      .getByLabel(label, { exact: true })
      .evaluate((input: HTMLInputElement, v) => {
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
  await setRange('field of view', 110);
  await page.getByLabel('reduce motion', { exact: true }).check();
  await page.getByLabel('speedometer (m/s)', { exact: true }).check();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('movementSettings') ?? '{}'),
  );
  assert.equal(saved.fov, 110);
  assert.equal(saved.reduceMotion, true);
  await page
    .getByRole('button', { name: 'CLICK TO RESUME', exact: true })
    .click();
  await page.waitForFunction(() => !!document.querySelector('.input-mode'));
  const calm = await labChain(false);
  const settled = (await movement()).camera;
  assert(settled.fovVertical > baseFov + 10, 'FOV slider widened the view');
  assert(calm.movement.reached.includes('WALLRUN'));
  assert.equal(
    await page.locator('.speedometer').isVisible(),
    true,
    'speedometer shown',
  );
  report.settings = {
    baseFovVertical: baseFov,
    fov110Vertical: settled.fovVertical,
    reduceMotionMaxRoll: calm.maxRoll,
    reduceMotionMaxKick: calm.maxKick,
    speedometer: await page.locator('.speedometer').textContent(),
  };
  assert(calm.maxRoll < 0.5, 'REDUCE MOTION removes roll');
  assert(calm.maxKick < 0.05, 'REDUCE MOTION removes FOV kick');
  report.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  report.frameMs = await page.evaluate(
    () => Reflect.get(window, 'leviathan').world.frameMs,
  );
  assert.deepEqual(errors, []);
  report.pass = true;
} finally {
  report.errors = errors;
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/movement-browser.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
