// Draw panel: sketch 2D shapes on any plane (picked face, axis preset, tilted/diagonal) with live 3D preview and editable points.
import * as THREE from 'three';
import type { Manifold } from 'manifold-3d';
import { h, btn, num, sel, section, desc, rowBtns, icon, toast, range, check } from '../dom';
import { ctx, runOp, worldBox, requireManifoldPart, type Panel } from '../ctx';
import { project, type Part } from '../../core/project';
import { M } from '../../core/manifold';
import type { Hit, DrawPhase } from '../../viewer/scene';
import { simplifyLoop } from '../../tools/image2mesh';
import { manifoldToGeometry } from '../../core/geom';

type Tool = 'free' | 'poly' | 'rect' | 'circle' | 'ring' | 'line' | 'edit';
interface Shape { tool: Exclude<Tool, 'edit'>; pts: [number, number][]; stroke: number; hole: boolean; ring: number; plane: Plane }
interface Plane { origin: THREE.Vector3; n: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; part: Part | null }
interface Base { origin: THREE.Vector3; n: THREE.Vector3; part: Part | null }
type Orient = 'auto' | 'pick' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
const ORIENT_N: Record<Exclude<Orient, 'pick' | 'auto'>, [number, number, number]> = { top: [0, 0, 1], bottom: [0, 0, -1], front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0] };

export function drawPanel(): Panel {
  let base: Base | null = null; let plane: Plane | null = null;
  let shapes: Shape[] = []; let cur: [number, number][] = []; let dragging = false; let hover: [number, number] | null = null;
  let selShape = -1; let dragHandle: { s: number; p: number } | null = null;

  // ---------------- controls
  const orient = sel('Plane', [['auto', 'Auto: the face under the cursor when a stroke starts'], ['pick', 'Picked face (click once to lock a plane)'], ['top', 'Top (Z+)'], ['bottom', 'Bottom (Z-)'], ['front', 'Front (Y-)'], ['back', 'Back (Y+)'], ['left', 'Left (X-)'], ['right', 'Right (X+)']], 'auto', (v) => { if (v === 'pick') { startPick(); } else if (v === 'auto') { info.textContent = 'Auto plane: start drawing on any face.'; ctx.viewer.setMode('draw'); } else presetPlane(v as Orient); });
  const tiltU = range('Tilt across', 0, { min: -90, max: 90, step: 5, unit: ' deg', onInput: () => applyOrientation() });
  const tiltV = range('Tilt along', 0, { min: -90, max: 90, step: 5, unit: ' deg', onInput: () => applyOrientation() });
  const spin = range('Spin', 0, { min: -180, max: 180, step: 5, unit: ' deg', onInput: () => applyOrientation() });
  const offset = num('Offset along normal', 0, { step: 0.5, unit: 'mm', onInput: () => applyOrientation(), onChange: () => applyOrientation() });
  const tool = sel('Tool', [['free', 'Freehand (drag)'], ['poly', 'Polygon (click points, double-click or Enter to close)'], ['rect', 'Rectangle (drag)'], ['circle', 'Circle (drag from centre)'], ['ring', 'Ring (drag from centre, outer radius)'], ['line', 'Stroked line (click points, Enter to finish)'], ['edit', 'Edit points (drag handles)']], 'free', () => { cur = []; hover = null; redraw(); });
  const stroke = num('Stroke width', 2, { min: 0.2, step: 0.2, unit: 'mm', onChange: () => redraw() });
  const ringW = num('Ring width', 3, { min: 0.2, step: 0.5, unit: 'mm', onChange: () => redraw() });
  const hole = check('Next shape is a hole', false);
  const snap = range('Snap grid', 1, { min: 0, max: 5, step: 0.5, unit: ' mm' });
  const height = num('Height / depth', 3, { min: 0.1, step: 0.5, unit: 'mm', onInput: () => schedulePreview() });
  const dir = sel('Direction', [['out', 'Outward (emboss / add)'], ['in', 'Inward (cut / pocket)'], ['both', 'Through both sides'], ['revolve', 'Revolve around the plane v axis (lathe)']], 'out', () => schedulePreview());
  const revDeg = num('Revolve angle', 360, { min: 5, max: 360, step: 5, unit: 'deg', onInput: () => schedulePreview() });
  const addAs = sel('Result', [['fuse', 'Fuse into the part (or cut when inward)'], ['new', 'New part'], ['negative', 'Negative part (editable)'], ['modifier', 'Modifier region']], 'fuse', () => schedulePreview());
  const live = check('Live 3D preview', true, () => schedulePreview());
  const symmetry = sel('Symmetry', [['none', 'None'], ['x', 'Mirror across X = 0'], ['y', 'Mirror across Y = 0']], 'none', () => schedulePreview());
  const liveBool = check('Preview combined with part (slower)', false, () => schedulePreview());
  const info = h('p', { class: 'note' }, 'No sketch plane yet.');
  const list = h('ul', { class: 'parts-list' }); const ptTable = h('div');

  // ---------------- scene objects
  const g = new THREE.Group(); let gAdded = false; g.matrixAutoUpdate = false;
  const grid = new THREE.GridHelper(100, 100, 0x2a78d6, 0x9ec5f4); (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.35; grid.rotation.x = Math.PI / 2;
  const sketchLines = new THREE.Group(); const handles = new THREE.Group(); g.add(grid); let overlayAdded = false; // lines and handles live in world space so shapes on different planes all show
  const lineMat = new THREE.LineBasicMaterial({ color: 0xeb6834, depthTest: false }); const curMat = new THREE.LineBasicMaterial({ color: 0x2a78d6, depthTest: false }); const holeMat = new THREE.LineBasicMaterial({ color: 0xd03b3b, depthTest: false });
  const handleGeo = new THREE.SphereGeometry(1, 12, 10); const handleMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, depthTest: false }); const handleSel = new THREE.MeshBasicMaterial({ color: 0xeb6834, depthTest: false });
  const previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x1baf7a, transparent: true, opacity: 0.6, roughness: 0.5, flatShading: true, depthWrite: false }));
  previewMesh.renderOrder = 15; let previewShown = false; let previewTimer = 0; let hiddenTarget: Part | null = null;

  // ---------------- plane handling
  function anchorFor(part: Part | null, n: THREE.Vector3): THREE.Vector3 {
    if (!part) return new THREE.Vector3(0, 0, 0);
    const b = worldBox(part); const c = b.getCenter(new THREE.Vector3()); const half = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    return c.add(new THREE.Vector3(n.x * half.x, n.y * half.y, n.z * half.z)); // centre of the face on that side of the box
  }
  function presetPlane(o: Orient) {
    if (o === 'pick' || o === 'auto') return; const n = new THREE.Vector3(...ORIENT_N[o]); const part = project.primary; base = { origin: anchorFor(part, n), n, part }; applyOrientation(); ctx.viewer.setMode('draw');
  }
  function startPick() { base = null; plane = null; hideAll(); info.textContent = 'Click a face of a part, or the bed, to set the sketch plane.'; ctx.viewer.setMode('draw'); toast('Click a face or the bed.', 'info'); }
  /** Build the working plane from the base plane plus tilt, spin and offset. Shapes are kept (their 2D coordinates stay valid). */
  function applyOrientation() {
    if (!base) return;
    let n = base.n.clone().normalize();
    const ref = Math.abs(n.z) < 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    let u = new THREE.Vector3().crossVectors(ref, n).normalize(); let v = new THREE.Vector3().crossVectors(n, u).normalize();
    const rot = (axis: THREE.Vector3, deg: number) => { const q = new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180); n.applyQuaternion(q); u.applyQuaternion(q); v.applyQuaternion(q); };
    if (tiltU.value) rot(u.clone(), tiltU.value); if (tiltV.value) rot(v.clone(), tiltV.value); if (spin.value) rot(n.clone(), spin.value);
    const origin = base.origin.clone().add(n.clone().multiplyScalar(offset.value));
    plane = { origin, n, u, v, part: base.part };
    g.matrix.copy(new THREE.Matrix4().makeBasis(u, v, n).setPosition(origin));
    const size = base.part ? worldBox(base.part).getSize(new THREE.Vector3()).length() : 120; const gs = Math.max(40, Math.ceil(size / 10) * 10);
    grid.geometry.dispose(); grid.geometry = new THREE.GridHelper(gs, gs, 0x2a78d6, 0x9ec5f4).geometry; grid.position.z = 0.05;
    if (!gAdded) { ctx.viewer.scene.add(g); gAdded = true; }
    info.textContent = `Plane on ${base.part ? base.part.name : 'the bed'} at (${origin.x.toFixed(1)}, ${origin.y.toFixed(1)}, ${origin.z.toFixed(1)}), normal (${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}).`;
    redraw();
  }
  function setPickedPlane(origin: THREE.Vector3, n: THREE.Vector3, part: Part | null, keepAuto = false) { base = { origin: origin.clone(), n: n.clone().normalize(), part }; if (!keepAuto) orient.value = 'pick'; applyOrientation(); }
  function hideAll() { hidePreview(); if (gAdded) { ctx.viewer.scene.remove(g); gAdded = false; } if (overlayAdded) { ctx.viewer.scene.remove(sketchLines, handles); overlayAdded = false; } }
  function ensureOverlay() { if (!overlayAdded) { ctx.viewer.scene.add(sketchLines, handles); overlayAdded = true; } }
  const toWorld = (pl: Plane, x: number, y: number, lift = 0.1) => pl.origin.clone().addScaledVector(pl.u, x).addScaledVector(pl.v, y).addScaledVector(pl.n, lift);
  function to2D(ray: THREE.Ray, doSnap = true, onPlane: Plane | null = plane): [number, number] | null {
    if (!onPlane) return null; const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(onPlane.n, onPlane.origin); const p = new THREE.Vector3();
    if (!ray.intersectPlane(pl, p)) return null; const d = p.sub(onPlane.origin); let x = d.dot(onPlane.u), y = d.dot(onPlane.v);
    const s = snap.value; if (doSnap && s > 0) { x = Math.round(x / s) * s; y = Math.round(y / s) * s; } return [+x.toFixed(3), +y.toFixed(3)];
  }

  // ---------------- shapes
  const circlePts = (c: [number, number], r: number): [number, number][] => { const out: [number, number][] = []; for (let i = 0; i < 48; i++) out.push([c[0] + r * Math.cos((i / 48) * Math.PI * 2), c[1] + r * Math.sin((i / 48) * Math.PI * 2)]); return out; };
  function ringInner(sh: Shape): [number, number][] | null { if (sh.tool !== 'ring' || sh.pts.length < 2) return null; const c = sh.pts[0], e = sh.pts[sh.pts.length - 1]; const r = Math.hypot(e[0] - c[0], e[1] - c[1]) - sh.ring; return r > 0.05 ? circlePts(c, r) : null; }
  function shapeOutline(sh: Shape): [number, number][] {
    if ((sh.tool === 'ring' || sh.tool === 'circle') && sh.pts.length >= 2) { const c = sh.pts[0], e = sh.pts[sh.pts.length - 1]; return circlePts(c, Math.hypot(e[0] - c[0], e[1] - c[1])); }
    if (sh.tool === 'rect' && sh.pts.length >= 2) { const [a, b] = [sh.pts[0], sh.pts[sh.pts.length - 1]]; return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }
    return sh.pts;
  }
  function pendingShape(): Shape | null {
    if (!cur.length) return null; const t = tool.value as Tool; if (t === 'edit') return null;
    const pts = hover && (t === 'poly' || t === 'line') ? [...cur, hover] : cur;
    const enough = (t === 'poly' && pts.length >= 3) || (t === 'line' && pts.length >= 2) || (t === 'free' && pts.length >= 3) || ((t === 'rect' || t === 'circle' || t === 'ring') && pts.length >= 2);
    return enough && plane ? { tool: t, pts, stroke: stroke.value, hole: hole.value, ring: ringW.value, plane } : null;
  }
  function finishCurrent() {
    const t = tool.value as Tool; if (t === 'edit') return;
    if ((t === 'poly' && cur.length >= 3) || (t === 'line' && cur.length >= 2) || (t === 'free' && cur.length >= 3) || ((t === 'rect' || t === 'circle' || t === 'ring') && cur.length >= 2)) { if (plane) { shapes.push({ tool: t, pts: t === 'free' ? simplifyLoop(cur, 0.25) : cur, stroke: stroke.value, hole: hole.value, ring: ringW.value, plane }); selShape = shapes.length - 1; } }
    cur = []; hole.value = false; redraw();
  }
  const minPts = (sh: Shape) => (sh.tool === 'poly' || sh.tool === 'free' ? 3 : 2);

  function redraw() {
    sketchLines.clear(); handles.clear(); ensureOverlay();
    const add = (pl: Plane, pts: [number, number][], closed: boolean, mat: THREE.LineBasicMaterial) => { if (pts.length < 2) return; const arr = pts.map(([x, y]) => toWorld(pl, x, y)); if (closed) arr.push(arr[0].clone()); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arr), mat); l.renderOrder = 20; sketchLines.add(l); };
    shapes.forEach((sh, i) => { add(sh.plane, shapeOutline(sh), sh.tool !== 'line', sh.hole ? holeMat : i === selShape ? curMat : lineMat); const inner = ringInner(sh); if (inner) add(sh.plane, inner, true, sh.hole ? holeMat : lineMat); });
    const pending = pendingShape(); if (pending) { add(pending.plane, shapeOutline(pending), pending.tool !== 'line' && pending.tool !== 'poly', curMat); const inner = ringInner(pending); if (inner) add(pending.plane, inner, true, curMat); }
    if (tool.value === 'edit') {
      const r = Math.max(0.6, (base?.part ? worldBox(base.part).getSize(new THREE.Vector3()).length() : 100) * 0.008);
      shapes.forEach((sh, si) => sh.pts.forEach(([x, y], pi) => { const m = new THREE.Mesh(handleGeo, si === selShape ? handleSel : handleMat); m.scale.setScalar(r); m.position.copy(toWorld(sh.plane, x, y, 0.2)); m.renderOrder = 25; m.userData = { s: si, p: pi }; handles.add(m); }));
    }
    list.innerHTML = '';
    shapes.forEach((sh, i) => list.append(h('li', { class: i === selShape ? 'sel' : '', onClick: () => { selShape = i; redraw(); } }, h('span', { class: 'sw', style: { background: sh.hole ? '#d03b3b' : '#eb6834' } }), h('span', null, `${i + 1}. ${sh.tool}${sh.hole ? ' (hole)' : ''}`, h('div', { class: 'meta' }, `${sh.pts.length} point${sh.pts.length > 1 ? 's' : ''}`)), h('button', { class: 'sm', title: 'Toggle hole', onClick: (e: MouseEvent) => { e.stopPropagation(); sh.hole = !sh.hole; redraw(); } }, sh.hole ? 'fill' : 'hole'), h('button', { class: 'sm', title: 'Delete', onClick: (e: MouseEvent) => { e.stopPropagation(); shapes.splice(i, 1); selShape = Math.min(selShape, shapes.length - 1); redraw(); } }, 'x'))));
    if (!shapes.length) list.append(h('li', { style: { color: 'var(--muted)', cursor: 'default' } }, '', 'No shapes yet.'));
    renderPointTable(); schedulePreview();
  }
  function renderPointTable() {
    ptTable.innerHTML = ''; const sh = shapes[selShape]; if (!sh) return;
    const labels = sh.tool === 'circle' || sh.tool === 'ring' ? ['centre', 'radius point'] : sh.tool === 'rect' ? ['corner A', 'corner B'] : [];
    const tbl = h('table', null, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'u (mm)'), h('th', null, 'v (mm)'), h('th', null, ''))));
    const body = h('tbody');
    sh.pts.forEach((pt, i) => {
      const inU = h('input', { type: 'number', step: 0.5, value: String(pt[0]), style: { width: '70px' } }), inV = h('input', { type: 'number', step: 0.5, value: String(pt[1]), style: { width: '70px' } });
      const upd = () => { sh.pts[i] = [parseFloat(inU.value) || 0, parseFloat(inV.value) || 0]; redraw(); };
      inU.addEventListener('change', upd); inV.addEventListener('change', upd);
      body.append(h('tr', null, h('td', null, labels[i] ?? String(i + 1)), h('td', null, inU), h('td', null, inV), h('td', null, sh.pts.length > minPts(sh) && !labels.length ? h('button', { class: 'sm', onClick: () => { sh.pts.splice(i, 1); redraw(); } }, 'x') : '')));
    });
    tbl.append(body); ptTable.append(h('div', { class: 'tbl', style: { maxHeight: '220px' } }, tbl));
  }

  // ---------------- pointer handling
  const caster = new THREE.Raycaster();
  function handleAt(ray: THREE.Ray): THREE.Object3D | null { if (!handles.children.length) return null; caster.ray.copy(ray); handles.updateMatrixWorld(true); const hits = caster.intersectObjects(handles.children, false); return hits.length ? hits[0].object : null; }
  function onDraw(phase: DrawPhase, ray: THREE.Ray, e: PointerEvent | MouseEvent, hit: Hit | null) {
    const t = tool.value as Tool;
    const auto = orient.value === 'auto' && t !== 'edit';
    // Auto plane: the face under the cursor when a stroke starts becomes this shape's plane (tilt / spin / offset still apply)
    const strokeStart = (phase === 'down') || ((t === 'poly' || t === 'line') && phase === 'up' && cur.length === 0);
    if (auto && strokeStart) {
      const bedHit = () => { const p = new THREE.Vector3(); return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p) ? p : null; };
      if (hit) setPickedPlane(hit.point, hit.normal, hit.part, true); else { const p = bedHit(); if (p) setPickedPlane(p, new THREE.Vector3(0, 0, 1), null, true); }
    }
    if (!plane) { if (phase === 'up') { if (hit) setPickedPlane(hit.point, hit.normal, hit.part); else { const p = new THREE.Vector3(); if (ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) setPickedPlane(p, new THREE.Vector3(0, 0, 1), null); else toast('Click on a part face or the bed to set the sketch plane.', 'warn'); } } return; }
    if (t === 'edit') {
      if (phase === 'down') { const hnd = handleAt(ray); if (!hnd) { dragHandle = null; return; } const { s, p } = hnd.userData as { s: number; p: number }; selShape = s; const sh = shapes[s];
        if ((e as MouseEvent).altKey) { if (sh.pts.length > minPts(sh) && sh.tool !== 'rect' && sh.tool !== 'circle' && sh.tool !== 'ring') { sh.pts.splice(p, 1); redraw(); } else toast('Cannot remove: shape needs its remaining points.', 'warn'); return; }
        if ((e as MouseEvent).shiftKey && (sh.tool === 'poly' || sh.tool === 'free' || sh.tool === 'line')) { const a = sh.pts[p], b = sh.pts[(p + 1) % sh.pts.length]; sh.pts.splice(p + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); dragHandle = { s, p: p + 1 }; redraw(); return; }
        dragHandle = { s, p }; redraw(); return; }
      if (phase === 'move' && dragHandle) { const sh = shapes[dragHandle.s]; const pt = to2D(ray, true, sh.plane); if (pt) { sh.pts[dragHandle.p] = pt; redraw(); } return; }
      if (phase === 'up') { dragHandle = null; renderPointTable(); return; }
      return;
    }
    const pt = to2D(ray); if (!pt) return;
    if (phase === 'dbl') { if (t === 'poly' || t === 'line') { const need = t === 'poly' ? 3 : 2; if (cur.length > need && Math.hypot(cur[cur.length - 1][0] - pt[0], cur[cur.length - 1][1] - pt[1]) < 1e-6) cur.pop(); finishCurrent(); } return; }
    if (t === 'poly' || t === 'line') { if (phase === 'up') { cur.push(pt); redraw(); } else if (phase === 'move') { hover = pt; redraw(); } return; }
    if (phase === 'down') { dragging = true; cur = [pt]; }
    else if (phase === 'move' && dragging) { if (t === 'free') { const last = cur[cur.length - 1]; if (Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 0.2) cur.push(pt); } else cur = [cur[0], pt]; redraw(); }
    else if (phase === 'up' && dragging) { dragging = false; if (t === 'free') cur.push(pt); else cur = [cur[0], pt]; finishCurrent(); }
  }

  // ---------------- solid + preview
  /** One cross-section per plane (fills minus holes), extruded along that plane's normal, all unioned. */
  function buildSolid(includePending = false): Manifold {
    const all = includePending ? [...shapes, ...(pendingShape() ? [pendingShape()!] : [])] : shapes;
    if (!all.length) throw new Error('Draw at least one shape.');
    const { CrossSection, Manifold } = M();
    const groups = new Map<Plane, Shape[]>(); for (const sh of all) (groups.get(sh.plane) ?? groups.set(sh.plane, []).get(sh.plane)!).push(sh);
    const solids: Manifold[] = [];
    for (const [pl, list2] of groups) {
      const pieces: InstanceType<typeof CrossSection>[] = []; const holes: InstanceType<typeof CrossSection>[] = [];
      for (const sh of list2) {
        const into = sh.hole ? holes : pieces;
        if (sh.tool === 'ring') { const o = shapeOutline(sh); const inner = ringInner(sh); if (o.length >= 3) { let c = new CrossSection([o], 'NonZero'); if (inner) c = c.subtract(new CrossSection([inner], 'NonZero')); into.push(c); } continue; }
        if (sh.tool === 'line') { for (let i = 0; i + 1 < sh.pts.length; i++) { const a = sh.pts[i], b = sh.pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue; const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; into.push(CrossSection.square([L, sh.stroke], true).rotate(ang).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)); into.push(CrossSection.circle(sh.stroke / 2, 24).translate(a[0], a[1])); } const e = sh.pts[sh.pts.length - 1]; into.push(CrossSection.circle(sh.stroke / 2, 24).translate(e[0], e[1])); continue; }
        const o = shapeOutline(sh); if (o.length >= 3) into.push(new CrossSection([o], 'NonZero'));
      }
      if (!pieces.length) continue;
      let cs = CrossSection.union(pieces); if (holes.length) cs = cs.subtract(CrossSection.union(holes));
      if (cs.isEmpty() || cs.area() < 0.01) continue;
      const hgt = height.value; const d = dir.value; const lip = 0.3;
      let solid: Manifold;
      if (d === 'revolve') { const bnd = cs.bounds(); const shifted = bnd.min[0] < 0 ? cs.translate(-bnd.min[0], 0) : cs; solid = shifted.revolve(64, revDeg.value).rotate(-90, 0, 0); /* revolve spins about Y: bring the axis onto the plane v axis */ solid = solid.rotate(90, 0, 0); }
      else if (d === 'out') solid = cs.extrude(hgt).translate(0, 0, -lip * (addAs.value === 'fuse' ? 1 : 0));
      else if (d === 'in') solid = cs.extrude(hgt + lip).translate(0, 0, -hgt);
      else solid = cs.extrude(hgt * 2).translate(0, 0, -hgt);
      const m = new THREE.Matrix4().makeBasis(pl.u, pl.v, pl.n).setPosition(pl.origin);
      solids.push(solid.transform(Array.from(m.elements) as any));
    }
    if (!solids.length) throw new Error('Sketch has no area (holes need a filled shape to cut from).');
    let result = solids.length === 1 ? solids[0] : Manifold.union(solids);
    if (symmetry.value !== 'none') result = Manifold.union(result, result.mirror(symmetry.value === 'x' ? [1, 0, 0] : [0, 1, 0]));
    return result;
  }
  function hidePreview() { if (previewShown) { ctx.viewer.scene.remove(previewMesh); previewShown = false; } if (hiddenTarget) { hiddenTarget.object.visible = hiddenTarget.visible; hiddenTarget = null; } }
  function schedulePreview() { if (previewTimer) return; previewTimer = window.setTimeout(() => { previewTimer = 0; updatePreview(); }, liveBool.value ? 120 : 16); }
  function updatePreview() {
    if (!live.value || (!shapes.length && !pendingShape())) { hidePreview(); return; }
    let solid: Manifold | null = null, shown: Manifold | null = null;
    try {
      solid = buildSolid(true);
      const target = targetPart(); const inward = dir.value === 'in';
      const mat = previewMesh.material as THREE.MeshStandardMaterial;
      if (liveBool.value && target?.manifold && addAs.value === 'fuse') {
        const { Manifold } = M(); const basem = project.bakeTransform(target)!;
        shown = inward ? Manifold.difference(basem, solid) : Manifold.union(basem, solid);
        mat.color.set(target.color); mat.opacity = 0.95; if (!hiddenTarget) { hiddenTarget = target; target.object.visible = false; }
      } else {
        shown = solid; if (hiddenTarget) { hiddenTarget.object.visible = hiddenTarget.visible; hiddenTarget = null; }
        mat.color.set(inward || addAs.value === 'negative' ? 0xe34948 : addAs.value === 'modifier' ? 0x2a78d6 : 0x1baf7a); mat.opacity = 0.6;
      }
      const geo = manifoldToGeometry(shown); previewMesh.geometry.dispose(); previewMesh.geometry = geo;
      if (!previewShown) { ctx.viewer.scene.add(previewMesh); previewShown = true; }
    } catch { hidePreview(); }
    finally { if (shown && shown !== solid) shown.delete(); if (solid) solid.delete(); }
  }
  /** The part the sketch belongs to: the part of the first shape's plane (shapes drawn on the bed have none). */
  function targetPart(): Part | null { const sh = shapes[0] ?? pendingShape(); return sh?.plane.part ?? plane?.part ?? null; }
  function build() {
    if (!shapes.length) { toast('Draw a shape first.', 'warn'); return; }
    const target = targetPart(); const mode = addAs.value; const inward = dir.value === 'in';
    hidePreview();
    runOp('Building sketch', () => buildSolid(), (solid) => {
      if (mode === 'fuse' && target) {
        if (!target.manifold) { toast('Target is mesh-only; repair it first or add as a new part.', 'bad'); return; }
        const { Manifold } = M(); const b = project.bakeTransform(target)!; const r = inward ? Manifold.difference(b, solid) : Manifold.union(b, solid);
        if (r.status() !== 'NoError' || r.isEmpty()) { toast('Boolean failed.', 'bad'); return; } project.replaceManifold(target, r); project.select([target.id]);
      } else {
        const p = project.addManifold(solid, `Sketch ${shapes.length} shape${shapes.length > 1 ? 's' : ''}`, mode === 'negative' ? '#e34948' : mode === 'modifier' ? '#2a78d6' : '#eb6834');
        if (mode === 'negative' || (mode === 'fuse' && inward)) project.setRole(p, 'negative', false); else if (mode === 'modifier') project.setRole(p, 'modifier', false);
        project.select([p.id]); project.emit();
      }
      shapes = []; cur = []; selShape = -1; redraw(); toast('Sketch built. Keep drawing on the same plane or pick a new one.', 'good');
    });
  }

  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-beaker'), 'Draw on a part'),
    desc('Draw straight onto the part: with Plane = Auto every stroke lands on the face under the cursor, so a ring dragged on a side face stands vertical. Lock a plane with Pick or a preset, then tilt or spin it for diagonals. The solid forms live as you drag (green = add, red = cut). Camera: right-drag orbits, middle-drag pans, wheel zooms, Space + left-drag orbits. Edit points: drag handles, Alt+click removes, Shift+click inserts, or type coordinates.'),
    section('Plane', orient, tiltU, tiltV, spin, offset, info, rowBtns(btn('Pick a face / bed', () => { orient.value = 'pick'; startPick(); }, { primary: true }), btn('Reset tilt', () => { tiltU.value = 0; tiltV.value = 0; spin.value = 0; offset.value = 0; applyOrientation(); }))),
    section('Sketch', tool, stroke, ringW, snap, hole, rowBtns(btn('Finish shape (Enter)', finishCurrent), btn('Clear sketch', () => { shapes = []; cur = []; selShape = -1; redraw(); })), list, ptTable),
    section('Extrude', height, dir, revDeg, addAs, symmetry, live, liveBool, rowBtns(btn('Build', build, { primary: true }), btn('Done drawing', () => ctx.viewer.setMode('select')))),
    section('Split the part by this plane', desc('Uses the current sketch plane (including tilt, spin and offset) as a cutting plane: any angle, not just the axes.'),
      rowBtns(btn('Split selected part by plane', () => { const p = requireManifoldPart('Split'); if (!p || !plane) { if (!plane) toast('Set a plane first.', 'warn'); return; } const n = plane.n; const off = plane.origin.dot(n);
        runOp('Splitting', () => { const [a, b] = project.bakeTransform(p)!.splitByPlane([n.x, n.y, n.z], off); (window as any).__sp = b; return a; }, (a) => { const b = (window as any).__sp as Manifold; delete (window as any).__sp; project.snapshot(); if (a.isEmpty() || b.isEmpty()) { toast('The plane misses the part.', 'warn'); return; } project.replaceManifold(p, a, false); p.name = `${p.name} A`; project.addManifold(b, `${p.name.replace(/ A$/, '')} B`, p.color, false); toast('Split into A (plane normal side) and B.', 'good'); }); }, { primary: true }))),
    h('p', { class: 'note' }, 'Vertical ring: select a part, choose Plane = Front or Right, pick the Ring tool and drag on the side face. The plane follows the selected part when you change presets; use Offset to move it in or out.'),
  ) as Panel;
  el.activate = () => { ctx.viewer.onDraw = onDraw; ctx.viewer.setMode('draw'); if (orient.value === 'auto') info.textContent = 'Auto plane: start drawing on any face of a part (or the bed).'; };
  el.deactivate = () => { ctx.viewer.onDraw = null; ctx.viewer.setMode('select'); hideAll(); base = null; plane = null; shapes = []; cur = []; selShape = -1; };
  document.addEventListener('keydown', (e) => { if (ctx.viewer.mode !== 'draw') return; const tg = e.target as HTMLElement; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) return; if (e.key === 'Enter') finishCurrent(); else if (e.key === 'Escape') { if (cur.length) { cur = []; redraw(); } else ctx.viewer.setMode('select'); } });
  return el;
}
