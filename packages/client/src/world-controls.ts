import type { DevPanel } from './dev-panel';
import type { Renderer } from './renderer';
import type { InputReader } from './input';
import { graphicsControls } from './graphics';
export function worldControls(
  panel: DevPanel,
  renderer: Renderer,
  input: InputReader,
  close: () => void,
) {
  const section = panel.section('WORLD / LOOK');
  for (const [label, mode] of [
    ['COMPOSITION CAMERA', 'composition'],
    ['PLAYER CAMERA', 'player'],
    ['FREE-FLY CAMERA', 'free'],
  ] as const)
    section.append(
      panel.button(
        label,
        'Inspect the environment; the player stays in place.',
        () => {
          const world = renderer.world;
          if (!world) return;
          world.cameraView(mode, renderer.camera);
          input.yaw = renderer.camera.rotation.y;
          input.pitch = renderer.camera.rotation.x;
          close();
        },
      ),
    );
  panel.slider(
    section,
    'FREE-FLY SPEED',
    'fly-speed',
    2,
    40,
    1,
    12,
    'Metres per second. Space rises; Ctrl descends.',
    (v) => {
      if (renderer.world) renderer.world.speed = v;
    },
  );
  panel.slider(
    section,
    'FOG DENSITY',
    'fog',
    0,
    0.04,
    0.001,
    0.013,
    'Distance fog density.',
    (v) => {
      if (renderer.world) renderer.world.fog = v;
    },
  );
  panel.slider(
    section,
    'RAIN INTENSITY',
    'rain',
    0,
    1,
    0.05,
    0.65,
    'Rain and ripple intensity.',
    (v) => {
      if (renderer.world) renderer.world.rain = v;
    },
  );
  for (const [label, key] of [
    ['SMOKE', 'smoke'],
    ['PUDDLE REFLECTION', 'puddles'],
    ['SPAWN POINTS', 'spawns'],
  ] as const)
    panel.checkbox(
      section,
      label,
      'Local environment preview.',
      key,
      key !== 'spawns',
      (v) => {
        if (renderer.world) renderer.world[key] = v;
      },
    );
  for (const key of [
    'ao',
    'bloom',
    'grain',
    'vignette',
    'softness',
    'aberration',
    'grade',
    'droplets',
  ] as const)
    panel.checkbox(
      section,
      key.toUpperCase(),
      'Local rendering effect.',
      key,
      true,
      (v) => {
        if (renderer.world) renderer.world.post.effects[key] = v;
      },
    );
  panel.slider(
    section,
    'HDRI EXPOSURE',
    'exposure',
    0.3,
    1.6,
    0.05,
    0.95,
    'Exposure for procedural or imported sky.',
    (v) => {
      renderer.renderer.toneMappingExposure = v;
    },
  );
  const tintLabel = document.createElement('label');
  tintLabel.textContent = 'SKY / ENVIRONMENT TINT';
  const tint = document.createElement('input');
  tint.type = 'color';
  tint.value = '#aebdc5';
  tint.setAttribute('aria-label', 'Sky tint');
  tint.oninput = () =>
    renderer.world?.post.material.uniforms.tint!.value.set(tint.value);
  tintLabel.append(tint);
  section.append(tintLabel);
  section.append(graphicsControls());
  const stats = document.createElement('pre');
  stats.id = 'world-stats';
  section.append(stats);
}
