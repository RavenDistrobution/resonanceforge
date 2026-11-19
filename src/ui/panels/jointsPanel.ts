// Joints panel: parametric connectors placed on surfaces (smart: fuse on one part, cut the mate), plus cut-with-joint.
import * as THREE from 'three';
import { h, btn, num, sel, section, sectionC, desc, rowBtns, icon, toast, check, range, busy } from '../dom';
import { ctx, addPlaced, runOp, requireManifoldPart, worldBox, type Panel } from '../ctx';
import { buildJoint, cutWithJoint, hingeLatch, JOINT_LABELS, DEFAULT_JOINT, type JointKind, type JointParams } from '../../tools/joints';
import { project, type Part } from '../../core/project';
import { M } from '../../core/manifold';
import type { Hit } from '../../viewer/scene';
import type { Manifold } from 'manifold-3d';

export function jointsPanel(): Panel {
  const kind = sel('Joint', Object.entries(JOINT_LABELS).map(([k, v]) => [k, v.label]) as [string, string][], 'peg', () => upd());
  const help = h('p', { class: 'desc' });
  const size = num('Size / diameter', DEFAULT_JOINT.size, { min: 0.5, step: 0.5, unit: 'mm' }), length = num('Length / depth', DEFAULT_JOINT.length, { min: 0.5, step: 0.5, unit: 'mm' });
  const depth = num('Profile depth', DEFAULT_JOINT.depth, { min: 0.5, step: 0.5, unit: 'mm' }), width = num('Width (along)', DEFAULT_JOINT.width, { min: 1, step: 1, unit: 'mm' });
  const tol = sel('Fit tolerance', [['0.1', '0.10 mm tight (press fit)'], ['0.15', '0.15 mm snug'], ['0.2', '0.20 mm normal'], ['0.3', '0.30 mm loose / sliding'], ['0.4', '0.40 mm very loose']], '0.2');
  const chamfer = num('Chamfer', DEFAULT_JOINT.chamfer, { min: 0, step: 0.2, unit: 'mm' }), angle = num('Dovetail angle', DEFAULT_JOINT.angle, { min: 30, max: 85, step: 5, unit: 'deg' }), count = num('Knuckles', DEFAULT_JOINT.count, { min: 2, max: 12, step: 1 });
  const pitch = num('Thread pitch', DEFAULT_JOINT.pitch, { min: 0.8, max: 8, step: 0.25, unit: 'mm' });
  const smart = check('Smart: also cut / fuse the mating part', true);
  const needs: Record<JointKind, string[]> = { peg: ['size', 'length', 'chamfer', 'tol'], squarePeg: ['size', 'length', 'tol'], dowel: ['size', 'length', 'chamfer', 'tol'], dovetail: ['size', 'depth', 'width', 'angle', 'tol'], snap: ['size', 'length', 'width', 'tol'], insert: ['size'], screwHole: ['size', 'length', 'chamfer'], magnet: ['size', 'length'], hinge: ['size', 'length', 'width', 'count', 'tol'], pinHinge: ['size', 'length', 'width', 'tol'], tab: ['size', 'length', 'width', 'tol'], thread: ['size', 'length', 'pitch', 'tol'] };
  const fields: Record<string, HTMLElement> = { size, length, depth, width, tol, chamfer, angle, count, pitch };
  const defaultLabels: Record<string, string> = { size: 'Size / diameter', length: 'Length / depth', depth: 'Profile depth', width: 'Width (along)', tol: 'Fit tolerance', chamfer: 'Chamfer', angle: 'Dovetail angle', count: 'Knuckles', pitch: 'Thread pitch' };
  const labels: Partial<Record<JointKind, Partial<Record<string, string>>>> = { insert: { size: 'Screw size (M2..M5)' }, screwHole: { size: 'Screw size (M2..M6)', length: 'Hole depth', chamfer: 'Countersink (0 = none)' }, magnet: { size: 'Magnet diameter', length: 'Magnet thickness' }, hinge: { size: 'Barrel diameter', length: 'Leaf width', width: 'Hinge length' }, pinHinge: { size: 'Knuckle diameter', length: 'Leaf width', width: 'Hinge length' }, dovetail: { size: 'Neck width', width: 'Rail length' }, snap: { size: 'Hook size', length: 'Beam length', width: 'Clip width' }, tab: { size: 'Tab head diameter', length: 'Tab length', width: 'Tab width' }, thread: { size: 'Major diameter', length: 'Thread length' } };
  function upd() { const k = kind.value as JointKind; help.textContent = JOINT_LABELS[k].help; for (const [n, f] of Object.entries(fields)) { f.style.display = needs[k].includes(n) ? '' : 'none'; f.querySelector('span')!.textContent = labels[k]?.[n] ?? defaultLabels[n]; } }
  const params = (): JointParams => ({ size: size.value, length: length.value, depth: depth.value, width: width.value, tol: parseFloat(tol.value), chamfer: chamfer.value, angle: angle.value, count: count.value, pitch: pitch.value });

  // ---------------- placement
  let placing: null | { what: 'positive' | 'negative'; action: 'add' | 'fuse' | 'cut' } = null;
  const placeHint = h('p', { class: 'note' });
  function startPlace(what: 'positive' | 'negative', action: 'add' | 'fuse' | 'cut') {
    const b = buildJoint(kind.value as JointKind, params()); const body = what === 'positive' ? b.positive : b.negative;
    if (!body) { toast(`${JOINT_LABELS[kind.value as JointKind].label} has no ${what === 'positive' ? 'male body' : 'cutter'}; use the other button or "Add loose parts".`, 'warn'); return; }
    placing = { what, action }; ctx.viewer.setMode('place'); ctx.viewer.onPlace = onPlace;
    placeHint.textContent = `Placing: click a point on ${action === 'add' ? 'any part or the bed' : 'a watertight part'}. Hold Shift to place several. Esc cancels.`;
    toast('Click a part surface to place the joint. Esc cancels.', 'info');
  }
  function stopPlace() { placing = null; ctx.viewer.onPlace = null; ctx.viewer.setMode('select'); placeHint.textContent = ''; }
  function frameAt(hit: Hit, flip = false) {
    const n = hit.normal.clone().normalize(); if (flip) n.negate();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    return new THREE.Matrix4().compose(hit.point, q, new THREE.Vector3(1, 1, 1));
  }
  const mat4 = (m: THREE.Matrix4) => Array.from(m.elements) as unknown as import('manifold-3d').Mat4;
  /** Parts other than `self` whose world box touches `body`'s box and that actually overlap it. */
  function matesFor(body: Manifold, self: Part): Part[] {
    const bb = body.boundingBox(); const box = new THREE.Box3(new THREE.Vector3(...bb.min), new THREE.Vector3(...bb.max)).expandByScalar(0.2);
    return project.parts.filter((p) => p !== self && p.visible && p.manifold && worldBox(p).intersectsBox(box)).filter((p) => { const baked = project.bakeTransform(p)!; const i = M().Manifold.intersection(baked, body); const ok = !i.isEmpty() && i.volume() > 1e-3; i.delete(); return ok; });
  }
  async function onPlace(hit: Hit) {
    if (!placing) return;
    const { what, action } = placing;
    const b = buildJoint(kind.value as JointKind, params()); const body = what === 'positive' ? b.positive : b.negative; if (!body) return;
    const frame = frameAt(hit);
    const placed = body.transform(mat4(frame));
    if (action === 'add') { const p = project.addManifold(placed, `${JOINT_LABELS[kind.value as JointKind].label} ${what === 'positive' ? '' : 'cutter'}`.trim(), what === 'positive' ? '#1baf7a' : '#e34948'); if (what === 'negative') project.setRole(p, 'negative', false); project.select([p.id]); }
    else {
      const target = hit.part; if (!target.manifold) { toast('Target must be watertight.', 'bad'); return; }
      try {
        await busy(action === 'fuse' ? 'Fusing joint' : 'Cutting joint', async () => {
          const { Manifold } = M();
          project.snapshot();
          const base = project.bakeTransform(target)!;
          const result = action === 'fuse' ? Manifold.union(base, placed) : Manifold.difference(base, placed);
          if (result.status() !== 'NoError') throw new Error(result.status());
          project.replaceManifold(target, result, false);
          let mated = 0;
          if (smart.value) {
            // the mating body is the opposite half of the joint, pointing the other way through the surface
            const other = action === 'fuse' ? b.negative : (b.positive ?? b.negative); // pockets (magnets) mirror into the mate so both halves align
            if (other) {
              const otherPlaced = other.mirror([0, 0, 1]).transform(mat4(frame)); // mirrored so it runs into the mate on the far side of the surface
              const probe = action === 'fuse' ? placed : otherPlaced; // where the male body lives decides who gets the socket
              for (const mate of matesFor(probe, target)) {
                const mb = project.bakeTransform(mate)!;
                const mr = action === 'fuse' ? Manifold.difference(mb, otherPlaced) : Manifold.union(mb, otherPlaced);
                if (mr.status() === 'NoError' && !mr.isEmpty()) { project.replaceManifold(mate, mr, false); mated++; }
              }
            }
          }
          project.select([target.id]);
          toast(mated ? `${action === 'fuse' ? 'Peg fused' : 'Socket cut'}; matching ${action === 'fuse' ? 'socket cut into' : b.positive ? 'peg fused onto' : 'pocket mirrored into'} ${mated} mating part(s).` : `${action === 'fuse' ? 'Joint fused' : 'Socket cut'}${smart.value ? ' (no mating part found at that spot)' : ''}.`, 'good', 4500);
        });
      } catch (e: any) { toast(`Joint failed: ${e.message}`, 'bad'); }
    }
    if (!(window.event as KeyboardEvent | undefined)?.shiftKey) stopPlace();
  }

  // ---------------- cut with joint
  const axis = sel('Cut axis', [['z', 'Z (horizontal slice)'], ['x', 'X (vertical, across width)'], ['y', 'Y (vertical, across depth)']], 'z', () => { cutPos.value = 50; updatePlane(); });
  const cutPos = range('Cut position', 50, { min: 0, max: 100, step: 0.5, unit: ' %', onInput: () => updatePlane() });
  const cutMm = num('Cut at', 0, { step: 0.5, unit: 'mm', onChange: (v) => { const r = axisRange(); if (!r) return; cutPos.value = ((v - r[0]) / (r[1] - r[0] || 1)) * 100; updatePlane(false); } });
  const connector = sel('Connector', [['peg', 'Pegs (fused on one side, sockets on the other)'], ['squarePeg', 'Square keys'], ['dowel', 'Dowel pins (sockets both sides, loose pins)'], ['thread', 'Screw-on thread (male stud + female socket)'], ['magnet', 'Magnet pockets (aligned on both faces)'], ['none', 'None (plain cut)']], 'peg', () => updCut());
  const cPitch = num('Thread pitch', 2.5, { min: 0.8, max: 8, step: 0.25, unit: 'mm' }), cFloor = num('Magnet floor (hidden)', 0.4, { min: 0, step: 0.2, unit: 'mm' });
  const cutHelp = h('p', { class: 'desc' });
  function updCut() { const c = connector.value; cPitch.style.display = c === 'thread' ? '' : 'none'; cFloor.style.display = c === 'magnet' ? '' : 'none'; cCount.style.display = c === 'thread' || c === 'none' ? 'none' : ''; cSize.querySelector('span')!.textContent = c === 'magnet' ? 'Magnet diameter' : c === 'thread' ? 'Thread major diameter' : 'Connector size'; cLen.querySelector('span')!.textContent = c === 'magnet' ? 'Magnet thickness' : c === 'thread' ? 'Thread length' : 'Connector length'; cutHelp.textContent = c === 'thread' ? 'One centred helical thread: stud on part A, socket in part B. Use a major diameter at least 10 mm and pitch 2 to 4 mm; 0.3 mm tolerance turns smoothly.' : c === 'magnet' ? 'Pockets on both cut faces at the same spots, each covered by a thin floor so magnets are glued in from the cut side and hidden. Alternate polarity when inserting.' : ''; }
  const cCount = num('Connectors', 2, { min: 1, max: 8, step: 1 }), cSize = num('Connector size', 5, { min: 1, step: 0.5, unit: 'mm' }), cLen = num('Connector length', 6, { min: 1, step: 0.5, unit: 'mm' });
  const cTol = sel('Fit tolerance', [['0.1', '0.10 mm tight'], ['0.15', '0.15 mm snug'], ['0.2', '0.20 mm normal'], ['0.3', '0.30 mm loose']], '0.15');
  const cGap = num('Separate pieces by', 0, { min: 0, step: 1, unit: 'mm' });
  const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x2a78d6, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
  const planeEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x2a78d6 }));
  planeMesh.add(planeEdge); planeMesh.renderOrder = 5; let planeShown = false;
  const cutInfo = h('p', { class: 'note' });
  function axisRange(): [number, number] | null { const p = project.primary; if (!p) return null; const b = worldBox(p); const a = axis.value as 'x' | 'y' | 'z'; return [b.min[a], b.max[a]]; }
  function updatePlane(syncMm = true) {
    const p = project.primary; if (!p) { hidePlane(); cutInfo.textContent = 'Select a part to cut.'; return; }
    const b = worldBox(p); const a = axis.value as 'x' | 'y' | 'z'; const r: [number, number] = [b.min[a], b.max[a]];
    const at = r[0] + ((r[1] - r[0]) * cutPos.value) / 100; if (syncMm) cutMm.value = +at.toFixed(2);
    const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3()).multiplyScalar(1.15).addScalar(4);
    planeMesh.rotation.set(0, 0, 0); planeMesh.position.copy(c);
    if (a === 'z') { planeMesh.scale.set(s.x, s.y, 1); planeMesh.position.z = at; }
    else if (a === 'x') { planeMesh.rotation.y = Math.PI / 2; planeMesh.scale.set(s.z, s.y, 1); planeMesh.position.x = at; }
    else { planeMesh.rotation.x = Math.PI / 2; planeMesh.scale.set(s.x, s.z, 1); planeMesh.position.y = at; }
    if (!planeShown) { ctx.viewer.scene.add(planeMesh); planeShown = true; }
    cutInfo.textContent = `Cut ${p.name} at ${a.toUpperCase()} = ${at.toFixed(2)} mm (${(at - r[0]).toFixed(1)} mm from its ${a === 'z' ? 'bottom' : 'min side'}, ${(r[1] - at).toFixed(1)} mm to the other side).`;
  }
  function hidePlane() { if (planeShown) { ctx.viewer.scene.remove(planeMesh); planeShown = false; } }
  function applyCut() {
    const p = requireManifoldPart('Cut'); if (!p) return;
    const r = axisRange()!; const at = r[0] + ((r[1] - r[0]) * cutPos.value) / 100;
    runOp('Cutting part', () => { const res = cutWithJoint(project.bakeTransform(p)!, { axis: axis.value as any, offset: at, connector: connector.value as any, count: cCount.value, size: cSize.value, length: cLen.value, tol: parseFloat(cTol.value), chamfer: 0.6, gap: cGap.value, pitch: cPitch.value, floor: cFloor.value }); (window as any).__lastCut = res; return res.lower; }, (lower) => {
      const res = (window as any).__lastCut as ReturnType<typeof cutWithJoint>; delete (window as any).__lastCut;
      project.snapshot();
      const a = project.addManifold(lower, `${p.name} A`, p.color, false); const bPart = project.addManifold(res.upper, `${p.name} B`, p.color, false);
      for (const e of res.extra) addPlaced(e.m, e.name, '#1baf7a');
      project.remove([p.id], false); project.select([a.id, bPart.id]); hidePlane();
      toast(`Cut into two parts with ${res.positions.length} connector(s). Move part B with the gizmo to check the fit; undo restores the original.`, 'good', 5000);
    });
  }

  // ---------------- hinge & latch between two parts
  const hSide = sel('Hinge side', [['+y', 'Back (+Y)'], ['-y', 'Front (-Y)'], ['+x', 'Right (+X)'], ['-x', 'Left (-X)']], '+y');
  const hLevel = sel('Hinge height', [['seam', 'At the seam between the parts'], ['top', 'Top of the lower part'], ['custom', 'Custom (mm below)']], 'seam');
  const hLevelMm = num('Custom height', 10, { step: 0.5, unit: 'mm' });
  const hBarrel = num('Barrel diameter', 6, { min: 3, step: 0.5, unit: 'mm' }), hKn = num('Knuckles', 5, { min: 2, max: 15, step: 1 }), hTol = sel('Clearance', [['0.25', '0.25 mm'], ['0.3', '0.30 mm (print-in-place default)'], ['0.4', '0.40 mm']], '0.3');
  const hLatch = sel('Latch (opposite side)', [['snap', 'Snap hook tab'], ['none', 'None']], 'snap'); const hLatchW = num('Latch width', 10, { min: 4, step: 1, unit: 'mm' });
  function addHingeLatch() {
    const sel2 = project.selected; if (sel2.length !== 2) { toast('Select exactly two parts: the base first, then the lid (shift-click).', 'warn'); return; }
    const [A, B] = sel2; if (!A.manifold || !B.manifold) { toast('Both parts must be watertight.', 'bad'); return; }
    const bA = worldBox(A), bB = worldBox(B);
    const seam = Math.max(bA.min.z, bB.min.z) <= Math.min(bA.max.z, bB.max.z) ? (Math.max(bA.min.z, bB.min.z) + Math.min(bA.max.z, bB.max.z)) / 2 : (bA.max.z + bB.min.z) / 2;
    const level = hLevel.value === 'seam' ? seam : hLevel.value === 'top' ? bA.max.z : hLevelMm.value;
    runOp('Building hinge and latch', () => { const { Manifold } = M(); const r = hingeLatch({ side: hSide.value as any, level, barrel: hBarrel.value, knuckles: hKn.value, tol: parseFloat(hTol.value), latch: hLatch.value as any, latchWidth: hLatchW.value, boxA: { min: bA.min.toArray() as any, max: bA.max.toArray() as any }, boxB: { min: bB.min.toArray() as any, max: bB.max.toArray() as any } });
      let a = Manifold.union(project.bakeTransform(A)!, r.addA); if (r.cutA) a = Manifold.difference(a, r.cutA);
      let b = Manifold.union(project.bakeTransform(B)!, r.addB); if (r.cutB) b = Manifold.difference(b, r.cutB);
      (window as any).__hl = b; return a; }, (a) => {
      const b = (window as any).__hl as Manifold; delete (window as any).__hl; project.snapshot(); project.replaceManifold(A, a, false); project.replaceManifold(B, b, false); project.select([A.id, B.id]); toast(`Hinge with ${hKn.value} knuckles added on the ${hSide.value} side${hLatch.value !== 'none' ? ' and a snap latch opposite' : ''}. Print in place; the lid rotates about the barrel.`, 'good', 6000);
    });
  }

  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-bolt'), 'Joints and connectors'),
    desc('Pick a connector, set its size and fit tolerance, then click a surface to place it. With Smart on, fusing a peg onto one part also cuts the matching socket into whatever part it meets, and cutting a socket also fuses the peg onto the mate. Cut with joint splits a part along a plane and adds matching connectors across the cut.'),
    section('Connector', kind, help, size, length, depth, width, angle, count, chamfer, tol, smart),
    section('Place on a surface', desc('The joint axis aligns with the surface normal at the click point.'),
      rowBtns(btn('Fuse peg onto part', () => startPlace('positive', 'fuse'), { primary: true }), btn('Cut socket into part', () => startPlace('negative', 'cut'), { primary: true })),
      rowBtns(btn('Add positive as new part', () => startPlace('positive', 'add')), btn('Add cutter as negative part', () => startPlace('negative', 'add'), { title: 'Editable negative: subtracted on export or Parts > Combine by role' })), placeHint),
    section('Cut part with joint', desc('Select a part, choose the axis and drag the position: the blue plane in the viewport shows the cut. Apply to get parts A and B with pegs or dowels already placed across the cut face.'),
      axis, cutPos, cutMm, connector, cutHelp, cCount, cSize, cLen, cPitch, cFloor, cTol, cGap, cutInfo,
      rowBtns(btn('Show cut plane', () => updatePlane()), btn('Apply cut', applyCut, { primary: true }), btn('Hide plane', () => hidePlane()))),
    section('Hinge and latch between two parts', desc('Select the base part, then shift-click the lid. A print-in-place barrel hinge is built on the chosen side (knuckles alternate between the parts, pin on the lid) and a snap latch on the opposite side. Works best on a part you cut horizontally with Cut part with joint.'),
      hSide, hLevel, hLevelMm, hBarrel, hKn, hTol, hLatch, hLatchW, rowBtns(btn('Add hinge and latch', addHingeLatch, { primary: true }))),
    sectionC('Loose parts', desc('Hinges, pins and dowels generate separate printable parts next to the scene.'),
      rowBtns(btn('Add loose parts', () => { const b = buildJoint(kind.value as JointKind, params()); const extra = b.extra ?? []; if (!extra.length && b.positive) extra.push({ name: JOINT_LABELS[kind.value as JointKind].label, m: b.positive }); if (!extra.length) { toast('Nothing loose for this joint type.', 'info'); return; } project.snapshot(); for (const e of extra) addPlaced(e.m, e.name, '#1baf7a'); }))),
    sectionC('Fit guide', h('ul', { class: 'lg-how' },
      h('li', null, 'Press fit (no movement): 0.1 mm per side. Pins print slightly oversize; drill or ream if needed.'),
      h('li', null, 'Snug (hand assemble, no wobble): 0.15 to 0.2 mm. Default for most pegs and dovetails.'),
      h('li', null, 'Sliding or rotating: 0.3 to 0.4 mm. Hinges and drawers.'),
      h('li', null, 'Holes shrink about 0.1 to 0.3 mm in FDM. Horizontal holes also flatten; print round holes vertical when you can.'),
      h('li', null, 'Heat-set inserts: hole 0.2 to 0.4 mm under the insert OD, depth insert length plus 0.5 mm.'))),
  ) as Panel;
  el.deactivate = () => { stopPlace(); hidePlane(); };
  el.refresh = () => { if (planeShown) updatePlane(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && placing) stopPlace(); });
  upd(); updCut();
  return el;
}
