import * as THREE from 'three';
import { buildPaletteLut, type Palette } from '@/core';
import type { RetroOptions } from './retro';

const LUT_SIZE = 32;
/** How far the ordered dither pushes a colour before it snaps to the palette (a fraction of the 0..1 range). */
const PALETTE_DITHER_SPREAD = 0.16;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Samples the low-res target with nearest filtering (so every texel becomes a hard square), nudges each pixel by a
// 4x4 Bayer matrix indexed by the low-res pixel, then snaps it to the project palette through a lookup table
// (or, without a palette, to a limited number of levels per channel).
const FRAGMENT = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler3D uLut;
  uniform vec2 uRes;
  uniform float uLevels;
  uniform float uDither;
  uniform float uSpread;
  uniform float uLutSize;
  uniform float uUsePalette;
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
    vec3 c = clamp(t.rgb, 0.0, 1.0);
    if (uUsePalette > 0.5) {
      vec3 d = clamp(c + threshold * uSpread, 0.0, 1.0);
      c = texture(uLut, d * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize).rgb;
    } else {
      float steps = max(uLevels - 1.0, 1.0);
      c = floor(c * steps + 0.5 + threshold * uDither) / steps;
    }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * t.a, t.a);
  }
`;

function lutTexture(palette: Palette): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(buildPaletteLut(palette, LUT_SIZE), LUT_SIZE, LUT_SIZE, LUT_SIZE);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Renders a scene at low resolution, then blits it to the canvas with dithering and palette (or colour) quantisation. */
export class RetroPass {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  private lut: { palette: Palette; texture: THREE.Data3DTexture } | null = null;
  private material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: this.target.texture },
      uLut: { value: new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uLevels: { value: 32 },
      uDither: { value: 1 },
      uSpread: { value: PALETTE_DITHER_SPREAD },
      uLutSize: { value: LUT_SIZE },
      uUsePalette: { value: 1 },
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
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: RetroOptions,
    aspect: number,
    palette: Palette,
  ): void {
    const h = THREE.MathUtils.clamp(Math.round(opts.resolutionHeight), 16, 2160);
    const w = Math.max(1, Math.round(h * aspect));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    if (opts.usePalette && this.lut?.palette !== palette) {
      this.lut?.texture.dispose();
      this.lut = { palette, texture: lutTexture(palette) };
    }
    const u = this.material.uniforms;
    if (this.lut) u.uLut!.value = this.lut.texture;
    u.uRes!.value.set(w, h);
    u.uLevels!.value = THREE.MathUtils.clamp(opts.colorLevels, 2, 256);
    u.uDither!.value = THREE.MathUtils.clamp(opts.dither, 0, 1);
    u.uSpread!.value = PALETTE_DITHER_SPREAD * THREE.MathUtils.clamp(opts.dither, 0, 1);
    u.uUsePalette!.value = opts.usePalette ? 1 : 0;

    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera); // auto-clears to the transparent clear colour
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.lut?.texture.dispose();
    this.material.dispose();
  }
}
