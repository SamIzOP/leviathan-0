import './style.css';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FORGE_CATALOG, forgeAsset } from '../../shared/src/forge-data';
import { forgeModel, disposeForge, triangleCount, RECIPES } from './forge';
import { WorldMaterials } from './world-materials';
import { applyTheme } from './theme';
export function startGallery() {
  applyTheme();
  document.body.dataset.phase = 'GALLERY';
  const canvas = document.querySelector<HTMLCanvasElement>('#arena')!;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const scene = new T.Scene();
  scene.background = new T.Color('#192026');
  scene.fog = new T.Fog('#192026', 70, 200);
  const studio = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.04);
  scene.environment = environment.texture;
  studio.dispose();
  pmrem.dispose();
  addEventListener('pagehide', () => environment.dispose(), { once: true });
  scene.add(new T.HemisphereLight('#b9c7cf', '#262c31', 2.8));
  const sun = new T.DirectionalLight('#c1ced4', 2);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  const camera = new T.PerspectiveCamera(
    50,
    innerWidth / innerHeight,
    0.05,
    500,
  );
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  const stage = new T.Group();
  scene.add(stage);
  const grid = new T.GridHelper(100, 100, '#4b5a64', '#28353e');
  scene.add(grid);
  const reference = new T.Mesh(
    new T.CapsuleGeometry(0.25, 1.3, 4, 8),
    new T.MeshStandardMaterial({ color: '#aab8bd', roughness: 0.9 }),
  );
  reference.position.set(-3, 0.9, 0);
  scene.add(reference);
  const materials = new WorldMaterials(512, 71017, 0.004, '#192026');
  const app = document.querySelector<HTMLElement>('#app')!;
  app.replaceChildren();
  const panel = document.createElement('section');
  panel.className = 'slab forge-gallery';
  panel.innerHTML =
    '<div class="eyebrow">KAINOS // MODEL FORGE</div><h2>ASSET GALLERY</h2><p>METRES // 1.8 M HUMAN REFERENCE</p>';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Forge asset and variant');
  for (const key of FORGE_CATALOG)
    for (let variant = 0; variant < 3; variant++) {
      const option = new Option(
        `${key.toUpperCase()} / ${variant + 1}`,
        `${key}:${variant}`,
      );
      select.add(option);
    }
  const seed = document.createElement('input');
  seed.type = 'number';
  seed.value = '71017';
  seed.setAttribute('aria-label', 'Forge seed');
  const readout = document.createElement('pre');
  readout.className = 'forge-readout';
  const wire = document.createElement('input');
  wire.type = 'checkbox';
  wire.setAttribute('aria-label', 'Wireframe');
  const collider = document.createElement('input');
  collider.type = 'checkbox';
  collider.setAttribute('aria-label', 'Collider overlay');
  const turn = document.createElement('input');
  turn.type = 'checkbox';
  turn.checked = true;
  turn.setAttribute('aria-label', 'Turntable');
  for (const [label, input] of [
    ['WIREFRAME', wire],
    ['COLLIDERS', collider],
    ['TURNTABLE', turn],
  ] as const) {
    const row = document.createElement('label');
    row.textContent = label;
    row.append(input);
    panel.append(row);
  }
  panel.append(select, seed, readout);
  app.append(panel);
  const overlay = new T.Group();
  stage.add(overlay);
  let model: T.Group | undefined,
    turnAt = performance.now();
  const load = () => {
    if (model) {
      stage.remove(model);
      disposeForge(model);
    }
    overlay.children.forEach((o) => {
      if (o instanceof T.Box3Helper) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
    overlay.clear();
    const [key, variantText] = select.value.split(':'),
      variant = Number(variantText),
      value = Number(seed.value) || 71017;
    const data = forgeAsset(key!, variant, value);
    model = forgeModel(key!, variant, value);
    model.traverse((o) => {
      if (o instanceof T.Mesh) {
        const old = o.material as T.MeshStandardMaterial;
        const recipe = RECIPES[old.userData.recipe as keyof typeof RECIPES];
        const shared = materials.get(recipe.surface, recipe.color);
        const material = shared.clone();
        material.wireframe = wire.checked;
        old.dispose();
        o.material = material;
      }
    });
    stage.add(model);
    stage.rotation.y = 0;
    const bounds = new T.Box3().setFromObject(model),
      size = bounds.getSize(new T.Vector3()),
      center = bounds.getCenter(new T.Vector3());
    for (const b of data.colliders) {
      const helper = new T.Box3Helper(
        new T.Box3(
          new T.Vector3(b.min.x, b.min.y, b.min.z),
          new T.Vector3(b.max.x, b.max.y, b.max.z),
        ),
        0x91b0ba,
      );
      overlay.add(helper);
    }
    overlay.visible = collider.checked;
    const distance = Math.max(size.x, size.y, size.z, 4) * 1.7;
    camera.position.set(distance * 0.75, center.y + distance * 0.45, distance);
    controls.target.copy(center);
    reference.position.x = bounds.min.x - 1;
    readout.textContent = `${data.serial}\n${triangleCount(model).toLocaleString()} TRIANGLES\n${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} M\n${FORGE_CATALOG.length} ASSETS / ${FORGE_CATALOG.length * 3} VARIANTS`;
    (window as unknown as { forgeGallery: unknown }).forgeGallery = {
      ready: true,
      key,
      variant,
      seed: value,
      triangles: triangleCount(model),
      count: FORGE_CATALOG.length,
    };
  };
  select.onchange = seed.onchange = load;
  wire.onchange = () =>
    model?.traverse((o) => {
      if (o instanceof T.Mesh)
        (o.material as T.MeshStandardMaterial).wireframe = wire.checked;
    });
  collider.onchange = () => {
    overlay.visible = collider.checked;
  };
  load();
  // Three neighbouring catalog pieces give useful real-world scale context.
  for (const [i, key] of ['crate', 'barrel', 'gas-cylinder'].entries()) {
    const prop = forgeModel(key, i);
    prop.position.set(4 + i * 2, 0, -3);
    scene.add(prop);
  }
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  const frame = () => {
    const now = performance.now();
    if (turn.checked) stage.rotation.y += (now - turnAt) * 0.00012;
    turnAt = now;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();
}
