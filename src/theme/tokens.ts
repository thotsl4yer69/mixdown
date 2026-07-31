/**
 * mixdown design tokens.
 *
 * Vernacular: broadcast monitoring equipment, not a social app. A card's
 * lane accent tells you what kind of attention it's asking for before you
 * read a word of it. NSFW mode is a full chrome shift, not a corner badge —
 * state you register peripherally, not something you have to go check.
 */

export const color = {
  base: "#0B0D10",
  baseNsfw: "#120A0A",
  surface: "#14171C",
  surfaceNsfw: "#1C1010",
  surfaceRaised: "#1B1F26",
  hairline: "#262B33",

  text: "#E8EAED",
  textDim: "#8A929E",
  textFaint: "#565D68",

  learn: "#4FD1C5",
  learnDim: "#2C7A72",
  play: "#F2A73B",
  playDim: "#8A6222",
  nsfw: "#C4453C",
  nsfwDim: "#7A2B26",

  danger: "#E5484D",
  success: "#4FD18C",
} as const;

export const lane = {
  learn: { accent: color.learn, dim: color.learnDim },
  play: { accent: color.play, dim: color.playDim },
} as const;

export type Lane = keyof typeof lane;

export const type = {
  // Display: condensed, heavy, tight-tracked — equipment nameplate energy.
  display: {
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.4,
  },
  // Body: a plain workhorse face, unobtrusive at reading length.
  body: {
    fontFamily: "Inter_400Regular",
    letterSpacing: 0,
  },
  bodyMedium: {
    fontFamily: "Inter_500Medium",
    letterSpacing: 0,
  },
  // Utility/meta: condensed uppercase, wide tracking — dial labelling.
  meta: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
} as const;

export const scale = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 22,
  xl: 28,
  xxl: 36,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  pill: 999,
} as const;

export function chrome(nsfw: boolean) {
  return {
    base: nsfw ? color.baseNsfw : color.base,
    surface: nsfw ? color.surfaceNsfw : color.surface,
    accent: nsfw ? color.nsfw : color.text,
  };
}
