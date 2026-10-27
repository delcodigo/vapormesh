import * as THREE from 'three';
import { defaultPalette, type Palette, type Vec3 } from '@/core';
import { THEME } from '@/theme';
import { constrainToAxis, type Projector, type ScreenPoint } from './pick';
import type { DisplaySettings } from './retro';
import { DEFAULT_VIEW, fitView, normalizeView, relevantView, VIEW_LIMITS, type Bounds, type ViewState } from './viewState';
import { RetroPass } from './retroPass';

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

/** What a drag handler sees: movement in world space and in canvas pixels, plus modifier keys. */
export interface DragInfo {
  /** Cumulative world-space movement within the view plane since the press. */
  offset: Vec3;
  /** Canvas-relative CSS pixels. */
  start: { x: number; y: number };
  current: { x: number; y: number };
  /** Where the pointer has been since the press, when the handler asked for a lasso. */
  path?: { x: number; y: number }[];
  shift: boolean;
  ctrl: boolean;
}

/** A tool's claim on left-drags in a viewport. */
export interface DragHandler {
  /** Draw a selection rectangle while dragging. Read once, after `begin` returns true. */
  readonly rubberBand?: boolean;
  /** What to draw while dragging: a box (selection) or a line (the knife). */
  readonly bandShape?: 'box' | 'line' | 'lasso';
  /** Return true to take over the drag (otherwise the viewport navigates). */
  /** `press` is where the pointer went down, in canvas pixels. */
  begin(view: Viewport, e: PointerEvent, press: { x: number; y: number }): boolean;
  move(info: DragInfo): void;
  end(info: DragInfo): void;
  /** The pointer was cancelled (e.g. focus lost): abandon rather than commit. */
  cancel(): void;
}

export class Viewport implements Projector {
  dragHandler?: DragHandler;
  /** How to draw. Only the Perspective view honours it; the ortho views are always wireframe. */
  display?: DisplaySettings;
  /** Geometry drawn through the retro pass when the display mode is shaded. */
  readonly shadedScene = new THREE.Scene();
  /** The project palette the shaded view maps to. Set from outside each frame. */
  palette: Palette = defaultPalette();
  private retroPass: RetroPass | null = null;
  /** Called on a left click that did not drag; coordinates are CSS pixels within the canvas. */
  onClick?: (x: number, y: number, e: PointerEvent) => void;

  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;

  /** Point the view is centered on (pan target / orbit pivot). */
  private target = new THREE.Vector3(...DEFAULT_VIEW.target);
  /** World units visible vertically in orthographic views. */
  private orthoSize = DEFAULT_VIEW.orthoSize;
  /** Perspective orbit state. */
  private radius = DEFAULT_VIEW.radius;
  private theta = DEFAULT_VIEW.theta;
  private phi = DEFAULT_VIEW.phi; // polar angle from +Y

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
    const mode = this.kind === 'perspective' ? (this.display?.mode ?? 'wire') : 'wire';
    if (this.grid) this.grid.visible = mode === 'wire';
    if (mode === 'wire') {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.retroPass ??= new RetroPass();
    const aspect = this.width / Math.max(this.height, 1) || 1;
    this.retroPass.render(this.renderer, this.shadedScene, this.camera, this.display!.retro, aspect, this.palette);
    if (mode === 'shaded-wire') {
      // Editing overlay at full resolution on top of the chunky image.
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
    }
  }

  get isOrtho(): boolean {
    return this.kind !== 'perspective';
  }

  /** Unit vector from the scene towards the viewer. */
  get viewAxis(): Vec3 {
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
    return [v.x, v.y, v.z];
  }

  /** World-space offset in the view plane for a screen drag (pixels, y down). */
  private screenToWorld(dxPx: number, dyPx: number): Vec3 {
    const k = this.worldPerPixel();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const v = right.multiplyScalar(dxPx * k).addScaledVector(up, -dyPx * k);
    return [v.x, v.y, v.z];
  }

  /** The world point under a canvas pixel (CSS pixels), on the near plane. Depth is arbitrary: ortho views look straight along an axis. */
  unproject(x: number, y: number): Vec3 {
    const v = new THREE.Vector3((x / Math.max(this.width, 1)) * 2 - 1, 1 - (y / Math.max(this.height, 1)) * 2, 0).unproject(this.camera);
    return [v.x, v.y, v.z];
  }

  project(p: Vec3): ScreenPoint {
    const v = new THREE.Vector3(...p).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, z: v.z };
  }

  // --- saved camera ---------------------------------------------------------

  /** The camera as saved in a project: pan, zoom and (for Perspective) orbit. */
  getView(): ViewState {
    const { x, y, z } = this.target;
    return relevantView(this.kind, {
      target: [x, y, z],
      orthoSize: this.orthoSize,
      radius: this.radius,
      theta: this.theta,
      phi: this.phi,
    });
  }

  /** Restore a camera. Missing or out-of-range values fall back to the defaults or are clamped. */
  setView(view: Partial<ViewState>): void {
    const v = normalizeView(view);
    this.target.set(...v.target);
    this.orthoSize = v.orthoSize;
    this.radius = v.radius;
    this.theta = v.theta;
    this.phi = v.phi;
    this.dirty = true;
  }

  resetView(): void {
    this.setView({});
  }

  /** Centre the camera on a box and zoom until all of it shows, at this view's own shape. */
  frame(box: Bounds): void {
    const current = normalizeView({ target: [this.target.x, this.target.y, this.target.z], orthoSize: this.orthoSize, radius: this.radius, theta: this.theta, phi: this.phi });
    const fov = this.camera instanceof THREE.PerspectiveCamera ? this.camera.fov : 50;
    this.setView(fitView(this.kind, box, this.width / Math.max(this.height, 1), fov, current));
  }

  // --- rubber band -------------------------------------------------------

  private band: HTMLDivElement | null = null;

  private showBand(a: { x: number; y: number }, b: { x: number; y: number }): void {
    if (!this.band) {
      this.band = document.createElement('div');
      this.band.className = 'rubberband';
      this.canvas.parentElement?.appendChild(this.band);
    }
    const { style } = this.band;
    style.display = 'block';
    style.left = `${Math.min(a.x, b.x)}px`;
    style.top = `${Math.min(a.y, b.y)}px`;
    style.width = `${Math.abs(a.x - b.x)}px`;
    style.height = `${Math.abs(a.y - b.y)}px`;
  }

  private line: HTMLDivElement | null = null;

  /** A dashed line from one canvas point to another, for the knife. */
  private showLine(a: { x: number; y: number }, b: { x: number; y: number }): void {
    if (!this.line) {
      this.line = document.createElement('div');
      this.line.className = 'rubberline';
      this.canvas.parentElement?.appendChild(this.line);
    }
    const { style } = this.line;
    style.display = 'block';
    style.left = `${a.x}px`;
    style.top = `${a.y}px`;
    style.width = `${Math.hypot(b.x - a.x, b.y - a.y)}px`;
    style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`;
  }

  private lassoLine: SVGSVGElement | null = null;

  /** A dashed freehand outline, closed back to the press as it will be when released. */
  private showLasso(path: { x: number; y: number }[]): void {
    if (!this.lassoLine) {
      const ns = 'http://www.w3.org/2000/svg';
      this.lassoLine = document.createElementNS(ns, 'svg');
      this.lassoLine.setAttribute('class', 'rubberlasso');
      this.lassoLine.appendChild(document.createElementNS(ns, 'polygon'));
      this.canvas.parentElement?.appendChild(this.lassoLine);
    }
    this.lassoLine.style.display = 'block';
    this.lassoLine.firstElementChild!.setAttribute('points', path.map((p) => `${p.x},${p.y}`).join(' '));
  }

  private hideBand(): void {
    if (this.lassoLine) this.lassoLine.style.display = 'none';
    if (this.band) this.band.style.display = 'none';
    if (this.line) this.line.style.display = 'none';
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
    this.phi = THREE.MathUtils.clamp(this.phi - dyPx * 0.008, ...VIEW_LIMITS.phi);
    this.dirty = true;
  }

  private zoom(deltaY: number, ndcX: number, ndcY: number): void {
    const factor = Math.exp(deltaY * 0.0015);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.radius = THREE.MathUtils.clamp(this.radius * factor, ...VIEW_LIMITS.radius);
    } else {
      const old = this.orthoSize;
      this.orthoSize = THREE.MathUtils.clamp(old * factor, ...VIEW_LIMITS.orthoSize);
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

    const rel = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let last: { x: number; y: number } | null = null;
    let start = { x: 0, y: 0 };
    let startRel = { x: 0, y: 0 };
    let button = -1;
    let moved = false;
    let dragging = false;
    let banding = false;
    let path: { x: number; y: number }[] = [];
    // Shift as of the last move, so releasing Shift just before the button doesn't change the line you saw
    let straight = false;
    const info = (e: PointerEvent): DragInfo => ({
      path,
      offset: this.screenToWorld(e.clientX - start.x, e.clientY - start.y),
      start: startRel,
      // holding Shift while drawing a line (the knife) keeps it horizontal or vertical
      current: straight && this.dragHandler?.bandShape === 'line' ? constrainToAxis(startRel, rel(e)) : rel(e),
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
    });

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      last = start = { x: e.clientX, y: e.clientY };
      startRel = rel(e);
      path = [startRel];
      straight = false;
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
        dragging = button === 0 && (this.dragHandler?.begin(this, e, startRel) ?? false);
        banding = dragging && !!this.dragHandler?.rubberBand;
      }
      if (dragging) {
        straight = e.shiftKey;
        if (this.dragHandler!.bandShape === 'lasso') path.push(rel(e));
        const i = info(e);
        if (banding) {
          if (this.dragHandler!.bandShape === 'lasso') this.showLasso(path);
          else if (this.dragHandler!.bandShape === 'line') this.showLine(i.start, i.current);
          else this.showBand(i.start, i.current);
        }
        this.dragHandler!.move(i);
        return;
      }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      const panning = button === 1 || button === 2 || e.shiftKey;
      if (panning) this.pan(dx, dy);
      else if (button === 0 && this.kind === 'perspective') this.orbit(dx, dy);
    });
    const stop = (e: PointerEvent, commit: boolean) => {
      if (dragging) {
        if (commit) this.dragHandler?.end(info(e));
        else this.dragHandler?.cancel();
      }
      dragging = banding = false;
      this.hideBand();
      last = null;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', (e) => {
      const click = last !== null && !moved && button === 0;
      stop(e, true);
      if (click) this.onClick?.(rel(e).x, rel(e).y, e);
    });
    c.addEventListener('pointercancel', (e) => stop(e, false));

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
