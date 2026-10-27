import { PALETTE_SIZE, type Palette } from './palette';

export class PaletteFormatError extends Error {}

export interface ParsedPalette {
  palette: Palette;
  /** How many colours the file really held; the rest of the 256 are black. */
  count: number;
}

const GPL_HEADER = 'GIMP Palette';
const MAX_GPL_CHARS = 2_000_000;

/** A GIMP palette (.gpl): a text file with one `R G B  name` line per colour. */
export function writeGpl(palette: Palette, name = 'VaporMesh'): string {
  const pad = (n: number) => String(n).padStart(3, ' ');
  const lines = [GPL_HEADER, `Name: ${name.replace(/[\r\n]/g, ' ')}`, 'Columns: 16', '#'];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    lines.push(`${pad(palette[i * 3]!)} ${pad(palette[i * 3 + 1]!)} ${pad(palette[i * 3 + 2]!)}\tIndex ${i}`);
  }
  return lines.join('\n') + '\n';
}

/** Read a .gpl. Fewer than 256 colours are padded with black; more than 256 are refused rather than silently cut. */
export function parseGpl(text: string): ParsedPalette {
  if (text.length > MAX_GPL_CHARS) throw new PaletteFormatError('That palette file is too large');
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.trim().startsWith(GPL_HEADER)) throw new PaletteFormatError('Not a GIMP palette (.gpl): it should start with "GIMP Palette"');
  const colors: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '' || line.startsWith('#') || /^(Name|Columns):/i.test(line)) continue;
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s|$)/.exec(line);
    if (!m) throw new PaletteFormatError(`Line ${i + 1} is not a colour: "${line.slice(0, 40)}"`);
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (rgb.some((c) => c > 255)) throw new PaletteFormatError(`Line ${i + 1} has a value above 255`);
    colors.push(...rgb);
    if (colors.length > PALETTE_SIZE * 3) throw new PaletteFormatError(`That palette has more than ${PALETTE_SIZE} colours`);
  }
  if (colors.length === 0) throw new PaletteFormatError('That palette file has no colours');
  const palette = new Uint8Array(PALETTE_SIZE * 3);
  palette.set(colors);
  return { palette, count: colors.length / 3 };
}

/** An Adobe colour table (.act): 256 RGB triples, 768 bytes, no header. */
export function writeAct(palette: Palette): Uint8Array<ArrayBuffer> {
  return new Uint8Array(palette.subarray(0, PALETTE_SIZE * 3));
}

/** Read an .act: 768 bytes, or 772 with a footer whose first two bytes (big-endian) say how many colours are used. */
export function parseAct(bytes: Uint8Array): ParsedPalette {
  if (bytes.length !== 768 && bytes.length !== 772) {
    throw new PaletteFormatError(`Not an Adobe colour table (.act): expected 768 or 772 bytes, got ${bytes.length}`);
  }
  let count = PALETTE_SIZE;
  if (bytes.length === 772) {
    const declared = (bytes[768]! << 8) | bytes[769]!;
    if (declared >= 1 && declared <= PALETTE_SIZE) count = declared;
  }
  const palette = new Uint8Array(PALETTE_SIZE * 3);
  palette.set(bytes.subarray(0, count * 3));
  return { palette, count };
}

/** Detect the format by content (a .gpl starts with its header, an .act is a fixed size) and read it. */
export function parsePaletteFile(bytes: Uint8Array): ParsedPalette {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, GPL_HEADER.length));
  if (head === GPL_HEADER) return parseGpl(new TextDecoder('utf-8').decode(bytes));
  if (bytes.length === 768 || bytes.length === 772) return parseAct(bytes);
  throw new PaletteFormatError('Not a palette file: expected a GIMP .gpl or an Adobe .act');
}
