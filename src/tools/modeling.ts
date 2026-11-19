// Extra modelling operations: arrays, auto-orient, deformers, shell/offset/rounding, Gridfinity, test coupons, QR plates.
import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import { M } from '../core/manifold';
import qrcode from 'qrcode-generator';
import { patternValue, type PatternKind, type PatternParams } from './patterns';
import { maskToPolygons, simplifyLoop, type Raster } from './image2mesh';

export const mat4 = (m: THREE.Matrix4) => Array.from(m.elements) as unknown as import('manifold-3d').Mat4;

// ---------------- arrays
export interface LinearArray { count: number; dx: number; dy: number; dz: number }
export interface PolarArray { count: number; radius: number; axis: 'x' | 'y' | 'z'; startDeg: number; sweepDeg: number; rotateCopies: boolean }
export interface GridArray { nx: number; ny: number; sx: number; sy: number }
export function linearArray(m: Manifold, a: LinearArray): Manifold[] { const out: Manifold[] = []; for (let i = 0; i < a.count; i++) out.push(m.translate(a.dx * i, a.dy * i, a.dz * i)); return out; }
export function gridArray(m: Manifold, a: GridArray): Manifold[] { const out: Manifold[] = []; for (let j = 0; j < a.ny; j++) for (let i = 0; i < a.nx; i++) out.push(m.translate(a.sx * i, a.sy * j, 0)); return out; }
export function polarArray(m: Manifold, a: PolarArray, center: [number, number, number]): Manifold[] {
  const out: Manifold[] = []; const step = a.count > 1 ? a.sweepDeg / (a.sweepDeg >= 360 ? a.count : a.count - 1) : 0;
  for (let i = 0; i < a.count; i++) {
    const ang = a.startDeg + step * i; const rot: [number, number, number] = a.axis === 'z' ? [0, 0, ang] : a.axis === 'y' ? [0, ang, 0] : [ang, 0, 0];
    let c = m.translate(-center[0], -center[1], -center[2]);
    if (a.radius !== 0) c = a.axis === 'z' ? c.translate(a.radius, 0, 0) : a.axis === 'y' ? c.translate(0, 0, a.radius) : c.translate(0, a.radius, 0);
    if (!a.rotateCopies) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot.map((d) => (d * Math.PI) / 180) as [number, number, number]))); const pos = new THREE.Vector3(a.axis === 'z' ? a.radius : 0, a.axis === 'x' ? a.radius : 0, a.axis === 'y' ? a.radius : 0).applyQuaternion(q); c = m.translate(-center[0], -center[1], -center[2]).translate(pos.x, pos.y, pos.z); }
    else c = c.rotate(rot);
    out.push(c.translate(center[0], center[1], center[2]));
  }
  return out;
}

// ---------------- auto orient (least support area, most bed contact)
export function autoOrient(geometry: THREE.BufferGeometry, overhangDeg = 45): { quaternion: THREE.Quaternion; score: number; overhang: number; contact: number } {
  const pos = geometry.getAttribute('position').array as Float32Array; const n = pos.length / 9;
  const normals: THREE.Vector3[] = [], areas: number[] = [], cz: THREE.Vector3[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t++) { a.fromArray(pos, t * 9); b.fromArray(pos, t * 9 + 3); c.fromArray(pos, t * 9 + 6); const nn = new THREE.Vector3().subVectors(b, a).cross(c.clone().sub(a)); const L = nn.length(); if (L < 1e-9) continue; areas.push(L / 2); normals.push(nn.divideScalar(L)); cz.push(a.clone().add(b).add(c).divideScalar(3)); }
  const cands: THREE.Quaternion[] = []; const dirs = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  for (const d of dirs) cands.push(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...d), new THREE.Vector3(0, 0, -1)));
  // tilted candidates
  for (const d of dirs) for (const tilt of [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]]) { const v = new THREE.Vector3(...d).add(new THREE.Vector3(...tilt).multiplyScalar(0.7)).normalize(); cands.push(new THREE.Quaternion().setFromUnitVectors(v, new THREE.Vector3(0, 0, -1))); }
  const cos = -Math.cos((overhangDeg * Math.PI) / 180); let best = { quaternion: new THREE.Quaternion(), score: -Infinity, overhang: 0, contact: 0 };
  for (const q of cands) {
    let minZ = Infinity; const zs = cz.map((p) => p.clone().applyQuaternion(q).z); for (const z of zs) minZ = Math.min(minZ, z);
    let over = 0, contact = 0;
    normals.forEach((nv, i) => { const nz = nv.clone().applyQuaternion(q).z; if (zs[i] < minZ + 0.3 && nz < -0.9) contact += areas[i]; else if (nz < cos) over += areas[i] * -nz; });
    const score = contact * 0.5 - over;
    if (score > best.score) best = { quaternion: q, score, overhang: over, contact };
  }
  return best;
}

// ---------------- deformers (vertex warps on a refined mesh)
export interface Deform { kind: 'twist' | 'taper' | 'bend' | 'bulge' | 'noise'; amount: number; axis: 'z' | 'x' | 'y'; refine: number; seed: number }
export function deform(src: Manifold, d: Deform): Manifold {
  const bb = src.boundingBox(); const refined = d.refine > 0 ? src.refineToLength(d.refine) : src;
  const ai = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2; const lo = bb.min[ai], hi = bb.max[ai], L = Math.max(1e-6, hi - lo);
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2, cz = (bb.min[2] + bb.max[2]) / 2; const c = [cx, cy, cz];
  const o1 = (ai + 1) % 3, o2 = (ai + 2) % 3;
  const hash = (x: number, y: number, z: number) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + d.seed) * 43758.5453; return s - Math.floor(s) - 0.5; };
  const out = refined.warp((v) => {
    const t = (v[ai] - lo) / L; // 0 at the bottom of the axis, 1 at the top
    if (d.kind === 'twist') { const ang = (d.amount * Math.PI / 180) * t; const p = v[o1] - c[o1], q = v[o2] - c[o2]; v[o1] = c[o1] + p * Math.cos(ang) - q * Math.sin(ang); v[o2] = c[o2] + p * Math.sin(ang) + q * Math.cos(ang); }
    else if (d.kind === 'taper') { const s = 1 + (d.amount / 100) * t; v[o1] = c[o1] + (v[o1] - c[o1]) * s; v[o2] = c[o2] + (v[o2] - c[o2]) * s; }
    else if (d.kind === 'bulge') { const s = 1 + (d.amount / 100) * Math.sin(Math.PI * t); v[o1] = c[o1] + (v[o1] - c[o1]) * s; v[o2] = c[o2] + (v[o2] - c[o2]) * s; }
    else if (d.kind === 'bend') { // bend the axis into an arc of `amount` degrees around o1
      const ang = (d.amount * Math.PI) / 180; if (Math.abs(ang) < 1e-6) return; const R = L / ang; const theta = t * ang; const r = R - (v[o1] - c[o1]);
      v[ai] = lo + r * Math.sin(theta); v[o1] = c[o1] + R - r * Math.cos(theta);
    }
    else if (d.kind === 'noise') { const k = d.amount; v[0] += k * hash(v[0] * 0.37, v[1] * 0.41, v[2] * 0.43); v[1] += k * hash(v[1] * 0.37, v[2] * 0.41, v[0] * 0.43); v[2] += k * hash(v[2] * 0.37, v[0] * 0.41, v[1] * 0.43); }
  });
  if (refined !== src) refined.delete();
  if (out.status() !== 'NoError') { out.delete(); throw new Error('Deformation made the mesh self-intersect; reduce the amount or raise mesh density.'); }
  return out;
}

// ---------------- shell / offset / round
function ball(r: number) { return M().Manifold.sphere(Math.max(0.05, r), 8); }
const MINK_LIMIT = 1500; // triangles; Minkowski cost explodes on non-convex meshes beyond this
/** Fast offset: move every vertex along its area-weighted normal. Exact Minkowski is used for small meshes, where it handles sharp corners properly. */
function normalOffset(m: Manifold, delta: number): Manifold {
  const { Manifold, Mesh } = M(); const mesh = m.getMesh(); const np = mesh.numProp, nV = mesh.numVert, nT = mesh.numTri; const pos = mesh.vertProperties, tv = mesh.triVerts;
  const nrm = new Float32Array(nV * 3);
  for (let t = 0; t < nT; t++) { const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2]; const ax = pos[a * np], ay = pos[a * np + 1], az = pos[a * np + 2]; const ux = pos[b * np] - ax, uy = pos[b * np + 1] - ay, uz = pos[b * np + 2] - az, vx = pos[c * np] - ax, vy = pos[c * np + 1] - ay, vz = pos[c * np + 2] - az; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const i of [a, b, c]) { nrm[i * 3] += nx; nrm[i * 3 + 1] += ny; nrm[i * 3 + 2] += nz; } }
  const out = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) { const L = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1; out[i * 3] = pos[i * np] + (nrm[i * 3] / L) * delta; out[i * 3 + 1] = pos[i * np + 1] + (nrm[i * 3 + 1] / L) * delta; out[i * 3 + 2] = pos[i * np + 2] + (nrm[i * 3 + 2] / L) * delta; }
  const r = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: out, triVerts: new Uint32Array(tv) }));
  if (r.status() !== 'NoError' || r.isEmpty()) { r.delete(); throw new Error('Offset self-intersected (sharp corners or thin features). Try Simplify first, a smaller amount, or Round edges.'); }
  return r;
}
export function offsetSolid(m: Manifold, delta: number): Manifold {
  if (Math.abs(delta) < 1e-6) return m.translate(0, 0, 0);
  if (m.numTri() <= MINK_LIMIT) return delta > 0 ? m.minkowskiSum(ball(delta)) : m.minkowskiDifference(ball(-delta));
  return normalOffset(m, delta);
}
/** Hollow with a wall; optional open side removes the wall on that face so the part becomes a cup/box. */
export function shell(m: Manifold, wall: number, open: 'none' | 'top' | 'bottom' = 'none'): Manifold {
  const { Manifold } = M(); const inner = offsetSolid(m, -wall);
  if (inner.isEmpty()) throw new Error('Wall is thicker than the part; nothing left inside.');
  let hollow = Manifold.difference(m, inner);
  if (open !== 'none') { const bb = m.boundingBox(); const w = bb.max[0] - bb.min[0] + 2, d = bb.max[1] - bb.min[1] + 2; const cut = open === 'top' ? Manifold.cube([w, d, wall + 1], true).translate((bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.max[2] - wall / 2 + 0.5) : Manifold.cube([w, d, wall + 1], true).translate((bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.min[2] + wall / 2 - 0.5);
    // remove only the lid region above the cavity so the side walls keep their top edge
    const cavityPrism = inner.project().extrude(wall + 2).translate(0, 0, open === 'top' ? bb.max[2] - wall - 1 : bb.min[2] - 1);
    hollow = Manifold.difference(hollow, Manifold.intersection(cut, cavityPrism)); }
  return hollow;
}
/** Round all edges by morphological opening then closing with radius r. Exact but expensive: limited to small meshes. */
export function roundEdges(m: Manifold, r: number): Manifold {
  if (m.numTri() > MINK_LIMIT) throw new Error(`Rounding needs a simple mesh (under ${MINK_LIMIT} triangles; this one has ${m.numTri()}). Run Simplify first or round before adding textures and deformers.`);
  const opened = m.minkowskiDifference(ball(r)).minkowskiSum(ball(r));
  if (opened.isEmpty()) throw new Error('Radius too large for this part.');
  return opened.minkowskiSum(ball(r)).minkowskiDifference(ball(r));
}
/** Wrap a flat relief (built around the origin, width w along X) onto a cylinder of the given radius; curvature in the XZ plane. */
export function wrapCylinder(m: Manifold, radius: number): Manifold {
  const out = m.warp((v) => { const ang = v[0] / radius; const r = radius + v[2]; v[0] = r * Math.sin(ang); v[2] = r * Math.cos(ang) - radius; });
  if (out.status() !== 'NoError') { out.delete(); throw new Error('Wrap failed; increase the radius.'); }
  return out;
}

// ---------------- Gridfinity (approximate profile, prints and stacks with standard bins)
export function gridfinityBin(ux: number, uy: number, uz: number, wall = 1.2, floor = 1.0, lip = true): Manifold {
  const { Manifold, CrossSection } = M();
  const cellFoot = (cx: number, cy: number) => {
    // base profile from the bottom: 0.8 chamfer, 1.8 straight, 2.15 chamfer (total 4.75) on a 41.5 square with 3.75 mm corner radius
    const sq = (size: number, rad: number) => CrossSection.square([size - 2 * rad, size - 2 * rad], true).offset(rad, 'Round', 2, 16);
    const bottom = sq(41.5 - 2 * 2.95, 0.8).extrude(0.8, 1, 0, (41.5 - 2 * 2.15) / (41.5 - 2 * 2.95));
    const mid = sq(41.5 - 2 * 2.15, 1.6).extrude(1.8).translate(0, 0, 0.8);
    const top = sq(41.5 - 2 * 2.15, 1.6).extrude(2.15, 1, 0, 41.5 / (41.5 - 2 * 2.15)).translate(0, 0, 2.6);
    return Manifold.union([bottom, mid, top]).translate(cx, cy, 0);
  };
  const feet: Manifold[] = []; const W = ux * 42, D = uy * 42;
  for (let j = 0; j < uy; j++) for (let i = 0; i < ux; i++) feet.push(cellFoot(-W / 2 + 21 + i * 42, -D / 2 + 21 + j * 42));
  const H = uz * 7; const outerCs = CrossSection.square([W - 0.5 - 7.5, D - 0.5 - 7.5], true).offset(3.75, 'Round', 2, 16);
  const body = outerCs.extrude(H - 4.75).translate(0, 0, 4.75);
  const inner = outerCs.offset(-wall, 'Round', 2, 16).extrude(H).translate(0, 0, 4.75 + floor);
  let bin = Manifold.difference(Manifold.union([...feet, body]), inner);
  if (lip) { const lipCs = outerCs; const lipRing = Manifold.difference(lipCs.extrude(4.4, 1, 0, 1).translate(0, 0, H), lipCs.offset(-wall, 'Round', 2, 16).extrude(4.4, 1, 0, (W - 0.5 - 2 * wall - 1.9) / (W - 0.5 - 2 * wall)).translate(0, 0, H)); bin = Manifold.union(bin, lipRing); }
  return bin;
}
export function gridfinityBaseplate(ux: number, uy: number): Manifold {
  const { Manifold, CrossSection } = M(); const W = ux * 42, D = uy * 42;
  const plate = CrossSection.square([W, D], true).extrude(4.65);
  const sockets: Manifold[] = [];
  const sq = (size: number, rad: number) => CrossSection.square([size - 2 * rad, size - 2 * rad], true).offset(rad, 'Round', 2, 16);
  for (let j = 0; j < uy; j++) for (let i = 0; i < ux; i++) {
    const cx = -W / 2 + 21 + i * 42, cy = -D / 2 + 21 + j * 42;
    const bottom = sq(42 - 2 * 2.95, 0.8).extrude(0.7, 1, 0, (42 - 2 * 2.15) / (42 - 2 * 2.95));
    const mid = sq(42 - 2 * 2.15, 1.6).extrude(1.8).translate(0, 0, 0.7);
    const top = sq(42 - 2 * 2.15, 1.6).extrude(2.15 + 0.5, 1, 0, (42 + 0.5) / (42 - 2 * 2.15)).translate(0, 0, 2.5);
    sockets.push(Manifold.union([bottom, mid, top]).translate(cx, cy, 0.01));
  }
  return Manifold.difference(plate, Manifold.union(sockets));
}

// ---------------- fit test coupon: pegs 0.1..0.5 mm tolerance against one hole size
export function fitCoupon(dia = 6): Manifold {
  const { Manifold } = M(); const tols = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
  const W = tols.length * (dia + 6) + 6; const plate = Manifold.cube([W, dia + 10, 4], true).translate(0, 0, 2);
  const holes: Manifold[] = [], pegs: Manifold[] = [];
  tols.forEach((t, i) => { const x = -W / 2 + 6 + (dia + 6) * i + dia / 2; holes.push(Manifold.cylinder(6, dia / 2 + t, dia / 2 + t, 48, false).translate(x, 0, -1)); pegs.push(Manifold.cylinder(8, dia / 2, dia / 2, 48, false).translate(x, dia + 14, 0)); });
  const pegBar = Manifold.cube([W, dia + 4, 2], true).translate(0, dia + 14, 1);
  return Manifold.union([Manifold.difference(plate, Manifold.union(holes)), pegBar, ...pegs]);
}

// ---------------- QR code plate
export function qrPlate(text: string, sizeMm: number, moduleHeight: number, plateThick: number, border: number, invert: boolean): Manifold {
  const { Manifold } = M();
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); const n = qr.getModuleCount();
  const cell = (sizeMm - 2 * border) / n; const total = sizeMm;
  const plate = Manifold.cube([total, total, plateThick], true).translate(0, 0, plateThick / 2);
  const cubes: Manifold[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const dark = qr.isDark(r, c); if (dark === invert) continue; cubes.push(Manifold.cube([cell + 0.02, cell + 0.02, moduleHeight + 0.01], true).translate(-total / 2 + border + (c + 0.5) * cell, total / 2 - border - (r + 0.5) * cell, plateThick + moduleHeight / 2 - 0.005)); }
  return Manifold.union([plate, ...cubes]);
}

// ---------------- perforated panel: a pattern rasterised and cut through a plate (or any part, along Z)
export function patternCrossSection(kind: PatternKind, params: PatternParams, w: number, h: number, pxPerMm = 2, threshold = 0.5, invert = false) {
  const { CrossSection } = M(); const rw = Math.max(8, Math.round(w * pxPerMm)), rh = Math.max(8, Math.round(h * pxPerMm)); const v = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) v[y * rw + x] = patternValue(kind, (x + 0.5) / pxPerMm, (y + 0.5) / pxPerMm, params);
  const r: Raster = { w: rw, h: rh, v }; const loops = maskToPolygons(r, threshold, invert).map((l) => simplifyLoop(l, 0.6));
  const polys = loops.map((l) => l.map(([x, y]) => [x / pxPerMm - w / 2, y / pxPerMm - h / 2] as [number, number]));
  return new CrossSection(polys, 'Positive');
}
/** Plate with the pattern's raised areas removed (holes where the pattern is high). */
export function perforatedPanel(kind: PatternKind, params: PatternParams, w: number, h: number, thick: number, invert = false, margin = 3): Manifold {
  const { Manifold, CrossSection } = M(); const plate = CrossSection.square([w, h], true).extrude(thick);
  const holes = patternCrossSection(kind, params, w - 2 * margin, h - 2 * margin, 2, 0.5, invert); if (holes.isEmpty()) return plate;
  return Manifold.difference(plate, holes.extrude(thick + 2).translate(0, 0, -1));
}
/** Cut the pattern through the selected part along Z (through everything). */
export function perforatePart(m: Manifold, kind: PatternKind, params: PatternParams, invert = false): Manifold {
  const { Manifold } = M(); const bb = m.boundingBox(); const w = bb.max[0] - bb.min[0], h = bb.max[1] - bb.min[1]; const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const holes = patternCrossSection(kind, params, w, h, 2, 0.5, invert); if (holes.isEmpty()) throw new Error('Pattern produced no holes at this size.');
  return Manifold.difference(m, holes.extrude(bb.max[2] - bb.min[2] + 2).translate(cx, cy, bb.min[2] - 1));
}
/** Add drain holes to the floor of a hollow part (for resin printing or planters). */
export function drainHoles(m: Manifold, dia: number, count: number): Manifold {
  const { Manifold } = M(); const bb = m.boundingBox(); const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2; const rx = (bb.max[0] - bb.min[0]) / 2 - dia, ry = (bb.max[1] - bb.min[1]) / 2 - dia;
  const holes: Manifold[] = []; for (let i = 0; i < count; i++) { const a = (Math.PI * 2 * i) / count; holes.push(Manifold.cylinder(6, dia / 2, dia / 2, 24, false).translate(cx + Math.cos(a) * rx * 0.5, cy + Math.sin(a) * ry * 0.5, bb.min[2] - 1)); }
  return Manifold.difference(m, Manifold.union(holes));
}
