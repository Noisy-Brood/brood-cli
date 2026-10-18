import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readColourTokens } from "./brood/tokens/src/contrast.ts";
import { BODY, DETAIL_WEIGHT, EYE, WING } from "./brood/tokens/src/wren.ts";

/**
 * The wren in characters, for the top of `brood help` and a finished
 * `brood login` and nowhere else (the brand bible's terminal register).
 * Drawn from the mark's one source as the SVG is: the body filled, the eye
 * and the wing punched through it, so it cannot become a second bird. Each
 * character covers a cell twice as tall as it is wide, as a terminal's do,
 * and is chosen by how much of that cell the bird fills.
 */

type Point = [number, number];

/** A path of M, L and C commands, as the wren's are, as polylines. */
function polylines(d: string): Point[][] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  const lines: Point[][] = [];
  let line: Point[] = [];
  let at: Point = [0, 0];
  let command = "";
  const num = () => Number(tokens.shift());
  while (tokens.length) {
    if (/[MLCZ]/.test(tokens[0]!)) command = tokens.shift()!;
    if (command === "M") {
      if (line.length) lines.push(line);
      at = [num(), num()];
      line = [at];
    } else if (command === "L") {
      at = [num(), num()];
      line.push(at);
    } else if (command === "C") {
      const c1: Point = [num(), num()];
      const c2: Point = [num(), num()];
      const end: Point = [num(), num()];
      const from = at;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        line.push([
          u ** 3 * from[0] +
            3 * u * u * t * c1[0] +
            3 * u * t * t * c2[0] +
            t ** 3 * end[0],
          u ** 3 * from[1] +
            3 * u * u * t * c1[1] +
            3 * u * t * t * c2[1] +
            t ** 3 * end[1],
        ]);
      }
      at = end;
    } else if (command === "Z") {
      if (line[0]) line.push(line[0]);
      command = "";
    } else
      throw new Error(
        `the wren's path has a command this does not draw: ${command}`,
      );
  }
  if (line.length) lines.push(line);
  return lines;
}

const body = polylines(BODY)[0]!;
const wing = polylines(WING)[0]!;

/** Even-odd: whether a point is inside the closed outline. */
function inside(p: Point, outline: Point[]): boolean {
  let within = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i]!;
    const [xj, yj] = outline[j]!;
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    )
      within = !within;
  }
  return within;
}

/** How far a point is from an open polyline. */
function distance(p: Point, line: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)),
    );
    best = Math.min(
      best,
      Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)),
    );
  }
  return best;
}

/** Whether the wren is inked at a point: in the body, and not in the eye or the wing. */
const inked = (p: Point): boolean =>
  inside(p, body) &&
  Math.hypot(p[0] - EYE.cx, p[1] - EYE.cy) > EYE.r &&
  distance(p, wing) > DETAIL_WEIGHT / 2;

/** From an empty cell to a full one. */
const RAMP = " .:-=+*#%@";

/** The wren, `columns` characters wide, as lines, trimmed to the bird. */
export function wrenArt(columns = 32): string[] {
  const xs = body.map((p) => p[0]);
  const ys = body.map((p) => p[1]);
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const cell = (right - left) / columns;
  const rows = Math.ceil((bottom - top) / (cell * 2));
  const SAMPLES = 4;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < columns; c++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES * 2; sy++)
        for (let sx = 0; sx < SAMPLES; sx++)
          if (
            inked([
              left + (c + (sx + 0.5) / SAMPLES) * cell,
              top + (r * 2 + (sy + 0.5) / SAMPLES) * cell,
            ])
          )
            hits++;
      line +=
        RAMP[
          Math.round((hits / (SAMPLES * SAMPLES * 2)) * (RAMP.length - 1))
        ] ?? " ";
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * Barn, as the dark scheme sets it, read from the tokens when brood runs.
 * A terminal does not say whether its ground is light or dark, and this one
 * holds 3:1 on white, on black and on Ink, where the light scheme's falls
 * short on a dark ground. It is the screen's one drop of Barn.
 */
function barn(): [number, number, number] {
  const css = readFileSync(
    fileURLToPath(import.meta.resolve("./brood/tokens/dark.css")),
    "utf8",
  );
  const value = readColourTokens(css).find((t) => t.name === "barn")?.value;
  const hex = value?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!hex) throw new Error("dark.css sets no --color-barn as six hex digits");
  return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
}

/** The levels of xterm's 256-colour cube, for a terminal with no true colour. */
const CUBE = [0, 95, 135, 175, 215, 255];
const nearest = (c: number) =>
  CUBE.reduce(
    (best, level, i) =>
      Math.abs(level - c) < Math.abs(CUBE[best]! - c) ? i : best,
    0,
  );

export type ColourDepth = "true" | "256" | "none";

/** How much colour a terminal shows, as it says in its environment. */
export const depthOf = (env: {
  COLORTERM?: string;
  TERM?: string;
}): ColourDepth =>
  env.COLORTERM === "truecolor" || env.COLORTERM === "24bit"
    ? "true"
    : env.TERM?.includes("256color")
      ? "256"
      : "none";

/** The wren's lines, inked in Barn as deep as the terminal shows it. */
export function wrenIn(depth: ColourDepth, columns?: number): string[] {
  const art = wrenArt(columns);
  if (depth === "none") return art;
  const [r, g, b] = barn();
  const ink =
    depth === "true"
      ? `\u001b[38;2;${r};${g};${b}m`
      : `\u001b[38;5;${16 + 36 * nearest(r) + 6 * nearest(g) + nearest(b)}m`;
  return art.map((line) => (line ? `${ink}${line}\u001b[39m` : line));
}
