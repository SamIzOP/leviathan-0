import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { INDUSTRIAL_FAMILIES } from '../packages/shared/src/forge-industrial';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    }),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5175/?gallery=1');
  await page.waitForFunction(() => Reflect.get(window, 'forgeGallery')?.ready);
  await page.getByLabel('Turntable', { exact: true }).uncheck();
  const results = [];
  for (const key of INDUSTRIAL_FAMILIES) {
    await page.getByLabel('Forge asset and variant').selectOption(`${key}:1`);
    await page.waitForTimeout(100);
    results.push(
      await page.evaluate(() => Reflect.get(window, 'forgeGallery')),
    );
    if (
      [
        'cooling-tower',
        'gas-holder',
        'ore-bridge',
        'freight-car',
        'curved-pipe',
        'rubble',
      ].includes(key)
    )
      await page.screenshot({ path: `docs/layout/after/gallery-${key}.png` });
  }
  const report = {
    pass: !errors.length && results.length === 26,
    variants: await page.locator('select option').count(),
    results,
    errors,
  };
  await writeFile('docs/layout/gallery.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
