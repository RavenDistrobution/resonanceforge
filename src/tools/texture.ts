// Apply a procedural pattern as surface displacement to a Manifold (refine, then move vertices along their normals).
import type { Manifold } from 'manifold-3d';
import { M } from '../core/manifold';
import { patternValue, type PatternKind, type PatternParams } from './patterns';

export interface TextureOpts {
  kind: PatternKind; params: PatternParams;
  image?: { w: number; h: number; v: Float32Array; sizeMm: number; repeat: boolean }; // when set, the heightmap replaces the procedural pattern
  depth: number; scale: number; // scale multiplies pattern coordinates (mm per pattern unit)
  projection: 'z' | 'x' | 'y' | 'cyl' | 'tri'; refine: number; keepBottom: boolean; onlyUp: boolean; mask: 'all' | 'sides' | 'top';
  soften?: number; // mm: blur radius applied to the pattern before displacement (0 = crisp)
  relax?: number;  // Taubin smoothing passes on the displaced vertices (0 = none)
}

export function estimateTriangles(m: Manifold, refine: number) {
  const area = m.surfaceArea(); return Math.round(area / (0.433 * refine * refine));
}

export function applyTexture(src: Manifold, o: TextureOpts): Manifold {
  const { Manifold, Mesh } = M();
  const refined = o.refine > 0 ? src.refineToLength(o.refine) : src;
  const mesh = refined.getMesh();
  const np = mesh.numProp, nV = mesh.numVert, nT = mesh.numTri;
  const pos = mesh.vertProperties, tv = mesh.triVerts;
  const normals = new Float32Array(nV * 3);
  // area-weighted vertex normals
  for (let t = 0; t < nT; t++) {
    const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
    const ax = pos[a * np], ay = pos[a * np + 1], az = pos[a * np + 2];
    const ux = pos[b * np] - ax, uy = pos[b * np + 1] - ay, uz = pos[b * np + 2] - az;
    const vx = pos[c * np] - ax, vy = pos[c * np + 1] - ay, vz = pos[c * np + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { normals[i * 3] += nx; normals[i * 3 + 1] += ny; normals[i * 3 + 2] += nz; }
  }
  const bb = refined.boundingBox();
  const zmin = bb.min[2], cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const R = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) / 2;
  const out = new Float32Array(nV * 3); const moved = new Uint8Array(nV);
  for (let i = 0; i < nV; i++) {
    const x = pos[i * np], y = pos[i * np + 1], z = pos[i * np + 2];
    let nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    if (o.keepBottom && (z < zmin + 1e-3 || nz < -0.7)) continue;
    if (o.onlyUp && nz < 0.2) continue;
    if (o.mask === 'sides' && Math.abs(nz) > 0.5) continue;
    if (o.mask === 'top' && nz < 0.5) continue;
    let u = 0, v = 0;
    switch (o.projection) {
      case 'z': u = x; v = y; break;
      case 'x': u = y; v = z; break;
      case 'y': u = x; v = z; break;
      case 'cyl': u = Math.atan2(y - cy, x - cx) * R; v = z; break;
      case 'tri': { const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz); if (az >= ax && az >= ay) { u = x; v = y; } else if (ax >= ay) { u = y; v = z; } else { u = x; v = z; } break; }
    }
    let val: number;
    if (o.image) {
      const im = o.image; const sx = im.sizeMm / im.w, sy = im.sizeMm / im.w; let px = u / sx, py = -v / sy; // image y runs down
      if (im.repeat) { px = ((px % im.w) + im.w) % im.w; py = ((py % im.h) + im.h) % im.h; } else { px += im.w / 2; py += im.h / 2; if (px < 0 || py < 0 || px >= im.w - 1 || py >= im.h - 1) continue; }
      const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0; const idx = (x: number, y: number) => im.v[Math.min(im.h - 1, Math.max(0, y)) * im.w + Math.min(im.w - 1, Math.max(0, x))];
      val = idx(x0, y0) * (1 - fx) * (1 - fy) + idx(x0 + 1, y0) * fx * (1 - fy) + idx(x0, y0 + 1) * (1 - fx) * fy + idx(x0 + 1, y0 + 1) * fx * fy;
      if (o.params.invert) val = 1 - val;
    } else if (o.soften && o.soften > 0) {
      // 3x3 box supersample over +-soften mm: softens ridges into rounded bumps
      const r = o.soften; let acc = 0;
      for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) acc += patternValue(o.kind, (u + a * r) / o.scale, (v + b2 * r) / o.scale, o.params);
      val = acc / 9;
    } else val = patternValue(o.kind, u / o.scale, v / o.scale, o.params);
    const d = (val - 0.5) * o.depth; // centred so the mean surface stays put
    out[i * 3] += nx * d; out[i * 3 + 1] += ny * d; out[i * 3 + 2] += nz * d;
    moved[i] = 1;
  }
  if (o.relax && o.relax > 0) taubin(out, tv, moved, Math.round(o.relax));
  const m = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: out, triVerts: new Uint32Array(tv) }));
  if (m.status() !== 'NoError') { m.delete(); throw new Error(`Texture produced an invalid mesh (${m.status()}). Lower depth or raise refine length.`); }
  if (refined !== src) refined.delete();
  return m;
}

/** Taubin lambda/mu smoothing restricted to flagged vertices; keeps volume roughly constant while rounding texture peaks. */
function taubin(pos: Float32Array, tv: Uint32Array, flag: Uint8Array, passes: number) {
  const nV = pos.length / 3; const adj: number[][] = Array.from({ length: nV }, () => []);
  for (let t = 0; t < tv.length; t += 3) { const a = tv[t], b = tv[t + 1], c = tv[t + 2]; adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b); }
  const tmp = new Float32Array(pos.length);
  const step = (f: number) => {
    tmp.set(pos);
    for (let i = 0; i < nV; i++) {
      if (!flag[i] || !adj[i].length) continue;
      let sx = 0, sy = 0, sz = 0; for (const j of adj[i]) { sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; }
      const n = adj[i].length; tmp[i * 3] = pos[i * 3] + f * (sx / n - pos[i * 3]); tmp[i * 3 + 1] = pos[i * 3 + 1] + f * (sy / n - pos[i * 3 + 1]); tmp[i * 3 + 2] = pos[i * 3 + 2] + f * (sz / n - pos[i * 3 + 2]);
    }
    pos.set(tmp);
  };
  for (let k = 0; k < passes; k++) { step(0.5); step(-0.53); }
}
