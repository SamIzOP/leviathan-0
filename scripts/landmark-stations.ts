import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
const level = getLevel(),
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--enable-unsafe-swiftshader'],
  });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await page.goto('http://localhost:5175/?solo=1');
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
    undefined,
    { timeout: 180000 },
  );
  const views: Record<string, unknown> = {};
  for (const lm of level.landmarks!) {
    let found = false;
    for (const y of [1.65, 18, 28, 42]) {
      if (found) break;
      for (let a = 0; a < 32; a++) {
        const position = {
            x: lm.position.x + 165 * Math.cos((a * Math.PI) / 16),
            y,
            z: lm.position.z + 165 * Math.sin((a * Math.PI) / 16),
          },
          target = { x: lm.position.x, y: lm.height * 0.7, z: lm.position.z };
        if (
          position.x < -204 ||
          position.x > 204 ||
          position.z < -244 ||
          position.z > 84
        )
          continue;
        if (
          level.colliders.some(
            (c) =>
              position.x > c.min.x - 0.4 &&
              position.x < c.max.x + 0.4 &&
              position.z > c.min.z - 0.4 &&
              position.z < c.max.z + 0.4 &&
              y > c.min.y - 1.8 &&
              y < c.max.y,
          )
        )
          continue;
        await page.evaluate(
          (s) =>
            Reflect.get(window, 'leviathan').worldDebug.view(
              s.position,
              s.target,
            ),
          { position, target },
        );
        await page.waitForTimeout(35);
        const evidence = await page.evaluate(
          (id) =>
            Reflect.get(window, 'leviathan').worldDebug.landmarkVisibility(
              id,
            )[0],
          lm.id,
        );
        if (evidence.visibleSamples >= (lm.id === 'vesper-furnace' ? 1 : 3)) {
          views[`landmark-${lm.id}`] = { position, target };
          found = true;
          console.log(
            lm.id,
            JSON.stringify({ position, visible: evidence.visibleSamples }),
          );
          break;
        }
      }
    }
    if (!found) console.log('NO STATION', lm.id);
  }
  await writeFile(
    'docs/layout/landmark-stations.json',
    JSON.stringify(views, null, 2),
  );
} finally {
  await browser.close();
}
