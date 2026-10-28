import * as THREE from 'three';
import type { Mesh } from '@/core';
import type { ModelerState } from '@/modeler';
import { THEME } from '@/theme';

const { wire: EDGE, point: POINT, selected: SELECTED, selectedFill: SELECTED_FILL } = THEME;

/** Each edge once, as line-segment positions. */
function uniqueEdges(mesh: Mesh): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  mesh.polygons.forEach(({ points }, pi) => {
    if (mesh.hidden.has(pi)) return;
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(...mesh.points[a]!, ...mesh.points[b]!);
    });
  });
  return out;
}

/** The visible polygons as a triangle fan each, for filling the depth buffer. */
function fanPositions(mesh: Mesh): number[] {
  const out: number[] = [];
  mesh.polygons.forEach(({ points }, pi) => {
    if (mesh.hidden.has(pi)) return;
    for (let i = 1; i < points.length - 1; i++) out.push(...mesh.points[points[0]!]!, ...mesh.points[points[i]!]!, ...mesh.points[points[i + 1]!]!);
  });
  return out;
}

/** Draws a ModelerState's mesh as wireframe + points + selection highlight. One instance per viewport. */
export class MeshView {
  readonly group = new THREE.Group();
  private built = '';
  /** Lines and points behind a polygon are not drawn. */
  private occlude = false;

  constructor(private state: ModelerState) {}

  /** Rebuild if the state or the `occlude` choice changed since the last call. With `occlude`, only what the model does not cover is drawn. */
  update(occlude = false): void {
    const key = `${this.state.version}|${occlude}`;
    if (this.built === key) return;
    this.built = key;
    this.occlude = occlude;
    this.clear();

    const { mesh, mode, selectedPoints, selectedPolygons } = this.state;
    if (occlude) {
      const hull: number[] = [];
      this.state.layers.forEach((layer, i) => {
        if (i === this.state.activeLayer || !this.state.isLayerHidden(i)) hull.push(...fanPositions(layer));
      });
      this.addHull(hull);
    }
    this.state.layers.forEach((layer, i) => {
      if (i !== this.state.activeLayer && !this.state.isLayerHidden(i)) this.addLines(uniqueEdges(layer), THEME.backgroundWire, 0);
    });
    const edges = new Set<string>();
    const edgePos: number[] = [];
    const selEdgePos: number[] = [];
    const fillPos: number[] = [];
    const seg = (out: number[], a: number, b: number) => out.push(...mesh.points[a]!, ...mesh.points[b]!);

    mesh.polygons.forEach((poly, pi) => {
      if (mesh.hidden.has(pi)) return;
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
        color: SELECTED_FILL,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthTest: this.occlude,
      });
      this.add(new THREE.Mesh(geo, mat), 1);
    }
    this.addLines(edgePos, EDGE, 2);
    this.addLines(selEdgePos, SELECTED, 3);

    const { activeTool, numericOp } = this.state;
    const usesPivot = (t: string | null) => t === 'rotate' || t === 'size';
    if (usesPivot(activeTool) || usesPivot(numericOp)) {
      const pivot = this.state.pivot();
      if (pivot) this.addPoints([...pivot], THEME.pivot, 11, 6);
    }

    if (mode === 'points') {
      const all: number[] = [];
      const sel: number[] = [];
      const hidden = mesh.hiddenPoints();
      mesh.points.forEach((p, i) => {
        if (!hidden.has(i)) (selectedPoints.has(i) ? sel : all).push(...p);
      });
      this.addPoints(all, POINT, 4, 4);
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

  /** Invisible geometry that only writes depth, pushed back a little so edges lying on a surface still show. */
  private addHull(pos: number[]): void {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.add(new THREE.Mesh(geo, mat), -1);
  }

  private addLines(pos: number[], color: number, order: number): void {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: this.occlude })), order);
  }

  private addPoints(pos: number[], color: number, size: number, order: number): void {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: this.occlude });
    this.add(new THREE.Points(geo, mat), order);
  }
}
