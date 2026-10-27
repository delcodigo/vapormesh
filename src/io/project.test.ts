import { describe, expect, it } from 'vitest';
import { createImage, defaultImages, defaultPalette, Mesh } from '@/core';
import { createBall, createBox, ModelerState, LAYER_COUNT } from '@/modeler';
import { defaultDisplay } from '@/render/retro';
import { decodeProject, encodeProject, FORMAT_VERSION, ProjectFormatError, type ProjectData } from './project';

function sample(): ProjectData {
  const ball = createBall({ radius: [0.7, 0.5, 0.3], center: [0.1, 0.2, 0.3], sides: 12, segments: 6, axis: 'z' });
  ball.surfaces[0] = { ...ball.surfaces[0]!, name: 'Pearl', color: [1, 0.44, 0.8], specular: 0.6, smoothing: true };
  const box = createBox({ size: [1, 2, 3], center: [0, 0, 0], segments: [2, 1, 1] });
  box.surfaces.push({ ...box.surfaces[0]!, name: 'Glass', doubleSided: true });
  box.polygons[1]!.surface = 1;
  box.surfaces[1]!.texture = 'Hero';
  box.surfaces[1]!.wrap = 'clamp';
  const palette = defaultPalette();
  palette[5] = 200;
  const hero = createImage('Hero', 32, 16, 3);
  hero.pixels[17] = 99;
  const images = [...defaultImages(), hero];
  const display = defaultDisplay();
  display.mode = 'shaded-wire';
  display.retro = { resolutionHeight: 180, colorLevels: 24, dither: 0.5, usePalette: false };
  const editor = {
    selectMode: 'polygons' as const,
    customPivot: [1, 2, 3] as [number, number, number],
    views: {
      perspective: { target: [0.5, 0, -1] as [number, number, number], radius: 9, theta: 2.5, phi: 0.7 },
      top: { target: [3, 0, 4] as [number, number, number], orthoSize: 12.5 },
    },
  };
  return { layers: [box, ball], activeLayer: 1, display, editor, palette, images };
}

/** Rewrite the 4 header words so tampering tests don't trip the size check first. */
const withHeader = (buf: ArrayBuffer, word: number, value: number) => {
  const copy = buf.slice(0);
  new DataView(copy).setUint32(word * 4, value, true);
  return copy;
};

describe('project file', () => {
  it('round-trips layers, surfaces, active layer and display settings exactly', () => {
    const original = sample();
    const back = decodeProject(encodeProject(original));
    expect(back.activeLayer).toBe(1);
    expect(back.display).toEqual(original.display);
    expect(back.editor).toEqual(original.editor);
    expect(back.palette).toEqual(original.palette);
    expect(back.images).toEqual(original.images);
    expect(back.layers).toHaveLength(2);
    back.layers.forEach((m, i) => {
      expect(m.points).toEqual(original.layers[i]!.points); // float64: bit-exact
      expect(m.polygons).toEqual(original.layers[i]!.polygons);
      expect(m.surfaces).toEqual(original.layers[i]!.surfaces);
    });
  });

  it('keeps the metadata readable as JSON right after the 16-byte header', () => {
    const bytes = new Uint8Array(encodeProject(sample()));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('VMSH');
    const text = new TextDecoder().decode(bytes.slice(16, 200));
    expect(text.startsWith('{"app":"VaporMesh"')).toBe(true);
  });

  it('loads an empty project', () => {
    const back = decodeProject(encodeProject({ layers: [], activeLayer: 0, display: defaultDisplay(), palette: defaultPalette(), images: [] }));
    expect(back.layers).toEqual([]);
  });

  it('rejects files that are not projects, are truncated or are from a newer version', () => {
    const good = encodeProject(sample());
    expect(() => decodeProject(new ArrayBuffer(4))).toThrow(ProjectFormatError);
    expect(() => decodeProject(new TextEncoder().encode('{"layers":[]} not a project at all').buffer)).toThrow(/Not a VaporMesh/);
    expect(() => decodeProject(good.slice(0, good.byteLength - 1))).toThrow(/truncated/);
    expect(() => decodeProject(withHeader(good, 1, FORMAT_VERSION + 1))).toThrow(/not supported/);
    expect(() => decodeProject(withHeader(good, 1, 0))).toThrow(/not supported/);
  });

  it('refuses a header that claims more geometry than the file holds, without allocating it', () => {
    const json = new TextEncoder().encode(
      JSON.stringify({ layers: [{ surfaces: [], points: 2_000_000_000, polygons: 0, indices: 0 }], activeLayer: 0 }),
    );
    const out = new ArrayBuffer(16 + json.length);
    const v = new DataView(out);
    'VMSH'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
    v.setUint32(4, 1, true);
    v.setUint32(8, json.length, true);
    new Uint8Array(out, 16).set(json);
    expect(() => decodeProject(out)).toThrow(/does not match/);
  });

  it('rejects polygons that point at missing points or surfaces', () => {
    const data = sample();
    data.layers[0]!.polygons[0]!.points[0] = 9999;
    expect(() => decodeProject(encodeProject(data))).toThrow(/missing point/);
    const data2 = sample();
    data2.layers[0]!.polygons[0]!.surface = 7;
    expect(() => decodeProject(encodeProject(data2))).toThrow(/missing surface/);
  });

  it('rejects non-finite coordinates and too many layers', () => {
    const data = sample();
    data.layers[0]!.points[0] = [NaN, 0, 0];
    expect(() => decodeProject(encodeProject(data))).toThrow(/finite/);
    const many = { ...sample(), layers: Array.from({ length: LAYER_COUNT + 1 }, () => createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [1, 1, 1] })) };
    expect(() => decodeProject(encodeProject(many))).toThrow(/Too many layers/);
  });

  it('fills in defaults for surface and display fields it does not know, and clamps wild values', () => {
    const data = sample();
    data.layers[0]!.surfaces[0] = { name: 'Odd' } as never;
    data.display.retro = { resolutionHeight: 99999, colorLevels: -3, dither: 7, usePalette: false };
    data.activeLayer = 400;
    const back = decodeProject(encodeProject(data));
    expect(back.layers[0]!.surfaces[0]).toMatchObject({ name: 'Odd', diffuse: 1, smoothing: false });
    expect(back.display.retro).toEqual({ resolutionHeight: 2160, colorLevels: 2, dither: 1, usePalette: false });
    expect(back.activeLayer).toBe(LAYER_COUNT - 1);
  });

  it('is much smaller than the same model as JSON', () => {
    const ball = createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 128, segments: 64, axis: 'y' });
    const json = JSON.stringify({ points: ball.points, polygons: ball.polygons, surfaces: ball.surfaces }).length;
    const binary = encodeProject({ layers: [ball], activeLayer: 0, display: defaultDisplay(), palette: defaultPalette(), images: [] }).byteLength;
    expect(binary).toBeLessThan(json * 0.55);
  });
});

/** Build a version 1 file the way the first release wrote it: layers only, no UVs, palette or images. */
function encodeV1(layers: Mesh[]): ArrayBuffer {
  const headers = layers.map((m) => ({ surfaces: m.surfaces, points: m.points.length, polygons: m.polygons.length, indices: m.polygons.reduce((n, p) => n + p.points.length, 0) }));
  const json = new TextEncoder().encode(JSON.stringify({ app: 'VaporMesh', activeLayer: 0, layers: headers }));
  const bin = headers.reduce((n, h) => n + h.points * 24 + h.polygons * 8 + h.indices * 4, 0);
  const out = new ArrayBuffer(16 + json.length + bin);
  const v = new DataView(out);
  'VMSH'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true);
  v.setUint32(8, json.length, true);
  v.setUint32(12, bin, true);
  new Uint8Array(out, 16, json.length).set(json);
  let o = 16 + json.length;
  for (const m of layers) {
    for (const p of m.points) for (const c of p) { v.setFloat64(o, c, true); o += 8; }
    for (const poly of m.polygons) { v.setUint32(o, poly.surface, true); o += 4; }
    for (const poly of m.polygons) { v.setUint32(o, poly.points.length, true); o += 4; }
    for (const poly of m.polygons) for (const i of poly.points) { v.setUint32(o, i, true); o += 4; }
  }
  return out;
}

describe('format version 2', () => {
  it('writes version 2 and keeps UVs per corner, including polygons that have none', () => {
    const data = sample();
    delete data.layers[0]!.polygons[2]!.uvs; // among polygons that have UVs
    const bytes = encodeProject(data);
    expect(new DataView(bytes).getUint32(4, true)).toBe(2);
    const back = decodeProject(bytes);
    expect(back.layers[1]!.polygons.every((p) => p.uvs?.length === p.points.length)).toBe(true);
    expect(back.layers[0]!.polygons[0]!.uvs).toEqual(data.layers[0]!.polygons[0]!.uvs);
    expect(back.layers[0]!.polygons[2]!.uvs).toEqual(data.layers[0]!.polygons[2]!.points.map(() => [0, 0]));
  });

  it('writes no UV data for a layer that has none, so old-style meshes stay compact', () => {
    const plain = createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [1, 1, 1] });
    plain.polygons.forEach((p) => delete p.uvs);
    const withUvs = createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [1, 1, 1] });
    // length of the binary chunk (header word 3); the JSON metadata differs by a character, so don't compare whole files
    const size = (m: Mesh) =>
      new DataView(encodeProject({ layers: [m], activeLayer: 0, display: defaultDisplay(), palette: defaultPalette(), images: [] })).getUint32(12, true);
    expect(size(withUvs) - size(plain)).toBe(24 * 16); // 24 corners x (u, v) x 8 bytes
    expect(decodeProject(encodeProject({ layers: [plain], activeLayer: 0, display: defaultDisplay(), palette: defaultPalette(), images: [] })).layers[0]!.polygons[0]!.uvs).toBeUndefined();
  });

  it('still loads a version 1 file, adding the default palette and starter images', () => {
    const box = createBox({ size: [1, 2, 3], center: [0, 0, 0], segments: [1, 1, 1] });
    box.polygons.forEach((p) => delete p.uvs);
    const back = decodeProject(encodeV1([box]));
    expect(back.layers[0]!.points).toEqual(box.points);
    expect(back.layers[0]!.surfaces[0]).toMatchObject({ texture: null, wrap: 'repeat' });
    expect(back.palette).toEqual(defaultPalette());
    expect(back.images.map((i) => i.name)).toEqual(['Checker', 'UV Grid']);
  });

  it('keeps a project with no images, which is different from an old file with none', () => {
    const data = { ...sample(), images: [] };
    expect(decodeProject(encodeProject(data)).images).toEqual([]);
  });

  it('rejects images with bad sizes, duplicate names, and sizes that do not match the data', () => {
    const tweak = (mutate: (m: { images: unknown }) => void) => {
      const bytes = new Uint8Array(encodeProject(sample()));
      const jsonLength = new DataView(bytes.buffer).getUint32(8, true);
      const manifest = JSON.parse(new TextDecoder().decode(bytes.slice(16, 16 + jsonLength)));
      mutate(manifest);
      const json = new TextEncoder().encode(JSON.stringify(manifest));
      const binary = bytes.slice(16 + jsonLength);
      const out = new Uint8Array(16 + json.length + binary.length);
      out.set(bytes.slice(0, 16));
      new DataView(out.buffer).setUint32(8, json.length, true);
      out.set(json, 16);
      out.set(binary, 16 + json.length);
      return out.buffer;
    };
    expect(() => decodeProject(tweak((m) => ((m.images as { width: number }[])[0]!.width = 100)))).toThrow(/invalid size/);
    expect(() => decodeProject(tweak((m) => ((m.images as { name: string }[])[1]!.name = 'Checker')))).toThrow(/Two images/);
    expect(() => decodeProject(tweak((m) => ((m.images as { height: number }[])[0]!.height = 128)))).toThrow(/does not match/);
    expect(() => decodeProject(tweak((m) => (m.images = 'nope')))).toThrow(/image list/);
  });

  it('rejects a UV that is not a number', () => {
    const data = sample();
    data.layers[1]!.polygons[0]!.uvs![0] = [NaN, 0];
    expect(() => decodeProject(encodeProject(data))).toThrow(/UV/);
  });

  it('reads surface textures leniently', () => {
    const data = sample();
    data.layers[0]!.surfaces[0] = { name: 'X', texture: 42, wrap: 'sideways' } as never;
    const s = decodeProject(encodeProject(data)).layers[0]!.surfaces[0]!;
    expect(s.texture).toBeNull();
    expect(s.wrap).toBe('repeat');
  });
});

describe('editor state in the file', () => {
  it('is optional: files without it load, and report no editor state', () => {
    const { editor: _omitted, ...rest } = sample();
    expect(decodeProject(encodeProject(rest)).editor).toBeUndefined();
  });

  it('drops bad pieces without failing the load', () => {
    const data = sample();
    data.editor = {
      selectMode: 'sideways' as never,
      customPivot: [NaN, 0, 0],
      views: {
        top: { target: [1, 2] as never, orthoSize: 5 }, // wrong shape: whole view dropped
        face: { target: [1, 2, 3], orthoSize: NaN }, // bad field dropped, view kept
        left: { target: [0, 0, 0], orthoSize: 7 },
      },
    };
    const back = decodeProject(encodeProject(data)).editor!;
    expect(back.selectMode).toBe('points');
    expect(back.customPivot).toBeNull();
    expect(back.views.top).toBeUndefined();
    expect(back.views.face).toEqual({ target: [1, 2, 3] });
    expect(back.views.left).toEqual({ target: [0, 0, 0], orthoSize: 7 });
  });
});

describe('ModelerState.loadLayers', () => {
  it('replaces the model, pads missing layers, and clears history, selection and pivot', () => {
    const s = new ModelerState(createBox({ size: [1, 1, 1], center: [0, 0, 0], segments: [1, 1, 1] }));
    s.applySelection([0, 1], 'replace');
    s.setPivot([1, 2, 3]);
    s.undo(); // no-op, but history exists conceptually
    const before = s.history.revision;
    s.loadLayers([createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 6, segments: 3, axis: 'y' })], 5);
    expect(s.layers).toHaveLength(LAYER_COUNT);
    expect(s.activeLayer).toBe(5);
    expect(s.layers[5]!.points).toHaveLength(0); // padded, and the loaded ball is on layer 0
    expect(s.layers[0]!.points.length).toBeGreaterThan(0);
    expect(s.selection.size).toBe(0);
    expect(s.customPivot).toBeNull();
    expect(s.history.canUndo).toBe(false);
    expect(s.history.revision).not.toBe(before);
  });
});
