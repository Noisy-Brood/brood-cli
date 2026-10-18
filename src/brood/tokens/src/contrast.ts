/**
 * Reading the colour tokens, and WCAG's contrast arithmetic over them (#608).
 *
 * One copy, for the brandkit, which shows each pair's grade, and for the test
 * beside this file, which holds the pairs used as text to WCAG 2.2 AA. The
 * CSS is passed in: the brandkit inlines it at build time, the test reads the
 * files.
 */

export interface Token {
  /** `--color-ink-muted` → `ink-muted` */
  name: string;
  /** The declared value, verbatim. May be a hex or an `rgb(… / …)` with alpha. */
  value: string;
  /** True for `rgb(… / …)` values, which cannot be contrast-tested on their own. */
  alpha: boolean;
  /** The `/* … *\/` comment above the group this token belongs to, if any. */
  note?: string;
}

export function readColourTokens(css: string): Token[] {
  const out: Token[] = [];
  let note: string | undefined;

  for (const raw of css.split("\n")) {
    const line = raw.trim();

    const comment = line.match(/^\/\*\s*(.*?)\s*\*\/$/);
    if (comment) {
      note = comment[1];
      continue;
    }

    // Both groups are guaranteed by the match, but `noUncheckedIndexedAccess`
    // cannot know that — and reading them through the guard costs nothing.
    const decl = line.match(/^--color-([a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (decl?.[1] && decl[2]) {
      const value = decl[2].trim();
      out.push({
        name: decl[1],
        value,
        alpha: /rgb|hsl|\//.test(value),
        note,
      });
      continue;
    }

    // A blank line ends a group, so a note does not leak onto the next one.
    if (line === "") note = undefined;
  }

  if (!out.length) throw new Error("No --color-* tokens found");
  return out;
}

/** Relative luminance, per WCAG. */
function luminance(hex: string): number | null {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  const digits = m?.[1];
  if (!digits) return null;
  // Read each channel by name rather than destructuring out of `.map`, which
  // hands back `number | undefined` for every element however many there are.
  const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
  const f = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * f(channel(0)) + 0.7152 * f(channel(2)) + 0.0722 * f(channel(4))
  );
}

/**
 * The contrast ratio exactly, or null when either colour carries alpha and
 * cannot be judged alone. For grading: WCAG's thresholds are not to be met by
 * rounding up.
 */
export function exactContrast(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast ratio to two places, for a caption, or null as `exactContrast`. */
export function contrast(a: string, b: string): number | null {
  const r = exactContrast(a, b);
  return r === null ? null : Math.round(r * 100) / 100;
}

/**
 * A translucent `rgb(r g b / a)` laid over an opaque ground, as the hex a
 * reader actually sees. A contrast figure for a translucent colour is only true
 * against one backdrop, so this takes the backdrop explicitly rather than
 * guessing it. Hexes pass through unchanged; anything else returns null.
 */
export function over(value: string, ground: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const m = value.match(
    /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/i,
  );
  const g = ground.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!m || !g) return null;
  const alpha = Number(m[4]);
  const mix = (i: number) => {
    const fg = Number(m[i + 1]);
    const bg = parseInt(g.slice(i * 2, i * 2 + 2), 16);
    return Math.round(fg * alpha + bg * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${mix(0)}${mix(1)}${mix(2)}`;
}

/** Contrast of a colour, translucent or not, as it lands on `ground`. */
export function contrastOn(value: string, ground: string): number | null {
  const seen = over(value, ground);
  return seen === null ? null : contrast(seen, ground);
}

/** WCAG grade for body text at normal size. */
export function grade(ratio: number | null): string {
  if (ratio === null) return "—";
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA large";
  return "fails";
}
