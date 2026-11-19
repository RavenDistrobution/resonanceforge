// Parametric prefabs: ready-made multi-part objects (chests, jars, baskets, trays...) built from the same engine as the tools.
import type { Manifold } from 'manifold-3d';
import { M } from '../core/manifold';
import { threadSolid, hingeLatch } from './joints';

export interface ParamDef { key: string; label: string; def: number; min?: number; max?: number; step?: number; unit?: string }
export interface PrefabPart { name: string; m: Manifold; color?: string }
export interface Prefab { id: string; label: string; help: string; params: ParamDef[]; build: (p: Record<string, number>) => PrefabPart[] }

const P = (key: string, label: string, def: number, step = 1, unit = 'mm', min = 0.2, max?: number): ParamDef => ({ key, label, def, step, unit, min, max });
const rounded = (w: number, d: number, r: number) => { const { CrossSection } = M(); return r > 0 ? CrossSection.square([w - 2 * r, d - 2 * r], true).offset(r, 'Round', 2, 16) : CrossSection.square([w, d], true); };
/** Box shell (rounded corners) open on top or bottom. */
function openBox(w: number, d: number, h: number, wall: number, r: number, open: 'top' | 'bottom'): Manifold {
  const { Manifold } = M(); const outer = rounded(w, d, r).extrude(h); const inner = rounded(w - 2 * wall, d - 2 * wall, Math.max(0, r - wall)).extrude(h).translate(0, 0, open === 'top' ? wall : -wall);
  return Manifold.difference(outer, inner);
}
function cup(dia: number, h: number, wall: number): Manifold { const { Manifold } = M(); return Manifold.difference(Manifold.cylinder(h, dia / 2, dia / 2, 96, false), Manifold.cylinder(h, dia / 2 - wall, dia / 2 - wall, 96, false).translate(0, 0, wall)); }
/** Jar body with an external thread on the neck, and a matching screw lid printed right side up. */
function screwJar(dia: number, h: number, wall: number, pitch: number, threadLen: number, lidWall: number, tol: number) {
  const { Manifold } = M();
  const bodyH = h - threadLen; const body = Manifold.cylinder(bodyH, dia / 2, dia / 2, 96, false);
  const neck = threadSolid(dia, pitch, threadLen, 0).translate(0, 0, bodyH - 0.01);
  const bore = Manifold.cylinder(h, dia / 2 - wall - pitch * 0.55, dia / 2 - wall - pitch * 0.55, 96, false).translate(0, 0, wall);
  const jar = Manifold.difference(Manifold.union(body, neck), bore);
  const lidH = threadLen + lidWall + 1; const lidOD = dia + 2 * tol + 2 * lidWall;
  const lid = Manifold.difference(Manifold.cylinder(lidH, lidOD / 2, lidOD / 2, 96, false), threadSolid(dia, pitch, threadLen + 1.5, tol).translate(0, 0, lidWall));
  // grip ribs on the lid
  const ribs: Manifold[] = []; for (let i = 0; i < 24; i++) ribs.push(Manifold.cube([1.2, 2.2, lidH - 2], true).rotate(0, 0, (360 / 24) * i).translate(Math.cos((Math.PI * 2 * i) / 24) * (lidOD / 2), Math.sin((Math.PI * 2 * i) / 24) * (lidOD / 2), lidH / 2));
  return { jar, lid: Manifold.union([lid, ...ribs]) };
}

export const PREFABS: Prefab[] = [
  { id: 'chest', label: 'Chest with hinged lid and latch', help: 'Box base and lid joined by a print-in-place barrel hinge at the back and a snap latch at the front. Printed as two parts in place; the lid swings open.',
    params: [P('w', 'Width', 80), P('d', 'Depth', 50), P('h', 'Total height', 50), P('wall', 'Wall', 2, 0.2), P('lid', 'Lid height', 15), P('r', 'Corner radius', 4, 0.5)],
    build: (p) => { const { Manifold } = M(); const baseH = p.h - p.lid; const base = openBox(p.w, p.d, baseH, p.wall, p.r, 'top'); const lid = openBox(p.w, p.d, p.lid, p.wall, p.r, 'bottom').translate(0, 0, baseH + 0.3);
      const r = hingeLatch({ side: '+y', level: baseH + 0.15, barrel: 6, knuckles: Math.max(3, Math.round(p.w / 16) | 1), tol: 0.3, latch: 'snap', latchWidth: Math.min(14, p.w / 4), boxA: { min: [-p.w / 2, -p.d / 2, 0], max: [p.w / 2, p.d / 2, baseH] }, boxB: { min: [-p.w / 2, -p.d / 2, baseH + 0.3], max: [p.w / 2, p.d / 2, p.h + 0.3] } });
      let a = Manifold.union(base, r.addA); if (r.cutA) a = Manifold.difference(a, r.cutA); const b = Manifold.union(lid, r.addB);
      return [{ name: 'Chest base', m: a }, { name: 'Chest lid', m: b, color: '#eb6834' }]; } },
  { id: 'jar', label: 'Jar with screw lid', help: 'Cylindrical jar with an external thread on the neck and a ribbed screw cap. Coarse thread prints without support.',
    params: [P('dia', 'Diameter', 60), P('h', 'Height', 70), P('wall', 'Wall', 1.6, 0.2), P('pitch', 'Thread pitch', 3, 0.25), P('thread', 'Thread length', 10), P('tol', 'Thread clearance', 0.3, 0.05)],
    build: (p) => { const { jar, lid } = screwJar(p.dia, p.h, p.wall, p.pitch, p.thread, 2, p.tol); return [{ name: 'Jar', m: jar }, { name: 'Jar lid', m: lid, color: '#eb6834' }]; } },
  { id: 'basket', label: 'Basket with holes and screw lid', help: 'Vented container: rows of round holes around the wall and a drain grid in the floor, plus a screw lid. Good for drying, rinsing, or small-part bins.',
    params: [P('dia', 'Diameter', 70), P('h', 'Height', 80), P('wall', 'Wall', 1.6, 0.2), P('hole', 'Hole diameter', 5, 0.5), P('gap', 'Hole spacing', 10), P('pitch', 'Thread pitch', 3, 0.25), P('thread', 'Thread length', 10)],
    build: (p) => { const { Manifold } = M(); const { jar, lid } = screwJar(p.dia, p.h, p.wall, p.pitch, p.thread, 2, 0.3);
      const cutters: Manifold[] = []; const bodyH = p.h - p.thread; const rows = Math.max(1, Math.floor((bodyH - p.wall - p.hole - 4) / p.gap)); const perRow = Math.max(4, Math.floor((Math.PI * p.dia) / p.gap));
      for (let r = 0; r < rows; r++) { const z = p.wall + p.hole / 2 + 3 + r * p.gap; for (let i = 0; i < perRow; i++) { const a = (360 / perRow) * (i + (r % 2) * 0.5); cutters.push(Manifold.cylinder(p.dia, p.hole / 2, p.hole / 2, 20, false).rotate(90, 0, 0).translate(0, p.dia / 2, 0).rotate(0, 0, a).translate(0, 0, z)); } }
      const n = Math.floor((p.dia - 2 * p.wall - p.hole) / p.gap); for (let i = -n / 2; i <= n / 2; i++) for (let j = -n / 2; j <= n / 2; j++) { const x = i * p.gap, y = j * p.gap; if (Math.hypot(x, y) < p.dia / 2 - p.wall - p.hole) cutters.push(Manifold.cylinder(p.wall + 2, p.hole / 2, p.hole / 2, 20, false).translate(x, y, -1)); }
      return [{ name: 'Basket', m: Manifold.difference(jar, Manifold.union(cutters)) }, { name: 'Basket lid', m: lid, color: '#eb6834' }]; } },
  { id: 'tray', label: 'Divider tray (compartments)', help: 'Open tray split into a grid of compartments. Drawer organiser, parts sorter, tea box.',
    params: [P('w', 'Width', 120), P('d', 'Depth', 80), P('h', 'Height', 30), P('wall', 'Wall', 1.6, 0.2), P('nx', 'Columns', 3, 1, '', 1, 12), P('ny', 'Rows', 2, 1, '', 1, 12), P('r', 'Corner radius', 3, 0.5)],
    build: (p) => { const { Manifold } = M(); let tray = openBox(p.w, p.d, p.h, p.wall, p.r, 'top'); const divs: Manifold[] = [];
      for (let i = 1; i < p.nx; i++) divs.push(Manifold.cube([p.wall, p.d - 2 * p.wall + 0.2, p.h - p.wall - 2], true).translate(-p.w / 2 + (p.w / p.nx) * i, 0, (p.h - p.wall - 2) / 2 + p.wall - 0.01));
      for (let j = 1; j < p.ny; j++) divs.push(Manifold.cube([p.w - 2 * p.wall + 0.2, p.wall, p.h - p.wall - 2], true).translate(0, -p.d / 2 + (p.d / p.ny) * j, (p.h - p.wall - 2) / 2 + p.wall - 0.01));
      if (divs.length) tray = Manifold.union([tray, ...divs]); return [{ name: 'Divider tray', m: tray }]; } },
  { id: 'slidebox', label: 'Box with sliding lid', help: 'Box with grooves near the top; the lid slides in from one end and has a finger notch.',
    params: [P('w', 'Width', 60), P('d', 'Length', 90), P('h', 'Height', 30), P('wall', 'Wall', 2, 0.2), P('tol', 'Lid clearance', 0.25, 0.05)],
    build: (p) => { const { Manifold } = M(); const lidT = 2; const groove = 1.5;
      let box = openBox(p.w, p.d, p.h, p.wall, 0, 'top');
      const slot = Manifold.cube([p.w - 2 * p.wall + 2 * groove, p.d + 2, lidT + 2 * p.tol], true).translate(0, 0, p.h - p.wall - lidT / 2 - 1); // grooves along both long walls, open at the ends
      box = Manifold.difference(box, Manifold.intersection(slot, Manifold.cube([p.w - 2 * p.wall + 2 * groove, p.d - p.wall + 0.01, lidT + 2 * p.tol], true).translate(0, p.wall / 2, p.h - p.wall - lidT / 2 - 1)));
      box = Manifold.difference(box, Manifold.cube([p.w - 2 * p.wall + 2 * groove, p.wall + 2, p.wall + lidT + 2 * p.tol + 1], true).translate(0, p.d / 2 - p.wall / 2, p.h - (p.wall + lidT + 2 * p.tol + 1) / 2 - 1 + 1)); // open end
      const lid = Manifold.difference(Manifold.cube([p.w - 2 * p.wall + 2 * groove - 2 * p.tol, p.d - p.wall - p.tol, lidT], true).translate(0, 0, lidT / 2), Manifold.cylinder(lidT + 2, 8, 8, 32, false).translate(0, p.d / 2 - p.wall - 6, -1));
      return [{ name: 'Sliding box', m: box }, { name: 'Sliding lid', m: lid.translate(p.w + 10, 0, 0), color: '#eb6834' }]; } },
  { id: 'holder', label: 'Holder block (grid of holes)', help: 'Block with a grid of round pockets: bit holder, pen stand, test-tube rack, paint-bottle tray.',
    params: [P('hole', 'Hole diameter', 7, 0.5), P('depth', 'Hole depth', 20), P('nx', 'Columns', 5, 1, '', 1, 30), P('ny', 'Rows', 3, 1, '', 1, 30), P('gap', 'Spacing', 12), P('margin', 'Edge margin', 4), P('base', 'Floor', 3)],
    build: (p) => { const { Manifold } = M(); const w = p.margin * 2 + (p.nx - 1) * p.gap + p.hole, d = p.margin * 2 + (p.ny - 1) * p.gap + p.hole, h = p.depth + p.base;
      const holes: Manifold[] = []; for (let i = 0; i < p.nx; i++) for (let j = 0; j < p.ny; j++) holes.push(Manifold.cylinder(p.depth + 1, p.hole / 2, p.hole / 2, 32, false).translate(-w / 2 + p.margin + p.hole / 2 + i * p.gap, -d / 2 + p.margin + p.hole / 2 + j * p.gap, p.base));
      return [{ name: 'Holder block', m: Manifold.difference(rounded(w, d, 3).extrude(h), Manifold.union(holes)) }]; } },
  { id: 'planter', label: 'Planter pot with saucer', help: 'Tapered pot with drainage holes and a matching saucer.',
    params: [P('dia', 'Top diameter', 90), P('h', 'Height', 85), P('wall', 'Wall', 2, 0.2), P('taper', 'Bottom diameter %', 75, 5, '%', 40, 100), P('holes', 'Drain holes', 5, 1, '', 1, 12)],
    build: (p) => { const { Manifold } = M(); const rb = (p.dia / 2) * (p.taper / 100); const outer = Manifold.cylinder(p.h, rb, p.dia / 2, 96, false); const inner = Manifold.cylinder(p.h, rb - p.wall, p.dia / 2 - p.wall, 96, false).translate(0, 0, p.wall);
      const holes: Manifold[] = []; for (let i = 0; i < p.holes; i++) { const a = (Math.PI * 2 * i) / p.holes; holes.push(Manifold.cylinder(p.wall + 2, 3, 3, 24, false).translate(Math.cos(a) * rb * 0.5, Math.sin(a) * rb * 0.5, -1)); }
      const pot = Manifold.difference(Manifold.difference(outer, inner), Manifold.union(holes)); const sd = rb * 2 + 16; const saucer = cup(sd, 14, 2).translate(p.dia + 20, 0, 0);
      return [{ name: 'Planter', m: pot }, { name: 'Saucer', m: saucer, color: '#8d6e63' }]; } },
  { id: 'phonestand', label: 'Phone stand', help: 'Angled back rest with a front lip and a charging-cable slot. Prints flat, no supports.',
    params: [P('w', 'Width', 70), P('angle', 'Back angle', 65, 5, 'deg', 40, 85), P('lip', 'Lip height', 12), P('t', 'Thickness', 4, 0.5), P('backL', 'Back length', 90)],
    build: (p) => { const { Manifold, CrossSection } = M(); const a = (p.angle * Math.PI) / 180; const baseL = 70; const x0 = Math.min(0, 12 - Math.cos(a) * p.backL - 6);
      const base = CrossSection.square([baseL - x0, p.t]).translate(x0, 0);
      const lip = CrossSection.square([p.t, p.lip + p.t]).translate(baseL - p.t, 0);
      const d = [-Math.cos(a), Math.sin(a)], n = [Math.sin(a) * p.t, Math.cos(a) * p.t]; const p0 = [12, 0];
      const back = new CrossSection([[[p0[0], p0[1]], [p0[0] + d[0] * p.backL, p0[1] + d[1] * p.backL], [p0[0] + d[0] * p.backL + n[0], p0[1] + d[1] * p.backL + n[1]], [p0[0] + n[0], p0[1] + n[1]]]]);
      const gusset = new CrossSection([[[12 + n[0], p.t], [12 + n[0] + 18, p.t], [12 + n[0] + d[0] * 22, p.t + d[1] * 22]]]);
      const prof = CrossSection.union([base, lip, back, gusset]);
      const body = prof.extrude(p.w).rotate(90, 0, 0).translate(-(baseL + x0) / 2, p.w / 2, 0);
      const slot = Manifold.cube([16, 30, p.t + 2], true).translate(-(baseL + x0) / 2 + 12 + 8, 0, p.t / 2);
      return [{ name: 'Phone stand', m: Manifold.difference(body, slot) }]; } },
  { id: 'hook', label: 'Wall hook', help: 'Screw-mounted J hook with two countersunk holes. Printed flat on its back plate; the arm stands up.',
    params: [P('w', 'Width', 25), P('plate', 'Plate height', 60), P('reach', 'Hook reach', 30), P('t', 'Thickness', 5, 0.5), P('screw', 'Screw hole', 4, 0.5)],
    build: (p) => { const { Manifold } = M();
      const plate = Manifold.cube([p.w, p.plate, p.t], true).translate(0, p.plate / 2, p.t / 2);
      const arm = Manifold.cube([p.w, p.t, p.reach], true).translate(0, p.plate - p.t / 2, p.reach / 2);
      const tip = Manifold.cube([p.w, 12 + p.t, p.t], true).translate(0, p.plate - p.t / 2 + 6, p.reach - p.t / 2);
      let hook = Manifold.union([plate, arm, tip]);
      for (const y of [10, p.plate - p.t - 12]) { const hole = Manifold.cylinder(p.t + 2, p.screw / 2, p.screw / 2, 24, false).translate(0, y, -1); const sink = Manifold.cylinder(p.screw * 0.6, p.screw / 2, p.screw, 24, false).translate(0, y, p.t - p.screw * 0.6 + 0.01); hook = Manifold.difference(hook, Manifold.union(hole, sink)); }
      return [{ name: 'Wall hook', m: hook }]; } },
  { id: 'battery', label: 'Battery tray', help: 'Horizontal cradles for AA, AAA or 18650 cells with finger cutouts. Cell type: 1 = AAA, 2 = AA, 3 = 18650.',
    params: [P('type', 'Cell type (1 AAA, 2 AA, 3 18650)', 2, 1, '', 1, 3), P('n', 'Cells', 4, 1, '', 1, 20), P('wall', 'Wall', 2, 0.2)],
    build: (p) => { const { Manifold } = M(); const cell = [null, [10.7, 45], [14.8, 51], [18.8, 66]][Math.round(p.type)] as [number, number]; const [cd, cl] = cell; const pitch = cd + p.wall; const w = p.n * pitch + p.wall, d = cl + 2 * p.wall, h = cd * 0.75 + p.wall;
      let tray = rounded(w, d, 2).extrude(h); const cuts: Manifold[] = [];
      for (let i = 0; i < p.n; i++) { const x = -w / 2 + p.wall + cd / 2 + i * pitch; cuts.push(Manifold.cylinder(cl, cd / 2 + 0.2, cd / 2 + 0.2, 40, false).rotate(-90, 0, 0).translate(x, -cl / 2, p.wall + cd / 2)); cuts.push(Manifold.cube([cd * 0.6, 12, h], true).translate(x, 0, h)); }
      return [{ name: `Battery tray (${['', 'AAA', 'AA', '18650'][Math.round(p.type)]})`, m: Manifold.difference(tray, Manifold.union(cuts)) }]; } },
  { id: 'funnel', label: 'Funnel', help: 'Cone with a spout; wall thickness and spout size adjustable.',
    params: [P('top', 'Top diameter', 90), P('spout', 'Spout diameter', 12), P('h', 'Cone height', 60), P('spoutL', 'Spout length', 30), P('wall', 'Wall', 1.6, 0.2)],
    build: (p) => { const { CrossSection } = M(); const rs = p.spout / 2, rt = p.top / 2; const prof: [number, number][] = [[rs, 0], [rs + p.wall, 0], [rs + p.wall, p.spoutL], [rt + p.wall, p.spoutL + p.h], [rt, p.spoutL + p.h], [rs, p.spoutL]];
      return [{ name: 'Funnel', m: new CrossSection([prof]).revolve(96) }]; } }, // Manifold revolve already outputs with Z as the axis
  { id: 'cup', label: 'Pencil cup', help: 'Simple cylinder cup. Add a texture or a pattern afterwards.',
    params: [P('dia', 'Diameter', 75), P('h', 'Height', 100), P('wall', 'Wall', 1.6, 0.2)],
    build: (p) => [{ name: 'Pencil cup', m: cup(p.dia, p.h, p.wall) }] },
  { id: 'bracket', label: 'Shelf bracket (L with gusset)', help: 'Right-angle bracket with a triangular gusset and screw holes on both legs.',
    params: [P('leg', 'Leg length', 80), P('w', 'Width', 25), P('t', 'Thickness', 5, 0.5), P('screw', 'Screw hole', 4.5, 0.5)],
    build: (p) => { const { Manifold, CrossSection } = M(); const a = Manifold.cube([p.w, p.leg, p.t], true).translate(0, p.leg / 2, p.t / 2); const b = Manifold.cube([p.w, p.t, p.leg], true).translate(0, p.t / 2, p.leg / 2);
      // gusset drawn in (y, z), extruded along x, then axes permuted so it stands in the corner between the legs
      const toYZ = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1] as unknown as import('manifold-3d').Mat4;
      const gusset = new CrossSection([[[p.t, p.t], [p.leg * 0.8, p.t], [p.t, p.leg * 0.8]]]).extrude(p.t).transform(toYZ).translate(-p.t / 2, 0, 0);
      let br = Manifold.union([a, b, gusset]);
      for (const y of [p.leg * 0.35, p.leg * 0.8]) br = Manifold.difference(br, Manifold.cylinder(p.t + 2, p.screw / 2, p.screw / 2, 24, false).translate(0, y, -1));
      for (const z of [p.leg * 0.35, p.leg * 0.8]) br = Manifold.difference(br, Manifold.cylinder(p.t + 2, p.screw / 2, p.screw / 2, 24, false).rotate(-90, 0, 0).translate(0, -1, z));
      return [{ name: 'Shelf bracket', m: br }]; } },
];

// ---------------------------------------------------------------- more complex prefabs ----------------------------------------------------------------
function hexCs(acrossFlats: number) { const { CrossSection } = M(); const r = acrossFlats / Math.sqrt(3); const pts: [number, number][] = []; for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; pts.push([r * Math.cos(a), r * Math.sin(a)]); } return new CrossSection([pts]); }

PREFABS.push(
  { id: 'enclosure', label: 'Electronics enclosure (standoffs, vents)', help: 'Project box for a circuit board: base with four screw standoffs at the board hole spacing, lid with vent slots and a cable cutout. Give the board size and hole spacing.',
    params: [P('bw', 'Board width', 65), P('bd', 'Board depth', 56), P('hx', 'Hole spacing X', 58), P('hy', 'Hole spacing Y', 49), P('h', 'Inner height', 25), P('wall', 'Wall', 2, 0.2), P('standoff', 'Standoff height', 5), P('screw', 'Screw hole', 2.5, 0.25)],
    build: (p) => { const { Manifold } = M(); const w = p.bw + 2 * p.wall + 6, d = p.bd + 2 * p.wall + 6; const baseH = p.h + p.wall;
      let base = openBox(w, d, baseH, p.wall, 3, 'top'); const posts: Manifold[] = []; const holes: Manifold[] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const x = (sx * p.hx) / 2, y = (sy * p.hy) / 2; posts.push(Manifold.cylinder(p.standoff, p.screw / 2 + 2, p.screw / 2 + 2, 32, false).translate(x, y, p.wall - 0.01)); holes.push(Manifold.cylinder(p.standoff + 1, p.screw / 2, p.screw / 2, 24, false).translate(x, y, p.wall + 0.5)); }
      base = Manifold.difference(Manifold.union([base, ...posts]), Manifold.union(holes));
      base = Manifold.difference(base, Manifold.cube([14, p.wall + 2, 8], true).translate(0, d / 2 - p.wall / 2, baseH - 4 + 0.01)); // cable notch at the back
      const lipH = 3; let lid = openBox(w, d, p.wall + lipH, p.wall, 3, 'bottom'); lid = Manifold.union(lid, rounded(w - 2 * p.wall - 0.4, d - 2 * p.wall - 0.4, 2).extrude(lipH).translate(0, 0, 0)); lid = Manifold.difference(lid, rounded(w - 4 * p.wall - 0.4, d - 4 * p.wall - 0.4, 1).extrude(lipH).translate(0, 0, -0.01));
      const vents: Manifold[] = []; for (let i = -3; i <= 3; i++) vents.push(Manifold.cube([w * 0.5, 1.6, p.wall + 2], true).translate(0, i * 4, lipH + p.wall / 2));
      lid = Manifold.difference(lid, Manifold.union(vents));
      return [{ name: 'Enclosure base', m: base }, { name: 'Enclosure lid', m: lid.translate(w + 10, 0, 0), color: '#eb6834' }]; } },
  { id: 'drawer', label: 'Drawer unit (cabinet + drawers)', help: 'Open-front cabinet with stacked drawers, each with a pull handle. Drawers print separately and slide in.',
    params: [P('w', 'Width', 80), P('d', 'Depth', 100), P('dh', 'Drawer height', 30), P('n', 'Drawers', 2, 1, '', 1, 6), P('wall', 'Wall', 1.6, 0.2), P('tol', 'Slide clearance', 0.4, 0.1)],
    build: (p) => { const { Manifold } = M(); const H = p.n * (p.dh + p.wall) + p.wall; let cab = Manifold.cube([p.w, p.d, H], true).translate(0, 0, H / 2);
      const slots: Manifold[] = []; for (let i = 0; i < p.n; i++) slots.push(Manifold.cube([p.w - 2 * p.wall, p.d, p.dh], true).translate(0, -p.wall / 2 - 0.5, p.wall + p.dh / 2 + i * (p.dh + p.wall)));
      cab = Manifold.difference(cab, Manifold.union(slots)); const parts: PrefabPart[] = [{ name: 'Cabinet', m: cab }];
      for (let i = 0; i < p.n; i++) { const dw = p.w - 2 * p.wall - 2 * p.tol, dd = p.d - p.wall - p.tol - 1, dhh = p.dh - 2 * p.tol; let dr = openBox(dw, dd, dhh, p.wall, 1, 'top'); const handle = Manifold.cube([Math.min(30, dw * 0.5), 3, 6], true).translate(0, -dd / 2 - 1.5 + 0.01, dhh - 6); dr = Manifold.union(dr, handle); parts.push({ name: `Drawer ${i + 1}`, m: dr.translate(p.w + 10, -(i * (dd + 8)), 0), color: '#eb6834' }); }
      return parts; } },
  { id: 'clamp', label: 'C-clamp with threaded screw', help: 'C frame with a threaded boss, plus a screw with a swivel pad and a T knob. Tighten by hand.',
    params: [P('open', 'Jaw opening', 40), P('depth', 'Throat depth', 40), P('t', 'Frame thickness', 8), P('w', 'Frame width', 12), P('screw', 'Screw diameter', 10, 0.5), P('pitch', 'Thread pitch', 2.5, 0.25)],
    build: (p) => { const { Manifold, CrossSection } = M(); const H = p.open + 2 * p.t + 12, D = p.depth + p.t;
      const frame = Manifold.difference(Manifold.cube([D, p.w, H], true).translate(D / 2, 0, H / 2), Manifold.cube([p.depth + 1, p.w + 2, p.open + 12], true).translate(p.depth / 2 - 0.5 + p.t, 0, H / 2));
      const boss = Manifold.cylinder(12, p.screw / 2 + 4, p.screw / 2 + 4, 48, false).translate(p.t + p.depth * 0.5, 0, H - p.t - 12 + 0.01);
      const framed = Manifold.difference(Manifold.union(frame, boss), threadSolid(p.screw, p.pitch, p.t + 14, 0.3).translate(p.t + p.depth * 0.5, 0, H - p.t - 12 - 1));
      const rodL = p.open + p.t + 20; const rod = threadSolid(p.screw, p.pitch, rodL, 0); const knob = Manifold.cube([30, 6, 6], true).translate(0, 0, rodL + 3 - 0.01); const pad = Manifold.cylinder(3, p.screw / 2 + 3, p.screw / 2 + 2, 32, false).translate(0, 0, -3 + 0.01);
      const screw = Manifold.union([rod, knob, pad]);
      return [{ name: 'Clamp frame', m: framed.rotate(0, 0, 0) }, { name: 'Clamp screw', m: screw.translate(D + 25, 0, 3), color: '#eb6834' }]; } },
  { id: 'spool', label: 'Filament spool holder', help: 'Two A-frame stands and an axle for a spool. Axle diameter and length set the spool clearance.',
    params: [P('axle', 'Axle diameter', 20), P('len', 'Axle length', 90), P('h', 'Stand height', 70), P('base', 'Stand base width', 90)],
    build: (p) => { const { Manifold, CrossSection } = M(); const prof = new CrossSection([[[-p.base / 2, 0], [p.base / 2, 0], [12, p.h], [-12, p.h]]]); let stand = prof.extrude(12).rotate(90, 0, 0).translate(0, 6, 0);
      stand = Manifold.difference(stand, Manifold.union(Manifold.cylinder(14, p.axle / 2 + 0.5, p.axle / 2 + 0.5, 48, false).rotate(-90, 0, 0).translate(0, -7, p.h - p.axle / 2 - 4), Manifold.cube([p.axle + 1, 14, p.axle], true).translate(0, 0, p.h - 4)));
      stand = Manifold.difference(stand, Manifold.cube([p.base * 0.5, 14, p.h * 0.45], true).translate(0, 0, p.h * 0.3)); // weight-saving window
      const axle = Manifold.cylinder(p.len, p.axle / 2, p.axle / 2, 64, false);
      return [{ name: 'Spool stand A', m: stand }, { name: 'Spool stand B', m: stand.translate(0, p.len * 0.9, 0) }, { name: 'Spool axle', m: axle.rotate(0, 90, 0).translate(p.base / 2 + 20, 0, p.axle / 2), color: '#eb6834' }]; } },
  { id: 'spinner', label: 'Fidget spinner (608 bearings)', help: 'Tri-lobe spinner with pockets for standard 608 bearings (22 mm) and two button caps.',
    params: [P('lobes', 'Lobes', 3, 1, '', 2, 5), P('t', 'Thickness', 7, 0.5), P('tol', 'Bearing fit', 0.15, 0.05)],
    build: (p) => { const { Manifold, CrossSection } = M(); const R = 22 / 2 + p.tol; const arm = 22; const n = Math.round(p.lobes); const lobes: InstanceType<typeof CrossSection>[] = [CrossSection.circle(R + 4, 64)];
      for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n; lobes.push(CrossSection.circle(R + 4, 64).translate(Math.cos(a) * arm, Math.sin(a) * arm)); lobes.push(CrossSection.square([arm, (R + 4) * 1.4], true).rotate((a * 180) / Math.PI).translate((Math.cos(a) * arm) / 2, (Math.sin(a) * arm) / 2)); }
      let body = CrossSection.union(lobes).offset(2, 'Round', 2, 16).offset(-2, 'Round', 2, 16).extrude(p.t);
      const pockets: Manifold[] = [Manifold.cylinder(p.t + 2, R, R, 64, false).translate(0, 0, -1)]; for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n; pockets.push(Manifold.cylinder(p.t + 2, R, R, 64, false).translate(Math.cos(a) * arm, Math.sin(a) * arm, -1)); }
      body = Manifold.difference(body, Manifold.union(pockets));
      const cap = Manifold.union(Manifold.cylinder(2, 10, 10, 48, false), Manifold.cylinder(3.5, 3.9, 3.9, 32, false).translate(0, 0, 2));
      return [{ name: 'Spinner body', m: body }, { name: 'Button cap A', m: cap.translate(60, 0, 0), color: '#eb6834' }, { name: 'Button cap B', m: cap.translate(85, 0, 0), color: '#eb6834' }]; } },
  { id: 'dice', label: 'Dice (d6 with pips)', help: 'Rounded cube with recessed pips laid out as a standard die (opposite faces sum to seven).',
    params: [P('size', 'Size', 16), P('round', 'Edge rounding', 2, 0.5), P('pip', 'Pip diameter', 3, 0.25)],
    build: (p) => { const { Manifold } = M(); const s = p.size, f = p.round; const pts: Manifold[] = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(Manifold.sphere(f, 16).translate(sx * (s / 2 - f), sy * (s / 2 - f), sz * (s / 2 - f)));
      let die = Manifold.hull(pts); const o = s * 0.27; const layouts: Record<number, [number, number][]> = { 1: [[0, 0]], 2: [[-o, -o], [o, o]], 3: [[-o, -o], [0, 0], [o, o]], 4: [[-o, -o], [o, o], [-o, o], [o, -o]], 5: [[-o, -o], [o, o], [-o, o], [o, -o], [0, 0]], 6: [[-o, -o], [o, o], [-o, o], [o, -o], [-o, 0], [o, 0]] };
      const faces: { n: number; rot: [number, number, number] }[] = [{ n: 1, rot: [0, 0, 0] }, { n: 6, rot: [180, 0, 0] }, { n: 2, rot: [90, 0, 0] }, { n: 5, rot: [-90, 0, 0] }, { n: 3, rot: [0, -90, 0] }, { n: 4, rot: [0, 90, 0] }];
      const pips: Manifold[] = []; for (const f2 of faces) for (const [u, v] of layouts[f2.n]) pips.push(Manifold.sphere(p.pip / 2, 16).translate(u, v, s / 2 + p.pip * 0.15).rotate(f2.rot));
      die = Manifold.difference(die, Manifold.union(pips)); return [{ name: 'Die d6', m: die.translate(0, 0, s / 2) }]; } },
  { id: 'wheel', label: 'Spoked wheel', help: 'Wheel with a rim, hub bore and radial spokes. For carts, robots, toys.',
    params: [P('dia', 'Diameter', 60), P('w', 'Width', 10), P('rim', 'Rim thickness', 4), P('bore', 'Axle bore', 5, 0.5), P('spokes', 'Spokes', 6, 1, '', 3, 16)],
    build: (p) => { const { Manifold } = M(); const R = p.dia / 2; const rim = Manifold.difference(Manifold.cylinder(p.w, R, R, 96, false), Manifold.cylinder(p.w + 2, R - p.rim, R - p.rim, 96, false).translate(0, 0, -1));
      const hub = Manifold.difference(Manifold.cylinder(p.w, p.bore / 2 + 4, p.bore / 2 + 4, 48, false), Manifold.cylinder(p.w + 2, p.bore / 2 + 0.15, p.bore / 2 + 0.15, 32, false).translate(0, 0, -1));
      const sp: Manifold[] = []; for (let i = 0; i < p.spokes; i++) sp.push(Manifold.cube([R - p.rim - p.bore / 2 - 2, 3, p.w * 0.7], true).translate((R - p.rim + p.bore / 2 + 2) / 2, 0, p.w / 2).rotate(0, 0, (360 / p.spokes) * i));
      return [{ name: 'Spoked wheel', m: Manifold.union([rim, hub, ...sp]) }]; } },
  { id: 'pegboard', label: 'Pegboard hook', help: 'Hook for standard 1/4 inch pegboard with 1 inch spacing: two pegs on the back, straight arm in front.',
    params: [P('reach', 'Arm length', 40), P('t', 'Arm thickness', 5, 0.5), P('tip', 'Tip height', 8)],
    build: (p) => { const { Manifold } = M(); const peg = 6, spacing = 25.4; const plate = Manifold.cube([12, p.t, spacing + 14], true).translate(0, p.t / 2, (spacing + 14) / 2);
      const pegs = [0, 1].map((i) => Manifold.cylinder(6, peg / 2, peg / 2, 24, false).rotate(90, 0, 0).translate(0, 0, 7 + i * spacing)); const bend = Manifold.cube([12, 6, p.t], true).translate(0, -3, spacing + 14 - p.t / 2 + 0.01);
      const arm = Manifold.cube([12, p.reach, p.t], true).translate(0, p.t + p.reach / 2 - 0.01, 7 + p.t / 2); const tip = Manifold.cube([12, p.t, p.tip], true).translate(0, p.t + p.reach - p.t / 2, 7 + p.tip / 2);
      const hook = Manifold.union([plate, ...pegs, bend, arm, tip]); return [{ name: 'Pegboard hook', m: hook.rotate(90, 0, 0).translate(0, 0, 0).translate(0, 0, p.t) }]; } },
  { id: 'soap', label: 'Soap dish with drain slots', help: 'Shallow dish with raised ribs and drain slots so bars dry.',
    params: [P('w', 'Width', 100), P('d', 'Depth', 70), P('h', 'Height', 18), P('wall', 'Wall', 2, 0.2)],
    build: (p) => { const { Manifold } = M(); let dish = openBox(p.w, p.d, p.h, p.wall, 6, 'top'); const slots: Manifold[] = []; const ribs: Manifold[] = [];
      for (let x = -p.w / 2 + 12; x < p.w / 2 - 10; x += 8) { slots.push(Manifold.cube([3, p.d - 2 * p.wall - 10, p.wall + 2], true).translate(x, 0, p.wall / 2)); ribs.push(Manifold.cube([2, p.d - 2 * p.wall - 4, 4], true).translate(x + 4, 0, p.wall + 2 - 0.01)); }
      dish = Manifold.union([Manifold.difference(dish, Manifold.union(slots)), ...ribs]); return [{ name: 'Soap dish', m: dish }]; } },
  { id: 'comb', label: 'Cable comb / organiser', help: 'Desk-edge comb with rounded slots that hold cables.',
    params: [P('n', 'Slots', 5, 1, '', 1, 16), P('cable', 'Cable diameter', 5, 0.5), P('t', 'Thickness', 10), P('h', 'Height', 22)],
    build: (p) => { const { Manifold } = M(); const pitch = p.cable + 6; const w = p.n * pitch + 6; let base = Manifold.cube([w, p.t, p.h], true).translate(0, 0, p.h / 2);
      const cuts: Manifold[] = []; for (let i = 0; i < p.n; i++) { const x = -w / 2 + 3 + pitch / 2 + i * pitch; cuts.push(Manifold.cylinder(p.t + 2, p.cable / 2 + 0.3, p.cable / 2 + 0.3, 32, false).rotate(90, 0, 0).translate(x, p.t / 2 + 1, p.h - p.cable / 2 - 4)); cuts.push(Manifold.cube([p.cable * 0.75, p.t + 2, 6], true).translate(x, 0, p.h - 1)); }
      return [{ name: 'Cable comb', m: Manifold.difference(base, Manifold.union(cuts)) }]; } },
  { id: 'vase', label: 'Twisted vase (spiral)', help: 'Polygonal vase twisted along its height. Slice in vase / spiral mode with a single wall, or keep the built-in wall.',
    params: [P('dia', 'Diameter', 70), P('h', 'Height', 120), P('sides', 'Sides', 6, 1, '', 3, 24), P('twist', 'Twist', 90, 5, 'deg', 0, 360), P('wall', 'Wall', 1.2, 0.2), P('flare', 'Top scale %', 120, 5, '%', 50, 200)],
    build: (p) => { const { Manifold, CrossSection } = M(); const n = Math.round(p.sides); const pts: [number, number][] = []; for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n; pts.push([(p.dia / 2) * Math.cos(a), (p.dia / 2) * Math.sin(a)]); }
      const cs = new CrossSection([pts]); const div = Math.max(12, Math.ceil(p.h / 2)); const outer = cs.extrude(p.h, div, p.twist, p.flare / 100); const inner = cs.offset(-p.wall, 'Miter', 2, 8).extrude(p.h, div, p.twist, p.flare / 100).translate(0, 0, p.wall * 1.5);
      return [{ name: 'Twisted vase', m: Manifold.difference(outer, inner) }]; } },
  { id: 'lampshade', label: 'Lampshade (perforated)', help: 'Tapered shade with a pattern of round perforations and a top ring for an E27 / E14 fitting.',
    params: [P('top', 'Top diameter', 60), P('bottom', 'Bottom diameter', 140), P('h', 'Height', 120), P('wall', 'Wall', 1.6, 0.2), P('hole', 'Hole diameter', 6, 0.5), P('fitting', 'Fitting hole', 40)],
    build: (p) => { const { Manifold } = M(); const rt = p.top / 2, rb = p.bottom / 2; const outer = Manifold.cylinder(p.h, rb, rt, 96, false); const inner = Manifold.cylinder(p.h, rb - p.wall, rt - p.wall, 96, false).translate(0, 0, -0.01);
      let shade = Manifold.difference(outer, inner); shade = Manifold.union(shade, Manifold.difference(Manifold.cylinder(p.wall, rt, rt, 96, false).translate(0, 0, p.h - p.wall), Manifold.cylinder(p.wall + 2, p.fitting / 2, p.fitting / 2, 64, false).translate(0, 0, p.h - p.wall - 1)));
      const holes: Manifold[] = []; const rows = Math.floor((p.h - 20) / (p.hole * 2)); for (let r = 0; r < rows; r++) { const z = 12 + r * p.hole * 2; const rad = rb + (rt - rb) * (z / p.h); const nn = Math.max(6, Math.floor((2 * Math.PI * rad) / (p.hole * 2))); for (let i = 0; i < nn; i++) { const a = (360 / nn) * (i + (r % 2) * 0.5); holes.push(Manifold.cylinder(rad + 5, p.hole / 2, p.hole / 2, 16, false).rotate(90, 0, 0).translate(0, 0, 0).rotate(0, 0, a).translate(0, 0, z).translate(0, 0, 0)); } }
      return [{ name: 'Lampshade', m: Manifold.difference(shade, Manifold.union(holes)) }]; } },
  { id: 'toolbox', label: 'Toolbox (chest with handle)', help: 'Hinged chest with a carry handle on the lid and a latch at the front.',
    params: [P('w', 'Width', 140), P('d', 'Depth', 80), P('h', 'Total height', 70), P('wall', 'Wall', 2.4, 0.2), P('lid', 'Lid height', 22)],
    build: (p) => { const { Manifold } = M(); const chest = PREFABS.find((x) => x.id === 'chest')!.build({ w: p.w, d: p.d, h: p.h, wall: p.wall, lid: p.lid, r: 4 });
      const handle = Manifold.union([Manifold.cube([Math.min(80, p.w * 0.5), 10, 6], true).translate(0, 0, p.h + 0.3 + 18), Manifold.cube([8, 10, 20], true).translate(-Math.min(80, p.w * 0.5) / 2 + 4, 0, p.h + 0.3 + 10 - 0.01), Manifold.cube([8, 10, 20], true).translate(Math.min(80, p.w * 0.5) / 2 - 4, 0, p.h + 0.3 + 10 - 0.01)]);
      return [chest[0], { name: 'Toolbox lid', m: Manifold.union(chest[1].m, handle), color: '#eb6834' }]; } },
);

// ---------------------------------------------------------------- round three ----------------------------------------------------------------
PREFABS.push(
  { id: 'hsw', label: 'Honeycomb storage wall tile', help: 'Hex-grid wall panel (20 mm cells, 1.8 mm walls, 8 mm deep) compatible with honeycomb storage wall hooks. Add the matching hook prefab.',
    params: [P('cols', 'Columns', 6, 1, '', 1, 20), P('rows', 'Rows', 5, 1, '', 1, 20), P('depth', 'Depth', 8), P('screw', 'Screw holes', 1, 1, '', 0, 1)],
    build: (p) => { const { Manifold, CrossSection } = M(); const cell = 20.0, wall = 1.8, pitch = cell + wall; const rowH = pitch * Math.sqrt(3) / 2; const W = p.cols * pitch + pitch / 2, H = p.rows * rowH + cell / 2;
      const hex = (): [number, number][] => { const r = cell / Math.sqrt(3); const pts: [number, number][] = []; for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i + Math.PI / 6; pts.push([r * Math.cos(a), r * Math.sin(a)]); } return pts; };
      const holes: Manifold[] = []; for (let j = 0; j < p.rows; j++) for (let i = 0; i < p.cols; i++) { const x = -W / 2 + pitch / 2 + i * pitch + (j % 2 ? pitch / 2 : 0) + wall / 2, y = -H / 2 + cell / 2 + j * rowH + wall; holes.push(new CrossSection([hex()]).extrude(p.depth + 2).translate(x, y, -1)); }
      let tile = Manifold.difference(CrossSection.square([W, H], true).extrude(p.depth), Manifold.union(holes));
      if (p.screw >= 1) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tile = Manifold.difference(tile, Manifold.union(Manifold.cylinder(p.depth + 2, 2, 2, 24, false).translate(sx * (W / 2 - 8), sy * (H / 2 - 8), -1), Manifold.cylinder(2.5, 2, 4.5, 24, false).translate(sx * (W / 2 - 8), sy * (H / 2 - 8), p.depth - 2.5 + 0.01)));
      return [{ name: `HSW tile ${p.cols}x${p.rows}`, m: tile }]; } },
  { id: 'hswhook', label: 'Honeycomb wall hook (twist-lock)', help: 'Twist-in insert that locks into a honeycomb wall cell, with a hook arm. Insert, turn 30 degrees.',
    params: [P('reach', 'Hook reach', 35), P('w', 'Hook width', 15), P('t', 'Arm thickness', 5, 0.5)],
    build: (p) => { const { Manifold, CrossSection } = M(); const r = 20 / Math.sqrt(3) - 0.25; const pts: [number, number][] = []; for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i + Math.PI / 6; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
      const insert = new CrossSection([pts]).extrude(6); const lock = Manifold.cube([2 * r + 5, 7, 2.4], true).translate(0, 0, 7.2); // wider bar behind the panel (print flat; it passes the cell diagonally then locks when turned)
      const neck = Manifold.cube([8, 8, 2.4], true).translate(0, 0, 7.2 - 1.2 + 0.01); void neck;
      const flange = Manifold.cylinder(2.4, r + 4, r + 4, 48, false).translate(0, 0, -2.4);
      const arm = Manifold.cube([p.w, p.reach, p.t], true).translate(0, p.reach / 2 + r - 2, -2.4 - p.t / 2 + 0.01); const tip = Manifold.cube([p.w, p.t, 12], true).translate(0, p.reach + r - 2 - p.t / 2, -2.4 - 6 + 0.01);
      const hook = Manifold.union([insert, lock, flange, arm, tip]); return [{ name: 'HSW hook', m: hook.rotate(180, 0, 0).translate(0, 0, 9.6 + 0.01) }]; } },
  { id: 'magnetbox', label: 'Box with magnet-latched lid', help: 'Lidded box with pockets for 6 x 2 mm disc magnets in the rim and the lid, hidden under a thin floor.',
    params: [P('w', 'Width', 70), P('d', 'Depth', 50), P('h', 'Height', 35), P('wall', 'Wall', 3, 0.2), P('lid', 'Lid height', 8), P('mag', 'Magnet diameter', 6, 0.5), P('magT', 'Magnet thickness', 2, 0.5)],
    build: (p) => { const { Manifold } = M(); const baseH = p.h - p.lid; let base = openBox(p.w, p.d, baseH, p.wall, 3, 'top'); let lid = openBox(p.w, p.d, p.lid, p.wall, 3, 'bottom');
      lid = Manifold.union(lid, rounded(p.w - 2 * p.wall - 0.5, p.d - 2 * p.wall - 0.5, 1).extrude(3).translate(0, 0, -3 + 0.01).translate(0, 0, 0)); lid = Manifold.difference(lid, rounded(p.w - 4 * p.wall, p.d - 4 * p.wall, 1).extrude(3.2).translate(0, 0, -3.1));
      const pts: [number, number][] = [[-p.w / 2 + p.wall / 2, 0], [p.w / 2 - p.wall / 2, 0]]; const floor = 0.6;
      for (const [x, y] of pts) { base = Manifold.difference(base, Manifold.cylinder(p.magT + 0.2, p.mag / 2 + 0.15, p.mag / 2 + 0.15, 32, false).translate(x, y, baseH - floor - p.magT - 0.2)); lid = Manifold.difference(lid, Manifold.cylinder(p.magT + 0.2, p.mag / 2 + 0.15, p.mag / 2 + 0.15, 32, false).translate(x, y, floor)); }
      return [{ name: 'Magnet box base', m: base }, { name: 'Magnet box lid', m: lid.translate(p.w + 10, 0, 3), color: '#eb6834' }]; } },
  { id: 'lidbox', label: 'Box with friction-fit lid', help: 'Plain lidded box; the lid has an inner lip that grips the box walls.',
    params: [P('w', 'Width', 60), P('d', 'Depth', 40), P('h', 'Height', 30), P('wall', 'Wall', 2, 0.2), P('lipH', 'Lip height', 4), P('tol', 'Lip clearance', 0.15, 0.05)],
    build: (p) => { const { Manifold } = M(); const base = openBox(p.w, p.d, p.h, p.wall, 2, 'top');
      let lid = rounded(p.w, p.d, 2).extrude(p.wall); const lip = Manifold.difference(rounded(p.w - 2 * p.wall - 2 * p.tol, p.d - 2 * p.wall - 2 * p.tol, 1).extrude(p.lipH), rounded(p.w - 4 * p.wall - 2 * p.tol, p.d - 4 * p.wall - 2 * p.tol, 0.5).extrude(p.lipH + 2).translate(0, 0, -1)); lid = Manifold.union(lid, lip.translate(0, 0, p.wall - 0.01));
      return [{ name: 'Box', m: base }, { name: 'Friction lid', m: lid.translate(p.w + 10, 0, 0), color: '#eb6834' }]; } },
  { id: 'livinghinge', label: 'Living hinge strip (flex panel)', help: 'Flat panel with staggered lattice slots so it bends. Print in PETG, PP or nylon for best flex.',
    params: [P('w', 'Width', 80), P('d', 'Length (bend direction)', 60), P('t', 'Thickness', 1.6, 0.2), P('slot', 'Slot length', 12), P('gap', 'Slot pitch', 3, 0.5)],
    build: (p) => { const { Manifold } = M(); let panel = Manifold.cube([p.w, p.d, p.t], true).translate(0, 0, p.t / 2); const cuts: Manifold[] = []; const rows = Math.floor(p.d / p.gap);
      for (let r = 0; r < rows; r++) { const y = -p.d / 2 + p.gap / 2 + r * p.gap; const off = r % 2 ? (p.slot + 3) / 2 : 0; for (let x = -p.w / 2 - p.slot + off; x < p.w / 2 + p.slot; x += p.slot + 3) { if (x > -p.w / 2 + 2 || true) cuts.push(Manifold.cube([p.slot, 0.8, p.t + 2], true).translate(x + p.slot / 2, y, p.t / 2)); } }
      panel = Manifold.difference(panel, Manifold.intersection(Manifold.union(cuts), Manifold.cube([p.w - 6, p.d - 6, p.t + 4], true).translate(0, 0, p.t / 2))); return [{ name: 'Living hinge strip', m: panel }]; } },
  { id: 'frame', label: 'Picture frame with stand', help: 'Frame with a rear slot for a photo and an easel-style back stand.',
    params: [P('pw', 'Photo width', 100), P('ph', 'Photo height', 150), P('border', 'Border', 12), P('t', 'Frame thickness', 6, 0.5)],
    build: (p) => { const { Manifold } = M(); const W = p.pw + 2 * p.border, H = p.ph + 2 * p.border; let frame = rounded(W, H, 3).extrude(p.t);
      frame = Manifold.difference(frame, Manifold.cube([p.pw - 8, p.ph - 8, p.t + 2], true).translate(0, 0, p.t / 2)); // window
      frame = Manifold.difference(frame, Manifold.cube([p.pw + 1, p.ph + 1, 1.6], true).translate(0, 0, p.t - 0.8 + 0.01)); // photo pocket at the back
      frame = Manifold.difference(frame, Manifold.cube([p.pw + 1, p.border + 2, 1.6], true).translate(0, -H / 2 + 0.5, p.t - 0.8 + 0.01)); // slide-in slot at the bottom
      const stand = Manifold.cube([30, 4, H * 0.7], true).translate(0, 0, H * 0.35);
      return [{ name: 'Frame', m: frame }, { name: 'Frame stand', m: stand.translate(W / 2 + 25, 0, 0), color: '#eb6834' }]; } },
  { id: 'headphone', label: 'Headphone stand', help: 'Weighted base, post and curved cradle for a headset.',
    params: [P('h', 'Height', 220), P('base', 'Base diameter', 120), P('cradle', 'Cradle width', 70), P('post', 'Post thickness', 12)],
    build: (p) => { const { Manifold } = M(); const base = Manifold.cylinder(8, p.base / 2, p.base / 2 - 2, 96, false); const post = Manifold.cube([p.post, 30, p.h - 8], true).translate(0, 0, (p.h - 8) / 2 + 8 - 0.01);
      const cradle = Manifold.difference(Manifold.cylinder(30, p.cradle / 2, p.cradle / 2, 64, false).rotate(90, 0, 0).translate(0, 15, p.h - p.cradle / 2 + 10), Manifold.cylinder(34, p.cradle / 2 - 8, p.cradle / 2 - 8, 64, false).rotate(90, 0, 0).translate(0, 17, p.h - p.cradle / 2 + 10));
      const top = Manifold.intersection(cradle, Manifold.cube([p.cradle + 2, 40, p.cradle / 2 + 2], true).translate(0, 0, p.h + 10 - p.cradle / 4 + 2));
      return [{ name: 'Headphone stand', m: Manifold.union([base, post, top]) }]; } },
  { id: 'winder', label: 'Cord winder (figure 8)', help: 'Flat winder with two notched ends to wrap earbuds or charging cables.',
    params: [P('len', 'Length', 70), P('w', 'Width', 30), P('t', 'Thickness', 4, 0.5)],
    build: (p) => { const { Manifold, CrossSection } = M(); const body = rounded(p.len, p.w, p.w / 2 - 0.1).extrude(p.t);
      const notch = (x: number) => CrossSection.circle(p.w / 2 - 6, 48).translate(x, 0).extrude(p.t + 2).translate(0, 0, -1);
      const slit = Manifold.cube([3, p.w + 2, p.t + 2], true); return [{ name: 'Cord winder', m: Manifold.difference(body, Manifold.union([notch(-p.len / 2 + 4), notch(p.len / 2 - 4), slit.translate(0, p.w / 2 - 3, p.t / 2), slit.translate(0, -p.w / 2 + 3, p.t / 2)])) }]; } },
  { id: 'plantlabel', label: 'Plant label stake', help: 'Pointed stake with a flat label area; engrave a name with the Text panel.',
    params: [P('w', 'Label width', 50), P('lh', 'Label height', 20), P('stake', 'Stake length', 60), P('t', 'Thickness', 2.4, 0.2)],
    build: (p) => { const { CrossSection } = M(); const prof: [number, number][] = [[-p.w / 2, 0], [p.w / 2, 0], [p.w / 2, p.lh], [4, p.lh], [4, p.lh + 4], [0, p.lh + 4 + p.stake], [-4, p.lh + 4], [-4, p.lh], [-p.w / 2, p.lh]];
      return [{ name: 'Plant label', m: new CrossSection([prof], 'NonZero').extrude(p.t) }]; } },
  { id: 'tealight', label: 'Tea light holder', help: 'Cup for a standard 38 mm tea light with a ring of decorative holes for the glow.',
    params: [P('h', 'Height', 45), P('wall', 'Wall', 2, 0.2), P('hole', 'Hole diameter', 6, 0.5), P('holes', 'Holes per ring', 8, 1, '', 3, 24), P('rings', 'Rings', 2, 1, '', 1, 5)],
    build: (p) => { const { Manifold } = M(); const R = 39 / 2 + p.wall; let cupM = cup(2 * R, p.h, p.wall); const holes: Manifold[] = [];
      for (let r = 0; r < p.rings; r++) for (let i = 0; i < p.holes; i++) { const a = (360 / p.holes) * (i + (r % 2) * 0.5); holes.push(Manifold.cylinder(R + 4, p.hole / 2, p.hole / 2, 20, false).rotate(90, 0, 0).rotate(0, 0, a).translate(0, 0, 12 + r * ((p.h - 20) / Math.max(1, p.rings - 1 || 1)))); }
      return [{ name: 'Tea light holder', m: Manifold.difference(cupM, Manifold.union(holes)) }]; } },
  { id: 'cardholder', label: 'Business card holder', help: 'Angled desk holder for standard 89 x 51 mm cards.',
    params: [P('cards', 'Stack depth', 15), P('angle', 'Tilt', 70, 5, 'deg', 45, 90)],
    build: (p) => { const { Manifold, CrossSection } = M(); const a = (p.angle * Math.PI) / 180; const w = 92; const prof: [number, number][] = [[0, 0], [40, 0], [40, 10], [37, 10], [37, 3], [p.cards + 3 + Math.cos(a) * 25, 3 + Math.sin(a) * 25], [p.cards + Math.cos(a) * 25, 3 + Math.sin(a) * 25], [p.cards, 3 + 0], [3, 3], [3, 30], [0, 30]];
      return [{ name: 'Card holder', m: new CrossSection([prof], 'NonZero').extrude(w).rotate(90, 0, 0).translate(-20, w / 2, 0) }]; } },
);

// ---------------------------------------------------------------- round four ----------------------------------------------------------------
PREFABS.push(
  { id: 'mug', label: 'Mug with handle', help: 'Cup with a C handle fused to the side. Print with a few supports under the handle or orient on its side.',
    params: [P('dia', 'Diameter', 80), P('h', 'Height', 95), P('wall', 'Wall', 2.4, 0.2), P('handle', 'Handle radius', 22), P('grip', 'Handle thickness', 9)],
    build: (p) => { const { Manifold, CrossSection } = M(); const body = cup(p.dia, p.h, p.wall);
      const ring = CrossSection.circle(p.grip / 2, 24).translate(p.handle, 0).revolve(64); // torus in XY
      const half = ring.trimByPlane([1, 0, 0], 0).rotate(90, 0, 0).translate(p.dia / 2 - p.grip * 0.3, 0, p.h / 2); // vertical C on the +X side
      return [{ name: 'Mug', m: Manifold.union(body, half) }]; } },
  { id: 'bowl', label: 'Bowl', help: 'Hemispherical bowl with a flat foot ring.',
    params: [P('dia', 'Diameter', 140), P('wall', 'Wall', 2.4, 0.2), P('foot', 'Foot diameter', 60)],
    build: (p) => { const { Manifold } = M(); const R = p.dia / 2; const outer = Manifold.sphere(R, 96).trimByPlane([0, 0, 1], 0); const inner = Manifold.sphere(R - p.wall, 96).trimByPlane([0, 0, 1], 0);
      let bowl = Manifold.difference(outer, inner); bowl = bowl.rotate(180, 0, 0).translate(0, 0, R); bowl = Manifold.intersection(bowl, Manifold.cube([p.dia + 2, p.dia + 2, R - p.wall * 1.5 + 100], true).translate(0, 0, (R - p.wall * 1.5 + 100) / 2 + p.wall * 1.5 - 0.5)); // flatten the base
      bowl = bowl.translate(0, 0, -(bowl.boundingBox().min[2])); const foot = Manifold.difference(Manifold.cylinder(3, p.foot / 2, p.foot / 2, 64, false), Manifold.cylinder(5, p.foot / 2 - 3, p.foot / 2 - 3, 64, false).translate(0, 0, -1));
      return [{ name: 'Bowl', m: Manifold.union(bowl.translate(0, 0, 3), foot) }]; } },
  { id: 'cableclip', label: 'Cable clip (adhesive / screw)', help: 'Open C clip with a flat base: sticks under a desk or screws to a wall. Size is the cable diameter.',
    params: [P('cable', 'Cable diameter', 6, 0.5), P('w', 'Width', 12), P('t', 'Wall', 2, 0.2), P('screw', 'Screw hole (0 = none)', 3.5, 0.5)],
    build: (p) => { const { Manifold } = M(); const R = p.cable / 2 + p.t; const base = Manifold.cube([2 * R + 14, p.w, p.t], true).translate(0, 0, p.t / 2);
      let ring = Manifold.difference(Manifold.cylinder(p.w, R, R, 48, false), Manifold.cylinder(p.w + 2, R - p.t, R - p.t, 48, false).translate(0, 0, -1)).rotate(-90, 0, 0).translate(0, -p.w / 2, R + p.t - 0.5);
      ring = Manifold.difference(ring, Manifold.cube([p.cable * 0.75, p.w + 2, R], true).translate(0, 0, 2 * R + p.t)); let clip = Manifold.union(base, ring);
      if (p.screw > 0) for (const x of [-R - 5, R + 5]) clip = Manifold.difference(clip, Manifold.cylinder(p.t + 2, p.screw / 2, p.screw / 2, 24, false).translate(x, 0, -1));
      return [{ name: 'Cable clip', m: clip }]; } },
  { id: 'partsbin', label: 'Stackable parts bin', help: 'Open-front bin with a scoop and a stacking lip; bins nest on top of each other.',
    params: [P('w', 'Width', 100), P('d', 'Depth', 120), P('h', 'Height', 60), P('wall', 'Wall', 1.6, 0.2), P('scoop', 'Front scoop height', 25)],
    build: (p) => { const { Manifold } = M(); let bin = openBox(p.w, p.d, p.h, p.wall, 3, 'top');
      bin = Manifold.difference(bin, Manifold.cube([p.w - 2 * p.wall - 8, p.wall + 2, p.h - p.scoop + 1], true).translate(0, -p.d / 2 + p.wall / 2, p.scoop + (p.h - p.scoop + 1) / 2)); // front opening
      bin = Manifold.difference(bin, Manifold.cylinder(p.wall + 2, (p.w - 2 * p.wall - 8) / 2, (p.w - 2 * p.wall - 8) / 2, 64, false).rotate(90, 0, 0).translate(0, -p.d / 2 + p.wall + 1, p.scoop + (p.w - 2 * p.wall - 8) / 2 * 0 + 0)); // rounded scoop edge
      const lip = Manifold.difference(rounded(p.w - 2 * p.wall - 0.6, p.d - 2 * p.wall - 0.6, 2).extrude(4), rounded(p.w - 4 * p.wall - 0.6, p.d - 4 * p.wall - 0.6, 1).extrude(6).translate(0, 0, -1)).translate(0, 0, -4 + 0.01);
      bin = Manifold.union(bin.translate(0, 0, 4), Manifold.intersection(lip.translate(0, 0, 4), Manifold.cube([p.w, p.d - 30, 10], true).translate(0, 15, 2)));
      return [{ name: 'Parts bin', m: bin }]; } },
  { id: 'palette', label: 'Paint palette', help: 'Disc with hemispherical wells and a thumb hole.',
    params: [P('dia', 'Diameter', 150), P('wells', 'Wells', 8, 1, '', 3, 16), P('well', 'Well diameter', 24), P('t', 'Thickness', 10)],
    build: (p) => { const { Manifold } = M(); let disc = Manifold.cylinder(p.t, p.dia / 2, p.dia / 2, 96, false); const cuts: Manifold[] = []; const R = p.dia / 2 - p.well / 2 - 6;
      for (let i = 0; i < p.wells; i++) { const a = (Math.PI * 2 * i) / p.wells; cuts.push(Manifold.sphere(p.well / 2, 32).translate(Math.cos(a) * R, Math.sin(a) * R, p.t)); } cuts.push(Manifold.sphere(p.well * 0.8, 32).translate(0, 0, p.t)); cuts.push(Manifold.cylinder(p.t + 2, 11, 11, 32, false).translate(0, 0, -1).translate(p.dia / 2 - p.well - 20, 0, 0));
      return [{ name: 'Paint palette', m: Manifold.difference(disc, Manifold.union(cuts)) }]; } },
  { id: 'ruler', label: 'Ruler with engraved ticks', help: 'Flat ruler with millimetre ticks (longer every 5 and 10 mm). Doubles as a dimensional calibration print.',
    params: [P('len', 'Length', 150, 10), P('w', 'Width', 25), P('t', 'Thickness', 3, 0.5)],
    build: (p) => { const { Manifold } = M(); let bar = rounded(p.len + 10, p.w, 2).extrude(p.t); const ticks: Manifold[] = [];
      for (let mm = 0; mm <= p.len; mm++) { const L = mm % 10 === 0 ? 10 : mm % 5 === 0 ? 7 : 4; ticks.push(Manifold.cube([0.4, L, 1.2], true).translate(-p.len / 2 + mm, -p.w / 2 + L / 2 + 2, p.t)); }
      return [{ name: `Ruler ${p.len} mm`, m: Manifold.difference(bar, Manifold.union(ticks)) }]; } },
  { id: 'sdholder', label: 'SD / microSD card holder', help: 'Block with slots for SD cards (24 x 2.1 mm) or microSD (11 x 1 mm). Type 1 = SD, 2 = microSD.',
    params: [P('type', 'Card type (1 SD, 2 microSD)', 1, 1, '', 1, 2), P('n', 'Slots', 8, 1, '', 1, 30), P('pitch', 'Slot pitch', 5, 0.5)],
    build: (p) => { const { Manifold } = M(); const [cw, ct, cl] = Math.round(p.type) === 1 ? [24.5, 2.6, 32] : [11.5, 1.4, 15]; const w = p.n * p.pitch + 6, d = cw + 8, h = cl * 0.6;
      let block = rounded(w, d, 2).extrude(h); const slots: Manifold[] = []; for (let i = 0; i < p.n; i++) slots.push(Manifold.cube([ct, cw, cl], true).translate(-w / 2 + 3 + p.pitch / 2 + i * p.pitch, 0, h - cl * 0.45 + cl / 2));
      return [{ name: 'Card holder', m: Manifold.difference(block, Manifold.union(slots)) }]; } },
  { id: 'toothbrush', label: 'Toothbrush holder (wall)', help: 'Wall plate with a row of open-bottom cups for brushes; drains and dries.',
    params: [P('n', 'Brushes', 3, 1, '', 1, 8), P('cupD', 'Cup diameter', 22), P('cupH', 'Cup height', 40), P('wall', 'Wall', 2, 0.2)],
    build: (p) => { const { Manifold } = M(); const pitch = p.cupD + 8; const w = p.n * pitch + 6; const plate = Manifold.cube([w, 4, p.cupH + 20], true).translate(0, -p.cupD / 2 - 2, (p.cupH + 20) / 2);
      const cups: Manifold[] = []; for (let i = 0; i < p.n; i++) { const x = -w / 2 + 3 + pitch / 2 + i * pitch; cups.push(Manifold.difference(Manifold.cylinder(p.cupH, p.cupD / 2 + p.wall, p.cupD / 2 + p.wall, 48, false).translate(x, 0, 10), Manifold.cylinder(p.cupH + 2, p.cupD / 2, p.cupD / 2, 48, false).translate(x, 0, 9))); }
      let holder = Manifold.union([plate, ...cups]); for (const z of [p.cupH + 12, 8]) holder = Manifold.difference(holder, Manifold.cylinder(6, 2.2, 2.2, 24, false).rotate(-90, 0, 0).translate(0, -p.cupD / 2 - 5, z));
      return [{ name: 'Toothbrush holder', m: holder }]; } },
  { id: 'dknob', label: 'Control knob (D shaft)', help: 'Potentiometer / encoder knob with a 6 mm D-shaft socket and a pointer line.',
    params: [P('dia', 'Knob diameter', 20), P('h', 'Height', 16), P('shaft', 'Shaft diameter', 6, 0.5), P('flat', 'D flat depth', 1.5, 0.1), P('depth', 'Socket depth', 10)],
    build: (p) => { const { Manifold } = M(); let knob = Manifold.cylinder(p.h, p.dia / 2, p.dia / 2 - 1.5, 64, false); const r = p.shaft / 2 + 0.15;
      const socket = Manifold.difference(Manifold.cylinder(p.depth, r, r, 32, false), Manifold.cube([p.shaft + 2, p.shaft, p.depth + 2], true).translate(0, r - p.flat + p.shaft / 2, p.depth / 2));
      knob = Manifold.difference(knob, socket.translate(0, 0, -0.01)); knob = Manifold.difference(knob, Manifold.cube([1.2, p.dia / 2 - 2, 1], true).translate(0, p.dia / 4, p.h));
      const ridges: Manifold[] = []; for (let i = 0; i < 18; i++) ridges.push(Manifold.cube([1, 2, p.h - 4], true).translate(0, p.dia / 2, (p.h - 4) / 2 + 2).rotate(0, 0, 20 * i)); return [{ name: 'D-shaft knob', m: Manifold.union([knob, ...ridges]) }]; } },
  { id: 'bagclip', label: 'Bag clip (spring)', help: 'Springy C clip that slides over a folded bag edge. Print in PETG for more flex.',
    params: [P('len', 'Length', 80), P('gap', 'Jaw gap', 1.2, 0.2), P('t', 'Wall', 2, 0.2), P('h', 'Height', 12)],
    build: (p) => { const { Manifold, CrossSection } = M(); const prof = new CrossSection([[[0, 0], [p.len, 0], [p.len, p.t], [p.t + 2, p.t], [p.t + 2, p.t + p.gap], [p.len, p.t + p.gap], [p.len, 2 * p.t + p.gap], [0, 2 * p.t + p.gap]]], 'NonZero');
      return [{ name: 'Bag clip', m: prof.offset(1, 'Round', 2, 12).offset(-1, 'Round', 2, 12).extrude(p.h).rotate(0, 0, 0).translate(-p.len / 2, -(2 * p.t + p.gap) / 2, 0) }]; } },
  { id: 'doorwedge', label: 'Door wedge with grip', help: 'Door stop with a knurled top. Print in TPU for maximum grip, or PETG.',
    params: [P('len', 'Length', 120), P('w', 'Width', 40), P('h', 'Height', 28), P('knurl', 'Knurl depth', 0.6, 0.1)],
    build: (p) => { const { CrossSection } = M(); const prof = new CrossSection([[[0, 0], [p.len, 0], [p.len, p.h], [p.len * 0.85, p.h], [0, 2]]], 'NonZero'); const wedge = prof.extrude(p.w).rotate(90, 0, 0).translate(-p.len / 2, p.w / 2, 0);
      return [{ name: 'Door wedge', m: p.knurl > 0 ? applyKnurl(wedge, p.knurl) : wedge }]; } },
  { id: 'coathook', label: 'Double coat hook', help: 'Two-arm wall hook with a screw plate.',
    params: [P('reach', 'Arm reach', 45), P('spread', 'Arm spread', 60, 5, 'deg', 20, 120), P('t', 'Arm thickness', 8, 0.5), P('plate', 'Plate height', 50)],
    build: (p) => { const { Manifold } = M(); const plate = Manifold.cube([p.plate, p.plate, 5], true).translate(0, 0, 2.5); const arms: Manifold[] = [];
      for (const sgn of [-1, 1]) { const arm = Manifold.union(Manifold.cube([p.t, p.reach, p.t], true).translate(0, p.reach / 2 - 2, p.t / 2 + 5 - 0.01), Manifold.sphere(p.t * 0.8, 24).translate(0, p.reach - 2, p.t / 2 + 5 + p.t * 0.3)); arms.push(arm.rotate(0, 0, (sgn * p.spread) / 2)); }
      let hook = Manifold.union([plate, ...arms]); for (const y of [-p.plate / 2 + 8, p.plate / 2 - 8]) hook = Manifold.difference(hook, Manifold.union(Manifold.cylinder(7, 2.2, 2.2, 24, false).translate(0, y, -1), Manifold.cylinder(2.2, 2.2, 4.5, 24, false).translate(0, y, 5 - 2.2 + 0.01)));
      return [{ name: 'Coat hook', m: hook }]; } },
  { id: 'grommet', label: 'Desk cable grommet (2 parts)', help: 'Ring that drops into a desk hole plus a cap with a cable slot.',
    params: [P('hole', 'Desk hole diameter', 60), P('deskT', 'Desk thickness', 25), P('flange', 'Flange width', 6)],
    build: (p) => { const { Manifold } = M(); const R = p.hole / 2 - 0.5; const ring = Manifold.difference(Manifold.cylinder(p.deskT + 3, R, R, 96, false), Manifold.cylinder(p.deskT + 5, R - 2, R - 2, 96, false).translate(0, 0, -1)); const flange = Manifold.difference(Manifold.cylinder(3, R + p.flange, R + p.flange, 96, false), Manifold.cylinder(5, R - 2, R - 2, 96, false).translate(0, 0, -1));
      const body = Manifold.union(ring, flange.translate(0, 0, p.deskT));
      let cap = Manifold.difference(Manifold.cylinder(4, R - 2.4, R - 2.4, 96, false), Manifold.cylinder(6, 9, 9, 48, false).translate(R * 0.55, 0, -1)); cap = Manifold.difference(cap, Manifold.cube([R + 4, 10, 6], true).translate(R * 0.55 + (R + 4) / 2, 0, 2)); cap = Manifold.union(cap, Manifold.cylinder(3, R - 2.4, R - 0.4, 96, false).translate(0, 0, 4 - 0.01));
      return [{ name: 'Grommet ring', m: body }, { name: 'Grommet cap', m: cap.translate(p.hole + 20, 0, 0), color: '#eb6834' }]; } },
);
/** Knurl the top face of a solid with a diamond texture (used by the door wedge). */
function applyKnurl(m: Manifold, depth: number): Manifold {
  const refined = m.refineToLength(1.2); const out = refined.warp((v) => { const nzTop = v[2] > 3; if (!nzTop) return; const a = Math.sin((v[0] + v[1]) * 2.2) * Math.sin((v[0] - v[1]) * 2.2); v[2] += Math.max(0, a) * depth; });
  if (out.status() !== 'NoError') { out.delete(); return m; } refined.delete(); return out;
}
