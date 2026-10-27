import { describe, expect, it } from 'vitest';
import { defaultPalette, paletteColor, PALETTE_SIZE } from './palette';
import { PaletteFormatError, parseAct, parseGpl, parsePaletteFile, writeAct, writeGpl } from './paletteFormats';

describe('.gpl', () => {
  it('round-trips the whole default palette', () => {
    const p = defaultPalette();
    const { palette, count } = parseGpl(writeGpl(p));
    expect(palette).toEqual(p);
    expect(count).toBe(256);
  });

  it('writes the GIMP header, a name and 256 colour lines', () => {
    const text = writeGpl(defaultPalette(), 'My Game');
    expect(text.startsWith('GIMP Palette\nName: My Game\nColumns: 16\n#\n')).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(4 + 256);
    expect(text).toContain('255 255 255\tIndex 15');
  });

  it('reads a hand-written palette: comments, blank lines, names, CRLF; the rest is black', () => {
    const text = 'GIMP Palette\r\nName: Tiny\r\n# a comment\r\n\r\n255   0   0\tRed\r\n  0 255   0 Green here\r\n0 0 255\r\n';
    const { palette, count } = parseGpl(text);
    expect(count).toBe(3);
    expect(paletteColor(palette, 0)).toEqual([255, 0, 0]);
    expect(paletteColor(palette, 1)).toEqual([0, 255, 0]);
    expect(paletteColor(palette, 2)).toEqual([0, 0, 255]);
    expect(paletteColor(palette, 3)).toEqual([0, 0, 0]);
  });

  it.each([
    ['', /GIMP/],
    ['Palette\n1 2 3', /GIMP/],
    ['GIMP Palette\n', /no colours/],
    ['GIMP Palette\n1 2\n', /not a colour/],
    ['GIMP Palette\n1 2 300\n', /above 255/],
    ['GIMP Palette\nred green blue\n', /not a colour/],
    ['GIMP Palette\n' + '1 2 3\n'.repeat(257), /more than 256/],
  ])('rejects bad input %#', (text, message) => {
    expect(() => parseGpl(text)).toThrow(PaletteFormatError);
    expect(() => parseGpl(text)).toThrow(message);
  });
});

describe('.act', () => {
  it('round-trips 768 bytes', () => {
    const p = defaultPalette();
    const bytes = writeAct(p);
    expect(bytes).toHaveLength(768);
    expect(parseAct(bytes).palette).toEqual(p);
    expect(writeAct(p)).not.toBe(p); // a copy, not the live palette
  });

  it('reads the 772 byte form and honours the colour count in its footer', () => {
    const bytes = new Uint8Array(772);
    bytes.fill(200, 0, 768);
    bytes.set([0, 3, 0xff, 0xff], 768); // 3 colours, no transparency
    const { palette, count } = parseAct(bytes);
    expect(count).toBe(3);
    expect(paletteColor(palette, 2)).toEqual([200, 200, 200]);
    expect(paletteColor(palette, 3)).toEqual([0, 0, 0]);
  });

  it('ignores a nonsense footer count', () => {
    const bytes = new Uint8Array(772).fill(9);
    bytes.set([0xff, 0xff, 0, 0], 768);
    expect(parseAct(bytes).count).toBe(256);
  });

  it('rejects any other size', () => {
    for (const n of [0, 767, 769, 1000]) expect(() => parseAct(new Uint8Array(n))).toThrow(PaletteFormatError);
  });
});

describe('parsePaletteFile', () => {
  it('detects the format from the content, not the name', () => {
    const p = defaultPalette();
    expect(parsePaletteFile(new TextEncoder().encode(writeGpl(p))).palette).toEqual(p);
    expect(parsePaletteFile(writeAct(p)).palette).toEqual(p);
  });

  it('refuses anything else', () => {
    expect(() => parsePaletteFile(new TextEncoder().encode('hello world'))).toThrow(/Not a palette file/);
    expect(() => parsePaletteFile(new Uint8Array(PALETTE_SIZE))).toThrow(/Not a palette file/);
  });
});
