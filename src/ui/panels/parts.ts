// Parts panel: list, transform, booleans, mirror, repair, simplify, info.
import * as THREE from 'three';
import { project, type Part } from '../../core/project';
import { h, btn, num, sel, section, sectionC, desc, rowBtns, toast, icon, color as colorField, busy, check, range } from '../dom';
import { linearArray, gridArray, polarArray, autoOrient, deform, shell, offsetSolid, roundEdges, mat4, drainHoles } from '../../tools/modeling';
import { ctx, runOp, dropToBed, centerOnBed, worldBox, type Panel } from '../ctx';
import { M } from '../../core/manifold';
import { geometryToManifold, manifoldToGeometry } from '../../core/geom';
import { MATERIALS } from '../../data/materials';

export function partsPanel(): Panel {
  const list = h('ul', { class: 'parts-list' });
  const info = h('dl', { class: 'kv' });
  const nameIn = h('input', { type: 'text' });
  nameIn.addEventListener('change', () => { const p = project.primary; if (p) { p.name = nameIn.value; project.emit(); } });
  const col = colorField('Colour', '#8fb3e8', (v) => { const p = project.primary; if (p) { project.setColor(p, v); } });
  const role = sel('Role', [['part', 'Part (printed)'], ['negative', 'Negative (subtracted on export / combine)'], ['modifier', 'Modifier (settings region, own object in 3MF)']], 'part', (v) => { const p = project.primary; if (p) project.setRole(p, v as any); });
  const px = num('X', 0, { step: 0.5, unit: 'mm', onChange: (v) => setPos('x', v) }), py = num('Y', 0, { step: 0.5, unit: 'mm', onChange: (v) => setPos('y', v) }), pz = num('Z', 0, { step: 0.5, unit: 'mm', onChange: (v) => setPos('z', v) });
  const rx = num('Rot X', 0, { step: 5, unit: 'deg', onChange: (v) => setRot('x', v) }), ry = num('Rot Y', 0, { step: 5, unit: 'deg', onChange: (v) => setRot('y', v) }), rz = num('Rot Z', 0, { step: 5, unit: 'deg', onChange: (v) => setRot('z', v) });
  const sx = num('Size X', 0, { step: 1, unit: 'mm', onChange: (v) => setSize(0, v) }), sy = num('Size Y', 0, { step: 1, unit: 'mm', onChange: (v) => setSize(1, v) }), sz = num('Size Z', 0, { step: 1, unit: 'mm', onChange: (v) => setSize(2, v) });
  const uniform = h('input', { type: 'checkbox', checked: true });
  const fitBed = btn('Scale to fit bed', () => { const p = project.primary; if (!p) return; const b = worldBox(p); const sz = b.getSize(new THREE.Vector3()); const f = Math.min((ctx.bedSize[0] - 10) / sz.x, (ctx.bedSize[1] - 10) / sz.y, (ctx.bedSize[2] - 2) / sz.z); if (f >= 1) { toast('Already fits the bed.', 'info'); return; } project.snapshot(); p.object.scale.multiplyScalar(f); p.object.updateMatrixWorld(); dropToBed(p); centerOnBed(p); project.emit(); toast(`Scaled by ${(f * 100).toFixed(0)} % to fit the bed.`, 'good'); });
  const scalePct = num('Scale all', 100, { step: 5, unit: '%', onChange: (v) => { const p = project.primary; if (!p || !(v > 0)) return; project.snapshot(); p.object.scale.multiplyScalar(v / 100); p.object.updateMatrixWorld(); scalePct.value = 100; project.emit(); } });

  function setPos(axis: 'x' | 'y' | 'z', v: number) { const p = project.primary; if (!p || isNaN(v)) return; project.snapshot(); p.object.position[axis] = v; p.object.updateMatrixWorld(); project.emit(); }
  function setRot(axis: 'x' | 'y' | 'z', v: number) { const p = project.primary; if (!p || isNaN(v)) return; project.snapshot(); p.object.rotation[axis] = THREE.MathUtils.degToRad(v); p.object.updateMatrixWorld(); project.emit(); }
  function setSize(i: number, v: number) {
    const p = project.primary; if (!p || !(v > 0)) return; const b = worldBox(p); const cur = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z][i]; if (!(cur > 0)) return;
    const f = v / cur; project.snapshot(); if (uniform.checked) p.object.scale.multiplyScalar(f); else { const s = p.object.scale; if (i === 0) s.x *= f; else if (i === 1) s.y *= f; else s.z *= f; } p.object.updateMatrixWorld(); project.emit();
  }

  const splitByPart = () => {
    const sel2 = project.selected; if (sel2.length !== 2 || sel2.some((p) => !p.manifold)) { toast('Select exactly two watertight parts: the part to split, then the cutter.', 'warn'); return; }
    runOp('Split by part', () => { const [inside, outside] = project.bakeTransform(sel2[0])!.split(project.bakeTransform(sel2[1])!); (window as any).__out = outside; return inside; }, (inside) => {
      const outside = (window as any).__out as import('manifold-3d').Manifold; delete (window as any).__out; project.snapshot(); const base = sel2[0];
      project.replaceManifold(base, outside, false); base.name = `${base.name} outside`; if (!inside.isEmpty()) project.addManifold(inside, `${base.name.replace(' outside', '')} inside`, '#eb6834', false); toast('Split into the piece inside the cutter and the piece outside it. The cutter is kept.', 'good', 5000); });
  };
  let snapping = false;
  const snapBtn = btn('Snap onto a surface (click)', () => {
    const p = project.primary; if (!p) { toast('Select the part to move first.', 'warn'); return; }
    if (snapping) { snapping = false; ctx.viewer.onPlace = null; ctx.viewer.setMode('select'); snapBtn.setAttribute('aria-pressed', 'false'); return; }
    snapping = true; snapBtn.setAttribute('aria-pressed', 'true'); ctx.viewer.setMode('place'); toast('Click a face on another part; the selected part lands there, bottom down, aligned to the face.', 'info', 5000);
    ctx.viewer.onPlace = (hit) => { if (hit.part === p) { toast('Click a different part.', 'warn'); return; } project.snapshot(); const b = worldBox(p); const bottomCentre = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.min.z);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal.clone().normalize()); p.object.quaternion.premultiply(q); p.object.updateMatrixWorld();
      const b2 = worldBox(p); const pivot = bottomCentre.clone().sub(p.object.position); const moved = pivot.clone().applyQuaternion(q).add(p.object.position); void b2; p.object.position.add(hit.point.clone().sub(moved)); p.object.updateMatrixWorld(); project.emit();
      if (!(window.event as KeyboardEvent | undefined)?.shiftKey) { snapping = false; ctx.viewer.onPlace = null; ctx.viewer.setMode('select'); snapBtn.setAttribute('aria-pressed', 'false'); } };
  });
  const boolBtn = (label: string, op: 'union' | 'difference' | 'intersection') => btn(label, () => {
    const sel = project.selected; if (sel.length < 2) { toast('Select two or more parts (shift-click). First selected is the target.', 'warn'); return; }
    if (sel.some((p) => !p.manifold)) { toast('All selected parts must be watertight for booleans.', 'bad'); return; }
    runOp(`Boolean ${op}`, () => { const { Manifold } = M(); const baked = sel.map((p) => project.bakeTransform(p)!); return op === 'union' ? Manifold.union(baked) : op === 'difference' ? Manifold.difference(baked) : Manifold.intersection(baked); }, (m) => {
      project.snapshot(); project.replaceManifold(sel[0], m, false); project.remove(sel.slice(1).map((p) => p.id), false); project.select([sel[0].id]); toast(`${op} done: ${m.numTri()} triangles`, 'good');
    });
  });

  const mirror = (ax: [number, number, number], label: string) => btn(label, () => { const p = project.primary; if (!p) return; if (!p.manifold) { toast('Mirror needs a watertight part.', 'bad'); return; } runOp('Mirror', () => project.bakeTransform(p)!.mirror(ax), (m) => project.replaceManifold(p, m)); });

  // ---- arrays
  const arrKind = sel('Array', [['linear', 'Linear (count x spacing)'], ['grid', 'Grid (rows x columns)'], ['polar', 'Polar (around an axis)']], 'linear', () => updArr());
  const arrN = num('Count', 3, { min: 2, max: 200, step: 1 }), arrDx = num('Step X', 30, { step: 1, unit: 'mm' }), arrDy = num('Step Y', 0, { step: 1, unit: 'mm' }), arrDz = num('Step Z', 0, { step: 1, unit: 'mm' });
  const arrNx = num('Columns', 3, { min: 1, max: 50, step: 1 }), arrNy = num('Rows', 2, { min: 1, max: 50, step: 1 }), arrSx = num('Spacing X', 30, { step: 1, unit: 'mm' }), arrSy = num('Spacing Y', 30, { step: 1, unit: 'mm' });
  const arrR = num('Radius', 30, { step: 1, unit: 'mm' }), arrAxis = sel('Axis', [['z', 'Z'], ['x', 'X'], ['y', 'Y']], 'z'), arrSweep = num('Sweep', 360, { min: 1, max: 360, step: 5, unit: 'deg' }), arrRot = check('Rotate copies', true);
  const arrFuse = check('Fuse copies into one part', false);
  function updArr() { const k = arrKind.value; for (const f of [arrN, arrDx, arrDy, arrDz]) f.style.display = k === 'linear' ? '' : 'none'; for (const f of [arrNx, arrNy, arrSx, arrSy]) f.style.display = k === 'grid' ? '' : 'none'; for (const f of [arrR, arrAxis, arrSweep, arrRot]) f.style.display = k === 'polar' ? '' : 'none'; arrN.style.display = k === 'grid' ? 'none' : ''; }
  function makeArray() {
    const p = project.primary; if (!p?.manifold) { toast('Select a watertight part.', 'warn'); return; }
    runOp('Array', () => { const { Manifold } = M(); const base = project.bakeTransform(p)!; const k = arrKind.value; const c = worldBox(p).getCenter(new THREE.Vector3());
      const copies = k === 'linear' ? linearArray(base, { count: arrN.value, dx: arrDx.value, dy: arrDy.value, dz: arrDz.value }) : k === 'grid' ? gridArray(base, { nx: arrNx.value, ny: arrNy.value, sx: arrSx.value, sy: arrSy.value }) : polarArray(base, { count: arrN.value, radius: arrR.value, axis: arrAxis.value as any, startDeg: 0, sweepDeg: arrSweep.value, rotateCopies: arrRot.value }, [c.x, c.y, c.z]);
      (window as any).__copies = copies; return arrFuse.value ? Manifold.union(copies) : copies[0]; }, (first) => {
      const copies = (window as any).__copies as import('manifold-3d').Manifold[]; delete (window as any).__copies; project.snapshot();
      if (arrFuse.value) { project.replaceManifold(p, first, false); }
      else { project.remove([p.id], false); copies.forEach((m, i) => project.addManifold(m, `${p.name} ${i + 1}`, p.color, false)); }
      project.emit(); toast(`${copies.length} copies made.`, 'good'); });
  }
  // ---- align / distribute
  const alignAxis = sel('Axis', [['x', 'X'], ['y', 'Y'], ['z', 'Z']], 'x');
  function align(where: 'min' | 'center' | 'max') {
    const sel2 = project.selected; if (sel2.length < 2) { toast('Select two or more parts.', 'warn'); return; } project.snapshot();
    const ax = alignAxis.value as 'x' | 'y' | 'z'; const ref = worldBox(sel2[0]); const target = where === 'min' ? ref.min[ax] : where === 'max' ? ref.max[ax] : (ref.min[ax] + ref.max[ax]) / 2;
    for (const p of sel2.slice(1)) { const b = worldBox(p); const cur = where === 'min' ? b.min[ax] : where === 'max' ? b.max[ax] : (b.min[ax] + b.max[ax]) / 2; p.object.position[ax] += target - cur; p.object.updateMatrixWorld(); }
    project.emit();
  }
  function distribute() {
    const sel2 = [...project.selected]; if (sel2.length < 3) { toast('Select three or more parts to distribute.', 'warn'); return; } project.snapshot();
    const ax = alignAxis.value as 'x' | 'y' | 'z'; sel2.sort((a, b) => worldBox(a).min[ax] - worldBox(b).min[ax]);
    const first = worldBox(sel2[0]), last = worldBox(sel2[sel2.length - 1]); const total = last.max[ax] - first.min[ax]; const sizes = sel2.map((p) => { const b = worldBox(p); return b.max[ax] - b.min[ax]; }); const gap = (total - sizes.reduce((a, b) => a + b, 0)) / (sel2.length - 1);
    let cursor = first.min[ax]; sel2.forEach((p, i) => { const b = worldBox(p); p.object.position[ax] += cursor - b.min[ax]; p.object.updateMatrixWorld(); cursor += sizes[i] + gap; }); project.emit();
  }
  // ---- deform
  const defKind = sel('Deformer', [['twist', 'Twist (degrees over the axis)'], ['taper', 'Taper (% scale at the top)'], ['bulge', 'Bulge (% at the middle)'], ['bend', 'Bend (degrees of arc)'], ['noise', 'Jitter (mm, organic roughness)']], 'twist');
  const defAmt = num('Amount', 45, { step: 5 }), defAxis = sel('Along axis', [['z', 'Z'], ['x', 'X'], ['y', 'Y']], 'z'), defRefine = range('Mesh density', 1.5, { min: 0.3, max: 6, step: 0.1, unit: ' mm' });
  // ---- shell / offset / round
  const wall = num('Wall thickness', 1.6, { min: 0.4, step: 0.2, unit: 'mm' }), openSide = sel('Open side', [['none', 'Closed (hollow inside)'], ['top', 'Open top (cup / box)'], ['bottom', 'Open bottom (cover)']], 'top');
  const offAmt = num('Offset', 1, { step: 0.5, unit: 'mm' }), roundR = num('Round radius', 1.5, { min: 0.2, step: 0.25, unit: 'mm' });
  const drainD = num('Drain hole diameter', 3, { min: 1, step: 0.5, unit: 'mm' }), drainN = num('Drain holes', 2, { min: 1, max: 12, step: 1 });

  const quick = h('div', { class: 'quick' }, h('p', { class: 'desc' }, 'Start here:'),
    btn('Import an STL / 3MF / OBJ', () => (document.querySelector('.topbar input[type=file]') as HTMLInputElement)?.click(), { icon: 'i-doc' }),
    btn('Create a primitive', () => ctx.setTab('create'), { icon: 'i-cpu' }), btn('Make 3D text', () => ctx.setTab('text'), { icon: 'i-doc' }), btn('Turn an image into a relief', () => ctx.setTab('image'), { icon: 'i-chart' }), btn('Draw a shape', () => ctx.setTab('draw'), { icon: 'i-beaker' }));
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-layers'), 'Parts and transforms'),
    desc('Click a part in the list or the viewport to select it. Shift-click adds to the selection. Drag the gizmo or type values; booleans use the first selected part as the target.'),
    quick, list,
    rowBtns(
      btn('Duplicate', () => { const p = project.primary; if (p) project.duplicate(p); }),
      btn('Delete', () => { if (project.selection.length) project.remove([...project.selection]); }, { cls: 'danger' }),
      btn('Hide/show', () => { for (const p of project.selected) p.visible = !p.visible; project.emit(); }),
      btn('Fit view', () => ctx.viewer.fitView(project.selected)),
    ),
    section('Selected part', h('label', { class: 'fld' }, h('span', null, 'Name'), h('span', { class: 'in' }, nameIn)), col, role, info),
    section('Position and rotation', px, py, pz, rx, ry, rz,
      rowBtns(btn('Drop to bed', () => { const p = project.primary; if (p) { project.snapshot(); dropToBed(p); project.emit(); } }), btn('Centre on bed', () => { const p = project.primary; if (p) { project.snapshot(); centerOnBed(p); project.emit(); } }),
        btn('Lay flat (largest face down)', () => layFlat()), snapBtn, btn('Reset', () => { const p = project.primary; if (p) { project.snapshot(); p.object.position.set(0, 0, 0); p.object.rotation.set(0, 0, 0); p.object.scale.set(1, 1, 1); dropToBed(p); project.emit(); } }))),
    section('Size', h('label', { class: 'fld chk' }, h('span', null, 'Uniform scaling'), h('span', { class: 'in' }, uniform)), sx, sy, sz, scalePct, rowBtns(fitBed)),
    section('Combine (boolean)', desc('Union fuses parts, Subtract cuts the others out of the first selected part, Intersect keeps the overlap. Combine by role bakes a custom part: positives are fused into the first selected part, negatives are subtracted, modifiers are left alone.'), rowBtns(boolBtn('Union', 'union'), boolBtn('Subtract', 'difference'), boolBtn('Intersect', 'intersection'), btn('Split by part', splitByPart, { title: 'Divide the first part into the piece inside the second and the piece outside' }), btn('Combine by role', () => combineByRole(), { primary: true }))),
    section('Mirror', rowBtns(mirror([1, 0, 0], 'Mirror X'), mirror([0, 1, 0], 'Mirror Y'), mirror([0, 0, 1], 'Mirror Z'), btn('Mirror copy X', () => { const p = project.primary; if (!p?.manifold) return; runOp('Mirror copy', () => project.bakeTransform(p)!.mirror([1, 0, 0]), (m) => { const b = worldBox(p); const np = project.addManifold(m, `${p.name} mirror`, p.color); np.object.position.x += (b.max.x - b.min.x) + 6; np.object.updateMatrixWorld(); project.emit(); }); }))),
    sectionC('Arrays and copies', desc('Repeat the selected part in a line, grid or circle. Copies become separate parts unless fused.'), arrKind, arrN, arrDx, arrDy, arrDz, arrNx, arrNy, arrSx, arrSy, arrR, arrAxis, arrSweep, arrRot, arrFuse, rowBtns(btn('Make array', makeArray, { primary: true }))),
    sectionC('Align and distribute', desc('Lines up the other selected parts to the first selected one; Distribute spaces three or more parts evenly.'), alignAxis, rowBtns(btn('Align min', () => align('min')), btn('Align centre', () => align('center')), btn('Align max', () => align('max')), btn('Distribute evenly', distribute)),
      rowBtns(btn('Auto-orient for least support', () => { const p = project.primary; if (!p) return; const g = project.worldGeometry(p); const r = autoOrient(g, 45); project.snapshot(); p.object.quaternion.premultiply(r.quaternion); p.object.updateMatrixWorld(); dropToBed(p); centerOnBed(p); project.emit(); toast(`Oriented: ${(r.overhang / 100).toFixed(1)} cm2 needs support, ${(r.contact / 100).toFixed(1)} cm2 on the bed.`, 'good', 5000); }, { primary: true }))),
    sectionC('Deform', desc('Bends, twists or tapers the whole part along an axis. The mesh is refined first so curves stay smooth; lower the density value for finer results.'), defKind, defAmt, defAxis, defRefine,
      rowBtns(btn('Apply deformer', () => { const p = project.primary; if (!p?.manifold) { toast('Select a watertight part.', 'warn'); return; } runOp('Deforming', () => deform(project.bakeTransform(p)!, { kind: defKind.value as any, amount: defAmt.value, axis: defAxis.value as any, refine: defRefine.value, seed: 3 }), (m) => project.replaceManifold(p, m)); }, { primary: true }))),
    sectionC('Shell, offset and rounding', desc('Shell hollows the part leaving a wall (open top makes a box or cup). Offset grows or shrinks the whole surface. Round softens every edge with the given radius. Round and exact offsets work on simple meshes (under 1500 triangles): do them before textures and deformers, or Simplify first.'),
      wall, openSide, rowBtns(btn('Shell (hollow)', () => { const p = project.primary; if (!p?.manifold) { toast('Select a watertight part.', 'warn'); return; } runOp('Shelling', () => shell(project.bakeTransform(p)!, wall.value, openSide.value as any), (m) => project.replaceManifold(p, m)); }, { primary: true })),
      offAmt, rowBtns(btn('Offset surface', () => { const p = project.primary; if (!p?.manifold) { toast('Select a watertight part.', 'warn'); return; } runOp('Offsetting', () => offsetSolid(project.bakeTransform(p)!, offAmt.value), (m) => project.replaceManifold(p, m)); })),
      drainD, drainN, rowBtns(btn('Add drain holes to the floor', () => { const p = project.primary; if (!p?.manifold) { toast('Select a watertight part.', 'warn'); return; } runOp('Drain holes', () => drainHoles(project.bakeTransform(p)!, drainD.value, drainN.value), (m) => project.replaceManifold(p, m)); })),
      roundR, rowBtns(btn('Round all edges', () => { const p = project.primary; if (!p?.manifold) { toast('Select a watertight part.', 'warn'); return; } runOp('Rounding edges', () => roundEdges(project.bakeTransform(p)!, roundR.value), (m) => project.replaceManifold(p, m)); }))),
    sectionC('Mesh tools',
      desc('Bake writes the gizmo transform into the geometry. Repair rewelds a mesh-only part so booleans and textures can run. Simplify merges coplanar detail; Refine splits triangles for smoother textures. Hull wraps the part in its convex hull. Split separates disconnected shells.'),
      rowBtns(
        btn('Bake transform', () => { const p = project.primary; if (!p?.manifold) return; runOp('Bake', () => project.bakeTransform(p)!, (m) => project.replaceManifold(p, m)); }),
        btn('Repair', () => repair()),
        btn('Simplify', () => { const p = project.primary; if (!p?.manifold) return; runOp('Simplify', () => p.manifold!.simplify(0.05), (m) => { project.replaceManifold(p, m); toast(`Simplified to ${m.numTri()} triangles`, 'good'); }); }),
        btn('Refine x2', () => { const p = project.primary; if (!p?.manifold) return; runOp('Refine', () => p.manifold!.refine(2), (m) => project.replaceManifold(p, m)); }),
        btn('Convex hull', () => { const p = project.primary; if (!p?.manifold) return; runOp('Hull', () => project.bakeTransform(p)!.hull(), (m) => project.replaceManifold(p, m)); }),
        btn('Split shells', () => splitShells()),
        btn('Flip inside-out', () => flip()),
      )),
  ) as Panel;

  function combineByRole() {
    const sel2 = project.selected.length > 1 ? project.selected : project.parts.filter((p) => p.visible);
    const base = sel2.find((p) => p.role === 'part'); if (!base) { toast('Select (or show) at least one printed part.', 'warn'); return; }
    const pos = sel2.filter((p) => p !== base && p.role === 'part'), neg = sel2.filter((p) => p.role === 'negative');
    if (!pos.length && !neg.length) { toast('Nothing to combine: add negatives or more parts.', 'info'); return; }
    if ([base, ...pos, ...neg].some((p) => !p.manifold)) { toast('All combined parts must be watertight.', 'bad'); return; }
    runOp('Combine by role', () => { const { Manifold } = M(); let r = project.bakeTransform(base)!; if (pos.length) r = Manifold.union([r, ...pos.map((p) => project.bakeTransform(p)!)]); if (neg.length) r = Manifold.difference([r, ...neg.map((p) => project.bakeTransform(p)!)]); return r; }, (m) => {
      project.snapshot(); project.replaceManifold(base, m, false); project.remove([...pos, ...neg].map((p) => p.id), false); project.select([base.id]); toast(`Combined: ${pos.length} fused, ${neg.length} subtracted.`, 'good');
    });
  }
  function layFlat() {
    const p = project.primary; if (!p) return;
    // choose the triangle cluster with the largest total area per normal direction (quantised) and rotate it to face -Z
    const g = p.object.geometry; const pos = g.getAttribute('position').array as Float32Array; const n = pos.length / 9;
    const buckets = new Map<string, { n: THREE.Vector3; a: number }>(); const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
    const q = p.object.quaternion.clone();
    for (let t = 0; t < n; t++) {
      a.fromArray(pos, t * 9); b.fromArray(pos, t * 9 + 3); c.fromArray(pos, t * 9 + 6);
      nn.subVectors(b, a).cross(c.clone().sub(a)); const area = nn.length() / 2; if (area <= 0) continue; nn.normalize().applyQuaternion(q);
      const key = `${Math.round(nn.x * 10)},${Math.round(nn.y * 10)},${Math.round(nn.z * 10)}`;
      const e = buckets.get(key); if (e) { e.a += area; e.n.add(nn.clone().multiplyScalar(area)); } else buckets.set(key, { n: nn.clone().multiplyScalar(area), a: area });
    }
    let best: { n: THREE.Vector3; a: number } | null = null; for (const v of buckets.values()) if (!best || v.a > best.a) best = v;
    if (!best) return; project.snapshot();
    const from = best.n.normalize(), to = new THREE.Vector3(0, 0, -1);
    const rot = new THREE.Quaternion().setFromUnitVectors(from, to);
    p.object.quaternion.premultiply(rot); p.object.updateMatrixWorld(); dropToBed(p); project.emit();
  }
  async function repair() {
    const p = project.primary; if (!p) return;
    const res = await busy('Repairing mesh', () => geometryToManifold(p.object.geometry));
    if (res.manifold) { project.snapshot(); p.manifold = res.manifold; p.manifoldError = undefined; p.object.geometry.dispose(); p.object.geometry = manifoldToGeometry(res.manifold); project.setFaceColors(p, null); project.emit(); toast(`Repaired: ${res.manifold.numTri()} triangles, watertight`, 'good'); }
    else toast(`Could not make "${p.name}" watertight (${res.error}). Try "Convex hull" for a rough fix or re-export the mesh from its source.`, 'bad', 7000);
  }
  function splitShells() {
    const p = project.primary; if (!p?.manifold) { toast('Needs a watertight part.', 'warn'); return; }
    const pieces = project.bakeTransform(p)!.decompose(); if (pieces.length < 2) { toast('Part is a single shell.', 'info'); return; }
    project.snapshot(); project.remove([p.id], false); pieces.forEach((m, i) => project.addManifold(m, `${p.name} shell ${i + 1}`, p.color, false)); toast(`Split into ${pieces.length} shells`, 'good');
  }
  function flip() {
    const p = project.primary; if (!p) return; project.snapshot();
    const g = p.object.geometry; const pos = g.getAttribute('position').array as Float32Array;
    for (let t = 0; t < pos.length; t += 9) for (let k = 0; k < 3; k++) { const tmp = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = tmp; }
    g.getAttribute('position').needsUpdate = true; g.computeVertexNormals();
    const res = geometryToManifold(g); if (res.manifold) { p.manifold = res.manifold; p.manifoldError = undefined; } project.emit();
  }

  el.refresh = () => {
    list.innerHTML = '';
    for (const p of project.parts) {
      const sel = project.selection.includes(p.id);
      const li = h('li', { class: sel ? 'sel' : '', onClick: (e: MouseEvent) => project.select([p.id], e.shiftKey) },
        h('span', { class: 'sw', style: { background: p.color } }),
        h('span', null, p.name, p.role !== 'part' ? h('span', { class: `pill ${p.role === 'negative' ? 'bad' : ''}`, style: { marginLeft: '6px' } }, p.role) : null, h('div', { class: 'meta' }, `${(p.object.geometry.getAttribute('position').count / 3).toLocaleString()} tris${p.manifold ? '' : ' | mesh-only'}${p.faceColors ? ' | painted' : ''}`)),
        h('button', { class: 'sm', title: p.visible ? 'Hide' : 'Show', onClick: (e: MouseEvent) => { e.stopPropagation(); p.visible = !p.visible; project.emit(); } }, p.visible ? 'Hide' : 'Show'),
        h('button', { class: 'sm', title: 'Delete', onClick: (e: MouseEvent) => { e.stopPropagation(); project.remove([p.id]); } }, 'x'),
      );
      list.append(li);
    }
    if (!project.parts.length) list.append(h('li', { style: { color: 'var(--muted)', cursor: 'default' } }, '', 'No parts yet.'));
    quick.style.display = project.parts.length ? 'none' : '';
    const p = project.primary;
    info.innerHTML = '';
    if (p) {
      nameIn.value = p.name; col.value = p.color; role.value = p.role;
      const b = worldBox(p); const s = b.getSize(new THREE.Vector3());
      px.value = +p.object.position.x.toFixed(2); py.value = +p.object.position.y.toFixed(2); pz.value = +p.object.position.z.toFixed(2);
      rx.value = +THREE.MathUtils.radToDeg(p.object.rotation.x).toFixed(1); ry.value = +THREE.MathUtils.radToDeg(p.object.rotation.y).toFixed(1); rz.value = +THREE.MathUtils.radToDeg(p.object.rotation.z).toFixed(1);
      sx.value = +s.x.toFixed(2); sy.value = +s.y.toFixed(2); sz.value = +s.z.toFixed(2);
      const vol = p.manifold ? Math.abs(p.manifold.volume()) * p.object.scale.x * p.object.scale.y * p.object.scale.z : 0;
      const mat = MATERIALS.find((m) => m.id === project.material) ?? MATERIALS[0];
      const grams = (vol / 1000) * mat.density;
      const rows: [string, string][] = [
        ['Triangles', (p.object.geometry.getAttribute('position').count / 3).toLocaleString()],
        ['Watertight', p.manifold ? 'yes' : `no (${p.manifoldError ?? 'unknown'})`],
        ['Size', `${s.x.toFixed(1)} x ${s.y.toFixed(1)} x ${s.z.toFixed(1)} mm`],
      ];
      if (p.manifold) rows.push(['Volume', `${(vol / 1000).toFixed(2)} cm3`], [`Solid weight (${mat.id})`, `${grams.toFixed(1)} g`], ['At 15 % infill, 3 walls', `~${(grams * 0.42).toFixed(1)} g`], ['Surface', `${(p.manifold.surfaceArea() / 100).toFixed(1)} cm2`], ['Genus (holes)', String(p.manifold.genus())]);
      const fits = s.x <= ctx.bedSize[0] && s.y <= ctx.bedSize[1] && s.z <= ctx.bedSize[2];
      rows.push(['Fits bed', fits ? 'yes' : 'NO, too large']);
      for (const [k, v] of rows) info.append(h('dt', null, k), h('dd', null, v));
    } else nameIn.value = '';
  };
  return el;
}
