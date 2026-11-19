// Conversions between three.js BufferGeometry and Manifold meshes, plus mesh hygiene helpers.
import * as THREE from 'three';
import type { Manifold, Mesh as MMesh } from 'manifold-3d';
import { M } from './manifold';

export type Vec3 = [number, number, number];

/** Manifold -> non-indexed three geometry (flat shaded, one colour slot per face). */
export function manifoldToGeometry(m: Manifold): THREE.BufferGeometry {
  const mesh = m.getMesh();
  return meshToGeometry(mesh);
}

export function meshToGeometry(mesh: MMesh): THREE.BufferGeometry {
  const np = mesh.numProp;
  const nTri = mesh.numTri;
  const pos = new Float32Array(nTri * 9);
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = tv[t * 3 + k];
      pos[t * 9 + k * 3] = vp[v * np];
      pos[t * 9 + k * 3 + 1] = vp[v * np + 1];
      pos[t * 9 + k * 3 + 2] = vp[v * np + 2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Weld vertices by quantised position and drop degenerate triangles. Returns indexed arrays. */
export function weld(positions: ArrayLike<number>, index: ArrayLike<number> | null, eps = 1e-4) {
  const map = new Map<string, number>();
  const outPos: number[] = [];
  const remap = new Int32Array(positions.length / 3);
  const q = 1 / eps;
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = outPos.length / 3;
      map.set(key, id);
      outPos.push(x, y, z);
    }
    remap[i] = id;
  }
  const n = index ? index.length : positions.length / 3;
  const tris: number[] = [];
  for (let t = 0; t < n; t += 3) {
    const a = remap[index ? index[t] : t];
    const b = remap[index ? index[t + 1] : t + 1];
    const c = remap[index ? index[t + 2] : t + 2];
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
  }
  return { positions: new Float32Array(outPos), triVerts: new Uint32Array(tris) };
}

export interface ToManifoldResult {
  manifold: Manifold | null;
  error?: string;
}

/** three geometry (any indexing, local coords, optional matrix) -> Manifold. Tries welding first, then Manifold's own merge. */
export function geometryToManifold(g: THREE.BufferGeometry, matrix?: THREE.Matrix4): ToManifoldResult {
  const { Manifold, Mesh } = M();
  const posAttr = g.getAttribute('position') as THREE.BufferAttribute;
  let positions: Float32Array = new Float32Array(posAttr.array as ArrayLike<number>);
  if (matrix) {
    const v = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrix);
      positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z;
    }
  }
  const idx = g.getIndex();
  const attempts = [1e-5, 1e-4, 1e-3, 1e-2];
  let lastErr = '';
  for (const eps of attempts) {
    const w = weld(positions, idx ? (idx.array as ArrayLike<number>) : null, eps);
    if (w.triVerts.length < 12) { lastErr = 'Too few triangles'; continue; }
    let mesh = new Mesh({ numProp: 3, vertProperties: w.positions, triVerts: w.triVerts });
    try { mesh.merge(); } catch { /* ignore */ }
    const man = Manifold.ofMesh(mesh);
    const status = man.status();
    if (status === 'NoError' && !man.isEmpty()) {
      // Inverted meshes have negative volume; fix orientation by flipping.
      if (man.volume() < 0) {
        const flipped = new Uint32Array(w.triVerts.length);
        for (let t = 0; t < w.triVerts.length; t += 3) {
          flipped[t] = w.triVerts[t]; flipped[t + 1] = w.triVerts[t + 2]; flipped[t + 2] = w.triVerts[t + 1];
        }
        const m2 = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: w.positions, triVerts: flipped }));
        if (m2.status() === 'NoError') { man.delete(); return { manifold: m2 }; }
        m2.delete();
      }
      return { manifold: man };
    }
    lastErr = status;
    man.delete();
  }
  return { manifold: null, error: lastErr || 'NotManifold' };
}

/** Three Matrix4 -> Manifold Mat4 (both column-major). */
export function toMat4(m: THREE.Matrix4) {
  return Array.from(m.elements) as unknown as import('manifold-3d').Mat4;
}

/** Polygon helpers: three Shape[] -> Manifold polygons (outer + holes as separate contours). */
export function shapesToPolygons(shapes: THREE.Shape[], curveSegments = 12): [number, number][][] {
  const polys: [number, number][][] = [];
  for (const s of shapes) {
    const pts = s.extractPoints(curveSegments);
    const ring = (arr: THREE.Vector2[]) => {
      const out: [number, number][] = arr.map((p) => [p.x, p.y]);
      if (out.length > 1) {
        const a = out[0], b = out[out.length - 1];
        if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop();
      }
      return out;
    };
    const outer = ring(pts.shape);
    if (outer.length >= 3) polys.push(outer);
    for (const h of pts.holes) { const r = ring(h); if (r.length >= 3) polys.push(r); }
  }
  return polys;
}

export function bboxOf(m: Manifold) {
  const b = m.boundingBox();
  return { min: b.min as Vec3, max: b.max as Vec3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as Vec3 };
}

export function fmtMm(v: number, d = 2) { return `${v.toFixed(d)} mm`; }
