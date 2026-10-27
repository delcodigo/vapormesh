import {
  defaultImages,
  defaultPalette,
  defaultSurface,
  isValidImageSize,
  Mesh,
  nearestIndex,
  PALETTE_SIZE,
  type IndexedImage,
  type Palette,
  type Surface,
  type UV,
  type Vec3,
} from '@/core';
import { LAYER_COUNT, type SelectMode } from '@/modeler';
import { defaultRetro, type DisplaySettings, type RetroOptions, type ViewMode } from '@/render/retro';
import type { ViewState } from '@/render/viewState';
import type { ViewKind } from '@/render/viewport';

/**
 * .vmesh project file: a small header, a JSON chunk for everything structured, then a binary chunk for the
 * bulk arrays. See docs/FORMAT.md. All numbers are little-endian.
 */
export const FORMAT_VERSION = 2;
const MAGIC = [0x56, 0x4d, 0x53, 0x48]; // "VMSH"
const HEADER_BYTES = 16; // magic, version, json length, binary length
const VIEW_MODES: ViewMode[] = ['wire', 'shaded', 'shaded-wire'];
const PALETTE_BYTES = PALETTE_SIZE * 3;

/** Everything about how the editor looks and is set up, as opposed to the model itself. */
export interface EditorState {
  selectMode: SelectMode;
  customPivot: Vec3 | null;
  /** Camera of each viewport, by kind. Missing views keep whatever they have. */
  views: Partial<Record<ViewKind, ViewState>>;
}

export interface ProjectData {
  layers: Mesh[];
  activeLayer: number;
  display: DisplaySettings;
  /** The project palette and the images surfaces refer to. */
  palette: Palette;
  images: IndexedImage[];
  /** Absent in files written before the editor state was saved. */
  editor?: EditorState;
}

const VIEW_KINDS: ViewKind[] = ['perspective', 'top', 'face', 'left'];

export class ProjectFormatError extends Error {}

interface LayerHeader {
  surfaces: Surface[];
  points: number;
  polygons: number;
  /** Total polygon vertex references across all polygons. */
  indices: number;
  /** Whether the layer carries a (u, v) per polygon corner. */
  uvs: boolean;
}

interface ImageHeader {
  name: string;
  width: number;
  height: number;
}

/**
 * Bytes a layer occupies in the binary chunk: float64 xyz per point, then per polygon its surface, length and
 * point indices, then (version 2, if flagged) a float64 u, v for every index.
 */
const layerBytes = (h: LayerHeader) => h.points * 24 + h.polygons * 8 + h.indices * 4 + (h.uvs ? h.indices * 16 : 0);
const imageBytes = (h: ImageHeader) => h.width * h.height;

export function encodeProject({ layers, activeLayer, display, palette, images, editor }: ProjectData): ArrayBuffer {
  const headers: LayerHeader[] = layers.map((m) => ({
    surfaces: m.surfaces,
    points: m.points.length,
    polygons: m.polygons.length,
    indices: m.polygons.reduce((n, p) => n + p.points.length, 0),
    uvs: m.polygons.some((p) => p.uvs),
  }));
  const imageHeaders: ImageHeader[] = images.map(({ name, width, height }) => ({ name, width, height }));
  const json = new TextEncoder().encode(
    JSON.stringify({
      app: 'VaporMesh',
      activeLayer,
      layers: headers,
      palette: true,
      images: imageHeaders,
      display: { mode: display.mode, retro: display.retro },
      editor,
    }),
  );
  const binLength = headers.reduce((n, h) => n + layerBytes(h), 0) + PALETTE_BYTES + imageHeaders.reduce((n, h) => n + imageBytes(h), 0);

  const out = new ArrayBuffer(HEADER_BYTES + json.length + binLength);
  const view = new DataView(out);
  MAGIC.forEach((b, i) => view.setUint8(i, b));
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, json.length, true);
  view.setUint32(12, binLength, true);
  new Uint8Array(out, HEADER_BYTES, json.length).set(json);

  let o = HEADER_BYTES + json.length;
  const u32 = (v: number) => {
    view.setUint32(o, v, true);
    o += 4;
  };
  const f64 = (v: number) => {
    view.setFloat64(o, v, true);
    o += 8;
  };
  layers.forEach((mesh, li) => {
    for (const p of mesh.points) p.forEach(f64);
    for (const poly of mesh.polygons) u32(poly.surface);
    for (const poly of mesh.polygons) u32(poly.points.length);
    for (const poly of mesh.polygons) for (const i of poly.points) u32(i);
    if (headers[li]!.uvs) {
      // a polygon without UVs among polygons that have them gets (0, 0) at every corner
      for (const poly of mesh.polygons) for (let c = 0; c < poly.points.length; c++) (poly.uvs?.[c] ?? [0, 0]).forEach(f64);
    }
  });
  new Uint8Array(out, o, PALETTE_BYTES).set(palette.subarray(0, PALETTE_BYTES));
  o += PALETTE_BYTES;
  for (const image of images) {
    new Uint8Array(out, o, image.pixels.length).set(image.pixels);
    o += image.pixels.length;
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function count(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new ProjectFormatError(`Invalid ${what} count`);
  return v;
}

/**
 * Read a surface leniently: unknown or missing fields fall back to defaults, so older and newer files still load.
 * Files written before surface colours became palette indices carry `color: [r, g, b]` (0..1); those map to the
 * nearest entry of the project palette.
 */
function parseSurface(raw: unknown, index: number, palette: Palette): Surface {
  const d = defaultSurface(`Surface ${index + 1}`);
  if (!isObject(raw)) return d;
  let colorIndex = d.colorIndex;
  if (typeof raw.colorIndex === 'number' && Number.isInteger(raw.colorIndex) && raw.colorIndex >= 0 && raw.colorIndex < PALETTE_SIZE) {
    colorIndex = raw.colorIndex;
  } else if (Array.isArray(raw.color) && raw.color.length === 3) {
    const [r, g, b] = raw.color.map((c) => clamp(num(c, 0.8), 0, 1) * 255);
    colorIndex = nearestIndex(palette, r!, g!, b!);
  }
  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name : d.name,
    colorIndex,
    diffuse: num(raw.diffuse, d.diffuse),
    luminosity: num(raw.luminosity, d.luminosity),
    specular: num(raw.specular, d.specular),
    glossiness: num(raw.glossiness, d.glossiness),
    smoothing: typeof raw.smoothing === 'boolean' ? raw.smoothing : d.smoothing,
    smoothingAngle: clamp(num(raw.smoothingAngle, d.smoothingAngle), 0, 180),
    doubleSided: typeof raw.doubleSided === 'boolean' ? raw.doubleSided : d.doubleSided,
    texture: typeof raw.texture === 'string' && raw.texture ? raw.texture : null,
    wrap: raw.wrap === 'clamp' ? 'clamp' : 'repeat',
  };
}

function parseDisplay(raw: unknown): DisplaySettings {
  const d = isObject(raw) ? raw : {};
  const r = isObject(d.retro) ? d.retro : {};
  const retro: RetroOptions = {
    resolutionHeight: clamp(Math.round(num(r.resolutionHeight, defaultRetro.resolutionHeight)), 16, 2160),
    colorLevels: clamp(Math.round(num(r.colorLevels, defaultRetro.colorLevels)), 2, 256),
    dither: clamp(num(r.dither, defaultRetro.dither), 0, 1),
    usePalette: typeof r.usePalette === 'boolean' ? r.usePalette : defaultRetro.usePalette,
  };
  return { mode: VIEW_MODES.includes(d.mode as ViewMode) ? (d.mode as ViewMode) : 'wire', retro };
}

const finiteVec3 = (v: unknown): Vec3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c)) ? (v as Vec3) : null;

/** Read the editor block leniently: bad pieces are dropped, never fatal, since this is only cosmetic state. */
function parseEditor(raw: unknown): EditorState | undefined {
  if (!isObject(raw)) return undefined;
  const views: EditorState['views'] = {};
  const rawViews = isObject(raw.views) ? raw.views : {};
  for (const kind of VIEW_KINDS) {
    const v = rawViews[kind];
    const target = isObject(v) ? finiteVec3(v.target) : null;
    if (!isObject(v) || !target) continue;
    const view: ViewState = { target };
    for (const key of ['orthoSize', 'radius', 'theta', 'phi'] as const) {
      if (typeof v[key] === 'number' && Number.isFinite(v[key])) view[key] = v[key] as number;
    }
    views[kind] = view;
  }
  return {
    selectMode: raw.selectMode === 'polygons' ? 'polygons' : 'points',
    customPivot: finiteVec3(raw.customPivot),
    views,
  };
}

function parseImageHeaders(raw: unknown): ImageHeader[] {
  if (!Array.isArray(raw)) throw new ProjectFormatError('Invalid image list');
  const seen = new Set<string>();
  return raw.map((h): ImageHeader => {
    if (!isObject(h) || typeof h.name !== 'string' || !h.name) throw new ProjectFormatError('Invalid image entry');
    if (seen.has(h.name)) throw new ProjectFormatError(`Two images are named "${h.name}"`);
    seen.add(h.name);
    if (!isValidImageSize(h.width as number) || !isValidImageSize(h.height as number)) {
      throw new ProjectFormatError(`Image "${h.name}" has an invalid size`);
    }
    return { name: h.name, width: h.width as number, height: h.height as number };
  });
}

/** Parse and validate a .vmesh file (version 1 or 2). Throws ProjectFormatError, never partially returns a bad model. */
export function decodeProject(buffer: ArrayBuffer): ProjectData {
  if (buffer.byteLength < HEADER_BYTES) throw new ProjectFormatError('File is too small to be a VaporMesh project');
  const view = new DataView(buffer);
  if (MAGIC.some((b, i) => view.getUint8(i) !== b)) throw new ProjectFormatError('Not a VaporMesh project file');
  const version = view.getUint32(4, true);
  if (version < 1 || version > FORMAT_VERSION) {
    throw new ProjectFormatError(`File format version ${version} is not supported (this build reads up to ${FORMAT_VERSION})`);
  }
  const jsonLength = view.getUint32(8, true);
  const binLength = view.getUint32(12, true);
  if (HEADER_BYTES + jsonLength + binLength !== buffer.byteLength) {
    throw new ProjectFormatError('File is truncated or corrupt (sizes do not match)');
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, HEADER_BYTES, jsonLength)));
  } catch {
    throw new ProjectFormatError('Project metadata is unreadable');
  }
  if (!isObject(manifest) || !Array.isArray(manifest.layers)) throw new ProjectFormatError('Project metadata is missing its layers');
  if (manifest.layers.length > LAYER_COUNT) throw new ProjectFormatError(`Too many layers (${manifest.layers.length} > ${LAYER_COUNT})`);

  // Version 1 stops at the layers; the palette, images and UVs below only exist from version 2 on.
  const v2 = version >= 2;
  const headers = manifest.layers.map((raw): LayerHeader => {
    if (!isObject(raw)) throw new ProjectFormatError('Invalid layer entry');
    return {
      surfaces: Array.isArray(raw.surfaces) ? (raw.surfaces as Surface[]) : [],
      points: count(raw.points, 'point'),
      polygons: count(raw.polygons, 'polygon'),
      indices: count(raw.indices, 'index'),
      uvs: v2 && raw.uvs === true,
    };
  });
  const hasPalette = v2 && manifest.palette === true;
  const imageHeaders = v2 && manifest.images !== undefined ? parseImageHeaders(manifest.images) : [];

  // Validate every size against the real buffer before allocating anything, so a hostile header can't ask for gigabytes.
  const expected =
    headers.reduce((n, h) => n + layerBytes(h), 0) + (hasPalette ? PALETTE_BYTES : 0) + imageHeaders.reduce((n, h) => n + imageBytes(h), 0);
  if (expected !== binLength) throw new ProjectFormatError('Geometry size does not match the project metadata');

  // The layers come first in the file, then the palette, then the images. Surfaces need the palette, so read it first.
  const layersEnd = HEADER_BYTES + jsonLength + headers.reduce((n, h) => n + layerBytes(h), 0);
  const palette: Palette = hasPalette ? new Uint8Array(buffer.slice(layersEnd, layersEnd + PALETTE_BYTES)) : defaultPalette();

  let o = HEADER_BYTES + jsonLength;
  const u32 = () => {
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };
  const f64 = () => {
    const v = view.getFloat64(o, true);
    o += 8;
    return v;
  };
  const layers = headers.map((h, li) => {
    const mesh = new Mesh();
    mesh.surfaces = h.surfaces.map((raw, i) => parseSurface(raw, i, palette));
    if (mesh.surfaces.length === 0) mesh.surfaces.push(defaultSurface());

    for (let i = 0; i < h.points; i++) {
      const p: Vec3 = [f64(), f64(), f64()];
      if (!p.every(Number.isFinite)) throw new ProjectFormatError(`Layer ${li + 1}: point ${i} is not a finite number`);
      mesh.points.push(p);
    }
    const surfaces = Array.from({ length: h.polygons }, u32);
    const lengths = Array.from({ length: h.polygons }, u32);
    if (lengths.reduce((a, b) => a + b, 0) !== h.indices) throw new ProjectFormatError(`Layer ${li + 1}: polygon sizes do not add up`);
    for (let pi = 0; pi < h.polygons; pi++) {
      if (surfaces[pi]! >= mesh.surfaces.length) throw new ProjectFormatError(`Layer ${li + 1}: polygon ${pi} uses a missing surface`);
      if (lengths[pi]! === 0) throw new ProjectFormatError(`Layer ${li + 1}: polygon ${pi} has no points`);
      const points = Array.from({ length: lengths[pi]! }, u32);
      if (points.some((i) => i >= h.points)) throw new ProjectFormatError(`Layer ${li + 1}: polygon ${pi} refers to a missing point`);
      mesh.polygons.push({ points, surface: surfaces[pi]! });
    }
    if (h.uvs) {
      for (const poly of mesh.polygons) {
        poly.uvs = poly.points.map((): UV => [f64(), f64()]);
        if (!poly.uvs.every((uv) => uv.every(Number.isFinite))) throw new ProjectFormatError(`Layer ${li + 1}: a UV is not a finite number`);
      }
    }
    return mesh;
  });

  o = layersEnd + (hasPalette ? PALETTE_BYTES : 0);
  // Files from before version 2 had no images; give them the same starter images a new project has.
  const images: IndexedImage[] = v2
    ? imageHeaders.map((h) => {
        const pixels = new Uint8Array(buffer.slice(o, o + imageBytes(h)));
        o += imageBytes(h);
        return { name: h.name, width: h.width, height: h.height, pixels };
      })
    : defaultImages();

  const active = Math.round(num(manifest.activeLayer, 0));
  return {
    layers,
    activeLayer: clamp(active, 0, LAYER_COUNT - 1),
    display: parseDisplay(manifest.display),
    palette,
    images,
    editor: parseEditor(manifest.editor),
  };
}
