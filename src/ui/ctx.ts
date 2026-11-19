// Shared app context so panels can reach the viewer and run guarded Manifold operations.
import * as THREE from 'three';
import type { Viewer } from '../viewer/scene';
import type { Manifold } from 'manifold-3d';
import { project, type Part } from '../core/project';
import { toast, busy } from './dom';
import type { Heuristic } from '../tools/stress';

export type Panel = HTMLElement & { refresh?: () => void; activate?: () => void; deactivate?: () => void };

export const ctx = {
  viewer: null as unknown as Viewer,
  setTab: (_id: string) => {},
  bedSize: [256, 256, 256] as [number, number, number],
  nozzle: 0.4,
  printerId: 'bambu-x1-p1-a1',
  lastHeuristic: null as { partId: string; result: Heuristic; stamp: number } | null,
  pendingTexture: null as null | { kind: string; params: import('../tools/patterns').PatternParams; depth: number },
};

export function requireManifoldPart(what = 'This tool'): Part | null {
  const p = project.primary;
  if (!p) { toast('Select a part first.', 'warn'); return null; }
  if (!p.manifold) { toast(`${what} needs a watertight part. "${p.name}" is mesh-only (${p.manifoldError ?? 'not manifold'}). Try Repair in the Parts panel.`, 'bad', 6000); return null; }
  return p;
}

/** Run a Manifold-producing operation with a busy overlay and error toast. */
export async function runOp(label: string, fn: () => Manifold | Promise<Manifold>, apply: (m: Manifold) => void) {
  try {
    const m = await busy(label, fn);
    if (m.status() !== 'NoError') { toast(`${label} failed: ${m.status()}`, 'bad'); return; }
    if (m.isEmpty()) { toast(`${label} produced an empty solid.`, 'warn'); return; }
    apply(m);
  } catch (e: any) { console.error(e); toast(`${label} failed: ${e?.message ?? e}`, 'bad', 6000); }
}

export function worldBox(part: Part) {
  part.object.updateMatrixWorld();
  const g = part.object.geometry; if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox!.clone().applyMatrix4(part.object.matrixWorld);
}
export function dropToBed(part: Part) { const box = worldBox(part); part.object.position.z -= box.min.z; part.object.updateMatrixWorld(); }
export function centerOnBed(part: Part) { const c = worldBox(part).getCenter(new THREE.Vector3()); part.object.position.x -= c.x; part.object.position.y -= c.y; part.object.updateMatrixWorld(); }

/** Place a new manifold as a part, dropped on the bed and offset from existing parts so it does not land inside one. */
export function addPlaced(m: Manifold, name: string, color?: string) {
  const part = project.addManifold(m, name, color);
  dropToBed(part);
  const others = project.parts.filter((p) => p !== part && p.visible);
  if (others.length) {
    let maxX = -Infinity; for (const o of others) maxX = Math.max(maxX, worldBox(o).max.x);
    const b = worldBox(part); part.object.position.x += maxX + 8 - b.min.x; part.object.updateMatrixWorld();
  }
  project.emit();
  return part;
}

export type AddMode = 'new' | 'fuse' | 'subtract' | 'negative' | 'modifier';
export const ADD_MODES: [AddMode, string][] = [['new', 'New part'], ['fuse', 'Fuse into selected part'], ['subtract', 'Cut from selected part now'], ['negative', 'Negative part on selected (editable, cut on export)'], ['modifier', 'Modifier region on selected']];
/** Add a solid according to the chosen mode. Attached modes land centred on the selected part so they overlap it. */
export async function addWithMode(m: Manifold, name: string, color: string | undefined, mode: AddMode) {
  const target = project.primary;
  if (mode === 'new' || !target) { if (mode !== 'new' && !target) toast('No part selected; added as a new part.', 'info'); return addPlaced(m, name, color); }
  if (mode === 'fuse' || mode === 'subtract') {
    if (!target.manifold) { toast(`"${target.name}" is mesh-only; repair it before fusing or cutting.`, 'bad'); return null; }
    const { Manifold } = M();
    const c = worldBox(target).getCenter(new THREE.Vector3()); const bb = m.boundingBox(); const placed = m.translate(c.x - (bb.min[0] + bb.max[0]) / 2, c.y - (bb.min[1] + bb.max[1]) / 2, worldBox(target).max.z - bb.min[2] - (bb.max[2] - bb.min[2]) / 2);
    const r = mode === 'fuse' ? Manifold.union(project.bakeTransform(target)!, placed) : Manifold.difference(project.bakeTransform(target)!, placed);
    if (r.status() !== 'NoError' || r.isEmpty()) { toast('Operation failed or emptied the part.', 'bad'); return null; }
    project.replaceManifold(target, r); return target;
  }
  const part = project.addManifold(m, name, color);
  const c = worldBox(target).getCenter(new THREE.Vector3()); const b = worldBox(part); const bc = b.getCenter(new THREE.Vector3());
  part.object.position.add(new THREE.Vector3(c.x - bc.x, c.y - bc.y, worldBox(target).max.z - b.max.z + (b.max.z - b.min.z) / 2)); part.object.updateMatrixWorld();
  project.setRole(part, mode === 'negative' ? 'negative' : 'modifier', false);
  project.select([part.id]); project.emit();
  toast(mode === 'negative' ? 'Negative part added. Move it with the gizmo; it is subtracted on export or with Parts > Combine.' : 'Modifier added. It exports as its own object so the slicer can give that region different settings.', 'info', 5000);
  return part;
}
import { M } from '../core/manifold';
