import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { getLevel, type Level, type Vec3 } from '@leviathan/shared';
import { PRESETS, graphics, type Preset } from './graphics';
import { WorldMaterials } from './world-materials';
import { WorldWeather } from './world-weather';
import { WorldPost } from './world-post';
import { WorldAssets } from './world-assets';
import { GpuTimer } from './gpu-timer';
import { worldPalette } from './theme';
import { forgeAsset, type Primitive } from '../../shared/src/forge-data';
import { primitive, partMatrix, RECIPES } from './forge';
import { facadeDetails } from './building-visuals';
import { streetDetails } from './street-details';
import type { InputReader } from './input';
export class WorldView {
  gpu: GpuTimer;
  root = new T.Group();
  level: Level;
  materials: WorldMaterials;
  weather: WorldWeather;
  post = new WorldPost();
  assets: WorldAssets;
  geometries: T.BufferGeometry[] = [];
  extraMaterials: T.Material[] = [];
  environment?: T.WebGLRenderTarget;
  reflection: Reflector;
  sky: T.Mesh;
  mode = 'player';
  speed = 12;
  rain: number;
  fog: number;
  smoke = true;
  puddles = true;
  spawns = false;
  spawnGroup = new T.Group();
  preset: Preset;
  ready = false;
  disposed = false;
  started = performance.now();
  frames: number[] = [];
  calls: number[] = [];
  triangles = 0;
  drawCalls = 0;
  gpuMs: number | null = null;
  perfFrames: { ms: number; calls: number; triangles: number }[] = [];
  perfStarted = 0;
  perfReport: unknown;
  benchmark: number[] = [];
  slowSince = 0;
  autoChanges = 0;
  private last = performance.now();
  private lastStat = 0;
  private lamps: T.Sprite[] = [];
  private meshes: T.Object3D[] = [];
  private details: T.InstancedMesh[] = [];
  private propInstances = new Map<
    string,
    { mesh: T.InstancedMesh; index: number }[]
  >();
  private propWheels = new Map<string, T.Object3D[]>();
  constructor(
    public renderer: T.WebGLRenderer,
    public scene: T.Scene,
    id: string,
    seed?: number,
  ) {
    this.gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
    this.level = { ...getLevel(id), seed: seed ?? getLevel(id).seed };
    this.preset = graphics.quality === 'AUTO' ? 'MEDIUM' : graphics.quality;
    this.rain = this.level.weather.rain;
    this.fog = this.level.atmosphere.fog;
    const a = this.level.atmosphere,
      p = PRESETS[this.preset];
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = a.exposure;
    renderer.info.autoReset = false;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * p.scale);
    scene.fog = new T.FogExp2(a.horizon, this.fog);
    scene.background = null;
    this.materials = new WorldMaterials(
      p.texture,
      this.level.seed,
      a.heightFog,
      a.horizon,
    );
    this.assets = new WorldAssets(renderer);
    this.root.add(new T.HemisphereLight(a.sky, '#343a3c', 2.1));
    const light = new T.DirectionalLight('#bbc6cb', 0.65);
    light.position.set(-30, 70, 30);
    this.root.add(light);
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new T.Color(a.sky) },
        horizon: { value: new T.Color(a.horizon) },
      },
      vertexShader:
        'varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 dir;uniform vec3 zenith,horizon;void main(){vec3 d=normalize(dir);float band=sin(d.x*9.+d.z*13.+sin(d.y*25.))*sin(d.z*21.-d.y*7.);float h=smoothstep(-.08,.75,d.y);vec3 c=mix(horizon,zenith,h)+band*.018;float smokeWeight=exp(-pow((d.x-.22)*3.,2.)-pow((d.y-.16)*5.,2.))*.07;gl_FragColor=vec4(c-smokeWeight,1.);}`,
    });
    this.sky = new T.Mesh(new T.SphereGeometry(380, 32, 16), skyMat);
    this.geometries.push(this.sky.geometry);
    this.extraMaterials.push(skyMat);
    this.root.add(this.sky);
    const pmrem = new T.PMREMGenerator(renderer),
      envScene = new T.Scene();
    envScene.add(this.sky.clone());
    this.environment = pmrem.fromScene(envScene, 0.04, 0.1, 500);
    scene.environment = this.environment.texture;
    pmrem.dispose();
    this.post.material.uniforms.tint!.value.set(a.tint);
    this.build();
    this.weather = new WorldWeather(this.level, p.rain, p.smoke);
    this.root.add(this.weather.group);
    const roadGeo = new T.PlaneGeometry(12.8, 99);
    this.geometries.push(roadGeo);
    this.reflection = new Reflector(roadGeo, {
      textureWidth: Math.max(128, innerWidth / 2),
      textureHeight: Math.max(128, innerHeight / 2),
      color: 0x68757b,
      clipBias: 0.003,
      multisample: 0,
    });
    const reflective = this.reflection.material as T.ShaderMaterial;
    reflective.transparent = true;
    reflective.vertexShader =
      'varying vec2 puddleUv;\n' +
      reflective.vertexShader.replace(
        'void main() {',
        'void main() { puddleUv=uv;',
      );
    reflective.fragmentShader =
      'varying vec2 puddleUv;\n' +
      reflective.fragmentShader.replace(
        'gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',
        `float mask=sin(puddleUv.x*57.+sin(puddleUv.y*71.))*sin(puddleUv.y*99.+sin(puddleUv.x*37.));gl_FragColor=vec4(blendOverlay(base.rgb,color),smoothstep(-.05,.45,mask)*.55);`,
      );
    this.reflection.rotation.x = -Math.PI / 2;
    this.reflection.position.set(0, 0.022, 35);
    this.root.add(this.reflection);
    this.reflection.visible = this.preset === 'HIGH' && this.hasStreet;
    this.root.add(this.spawnGroup);
    scene.add(this.root);
    this.resize();
  }
  /** Street dressing and the road reflector belong to the street levels only. */
  get hasStreet() {
    return this.level.buildings.length > 0;
  }
  build() {
    if (this.hasStreet) {
      const street = streetDetails(this.level);
      this.root.add(...street.objects);
      this.geometries.push(...street.geometries);
      this.extraMaterials.push(...street.materials);
      this.materials.textures.push(street.texture);
    }
    const buckets = new Map<
      string,
      {
        kind: string;
        detail: boolean;
        material: T.Material;
        items: {
          position: Vec3;
          size: Vec3;
          source: string;
          rotation?: T.Quaternion;
        }[];
      }
    >();
    let source = '';
    let detail = false;
    const add = (
      kind: string,
      material: T.Material,
      position: Vec3,
      size: Vec3,
      rotation?: T.Quaternion,
    ) => {
      const key = `${kind}-${detail}-${material.uuid}-${Math.floor(position.x / 80)}-${Math.floor(position.z / 80)}`;
      let b = buckets.get(key);
      if (!b) {
        b = { kind, detail, material, items: [] };
        buckets.set(key, b);
      }
      b.items.push({ position, size, source, rotation });
    };
    const forge = (key: string, position: Vec3, size: Vec3, id: string) => {
      const variant = [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3;
      const asset = forgeAsset(key, variant, this.level.seed, 0);
      const bounds = new T.Box3();
      for (const part of asset.parts)
        bounds.union(
          new T.Box3(
            new T.Vector3(-0.5, -0.5, -0.5),
            new T.Vector3(0.5, 0.5, 0.5),
          ).applyMatrix4(partMatrix(part)),
        );
      const extent = bounds.getSize(new T.Vector3()),
        center = bounds.getCenter(new T.Vector3());
      const scale = new T.Vector3(
        size.x / extent.x,
        size.y / extent.y,
        size.z / extent.z,
      );
      const fit = new T.Matrix4()
        .makeTranslation(position.x, position.y, position.z)
        .multiply(new T.Matrix4().makeScale(scale.x, scale.y, scale.z))
        .multiply(
          new T.Matrix4().makeTranslation(-center.x, -center.y, -center.z),
        );
      for (const part of asset.parts) {
        const matrix = fit.clone().multiply(partMatrix(part));
        const p = new T.Vector3(),
          q = new T.Quaternion(),
          s = new T.Vector3();
        matrix.decompose(p, q, s);
        const recipe = RECIPES[part.recipe];
        detail = !!part.detail;
        add(
          part.shape,
          this.materials.get(recipe.surface, recipe.color),
          p,
          s,
          q,
        );
      }
      detail = false;
    };
    const shadow = new T.MeshBasicMaterial({
      color: '#151c20',
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.extraMaterials.push(shadow);
    for (const b of this.level.colliders) {
      if (b.clip) continue;
      source = b.prop ? b.id : '';
      const size = {
          x: b.max.x - b.min.x,
          y: b.max.y - b.min.y,
          z: b.max.z - b.min.z,
        },
        position = {
          x: (b.max.x + b.min.x) / 2,
          y: (b.max.y + b.min.y) / 2,
          z: (b.max.z + b.min.z) / 2,
        };
      const building = this.level.buildings.find((a) => a.id === b.id);
      const material = this.materials.get(
        building
          ? building.archetype % 5 === 2
            ? 'concrete'
            : building.archetype % 5 === 4
              ? 'metal'
              : 'brick'
          : b.surface,
        building
          ? building.side < 0
            ? ['#68635b', '#7b7b73', '#626b6e'][building.archetype % 3]
            : ['#41494a', '#555955', '#3d494e'][building.archetype % 3]
          : b.prop === 'prop.van'
            ? worldPalette.van
            : b.prop === 'prop.car'
              ? '#303b42'
              : b.id.startsWith('row-1')
                ? '#303a40'
                : b.id === 'pit-bottom'
                  ? '#293236'
                  : undefined,
      );
      if (b.prop) forge(b.prop, position, size, b.id);
      else add('box', material, position, size);
      if (b.min.y === 0 && b.max.y > 2)
        add(
          'box',
          shadow,
          { ...position, y: 0.025 },
          { ...size, x: size.x + 0.3, y: 0.01, z: size.z + 0.3 },
        );
    }
    const window = new T.MeshStandardMaterial({
      color: '#202d35',
      roughness: 0.82,
      metalness: 0,
      emissive: '#747260',
      emissiveIntensity: 0.035,
    });
    this.extraMaterials.push(window);
    source = '';
    for (const d of [...this.level.decor, ...facadeDetails(this.level)]) {
      source = d.prop ? d.id : '';
      if (d.prop) {
        forge(d.prop, d.position, d.size, d.id);
        continue;
      }
      detail =
        d.kind !== 'window' && Math.max(d.size.x, d.size.y, d.size.z) < 4;
      if (d.kind === 'haze') {
        const mat = new T.MeshBasicMaterial({
          color: this.level.atmosphere.horizon,
          transparent: true,
          opacity: 0.045,
          depthWrite: false,
          side: T.DoubleSide,
        });
        this.extraMaterials.push(mat);
        add('box', mat, d.position, d.size);
      } else
        add(
          d.kind === 'cylinder' ? 'cylinder' : 'box',
          d.kind === 'window' ? window : this.materials.get(d.surface, d.color),
          d.position,
          d.size,
          d.rotation
            ? new T.Quaternion().setFromEuler(
                new T.Euler(d.rotation.x, d.rotation.y, d.rotation.z),
              )
            : undefined,
        );
    }
    for (const b of buckets.values()) {
      const geo = primitive(b.kind as Primitive);
      this.geometries.push(geo);
      const mesh = new T.InstancedMesh(geo, b.material, b.items.length),
        m = new T.Matrix4(),
        q = new T.Quaternion();
      for (const [i, item] of b.items.entries()) {
        m.compose(
          new T.Vector3(item.position.x, item.position.y, item.position.z),
          item.rotation ?? q,
          new T.Vector3(item.size.x, item.size.y, item.size.z),
        );
        mesh.setMatrixAt(i, m);
        if (item.source)
          this.propInstances.set(item.source, [
            ...(this.propInstances.get(item.source) ?? []),
            { mesh, index: i },
          ]);
      }
      mesh.computeBoundingSphere();
      if (b.detail) this.details.push(mesh);
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!,
      g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(223,218,194,.5)');
    g.addColorStop(0.1, 'rgba(202,205,195,.15)');
    g.addColorStop(1, 'rgba(202,205,195,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const halo = new T.CanvasTexture(c);
    this.materials.textures.push(halo);
    for (const l of this.level.lights) {
      const mat = new T.SpriteMaterial({
        map: halo,
        transparent: true,
        depthWrite: false,
        color: '#b6b9ad',
      });
      this.extraMaterials.push(mat);
      const sprite = new T.Sprite(mat);
      sprite.position.set(l.position.x, l.position.y, l.position.z);
      sprite.scale.set(3, 3, 1);
      this.lamps.push(sprite);
      this.root.add(sprite);
    }
    const markerMat = new T.MeshBasicMaterial({
      color: '#aebdc5',
      wireframe: true,
    });
    this.extraMaterials.push(markerMat);
    for (const spawn of this.level.spawns) {
      const geo = new T.ConeGeometry(0.3, 1, 4);
      this.geometries.push(geo);
      const mesh = new T.Mesh(geo, markerMat);
      mesh.position.set(
        spawn.position.x,
        spawn.position.y + 1,
        spawn.position.z,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z = spawn.yaw;
      this.spawnGroup.add(mesh);
    }
  }
  async prepare(progress: (value: number) => void) {
    await this.assets.init();
    progress(0.35);
    const sky = await this.assets.sky();
    if (sky && !this.disposed) {
      const pmrem = new T.PMREMGenerator(this.renderer);
      this.environment?.dispose();
      this.environment = pmrem.fromEquirectangular(sky);
      this.scene.environment = this.environment.texture;
      this.scene.background = sky;
      this.scene.backgroundIntensity = 0.8;
      this.sky.visible = false;
      pmrem.dispose();
    }
    let count = 0;
    const entries = Object.entries(this.assets.manifest.textures);
    for (const [key, set] of entries) {
      if (
        !['asphalt', 'concrete', 'brick', 'metal', 'wood', 'glass'].includes(
          key,
        )
      )
        continue;
      const material = this.materials.get(
        key as Parameters<WorldMaterials['get']>[0],
      );
      for (const [channel, path] of Object.entries(set)) {
        const t = await this.assets.texture(path);
        if (t && !this.disposed) {
          for (const target of this.materials.materials.values()) {
            if (target !== material && target.userData.worldSurface !== key)
              continue;
            if (channel === 'albedo') {
              t.colorSpace = T.SRGBColorSpace;
              target.map = t;
            }
            if (channel === 'normal') {
              target.normalMap = t;
              target.bumpMap = null;
            }
            if (channel === 'roughness') target.roughnessMap = t;
            if (channel === 'ao') target.aoMap = t;
            target.needsUpdate = true;
          }
        }
      }
      progress(0.35 + (0.2 * ++count) / Math.max(1, entries.length));
    }
    // Replacement meshes have the exact authored collider footprint. Hide their
    // procedural instance only after a replacement has successfully loaded.
    for (const key of Object.keys(this.assets.manifest.models)) {
      const path = this.assets.manifest.models[key];
      if (!path) continue;
      const placements = [
        ...this.level.colliders.filter((b) => b.prop === key),
        ...this.level.decor
          .filter((d) => d.prop === key)
          .map((d) => ({
            id: d.id,
            surface: d.surface,
            wallRunnable: false,
            mantleable: false,
            climbable: false,
            platform: false,
            min: {
              x: d.position.x - d.size.x / 2,
              y: d.position.y - d.size.y / 2,
              z: d.position.z - d.size.z / 2,
            },
            max: {
              x: d.position.x + d.size.x / 2,
              y: d.position.y + d.size.y / 2,
              z: d.position.z + d.size.z / 2,
            },
          })),
      ];
      for (const box of placements) {
        const object = await this.assets.model(key, box);
        if (object && !this.disposed) {
          this.root.add(object);
          for (const { mesh, index } of this.propInstances.get(box.id) ?? []) {
            mesh.setMatrixAt(index, new T.Matrix4().makeScale(0, 0, 0));
            mesh.instanceMatrix.needsUpdate = true;
          }
          for (const wheel of this.propWheels.get(box.id) ?? [])
            wheel.visible = false;
        }
      }
    }
    if (!this.disposed) {
      progress(1);
      this.ready = true;
    }
  }
  resize() {
    const size = this.renderer.getDrawingBufferSize(new T.Vector2());
    this.post.resize(size.x, size.y);
    this.reflection
      ?.getRenderTarget()
      .setSize(Math.max(128, size.x / 2), Math.max(128, size.y / 2));
  }
  cameraView(name: string, camera: T.PerspectiveCamera) {
    this.mode = name;
    camera.fov = name === 'composition' ? 84 : 75;
    camera.updateProjectionMatrix();
    const shot = this.level.cameras[name];
    if (shot) {
      camera.position.set(shot.position.x, shot.position.y, shot.position.z);
      camera.lookAt(shot.target.x, shot.target.y, shot.target.z);
    }
    if (name === 'perf') {
      this.perfStarted = performance.now();
      this.perfFrames = [];
      this.perfReport = undefined;
    }
  }
  control(input: InputReader, camera: T.PerspectiveCamera, elapsed: number) {
    if (this.mode !== 'free' || !input.active) return;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(input.pitch, input.yaw, 0);
    const velocity = new T.Vector3(
      Number(input.keys.has('KeyD')) - Number(input.keys.has('KeyA')),
      Number(input.keys.has('Space')) - Number(input.keys.has('ControlLeft')),
      Number(input.keys.has('KeyS')) - Number(input.keys.has('KeyW')),
    );
    velocity
      .normalize()
      .multiplyScalar((this.speed * elapsed) / 1000)
      .applyEuler(camera.rotation);
    camera.position.add(velocity);
  }
  render(camera: T.PerspectiveCamera) {
    const now = performance.now(),
      ms = now - this.last;
    this.last = now;
    const time = (now - this.started) / 1000;
    if (this.mode === 'perf') {
      const path = [
          'composition',
          'van',
          'containers',
          'stacks',
          'hall',
          'puddle',
          'spawn',
        ],
        t =
          Math.min(0.99999, (now - this.perfStarted) / 60000) *
          (path.length - 1),
        i = Math.floor(t),
        a = this.level.cameras[path[i]!]!,
        b = this.level.cameras[path[i + 1]!]!,
        alpha = t - i;
      camera.position.set(
        T.MathUtils.lerp(a.position.x, b.position.x, alpha),
        T.MathUtils.lerp(a.position.y, b.position.y, alpha),
        T.MathUtils.lerp(a.position.z, b.position.z, alpha),
      );
      camera.lookAt(
        T.MathUtils.lerp(a.target.x, b.target.x, alpha),
        T.MathUtils.lerp(a.target.y, b.target.y, alpha),
        T.MathUtils.lerp(a.target.z, b.target.z, alpha),
      );
    }
    this.sky.position.copy(camera.position);
    for (const mesh of this.details)
      mesh.visible =
        !mesh.boundingSphere ||
        camera.position.distanceTo(mesh.boundingSphere.center) <
          (this.preset === 'LOW' ? 55 : 90) + mesh.boundingSphere.radius;
    for (const m of this.materials.materials.values()) {
      m.envMapIntensity = this.puddles ? 1 : 0.05;
      if (m.userData.heightDensity)
        m.userData.heightDensity.value =
          this.level.atmosphere.heightFog *
          (this.fog / this.level.atmosphere.fog);
    }
    (this.scene.fog as T.FogExp2).density = this.fog;
    this.spawnGroup.visible = this.spawns;
    this.reflection.visible =
      this.preset === 'HIGH' &&
      this.puddles &&
      this.hasStreet &&
      camera.position.z > 0;
    this.weather.update(time, camera, this.rain, this.smoke);
    this.lamps.forEach(
      (l, i) =>
        (l.material.opacity = 0.85 + 0.15 * Math.sin(time * 0.7 + i * 4)),
    );
    this.renderer.info.reset();
    this.gpu.begin();
    this.post.render(
      this.renderer,
      this.scene,
      camera,
      time,
      PRESETS[this.preset].ao,
      this.preset === 'HIGH',
    );
    this.gpu.end();
    this.gpuMs = this.gpu.ms;
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;
    if (this.ready) {
      this.frames.push(ms);
      if (this.frames.length > 180) this.frames.shift();
      this.calls.push(this.drawCalls);
      if (this.calls.length > 180) this.calls.shift();
      if (graphics.quality === 'AUTO' && this.mode !== 'perf') {
        this.benchmark.push(this.gpuMs ?? ms);
        if (this.benchmark.length === 90) {
          const avg = this.benchmark.reduce((a, b) => a + b, 0) / 90;
          if (avg > 23) this.changePreset('LOW');
        }
        const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
        if (avg > 21 && this.frames.length >= 60) {
          if (!this.slowSince) this.slowSince = now;
          if (now - this.slowSince > 3000) {
            this.changePreset(this.preset === 'HIGH' ? 'MEDIUM' : 'LOW');
            this.slowSince = now;
          }
        } else this.slowSince = 0;
      }
      if (this.mode === 'perf' && !this.perfReport) {
        this.perfFrames.push({
          ms,
          calls: this.drawCalls,
          triangles: this.triangles,
        });
        if (now - this.perfStarted >= 60000) {
          const samples = this.perfFrames;
          this.perfReport = {
            preset: this.preset,
            durationMs: now - this.perfStarted,
            frames: samples.length,
            averageMs: samples.reduce((s, f) => s + f.ms, 0) / samples.length,
            worstMs: Math.max(...samples.map((f) => f.ms)),
            drawCalls: Math.max(...samples.map((f) => f.calls)),
            triangles: Math.max(...samples.map((f) => f.triangles)),
            gpuMs: this.gpuMs,
          };
          console.log('LEVIATHAN_PERF', JSON.stringify(this.perfReport));
          void fetch('/__world-perf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.perfReport),
          }).catch(() => {});
        }
      }
    }
    if (now - this.lastStat > 500) {
      this.lastStat = now;
      const readout = document.querySelector('#world-stats');
      if (readout) readout.textContent = JSON.stringify(this.stats(), null, 2);
    }
  }
  changePreset(preset: Preset) {
    if (this.preset === preset) return;
    this.preset = preset;
    this.autoChanges++;
    const p = PRESETS[preset];
    if (p.texture !== this.materials.size) {
      const old = this.materials,
        next = new WorldMaterials(
          p.texture,
          this.level.seed,
          this.level.atmosphere.heightFog,
          this.level.atmosphere.horizon,
        ),
        replacements = new Map<T.Material, T.Material>();
      for (const material of old.materials.values()) {
        const replacement = next.get(
          material.userData.worldSurface,
          material.userData.worldColor,
        );
        for (const channel of [
          'map',
          'normalMap',
          'roughnessMap',
          'aoMap',
        ] as const)
          if (
            material[channel] &&
            this.assets.textures.includes(material[channel]!)
          )
            replacement[channel] = material[channel];
        if (replacement.normalMap) replacement.bumpMap = null;
        replacements.set(material, replacement);
      }
      this.root.traverse((o) => {
        if (o instanceof T.Mesh)
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => replacements.get(m) ?? m)
            : (replacements.get(o.material) ?? o.material);
      });
      // Halos are not procedural surface maps and stay alive until world disposal.
      const haloMaps = new Set(this.lamps.map((l) => l.material.map));
      const retained = old.textures.filter(
        (t) => haloMaps.has(t) || t.userData.persistentWorld,
      );
      old.textures = old.textures.filter(
        (t) => !haloMaps.has(t) && !t.userData.persistentWorld,
      );
      next.textures.push(...retained);
      old.dispose();
      this.materials = next;
    }
    this.root.remove(this.weather.group);
    this.weather.dispose();
    this.weather = new WorldWeather(this.level, p.rain, p.smoke);
    this.root.add(this.weather.group);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * p.scale);
    this.renderer.setSize(innerWidth, innerHeight);
    this.resize();
  }
  stats() {
    return {
      preset: this.preset,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      textureMiB:
        Math.round(
          (this.materials.textures.reduce(
            (sum, t) =>
              sum + (t.image?.width ?? 0) * (t.image?.height ?? 0) * 4 * 1.33,
            0,
          ) /
            1048576) *
            10,
        ) / 10,
      gpuMs: this.gpuMs,
      frameMs: this.frames.length
        ? this.frames.reduce((a, b) => a + b) / this.frames.length
        : 0,
      particles: PRESETS[this.preset].rain + PRESETS[this.preset].smoke + 78,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      mode: this.mode,
      ready: this.ready,
      loadedAt: this.started,
      level: this.level.id,
      assets: this.assets.status,
    };
  }
  dispose() {
    this.disposed = true;
    this.gpu.dispose();
    this.scene.remove(this.root);
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.fog = null;
    this.assets.dispose();
    this.weather.dispose();
    this.post.dispose();
    this.reflection.dispose();
    this.environment?.dispose();
    this.materials.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.extraMaterials.forEach((m) => m.dispose());
    this.root.clear();
    this.renderer.renderLists.dispose();
  }
}
