// Scene model: parts, selection, undo/redo. The viewer and panels subscribe to change events.
import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import { manifoldToGeometry, geometryToManifold } from './geom';

export type PartRole = 'part' | 'negative' | 'modifier';
export interface Part {
  id: string;
  name: string;
  role: PartRole;              // part = printed solid, negative = subtracted from overlapping parts on combine/export, modifier = settings region exported as its own object
  manifold: Manifold | null;      // null when the mesh is not watertight (mesh-only part)
  manifoldError?: string;
  object: THREE.Mesh;              // non-indexed geometry; local coords = manifold coords
  color: string;                   // base colour hex
  faceColors: Float32Array | null; // rgb per vertex (3 per face) when painted
  visible: boolean;
}

type Listener = () => void;
let nextId = 1;

interface Snapshot {
  parts: { id: string; name: string; role: PartRole; manifold: Manifold | null; manifoldError?: string; geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: string; faceColors: Float32Array | null; visible: boolean }[];
  selection: string[];
}

export const DEFAULT_COLOR = '#8fb3e8';

export class Project {
  parts: Part[] = [];
  selection: string[] = [];
  private listeners: Listener[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  material = 'PLA';

  onChange(fn: Listener) { this.listeners.push(fn); }
  emit() { for (const l of this.listeners) l(); }

  get selected(): Part[] { return this.selection.map((id) => this.byId(id)).filter(Boolean) as Part[]; }
  get primary(): Part | null { return this.selected[0] ?? null; }
  byId(id: string) { return this.parts.find((p) => p.id === id) ?? null; }

  makeMesh(geometry: THREE.BufferGeometry, color: string): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, flatShading: true, vertexColors: false });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  /** Add a part from a Manifold. Geometry is baked in manifold coords; the object matrix stays identity. */
  addManifold(m: Manifold, name: string, color = DEFAULT_COLOR, record = true): Part {
    if (record) this.snapshot();
    const geometry = manifoldToGeometry(m);
    const part: Part = { id: `p${nextId++}`, name: this.uniqueName(name), role: 'part', manifold: m, object: this.makeMesh(geometry, color), color, faceColors: null, visible: true };
    part.object.userData.partId = part.id;
    this.parts.push(part);
    this.selection = [part.id];
    this.emit();
    return part;
  }

  /** Add a part from a three geometry (import). Attempts a Manifold; falls back to mesh-only. */
  addGeometry(g: THREE.BufferGeometry, name: string, color = DEFAULT_COLOR, record = true): Part {
    if (record) this.snapshot();
    const res = geometryToManifold(g);
    let geometry: THREE.BufferGeometry;
    if (res.manifold) geometry = manifoldToGeometry(res.manifold);
    else { geometry = g.index ? g.toNonIndexed() : g; geometry.computeVertexNormals(); geometry.computeBoundingBox(); }
    const part: Part = { id: `p${nextId++}`, name: this.uniqueName(name), role: 'part', manifold: res.manifold, manifoldError: res.error, object: this.makeMesh(geometry, color), color, faceColors: null, visible: true };
    part.object.userData.partId = part.id;
    this.parts.push(part);
    this.selection = [part.id];
    this.emit();
    return part;
  }

  uniqueName(base: string) {
    let n = base, i = 2;
    while (this.parts.some((p) => p.name === n)) n = `${base} ${i++}`;
    return n;
  }

  /** Replace a part's solid (after CSG, warp, refine ...). Keeps id, name, colour; resets transform and paint. */
  replaceManifold(part: Part, m: Manifold, record = true) {
    if (record) this.snapshot();
    const old = part.manifold;
    part.manifold = m; part.manifoldError = undefined;
    part.object.geometry.dispose();
    part.object.geometry = manifoldToGeometry(m);
    part.object.position.set(0, 0, 0); part.object.rotation.set(0, 0, 0); part.object.scale.set(1, 1, 1); part.object.updateMatrixWorld();
    this.setFaceColors(part, null);
    if (old && old !== m && !this.inHistory(old)) old.delete();
    this.emit();
  }

  private inHistory(m: Manifold) {
    return this.undoStack.some((s) => s.parts.some((p) => p.manifold === m)) || this.redoStack.some((s) => s.parts.some((p) => p.manifold === m));
  }

  /** Bake the object's transform into the manifold so CSG sees world coordinates. */
  bakeTransform(part: Part): Manifold | null {
    if (!part.manifold) return null;
    part.object.updateMatrixWorld();
    const mat = part.object.matrixWorld;
    if (mat.equals(new THREE.Matrix4())) return part.manifold;
    const el = Array.from(mat.elements) as unknown as import('manifold-3d').Mat4;
    return part.manifold.transform(el);
  }

  /** World-space geometry copy (for export and analysis). */
  worldGeometry(part: Part): THREE.BufferGeometry {
    part.object.updateMatrixWorld();
    const g = part.object.geometry.clone();
    g.applyMatrix4(part.object.matrixWorld);
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }

  setFaceColors(part: Part, colors: Float32Array | null) {
    part.faceColors = colors;
    const g = part.object.geometry;
    const mat = part.object.material as THREE.MeshStandardMaterial;
    if (colors) g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); else g.deleteAttribute('color');
    if (part.role === 'part') { if (colors) { mat.vertexColors = true; mat.color.set('#ffffff'); } else { mat.vertexColors = false; mat.color.set(part.color); } }
    mat.needsUpdate = true;
  }

  setColor(part: Part, color: string) {
    part.color = color;
    if (!part.faceColors && part.role === 'part') (part.object.material as THREE.MeshStandardMaterial).color.set(color);
  }

  setRole(part: Part, role: PartRole, record = true) {
    if (part.role === role) return;
    if (record) this.snapshot();
    part.role = role; this.applyRole(part); this.emit();
  }
  /** Material look per role: negatives translucent red, modifiers translucent blue. */
  applyRole(part: Part) {
    const mat = part.object.material as THREE.MeshStandardMaterial;
    if (part.role === 'negative') { mat.transparent = true; mat.opacity = 0.45; mat.color.set('#e34948'); mat.vertexColors = false; mat.depthWrite = false; }
    else if (part.role === 'modifier') { mat.transparent = true; mat.opacity = 0.35; mat.color.set('#2a78d6'); mat.vertexColors = false; mat.depthWrite = false; }
    else { mat.transparent = false; mat.opacity = 1; mat.depthWrite = true; mat.vertexColors = !!part.faceColors; mat.color.set(part.faceColors ? '#ffffff' : part.color); }
    mat.needsUpdate = true;
  }

  remove(ids: string[], record = true) {
    if (record) this.snapshot();
    for (const id of ids) {
      const p = this.byId(id); if (!p) continue;
      this.parts.splice(this.parts.indexOf(p), 1);
      p.object.parent?.remove(p.object);
    }
    this.selection = this.selection.filter((s) => !ids.includes(s));
    this.emit();
  }

  select(ids: string[], additive = false) {
    this.selection = additive ? Array.from(new Set([...this.selection, ...ids])) : ids;
    this.emit();
  }

  duplicate(part: Part) {
    this.snapshot();
    const m = part.manifold ? part.manifold.translate(0, 0, 0) : null;
    const g = part.object.geometry.clone();
    const np: Part = { id: `p${nextId++}`, name: this.uniqueName(part.name), role: part.role, manifold: m, manifoldError: part.manifoldError, object: this.makeMesh(g, part.color), color: part.color, faceColors: part.faceColors ? new Float32Array(part.faceColors) : null, visible: true };
    this.applyRole(np);
    np.object.userData.partId = np.id;
    np.object.position.copy(part.object.position).add(new THREE.Vector3(10, 10, 0));
    np.object.rotation.copy(part.object.rotation);
    np.object.scale.copy(part.object.scale);
    this.parts.push(np);
    if (np.faceColors) this.setFaceColors(np, np.faceColors);
    this.selection = [np.id];
    this.emit();
    return np;
  }

  // ---- undo / redo ----
  snapshot() {
    this.undoStack.push(this.capture());
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
  }
  private capture(): Snapshot {
    return {
      parts: this.parts.map((p) => ({ id: p.id, name: p.name, role: p.role, manifold: p.manifold, manifoldError: p.manifoldError, geometry: p.object.geometry, matrix: p.object.matrix.clone(), color: p.color, faceColors: p.faceColors, visible: p.visible })),
      selection: [...this.selection],
    };
  }
  private restore(s: Snapshot) {
    const keep = new Map(this.parts.map((p) => [p.id, p]));
    for (const p of this.parts) p.object.parent?.remove(p.object);
    this.parts = s.parts.map((sp) => {
      const existing = keep.get(sp.id);
      const part: Part = existing ?? { id: sp.id, name: sp.name, role: sp.role, manifold: sp.manifold, object: this.makeMesh(sp.geometry, sp.color), color: sp.color, faceColors: null, visible: sp.visible };
      part.name = sp.name; part.role = sp.role; part.manifold = sp.manifold; part.manifoldError = sp.manifoldError; part.color = sp.color; part.visible = sp.visible;
      part.object.geometry = sp.geometry;
      part.object.userData.partId = part.id;
      sp.matrix.decompose(part.object.position, part.object.quaternion, part.object.scale);
      this.setFaceColors(part, sp.faceColors); this.applyRole(part);
      return part;
    });
    this.selection = s.selection.filter((id) => this.byId(id));
    this.emit();
  }
  undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push(this.capture()); this.restore(s); return true; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push(this.capture()); this.restore(s); return true; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}

export const project = new Project();
