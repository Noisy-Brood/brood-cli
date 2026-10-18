/**
 * The wren, as coordinates: the mark's one source, beside the colours it is
 * inked in, so the sites' component and the app's draw the same bird (DD13 §6:
 * the app shares tokens, never components).
 *
 * Drawn on a 100×100 field, facing right, tail cocked — the posture is the
 * diagnostic thing about a wren and the silhouette has to carry it at 24px,
 * where nothing else survives.
 */

/** The closed outline: beak, crown, back, tail, belly, breast. */
export const BODY = `M94 43 L76 40
  C71 25 54 20 44 31 C39 36 36 42 34 48
  L12 20 L9 30 L3 26 L27 64
  C29 78 44 85 58 81 C72 77 80 62 78 48 Z`;

/** The eye, punched through the body as a hole. Never a second colour. */
export const EYE = { cx: 68, cy: 35, r: 3.2 };

/** The folded wing, as an open curve punched through the body. */
export const WING = `M42 52 C52 61 60 67 66 67`;

/**
 * The weight of the wing and the eye's detail strokes, in user units on the
 * 100-unit field, so it is a fixed share of the mark at any size: the wing
 * holds its weight at 22px in the app's rail and at 72px on a title slide
 * alike. One number for every renderer, so no two draw a different bird.
 */
export const DETAIL_WEIGHT = 3.2;

/** The field everything above is drawn on. */
export const VIEWBOX = "0 0 100 100";

/** A path on one line, as an SVG file carries it. */
const oneLine = (d: string) => d.replace(/\s+/g, " ").trim();

/**
 * The mark as a file of its own: the body, with the eye and the wing
 * punched through to whatever is behind, so it needs no ground. `paint`
 * inks the body: a colour, or a stylesheet setting `.wren`'s fill, as the
 * favicon's does to follow the system's scheme. `comment` heads the file.
 * `ground`, when given, sets the bird on a square of that colour with
 * `margin` units of room on each side, for a place that shows an icon on a
 * ground it chooses, such as a dark screen.
 */
export function wrenSvg(
  paint: { fill: string } | { style: string },
  comment: string,
  ground?: { fill: string; margin: number },
): string {
  const style =
    "style" in paint ? `\n  <style>\n${paint.style}\n  </style>` : "";
  const ink = "fill" in paint ? `fill="${paint.fill}"` : `class="wren"`;
  const m = ground?.margin ?? 0;
  const field = `x="${-m}" y="${-m}" width="${100 + 2 * m}" height="${100 + 2 * m}"`;
  const viewBox = ground
    ? `${-m} ${-m} ${100 + 2 * m} ${100 + 2 * m}`
    : VIEWBOX;
  const square = ground ? `\n  <rect ${field} fill="${ground.fill}"/>` : "";
  return `<!-- ${comment} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${style}${square}
  <mask id="wren">
    <rect ${ground ? field : 'width="100" height="100"'} fill="white"/>
    <circle cx="${EYE.cx}" cy="${EYE.cy}" r="${EYE.r}" fill="black"/>
    <path d="${oneLine(WING)}" fill="none" stroke="black" stroke-width="${DETAIL_WEIGHT}" stroke-linecap="round"/>
  </mask>
  <path ${ink} d="${oneLine(BODY)}" mask="url(#wren)"/>
</svg>
`;
}
