import { Mesh } from '@/core';

export function box(w = 1, h = 1, d = 1): Mesh {
  const m = new Mesh();
  const [x, y, z] = [w / 2, h / 2, d / 2];
  for (const sx of [-x, x]) for (const sy of [-y, y]) for (const sz of [-z, z]) m.addPoint([sx, sy, sz]);
  // point index = (sx?4:0)+(sy?2:0)+(sz?1:0); counter-clockwise outward
  const quads = [
    [0, 1, 3, 2], [4, 6, 7, 5], // -x, +x
    [0, 4, 5, 1], [2, 3, 7, 6], // -y, +y
    [0, 2, 6, 4], [1, 5, 7, 3], // -z, +z
  ];
  for (const q of quads) m.addPolygon(q);
  return m;
}
