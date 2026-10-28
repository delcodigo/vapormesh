import * as THREE from 'three';
import { paletteColor01, type IndexedImage, type Palette, type Surface } from '@/core';
import type { ModelerState } from '@/modeler';
import { buildSurfaceBuffers } from './shading';

/** Fixed light for now (Layout will bring real ones): a distant light from the upper left, plus ambient. */
const LIGHT_DIRECTION = new THREE.Vector3(-0.45, 0.8, 0.5).normalize(); // towards the light, world space
const AMBIENT = 0.25;

// Gouraud: lighting is computed per vertex as (light, specular) and interpolated across the polygon, then applied to
// the surface colour times the texture, like vertex-lit textured polygons of the period. Flat surfaces get one normal
// per face, so every vertex lights identically. Double-sided surfaces light both sides.
const VERTEX = /* glsl */ `
  uniform float uDiffuse;
  uniform float uLuminosity;
  uniform float uSpecular;
  uniform float uShininess;
  uniform vec3 uLight;
  uniform float uAmbient;
  varying vec2 vUv;
  varying vec2 vFront;
  varying vec2 vBack;

  vec2 shade(vec3 n, vec3 toViewer) {
    float ndl = max(dot(n, uLight), 0.0);
    vec3 h = normalize(uLight + toViewer);
    float spec = ndl > 0.0 ? uSpecular * pow(max(dot(n, h), 0.0), uShininess) : 0.0;
    return vec2(uAmbient + uDiffuse * ndl + uLuminosity, spec);
  }

  void main() {
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 toViewer = normalize(cameraPosition - world.xyz);
    vUv = uv;
    vFront = shade(n, toViewer);
    vBack = shade(-n, toViewer);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec2 vFront;
  varying vec2 vBack;
  void main() {
    vec2 ls = gl_FrontFacing ? vFront : vBack;
    vec3 base = uColor * texture2D(uMap, vUv).rgb;
    gl_FragColor = vec4(base * ls.x + vec3(ls.y), 1.0);
  }
`;

function imageTexture(image: IndexedImage, palette: Palette, wrap: Surface['wrap']): THREE.DataTexture {
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let i = 0; i < image.pixels.length; i++) {
    const c = image.pixels[i]! * 3;
    rgba.set([palette[c]!, palette[c + 1]!, palette[c + 2]!, 255], i * 4);
  }
  const tex = new THREE.DataTexture(rgba, image.width, image.height, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; // no filtering: hard texels
  tex.wrapS = tex.wrapT = wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true; // row 0 of the image is v = 0, the top, matching how UVs are defined
  return tex;
}

function whiteTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** Solid-shaded version of every layer, one draw per surface. Rebuilt when the model changes. */
export class ShadedView {
  readonly group = new THREE.Group();
  private built = -1;
  private white = whiteTexture();
  /** GPU textures by "image|wrap", kept while the image and palette are unchanged. */
  private textures = new Map<string, { image: IndexedImage; palette: Palette; texture: THREE.DataTexture }>();

  constructor(private state: ModelerState) {}

  update(): void {
    if (this.built === this.state.version) return;
    this.built = this.state.version;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const m = child as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const used = new Set<string>();
    for (const [layerIndex, layer] of this.state.layers.entries()) {
      if (this.state.isLayerHidden(layerIndex)) continue;
      layer.surfaces.forEach((surface, index) => {
        const { positions, normals, uvs } = buildSurfaceBuffers(layer, index);
        if (positions.length === 0) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        this.group.add(new THREE.Mesh(geo, this.material(surface, used)));
      });
    }
    // free textures nothing uses any more
    for (const [key, entry] of this.textures) {
      if (used.has(key)) continue;
      entry.texture.dispose();
      this.textures.delete(key);
    }
  }

  /** The image a surface names, as a texture; plain white if it has none or the image is missing. */
  private textureFor(surface: Surface, used: Set<string>): THREE.Texture {
    const image = surface.texture ? this.state.images.find((i) => i.name === surface.texture) : undefined;
    if (!image) return this.white;
    const key = `${image.name}|${surface.wrap}`;
    used.add(key);
    const palette = this.state.palette;
    const cached = this.textures.get(key);
    if (cached && cached.image === image && cached.palette === palette) return cached.texture;
    cached?.texture.dispose();
    const texture = imageTexture(image, palette, surface.wrap);
    this.textures.set(key, { image, palette, texture });
    return texture;
  }

  private material(s: Surface, used: Set<string>): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(...paletteColor01(this.state.palette, s.colorIndex)) }, // used as authored: no colour-space conversion
        uMap: { value: this.textureFor(s, used) },
        uDiffuse: { value: s.diffuse },
        uLuminosity: { value: s.luminosity },
        uSpecular: { value: s.specular },
        uShininess: { value: Math.pow(2, 2 + s.glossiness * 8) },
        uLight: { value: LIGHT_DIRECTION },
        uAmbient: { value: AMBIENT },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: s.doubleSided ? THREE.DoubleSide : THREE.FrontSide, // LightWave surfaces are single-sided by default
    });
  }
}
