// Structural and printability analysis.
//  1. Heuristic map (fast): wall thickness by ray casting, overhang faces, cross-section load per layer.
//  2. Voxel finite-element analysis (beta): linear elastic hex elements, gravity or press load, bottom fixed, von Mises stress.
// Both are estimates for deciding where to add support, walls or material; they are not certified engineering analysis.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Manifold } from 'manifold-3d';

export interface HeuristicOpts { overhangAngle: number; nozzle: number; layers: number }
export interface Hotspot { kind: 'thin' | 'neck' | 'overhang' | 'stress' | 'stability'; pos: [number, number, number]; value: number; title: string; advice: string; severity: 'critical' | 'serious' | 'warning' | 'info' }
export interface LayerStats { z: number[]; area: number[]; sigma: number[]; massAbove: number[] }
export interface Heuristic {
  score: Float32Array; thin: Float32Array; sigma: Float32Array; overhang: Float32Array; // per vertex 0..1
  faceThickness: Float32Array; overhangFace: Uint8Array;
  minThickness: number; overhangArea: number; supportFootprint: number; surfaceArea: number; volume: number;
  bbox: THREE.Box3; cog: THREE.Vector3; footprintArea: number; stability: number;
  layers: LayerStats; hotspots: Hotspot[];
}

export function colormap(t: number): [number, number, number] {
  // blue -> cyan -> green -> yellow -> red
  const stops: [number, number, number][] = [[0.16, 0.47, 0.84], [0.1, 0.75, 0.85], [0.1, 0.69, 0.48], [0.98, 0.7, 0.1], [0.82, 0.23, 0.23]];
  const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1); const i = Math.floor(x), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const RAMP_CSS = ['#2a78d6', '#1abfd9', '#1baf7a', '#fab219', '#d03b3b'];

function faceData(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position').array as Float32Array; const n = pos.length / 9;
  const centroid = new Float32Array(n * 3), normal = new Float32Array(n * 3), area = new Float32Array(n);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    a.fromArray(pos, t * 9); b.fromArray(pos, t * 9 + 3); c.fromArray(pos, t * 9 + 6);
    u.subVectors(b, a); v.subVectors(c, a); u.cross(v); const L = u.length(); area[t] = L / 2;
    if (L > 0) u.divideScalar(L); normal[t * 3] = u.x; normal[t * 3 + 1] = u.y; normal[t * 3 + 2] = u.z;
    centroid[t * 3] = (a.x + b.x + c.x) / 3; centroid[t * 3 + 1] = (a.y + b.y + c.y) / 3; centroid[t * 3 + 2] = (a.z + b.z + c.z) / 3;
  }
  return { n, centroid, normal, area, pos };
}

/** Occupancy grid by column ray casting (parity). Shared by layer statistics and the FEA. */
export interface Voxels { nx: number; ny: number; nz: number; h: number; origin: THREE.Vector3; occ: Uint8Array; count: number }
export function voxelize(g: THREE.BufferGeometry, bvh: MeshBVH, res: number): Voxels {
  g.computeBoundingBox(); const bb = g.boundingBox!; const size = bb.getSize(new THREE.Vector3());
  const h = Math.max(size.x, size.y, size.z) / res;
  const nx = Math.max(1, Math.ceil(size.x / h)), ny = Math.max(1, Math.ceil(size.y / h)), nz = Math.max(1, Math.ceil(size.z / h));
  const origin = new THREE.Vector3(bb.min.x + (size.x - nx * h) / 2, bb.min.y + (size.y - ny * h) / 2, bb.min.z);
  const occ = new Uint8Array(nx * ny * nz); let count = 0;
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    ray.origin.set(origin.x + (i + 0.5) * h, origin.y + (j + 0.5) * h, bb.max.z + 1);
    const hits = bvh.raycast(ray, THREE.DoubleSide).map((x) => x.point.z).sort((p, q) => q - p); // descending z
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const zTop = hits[k], zBot = hits[k + 1];
      const k0 = Math.max(0, Math.ceil((zBot - origin.z) / h - 0.5)), k1 = Math.min(nz - 1, Math.floor((zTop - origin.z) / h - 0.5));
      for (let kk = k0; kk <= k1; kk++) { const idx = (kk * ny + j) * nx + i; if (!occ[idx]) { occ[idx] = 1; count++; } }
    }
  }
  return { nx, ny, nz, h, origin, occ, count };
}

export function analyzeHeuristic(g: THREE.BufferGeometry, manifold: Manifold | null, o: HeuristicOpts, onProgress?: (s: string) => void): Heuristic {
  const bvh = new MeshBVH(g);
  const fd = faceData(g);
  g.computeBoundingBox(); const bbox = g.boundingBox!.clone(); const size = bbox.getSize(new THREE.Vector3());
  const zmin = bbox.min.z;
  // --- thickness by inward rays from face centroids
  onProgress?.('Measuring wall thickness');
  const faceThickness = new Float32Array(fd.n); const ray = new THREE.Ray(); const maxT = Math.max(size.x, size.y, size.z) * 2;
  for (let t = 0; t < fd.n; t++) {
    ray.origin.set(fd.centroid[t * 3] - fd.normal[t * 3] * 0.02, fd.centroid[t * 3 + 1] - fd.normal[t * 3 + 1] * 0.02, fd.centroid[t * 3 + 2] - fd.normal[t * 3 + 2] * 0.02);
    ray.direction.set(-fd.normal[t * 3], -fd.normal[t * 3 + 1], -fd.normal[t * 3 + 2]);
    // first hit whose face points along the ray is where the ray leaves the solid; earlier hits are concave folds, not walls
    const hits = bvh.raycast(ray, THREE.DoubleSide).sort((p, q) => p.distance - q.distance);
    let th = maxT;
    for (const hh of hits) { if (hh.distance < 0.05) continue; const fn = hh.face?.normal; if (!fn || fn.dot(ray.direction) > 0) { th = hh.distance + 0.02; break; } }
    faceThickness[t] = Math.min(maxT, th);
  }
  // --- overhangs
  onProgress?.('Finding overhangs');
  const cosLimit = -Math.cos((o.overhangAngle * Math.PI) / 180);
  const overhangFace = new Uint8Array(fd.n); let overhangArea = 0, supportFootprint = 0, surfaceArea = 0;
  for (let t = 0; t < fd.n; t++) {
    surfaceArea += fd.area[t];
    const nz = fd.normal[t * 3 + 2];
    if (nz < cosLimit && fd.centroid[t * 3 + 2] > zmin + 0.3) { overhangFace[t] = 1; overhangArea += fd.area[t]; supportFootprint += fd.area[t] * -nz; }
  }
  // --- volume, centre of gravity (divergence theorem)
  let volume = 0; const cog = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < fd.n; t++) {
    a.fromArray(fd.pos, t * 9); b.fromArray(fd.pos, t * 9 + 3); c.fromArray(fd.pos, t * 9 + 6);
    const v = a.dot(new THREE.Vector3().crossVectors(b, c)) / 6; volume += v;
    cog.add(new THREE.Vector3().addVectors(a, b).add(c).multiplyScalar(v / 4));
  }
  if (Math.abs(volume) > 1e-9) cog.divideScalar(volume); volume = Math.abs(volume);
  // --- layer statistics
  onProgress?.('Slicing layers');
  const L = Math.max(10, o.layers); const z: number[] = [], area: number[] = [];
  let vox: Voxels | null = null;
  if (!manifold) vox = voxelize(g, bvh, 48);
  for (let i = 0; i < L; i++) {
    const zz = zmin + ((i + 0.5) / L) * size.z; z.push(zz);
    if (manifold) { const cs = manifold.slice(zz); area.push(cs.area()); cs.delete(); }
    else { const k = Math.min(vox!.nz - 1, Math.floor((zz - vox!.origin.z) / vox!.h)); let cnt = 0; for (let q = 0; q < vox!.nx * vox!.ny; q++) cnt += vox!.occ[k * vox!.nx * vox!.ny + q]; area.push(cnt * vox!.h * vox!.h); }
  }
  const dz = size.z / L; const massAbove: number[] = new Array(L).fill(0);
  for (let i = L - 2; i >= 0; i--) massAbove[i] = massAbove[i + 1] + area[i + 1] * dz;
  const sigmaRaw = area.map((A, i) => (A > 1e-6 ? massAbove[i] / A : 0));
  const sigMax = Math.max(1e-9, ...sigmaRaw);
  const sigma = sigmaRaw.map((s) => s / sigMax);
  const footprintArea = area[0] || 1e-6;
  const stability = (cog.z - zmin) / Math.sqrt(footprintArea);
  // --- per-vertex scores
  const nV = fd.n * 3; const thin = new Float32Array(nV), sig = new Float32Array(nV), over = new Float32Array(nV), score = new Float32Array(nV);
  const thinLo = o.nozzle * 2, thinHi = Math.max(thinLo + 0.5, o.nozzle * 7);
  for (let t = 0; t < fd.n; t++) {
    const th = faceThickness[t]; const ts = th <= thinLo ? 1 : th >= thinHi ? 0 : 1 - (th - thinLo) / (thinHi - thinLo);
    const zc = fd.centroid[t * 3 + 2]; const li = Math.min(L - 1, Math.max(0, Math.floor(((zc - zmin) / size.z) * L)));
    const ss = sigma[li]; const os = overhangFace[t] ? Math.min(1, (fd.normal[t * 3 + 2] - cosLimit) / (cosLimit + 1) * -1 * 0.6 + 0.5) : 0;
    for (let k = 0; k < 3; k++) { const vi = t * 3 + k; thin[vi] = ts; sig[vi] = ss; over[vi] = os; score[vi] = Math.max(ts, ss * 0.85, os); }
  }
  // --- hotspots
  const hotspots: Hotspot[] = [];
  const spacing = Math.max(size.x, size.y, size.z) * 0.12;
  const far = (p: [number, number, number]) => hotspots.every((h) => Math.hypot(h.pos[0] - p[0], h.pos[1] - p[1], h.pos[2] - p[2]) > spacing);
  const thinIdx = Array.from({ length: fd.n }, (_, i) => i).filter((i) => faceThickness[i] < thinHi && fd.area[i] > 1e-4).sort((p, q) => faceThickness[p] - faceThickness[q]);
  for (const t of thinIdx) { if (hotspots.filter((h) => h.kind === 'thin').length >= 3) break; const p: [number, number, number] = [fd.centroid[t * 3], fd.centroid[t * 3 + 1], fd.centroid[t * 3 + 2]]; if (!far(p)) continue; const th = faceThickness[t]; hotspots.push({ kind: 'thin', pos: p, value: th, title: `Thin wall ${th.toFixed(2)} mm`, severity: th < o.nozzle * 2 ? 'serious' : 'warning', advice: th < o.nozzle * 2 ? `Thinner than two extrusion widths (${(o.nozzle * 2).toFixed(1)} mm). Thicken to at least ${(o.nozzle * 3).toFixed(1)} mm or enable thin-wall / arachne mode in the slicer.` : 'Thin region. Use 3 or more walls here or scale the part up.' }); }
  for (let i = 1; i < L - 1; i++) {
    if (area[i] < area[i - 1] * 0.9 && area[i] <= area[i + 1] && massAbove[i] > volume * 0.15 && sigma[i] > 0.6) {
      const p: [number, number, number] = [cog.x, cog.y, z[i]]; if (!far(p)) continue;
      hotspots.push({ kind: 'neck', pos: p, value: sigma[i], title: `Load neck at z = ${z[i].toFixed(1)} mm`, severity: sigma[i] > 0.85 ? 'serious' : 'warning', advice: `Cross-section shrinks to ${area[i].toFixed(0)} mm2 while carrying ${(massAbove[i] / volume * 100).toFixed(0)} % of the volume. Layer lines run across this neck. Add a fillet, more walls or orient the part so the neck is not horizontal.` });
    }
  }
  const ovIdx = Array.from({ length: fd.n }, (_, i) => i).filter((i) => overhangFace[i]).sort((p, q) => fd.area[q] * -fd.normal[q * 3 + 2] - fd.area[p] * -fd.normal[p * 3 + 2]);
  for (const t of ovIdx) { if (hotspots.filter((h) => h.kind === 'overhang').length >= 3) break; const p: [number, number, number] = [fd.centroid[t * 3], fd.centroid[t * 3 + 1], fd.centroid[t * 3 + 2]]; if (!far(p)) continue; const ang = (Math.acos(Math.max(-1, Math.min(1, -fd.normal[t * 3 + 2]))) * 180) / Math.PI; hotspots.push({ kind: 'overhang', pos: p, value: ang, title: `Overhang ${(90 - ang).toFixed(0)} deg from vertical`, severity: ang < 20 ? 'serious' : 'warning', advice: ang < 20 ? 'Near-horizontal downward face. Needs support, or reorient so it touches the bed.' : 'Steeper than the overhang limit. Supports, a 45 deg chamfer, or more cooling.' }); }
  if (stability > 1.4) hotspots.push({ kind: 'stability', pos: [cog.x, cog.y, cog.z], value: stability, title: 'Tall part on a small footprint', severity: stability > 2.5 ? 'serious' : 'warning', advice: `Centre of gravity sits ${(cog.z - zmin).toFixed(0)} mm up over a ${Math.sqrt(footprintArea).toFixed(0)} mm footprint. Add a brim, lower speeds above half height, or lay the part down.` });
  // area-weighted 1st percentile: robust to single sliver triangles on textured or scanned surfaces
  const order = Array.from({ length: fd.n }, (_, i) => i).filter((i) => faceThickness[i] < maxT).sort((p, q) => faceThickness[p] - faceThickness[q]);
  const totalA = order.reduce((s2, i) => s2 + fd.area[i], 0); let acc = 0, minThickness = order.length ? faceThickness[order[0]] : 0;
  for (const i of order) { acc += fd.area[i]; if (acc >= totalA * 0.01) { minThickness = faceThickness[i]; break; } }
  return { score, thin, sigma: sig, overhang: over, faceThickness, overhangFace, minThickness: isFinite(minThickness) ? minThickness : 0, overhangArea, supportFootprint, surfaceArea, volume, bbox, cog, footprintArea, stability, layers: { z, area, sigma, massAbove }, hotspots };
}

// ---------------------------------------------------------------- Voxel FEA ----------------------------------------------------------------
export interface FeaOpts { res: number; load: 'gravity' | 'top' | 'side'; maxIter: number; tol: number; nu: number }
export interface FeaResult {
  vox: Voxels; elemStress: Float32Array; elemIdx: Int32Array; vertexStress: Float32Array; // normalised 0..1 per vertex
  maxStress: number; maxAt: [number, number, number]; maxDisp: number; maxDispAt: [number, number, number]; iterations: number; residual: number;
  layerMax: number[]; layerMean: number[]; layerZ: number[]; nElem: number; nDof: number; p95: number;
}

const NODE_OFF: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
function dMatrix(E: number, nu: number) {
  const c = E / ((1 + nu) * (1 - 2 * nu)); const D = new Float64Array(36);
  const l = c * nu, m = c * (1 - nu), g = c * (1 - 2 * nu) / 2;
  D[0] = m; D[1] = l; D[2] = l; D[6] = l; D[7] = m; D[8] = l; D[12] = l; D[13] = l; D[14] = m; D[21] = g; D[28] = g; D[35] = g; return D;
}
/** Strain-displacement matrix (6 x 24) at natural coords for a unit cube [0,1]^3 (scaled by 1/h later). */
function bMatrix(xi: number, eta: number, zeta: number) {
  const B = new Float64Array(6 * 24);
  for (let i = 0; i < 8; i++) {
    const [ox, oy, oz] = NODE_OFF[i]; const sx = ox ? 1 : -1, sy = oy ? 1 : -1, sz = oz ? 1 : -1;
    const dx = (sx * (1 + sy * eta) * (1 + sz * zeta)) / 8 * 2, dy = (sy * (1 + sx * xi) * (1 + sz * zeta)) / 8 * 2, dz = (sz * (1 + sx * xi) * (1 + sy * eta)) / 8 * 2;
    const c = i * 3;
    B[0 * 24 + c] = dx; B[1 * 24 + c + 1] = dy; B[2 * 24 + c + 2] = dz;
    B[3 * 24 + c] = dy; B[3 * 24 + c + 1] = dx; // gamma_xy
    B[4 * 24 + c + 1] = dz; B[4 * 24 + c + 2] = dy; // gamma_yz
    B[5 * 24 + c] = dz; B[5 * 24 + c + 2] = dx; // gamma_xz
  }
  return B;
}
function hexKe(nu: number) {
  const D = dMatrix(1, nu); const Ke = new Float64Array(576); const gp = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  for (const xi of gp) for (const eta of gp) for (const zeta of gp) {
    const B = bMatrix(xi, eta, zeta); const DB = new Float64Array(6 * 24);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 24; c++) { let s = 0; for (let k = 0; k < 6; k++) s += D[r * 6 + k] * B[k * 24 + c]; DB[r * 24 + c] = s; }
    for (let r = 0; r < 24; r++) for (let c = 0; c < 24; c++) { let s = 0; for (let k = 0; k < 6; k++) s += B[k * 24 + r] * DB[k * 24 + c]; Ke[r * 24 + c] += s / 8; }
  }
  return Ke; // for unit cube with E = 1; real K = Ke * h (E scales out of the normalised result)
}

export async function analyzeFEA(g: THREE.BufferGeometry, o: FeaOpts, onProgress?: (s: string, frac: number) => void): Promise<FeaResult> {
  const bvh = new MeshBVH(g);
  onProgress?.('Voxelising', 0.02);
  const vox = voxelize(g, bvh, o.res);
  const { nx, ny, nz, h, occ } = vox;
  if (vox.count === 0) throw new Error('Voxelisation found no interior. Is the mesh closed?');
  const NX = nx + 1, NY = ny + 1;
  const nodeId = new Int32Array(NX * NY * (nz + 1)).fill(-1);
  const elems: number[] = []; let nNodes = 0;
  const nid = (i: number, j: number, k: number) => (k * NY + j) * NX + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!occ[(k * ny + j) * nx + i]) continue; elems.push(i, j, k);
    for (const [ox, oy, oz] of NODE_OFF) { const n = nid(i + ox, j + oy, k + oz); if (nodeId[n] < 0) nodeId[n] = nNodes++; }
  }
  const nElem = elems.length / 3, nDof = nNodes * 3;
  const elemNodes = new Int32Array(nElem * 8);
  for (let e = 0; e < nElem; e++) { const i = elems[e * 3], j = elems[e * 3 + 1], k = elems[e * 3 + 2]; for (let n = 0; n < 8; n++) { const [ox, oy, oz] = NODE_OFF[n]; elemNodes[e * 8 + n] = nodeId[nid(i + ox, j + oy, k + oz)]; } }
  // fixed: bottom layer nodes (k = kmin where occupied)
  let kmin = nz; for (let e = 0; e < nElem; e++) kmin = Math.min(kmin, elems[e * 3 + 2]);
  const fixed = new Uint8Array(nDof);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const n = nodeId[nid(i, j, kmin)]; if (n >= 0) { fixed[n * 3] = fixed[n * 3 + 1] = fixed[n * 3 + 2] = 1; } }
  // loads
  const f = new Float64Array(nDof);
  const has = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && occ[(k * ny + j) * nx + i];
  for (let e = 0; e < nElem; e++) {
    const i = elems[e * 3], j = elems[e * 3 + 1], k = elems[e * 3 + 2];
    if (o.load === 'gravity') for (let n = 0; n < 8; n++) f[elemNodes[e * 8 + n] * 3 + 2] -= 1 / 8;
    else if (o.load === 'top' && !has(i, j, k + 1)) for (let n = 4; n < 8; n++) f[elemNodes[e * 8 + n] * 3 + 2] -= 1 / 4;
    else if (o.load === 'side' && !has(i - 1, j, k)) for (const n of [0, 3, 4, 7]) f[elemNodes[e * 8 + n] * 3] += 1 / 4;
  }
  const Ke = hexKe(o.nu);
  for (let d = 0; d < nDof; d++) if (fixed[d]) f[d] = 0;
  // Jacobi preconditioner
  const diag = new Float64Array(nDof);
  for (let e = 0; e < nElem; e++) for (let a = 0; a < 8; a++) for (let c = 0; c < 3; c++) diag[elemNodes[e * 8 + a] * 3 + c] += Ke[(a * 3 + c) * 24 + a * 3 + c];
  const matvec = (u: Float64Array, out: Float64Array) => {
    out.fill(0); const ue = new Float64Array(24);
    for (let e = 0; e < nElem; e++) {
      const base = e * 8;
      for (let a = 0; a < 8; a++) { const n = elemNodes[base + a] * 3; ue[a * 3] = u[n]; ue[a * 3 + 1] = u[n + 1]; ue[a * 3 + 2] = u[n + 2]; }
      for (let r = 0; r < 24; r++) { let s = 0; const ro = r * 24; for (let c = 0; c < 24; c++) s += Ke[ro + c] * ue[c]; out[elemNodes[base + (r / 3) | 0] * 3 + (r % 3)] += s; }
    }
    for (let d = 0; d < nDof; d++) if (fixed[d]) out[d] = 0;
  };
  // PCG
  const u = new Float64Array(nDof), r = Float64Array.from(f), z = new Float64Array(nDof), p = new Float64Array(nDof), Ap = new Float64Array(nDof);
  for (let d = 0; d < nDof; d++) z[d] = fixed[d] ? 0 : r[d] / (diag[d] || 1);
  p.set(z);
  let rz = 0; for (let d = 0; d < nDof; d++) rz += r[d] * z[d];
  const r0 = Math.sqrt(rz) || 1; let it = 0, res = 1;
  for (it = 0; it < o.maxIter; it++) {
    matvec(p, Ap); let pAp = 0; for (let d = 0; d < nDof; d++) pAp += p[d] * Ap[d];
    if (pAp <= 0) break;
    const alpha = rz / pAp;
    for (let d = 0; d < nDof; d++) { u[d] += alpha * p[d]; r[d] -= alpha * Ap[d]; }
    let rzNew = 0; for (let d = 0; d < nDof; d++) { z[d] = fixed[d] ? 0 : r[d] / (diag[d] || 1); rzNew += r[d] * z[d]; }
    res = Math.sqrt(Math.abs(rzNew)) / r0;
    if (res < o.tol) { it++; break; }
    const beta = rzNew / rz; rz = rzNew;
    for (let d = 0; d < nDof; d++) p[d] = z[d] + beta * p[d];
    if (it % 10 === 0) { onProgress?.(`Solving (${it} iterations, residual ${res.toExponential(1)})`, 0.1 + 0.8 * Math.min(1, it / o.maxIter)); await new Promise((rs) => setTimeout(rs, 0)); }
  }
  // stress recovery at element centres
  onProgress?.('Recovering stresses', 0.92);
  const B0 = bMatrix(0, 0, 0); const D = dMatrix(1, o.nu);
  const elemStress = new Float32Array(nElem); const ue = new Float64Array(24); const eps = new Float64Array(6), sg = new Float64Array(6);
  let maxStress = 0, maxE = 0;
  for (let e = 0; e < nElem; e++) {
    for (let a = 0; a < 8; a++) { const n = elemNodes[e * 8 + a] * 3; ue[a * 3] = u[n]; ue[a * 3 + 1] = u[n + 1]; ue[a * 3 + 2] = u[n + 2]; }
    for (let r2 = 0; r2 < 6; r2++) { let s = 0; for (let c = 0; c < 24; c++) s += B0[r2 * 24 + c] * ue[c]; eps[r2] = s / h; }
    for (let r2 = 0; r2 < 6; r2++) { let s = 0; for (let c = 0; c < 6; c++) s += D[r2 * 6 + c] * eps[c]; sg[r2] = s; }
    const vm = Math.sqrt(0.5 * ((sg[0] - sg[1]) ** 2 + (sg[1] - sg[2]) ** 2 + (sg[2] - sg[0]) ** 2) + 3 * (sg[3] ** 2 + sg[4] ** 2 + sg[5] ** 2));
    elemStress[e] = vm; if (vm > maxStress) { maxStress = vm; maxE = e; }
  }
  const sorted = Float32Array.from(elemStress).sort(); const p95 = sorted[Math.floor(sorted.length * 0.95)] || maxStress || 1;
  // displacement max
  let maxDisp = 0, maxN = 0; for (let n = 0; n < nNodes; n++) { const d = Math.hypot(u[n * 3], u[n * 3 + 1], u[n * 3 + 2]); if (d > maxDisp) { maxDisp = d; maxN = n; } }
  const nodePos = new Float32Array(nNodes * 3);
  for (let k = 0; k <= nz; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const n = nodeId[nid(i, j, k)]; if (n >= 0) { nodePos[n * 3] = vox.origin.x + i * h; nodePos[n * 3 + 1] = vox.origin.y + j * h; nodePos[n * 3 + 2] = vox.origin.z + k * h; } }
  // element lookup grid
  const elemIdx = new Int32Array(nx * ny * nz).fill(-1);
  for (let e = 0; e < nElem; e++) elemIdx[(elems[e * 3 + 2] * ny + elems[e * 3 + 1]) * nx + elems[e * 3]] = e;
  // vertex stress: nearest occupied voxel
  const pos = g.getAttribute('position').array as Float32Array; const nV = pos.length / 3; const vertexStress = new Float32Array(nV);
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  for (let v = 0; v < nV; v++) {
    const i0 = clamp(Math.floor((pos[v * 3] - vox.origin.x) / h), nx - 1), j0 = clamp(Math.floor((pos[v * 3 + 1] - vox.origin.y) / h), ny - 1), k0 = clamp(Math.floor((pos[v * 3 + 2] - vox.origin.z) / h), nz - 1);
    let best = -1;
    for (let rad = 0; rad <= 3 && best < 0; rad++) for (let dk = -rad; dk <= rad && best < 0; dk++) for (let dj = -rad; dj <= rad && best < 0; dj++) for (let di = -rad; di <= rad; di++) {
      const i = i0 + di, j = j0 + dj, k = k0 + dk; if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
      const e = elemIdx[(k * ny + j) * nx + i]; if (e >= 0) { best = e; break; }
    }
    vertexStress[v] = best >= 0 ? Math.min(1, elemStress[best] / p95) : 0;
  }
  const layerMax: number[] = new Array(nz).fill(0), layerMean: number[] = new Array(nz).fill(0), layerCnt: number[] = new Array(nz).fill(0), layerZ: number[] = [];
  for (let e = 0; e < nElem; e++) { const k = elems[e * 3 + 2]; layerMax[k] = Math.max(layerMax[k], elemStress[e]); layerMean[k] += elemStress[e]; layerCnt[k]++; }
  for (let k = 0; k < nz; k++) { layerZ.push(vox.origin.z + (k + 0.5) * h); layerMean[k] = layerCnt[k] ? layerMean[k] / layerCnt[k] : 0; }
  const eC = (e: number): [number, number, number] => [vox.origin.x + (elems[e * 3] + 0.5) * h, vox.origin.y + (elems[e * 3 + 1] + 0.5) * h, vox.origin.z + (elems[e * 3 + 2] + 0.5) * h];
  onProgress?.('Done', 1);
  return { vox, elemStress, elemIdx, vertexStress, maxStress, maxAt: eC(maxE), maxDisp, maxDispAt: [nodePos[maxN * 3], nodePos[maxN * 3 + 1], nodePos[maxN * 3 + 2]], iterations: it, residual: res, layerMax, layerMean, layerZ, nElem, nDof, p95 };
}
