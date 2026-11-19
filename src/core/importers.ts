// Import STL / 3MF / OBJ / SVG files into parts.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { project, DEFAULT_COLOR, type Part } from './project';

export interface ImportedGeometry { geometry: THREE.BufferGeometry; name: string; color?: string; faceColors?: Float32Array }

function collectMeshes(root: THREE.Object3D, name: string): ImportedGeometry[] {
  const out: ImportedGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      let g = mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      // 3MF loader is Y-up by default; it rotates the group so models come in Z-up. Keep as-is.
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const color = (mat as THREE.MeshStandardMaterial)?.color ? '#' + (mat as THREE.MeshStandardMaterial).color.getHexString() : undefined;
      let faceColors: Float32Array | undefined;
      const colAttr = g.getAttribute('color');
      if (colAttr) { const ng = g.index ? g.toNonIndexed() : g; faceColors = new Float32Array(ng.getAttribute('color').array as ArrayLike<number>); g = ng; }
      out.push({ geometry: g, name: mesh.name || name, color, faceColors });
    }
  });
  return out;
}

export async function importFile(file: File): Promise<Part[]> {
  const ext = file.name.split('.').pop()!.toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  const parts: Part[] = [];
  if (ext === 'stl') {
    const g = new STLLoader().parse(await file.arrayBuffer());
    parts.push(project.addGeometry(g, base));
  } else if (ext === '3mf') {
    const group = new ThreeMFLoader().parse(await file.arrayBuffer());
    const metas = collectMeshes(group, base);
    project.snapshot();
    metas.forEach((m, i) => {
      const roleTag = /\s\[(negative|modifier)\]$/.exec(m.name); const cleanName = roleTag ? m.name.replace(roleTag[0], '') : (m.name && m.name !== base && metas.length > 1 ? m.name : metas.length > 1 ? `${base} ${i + 1}` : base);
      const p = project.addGeometry(m.geometry, cleanName, m.color && m.color !== '#ffffff' ? m.color : DEFAULT_COLOR, false);
      if (roleTag) project.setRole(p, roleTag[1] as any, false);
      if (m.faceColors && m.faceColors.length === p.object.geometry.getAttribute('position').count * 3 && !p.manifold) project.setFaceColors(p, m.faceColors);
    });
    parts.push(...project.parts.slice(-metas.length));
    project.select(parts.map((p) => p.id));
  } else if (ext === 'obj') {
    const group = new OBJLoader().parse(await file.text());
    const metas = collectMeshes(group, base);
    project.snapshot();
    metas.forEach((m, i) => parts.push(project.addGeometry(m.geometry, metas.length > 1 ? `${base} ${i + 1}` : base, DEFAULT_COLOR, false)));
    project.select(parts.map((p) => p.id));
  } else if (ext === 'svg') {
    throw new Error('Use the Patterns & SVG panel to extrude SVG files.');
  } else {
    throw new Error(`Unsupported file type .${ext}`);
  }
  return parts;
}

/** Parse SVG text into three Shapes (y flipped so the drawing reads upright in Z-up). */
export function svgToShapes(svgText: string): { shapes: THREE.Shape[]; width: number; height: number } {
  const data = new SVGLoader().parse(svgText);
  const shapes: THREE.Shape[] = [];
  for (const p of data.paths) shapes.push(...SVGLoader.createShapes(p));
  const box = new THREE.Box2();
  for (const s of shapes) for (const pt of s.getPoints(8)) box.expandByPoint(pt);
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  return { shapes, width: w || 1, height: h || 1 };
}
