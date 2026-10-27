/** Retro look knobs applied to the final render. */
export interface RetroOptions {
  /** Internal render height in pixels; upscaled with nearest filtering. */
  resolutionHeight: number;
  /** Quantize color to this many levels per channel (0 = off). */
  colorLevels: number;
}

export const defaultRetro: RetroOptions = { resolutionHeight: 240, colorLevels: 32 };
