/** Combat acceptance through the real client (dev server, TEST_URL default :5173):
 * 1. firing in every traversal state in the Movement Lab (SMG, infinite ammo);
 * 2. ammo edge cases on Foundry Row: reload cancelled by a switch, empty-magazine
 *    auto-reload, an ammo crate pickup;
 * 3. lag compensation through the dev panel network sliders (100 ms + 20 ms
 *    jitter) against a strafing dummy, compensation on vs off.
 * Writes docs/combat/browser.json. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TEST_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
});
await context.addInitScript(() => {
  localStorage.setItem(
    'graphics',
    JSON.stringify({ quality: 'LOW', grain: 0.018, bloom: 0.16 }),
  );
  localStorage.removeItem('devPreferences');
  // Native capture stays pending, so the client uses its keyboard/drag fallback.
  HTMLCanvasElement.prototype.requestPointerLock = () =>
    new Promise<void>(() => {});
});
const page = await context.newPage(),
  errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('docs/combat', { recursive: true });
const J = 1,
  S = 2,
  C = 4,
  F = 8,
  R = 32;
/** In-page helpers (string-injected: esbuild helpers must not leak into evaluate). */
const HELPERS = `
window.sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
window.testHook = () => window.leviathanTest;
window.selfState = () => window.leviathan.predicted;
window.goTo = async (x, z, face, weapon) => {
  for (let i = 0; i < 900; i++) {
    const p = selfState().position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.35) break;
    testHook().inject([{ ticks: 3, z: Math.min(1, d / 1.2 + 0.15), yaw: Math.atan2(-dx, -dz), buttons: d > 4 ? 2 : 0, weapon }]);
    await sleepMs(50);
  }
  testHook().clear();
  testHook().inject([Object.assign({ ticks: 30, z: 0, weapon }, face === undefined ? {} : { yaw: face })]);
  await sleepMs(600);
};
window.chain = async (plan) => {
  const log = [];
  for (const step of plan) {
    const done = new Function('s', 'm', 'c', 'return ' + step.until);
    let n = 0;
    for (; n < step.max; n++) {
      const s = selfState();
      if (done(s, s.move || {}, s.combat || {})) break;
      testHook().inject([Object.assign({ ticks: 1 }, step.input)]);
      while (testHook().remaining() > 0) await sleepMs(4);
    }
    log.push(step.until + ' -> ' + n);
  }
  return log;
};
// Double-jump shots: shots fired while airborne after the air jump was spent.
window.doubleJumpShots = 0;
window.lastShots = 0;
setInterval(() => {
  const s = window.leviathan && window.leviathan.predicted;
  if (!s || !s.combat || !s.move) return;
  const shots = s.combat.shots;
  if (shots > window.lastShots && s.move.mode === 'AIR' && s.move.airJumps === 0)
    window.doubleJumpShots += shots - window.lastShots;
  window.lastShots = shots;
}, 4);
`;
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
  await page.addScriptTag({ content: HELPERS });
  await page.waitForTimeout(500);
}
const devButton = (label: string) =>
  page.evaluate((l) => {
    const b = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#dev-panel button'),
    ).find((x) => x.textContent === l);
    b?.click();
    return !!b;
  }, label);
const devCheck = (control: string, value: boolean) =>
  page.evaluate(
    ({ control, value }) => {
      const i = document.querySelector<HTMLInputElement>(
        `#dev-panel [data-control="${control}"]`,
      );
      if (!i) return false;
      i.checked = value;
      i.dispatchEvent(new Event('change'));
      return true;
    },
    { control, value },
  );
const devRange = (control: string, value: number) =>
  page.evaluate(
    ({ control, value }) => {
      const i = document.querySelector<HTMLInputElement>(
        `#dev-panel [data-control="${control}"]`,
      );
      if (!i) return false;
      i.value = String(value);
      i.dispatchEvent(new Event('input'));
      return true;
    },
    { control, value },
  );
const chain = (plan: unknown) =>
  page.evaluate(
    (p) =>
      (window as unknown as { chain: (p: unknown) => Promise<string[]> }).chain(
        p,
      ),
    plan,
  );
const goTo = (x: number, z: number, face?: number, weapon?: number) =>
  page.evaluate(
    (a) =>
      (
        window as unknown as {
          goTo: (x: number, z: number, f?: number, w?: number) => Promise<void>;
        }
      ).goTo(a.x, a.z, a.face, a.weapon),
    { x, z, face, weapon },
  );
const combat = () =>
  page.evaluate(() => {
    const l = Reflect.get(window, 'leviathan');
    return {
      state: l.predicted?.combat,
      ...l.combat,
      reached: l.movement.reached as string[],
    };
  });
const report: Record<string, unknown> = {};
try {
  // 1. Movement Lab: SMG fire in sprint, slide, slide-jump air, double jump,
  // wall-run and mantle.
  await enter('/?solo=1&level=lab', 'movement-lab');
  assert(await devCheck('combat-infinite-ammo', true), 'infinite ammo toggle');
  await page.waitForTimeout(400);
  const W = 1;
  await goTo(-2.5, 57, undefined, W);
  await goTo(-2.5, 44, undefined, W);
  await goTo(-39.4, 24, 0, W);
  const states: string[][] = [];
  states.push(
    await chain([
      // Sprint, then pull the trigger while still holding sprint.
      {
        until: 'false',
        input: { z: 1, yaw: 0, buttons: S, weapon: W },
        max: 32,
      },
      {
        until: 'false',
        input: { z: 1, yaw: 0, buttons: S | F, weapon: W },
        max: 14,
      },
    ]),
  );
  // Back to the approach for the slide → air → air jump → wall-run chain.
  await goTo(-39.4, 24, 0, W);
  states.push(
    await chain([
      {
        until: 'false',
        input: { z: 1, yaw: 0, buttons: S, weapon: W },
        max: 32,
      },
      {
        until: "m.mode === 'SLIDE'",
        input: { z: 1, yaw: 0, buttons: S | C, weapon: W },
        max: 40,
      },
      {
        until: 'm.slideTicks > 16',
        input: { z: 1, yaw: 0, buttons: S | C | F, weapon: W },
        max: 30,
      },
      {
        until: "m.mode === 'AIR'",
        input: { z: 1, yaw: 0, buttons: S | J | F, weapon: W },
        max: 4,
      },
      {
        until: 's.velocity.y <= 1.5',
        input: { z: 1, yaw: 0, buttons: S | F, weapon: W },
        max: 60,
      },
      {
        until: 'm.airJumps === 0',
        input: { z: 1, x: 1, yaw: 0, buttons: S | J, weapon: W },
        max: 4,
      },
      {
        until: "m.mode === 'WALLRUN'",
        input: { z: 1, x: 1, yaw: 0, buttons: S | F, weapon: W },
        max: 90,
      },
      {
        until: "m.mode === 'WALLRUN' && m.wall.ticks > 30",
        input: { z: 1, yaw: 0, buttons: S | F, weapon: W },
        max: 90,
      },
      {
        until: "m.mode === 'AIR' && s.velocity.y > 4",
        input: { z: 1, yaw: 0, buttons: S | J, weapon: W },
        max: 4,
      },
      {
        until: "m.mode !== 'AIR'",
        input: { z: 1, yaw: 0, buttons: S, weapon: W },
        max: 120,
      },
    ]),
  );
  await goTo(-43, -25, 0, W);
  states.push(
    await chain([
      {
        until: 's.position.z < -28.4',
        input: { z: 1, yaw: 0, buttons: S, weapon: W },
        max: 90,
      },
      {
        until: "m.mode === 'MANTLE'",
        input: { z: 1, yaw: 0, buttons: S | J, weapon: W },
        max: 30,
      },
      {
        until: "m.mode !== 'MANTLE'",
        input: { z: 1, yaw: 0, buttons: S | F, weapon: W },
        max: 60,
      },
    ]),
  );
  const lab = await combat();
  const doubleJump = await page.evaluate(() =>
    Reflect.get(window, 'doubleJumpShots'),
  );
  report.movementStates = {
    shotsByMode: lab.shotsByMode,
    doubleJumpShots: doubleJump,
    reached: lab.reached,
    chains: states,
  };
  for (const state of ['SPRINT', 'SLIDE', 'AIR', 'WALLRUN', 'MANTLE'])
    assert(
      ((lab.shotsByMode as Record<string, number>)[state] ?? 0) > 0,
      `fired while ${state}`,
    );
  assert(doubleJump > 0, 'fired after a double jump');
  // 2. Foundry Row: ammo edge cases with normal ammo.
  await enter('/?solo=1', 'foundry-row');
  // The solo room persists across levels: normal ammo rules for this phase.
  assert(await devCheck('combat-infinite-ammo', false), 'infinite ammo off');
  assert(await devButton('REFILL AMMO'), 'refill');
  await page.waitForTimeout(400);
  const ammo = async (slot: number) =>
    (await combat()).state.ammo[slot] as { mag: number; reserve: number };
  const run = (input: Record<string, number>, ticks: number) =>
    chain([{ until: 'false', input, max: ticks }]);
  await run({ weapon: 0, pitch: 0.3 }, 40);
  for (let i = 0; i < 3; i++) {
    await run({ weapon: 0, buttons: F, pitch: 0.3 }, 1);
    await run({ weapon: 0, pitch: 0.3 }, 14);
  }
  const beforeReload = await ammo(0);
  assert.equal(beforeReload.mag, 9, 'three rounds fired');
  await run({ weapon: 0, buttons: R, pitch: 0.3 }, 1);
  await run({ weapon: 0, pitch: 0.3 }, 20);
  const midReload = (await combat()).state.reload as number;
  await run({ weapon: 1, pitch: 0.3 }, 30);
  await run({ weapon: 0, pitch: 0.3 }, 60);
  const afterSwitch = await ammo(0);
  // Empty the magazine: the last shot starts an automatic reload.
  for (let i = 0; i < afterSwitch.mag; i++) {
    await run({ weapon: 0, buttons: F, pitch: 0.3 }, 1);
    await run({ weapon: 0, pitch: 0.3 }, 11);
  }
  const emptied = await combat();
  await run({ weapon: 0, pitch: 0.3 }, 100);
  const reloaded = await ammo(0);
  report.ammo = {
    beforeReload,
    midReload,
    afterSwitch,
    emptied: { ammo: emptied.state.ammo[0], reload: emptied.state.reload },
    reloaded,
  };
  assert(midReload > 0, 'reload started');
  assert.deepEqual(
    afterSwitch,
    beforeReload,
    'switching cancelled the reload without loading',
  );
  assert.equal(emptied.state.ammo[0].mag, 0, 'magazine emptied');
  assert(emptied.state.reload > 0, 'empty magazine auto-reloads');
  assert.equal(reloaded.mag, 12, 'reloaded to a full magazine');
  assert.equal(
    reloaded.reserve,
    afterSwitch.reserve - 12,
    'reserve paid for the reload',
  );
  // Pickup: walk onto the entrance ammo crate (level ammo marker at 0, 0, 10).
  const reserveBefore = (await ammo(0)).reserve,
    oilBefore = (await combat()).state.oil as number;
  await goTo(0, 10.2, undefined, 0);
  await page.waitForTimeout(800);
  const reserveAfter = (await ammo(0)).reserve,
    oilAfter = (await combat()).state.oil as number;
  report.pickup = { reserveBefore, reserveAfter, oilBefore, oilAfter };
  assert(reserveAfter > reserveBefore, 'ammo crate refilled the reserve');
  // 3. Lag compensation via the dev panel sliders: 100 ms RTT + 20 ms jitter.
  const LAG = Number(process.env.LAG ?? 100),
    JITTER = Number(process.env.JITTER ?? 20);
  assert(await devRange('lag', LAG), 'latency slider');
  assert(await devRange('jitter', JITTER), 'jitter slider');
  assert(await devCheck('combat-infinite-ammo', true), 'infinite ammo');
  await page.waitForTimeout(300);
  // Tiny damage keeps the dummy alive (a dead dummy is untargetable while it resets).
  assert(await devRange('combat-damage', 0.1), 'damage multiplier');
  assert(await devButton('SPAWN TARGET DUMMY'), 'spawn dummy');
  assert(await devCheck('combat-moving-dummies', true), 'moving dummies');
  await page.waitForTimeout(1500);
  async function volley(label: string, shots: number) {
    const start = await combat();
    for (let i = 0; i < shots; i++) {
      // Aim at the dummy chest as rendered (the interpolated avatar position).
      const aim = await page.evaluate(() => {
        const l = Reflect.get(window, 'leviathan');
        const robot = (l.entities ?? []).find(
          (e: { type: string }) => e.type === 'robot',
        );
        const drawn = l.rendered.find(
          (r: { id: string }) => r.id === robot?.id,
        );
        if (!drawn) return null;
        const me = l.predicted.position,
          [x, y, z] = drawn.position as number[];
        const dx = x! - me.x,
          dz = z! - me.z,
          dy = y! + 1.0 - (me.y + 1.65);
        return {
          yaw: Math.atan2(-dx, -dz),
          pitch: Math.atan2(dy, Math.hypot(dx, dz)),
        };
      });
      if (!aim) continue;
      await page.evaluate((a) => {
        Reflect.get(window, 'leviathanTest').inject([
          { ticks: 1, yaw: a.yaw, pitch: a.pitch, buttons: 8, weapon: 0 },
          { ticks: 11, yaw: a.yaw, pitch: a.pitch, buttons: 0, weapon: 0 },
        ]);
      }, aim);
      await page.waitForTimeout(230);
    }
    await page.waitForTimeout(800);
    const end = await combat();
    const fired = (end.shotsFired as number) - (start.shotsFired as number),
      hits = (end.hitsConfirmed as number) - (start.hitsConfirmed as number);
    return {
      label,
      fired,
      hits,
      rate: Math.round((hits / Math.max(1, fired)) * 1000) / 10,
    };
  }
  assert(await devCheck('hitRays', true), 'hit debug events');
  await page.waitForTimeout(300);
  const on = await volley('lag compensation ON', 40);
  const rw = (await combat()).rewinds as {
    requested: number;
    applied: number;
  }[];
  report.rewinds = {
    n: rw.length,
    requestedMean:
      rw.reduce((s, r) => s + r.requested, 0) / Math.max(1, rw.length),
    requestedMax: Math.max(...rw.map((r) => r.requested)),
    appliedMean: rw.reduce((s, r) => s + r.applied, 0) / Math.max(1, rw.length),
  };
  console.log('REWINDS', JSON.stringify(report.rewinds));
  assert(await devCheck('combat-lag-compensation', false), 'lag comp off');
  await page.waitForTimeout(500);
  const off = await volley('lag compensation OFF', 40);
  await devCheck('combat-lag-compensation', true);
  report.lagCompensation = { latencyMs: LAG, jitterMs: JITTER, on, off };
  await devRange('combat-damage', 1);
  assert(on.rate >= 90, `compensated hit rate ${on.rate}%`);
  assert(on.rate > off.rate + 20, 'compensation clearly better than none');
  // 4. Dev tools: live stat edit, debug draw, hurt self.
  await devRange('lag', 0);
  await devRange('jitter', 0);
  await devCheck('combat-moving-dummies', false);
  // A fresh 200 HP dummy for the exact-damage check.
  assert(await devButton('CLEAR DUMMIES'), 'clear dummies');
  await page.waitForTimeout(300);
  assert(await devButton('SPAWN TARGET DUMMY'), 'fresh dummy');
  await page.waitForTimeout(1500);
  const dummyHealth = () =>
    page.evaluate(() => {
      const l = Reflect.get(window, 'leviathan');
      return (l.entities ?? []).find(
        (e: { type: string }) => e.type === 'robot',
      )?.health as number;
    });
  assert(await devRange('weapon-damage', 45), 'live damage slider (rivet)');
  await page.waitForTimeout(400);
  const hpBefore = await dummyHealth();
  const aimAt = await page.evaluate(() => {
    const l = Reflect.get(window, 'leviathan');
    const r = (l.entities ?? []).find(
      (e: { type: string }) => e.type === 'robot',
    );
    const me = l.predicted.position;
    const dx = r.position.x - me.x,
      dz = r.position.z - me.z,
      dy = r.position.y + 1 - (me.y + 1.65);
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    };
  });
  await page.evaluate((a) => {
    Reflect.get(window, 'leviathanTest').inject([
      { ticks: 1, yaw: a.yaw, pitch: a.pitch, buttons: 8, weapon: 0 },
      { ticks: 20, yaw: a.yaw, pitch: a.pitch, buttons: 0, weapon: 0 },
    ]);
  }, aimAt);
  await page.waitForTimeout(900);
  const hpAfter = await dummyHealth();
  assert(await devButton('RESET WEAPON STATS'), 'reset weapon stats');
  assert(await devCheck('hitboxes', true), 'hitbox overlay');
  await page.waitForTimeout(300);
  const overlay = await page.evaluate(
    () => !document.querySelector<HTMLCanvasElement>('#debug-draw')!.hidden,
  );
  await devCheck('hitboxes', false);
  await devCheck('hitRays', false);
  const healthBefore = (await combat()).health as number;
  assert(await devButton('HURT SELF (25)'), 'hurt self');
  await page.waitForTimeout(600);
  const healthAfter = (await combat()).health as number;
  report.devTools = {
    liveDamage: { hpBefore, hpAfter, dealt: hpBefore - hpAfter },
    debugOverlayVisible: overlay,
    hurtSelf: { healthBefore, healthAfter },
  };
  assert.equal(
    hpBefore - hpAfter,
    45,
    'live-edited damage applied by the server',
  );
  assert(overlay, 'debug draw overlay visible');
  assert.equal(healthBefore - healthAfter, 25, 'hurt self applied');
  report.errors = errors;
  assert.deepEqual(errors, [], 'no page errors');
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.failure = String(error);
  report.errors = errors;
  process.exitCode = 1;
} finally {
  await writeFile('docs/combat/browser.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
