import { describe, expect, it } from 'vitest';
import { createBall, createBox, ModelerState, LAYER_COUNT } from '@/modeler';
import { defaultDisplay } from '@/render/retro';
import { decodeProject, encodeProject, FORMAT_VERSION, ProjectFormatError, type ProjectData } from './project';

function sample(): ProjectData {
  const ball = createBall({ radius: [0.7, 0.5, 0.3], center: [0.1, 0.2, 0.3], sides: 12, segments: 6, axis: 'z' });
  ball.surfaces[0] = { ...ball.surfaces[0]!, name: 'Pearl', color: [1, 0.44, 0.8], specular: 0.6, smoothing: true };
  const box = createBox({ size: [1, 2, 3], center: [0, 0, 0], segments: [2, 1, 1] });
  box.surfaces.push({ ...box.surfaces[0]!, name: 'Glass', doubleSided: true });
  box.polygons[1]!.surface = 1;
  const display = defaultDisplay();
  display.mode = 'shaded-wire';
  display.retro = { resolutionHeight: 180, colorLevels: 24, dither: 0.5 };
  return { layers: [box, ball], activeLayer: 1, display };
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
    const back = decodeProject(encodeProject({ layers: [], activeLayer: 0, display: defaultDisplay() }));
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
    data.display.retro = { resolutionHeight: 99999, colorLevels: -3, dither: 7 };
    data.activeLayer = 400;
    const back = decodeProject(encodeProject(data));
    expect(back.layers[0]!.surfaces[0]).toMatchObject({ name: 'Odd', diffuse: 1, smoothing: false });
    expect(back.display.retro).toEqual({ resolutionHeight: 2160, colorLevels: 2, dither: 1 });
    expect(back.activeLayer).toBe(LAYER_COUNT - 1);
  });

  it('is much smaller than the same model as JSON', () => {
    const ball = createBall({ radius: [1, 1, 1], center: [0, 0, 0], sides: 128, segments: 64, axis: 'y' });
    const json = JSON.stringify({ points: ball.points, polygons: ball.polygons, surfaces: ball.surfaces }).length;
    const binary = encodeProject({ layers: [ball], activeLayer: 0, display: defaultDisplay() }).byteLength;
    expect(binary).toBeLessThan(json * 0.55);
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
