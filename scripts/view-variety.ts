import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { getLevel } from '../packages/shared/src/level';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    }),
    level = getLevel();
  await page.addInitScript(() =>
    localStorage.setItem(
      'graphics',
      JSON.stringify({ quality: 'MEDIUM', grain: 0, bloom: 0.16 }),
    ),
  );
  await page.goto(
    (process.env.TEST_URL ?? 'http://localhost:5175') + '/?solo=1',
  );
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
    undefined,
    { timeout: 180000 },
  );
  await page.addStyleTag({
    content: '#app,#toast,#debug,#dev-panel{visibility:hidden}',
  });
  const images: { name: string; pixels: number[]; hist: number[] }[] = [],
    landmarks: unknown[] = [],
    failures: string[] = [];
  for (const zone of level.zones)
    for (const view of ['player', 'high']) {
      const name = `${zone.id}-${view}`;
      await page.evaluate(
        (n) => Reflect.get(window, 'leviathan').worldDebug.camera(n),
        name,
      );
      await page.waitForTimeout(500);
      const buffer = await page.screenshot();
      const sample = await page.evaluate(
        async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 36;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, 64, 36);
          const raw = ctx.getImageData(0, 0, 64, 36).data,
            pixels: number[] = [],
            hist = new Array<number>(16).fill(0);
          for (let i = 0; i < raw.length; i += 4) {
            const value =
              0.2126 * raw[i]! + 0.7152 * raw[i + 1]! + 0.0722 * raw[i + 2]!;
            pixels.push(value);
            hist[Math.min(15, Math.floor(value / 16))]!++;
          }
          return { pixels, hist };
        },
        `data:image/png;base64,${buffer.toString('base64')}`,
      );
      images.push({ name, ...sample });
    }
  const comparisons = [];
  for (let i = 0; i < images.length; i++)
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i]!,
        b = images[j]!,
        difference =
          a.pixels.reduce((s, p, k) => s + Math.abs(p - b.pixels[k]!), 0) /
          a.pixels.length;
      comparisons.push({
        a: a.name,
        b: b.name,
        meanPixelDifference: difference,
      });
      if (difference < 3)
        failures.push(`Indistinct views ${a.name}/${b.name}: ${difference}`);
    }
  for (const lm of level.landmarks!) {
    await page.evaluate(
      (n) => Reflect.get(window, 'leviathan').worldDebug.camera(n),
      `landmark-${lm.id}`,
    );
    await page.waitForTimeout(300);
    const evidence = await page.evaluate(
      (id) =>
        Reflect.get(window, 'leviathan')
          .worldDebug.landmarkVisibility()
          .find((l: { id: string }) => l.id === id),
      lm.id,
    );
    landmarks.push(evidence);
    if (
      !evidence?.visibleSamples ||
      evidence.distance < 150 ||
      evidence.distance > 250
    )
      failures.push(`Occluded or incorrectly spaced landmark ${lm.id}`);
  }
  const report = { pass: !failures.length, comparisons, landmarks, failures };
  await writeFile(
    'docs/layout/view-variety.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
