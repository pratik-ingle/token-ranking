/**
 * Deterministic identicons derived from a hash of the username. No photos,
 * nothing uploaded: the avatar is a pure function of the public username.
 */

/** FNV-1a 32-bit. Not cryptographic; only used to pick pixels and a hue. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function xorshift(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

export interface Identicon {
  /** 5x5 grid, horizontally symmetric, true = filled. */
  cells: boolean[][];
  hue: number;
  foreground: string;
  background: string;
}

export function identicon(username: string): Identicon {
  const rand = xorshift(fnv1a(username.toLowerCase()));
  const hue = Math.floor(rand() * 360);
  const cells: boolean[][] = [];
  let filled = 0;
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = new Array(5).fill(false);
    for (let x = 0; x < 3; x++) {
      const on = rand() > 0.5;
      row[x] = on;
      row[4 - x] = on;
      if (on) filled++;
    }
    cells.push(row);
  }
  // Never render an empty avatar.
  if (filled === 0) cells[2]![2] = true;
  return {
    cells,
    hue,
    foreground: `hsl(${hue} 65% 50%)`,
    background: `hsl(${hue} 40% 92%)`,
  };
}

/** Standalone SVG markup (used for og images / server rendering). */
export function identiconSvg(username: string, size = 64): string {
  const { cells, foreground, background } = identicon(username);
  const unit = size / 6;
  const rects: string[] = [];
  cells.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) {
        rects.push(
          `<rect x="${(x + 0.5) * unit}" y="${(y + 0.5) * unit}" width="${unit}" height="${unit}" fill="${foreground}"/>`,
        );
      }
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${background}"/>${rects.join("")}</svg>`;
}
