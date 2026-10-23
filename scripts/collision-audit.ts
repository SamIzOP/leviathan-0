import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { getLevel } from '../packages/shared/src/level';
import {
  boundsAudit,
  wallWalkAudit,
} from '../packages/shared/src/collision-audit';
const level = getLevel(),
  bounds = boundsAudit(level),
  walk = wallWalkAudit(level);
console.log(
  JSON.stringify(
    { bounds: bounds.slice(0, 30), boundsCount: bounds.length, walk },
    null,
    2,
  ),
);
await mkdir('docs/layout', { recursive: true });
let sweep: unknown;
if (!process.argv.includes('--data-only')) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(
      (process.env.TEST_URL ?? 'http://localhost:5175') + '/?solo=1',
    );
    await page.waitForFunction(
      () => Reflect.get(window, 'leviathan')?.world?.ready,
      undefined,
      { timeout: 180000 },
    );
    sweep = await page.evaluate(() =>
      Reflect.get(window, 'leviathan').worldDebug.collisionAudit(),
    );
  } finally {
    await browser.close();
  }
}
await writeFile(
  'docs/layout/collision-audit.json',
  JSON.stringify({ bounds, walk, sweep }, null, 2),
);
const mismatches =
  (sweep as { mismatches?: unknown[] } | undefined)?.mismatches?.length ?? 0;
console.log(
  JSON.stringify({
    bounds: bounds.length,
    walk: walk.errors.length,
    sweepMismatches: mismatches,
  }),
);
if (bounds.length || walk.errors.length || mismatches) process.exitCode = 1;
