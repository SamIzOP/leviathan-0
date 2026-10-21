import * as T from 'three';
import { randomSeed, inside, type Level } from '@leviathan/shared';
export class WorldWeather {
  group = new T.Group();
  materials: T.ShaderMaterial[] = [];
  geometries: T.BufferGeometry[] = [];
  textures: T.Texture[] = [];
  rain: T.InstancedMesh;
  smoke: T.InstancedMesh;
  ripples: T.InstancedMesh;
  steam: T.InstancedMesh;
  constructor(
    public level: Level,
    rainCount: number,
    smokeCount: number,
  ) {
    const rng = randomSeed(level.seed + 99);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d')!,
      g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,.65)');
    g.addColorStop(0.45, 'rgba(255,255,255,.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    c.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 120; i++) {
      c.fillStyle = `rgba(80,80,80,${rng() * 0.12})`;
      c.beginPath();
      c.arc(rng() * 128, rng() * 128, 4 + rng() * 13, 0, 7);
      c.fill();
    }
    const cloud = new T.CanvasTexture(canvas);
    this.textures.push(cloud);
    const make = (count: number, type: number) => {
      const geo = new T.PlaneGeometry(1, 1);
      this.geometries.push(geo);
      const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        uniforms: {
          time: { value: 0 },
          type: { value: type },
          cameraPos: { value: new T.Vector3() },
          density: { value: level.weather.rain },
          wind: {
            value: new T.Vector3(level.weather.wind.x, 0, level.weather.wind.z),
          },
          cloud: { value: cloud },
          fogColor: { value: new T.Color(level.atmosphere.horizon) },
        },
        vertexShader: `
      uniform float time,type;uniform vec3 cameraPos,wind;varying vec2 vUv;varying float age,dist;
      void main(){vUv=uv;vec3 p=instanceMatrix[3].xyz;float seed=instanceMatrix[0][0];age=fract(seed+time*.026);
        vec2 size=vec2(1.);
        if(type<.5){p.y=mod(p.y-time*17.,26.)-4.;p.x+=sin(time*.5+seed)*.2;p+=cameraPos;size=vec2(.018,.7);}
        else if(type<1.5){p+=vec3(age*65.,age*25.,age*5.);size=vec2(8.+age*25.);}
        else if(type<2.5){p+=vec3(cameraPos.x,0.,cameraPos.z);p.xz=floor(p.xz*.5)*2.;p.y=.03;size=vec2(.35+age*.7);}
        else {p+=vec3(age*2.,age*3.,0.);size=vec2(.6+age*2.);}
        vec4 mv=viewMatrix*vec4(p,1.);dist=length(mv.xyz);
        if(type>1.5&&type<2.5){p+=vec3(position.x*size.x,0.,position.y*size.y);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}
        else {mv.xy+=position.xy*size; if(type<.5)mv.x+=position.y*.10;gl_Position=projectionMatrix*mv;}
      }`,
        fragmentShader: `uniform float type,density;uniform sampler2D cloud;uniform vec3 fogColor;varying vec2 vUv;varying float age,dist;
      void main(){float a;vec3 color;
        if(type<.5){a=.17*density*(1.-abs(vUv.y-.5)*2.);color=vec3(.7,.76,.79);}
        else if(type<1.5){a=texture2D(cloud,vUv).a*(1.-smoothstep(.55,1.,age))*.55;color=vec3(.19,.22,.24);}
        else if(type<2.5){float r=length(vUv-.5);a=(1.-smoothstep(.012,.035,abs(r-age*.45)))*(1.-age)*density*.3;color=vec3(.7,.75,.78);}
        else {a=texture2D(cloud,vUv).a*(1.-age)*.3;color=vec3(.7,.73,.73);}
        gl_FragColor=vec4(mix(color,fogColor,1.-exp(-dist*.006)),a);}
      `,
      });
      this.materials.push(mat);
      const mesh = new T.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      const matrix = new T.Matrix4();
      for (let i = 0; i < count; i++) {
        const p =
          type === 0
            ? new T.Vector3((rng() - 0.5) * 65, rng() * 26, (rng() - 0.5) * 65)
            : type === 1
              ? new T.Vector3([-10, 0, 10][i % 3]!, 83.6 + (i % 3) * 15, -12)
              : type === 2
                ? new T.Vector3((rng() - 0.5) * 18, 0, (rng() - 0.5) * 18)
                : new T.Vector3(-60 + rng(), 0.3, -63 + rng());
        matrix.makeScale(0.1 + rng() * 0.9, 1, 1);
        matrix.setPosition(p);
        mesh.setMatrixAt(i, matrix);
      }
      this.group.add(mesh);
      return mesh;
    };
    this.rain = make(rainCount, 0);
    this.smoke = make(smokeCount, 1);
    this.ripples = make(60, 2);
    this.steam = make(18, 3);
  }
  update(time: number, camera: T.Camera, rain: number, smoke: boolean) {
    this.rain.visible = !this.level.interiors.some((b) =>
      inside(camera.position, b),
    );
    // Stack smoke and boiler steam belong to levels that author them.
    this.smoke.visible = smoke && this.level.atmosphere.smoke > 0;
    this.steam.visible = this.level.audio.emitters.some(
      (e) => e.kind === 'steam',
    );
    this.ripples.visible = this.rain.visible && camera.position.y < 12;
    for (const m of this.materials) {
      m.uniforms.time!.value = time;
      m.uniforms.cameraPos!.value.copy(camera.position);
      m.uniforms.density!.value = rain;
    }
  }
  dispose() {
    this.materials.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.textures.forEach((t) => t.dispose());
    this.group.clear();
  }
}
