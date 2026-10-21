import * as T from 'three';
import { graphics } from './graphics';
export class WorldPost {
  target = new T.WebGLRenderTarget(1, 1, {
    depthTexture: new T.DepthTexture(1, 1),
  });
  scene = new T.Scene();
  camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  effects = {
    ao: true,
    bloom: true,
    grain: true,
    vignette: true,
    softness: true,
    aberration: true,
    grade: true,
    droplets: true,
  };
  material = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      resolution: { value: new T.Vector2(1, 1) },
      time: { value: 0 },
      grain: { value: 0.03 },
      bloom: { value: 0.15 },
      ao: { value: 1 },
      vignette: { value: 1 },
      softness: { value: 1 },
      aberration: { value: 1 },
      grade: { value: 1 },
      droplets: { value: 0 },
      tint: { value: new T.Color('#aebdc5') },
    },
    vertexShader:
      'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
    varying vec2 uv0; uniform sampler2D tColor,tDepth;uniform vec2 resolution;uniform float time,grain,bloom,ao,vignette,softness,aberration,grade,droplets;uniform vec3 tint;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){vec2 px=1.0/resolution;vec2 off=(uv0-.5)*length(uv0-.5)*.0012*aberration;
      vec3 c=texture2D(tColor,uv0).rgb; c.r=texture2D(tColor,uv0+off).r;c.b=texture2D(tColor,uv0-off).b;
      vec3 blur=vec3(0.);float shade=0.;float d=texture2D(tDepth,uv0).r;
      for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
        if(x!=0&&y!=0)continue;
        vec2 q=vec2(float(x),float(y));vec3 b=texture2D(tColor,uv0+q*px*3.).rgb;blur+=b/5.;
        if(ao>.5){float nd=texture2D(tDepth,uv0+q*px*5.).r;shade+=smoothstep(.000015,.0003,d-nd)*(1.-smoothstep(.001,.008,d-nd))/5.;}
      }
      c=mix(c,blur,.12*softness);c*=1.-shade*.55*ao*(1.-smoothstep(.997,.9994,d));c+=max(blur-.68,0.)*bloom;
      float lum=dot(c,vec3(.2126,.7152,.0722));c=mix(c,mix(vec3(lum),c,.58)*mix(vec3(1.),tint,.25),grade);
      c=mix(c,c*.94+.012,grade);c*=1.-vignette*.26*pow(length((uv0-.5)*vec2(1.15,1.)),1.4);
      c+=(hash(gl_FragCoord.xy+floor(time*12.))-.5)*grain;
      float edge=smoothstep(.30,.58,length(uv0-.5));float drop=pow(max(0.,sin(uv0.x*173.+sin(uv0.y*57.))*sin(uv0.y*137.-time*.07)),22.);c+=drop*edge*.025*droplets;
      gl_FragColor=vec4(max(c,0.),1.);
      #include <colorspace_fragment>
    }`,
  });
  quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.material);
  constructor() {
    this.scene.add(this.quad);
  }
  resize(w: number, h: number) {
    this.target.setSize(w, h);
    this.material.uniforms.resolution!.value.set(w, h);
  }
  render(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.Camera,
    time: number,
    allowAO: boolean,
    high: boolean,
  ) {
    const u = this.material.uniforms;
    u.time!.value = time;
    u.grain!.value = this.effects.grain ? graphics.grain : 0;
    u.bloom!.value = this.effects.bloom ? graphics.bloom : 0;
    for (const k of ['vignette', 'softness', 'aberration', 'grade'] as const)
      u[k]!.value = Number(this.effects[k]);
    u.ao!.value = Number(this.effects.ao && allowAO);
    u.droplets!.value = Number(this.effects.droplets && high);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
