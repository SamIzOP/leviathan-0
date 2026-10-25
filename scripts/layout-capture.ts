import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
const phase = process.argv[2] ?? 'before',
  level = getLevel();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto((process.env.TEST_URL ?? 'http://localhost:5175') + '/?solo=1');
await page.waitForFunction(
  () => Reflect.get(window, 'leviathan')?.world?.ready,
  undefined,
  { timeout: 180000 },
);
await page.addStyleTag({
  content: '#app,#toast,#debug,#dev-panel{visibility:hidden}',
});
const shots = {
  ...level.cameras,
  ...(phase === 'before'
    ? {
        'utility-yard': {
          position: { x: 64, y: 1.65, z: 76 },
          target: { x: 87, y: 2, z: 20 },
        },
        boiler: {
          position: { x: -48, y: 1.65, z: -70 },
          target: { x: -78, y: 12, z: -62 },
        },
        pit: {
          position: { x: 0, y: 1.65, z: -45 },
          target: { x: 0, y: -2, z: -56 },
        },
        'roof-collision': {
          position: { x: -23, y: 16.3, z: 65 },
          target: { x: -18, y: 16, z: 66 },
        },
      }
    : {}),
};
await mkdir(`docs/layout/${phase}`, { recursive: true });
const report = [];
for (const [name, shot] of Object.entries(shots)) {
  await page.evaluate(
    ({ position, target }) =>
      Reflect.get(window, 'leviathan').worldDebug.view(position, target),
    shot,
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: `docs/layout/${phase}/${name}.png` });
  report.push({
    name,
    ...shot,
    stats: await page.evaluate(() => Reflect.get(window, 'leviathan').world),
  });
}
await writeFile(
  `docs/layout/${phase}/views.json`,
  JSON.stringify(report, null, 2),
);
console.log(`Captured ${report.length} views`);
await browser.close();
