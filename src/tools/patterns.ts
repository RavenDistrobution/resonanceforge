// Procedural surface patterns. Each pattern is a height function f(x, y) in [0, 1] (1 = raised) and an SVG tile generator.
export type PatternKind = 'hex' | 'grid' | 'dots' | 'knurl' | 'waves' | 'bricks' | 'chevron' | 'triangles' | 'scales' | 'noise' | 'stripes' | 'voronoiish' | 'wood' | 'cedar' | 'knit' | 'leather' | 'carbon' | 'hammered' | 'weave' | 'ripple';
export interface PatternParams { cell: number; line: number; amp: number; invert: boolean; stagger: boolean; seed: number }
export const PATTERN_LABELS: Record<PatternKind, string> = {
  hex: 'Honeycomb', grid: 'Grid lines', dots: 'Dots / dimples', knurl: 'Knurl (diamond)', waves: 'Waves', bricks: 'Bricks',
  chevron: 'Chevron', triangles: 'Triangle lattice', scales: 'Fish scales', noise: 'Organic noise', stripes: 'Stripes', voronoiish: 'Cells (stone)',
  wood: 'Wood grain', cedar: 'Cedar planks (rough)', knit: 'Knit / sweater', leather: 'Leather grain', carbon: 'Carbon fibre weave', hammered: 'Hammered metal', weave: 'Basket weave', ripple: 'Water ripples',
};
/** Ready-made parameter sets that look right at print scale (mm). */
export const PATTERN_PRESETS: { id: string; label: string; kind: PatternKind; params: PatternParams; depth: number }[] = [
  { id: 'wood-oak', label: 'Oak grain', kind: 'wood', params: { cell: 14, line: 0.6, amp: 1.2, invert: false, stagger: true, seed: 3 }, depth: 0.5 },
  { id: 'wood-pine', label: 'Pine (wide grain)', kind: 'wood', params: { cell: 24, line: 0.9, amp: 0.8, invert: false, stagger: true, seed: 11 }, depth: 0.4 },
  { id: 'cedar', label: 'Cedar planks', kind: 'cedar', params: { cell: 18, line: 1.2, amp: 1.5, invert: false, stagger: true, seed: 5 }, depth: 0.8 },
  { id: 'knit', label: 'Knit sweater', kind: 'knit', params: { cell: 4, line: 1.4, amp: 1, invert: false, stagger: true, seed: 7 }, depth: 0.7 },
  { id: 'knit-chunky', label: 'Chunky knit', kind: 'knit', params: { cell: 8, line: 2.8, amp: 1.2, invert: false, stagger: true, seed: 7 }, depth: 1.2 },
  { id: 'leather', label: 'Leather', kind: 'leather', params: { cell: 2.5, line: 0.35, amp: 1, invert: false, stagger: true, seed: 9 }, depth: 0.35 },
  { id: 'carbon', label: 'Carbon fibre', kind: 'carbon', params: { cell: 3, line: 0.4, amp: 1, invert: false, stagger: true, seed: 1 }, depth: 0.3 },
  { id: 'hammered', label: 'Hammered metal', kind: 'hammered', params: { cell: 6, line: 1, amp: 1, invert: false, stagger: true, seed: 4 }, depth: 0.6 },
  { id: 'weave', label: 'Basket weave', kind: 'weave', params: { cell: 6, line: 0.8, amp: 1, invert: false, stagger: true, seed: 1 }, depth: 0.8 },
  { id: 'ripple', label: 'Water ripples', kind: 'ripple', params: { cell: 10, line: 1, amp: 1, invert: false, stagger: true, seed: 2 }, depth: 0.5 },
  { id: 'stone', label: 'Flagstone', kind: 'voronoiish', params: { cell: 12, line: 1.2, amp: 1, invert: false, stagger: true, seed: 6 }, depth: 0.8 },
  { id: 'honeycomb', label: 'Honeycomb', kind: 'hex', params: { cell: 6, line: 1, amp: 1, invert: false, stagger: true, seed: 7 }, depth: 0.6 },
  { id: 'knurl', label: 'Fine knurl (grip)', kind: 'knurl', params: { cell: 2, line: 0.6, amp: 1, invert: false, stagger: true, seed: 7 }, depth: 0.5 },
];
export const DEFAULT_PATTERN: PatternParams = { cell: 6, line: 1, amp: 1, invert: false, stagger: true, seed: 7 };

const mod = (a: number, n: number) => ((a % n) + n) % n;
const lineAt = (t: number, period: number, w: number) => { const m = mod(t + w / 2, period); return m < w ? 1 : 0; };
const smoothLine = (t: number, period: number, w: number) => { const m = Math.abs(mod(t, period) - period / 2); return Math.max(0, Math.min(1, (w / 2 - (period / 2 - m)) / (w * 0.35) + 1)); };

function hash(x: number, y: number, seed: number) { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); }
function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Nearest hex centre for a pointy-top hex grid with centre spacing `cell` (flat to flat). */
function hexCell(x: number, y: number, cell: number) {
  const w = cell, hgt = cell * 2 / Math.sqrt(3) * 0.75; // row pitch
  const row = Math.floor(y / hgt); const off = (row % 2 ? 0.5 : 0) * w;
  const col = Math.floor((x - off) / w);
  let best: [number, number] = [0, 0], bd = Infinity;
  for (let r = row - 1; r <= row + 1; r++) for (let c = col - 1; c <= col + 1; c++) {
    const cx = (c + 0.5) * w + ((r % 2 + 2) % 2 ? 0.5 : 0) * w, cy = (r + 0.5) * hgt + hgt / 6;
    const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = [cx, cy]; }
  }
  return best;
}
function hexDist(dx: number, dy: number) { // distance in units where edge (apothem) = 1 for pointy-top hex
  const ax = Math.abs(dx), ay = Math.abs(dy);
  return Math.max(ax, ax * 0.5 + ay * 0.8660254);
}

export function patternValue(kind: PatternKind, x: number, y: number, p: PatternParams): number {
  const c = Math.max(0.5, p.cell), w = Math.max(0.1, p.line);
  let v = 0;
  switch (kind) {
    case 'grid': v = Math.max(lineAt(x, c, w), lineAt(y, c, w)); break;
    case 'stripes': v = lineAt(x, c, w); break;
    case 'knurl': v = Math.max(lineAt((x + y) * Math.SQRT1_2, c, w), lineAt((x - y) * Math.SQRT1_2, c, w)); break;
    case 'triangles': v = Math.max(lineAt(y, c * 0.866, w), lineAt(x * 0.866 + y * 0.5, c * 0.866, w), lineAt(x * 0.866 - y * 0.5, c * 0.866, w)); break;
    case 'hex': { const [cx, cy] = hexCell(x, y, c); const d = hexDist(x - cx, y - cy); v = d > c / 2 - w ? 1 : 0; break; }
    case 'dots': {
      const row = Math.floor(y / c); const off = p.stagger && row % 2 ? c / 2 : 0;
      const dx = mod(x - off, c) - c / 2, dy = mod(y, c) - c / 2; const r = Math.sqrt(dx * dx + dy * dy);
      const R = Math.min(c / 2 - 0.2, Math.max(0.3, w)); v = r < R ? Math.sqrt(Math.max(0, 1 - (r / R) ** 2)) : 0; break;
    }
    case 'waves': v = 0.5 + 0.5 * Math.sin((2 * Math.PI * x) / c + p.amp * Math.sin((2 * Math.PI * y) / c)); break;
    case 'bricks': { const bh = c / 2; const row = Math.floor(y / bh); const off = row % 2 ? c / 2 : 0; v = 1 - Math.max(lineAt(y, bh, w), lineAt(x - off, c, w)); break; }
    case 'chevron': { const tri = Math.abs(mod(y, c) - c / 2) * 2; v = lineAt(x + tri, c, w); break; }
    case 'scales': {
      const rowH = c * 0.5; const row = Math.floor(y / rowH); let best = 0;
      for (let r = row; r <= row + 1; r++) { const off = r % 2 ? c / 2 : 0; const cx = Math.round((x - off) / c) * c + off, cy = r * rowH; const d = Math.hypot(x - cx, y - cy); if (y <= cy + 1e-6 && d <= c / 2) best = Math.max(best, d > c / 2 - w ? 1 : 0.35 * (1 - d / (c / 2))); }
      v = best; break;
    }
    case 'noise': v = 0.5 * valueNoise(x / c, y / c, p.seed) + 0.35 * valueNoise(x / c * 2.1, y / c * 2.1, p.seed + 3) + 0.15 * valueNoise(x / c * 4.3, y / c * 4.3, p.seed + 9); break;
    case 'voronoiish': {
      const cx = Math.floor(x / c), cy = Math.floor(y / c); let d1 = Infinity, d2 = Infinity;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const px = (cx + i + hash(cx + i, cy + j, p.seed)) * c, py = (cy + j + hash(cx + i, cy + j, p.seed + 1)) * c; const d = Math.hypot(x - px, y - py); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      v = d2 - d1 < w ? 0 : 1; break;
    }
    case 'wood': {
      // grain lines: distorted concentric rings along x, with fine fibre noise along the grain
      const fx = x / (c * 4), fy = y / c;
      const warp = valueNoise(fx * 0.8, fy * 0.15, p.seed) * 2.2 + valueNoise(fx * 3, fy * 0.5, p.seed + 2) * 0.6;
      const rings = (fy + warp) * p.amp * 2.5;
      const ring = 0.5 + 0.5 * Math.sin(rings * Math.PI * 2);
      const fibre = valueNoise(fx * 40, fy * 2, p.seed + 5);
      v = Math.pow(ring, 2.2) * 0.75 + fibre * 0.25 * w; v = Math.min(1, v); break;
    }
    case 'cedar': {
      // rough planks: plank boundaries every cell along y, each plank with its own coarse grain and saw marks
      const plankH = c; const plank = Math.floor(y / plankH); const yy = mod(y, plankH); const gap = yy < w * 0.6 || yy > plankH - w * 0.6 ? 1 : 0;
      const sd = p.seed + plank * 13; const fx = x / (c * 3);
      const grain = 0.5 + 0.5 * Math.sin((yy / plankH + valueNoise(fx * 1.2, plank * 0.37, sd) * 1.5) * Math.PI * 2 * p.amp * 2);
      const rough = valueNoise(x / 1.2, y / 1.2, sd + 1) * 0.5 + valueNoise(x * 2.5, y * 0.4, sd + 2) * 0.3;
      v = gap ? 0 : Math.min(1, 0.35 + 0.45 * Math.pow(grain, 1.5) + 0.3 * rough); break;
    }
    case 'knit': {
      // stockinette: each stitch is a V made of two yarn legs; rows overlap so the V tops tuck under the row above
      const sw = c, rh = c * 0.75; const yarnR = Math.max(0.15, Math.min(0.45, (w / sw) * 0.5));
      const segD = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => { const vx = bx - ax, vy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy))); return Math.hypot(px - ax - t * vx, py - ay - t * vy); };
      let best = 0;
      const col = Math.floor(x / sw), row = Math.floor(y / rh);
      for (let r = row - 1; r <= row + 1; r++) for (let q = col - 1; q <= col + 1; q++) {
        const u = (x - (q + 0.5) * sw) / sw, t = (y - r * rh) / rh; // u -0.5..0.5 across stitch, t 0..1 up the row
        for (const sgn of [-1, 1]) {
          const d = segD(u * sgn, t, 0.02, 0.1, 0.48, 1.05); // leg from bottom centre up to the top corner
          const prof = Math.max(0, 1 - (d / yarnR) ** 2); // rounded yarn cross-section
          best = Math.max(best, Math.sqrt(prof) * (0.85 + 0.15 * Math.min(1, t)));
        }
      }
      v = Math.min(1, best * 0.92 + 0.08 * valueNoise(x * 2.5, y * 2.5, p.seed)); break;
    }
    case 'leather': {
      // cellular pebble grain: soft bumps inside irregular cells, deeper creases between
      const cx = Math.floor(x / c), cy = Math.floor(y / c); let d1 = Infinity, d2 = Infinity;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const px = (cx + i + hash(cx + i, cy + j, p.seed)) * c, py = (cy + j + hash(cx + i, cy + j, p.seed + 1)) * c; const d = Math.hypot(x - px, y - py); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      const edge = Math.min(1, (d2 - d1) / Math.max(0.1, w)); const dome = Math.max(0, 1 - d1 / (c * 0.75));
      v = Math.min(1, edge * (0.45 + 0.55 * dome) + 0.1 * valueNoise(x * 4, y * 4, p.seed + 3)); break;
    }
    case 'carbon': {
      // 2x2 twill: tows of width cell, each tow is a shallow cylinder; warp over weft alternates every two
      const tx = Math.floor(x / c), ty = Math.floor(y / c); const over = ((tx + ty) >> 1) % 2 === 0 ? (tx + ty) % 2 === 0 : (tx + ty) % 2 !== 0;
      const ux = mod(x, c) / c - 0.5, uy = mod(y, c) / c - 0.5;
      const warp = Math.sqrt(Math.max(0, 1 - (uy * 2) ** 2)), weft = Math.sqrt(Math.max(0, 1 - (ux * 2) ** 2));
      const fibre = 0.9 + 0.1 * Math.sin((over ? x : y) * 2 * Math.PI / Math.max(0.2, w));
      v = (over ? warp : weft) * fibre; break;
    }
    case 'hammered': {
      // overlapping shallow dishes at jittered centres
      const cx = Math.floor(x / c), cy = Math.floor(y / c); let best = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const px = (cx + i + hash(cx + i, cy + j, p.seed)) * c, py = (cy + j + hash(cx + i, cy + j, p.seed + 1)) * c; const R = c * (0.6 + 0.3 * hash(cx + i, cy + j, p.seed + 2)); const d = Math.hypot(x - px, y - py); if (d < R) best = Math.max(best, Math.sqrt(1 - (d / R) ** 2)); }
      v = 1 - best * 0.9; break;
    }
    case 'weave': {
      // basket weave: bands of width cell alternating over/under in 1x1 plain weave, each band rounded
      const tx = Math.floor(x / c), ty = Math.floor(y / c); const over = (tx + ty) % 2 === 0;
      const ux = mod(x, c) / c - 0.5, uy = mod(y, c) / c - 0.5; const gapX = Math.abs(ux) > 0.5 - w / (2 * c) ? 1 : 0, gapY = Math.abs(uy) > 0.5 - w / (2 * c) ? 1 : 0;
      const bandH = over ? Math.sqrt(Math.max(0, 1 - (uy * 2) ** 2)) : Math.sqrt(Math.max(0, 1 - (ux * 2) ** 2));
      v = (over ? gapY : gapX) ? 0 : 0.25 + 0.75 * bandH * (over ? 1 : 0.8); break;
    }
    case 'ripple': {
      // interfering circular waves from three seeded sources
      let sum = 0; for (let k = 0; k < 3; k++) { const sx = hash(k, 1, p.seed) * c * 20, sy = hash(k, 2, p.seed) * c * 20; sum += Math.sin((Math.hypot(x - sx, y - sy) / c) * Math.PI * 2 * p.amp); }
      v = 0.5 + sum / 6; break;
    }
  }
  return p.invert ? 1 - v : v;
}

export interface SvgOpts { width: number; height: number; stroke: string; fill: string; mode: 'vector' | 'raster' }
/** Vector SVG tile in mm. Patterns with analytic primitives draw vectors; continuous ones rasterise to 0.5 mm cells. */
export function patternSVG(kind: PatternKind, p: PatternParams, o: SvgOpts): string {
  const W = o.width, H = o.height, c = p.cell, w = p.line;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" overflow="hidden"><defs><clipPath id="tile"><rect width="${W}" height="${H}"/></clipPath></defs><g clip-path="url(#tile)">`;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${p.invert ? o.stroke : o.fill}"/>`];
  const ink = p.invert ? o.fill : o.stroke;
  const vector = ['grid', 'stripes', 'knurl', 'triangles', 'hex', 'dots', 'bricks', 'chevron', 'scales'].includes(kind) && o.mode === 'vector';
  if (!vector) {
    const step = 0.5; let d = '';
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const v = patternValue(kind, x + step / 2, y + step / 2, { ...p, invert: false }); if (v > 0.5) d += `M${x.toFixed(2)} ${y.toFixed(2)}h${step}v${step}h-${step}z`; }
    parts.push(`<path d="${d}" fill="${ink}"/>`);
    return head + parts.join('') + '</g></svg>';
  }
  const g: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) => g.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`);
  switch (kind) {
    case 'grid': for (let x = 0; x <= W; x += c) line(x, 0, x, H); for (let y = 0; y <= H; y += c) line(0, y, W, y); break;
    case 'stripes': for (let x = 0; x <= W; x += c) line(x, 0, x, H); break;
    case 'knurl': for (let k = -H; k <= W + H; k += c * Math.SQRT2) { line(k, 0, k + H, H); line(k, H, k + H, 0); } break;
    case 'triangles': { const rh = c * 0.866; for (let y = 0; y <= H; y += rh) line(0, y, W, y); for (let k = -H * 2; k <= W + H; k += c) { line(k, 0, k + H / Math.tan(Math.PI / 3), H); line(k, H, k + H / Math.tan(Math.PI / 3), 0); } break; }
    case 'hex': { const R = c / Math.sqrt(3), rowH = c * 2 / Math.sqrt(3) * 0.75; for (let r = -1; r * rowH < H + c; r++) for (let q = -1; q * c < W + c; q++) { const cx = (q + 0.5) * c + ((r % 2 + 2) % 2 ? 0.5 : 0) * c, cy = (r + 0.5) * rowH + rowH / 6; const pts = []; for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; pts.push(`${(cx + R * Math.cos(a)).toFixed(2)},${(cy + R * Math.sin(a)).toFixed(2)}`); } g.push(`<polygon points="${pts.join(' ')}"/>`); } break; }
    case 'dots': { const R = Math.min(c / 2 - 0.2, Math.max(0.3, w)); for (let r = 0; r * c < H + c; r++) for (let q = -1; q * c < W + c; q++) { const off = p.stagger && r % 2 ? c / 2 : 0; g.push(`<circle cx="${(q * c + c / 2 + off).toFixed(2)}" cy="${(r * c + c / 2).toFixed(2)}" r="${R.toFixed(2)}" fill="${ink}" stroke="none"/>`); } break; }
    case 'bricks': { const bh = c / 2; for (let r = 0; r * bh < H; r++) { const off = r % 2 ? c / 2 : 0; for (let q = -1; q * c < W + c; q++) g.push(`<rect x="${(q * c + off + w / 2).toFixed(2)}" y="${(r * bh + w / 2).toFixed(2)}" width="${(c - w).toFixed(2)}" height="${(bh - w).toFixed(2)}" fill="${ink}" stroke="none"/>`); } break; }
    case 'chevron': { for (let k = -c; k <= W + H; k += c) { let d = ''; for (let y = 0; y <= H + c; y += c / 2) { const tri = Math.abs(((y % c) + c) % c - c / 2) * 2; d += `${d ? 'L' : 'M'}${(k - tri).toFixed(2)} ${y.toFixed(2)}`; } g.push(`<path d="${d}"/>`); } break; }
    case 'scales': { const rowH = c / 2; for (let r = 0; r * rowH < H + c; r++) { const off = r % 2 ? c / 2 : 0; for (let q = -1; q * c < W + c; q++) { const cx = q * c + off, cy = r * rowH, R = c / 2; g.push(`<path d="M${(cx - R).toFixed(2)} ${cy.toFixed(2)}A${R} ${R} 0 0 0 ${(cx + R).toFixed(2)} ${cy.toFixed(2)}"/>`); } } break; }
  }
  parts.push(`<g stroke="${ink}" stroke-width="${w}" fill="none" stroke-linecap="round">${g.join('')}</g>`);
  return head + parts.join('') + '</g></svg>';
}

/** Grayscale displacement map (PNG data URL) for slicers that paint textures from images. */
export function patternPNG(kind: PatternKind, p: PatternParams, sizeMm: number, px = 512): string {
  const cv = document.createElement('canvas'); cv.width = cv.height = px; const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) { const v = Math.round(255 * patternValue(kind, (i / px) * sizeMm, (j / px) * sizeMm, p)); const k = (j * px + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
