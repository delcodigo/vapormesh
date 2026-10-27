/** How the Perspective viewport draws: wireframe, a shaded preview, or the preview with the wireframe on top. */
export type ViewMode = 'wire' | 'shaded' | 'shaded-wire';

/** The retro look applied to shaded views. */
export interface RetroOptions {
  /** Internal render height in pixels; the width follows the viewport's aspect. Upscaled with nearest filtering. */
  resolutionHeight: number;
  /** Colour levels per channel (256 = no quantising). 32 is 15-bit colour. */
  colorLevels: number;
  /** Ordered-dither strength, 0 (hard banding) to 1 (full Bayer dither). */
  dither: number;
}

export const defaultRetro: RetroOptions = { resolutionHeight: 240, colorLevels: 32, dither: 1 };

export const RETRO_PRESETS: Record<string, RetroOptions> = {
  Chunky: { resolutionHeight: 120, colorLevels: 16, dither: 1 },
  Retro: defaultRetro,
  Clean: { resolutionHeight: 480, colorLevels: 256, dither: 0 },
};

export interface DisplaySettings {
  mode: ViewMode;
  retro: RetroOptions;
}

export function defaultDisplay(): DisplaySettings {
  return { mode: 'wire', retro: { ...defaultRetro } };
}
