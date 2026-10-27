import * as THREE from 'three';
import type { Vec3 } from '@/core';
import { THEME } from '@/theme';
import type { Projector, ScreenPoint } from './pick';

export type ViewKind = 'perspective' | 'top' | 'face' | 'left';
type OrthoKind = Exclude<ViewKind, 'perspective'>;

/** Orthographic views look down an axis; `up` keeps the screen orientation LightWave-like. */
const ORTHO: Record<OrthoKind, { dir: THREE.Vector3Tuple; up: THREE.Vector3Tuple; plane: [number, number] }> = {
  top: { dir: [0, 1, 0], up: [0, 0, -1], plane: [0, 2] }, // XZ
  face: { dir: [0, 0, 1], up: [0, 1, 0], plane: [0, 1] }, // XY
  left: { dir: [-1, 0, 0], up: [0, 1, 0], plane: [2, 1] }, // ZY, +Z to the right as in LightWave
};

const MIN_GRID_PIXELS = 24;
const CLICK_SLOP = 4;

/** A tool's claim on left-drags. `offset` is the cumulative world-space movement within the view plane. */
export interface DragHandler {
  /** Return true to take over the drag (otherwise the viewport navigates). */
  begin(view: Viewport): boolean;
  move(offset: Vec3): void;
  end(): void;
}

export class Viewport implements Projector {
  dragHandler?: DragHandler;
  /** Called on a left click that did not drag; coordinates are CSS pixels within the canvas. */
  onClick?: (x: number, y: number, e: PointerEvent) => void;

  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;

  /** Point the view is centered on (pan target / orbit pivot). */
  private target = new THREE.Vector3();
  /** World units visible vertically in orthographic views. */
  private orthoSize = 4;
  /** Perspective orbit state. */
  private radius = 6;
  private theta = Math.atan2(3, 4);
  private phi = 1.0; // polar angle from +Y

  private grid: THREE.LineSegments | null = null;
  private dirty = true;
  private width = 0;
  private height = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly kind: ViewKind = 'perspective',
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    // Transparent canvas: the viewport's CSS gradient shows through.
    this.renderer.setClearColor(0x000000, 0);
    this.camera =
      kind === 'perspective'
        ? new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
        : new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    if (kind !== 'perspective') this.camera.up.set(...ORTHO[kind].up);
    this.updateCamera();
    this.bindEvents();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.dirty = true;
  }

  render(): void {
    if (this.dirty) {
      this.updateCamera();
      this.rebuildGrid();
      this.dirty = false;
    }
    this.renderer.render(this.scene, this.camera);
  }

  get isOrtho(): boolean {
    return this.kind !== 'perspective';
  }

  /** World-space offset in the view plane for a screen drag (pixels, y down). */
  private screenToWorld(dxPx: number, dyPx: number): Vec3 {
    const k = this.worldPerPixel();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const v = right.multiplyScalar(dxPx * k).addScaledVector(up, -dyPx * k);
    return [v.x, v.y, v.z];
  }

  project(p: Vec3): ScreenPoint {
    const v = new THREE.Vector3(...p).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, z: v.z };
  }

  // --- camera -----------------------------------------------------------

  private updateCamera(): void {
    const aspect = this.width / Math.max(this.height, 1) || 1;
    const cam = this.camera;
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.aspect = aspect;
      const sinPhi = Math.sin(this.phi);
      cam.position
        .set(sinPhi * Math.sin(this.theta), Math.cos(this.phi), sinPhi * Math.cos(this.theta))
        .multiplyScalar(this.radius)
        .add(this.target);
    } else {
      const hh = this.orthoSize / 2;
      cam.left = -hh * aspect;
      cam.right = hh * aspect;
      cam.top = hh;
      cam.bottom = -hh;
      cam.position.set(...ORTHO[this.kind as OrthoKind].dir).multiplyScalar(10).add(this.target);
    }
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** World-space size of one screen pixel at the target distance. */
  private worldPerPixel(): number {
    const h = Math.max(this.height, 1);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      return (2 * this.radius * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    }
    return this.orthoSize / h;
  }

  private pan(dxPx: number, dyPx: number): void {
    const k = this.worldPerPixel();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.target.addScaledVector(right, -dxPx * k).addScaledVector(up, dyPx * k);
    this.dirty = true;
  }

  private orbit(dxPx: number, dyPx: number): void {
    this.theta -= dxPx * 0.008;
    this.phi = THREE.MathUtils.clamp(this.phi - dyPx * 0.008, 0.05, Math.PI - 0.05);
    this.dirty = true;
  }

  private zoom(deltaY: number, ndcX: number, ndcY: number): void {
    const factor = Math.exp(deltaY * 0.0015);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.radius = THREE.MathUtils.clamp(this.radius * factor, 0.2, 500);
    } else {
      const old = this.orthoSize;
      this.orthoSize = THREE.MathUtils.clamp(old * factor, 0.01, 100000);
      // Keep the world point under the cursor fixed.
      const aspect = this.width / Math.max(this.height, 1);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const shift = (old - this.orthoSize) / 2;
      this.target.addScaledVector(right, ndcX * aspect * shift).addScaledVector(up, ndcY * shift);
    }
    this.dirty = true;
  }

  private bindEvents(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    let last: { x: number; y: number } | null = null;
    let start = { x: 0, y: 0 };
    let button = -1;
    let moved = false;
    let dragging = false;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      last = start = { x: e.clientX, y: e.clientY };
      button = e.button;
      moved = false;
      dragging = false;
    });
    c.addEventListener('pointermove', (e) => {
      if (!last) return;
      // Small wobble between press and release still counts as a click.
      if (!moved) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < CLICK_SLOP) return;
        moved = true;
        dragging = button === 0 && !e.shiftKey && (this.dragHandler?.begin(this) ?? false);
      }
      if (dragging) {
        this.dragHandler!.move(this.screenToWorld(e.clientX - start.x, e.clientY - start.y));
        return;
      }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      const panning = button === 1 || button === 2 || e.shiftKey;
      if (panning) this.pan(dx, dy);
      else if (button === 0 && this.kind === 'perspective') this.orbit(dx, dy);
    });
    const release = (e: PointerEvent) => {
      if (dragging) this.dragHandler?.end();
      dragging = false;
      last = null;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', (e) => {
      const click = last !== null && !moved && button === 0;
      release(e);
      if (click) {
        const r = c.getBoundingClientRect();
        this.onClick?.(e.clientX - r.left, e.clientY - r.top, e);
      }
    });
    c.addEventListener('pointercancel', release);

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
        this.zoom(e.deltaY, nx, ny);
      },
      { passive: false },
    );
  }

  // --- grid -------------------------------------------------------------

  private rebuildGrid(): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    const aspect = this.width / Math.max(this.height, 1) || 1;
    let plane: [number, number];
    let uHalf: number;
    let vHalf: number;
    let step: number;
    if (this.kind === 'perspective') {
      plane = [0, 2];
      uHalf = vHalf = 10;
      step = 1;
    } else {
      plane = ORTHO[this.kind as OrthoKind].plane;
      vHalf = this.orthoSize / 2;
      uHalf = vHalf * aspect;
      const ppu = Math.max(this.height, 1) / this.orthoSize;
      step = Math.pow(10, Math.ceil(Math.log10(MIN_GRID_PIXELS / ppu)));
    }
    const cu = this.kind === 'perspective' ? 0 : this.target.getComponent(plane[0]);
    const cv = this.kind === 'perspective' ? 0 : this.target.getComponent(plane[1]);

    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    const push = (u0: number, v0: number, u1: number, v1: number, hex: number) => {
      for (const [u, v] of [[u0, v0], [u1, v1]] as const) {
        const p = [0, 0, 0];
        p[plane[0]] = u;
        p[plane[1]] = v;
        positions.push(p[0]!, p[1]!, p[2]!);
        color.setHex(hex);
        colors.push(color.r, color.g, color.b);
      }
    };
    const lines = (lo: number, hi: number, emit: (x: number, hex: number) => void, axis: number) => {
      for (let k = Math.ceil(lo / step); k <= Math.floor(hi / step); k++) {
        emit(k * step, k === 0 ? THEME.axes[axis]! : k % 10 === 0 ? THEME.gridMajor : THEME.gridMinor);
      }
    };
    const [u0, u1, v0, v1] = [cu - uHalf, cu + uHalf, cv - vHalf, cv + vHalf];
    // lines of constant u run along v (they are the v axis when u == 0), and vice versa
    lines(u0, u1, (u, hex) => push(u, v0, u, v1, hex), plane[1]);
    lines(v0, v1, (v, hex) => push(u0, v, u1, v, hex), plane[0]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false });
    this.grid = new THREE.LineSegments(geo, mat);
    this.grid.renderOrder = -1;
    this.scene.add(this.grid);
  }
}
