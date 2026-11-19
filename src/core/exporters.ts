// STL (binary) and 3MF writers. 3MF carries per-triangle paint via the materials extension colour groups.
import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import type { Part } from './project';
import { manifoldToGeometry } from './geom';
import { M } from './manifold';
import { SIGNATURE, DISTRIBUTION, KEY } from '../brand/brand';

function worldPositions(part: ExportPart | Part): Float32Array {
  part.object.updateMatrixWorld();
  const pos = part.object.geometry.getAttribute('position').array as Float32Array;
  const out = new Float32Array(pos.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(part.object.matrixWorld);
    out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
  }
  return out;
}

export interface ExportPart { name: string; object: THREE.Mesh; faceColors: Float32Array | null; color: string; role: 'part' | 'modifier' }
export interface ResolveInfo { negativesApplied: number; skipped: string[] }
/** Apply negative parts to the positives they overlap and drop them; modifiers pass through as their own objects. Returns world-baked pseudo parts. */
export function resolveForExport(parts: Part[], bake: (p: Part) => import('manifold-3d').Manifold | null, info?: ResolveInfo): ExportPart[] {
  const { Manifold } = M();
  const negatives = parts.filter((p) => p.role === 'negative' && p.manifold).map((p) => ({ p, m: bake(p)!, box: p.object.geometry.boundingBox!.clone().applyMatrix4(p.object.matrixWorld) }));
  const out: ExportPart[] = [];
  for (const p of parts) {
    if (p.role === 'negative') continue;
    let object = p.object; let faceColors = p.faceColors;
    if (p.role === 'part' && negatives.length) {
      p.object.updateMatrixWorld(); const box = p.object.geometry.boundingBox!.clone().applyMatrix4(p.object.matrixWorld);
      const hits = negatives.filter((n) => n.box.intersectsBox(box));
      if (hits.length) {
        if (!p.manifold) { info?.skipped.push(p.name); }
        else {
          const r = Manifold.difference([bake(p)!, ...hits.map((n) => n.m)]);
          if (r.status() === 'NoError') { object = new THREE.Mesh(manifoldToGeometry(r)); faceColors = null; if (info) info.negativesApplied += hits.length; }
        }
      }
    }
    out.push({ name: p.role === 'modifier' ? `${p.name} [modifier]` : p.name, object, faceColors, color: p.color, role: p.role as 'part' | 'modifier' });
  }
  return out;
}

export function exportSTL(parts: ExportPart[]): Blob {
  let nTri = 0;
  const buffers = parts.filter((p) => p.role === 'part').map((p) => { const w = worldPositions(p); nTri += w.length / 9; return w; });
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  const header = `ResonanceForge ${DISTRIBUTION}:${KEY} ${SIGNATURE}`; // 80-byte header carries the signature prefix
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  dv.setUint32(80, nTri, true);
  let off = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const w of buffers) {
    for (let t = 0; t < w.length; t += 9) {
      a.set(w[t], w[t + 1], w[t + 2]); b.set(w[t + 3], w[t + 4], w[t + 5]); c.set(w[t + 6], w[t + 7], w[t + 8]);
      n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      dv.setFloat32(off, n.x, true); dv.setFloat32(off + 4, n.y, true); dv.setFloat32(off + 8, n.z, true); off += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(off, w[t + k], true); off += 4; }
      dv.setUint16(off, 0, true); off += 2;
    }
  }
  return new Blob([buf], { type: 'model/stl' });
}

function hex(r: number, g: number, b: number) {
  const h = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

export interface ThreeMFOptions { splitByColor?: boolean; title?: string }
/** Project save: every part as its own object, role tagged in the name so a re-import restores it. Nothing is subtracted. */
export function exportProject3MF(parts: Part[], title: string): Blob {
  const eps: ExportPart[] = parts.map((p) => ({ name: p.role === 'part' ? p.name : `${p.name} [${p.role}]`, object: p.object, faceColors: p.faceColors, color: p.color, role: 'part' }));
  return export3MF(eps, { title });
}

/** 3MF with one object per part (or per colour when splitByColor). Colours use m:colorgroup per triangle so slicers that read the materials extension keep the paint. */
export function export3MF(parts: ExportPart[], opts: ThreeMFOptions = {}): Blob {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
  let resId = 1;
  const resources: string[] = [];
  const items: string[] = [];
  const f = (x: number) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(5).replace(/\.?0+$/, ''));

  const writeObject = (name: string, pos: Float32Array, triColor: string[] | null, baseColor: string, pidOverride?: { pid: number; pindex: number }) => {
    // weld for compact vertex table
    const map = new Map<string, number>(); const verts: number[] = []; const tris: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${f(pos[i])},${f(pos[i + 1])},${f(pos[i + 2])}`;
      let id = map.get(key);
      if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(pos[i], pos[i + 1], pos[i + 2]); }
      tris.push(id);
    }
    let colorGroupXml = '';
    let pidAttr = '';
    let triPid: (i: number) => string = () => '';
    if (triColor && !pidOverride) {
      const palette: string[] = []; const idx = new Map<string, number>();
      const triIdx = triColor.map((c) => { let k = idx.get(c); if (k === undefined) { k = palette.length; idx.set(c, k); palette.push(c); } return k; });
      const cgId = resId++;
      colorGroupXml = `<m:colorgroup id="${cgId}">${palette.map((c) => `<m:color color="${c}"/>`).join('')}</m:colorgroup>`;
      pidAttr = ` pid="${cgId}" pindex="0"`;
      triPid = (i) => ` pid="${cgId}" p1="${triIdx[i]}" p2="${triIdx[i]}" p3="${triIdx[i]}"`;
    } else {
      const bmId = pidOverride ? pidOverride.pid : resId++;
      if (!pidOverride) colorGroupXml = `<basematerials id="${bmId}"><base name="${esc(name)}" displaycolor="${baseColor}FF"/></basematerials>`;
      pidAttr = ` pid="${bmId}" pindex="${pidOverride ? pidOverride.pindex : 0}"`;
    }
    const objId = resId++;
    let xml = colorGroupXml + `<object id="${objId}" name="${esc(name)}" type="model"${pidAttr}><mesh><vertices>`;
    for (let i = 0; i < verts.length; i += 3) xml += `<vertex x="${f(verts[i])}" y="${f(verts[i + 1])}" z="${f(verts[i + 2])}"/>`;
    xml += '</vertices><triangles>';
    for (let t = 0; t < tris.length; t += 3) xml += `<triangle v1="${tris[t]}" v2="${tris[t + 1]}" v3="${tris[t + 2]}"${triPid(t / 3)}/>`;
    xml += '</triangles></mesh></object>';
    resources.push(xml);
    items.push(`<item objectid="${objId}"/>`);
  };

  for (const part of parts) {
    const pos = worldPositions(part);
    const nTri = pos.length / 9;
    const base = part.color.toUpperCase();
    if (part.faceColors) {
      const fc = part.faceColors;
      const triColor: string[] = new Array(nTri);
      for (let t = 0; t < nTri; t++) triColor[t] = hex(fc[t * 9], fc[t * 9 + 1], fc[t * 9 + 2]);
      if (opts.splitByColor) {
        const groups = new Map<string, number[]>();
        triColor.forEach((c, t) => { (groups.get(c) ?? groups.set(c, []).get(c)!).push(t); });
        let k = 1;
        for (const [c, ts] of groups) {
          const sub = new Float32Array(ts.length * 9);
          ts.forEach((t, i) => sub.set(pos.subarray(t * 9, t * 9 + 9), i * 9));
          writeObject(`${part.name} colour ${k++} ${c}`, sub, null, c);
        }
      } else writeObject(part.name, pos, triColor, base);
    } else writeObject(part.name, pos, null, base);
  }

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
<metadata name="Title">${esc(opts.title ?? 'ResonanceForge model')}</metadata>
<metadata name="Application">ResonanceForge</metadata>
<metadata name="Signature">${SIGNATURE}</metadata>
<metadata name="Distribution">${DISTRIBUTION}:${KEY}</metadata>
<metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>
<resources>${resources.join('')}</resources>
<build>${items.join('')}</build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const zip = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  }, { level: 6 });
  return new Blob([zip as BlobPart], { type: 'model/3mf' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
