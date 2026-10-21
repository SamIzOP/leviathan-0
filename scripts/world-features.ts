import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { missionLevel } from '@leviathan/shared';
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
  Element.prototype.requestPointerLock = () =>
    Promise.reject(new DOMException('Embedded browser', 'UnknownError'));
  localStorage.setItem('graphics', JSON.stringify({ quality: 'LOW' }));
});
const page = await context.newPage(),
  errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const base = process.env.TEST_URL ?? 'http://localhost:5173';
try {
  await page.goto(base + '/?solo=1');
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
  );
  const before = await page.evaluate(() => Reflect.get(window, 'leviathan'));
  await page
    .getByRole('button', { name: 'CLICK TO CAPTURE MOUSE', exact: true })
    .click();
  await page.evaluate(() =>
    Reflect.get(window, 'leviathan').worldDebug.camera('free'),
  );
  await page.keyboard.down('w');
  await page.waitForTimeout(650);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => Reflect.get(window, 'leviathan'));
  assert.deepEqual(
    after.predicted.position,
    before.predicted.position,
    'Free camera moved player',
  );
  await page.reload();
  await page.waitForFunction(
    () => Reflect.get(window, 'leviathan')?.world?.ready,
  );
  const resumed = await page.evaluate(() => Reflect.get(window, 'leviathan'));
  assert.equal(resumed.playerId, before.playerId);
  assert.equal(resumed.world.level, before.world.level);
  await page.keyboard.press('Escape');
  const wave = Buffer.alloc(44 + 16000);
  wave.write('RIFF');
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(16000, 40);
  for (let i = 0; i < 8000; i++)
    wave.writeInt16LE(Math.round(Math.sin(i * 0.05) * 600), 44 + i * 2);
  await page.route('**/assets/audio/verification.wav', (r) =>
    r.fulfill({ contentType: 'audio/wav', body: wave }),
  );
  const audio = await page.evaluate(async (level) => {
    const audioPath = '/src/audio.ts',
      worldPath = '/src/world-audio.ts';
    const { AudioManager } = await import(audioPath),
      { WorldAudio } = await import(worldPath);
    const audio = new AudioManager();
    await audio.unlock();
    const world = new WorldAudio(audio, level);
    await world.start();
    world.update({ x: 40, y: 1, z: -30 });
    await new Promise((r) => setTimeout(r, 1800));
    const interiorHz = world.filter.frequency.value,
      roofGain = world.roof.gain.value;
    world.update({ x: 0, y: 0, z: 50 });
    for (const surface of ['asphalt', 'metal', 'wood', 'concrete']) {
      const box = level.colliders.find((b) => b.surface === surface)!;
      world.footstep({
        x: (box.min.x + box.max.x) / 2,
        y: box.max.y,
        z: (box.min.z + box.max.z) / 2,
      });
    }
    await new Promise((r) => setTimeout(r, 1800));
    const exteriorHz = world.filter.frequency.value,
      events = { ...audio.events },
      sources = world.sources.length;
    audio.volume('sfx', 0.2);
    const busGain = audio.gains.sfx.gain.value;
    world.dispose();
    const remaining = world.nodes.length + world.sources.length;
    const real = new WorldAudio(audio, level);
    await real.loading;
    real.manifest = { 'ambience.rain': '/assets/audio/verification.wav' };
    await real.start();
    for (let i = 0; i < 100 && audio.assetsPlayed === 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    const assetsPlayed = audio.assetsPlayed;
    real.dispose();
    await audio.context.close();
    return {
      interiorHz,
      exteriorHz,
      roofGain,
      events,
      sources,
      busGain,
      remaining,
      assetsPlayed,
    };
  }, missionLevel(0));
  assert.ok(
    audio.interiorHz < 700 && audio.exteriorHz > 3400 && audio.roofGain > 0.05,
  );
  for (const surface of ['asphalt', 'metal', 'wood', 'concrete'])
    assert.ok(audio.events['footstep.' + surface] > 0);
  assert.ok(audio.events.splash > 0 && audio.sources >= 6);
  assert.equal(audio.remaining, 0);
  assert.equal(audio.assetsPlayed, 1);
  assert.ok(Math.abs(audio.busGain - 0.2) < 0.001);
  const vertices = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1,
    -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0,
    4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  const data = Buffer.concat([
    Buffer.from(vertices.buffer),
    Buffer.from(indices.buffer),
  ]);
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [
      {
        uri: 'data:application/octet-stream;base64,' + data.toString('base64'),
        byteLength: data.length,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.byteLength },
      {
        buffer: 0,
        byteOffset: vertices.byteLength,
        byteLength: indices.byteLength,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: [-1, -1, -1],
        max: [1, 1, 1],
      },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  await page.route('**/assets/models/verification.gltf', (r) =>
    r.fulfill({ contentType: 'model/gltf+json', body: JSON.stringify(gltf) }),
  );
  const asset = await page.evaluate(
    async (box) => {
      const assetPath = '/src/world-assets.ts',
        threePath = '/node_modules/.vite/deps/three.js';
      const { WorldAssets } = await import(assetPath),
        T = await import(threePath);
      const renderer = new T.WebGLRenderer();
      const assets = new WorldAssets(renderer);
      assets.manifest = {
        models: { 'prop.crate': '/assets/models/verification.gltf' },
        textures: {},
        hdri: [],
        audio: {},
      };
      const object = await assets.model('prop.crate', box),
        bounds = new T.Box3().setFromObject(object);
      const result = {
        status: assets.status,
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
      };
      assets.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      return result;
    },
    missionLevel(0).colliders.find((b) => b.prop === 'prop.crate')!,
  );
  const collider = missionLevel(0).colliders.find(
    (b) => b.prop === 'prop.crate',
  )!;
  assert.deepEqual(asset.min, Object.values(collider.min));
  assert.deepEqual(asset.max, Object.values(collider.max));
  assert.equal(asset.status['prop.crate'], '/assets/models/verification.gltf');
  assert.deepEqual(errors, []);
  await writeFile(
    'docs/perf/world-features.json',
    JSON.stringify(
      {
        pass: true,
        freeCameraPlayerStationary: true,
        reconnectIdentityAndLevel: true,
        audio,
        asset,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('PASS world features', audio, asset);
} finally {
  await browser.close();
}
