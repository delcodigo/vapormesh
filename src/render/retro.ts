import * as THREE from 'three';

/** Retro look knobs applied to the final render. */
export interface RetroOptions {
  /** Internal render height in pixels; upscaled with nearest filtering. */
  resolutionHeight: number;
  /** Quantize color to this many levels per channel (0 = off). */
  colorLevels: number;
}

export const defaultRetro: RetroOptions = { resolutionHeight: 240, colorLevels: 32 };

export type ViewKind = 'perspective' | 'top' | 'front' | 'right';

/** Orthographic views look down an axis; `up` keeps the screen orientation LightWave-like. */
const ORTHO: Record<Exclude<ViewKind, 'perspective'>, { dir: [number, number, number]; up: [number, number, number] }> = {
  top: { dir: [0, 1, 0], up: [0, 0, -1] },
  front: { dir: [0, 0, 1], up: [0, 1, 0] },
  right: { dir: [1, 0, 0], up: [0, 1, 0] },
};

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** World units visible vertically in orthographic views. */
  orthoSize = 4;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly kind: ViewKind = 'perspective',
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    if (kind === 'perspective') {
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      this.camera.position.set(3, 2, 4);
    } else {
      const { dir, up } = ORTHO[kind];
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
      this.camera.position.set(dir[0] * 10, dir[1] * 10, dir[2] * 10);
      this.camera.up.set(...up);
    }
    this.camera.lookAt(0, 0, 0);
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setSize(w, h, false);
    const aspect = w / Math.max(h, 1);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = aspect;
    } else {
      const hh = this.orthoSize / 2;
      this.camera.left = -hh * aspect;
      this.camera.right = hh * aspect;
      this.camera.top = hh;
      this.camera.bottom = -hh;
    }
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
