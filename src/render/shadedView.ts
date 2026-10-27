import * as THREE from 'three';
import type { Surface } from '@/core';
import type { ModelerState } from '@/modeler';
import { buildSurfaceBuffers } from './shading';

/** Fixed light for now (Layout will bring real ones): a distant light from the upper left, plus ambient. */
const LIGHT_DIRECTION = new THREE.Vector3(-0.45, 0.8, 0.5).normalize(); // towards the light, world space
const AMBIENT = 0.25;

// Gouraud: lighting is computed per vertex and the colour is interpolated across the polygon. Flat surfaces get
// one normal per face, so every vertex lights identically. Double-sided surfaces light both sides.
const VERTEX = /* glsl */ `
  uniform vec3 uColor;
  uniform float uDiffuse;
  uniform float uLuminosity;
  uniform float uSpecular;
  uniform float uShininess;
  uniform vec3 uLight;
  uniform float uAmbient;
  varying vec3 vFront;
  varying vec3 vBack;

  vec3 shade(vec3 n, vec3 toViewer) {
    float ndl = max(dot(n, uLight), 0.0);
    vec3 h = normalize(uLight + toViewer);
    float spec = ndl > 0.0 ? uSpecular * pow(max(dot(n, h), 0.0), uShininess) : 0.0;
    return uColor * (uAmbient + uDiffuse * ndl + uLuminosity) + vec3(spec);
  }

  void main() {
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 toViewer = normalize(cameraPosition - world.xyz);
    vFront = shade(n, toViewer);
    vBack = shade(-n, toViewer);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vFront;
  varying vec3 vBack;
  void main() {
    gl_FragColor = vec4(gl_FrontFacing ? vFront : vBack, 1.0);
  }
`;

function surfaceMaterial(s: Surface): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...s.color) }, // used as authored: no colour-space conversion
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

/** Solid-shaded version of every layer, one draw per surface. Rebuilt when the model changes. */
export class ShadedView {
  readonly group = new THREE.Group();
  private built = -1;

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
    for (const layer of this.state.layers) {
      layer.surfaces.forEach((surface, index) => {
        const { positions, normals } = buildSurfaceBuffers(layer, index);
        if (positions.length === 0) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        this.group.add(new THREE.Mesh(geo, surfaceMaterial(surface)));
      });
    }
  }
}
