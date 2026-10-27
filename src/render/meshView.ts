import * as THREE from 'three';
import type { ModelerState } from '@/modeler';

const EDGE = 0xb4b4b4;
const POINT = 0x40c0ff;
const SELECTED = 0xffd000;
const SELECTED_POLY = 0xff8000;

/** Draws a ModelerState's mesh as wireframe + points + selection highlight. One instance per viewport. */
export class MeshView {
  readonly group = new THREE.Group();
  private built = -1;

  constructor(private state: ModelerState) {}

  /** Rebuild if the state changed since the last call. */
  update(): void {
    if (this.built === this.state.version) return;
    this.built = this.state.version;
    this.clear();

    const { mesh, mode, selectedPoints, selectedPolygons } = this.state;
    const edges = new Set<string>();
    const edgePos: number[] = [];
    const selEdgePos: number[] = [];
    const fillPos: number[] = [];
    const seg = (out: number[], a: number, b: number) => out.push(...mesh.points[a]!, ...mesh.points[b]!);

    mesh.polygons.forEach((poly, pi) => {
      const ids = poly.points;
      const selected = mode === 'polygons' && selectedPolygons.has(pi);
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i]!;
        const b = ids[(i + 1) % ids.length]!;
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (selected) seg(selEdgePos, a, b);
        if (!edges.has(key)) {
          edges.add(key);
          seg(edgePos, a, b);
        }
      }
      if (selected) {
        for (let i = 1; i < ids.length - 1; i++) {
          fillPos.push(...mesh.points[ids[0]!]!, ...mesh.points[ids[i]!]!, ...mesh.points[ids[i + 1]!]!);
        }
      }
    });

    if (fillPos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(fillPos, 3));
      const mat = new THREE.MeshBasicMaterial({
        color: SELECTED_POLY,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      this.add(new THREE.Mesh(geo, mat), 1);
    }
    this.addLines(edgePos, EDGE, 2);
    this.addLines(selEdgePos, SELECTED_POLY, 3);

    if (mode === 'points') {
      const all: number[] = [];
      const sel: number[] = [];
      mesh.points.forEach((p, i) => (selectedPoints.has(i) ? sel : all).push(...p));
      this.addPoints(all, POINT, 5, 4);
      this.addPoints(sel, SELECTED, 8, 5);
    }
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const obj = child as THREE.Mesh;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  }

  private add(obj: THREE.Object3D, order: number): void {
    obj.renderOrder = order;
    this.group.add(obj);
  }

  private addLines(pos: number[], color: number, order: number): void {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false })), order);
  }

  private addPoints(pos: number[], color: number, size: number, order: number): void {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false });
    this.add(new THREE.Points(geo, mat), order);
  }
}
