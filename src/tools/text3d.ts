// 3D text from any TTF/OTF font via opentype.js -> flattened contours -> Manifold extrude.
import * as opentype from 'opentype.js';
import type { Manifold, CrossSection as CS } from 'manifold-3d';
import { M } from '../core/manifold';

export const BUNDLED_FONTS: [string, string][] = [
  ['fonts/ttf/Figtree-Regular.ttf', 'Figtree (clean sans)'],
  ['fonts/ttf/Bungee-Regular.ttf', 'Bungee (chunky display)'],
  ['fonts/ttf/RussoOne-Regular.ttf', 'Russo One (bold tech)'],
  ['fonts/ttf/SpaceMono-Bold.ttf', 'Space Mono Bold'],
  ['fonts/ttf/Pacifico-Regular.ttf', 'Pacifico (script)'],
];
const cache = new Map<string, opentype.Font>();

export async function loadFont(url: string): Promise<opentype.Font> {
  const c = cache.get(url); if (c) return c;
  const buf = await (await fetch(url)).arrayBuffer();
  const f = opentype.parse(buf); cache.set(url, f); return f;
}
export function fontFromBuffer(buf: ArrayBuffer, key: string) { const f = opentype.parse(buf); cache.set(key, f); return f; }

export interface TextOpts { text: string; size: number; height: number; letterSpacing: number; lineSpacing: number; align: 'left' | 'center' | 'right'; segments?: number }

/** Flatten the glyph outlines into polygons in mm, y up, baseline at y=0 for the first line. */
export function textPolygons(font: opentype.Font, o: TextOpts): [number, number][][] {
  const lines = o.text.split('\n');
  const polys: [number, number][][] = [];
  const seg = o.segments ?? Math.max(4, Math.min(16, Math.round(o.size / 2)));
  const widths = lines.map((l) => font.getAdvanceWidth(l, o.size, { letterSpacing: o.letterSpacing, kerning: true }));
  const maxW = Math.max(...widths, 0);
  lines.forEach((line, li) => {
    const x0 = o.align === 'left' ? 0 : o.align === 'center' ? (maxW - widths[li]) / 2 : maxW - widths[li];
    const y0 = -li * o.size * o.lineSpacing;
    const path = font.getPath(line, x0, 0, o.size, { letterSpacing: o.letterSpacing, kerning: true });
    let cur: [number, number][] = [];
    let last: [number, number] = [0, 0];
    const push = (x: number, y: number) => { last = [x, -y + y0]; cur.push(last); };
    for (const c of path.commands) {
      if (c.type === 'M') { if (cur.length >= 3) polys.push(cur); cur = []; push(c.x, c.y); }
      else if (c.type === 'L') push(c.x, c.y);
      else if (c.type === 'Q') { const [px, py] = [last[0], -(last[1] - y0)]; for (let i = 1; i <= seg; i++) { const t = i / seg, u = 1 - t; push(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y); } }
      else if (c.type === 'C') { const [px, py] = [last[0], -(last[1] - y0)]; for (let i = 1; i <= seg; i++) { const t = i / seg, u = 1 - t; push(u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y); } }
      else if (c.type === 'Z') { if (cur.length >= 3) polys.push(cur); cur = []; }
    }
    if (cur.length >= 3) polys.push(cur);
  });
  // drop duplicate closing points
  return polys.map((p) => { const a = p[0], b = p[p.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) p.pop(); return p; }).filter((p) => p.length >= 3);
}

export function textCrossSection(font: opentype.Font, o: TextOpts): CS {
  const { CrossSection } = M();
  const polys = textPolygons(font, o);
  if (!polys.length) throw new Error('No glyph outlines produced (empty text or unsupported characters).');
  // Centre on origin for easier placement
  const cs = new CrossSection(polys, 'NonZero');
  const b = cs.bounds();
  return cs.translate(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2);
}

export interface PlateOpts { kind: 'none' | 'raised' | 'engraved' | 'keychain' | 'cutout'; margin: number; thickness: number; corner: number; ringOuter: number; ringInner: number }

export function buildText(font: opentype.Font, o: TextOpts, plate: PlateOpts): Manifold {
  const { CrossSection, Manifold } = M();
  const cs = textCrossSection(font, o);
  if (plate.kind === 'none') return cs.extrude(o.height);
  const b = cs.bounds();
  const w = b.max[0] - b.min[0] + plate.margin * 2, d = b.max[1] - b.min[1] + plate.margin * 2;
  let plateCs = CrossSection.square([w, d], true);
  if (plate.corner > 0) plateCs = CrossSection.square([w - 2 * plate.corner, d - 2 * plate.corner], true).offset(plate.corner, 'Round', 2, 24);
  if (plate.kind === 'keychain') {
    const ring = CrossSection.circle(plate.ringOuter, 48).subtract(CrossSection.circle(plate.ringInner, 48)).translate(-w / 2 - plate.ringOuter * 0.6, 0);
    const bridge = CrossSection.square([plate.ringOuter * 1.2, plate.ringOuter * 1.2], true).translate(-w / 2, 0);
    plateCs = plateCs.add(bridge).add(ring).subtract(CrossSection.circle(plate.ringInner, 48).translate(-w / 2 - plate.ringOuter * 0.6, 0));
  }
  const base = plateCs.extrude(plate.thickness);
  if (plate.kind === 'engraved') return Manifold.difference(base, cs.extrude(o.height + 1).translate(0, 0, plate.thickness - o.height));
  if (plate.kind === 'cutout') return Manifold.difference(base, cs.extrude(plate.thickness + 2).translate(0, 0, -1));
  return Manifold.union(base, cs.extrude(o.height).translate(0, 0, plate.thickness));
}

/** Text laid along an arc: each glyph is placed at its angle on a circle of the given radius (positive = text reads around the top). */
export function curvedTextCrossSection(font: opentype.Font, text: string, size: number, radius: number, letterSpacing = 0, startDeg = 90, inside = false): CS {
  const { CrossSection } = M(); const glyphs = font.stringToGlyphs(text); const scale = size / font.unitsPerEm;
  const advances = glyphs.map((g) => (g.advanceWidth ?? 0) * scale + letterSpacing * size); const total = advances.reduce((a, b) => a + b, 0);
  const pieces: CS[] = []; let dist = -total / 2;
  glyphs.forEach((g, i) => {
    const polys = textPolygonsFromPath(g.getPath(0, 0, size), 8); if (polys.length) {
      const w = advances[i]; const mid = dist + w / 2; const ang = (inside ? 1 : -1) * (mid / radius); const deg = (ang * 180) / Math.PI;
      const cs = new CrossSection(polys, 'NonZero').translate(-w / 2 + letterSpacing * size / 2, inside ? -size * 0.7 : 0).rotate(inside ? 180 : 0).translate(0, radius).rotate(deg).rotate(startDeg - 90);
      pieces.push(cs);
    }
    dist += advances[i];
  });
  if (!pieces.length) throw new Error('No glyph outlines produced.');
  return CrossSection.union(pieces);
}
function textPolygonsFromPath(path: opentype.Path, seg: number): [number, number][][] {
  const polys: [number, number][][] = []; let cur: [number, number][] = []; let last: [number, number] = [0, 0];
  const push = (x: number, y: number) => { last = [x, -y]; cur.push(last); };
  for (const c of path.commands) {
    if (c.type === 'M') { if (cur.length >= 3) polys.push(cur); cur = []; push(c.x, c.y); }
    else if (c.type === 'L') push(c.x, c.y);
    else if (c.type === 'Q') { const [px, py] = [last[0], -last[1]]; for (let i = 1; i <= seg; i++) { const t = i / seg, u = 1 - t; push(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y); } }
    else if (c.type === 'C') { const [px, py] = [last[0], -last[1]]; for (let i = 1; i <= seg; i++) { const t = i / seg, u = 1 - t; push(u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y); } }
    else if (c.type === 'Z') { if (cur.length >= 3) polys.push(cur); cur = []; }
  }
  if (cur.length >= 3) polys.push(cur);
  return polys.map((p) => { const a = p[0], b = p[p.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) p.pop(); return p; }).filter((p) => p.length >= 3);
}
