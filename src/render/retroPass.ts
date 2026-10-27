import * as THREE from 'three';
import type { RetroOptions } from './retro';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Samples the low-res target with nearest filtering (so every texel becomes a hard square), then quantises
// each channel to `uLevels` steps, nudged by a 4x4 Bayer matrix indexed by the low-res pixel.
const FRAGMENT = /* glsl */ `
  uniform sampler2D tColor;
  uniform vec2 uRes;
  uniform float uLevels;
  uniform float uDither;
  varying vec2 vUv;

  const float BAYER[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );

  void main() {
    vec4 t = texture2D(tColor, vUv);
    ivec2 p = ivec2(floor(vUv * uRes));
    float threshold = (BAYER[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0 - 0.5;
    float steps = max(uLevels - 1.0, 1.0);
    vec3 c = floor(clamp(t.rgb, 0.0, 1.0) * steps + 0.5 + threshold * uDither) / steps;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * t.a, t.a);
  }
`;

/** Renders a scene at low resolution, then blits it to the canvas with dithering and colour quantisation. */
export class RetroPass {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  private material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: this.target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uLevels: { value: 32 },
      uDither: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** `aspect` is the canvas width / height, so low-res pixels stay square. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: RetroOptions, aspect: number): void {
    const h = THREE.MathUtils.clamp(Math.round(opts.resolutionHeight), 16, 2160);
    const w = Math.max(1, Math.round(h * aspect));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    const u = this.material.uniforms;
    u.uRes!.value.set(w, h);
    u.uLevels!.value = THREE.MathUtils.clamp(opts.colorLevels, 2, 256);
    u.uDither!.value = THREE.MathUtils.clamp(opts.dither, 0, 1);

    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera); // auto-clears to the transparent clear colour
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
