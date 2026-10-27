export type Vec3 = [number, number, number];

/** Rotate `p` about the line through `pivot` along `axis` (right-handed, radians). Rodrigues' formula. */
export function rotateAround(p: Vec3, pivot: Vec3, axis: Vec3, angle: number): Vec3 {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  const k: Vec3 = [axis[0] / len, axis[1] / len, axis[2] / len];
  const v: Vec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const cross: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [
    pivot[0] + v[0] * cos + cross[0] * sin + k[0] * dot * (1 - cos),
    pivot[1] + v[1] * cos + cross[1] * sin + k[1] * dot * (1 - cos),
    pivot[2] + v[2] * cos + cross[2] * sin + k[2] * dot * (1 - cos),
  ];
}
