// Paint panel: per-face colours for multi-material 3MF export.
import { h, btn, section, desc, rowBtns, icon, range, color, toast, sel } from '../dom';
import { ctx, type Panel } from '../ctx';
import { project, type Part } from '../../core/project';
import type { Hit } from '../../viewer/scene';
import * as THREE from 'three';

const PALETTE = ['#f3f3f0', '#0b0b0b', '#d03b3b', '#eb6834', '#fab219', '#1baf7a', '#2a78d6', '#6250d6', '#e87ba4', '#8d6e63', '#9e9e9e', '#00bcd4'];

export function paintPanel(): Panel {
  let current = '#d03b3b'; let tool: 'brush' | 'face' | 'fill' | 'shell' = 'brush';
  const radius = range('Brush radius', 4, { min: 0.5, max: 30, step: 0.5, unit: ' mm' });
  const pal = h('div', { class: 'palette' });
  const pick = color('Custom', current, (v) => { current = v; refreshPal(); });
  const toolSel = sel('Tool', [['brush', 'Brush (radius)'], ['face', 'Single triangle'], ['fill', 'Flood fill (connected, same colour)'], ['shell', 'Whole part']], 'brush', (v) => { tool = v as any; });
  const stats = h('div', { class: 'kv' });
  function refreshPal() { pal.innerHTML = ''; for (const c of [...PALETTE, ...(PALETTE.includes(current) ? [] : [current])]) pal.append(h('button', { style: { background: c }, 'aria-pressed': c === current ? 'true' : 'false', title: c, onClick: () => { current = c; pick.value = c; refreshPal(); } })); }
  function ensureColors(p: Part) { if (!p.faceColors) { const n = p.object.geometry.getAttribute('position').count; const fc = new Float32Array(n * 3); const c = new THREE.Color(p.color); for (let i = 0; i < n; i++) { fc[i * 3] = c.r; fc[i * 3 + 1] = c.g; fc[i * 3 + 2] = c.b; } project.setFaceColors(p, fc); } return p.faceColors!; }
  function setFace(fc: Float32Array, f: number, c: THREE.Color) { for (let k = 0; k < 3; k++) { fc[(f * 3 + k) * 3] = c.r; fc[(f * 3 + k) * 3 + 1] = c.g; fc[(f * 3 + k) * 3 + 2] = c.b; } }
  function paint(hit: Hit, start: boolean) {
    const p = hit.part; if (start) project.snapshot();
    const fc = ensureColors(p); const c = new THREE.Color(current); const g = p.object.geometry; const pos = g.getAttribute('position').array as Float32Array; const nF = pos.length / 9;
    if (tool === 'face') setFace(fc, hit.faceIndex, c);
    else if (tool === 'shell') { for (let f = 0; f < nF; f++) setFace(fc, f, c); }
    else if (tool === 'brush') {
      const local = p.object.worldToLocal(hit.point.clone()); const r2 = (radius.value / p.object.scale.x) ** 2; const cx = local.x, cy = local.y, cz = local.z;
      for (let f = 0; f < nF; f++) { const x = (pos[f * 9] + pos[f * 9 + 3] + pos[f * 9 + 6]) / 3, y = (pos[f * 9 + 1] + pos[f * 9 + 4] + pos[f * 9 + 7]) / 3, z = (pos[f * 9 + 2] + pos[f * 9 + 5] + pos[f * 9 + 8]) / 3; if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r2) setFace(fc, f, c); }
    } else if (tool === 'fill' && start) {
      // flood fill across shared edges with the same starting colour
      const key = (i: number) => `${Math.round(pos[i * 3] * 1e3)},${Math.round(pos[i * 3 + 1] * 1e3)},${Math.round(pos[i * 3 + 2] * 1e3)}`;
      const vertFaces = new Map<string, number[]>(); for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) { const kk = key(f * 3 + k); (vertFaces.get(kk) ?? vertFaces.set(kk, []).get(kk)!).push(f); }
      const f0 = hit.faceIndex; const c0 = [fc[f0 * 9], fc[f0 * 9 + 1], fc[f0 * 9 + 2]]; const same = (f: number) => Math.abs(fc[f * 9] - c0[0]) < 1e-3 && Math.abs(fc[f * 9 + 1] - c0[1]) < 1e-3 && Math.abs(fc[f * 9 + 2] - c0[2]) < 1e-3;
      const seen = new Uint8Array(nF); const stack = [f0]; seen[f0] = 1;
      while (stack.length) { const f = stack.pop()!; setFace(fc, f, c); for (let k = 0; k < 3; k++) for (const nb of vertFaces.get(key(f * 3 + k)) ?? []) if (!seen[nb] && same(nb)) { seen[nb] = 1; stack.push(nb); } }
    }
    g.getAttribute('color').needsUpdate = true; if (!start) return; el.refresh?.();
  }
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-flame'), 'Paint colours'),
    desc('Paint faces to plan a multi-colour or multi-material print. Export as 3MF: colours are stored per triangle and, with the split option, as one object per colour so any slicer can assign extruders or filaments.'),
    section('Colour', pal, pick),
    section('Tool', toolSel, radius, rowBtns(btn('Clear paint on selected', () => { const p = project.primary; if (p) { project.snapshot(); project.setFaceColors(p, null); project.emit(); } }, { cls: 'danger' }), btn('Make current colour the base', () => { const p = project.primary; if (p) { project.snapshot(); project.setColor(p, current); project.setFaceColors(p, null); project.emit(); } }))),
    section('Colours on selected part', stats),
    h('p', { class: 'note' }, 'Orbit still works with the right mouse button while painting. Switch to another tab to return to selection mode.'),
  ) as Panel;
  el.activate = () => { ctx.viewer.onPaint = paint; ctx.viewer.setMode('paint'); if (!project.primary) toast('Select a part, then drag over it to paint.', 'info'); };
  el.deactivate = () => { ctx.viewer.onPaint = null; ctx.viewer.setMode('select'); };
  el.refresh = () => {
    stats.innerHTML = ''; const p = project.primary; if (!p) { stats.append(h('dt', null, 'No part selected'), h('dd', null, '')); return; }
    if (!p.faceColors) { stats.append(h('dt', null, 'Base colour only'), h('dd', null, p.color)); return; }
    const counts = new Map<string, number>(); const fc = p.faceColors; const nF = fc.length / 9; const c = new THREE.Color();
    for (let f = 0; f < nF; f++) { c.setRGB(fc[f * 9], fc[f * 9 + 1], fc[f * 9 + 2]); const k = '#' + c.getHexString(); counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) stats.append(h('dt', null, h('span', { class: 'sw', style: { background: k, display: 'inline-block', marginRight: '6px' } }), k), h('dd', null, `${v.toLocaleString()} faces (${((v / nF) * 100).toFixed(1)} %)`));
  };
  refreshPal();
  return el;
}
