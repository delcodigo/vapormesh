import { defaultSurface, Mesh, nearestIndex, paletteColor, type Palette, type Surface, type UV, type Vec3 } from '@/core';

/**
 * Wavefront .obj import and export, the plain-text format nearly every 3D tool reads. Coordinates and winding are kept as they
 * are (right-handed, counter-clockwise faces point out). UVs are flipped between VaporMesh's top-left origin and OBJ's
 * bottom-left one. Surfaces travel as a companion .mtl file: the colour and shininess in the standard fields, everything else
 * (diffuse, luminosity, smoothing angle, double-sided, the texture's name) in a `# vapormesh {...}` comment other tools skip.
 * Smoothing is the OBJ's own `s` lines. Texture images are not written: an OBJ can only point at an image file and the project
 * keeps its images inside the .vmesh.
 */
export class ObjFormatError extends Error {}

/** The most polygons one file may bring in; beyond this the editor would crawl, and it is far past a 90s asset. */
export const MAX_OBJ_POLYGONS = 100000;

// --- export ----------------------------------------------------------------------------------------------------------

const number = (n: number): string => {
  const s = n.toFixed(6);
  const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return trimmed === '-0' ? '0' : trimmed;
};
/** OBJ names are single tokens. */
const token = (name: string): string => name.trim().replace(/\s+/g, '_') || 'unnamed';

export interface ObjExport {
  obj: string;
  mtl: string;
  polygons: number;
}

/**
 * Write the non-empty layers as OBJ objects (`o Layer_1`, ...) and their surfaces as materials. `mtlName` is the file name the
 * OBJ will refer to. Points are shared within a layer, so the model stays welded; polygons keep their order and n-gons stay
 * n-gons.
 */
export function exportObj(layers: readonly Mesh[], palette: Palette, mtlName: string): ObjExport {
  const lines: string[] = ['# VaporMesh OBJ export', `mtllib ${mtlName}`];
  const materials: string[] = ['# VaporMesh materials'];
  const named = new Map<string, string>(); // a surface's full description -> its material name
  const used = new Set<string>();
  const uvIndex = new Map<string, number>();
  const uvLines: string[] = [];
  let base = 0;
  let polygons = 0;

  const materialOf = (s: Surface): string => {
    const key = JSON.stringify([s.name, s.colorIndex, s.diffuse, s.luminosity, s.specular, s.glossiness, s.texture]);
    const known = named.get(key);
    if (known) return known;
    let name = token(s.name);
    for (let n = 2; used.has(name); n++) name = `${token(s.name)}_${n}`; // two different surfaces with one name
    used.add(name);
    named.set(key, name);
    const [r, g, b] = paletteColor(palette, s.colorIndex);
    materials.push('', `newmtl ${name}`, `Kd ${number(r / 255)} ${number(g / 255)} ${number(b / 255)}`);
    if (s.luminosity > 0) materials.push(`Ke ${number((r / 255) * s.luminosity)} ${number((g / 255) * s.luminosity)} ${number((b / 255) * s.luminosity)}`);
    if (s.specular > 0) materials.push(`Ks ${number(s.specular)} ${number(s.specular)} ${number(s.specular)}`, `Ns ${Math.round(Math.pow(2, 2 + s.glossiness * 8))}`);
    materials.push('d 1', `illum ${s.specular > 0 ? 2 : 1}`);
    // what the standard fields cannot say, in a comment that every other tool ignores
    const extras = { diffuse: s.diffuse, luminosity: s.luminosity, specular: s.specular, glossiness: s.glossiness, smoothingAngle: s.smoothingAngle, doubleSided: s.doubleSided, texture: s.texture, wrap: s.wrap, transparent: s.transparent };
    materials.push(`# vapormesh ${JSON.stringify(extras)}`);
    if (s.texture) materials.push(`# texture: ${s.texture} (images are not exported; they live in the .vmesh)`);
    return name;
  };
  const uvOf = ([u, v]: UV): number => {
    const key = `${number(u)} ${number(1 - v)}`;
    let index = uvIndex.get(key);
    if (index === undefined) {
      uvLines.push(`vt ${key}`);
      index = uvLines.length;
      uvIndex.set(key, index);
    }
    return index;
  };

  const body: string[] = [];
  layers.forEach((layer, li) => {
    if (layer.polygons.length === 0 && layer.points.length === 0) return;
    body.push(`o Layer_${li + 1}`);
    for (const p of layer.points) body.push(`v ${number(p[0])} ${number(p[1])} ${number(p[2])}`);
    let material: string | null = null;
    let smooth: boolean | null = null;
    for (const poly of layer.polygons) {
      const surface = layer.surfaces[poly.surface] ?? defaultSurface();
      const name = materialOf(surface);
      if (name !== material) body.push(`usemtl ${name}`);
      if (surface.smoothing !== smooth) body.push(surface.smoothing ? 's 1' : 's off');
      material = name;
      smooth = surface.smoothing;
      const corners = poly.points.map((p, i) => {
        const v = base + p + 1;
        return poly.uvs?.[i] ? `${v}/${uvOf(poly.uvs[i]!)}` : String(v);
      });
      body.push(`f ${corners.join(' ')}`);
      polygons++;
    }
    base += layer.points.length;
  });
  return { obj: [...lines, ...uvLines, ...body].join('\n') + '\n', mtl: materials.join('\n') + '\n', polygons };
}

// --- import ----------------------------------------------------------------------------------------------------------

export interface ObjGroup {
  name: string;
  mesh: Mesh;
}

export interface ObjImport {
  groups: ObjGroup[];
  /** Faces that were left out: too few points, or indices that point at nothing. */
  skippedFaces: number;
  /** Lines with something VaporMesh ignores (lines, free points, curves). */
  ignoredLines: number;
  /** True when a .mtl was supplied and its colours were used. */
  usedMaterials: boolean;
}

/** What a .mtl says about one material: its colour (0..1 per channel), and the VaporMesh extras if it came from VaporMesh. */
export interface ObjMaterial {
  color: [number, number, number];
  surface?: Partial<Surface>;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The surface fields of a `# vapormesh {...}` comment that are well-formed; anything else in it is ignored. */
function readExtras(json: string): Partial<Surface> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Surface> = {};
  for (const key of ['diffuse', 'luminosity', 'specular', 'glossiness'] as const) if (isNumber(raw[key]) && raw[key] >= 0 && raw[key] <= 1) out[key] = raw[key];
  if (isNumber(raw.smoothingAngle) && raw.smoothingAngle >= 0 && raw.smoothingAngle <= 180) out.smoothingAngle = raw.smoothingAngle;
  if (typeof raw.doubleSided === 'boolean') out.doubleSided = raw.doubleSided;
  if (raw.texture === null || typeof raw.texture === 'string') out.texture = raw.texture;
  if (typeof raw.transparent === 'boolean') out.transparent = raw.transparent;
  if (raw.wrap === 'repeat' || raw.wrap === 'clamp') out.wrap = raw.wrap;
  return out;
}

/** Materials by name from a .mtl file. */
export function parseMtl(text: string): Map<string, ObjMaterial> {
  const out = new Map<string, ObjMaterial>();
  let current: string | null = null;
  let extras: Partial<Surface> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const parts = line.split(/\s+/);
    if (parts[0] === 'newmtl' && parts[1]) {
      current = parts.slice(1).join(' ');
      extras = undefined;
    } else if (parts[0] === 'Kd' && current) {
      const rgb = parts.slice(1, 4).map(Number);
      if (rgb.length === 3 && rgb.every(Number.isFinite)) out.set(current, { color: rgb as [number, number, number], ...(extras && { surface: extras }) });
    } else if (line.startsWith('# vapormesh ') && current) {
      extras = readExtras(line.slice('# vapormesh '.length));
      const known = out.get(current);
      if (known) known.surface = extras;
    }
  }
  return out;
}

/**
 * Read an OBJ. Each `o` / `g` becomes a group (a Mesh with only the points its faces use). `usemtl` becomes a surface, coloured
 * from the .mtl's `Kd` (nearest palette colour) when `materials` is given. Anything it cannot use is skipped and counted; a
 * file with no usable faces is an error.
 */
export function parseObj(text: string, palette: Palette, materials?: Map<string, ObjMaterial>): ObjImport {
  const positions: (Vec3 | null)[] = [];
  const texcoords: (UV | null)[] = [];
  const groups: { name: string; faces: { v: number[]; vt: (number | null)[]; material: string | null; smooth: boolean }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let material: string | null = null;
  let smooth = false;
  let skippedFaces = 0;
  let ignoredLines = 0;
  let polygonCount = 0;

  const startGroup = (name: string) => {
    // a name straight after another name, with no faces between, just renames the empty group
    if (current && current.faces.length === 0) current.name = name;
    else groups.push((current = { name, faces: [] }));
  };
  /** An OBJ index is 1-based, or negative to count back from the latest; returns the 0-based index or -1. */
  const resolve = (token: string, count: number): number => {
    if (token === '') return -1;
    const n = Number(token);
    if (!Number.isInteger(n) || n === 0) return -1;
    const i = n > 0 ? n - 1 : count + n;
    return i >= 0 && i < count ? i : -1;
  };

  // a trailing backslash continues the line
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    switch (parts[0]) {
      case 'v': {
        const xyz = parts.slice(1, 4).map(Number);
        // a bad vertex still takes its place in the numbering, so later faces keep pointing at the right ones
        positions.push(xyz.length === 3 && xyz.every(Number.isFinite) ? (xyz as Vec3) : null);
        break;
      }
      case 'vt': {
        const uv = parts.slice(1, 3).map(Number);
        texcoords.push(uv.length >= 2 && uv.every(Number.isFinite) ? [uv[0]!, uv[1]!] : null);
        break;
      }
      case 'o':
      case 'g':
        startGroup(parts.slice(1).join(' ') || 'Object');
        break;
      case 'usemtl':
        material = parts.slice(1).join(' ') || null;
        break;
      case 'f': {
        if (!current) startGroup('Object');
        const v: number[] = [];
        const vt: (number | null)[] = [];
        let ok = parts.length >= 4;
        for (const corner of parts.slice(1)) {
          const [pv = '', pt = ''] = corner.split('/');
          const vi = resolve(pv, positions.length);
          const ti = pt === '' ? -1 : resolve(pt, texcoords.length);
          if (vi < 0 || !positions[vi]) {
            ok = false;
            break;
          }
          // a repeat of the point just before it adds nothing
          if (v.length && v[v.length - 1] === vi) continue;
          v.push(vi);
          vt.push(ti >= 0 && texcoords[ti] ? ti : null);
        }
        if (v.length > 1 && v[0] === v[v.length - 1]) {
          v.pop();
          vt.pop();
        }
        if (!ok || v.length < 3) {
          skippedFaces++;
          break;
        }
        if (++polygonCount > MAX_OBJ_POLYGONS) throw new ObjFormatError(`This file has more than ${MAX_OBJ_POLYGONS} polygons, far more than a low-poly asset needs`);
        current!.faces.push({ v, vt, material, smooth });
        break;
      }
      case 's':
        smooth = !!parts[1] && parts[1] !== 'off' && parts[1] !== '0'; // a smoothing group number, or off
        break;
      case 'vn':
      case 'mtllib':
      case 'vp':
        break; // normals are recomputed, and the .mtl comes separately
      default:
        ignoredLines++; // l, p, curves, surfaces, ...
    }
  }

  const result: ObjGroup[] = [];
  for (const group of groups) {
    if (group.faces.length === 0) continue;
    const mesh = new Mesh();
    const local = new Map<number, number>();
    const surfaceOf = new Map<string, number>();
    for (const face of group.faces) {
      const points = face.v.map((vi) => {
        let li = local.get(vi);
        if (li === undefined) {
          li = mesh.addPoint([...positions[vi]!] as Vec3);
          local.set(vi, li);
        }
        return li;
      });
      // a surface is a material and whether it is smoothed: one material used both ways becomes two surfaces
      const key = `${face.material ?? ''}|${face.smooth}`;
      let surface = surfaceOf.get(key);
      if (surface === undefined) {
        if (!face.material && !face.smooth) surface = 0; // the default surface
        else {
          const base = face.material ?? 'Smooth';
          const clash = !!face.material && [...surfaceOf.keys()].some((k) => k.startsWith(`${face.material ?? ''}|`));
          const s = defaultSurface(clash ? `${base} (${face.smooth ? 'smooth' : 'flat'})` : base);
          const info = face.material ? materials?.get(face.material) : undefined;
          if (info) s.colorIndex = nearestIndex(palette, info.color[0] * 255, info.color[1] * 255, info.color[2] * 255);
          Object.assign(s, info?.surface, { smoothing: face.smooth });
          surface = mesh.surfaces.push(s) - 1;
        }
        surfaceOf.set(key, surface);
      }
      const poly = { points, surface } as { points: number[]; surface: number; uvs?: UV[] };
      if (face.vt.every((t) => t !== null)) poly.uvs = face.vt.map((t) => [texcoords[t!]![0], 1 - texcoords[t!]![1]] as UV);
      mesh.polygons.push(poly);
    }
    // the placeholder default surface is only worth keeping if some polygon uses it
    if (mesh.surfaces.length > 1 && !mesh.polygons.some((p) => p.surface === 0)) {
      mesh.surfaces.shift();
      mesh.polygons.forEach((p) => p.surface--);
    }
    result.push({ name: group.name, mesh });
  }
  if (result.length === 0) throw new ObjFormatError(skippedFaces ? 'None of the faces in this file could be used' : 'This file has no faces');
  return { groups: result, skippedFaces, ignoredLines, usedMaterials: !!materials && materials.size > 0 };
}
