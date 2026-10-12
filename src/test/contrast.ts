/** WCAG 2 contrast maths for tests: palettes, blended strokes. #RRGGBB colours, either case. */

/** WCAG 2 relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `fg` at `opacity` over `bg`, #RRGGBB (sRGB blending, as the browser composites). */
export function blend(fg: string, bg: string, opacity: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(channel(fg, i) * opacity + channel(bg, i) * (1 - opacity))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** WCAG 2 contrast ratio, rounded to 2 decimals. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round((((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)) * 100) / 100;
}
