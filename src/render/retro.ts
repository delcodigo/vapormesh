/** How the Perspective viewport draws: wireframe, a shaded preview, or the preview with the wireframe on top. */
export type ViewMode = 'wire' | 'shaded' | 'shaded-wire';

/** The retro look applied to shaded views. */
export interface RetroOptions {
  /** Internal render height in pixels; the width follows the viewport's aspect. Upscaled with nearest filtering. */
  resolutionHeight: number;
  /** Colour levels per channel when not using the palette (256 = no quantising). 32 is 15-bit colour. */
  colorLevels: number;
  /** Ordered-dither strength, 0 (hard banding) to 1 (full Bayer dither). */
  dither: number;
  /** Map the final image to the project palette. Off: reduce each channel to `colorLevels` instead. */
  usePalette: boolean;
}

export const defaultRetro: RetroOptions = { resolutionHeight: 240, colorLevels: 32, dither: 1, usePalette: true };

export const RETRO_PRESETS: Record<string, RetroOptions> = {
  Chunky: { resolutionHeight: 120, colorLevels: 16, dither: 1, usePalette: true },
  Retro: defaultRetro,
  Clean: { resolutionHeight: 480, colorLevels: 256, dither: 0, usePalette: false },
};

/** The light of the shaded views: one distant light, given by where it comes from, or switched off to show plain colours. */
export interface LightSettings {
  /** Off: surfaces show their colour and texture unshaded. */
  enabled: boolean;
  /** Degrees around the vertical axis, 0 = from +Z (the front), positive towards +X. -180..180. */
  azimuth: number;
  /** Degrees above the horizon: 90 is straight down onto the model. -90..90. */
  elevation: number;
}

export const defaultLight: LightSettings = { enabled: true, azimuth: -42, elevation: 50 };

/** Unit vector from the model towards the light. */
export function lightDirection({ azimuth, elevation }: LightSettings): [number, number, number] {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

export interface DisplaySettings {
  mode: ViewMode;
  retro: RetroOptions;
  light: LightSettings;
}

export function defaultDisplay(): DisplaySettings {
  return { mode: 'wire', retro: { ...defaultRetro }, light: { ...defaultLight } };
}
