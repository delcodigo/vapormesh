/**
 * Vaporwave palette for everything drawn in WebGL. The UI chrome uses the matching CSS variables
 * in style.css; keep the two in sync.
 */
export const THEME = {
  wire: 0x01cdfe, // cyan
  point: 0xff71ce, // pink
  selected: 0xfffb96, // cream yellow
  selectedFill: 0xff71ce,
  gridMinor: 0x3b2a7a,
  gridMajor: 0x5b45a8,
  /** X, Y, Z axis lines. */
  axes: [0xb0508f, 0x2fa07a, 0x3a7ab0],
} as const;
