// Image -> solid: relief/lithophane heightfields, silhouette extrusions and cookie cutters.
import type { Manifold } from 'manifold-3d';
import { M } from '../core/manifold';

export interface Raster { w: number; h: number; v: Float32Array } // grayscale 0..1, 1 = white

export async function loadImage(file: File | string): Promise<HTMLImageElement> {
  const url = typeof file === 'string' ? file : URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not decode image')); img.src = url; });
  return img;
}

/** Resample to w x h grayscale. */
export function rasterize(img: HTMLImageElement, w: number, h: number, gamma = 1): Raster {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data; const v = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const a = d[i * 4 + 3] / 255; const g = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; v[i] = Math.pow(g * a + (1 - a), gamma); }
  return { w, h, v };
}
export function blur(r: Raster, radius: number): Raster {
  if (radius <= 0) return r; const { w, h } = r; const out = new Float32Array(w * h); const tmp = new Float32Array(w * h); const n = 2 * radius + 1;
  for (let y = 0; y < h; y++) { let s = 0; for (let x = -radius; x <= radius; x++) s += r.v[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[y * w + x] = s / n; s += r.v[y * w + Math.min(w - 1, x + radius + 1)] - r.v[y * w + Math.max(0, x - radius)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -radius; y <= radius; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x]; } }
  return { w, h, v: out };
}

export interface ReliefOpts { widthMm: number; base: number; depth: number; invert: boolean; border: number; smooth: number; mirror: boolean }
/** Heightfield solid: top surface z = base + depth * value, flat bottom at z = 0, closed walls. */
export function relief(r0: Raster, o: ReliefOpts): Manifold {
  const r = blur(r0, o.smooth);
  const { w, h } = r; const sx = o.widthMm / (w - 1);
  const nv = w * h; const verts = new Float32Array(nv * 2 * 3);
  const zAt = (i: number, x: number, y: number) => {
    let v = r.v[i]; if (o.invert) v = 1 - v; // lithophane: dark = thick
    if (o.border > 0 && (x < o.border || y < o.border || x >= w - o.border || y >= h - o.border)) v = 1;
    return o.base + o.depth * v;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const px = (o.mirror ? w - 1 - x : x) * sx - o.widthMm / 2, py = (h - 1 - y) * sx - ((h - 1) * sx) / 2;
    verts[i * 3] = px; verts[i * 3 + 1] = py; verts[i * 3 + 2] = zAt(i, x, y);
    verts[(nv + i) * 3] = px; verts[(nv + i) * 3 + 1] = py; verts[(nv + i) * 3 + 2] = 0;
  }
  const tris: number[] = [];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a = y * w + x, b = a + 1, c = a + w, d = c + 1;
    tris.push(a, c, b, b, c, d); // top (CCW seen from +z given py decreasing with y... orientation fixed below)
    tris.push(nv + a, nv + b, nv + c, nv + b, nv + d, nv + c); // bottom
  }
  // walls
  for (let x = 0; x < w - 1; x++) { const a = x, b = x + 1; tris.push(a, b, nv + a, b, nv + b, nv + a); const c = (h - 1) * w + x, d = c + 1; tris.push(c, nv + c, d, d, nv + c, nv + d); }
  for (let y = 0; y < h - 1; y++) { const a = y * w, c = a + w; tris.push(a, nv + a, c, c, nv + a, nv + c); const b = y * w + w - 1, d = b + w; tris.push(b, d, nv + b, d, nv + d, nv + b); }
  const { Manifold, Mesh } = M();
  let m = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(tris) }));
  if (m.status() !== 'NoError' || m.volume() < 0) {
    // flip all
    const flipped = new Uint32Array(tris.length); for (let t = 0; t < tris.length; t += 3) { flipped[t] = tris[t]; flipped[t + 1] = tris[t + 2]; flipped[t + 2] = tris[t + 1]; }
    m.delete(); m = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: verts, triVerts: flipped }));
  }
  if (m.status() !== 'NoError') throw new Error(`Relief mesh failed: ${m.status()}`);
  return m;
}

/** Binary mask -> boundary loops (pixel-edge tracing, interior on the left). Coordinates in pixels, y up. */
export function maskToPolygons(r: Raster, threshold: number, darkIsSolid: boolean): [number, number][][] {
  const { w, h } = r;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (darkIsSolid ? r.v[y * w + x] < threshold : r.v[y * w + x] >= threshold);
  // directed edges keyed by start point; y flipped so image top is +y
  const edges = new Map<string, [number, number, number, number]>(); // key start -> [sx, sy, ex, ey]
  const key = (x: number, y: number) => `${x},${y}`;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    const Y = h - y; // top edge of pixel at y is at image-y = y -> flipped Y = h - y; bottom at h - y - 1
    const x0 = x, x1 = x + 1, yTop = Y, yBot = Y - 1;
    // CCW around pixel (in y-up coords): bottom edge left->right, right edge bottom->top, top edge right->left, left edge top->bottom
    if (!inside(x, y + 1)) edges.set(key(x0, yBot), [x0, yBot, x1, yBot]);
    if (!inside(x + 1, y)) edges.set(key(x1, yBot), [x1, yBot, x1, yTop]);
    if (!inside(x, y - 1)) edges.set(key(x1, yTop), [x1, yTop, x0, yTop]);
    if (!inside(x - 1, y)) edges.set(key(x0, yTop), [x0, yTop, x0, yBot]);
  }
  const loops: [number, number][][] = [];
  while (edges.size) {
    const [k0, e0] = edges.entries().next().value as [string, [number, number, number, number]];
    const loop: [number, number][] = [];
    let k = k0, e = e0; let guard = 0;
    while (e && guard++ < 1e7) {
      edges.delete(k); loop.push([e[0], e[1]]);
      k = key(e[2], e[3]); e = edges.get(k)!;
      if (k === k0) break;
    }
    if (loop.length >= 4) loops.push(collinearFilter(loop));
  }
  return loops;
}
function collinearFilter(p: [number, number][]) {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i++) { const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length]; if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b); }
  return out;
}
/** Ramer-Douglas-Peucker on a closed loop. */
export function simplifyLoop(p: [number, number][], tol: number): [number, number][] {
  if (tol <= 0 || p.length < 4) return p;
  const keep = new Uint8Array(p.length); keep[0] = 1; const half = Math.floor(p.length / 2); keep[half] = 1;
  const rec = (i0: number, i1: number) => {
    let maxD = 0, idx = -1; const [ax, ay] = p[i0], [bx, by] = p[i1 % p.length]; const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((bx - ax) * (ay - p[i][1]) - (ax - p[i][0]) * (by - ay)) / L; if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > tol && idx > 0) { keep[idx] = 1; rec(i0, idx); rec(idx, i1); }
  };
  rec(0, half); rec(half, p.length);
  return p.filter((_, i) => keep[i]);
}
/** Chaikin corner cutting for smoother outlines. */
export function smoothLoop(p: [number, number][], iters: number): [number, number][] {
  let q = p;
  for (let k = 0; k < iters; k++) { const out: [number, number][] = []; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } q = out; }
  return q;
}

export interface SilhouetteOpts { widthMm: number; height: number; threshold: number; darkIsSolid: boolean; simplify: number; smooth: number; minArea: number }
export function silhouetteCrossSection(r: Raster, o: SilhouetteOpts) {
  const { CrossSection } = M();
  const sx = o.widthMm / r.w;
  let loops = maskToPolygons(r, o.threshold, o.darkIsSolid).map((l) => simplifyLoop(l, o.simplify));
  loops = loops.map((l) => smoothLoop(l, o.smooth)).filter((l) => l.length >= 3);
  const polys = loops.map((l) => l.map(([x, y]) => [x * sx - o.widthMm / 2, y * sx - (r.h * sx) / 2] as [number, number]));
  let cs = new CrossSection(polys, 'Positive');
  if (o.minArea > 0) { const parts = cs.decompose().filter((c) => c.area() >= o.minArea); cs = parts.length ? CrossSection.compose(parts) : cs; }
  return cs;
}
export function silhouette(r: Raster, o: SilhouetteOpts): Manifold {
  const cs = silhouetteCrossSection(r, o);
  if (cs.isEmpty()) throw new Error('Threshold produced an empty shape. Adjust threshold or invert.');
  return cs.extrude(o.height);
}
export interface CutterOpts { wall: number; height: number; flange: number; flangeThick: number; bladeTaper: number }
/** Cookie cutter: thin blade wall around the outline plus a wider flange at the base. */
export function cookieCutter(r: Raster, o: SilhouetteOpts, c: CutterOpts): Manifold {
  const { Manifold } = M();
  const cs = silhouetteCrossSection(r, o);
  if (cs.isEmpty()) throw new Error('Threshold produced an empty shape.');
  const blade = cs.offset(c.wall, 'Round', 2, 16).subtract(cs).extrude(c.height, 1, 0, c.bladeTaper > 0 ? 1 : 1);
  const flange = cs.offset(c.wall + c.flange, 'Round', 2, 16).subtract(cs).extrude(c.flangeThick);
  return Manifold.union(blade, flange);
}
