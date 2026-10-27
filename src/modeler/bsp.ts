import type { UV, Vec3 } from '@/core';

// Boolean operations on solids by BSP trees (after Naylor, Amanatides and Thibault; the structure follows csg.js).
// A solid is a list of convex planar polygons wound counter-clockwise seen from outside. Every walk over a tree here uses an
// explicit stack, since a tree built from a mesh can be thousands of nodes deep.

export interface Vertex {
  p: Vec3;
  /** Texture coordinates, or null if this polygon has none. Interpolated when a polygon is split. */
  uv: UV | null;
}

export interface Plane {
  n: Vec3;
  w: number;
}

export interface CsgPolygon {
  vertices: Vertex[];
  plane: Plane;
  /** Which polygon of the input this came from. Splitting keeps it, so fragments can be put back together afterwards. */
  parent: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function planeFromPolygon(points: Vec3[]): Plane | null {
  // Newell's normal: robust for any number of points and for slightly non-planar ones
  const n: Vec3 = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  const len = Math.hypot(...n);
  if (len < 1e-300) return null;
  const unit: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
  const c = points.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / points.length) as Vec3;
  return { n: unit, w: dot(unit, c) };
}

/** The area of a polygon, as the length of its Newell normal over two. */
function area(vertices: Vertex[]): number {
  const n: Vec3 = [0, 0, 0];
  vertices.forEach((v, i) => {
    const p = v.p;
    const q = vertices[(i + 1) % vertices.length]!.p;
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  return Math.hypot(...n) / 2;
}

const lerpVertex = (a: Vertex, b: Vertex, t: number): Vertex => ({
  p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
  uv: a.uv && b.uv ? [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t] : null,
});

export function cloneCsg(p: CsgPolygon): CsgPolygon {
  return { vertices: [...p.vertices], plane: { n: [...p.plane.n], w: p.plane.w }, parent: p.parent };
}

/** Turn a polygon inside out: reverse its vertices (their UVs go with them) and its plane. */
export function flipCsgPolygon(p: CsgPolygon): void {
  p.vertices.reverse();
  p.plane = { n: [-p.plane.n[0], -p.plane.n[1], -p.plane.n[2]], w: -p.plane.w };
}

const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

/**
 * Sort a polygon against a plane into the four lists. A polygon crossing the plane is cut in two (a fragment keeps its parent's
 * plane, so a sliver can never end up with a plane of its own). Fragments with almost no area are dropped.
 */
function splitPolygon(plane: Plane, poly: CsgPolygon, eps: number, coplanarFront: CsgPolygon[], coplanarBack: CsgPolygon[], front: CsgPolygon[], back: CsgPolygon[]): void {
  let polygonType = 0;
  const types = poly.vertices.map((v) => {
    const t = dot(plane.n, v.p) - plane.w;
    const type = t < -eps ? BACK : t > eps ? FRONT : COPLANAR;
    polygonType |= type;
    return type;
  });
  if (polygonType === COPLANAR) (dot(plane.n, poly.plane.n) > 0 ? coplanarFront : coplanarBack).push(poly);
  else if (polygonType === FRONT) front.push(poly);
  else if (polygonType === BACK) back.push(poly);
  else {
    const f: Vertex[] = [];
    const b: Vertex[] = [];
    const n = poly.vertices.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ti, tj] = [types[i]!, types[j]!];
      const [vi, vj] = [poly.vertices[i]!, poly.vertices[j]!];
      if (ti !== BACK) f.push(vi);
      if (ti !== FRONT) b.push(vi);
      if ((ti | tj) === SPANNING) {
        const t = (plane.w - dot(plane.n, vi.p)) / dot(plane.n, [vj.p[0] - vi.p[0], vj.p[1] - vi.p[1], vj.p[2] - vi.p[2]]);
        const v = lerpVertex(vi, vj, t);
        f.push(v);
        b.push(v);
      }
    }
    const tiny = eps * eps;
    if (f.length >= 3 && area(f) > tiny) front.push({ vertices: f, plane: poly.plane, parent: poly.parent });
    if (b.length >= 3 && area(b) > tiny) back.push({ vertices: b, plane: poly.plane, parent: poly.parent });
  }
}

class Node {
  plane: Plane | null = null;
  front: Node | null = null;
  back: Node | null = null;
  polygons: CsgPolygon[] = [];

  /** Add polygons to this tree, splitting them down it. */
  build(polygons: CsgPolygon[], eps: number): void {
    const stack: [Node, CsgPolygon[]][] = [[this, polygons]];
    while (stack.length) {
      const [node, list] = stack.pop()!;
      if (list.length === 0) continue;
      node.plane ??= { n: [...list[0]!.plane.n], w: list[0]!.plane.w };
      const front: CsgPolygon[] = [];
      const back: CsgPolygon[] = [];
      for (const p of list) splitPolygon(node.plane, p, eps, node.polygons, node.polygons, front, back);
      if (front.length) stack.push([(node.front ??= new Node()), front]);
      if (back.length) stack.push([(node.back ??= new Node()), back]);
    }
  }

  /** Turn solid space into empty space and the other way round. */
  invert(): void {
    const stack: Node[] = [this];
    while (stack.length) {
      const node = stack.pop()!;
      node.polygons.forEach(flipCsgPolygon);
      if (node.plane) node.plane = { n: [-node.plane.n[0], -node.plane.n[1], -node.plane.n[2]], w: -node.plane.w };
      [node.front, node.back] = [node.back, node.front];
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }

  /** The parts of `polygons` that lie outside the solid this tree describes. */
  clipPolygons(polygons: CsgPolygon[], eps: number): CsgPolygon[] {
    const result: CsgPolygon[] = [];
    const stack: [Node, CsgPolygon[]][] = [[this, polygons]];
    while (stack.length) {
      const [node, list] = stack.pop()!;
      if (!node.plane) {
        result.push(...list);
        continue;
      }
      const front: CsgPolygon[] = [];
      const back: CsgPolygon[] = [];
      for (const p of list) splitPolygon(node.plane, p, eps, front, back, front, back);
      if (node.front) stack.push([node.front, front]);
      else result.push(...front);
      if (node.back) stack.push([node.back, back]); // behind a leaf is inside the solid: dropped
    }
    return result;
  }

  /** Remove every part of this tree's polygons that lies inside `other`. */
  clipTo(other: Node, eps: number): void {
    const stack: Node[] = [this];
    while (stack.length) {
      const node = stack.pop()!;
      node.polygons = other.clipPolygons(node.polygons, eps);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }

  allPolygons(): CsgPolygon[] {
    const out: CsgPolygon[] = [];
    const stack: Node[] = [this];
    while (stack.length) {
      const node = stack.pop()!;
      out.push(...node.polygons);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
    return out;
  }
}

function tree(polygons: CsgPolygon[], eps: number): Node {
  const node = new Node();
  node.build(polygons.map(cloneCsg), eps); // own copies: the walks above flip and cut polygons in place
  return node;
}

/** Everything in either solid. */
export function csgUnion(a: CsgPolygon[], b: CsgPolygon[], eps: number): CsgPolygon[] {
  const [A, B] = [tree(a, eps), tree(b, eps)];
  A.clipTo(B, eps);
  B.clipTo(A, eps);
  B.invert();
  B.clipTo(A, eps);
  B.invert();
  A.build(B.allPolygons(), eps);
  return A.allPolygons();
}

/** `a` with `b` cut out of it. */
export function csgSubtract(a: CsgPolygon[], b: CsgPolygon[], eps: number): CsgPolygon[] {
  const [A, B] = [tree(a, eps), tree(b, eps)];
  A.invert();
  A.clipTo(B, eps);
  B.clipTo(A, eps);
  B.invert();
  B.clipTo(A, eps);
  B.invert();
  A.build(B.allPolygons(), eps);
  A.invert();
  return A.allPolygons();
}

/** Only what is in both solids. */
export function csgIntersect(a: CsgPolygon[], b: CsgPolygon[], eps: number): CsgPolygon[] {
  const [A, B] = [tree(a, eps), tree(b, eps)];
  A.invert();
  B.clipTo(A, eps);
  B.invert();
  A.clipTo(B, eps);
  B.clipTo(A, eps);
  A.build(B.allPolygons(), eps);
  A.invert();
  return A.allPolygons();
}
