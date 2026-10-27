import { describe, expect, it } from 'vitest';
import { assignAutoUvs, defaultPalette, Mesh, paletteColor, type Vec3 } from '@/core';
import { box } from '@/modeler/primitives';
import { exportObj, MAX_OBJ_POLYGONS, ObjFormatError, parseMtl, parseObj } from './obj';

const palette = defaultPalette();
const cube = () => {
  const m = box(1, 2, 3);
  assignAutoUvs(m);
  return m;
};
/** Polygons as lists of corner positions, so meshes with different numbering can be compared. */
const shape = (m: Mesh) => m.polygons.map((p) => p.points.map((i) => m.points[i]!.map((c) => Math.round(c * 1e5) / 1e5)));

describe('exportObj', () => {
  it('writes vertices, UVs and 1-based faces, and refers to the material file', () => {
    const { obj, polygons } = exportObj([cube()], palette, 'crate.mtl');
    const lines = obj.split('\n');
    expect(lines[1]).toBe('mtllib crate.mtl');
    expect(lines.filter((l) => l.startsWith('v '))).toHaveLength(8);
    expect(lines.filter((l) => l.startsWith('f '))).toHaveLength(6);
    expect(polygons).toBe(6);
    expect(lines.find((l) => l.startsWith('f '))).toMatch(/^f (\d+\/\d+ ){3}\d+\/\d+$/);
    expect(lines.filter((l) => l.startsWith('f ')).join(' ')).not.toMatch(/\b0\b|\/0\b/); // 1-based
  });

  it('flips v, since OBJ counts up from the bottom of the image', () => {
    const m = new Mesh();
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((p) => m.addPoint(p as Vec3));
    m.polygons.push({ points: [0, 1, 2], surface: 0, uvs: [[0, 0], [1, 0], [0.25, 1]] });
    const lines = exportObj([m], palette, 'x.mtl').obj.split('\n');
    expect(lines.filter((l) => l.startsWith('vt '))).toEqual(['vt 0 1', 'vt 1 1', 'vt 0.25 0']);
  });

  it('writes plain faces when a polygon has no UVs, and keeps n-gons', () => {
    const m = new Mesh();
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0.5, 1.5, 0], [0, 1, 0]].forEach((p) => m.addPoint(p as Vec3));
    m.polygons.push({ points: [0, 1, 2, 3, 4], surface: 0 });
    expect(exportObj([m], palette, 'x.mtl').obj).toContain('f 1 2 3 4 5\n');
  });

  it('numbers the points of later layers after the earlier ones, and names each layer', () => {
    const a = box(1, 1, 1);
    const b = box(1, 1, 1);
    const { obj } = exportObj([a, new Mesh(), b], palette, 'x.mtl');
    expect(obj).toContain('o Layer_1');
    expect(obj).not.toContain('o Layer_2'); // empty layers are left out
    expect(obj).toContain('o Layer_3');
    const faces = obj.split('\n').filter((l) => l.startsWith('f '));
    const second = faces.slice(6).flatMap((l) => l.slice(2).split(' ').map(Number));
    expect(Math.min(...second)).toBe(9);
    expect(Math.max(...second)).toBe(16);
  });

  it('writes a material per surface with the palette colour, and gives clashing names their own', () => {
    const a = box(1, 1, 1);
    a.surfaces[0]!.name = 'Wall Paint';
    a.surfaces[0]!.colorIndex = 40;
    const b = box(1, 1, 1);
    b.surfaces[0]!.name = 'Wall Paint';
    b.surfaces[0]!.colorIndex = 80;
    b.surfaces[0]!.specular = 0.5;
    const { obj, mtl } = exportObj([a, b], palette, 'x.mtl');
    expect(obj).toContain('usemtl Wall_Paint\n');
    expect(obj).toContain('usemtl Wall_Paint_2\n');
    const [r, g, bl] = paletteColor(palette, 40);
    expect(mtl).toContain(`newmtl Wall_Paint\nKd ${+(r / 255).toFixed(6)} ${+(g / 255).toFixed(6)} ${+(bl / 255).toFixed(6)}`);
    expect(mtl).toContain('newmtl Wall_Paint_2');
    expect(mtl).toContain('Ks 0.5 0.5 0.5');
  });

  it('formats numbers without trailing zeros or negative zero', () => {
    const m = new Mesh();
    [[10, -0, 0.1 + 0.2], [-0.0000001, 2.5, 1e-9], [1, 1, 1]].forEach((p) => m.addPoint(p as Vec3));
    m.polygons.push({ points: [0, 1, 2], surface: 0 });
    const v = exportObj([m], palette, 'x.mtl').obj.split('\n').filter((l) => l.startsWith('v '));
    expect(v).toEqual(['v 10 0 0.3', 'v 0 2.5 0', 'v 1 1 1']);
  });
});

describe('round trip', () => {
  it('gives back the same shape, UVs and surface', () => {
    const m = cube();
    m.surfaces[0]!.name = 'Crate';
    m.surfaces[0]!.colorIndex = 50;
    const { obj, mtl } = exportObj([m], palette, 'crate.mtl');
    const back = parseObj(obj, palette, parseMtl(mtl));
    expect(back.groups).toHaveLength(1);
    const g = back.groups[0]!.mesh;
    expect(shape(g)).toEqual(shape(m));
    expect(g.polygons.map((p) => p.uvs)).toEqual(m.polygons.map((p) => p.uvs!.map(([u, v]) => [Math.round(u * 1e6) / 1e6, Math.round(v * 1e6) / 1e6])));
    expect(g.surfaces[g.polygons[0]!.surface]!.name).toBe('Crate');
    expect(g.surfaces[g.polygons[0]!.surface]!.colorIndex).toBe(50);
    expect(g.points).toHaveLength(8); // shared points stay shared
    expect(back.skippedFaces).toBe(0);
  });

  it('keeps layers apart as groups', () => {
    const { obj } = exportObj([box(1, 1, 1), new Mesh(), box(2, 2, 2)], palette, 'x.mtl');
    const back = parseObj(obj, palette);
    expect(back.groups.map((g) => g.name)).toEqual(['Layer_1', 'Layer_3']);
    expect(back.groups[1]!.mesh.points.every((p) => p.every((c) => Math.abs(c) === 1))).toBe(true);
  });
});

describe('parseObj', () => {
  const tri = 'v 0 0 0\nv 1 0 0\nv 0 1 0\n';

  it('reads the face forms v, v/vt, v//vn and v/vt/vn, and negative indices', () => {
    for (const face of ['f 1 2 3', 'f 1/1 2/2 3/3', 'f 1//1 2//1 3//1', 'f 1/1/1 2/2/1 3/3/1', 'f -3 -2 -1']) {
      const r = parseObj(`${tri}vt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\n${face}\n`, palette);
      expect(r.groups[0]!.mesh.polygons[0]!.points, face).toHaveLength(3);
    }
    const withUv = parseObj(`${tri}vt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n`, palette).groups[0]!.mesh.polygons[0]!;
    expect(withUv.uvs).toEqual([[0, 1], [1, 1], [0, 0]]);
    expect(parseObj(`${tri}f 1 2 3\n`, palette).groups[0]!.mesh.polygons[0]!.uvs).toBeUndefined();
  });

  it('keeps quads and n-gons as they are, and ignores comments, blank lines, CRLF and continuations', () => {
    const text = `# a comment\r\nv 0 0 0\r\nv 1 0 0\r\n\r\nv 1 1 0 # trailing comment\r\nv 0.5 1.5 0\r\nv 0 1 0\r\nf 1 2 3 \\\r\n 4 5\r\n`;
    const p = parseObj(text, palette).groups[0]!.mesh.polygons;
    expect(p).toHaveLength(1);
    expect(p[0]!.points).toHaveLength(5);
  });

  it('splits groups, names them, and only keeps the points each one uses', () => {
    const text = `v 0 0 0\nv 1 0 0\nv 0 1 0\nv 5 5 5\nv 6 5 5\nv 5 6 5\no First\nf 1 2 3\no Second\nf 4 5 6\n`;
    const r = parseObj(text, palette);
    expect(r.groups.map((g) => g.name)).toEqual(['First', 'Second']);
    expect(r.groups[1]!.mesh.points).toEqual([[5, 5, 5], [6, 5, 5], [5, 6, 5]]);
    expect(r.groups[1]!.mesh.polygons[0]!.points).toEqual([0, 1, 2]);
  });

  it('renames the group when two name lines come in a row, and names faces before any group', () => {
    expect(parseObj(`${tri}o A\ng B\nf 1 2 3\n`, palette).groups.map((g) => g.name)).toEqual(['B']);
    expect(parseObj(`${tri}f 1 2 3\n`, palette).groups[0]!.name).toBe('Object');
  });

  it('turns materials into surfaces, coloured from the .mtl by nearest palette colour', () => {
    const [r, g, b] = paletteColor(palette, 77);
    const mtl = parseMtl(`newmtl Red Brick\nKd ${r / 255} ${g / 255} ${b / 255}\nKs 1 1 1\n\nnewmtl Other\nKd 0 0 0\n`);
    expect(mtl.get('Red Brick')).toEqual([r / 255, g / 255, b / 255]);
    const m = parseObj(`${tri}usemtl Red Brick\nf 1 2 3\nusemtl Other\nf 3 2 1\n`, palette, mtl);
    const mesh = m.groups[0]!.mesh;
    expect(mesh.surfaces.map((s) => s.name)).toEqual(['Default', 'Red Brick', 'Other']);
    expect(mesh.surfaces[mesh.polygons[0]!.surface]!.colorIndex).toBe(77);
    expect(mesh.polygons[1]!.surface).toBe(2);
    expect(m.usedMaterials).toBe(true);
    // without a .mtl the surfaces still exist, just uncoloured
    expect(parseObj(`${tri}usemtl Red Brick\nf 1 2 3\n`, palette).groups[0]!.mesh.surfaces[1]!.name).toBe('Red Brick');
  });

  it('skips faces that cannot be used and counts them, keeping the rest', () => {
    const text = `${tri}f 1 2 3\nf 1 2 99\nf 1 2\nf 1 1 1\nf 0 1 2\nf 1 2 abc\n`;
    const r = parseObj(text, palette);
    expect(r.groups[0]!.mesh.polygons).toHaveLength(1);
    expect(r.skippedFaces).toBe(5);
  });

  it('drops a repeated point and a closing point equal to the first', () => {
    const p = parseObj(`${tri}f 1 2 2 3 1\n`, palette).groups[0]!.mesh.polygons[0]!;
    expect(p.points).toHaveLength(3);
  });

  it('a bad vertex line does not shift the numbering of the others', () => {
    const r = parseObj(`v 0 0 0\nv nope 1 1\nv 1 0 0\nv 0 1 0\nf 1 3 4\nf 1 2 3\n`, palette);
    expect(r.groups[0]!.mesh.polygons).toHaveLength(1); // the face that uses the bad vertex is skipped
    expect(r.skippedFaces).toBe(1);
    expect(r.groups[0]!.mesh.points).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  });

  it('counts lines it ignores, and refuses a file with nothing to use', () => {
    expect(parseObj(`${tri}l 1 2\np 1\nf 1 2 3\n`, palette).ignoredLines).toBe(2);
    expect(() => parseObj('v 0 0 0\n', palette)).toThrow(new ObjFormatError('This file has no faces'));
    expect(() => parseObj('v 0 0 0\nf 1 2 3\n', palette)).toThrow('None of the faces');
    expect(() => parseObj('', palette)).toThrow(ObjFormatError);
    expect(() => parseObj('this is not an obj file at all\n\x00\x01', palette)).toThrow(ObjFormatError);
  });

  it('refuses a file with absurdly many polygons', () => {
    const lines = [tri];
    for (let i = 0; i <= MAX_OBJ_POLYGONS; i++) lines.push('f 1 2 3\n');
    expect(() => parseObj(lines.join(''), palette)).toThrow('more than 100000 polygons');
  });
});
