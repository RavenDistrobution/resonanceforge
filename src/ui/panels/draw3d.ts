// Free draw panel: sweep a 3D brush (round tube, square tube, ribbon) through space or over surfaces, on a camera-facing or world plane.
import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import { h, btn, num, sel, section, desc, rowBtns, icon, toast, range, check } from '../dom';
import { ctx, runOp, worldBox, type Panel } from '../ctx';
import { project, type Part } from '../../core/project';
import { M } from '../../core/manifold';
import type { Hit, DrawPhase } from '../../viewer/scene';
import { manifoldToGeometry } from '../../core/geom';

type Tool = 'stroke' | 'line' | 'circle' | 'rect' | 'edit';
type Profile = 'round' | 'square' | 'ribbon';
type PlaneMode = 'surface' | 'view' | 'xy' | 'xz' | 'yz';
interface Basis { u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3 }
interface Stroke { tool: Tool; pts: THREE.Vector3[]; profile: Profile; size: number; thick: number; filled: boolean; basis: Basis; startPart: Part | null }

export function draw3dPanel(): Panel {
  let strokes: Stroke[] = []; let cur: THREE.Vector3[] = []; let curBasis: Basis | null = null; let curPart: Part | null = null; let dragging = false;
  let anchor = new THREE.Vector3(0, 0, 0); let anchorPart: Part | null = null;
  let acc: Manifold | null = null; // live union of the stroke being drawn
  let lastSeg = 0; let hoverPt: THREE.Vector3 | null = null;

  const planeMode = sel('Draw on', [['surface', 'Surface, then the air at that depth (camera plane)'], ['view', 'Camera-facing plane through the anchor'], ['xy', 'World XY plane (horizontal) through the anchor'], ['xz', 'World XZ plane (vertical, front) through the anchor'], ['yz', 'World YZ plane (vertical, side) through the anchor']], 'surface');
  const tool = sel('Tool', [['stroke', 'Freehand stroke (drag)'], ['line', 'Straight segment (drag)'], ['circle', 'Circle / ring (drag from centre)'], ['rect', 'Rectangle frame (drag)'], ['edit', 'Edit points (drag handles)']], 'stroke', () => refreshDone());
  const profile = sel('Brush profile', [['round', 'Round tube'], ['square', 'Square tube'], ['ribbon', 'Flat ribbon (in the plane)']], 'round');
  const size = num('Brush size', 3, { min: 0.3, step: 0.5, unit: 'mm' });
  const thick = num('Ribbon thickness', 1.2, { min: 0.2, step: 0.2, unit: 'mm' });
  const filled = check('Fill circle / rectangle (disc or plate)', false);
  const smooth = range('Smooth stroke', 1, { min: 0, max: 4, step: 1, unit: ' x' });
  const snap = range('Snap grid', 0, { min: 0, max: 5, step: 0.5, unit: ' mm' });
  const live = check('Live 3D preview', true);
  const symmetry = sel('Symmetry', [['none', 'None'], ['x', 'Mirror across X = 0'], ['y', 'Mirror across Y = 0']], 'none');
  const result = sel('Result', [['fuse', 'Fuse into the part it touches / selected part'], ['new', 'New part'], ['negative', 'Negative part'], ['modifier', 'Modifier region']], 'fuse');
  const info = h('p', { class: 'note' }, 'Anchor at the origin. Start a stroke on a part to anchor there.');
  const list = h('ul', { class: 'parts-list' }); let selStroke = -1; const ptTable = h('div');
  const handles = new THREE.Group(); let handlesAdded = false; let dragHandle: { s: number; p: number } | null = null;
  const handleGeo = new THREE.SphereGeometry(1, 12, 10); const handleMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, depthTest: false }); const handleSel = new THREE.MeshBasicMaterial({ color: 0xeb6834, depthTest: false });
  // per-stroke transform controls (deltas applied on change)
  const mvX = num('Move X', 0, { step: 1, unit: 'mm', onChange: (v) => xform((st) => st.pts.forEach((p) => { p.x += v; }), mvX) }), mvY = num('Move Y', 0, { step: 1, unit: 'mm', onChange: (v) => xform((st) => st.pts.forEach((p) => { p.y += v; }), mvY) }), mvZ = num('Move Z', 0, { step: 1, unit: 'mm', onChange: (v) => xform((st) => st.pts.forEach((p) => { p.z += v; }), mvZ) });
  const rotX = num('Rotate X', 0, { step: 5, unit: 'deg', onChange: (v) => rotate(new THREE.Vector3(1, 0, 0), v, rotX) }), rotY = num('Rotate Y', 0, { step: 5, unit: 'deg', onChange: (v) => rotate(new THREE.Vector3(0, 1, 0), v, rotY) }), rotZ = num('Rotate Z', 0, { step: 5, unit: 'deg', onChange: (v) => rotate(new THREE.Vector3(0, 0, 1), v, rotZ) });
  const scl = num('Scale', 100, { step: 5, unit: '%', onChange: (v) => { if (v > 0) xform((st) => { const c = centroid(st); st.pts.forEach((p) => p.sub(c).multiplyScalar(v / 100).add(c)); }, scl, 100); } });
  function centroid(st: Stroke) { const c = new THREE.Vector3(); st.pts.forEach((p) => c.add(p)); return c.divideScalar(st.pts.length || 1); }
  function xform(fn: (st: Stroke) => void, field: { value: number }, reset = 0) { const st = strokes[selStroke]; if (!st) { toast('Select a stroke in the list first.', 'warn'); field.value = reset; return; } fn(st); field.value = reset; refreshDone(); }
  function rotate(axis: THREE.Vector3, deg: number, field: { value: number }) { xform((st) => { const c = centroid(st); const q = new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180); st.pts.forEach((p) => p.sub(c).applyQuaternion(q).add(c)); st.basis = { u: st.basis.u.clone().applyQuaternion(q), v: st.basis.v.clone().applyQuaternion(q), n: st.basis.n.clone().applyQuaternion(q) }; }, field); }
  /** Re-plane a stroke: set its basis to a world or camera plane and flatten the points onto that plane through the centroid. */
  function alignTo(mode: PlaneMode) { xform((st) => { const b = basisFor(mode); const c = centroid(st); st.pts.forEach((p) => { const d = p.clone().sub(c); p.copy(c).addScaledVector(b.u, d.dot(b.u)).addScaledVector(b.v, d.dot(b.v)); }); st.basis = b; }, { value: 0 }); }
  function flip() { xform((st) => { const c = centroid(st); st.pts.forEach((p) => { const d = p.clone().sub(c); p.copy(c).addScaledVector(st.basis.n, -2 * d.dot(st.basis.n)).add(d); }); }, { value: 0 }); }
  function renderPointTable() {
    ptTable.innerHTML = ''; const st = strokes[selStroke]; if (!st) return;
    const labels = st.tool === 'circle' ? ['centre', 'radius point'] : st.tool === 'rect' ? ['corner A', 'corner B'] : [];
    const body = h('tbody');
    st.pts.forEach((pt, i) => { const ins = (['x', 'y', 'z'] as const).map((k) => { const inp = h('input', { type: 'number', step: 0.5, value: String(+pt[k].toFixed(2)), style: { width: '64px' } }); inp.addEventListener('change', () => { pt[k] = parseFloat(inp.value) || 0; refreshDone(); }); return inp; });
      body.append(h('tr', null, h('td', null, labels[i] ?? String(i + 1)), ...ins.map((x) => h('td', null, x)), h('td', null, st.pts.length > 2 && st.tool === 'stroke' ? h('button', { class: 'sm', onClick: () => { st.pts.splice(i, 1); refreshDone(); } }, 'x') : ''))); });
    ptTable.append(h('div', { class: 'tbl', style: { maxHeight: '200px' } }, h('table', null, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'x'), h('th', null, 'y'), h('th', null, 'z'), h('th', null, ''))), body)));
  }

  const previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x1baf7a, transparent: true, opacity: 0.7, roughness: 0.5, flatShading: true, depthWrite: false }));
  previewMesh.renderOrder = 15; let previewShown = false;
  const doneGroup = new THREE.Group(); let doneAdded = false; // committed strokes shown as solid preview meshes until Build
  const anchorMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0x2a78d6, depthTest: false })); anchorMarker.renderOrder = 30; let markerAdded = false;
  const cursorMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xeb6834, transparent: true, opacity: 0.6, depthTest: false })); cursorMesh.renderOrder = 30; let cursorAdded = false;

  // ---------------- planes
  function basisFor(mode: PlaneMode): Basis {
    const cam = ctx.viewer.camera; let n: THREE.Vector3;
    if (mode === 'xy') n = new THREE.Vector3(0, 0, 1); else if (mode === 'xz') n = new THREE.Vector3(0, 1, 0); else if (mode === 'yz') n = new THREE.Vector3(1, 0, 0);
    else { n = cam.getWorldDirection(new THREE.Vector3()).negate(); }
    const ref = Math.abs(n.z) < 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(ref, n).normalize(); const v = new THREE.Vector3().crossVectors(n, u).normalize();
    return { u, v, n };
  }
  function snapV(p: THREE.Vector3) { const s = snap.value; if (s > 0) { p.x = Math.round(p.x / s) * s; p.y = Math.round(p.y / s) * s; p.z = Math.round(p.z / s) * s; } return p; }
  /** Map the pointer ray to a 3D point: on a part surface when allowed and hit, otherwise on the active plane through the anchor. */
  function pointFor(ray: THREE.Ray, hit: Hit | null, basis: Basis): THREE.Vector3 | null {
    const mode = planeMode.value as PlaneMode;
    if (mode === 'surface' && hit) { anchor.copy(hit.point); anchorPart = hit.part; return snapV(hit.point.clone()); }
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(basis.n, anchor); const p = new THREE.Vector3();
    if (!ray.intersectPlane(pl, p)) return null; return snapV(p);
  }
  function setAnchor(p: THREE.Vector3, part: Part | null) { anchor.copy(p); anchorPart = part; anchorMarker.position.copy(p); anchorMarker.scale.setScalar(Math.max(0.5, size.value * 0.4)); if (!markerAdded) { ctx.viewer.scene.add(anchorMarker); markerAdded = true; } info.textContent = `Anchor at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})${part ? ` on ${part.name}` : ''}. Air strokes stay at this depth on the chosen plane.`; }

  // ---------------- brush geometry
  function capsule(a: THREE.Vector3, b: THREE.Vector3, prof: Profile, r: number, t: number, basis: Basis): Manifold {
    const { Manifold } = M();
    if (prof === 'round') return Manifold.hull([Manifold.sphere(r, 16).translate(a.x, a.y, a.z), Manifold.sphere(r, 16).translate(b.x, b.y, b.z)]);
    if (prof === 'square') return Manifold.hull([Manifold.cube([2 * r, 2 * r, 2 * r], true).translate(a.x, a.y, a.z), Manifold.cube([2 * r, 2 * r, 2 * r], true).translate(b.x, b.y, b.z)]);
    const m = (p: THREE.Vector3) => Array.from(new THREE.Matrix4().makeBasis(basis.u, basis.v, basis.n).setPosition(p).elements) as any;
    const box = Manifold.cube([2 * r, 2 * r, t], true);
    return Manifold.hull([box.transform(m(a)), box.transform(m(b))]);
  }
  function chaikin(pts: THREE.Vector3[], iters: number, closed: boolean) {
    let q = pts; for (let k = 0; k < iters; k++) { const out: THREE.Vector3[] = []; const n = q.length; for (let i = 0; i < (closed ? n : n - 1); i++) { const a = q[i], b = q[(i + 1) % n]; out.push(a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75)); } if (!closed) { out.unshift(q[0].clone()); out.push(q[n - 1].clone()); } q = out; } return q;
  }
  function rdp(pts: THREE.Vector3[], tol: number): THREE.Vector3[] {
    if (pts.length < 3) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const rec = (i0: number, i1: number) => { let md = 0, idx = -1; const a = pts[i0], b = pts[i1]; const ab = b.clone().sub(a); const L = ab.length() || 1e-9; for (let i = i0 + 1; i < i1; i++) { const d = new THREE.Vector3().crossVectors(ab, pts[i].clone().sub(a)).length() / L; if (d > md) { md = d; idx = i; } } if (md > tol && idx > 0) { keep[idx] = 1; rec(i0, idx); rec(idx, i1); } };
    rec(0, pts.length - 1); return pts.filter((_, i) => keep[i]);
  }
  function strokePath(st: Stroke): { pts: THREE.Vector3[]; closed: boolean } {
    if (st.tool === 'circle') { const c = st.pts[0], e = st.pts[st.pts.length - 1]; const r = e.clone().sub(c).length(); const pts: THREE.Vector3[] = []; for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(c.clone().addScaledVector(st.basis.u, r * Math.cos(a)).addScaledVector(st.basis.v, r * Math.sin(a))); } return { pts, closed: true }; }
    if (st.tool === 'rect') { const a = st.pts[0], e = st.pts[st.pts.length - 1]; const d = e.clone().sub(a); const du = d.dot(st.basis.u), dv = d.dot(st.basis.v); return { pts: [a.clone(), a.clone().addScaledVector(st.basis.u, du), a.clone().addScaledVector(st.basis.u, du).addScaledVector(st.basis.v, dv), a.clone().addScaledVector(st.basis.v, dv)], closed: true }; }
    if (st.tool === 'line') return { pts: [st.pts[0], st.pts[st.pts.length - 1]], closed: false };
    let pts = rdp(st.pts, 0.3); if (smooth.value > 0 && pts.length > 2) pts = chaikin(pts, smooth.value, false); return { pts, closed: false };
  }
  function strokeSolid(st: Stroke): Manifold {
    const { Manifold, CrossSection } = M(); const r = st.size / 2;
    if (st.filled && (st.tool === 'circle' || st.tool === 'rect')) {
      const t = st.profile === 'ribbon' ? st.thick : st.size; const m = new THREE.Matrix4().makeBasis(st.basis.u, st.basis.v, st.basis.n);
      let cs: InstanceType<typeof CrossSection>; let origin: THREE.Vector3;
      if (st.tool === 'circle') { const c = st.pts[0]; const rad = st.pts[st.pts.length - 1].clone().sub(c).length(); cs = CrossSection.circle(Math.max(rad, 0.2), 48); origin = c; }
      else { const a = st.pts[0], d = st.pts[st.pts.length - 1].clone().sub(a); const du = d.dot(st.basis.u), dv = d.dot(st.basis.v); cs = CrossSection.square([Math.abs(du), Math.abs(dv)], true); origin = a.clone().addScaledVector(st.basis.u, du / 2).addScaledVector(st.basis.v, dv / 2); }
      return cs.extrude(t).translate(0, 0, -t / 2).transform(Array.from(m.setPosition(origin).elements) as any);
    }
    const { pts, closed } = strokePath(st); const segs: Manifold[] = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) segs.push(capsule(pts[i], pts[(i + 1) % pts.length], st.profile, r, st.thick, st.basis));
    if (!segs.length) segs.push(capsule(pts[0], pts[0].clone().addScaledVector(st.basis.u, 0.01), st.profile, r, st.thick, st.basis));
    return segs.length === 1 ? segs[0] : Manifold.union(segs);
  }

  // ---------------- preview
  function showPreview(m: Manifold | null) {
    if (!m || !live.value) { if (previewShown) { ctx.viewer.scene.remove(previewMesh); previewShown = false; } return; }
    const geo = manifoldToGeometry(m); previewMesh.geometry.dispose(); previewMesh.geometry = geo;
    (previewMesh.material as THREE.MeshStandardMaterial).color.set(result.value === 'negative' ? 0xe34948 : result.value === 'modifier' ? 0x2a78d6 : 0x1baf7a);
    if (!previewShown) { ctx.viewer.scene.add(previewMesh); previewShown = true; }
  }
  function refreshDone() {
    doneGroup.clear(); if (!doneAdded) { ctx.viewer.scene.add(doneGroup); doneAdded = true; }
    for (const st of strokes) { try { const m = strokeSolid(st); const mesh = new THREE.Mesh(manifoldToGeometry(m), new THREE.MeshStandardMaterial({ color: result.value === 'negative' ? 0xe34948 : result.value === 'modifier' ? 0x2a78d6 : 0x1baf7a, transparent: true, opacity: 0.85, roughness: 0.5, flatShading: true })); doneGroup.add(mesh); m.delete(); } catch { /* skip */ } }
    handles.clear(); if (!handlesAdded) { ctx.viewer.scene.add(handles); handlesAdded = true; }
    if (tool.value === 'edit') { const r = Math.max(0.5, size.value * 0.45); strokes.forEach((st, si) => st.pts.forEach((p, pi) => { const m = new THREE.Mesh(handleGeo, si === selStroke ? handleSel : handleMat); m.scale.setScalar(r); m.position.copy(p); m.renderOrder = 30; m.userData = { s: si, p: pi }; handles.add(m); })); }
    list.innerHTML = '';
    strokes.forEach((st, i) => list.append(h('li', { class: i === selStroke ? 'sel' : '', onClick: () => { selStroke = i; refreshDone(); } }, h('span', { class: 'sw', style: { background: '#1baf7a' } }), h('span', null, `${i + 1}. ${st.tool} (${st.profile}, ${st.size} mm)`, h('div', { class: 'meta' }, `${st.pts.length} points${st.filled ? ', filled' : ''}`)), h('span'), h('button', { class: 'sm', onClick: (e: MouseEvent) => { e.stopPropagation(); strokes.splice(i, 1); selStroke = Math.min(selStroke, strokes.length - 1); refreshDone(); } }, 'x'))));
    renderPointTable();
    if (!strokes.length) list.append(h('li', { style: { color: 'var(--muted)', cursor: 'default' } }, '', 'No strokes yet. Drag in the viewport.'));
  }
  function clearAll() { strokes = []; cur = []; if (acc) { acc.delete(); acc = null; } showPreview(null); refreshDone(); }
  function hideAll() { showPreview(null); if (handlesAdded) { ctx.viewer.scene.remove(handles); handlesAdded = false; } if (doneAdded) { ctx.viewer.scene.remove(doneGroup); doneAdded = false; } if (markerAdded) { ctx.viewer.scene.remove(anchorMarker); markerAdded = false; } if (cursorAdded) { ctx.viewer.scene.remove(cursorMesh); cursorAdded = false; } }

  // ---------------- pointer
  const caster = new THREE.Raycaster();
  function onDraw(phase: DrawPhase, ray: THREE.Ray, e: PointerEvent | MouseEvent, hit: Hit | null) {
    const t = tool.value as Tool;
    if (t === 'edit') {
      if (phase === 'down') { caster.ray.copy(ray); handles.updateMatrixWorld(true); const hs = caster.intersectObjects(handles.children, false); if (!hs.length) { dragHandle = null; return; }
        const { s: si, p: pi } = hs[0].object.userData as { s: number; p: number }; selStroke = si; const st = strokes[si];
        if ((e as MouseEvent).altKey) { if (st.tool === 'stroke' && st.pts.length > 2) { st.pts.splice(pi, 1); refreshDone(); } else toast('Only freehand strokes with more than two points can lose a point.', 'warn'); return; }
        if ((e as MouseEvent).shiftKey && st.tool === 'stroke') { const a = st.pts[pi], b = st.pts[Math.min(pi + 1, st.pts.length - 1)]; st.pts.splice(pi + 1, 0, a.clone().lerp(b, 0.5)); dragHandle = { s: si, p: pi + 1 }; refreshDone(); return; }
        dragHandle = { s: si, p: pi }; refreshDone(); return; }
      if (phase === 'move' && dragHandle) { const st = strokes[dragHandle.s]; const pt = st.pts[dragHandle.p]; const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(st.basis.n, pt); const p = new THREE.Vector3(); if (ray.intersectPlane(pl, p)) { pt.copy(snapV(p)); refreshDone(); } return; }
      if (phase === 'up') { dragHandle = null; refreshDone(); }
      return;
    }
    if (phase === 'move' && !dragging) { // hover cursor so the user sees where the brush will land
      const b = basisFor(planeMode.value as PlaneMode); const liveHit = planeMode.value === 'surface' ? ctx.viewer.pick(e as PointerEvent) : null;
      const saved = anchor.clone(); const sp = anchorPart; const p = pointFor(ray, liveHit, b); anchor.copy(saved); anchorPart = sp;
      if (p) { cursorMesh.position.copy(p); cursorMesh.scale.setScalar(size.value / 2); if (!cursorAdded) { ctx.viewer.scene.add(cursorMesh); cursorAdded = true; } }
      return;
    }
    if (phase === 'down') {
      curBasis = basisFor(planeMode.value as PlaneMode); if (hit) setAnchor(hit.point, hit.part);
      const p = pointFor(ray, hit, curBasis); if (!p) return; dragging = true; cur = [p]; curPart = hit?.part ?? anchorPart; lastSeg = 0; if (acc) { acc.delete(); acc = null; }
      return;
    }
    if (!dragging || !curBasis) return;
    const liveHit = planeMode.value === 'surface' && phase !== 'up' ? ctx.viewer.pick(e as PointerEvent) : hit;
    const p = pointFor(ray, liveHit, curBasis); if (!p) return;
    if (phase === 'move') {
      if (t === 'stroke') { const last = cur[cur.length - 1]; if (last.distanceTo(p) < Math.max(0.3, size.value * 0.25)) return; cur.push(p); if (live.value) { const seg = capsule(cur[cur.length - 2], p, profile.value as Profile, size.value / 2, thick.value, curBasis); const next = acc ? M().Manifold.union(acc, seg) : seg; if (acc && acc !== seg) acc.delete(); acc = next; lastSeg++; if (lastSeg % 2 === 0) showPreview(acc); } }
      else { cur = [cur[0], p]; if (live.value) { try { const m = strokeSolid({ tool: t, pts: cur, profile: profile.value as Profile, size: size.value, thick: thick.value, filled: filled.value, basis: curBasis, startPart: curPart }); showPreview(m); m.delete(); } catch { /* too small yet */ } } }
      return;
    }
    if (phase === 'up') {
      dragging = false; if (t === 'stroke') cur.push(p); else cur = [cur[0], p];
      if ((t === 'stroke' && cur.length >= 2) || (t !== 'stroke' && cur[0].distanceTo(cur[1]) > 0.2)) strokes.push({ tool: t, pts: cur, profile: profile.value as Profile, size: size.value, thick: thick.value, filled: filled.value, basis: curBasis, startPart: curPart });
      cur = []; if (acc) { acc.delete(); acc = null; } showPreview(null); refreshDone();
      if (strokes.length && !hit) { const last = strokes[strokes.length - 1].pts; setAnchor(last[last.length - 1], anchorPart); }
    }
  }

  // ---------------- build
  function build() {
    if (!strokes.length) { toast('Draw a stroke first.', 'warn'); return; }
    const mode = result.value; const target = strokes.find((s) => s.startPart)?.startPart ?? project.primary;
    hideAll();
    runOp('Building strokes', () => { const { Manifold } = M(); const ms = strokes.map(strokeSolid); let r = ms.length === 1 ? ms[0] : Manifold.union(ms); if (symmetry.value !== 'none') r = Manifold.union(r, r.mirror(symmetry.value === 'x' ? [1, 0, 0] : [0, 1, 0])); return r; }, (solid) => {
      if (mode === 'fuse' && target && target.manifold) {
        const { Manifold } = M(); const r = Manifold.union(project.bakeTransform(target)!, solid);
        if (r.status() !== 'NoError' || r.isEmpty()) { toast('Union failed.', 'bad'); return; } project.replaceManifold(target, r); project.select([target.id]);
      } else {
        if (mode === 'fuse') toast('No watertight part to fuse into; added as a new part.', 'info');
        const p = project.addManifold(solid, `Free draw ${strokes.length} stroke${strokes.length > 1 ? 's' : ''}`, mode === 'negative' ? '#e34948' : mode === 'modifier' ? '#2a78d6' : '#1baf7a');
        if (mode === 'negative') project.setRole(p, 'negative', false); else if (mode === 'modifier') project.setRole(p, 'modifier', false);
        project.select([p.id]); project.emit();
      }
      strokes = []; refreshDone(); if (markerAdded === false) setAnchor(anchor, anchorPart); toast('Strokes built.', 'good');
    });
  }

  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-flame'), 'Free draw in 3D'),
    desc('A brush you drag through space. Start on a part and the stroke follows its surface; keep dragging off the edge and it continues in the air at that depth on a plane facing the camera. Orbit (right-drag or Space + drag) to a side view to draw vertically, draw a circle to make a hanging keyring loop, then Build to fuse it on. Every stroke previews live.'),
    section('Where strokes land', planeMode, snap, info, rowBtns(btn('Anchor at selected part', () => { const p = project.primary; if (!p) { toast('Select a part.', 'warn'); return; } const b = worldBox(p); setAnchor(b.getCenter(new THREE.Vector3()), p); }), btn('Anchor at bed centre', () => setAnchor(new THREE.Vector3(0, 0, 0), null)))),
    section('Brush', tool, profile, size, thick, filled, smooth),
    section('Strokes', list, rowBtns(btn('Undo last stroke', () => { strokes.pop(); selStroke = Math.min(selStroke, strokes.length - 1); refreshDone(); }), btn('Clear', clearAll))),
    section('Edit selected stroke', desc('Pick a stroke in the list or click a handle with the Edit tool. Drag handles to move points (Alt+click removes, Shift+click inserts on freehand strokes), type coordinates, or transform the whole stroke. Align re-planes the stroke so a tilted loop becomes exactly vertical or horizontal.'),
      ptTable, mvX, mvY, mvZ, rotX, rotY, rotZ, scl,
      rowBtns(btn('Align XY (horizontal)', () => alignTo('xy')), btn('Align XZ (vertical front)', () => alignTo('xz')), btn('Align YZ (vertical side)', () => alignTo('yz')), btn('Align to camera', () => alignTo('view')), btn('Flip', flip)),
      rowBtns(btn('Centre on anchor', () => xform((st) => { const c = centroid(st); const d = anchor.clone().sub(c); st.pts.forEach((p) => p.add(d)); }, { value: 0 })), btn('Drop to bed', () => xform((st) => { const r = st.size / 2; let mz = Infinity; st.pts.forEach((p) => { mz = Math.min(mz, p.z); }); st.pts.forEach((p) => { p.z += r - mz; }); }, { value: 0 })))),
    section('Build', result, symmetry, live, rowBtns(btn('Build', build, { primary: true }), btn('Done drawing', () => ctx.viewer.setMode('select')))),
    h('p', { class: 'note' }, 'Keyring recipe: select the part, orbit to a side view, choose Circle with a 3 mm round brush, drag from just outside the part edge, Build with Fuse.'),
  ) as Panel;
  el.activate = () => { ctx.viewer.onDraw = onDraw; ctx.viewer.setMode('draw'); const p = project.primary; if (p) { const b = worldBox(p); setAnchor(b.getCenter(new THREE.Vector3()), p); } else setAnchor(new THREE.Vector3(), null); refreshDone(); };
  el.deactivate = () => { ctx.viewer.onDraw = null; ctx.viewer.setMode('select'); if (acc) { acc.delete(); acc = null; } cur = []; dragging = false; dragHandle = null; hideAll(); };
  void hoverPt;
  return el;
}
