// Parametric primitives built on Manifold. All sit on z = 0 (print bed) and are centred in x/y.
import type { Manifold } from 'manifold-3d';
import { M } from '../core/manifold';
import { threadSolid } from './joints';

export type PrimKind = 'box' | 'roundedBox' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'tube' | 'wedge' | 'gear' | 'hexPrism' | 'star' | 'pyramid' | 'prism' | 'ellipsoid' | 'capsule' | 'dome' | 'arch' | 'spring' | 'heart' | 'bolt' | 'nut' | 'knob' | 'icosa' | 'dodeca' | 'elbow' | 'roundCyl' | 'plate' | 'slot' | 'ellipseCyl' | 'hollowSphere' | 'rack' | 'pulley' | 'chamferBox' | 'teardrop' | 'channel' | 'lProfile' | 'tProfile' | 'rectTube';
export interface PrimParams { w: number; d: number; h: number; r: number; r2: number; seg: number; teeth: number; fillet: number; pitch: number; turns: number }
export const PRIM_LABELS: Record<PrimKind, string> = {
  box: 'Box', roundedBox: 'Rounded box', cylinder: 'Cylinder', cone: 'Cone / frustum', sphere: 'Sphere', torus: 'Torus / ring',
  tube: 'Tube / pipe', wedge: 'Wedge', gear: 'Spur gear', hexPrism: 'Hex prism (nut shape)', star: 'Star',
  pyramid: 'Pyramid (n-sided)', prism: 'Prism (n-sided)', ellipsoid: 'Ellipsoid / egg', capsule: 'Capsule (pill)', dome: 'Dome (half sphere)', arch: 'Arch block', spring: 'Spring / coil', heart: 'Heart',
  bolt: 'Bolt (hex head, threaded)', nut: 'Nut (hex, threaded)', knob: 'Knurled knob', icosa: 'Icosahedron (d20 blank)', dodeca: 'Dodecahedron (d12 blank)', elbow: 'Pipe elbow 90 deg', roundCyl: 'Rounded cylinder (puck)',
  plate: 'Plate (rounded corners)', slot: 'Slot / stadium', ellipseCyl: 'Elliptical cylinder', hollowSphere: 'Hollow sphere (shell)', rack: 'Gear rack', pulley: 'GT2 timing pulley', chamferBox: 'Chamfered box', teardrop: 'Teardrop (printable hole)', channel: 'U channel', lProfile: 'L angle profile', tProfile: 'T profile', rectTube: 'Rectangular tube',
};

export function makePrimitive(kind: PrimKind, p: PrimParams): Manifold {
  const { Manifold, CrossSection } = M();
  const seg = Math.max(8, Math.round(p.seg));
  switch (kind) {
    case 'box': return Manifold.cube([p.w, p.d, p.h], true).translate(0, 0, p.h / 2);
    case 'roundedBox': {
      const f = Math.min(p.fillet, p.w / 2 - 0.01, p.d / 2 - 0.01, p.h / 2 - 0.01);
      if (f <= 0) return Manifold.cube([p.w, p.d, p.h], true).translate(0, 0, p.h / 2);
      const s = Manifold.sphere(f, Math.max(12, Math.round(seg / 2)));
      const pts: Manifold[] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(s.translate(sx * (p.w / 2 - f), sy * (p.d / 2 - f), sz * (p.h / 2 - f)));
      return Manifold.hull(pts).translate(0, 0, p.h / 2);
    }
    case 'cylinder': return Manifold.cylinder(p.h, p.r, p.r, seg, false);
    case 'cone': return Manifold.cylinder(p.h, p.r, p.r2, seg, false);
    case 'sphere': return Manifold.sphere(p.r, seg).translate(0, 0, p.r);
    case 'torus': {
      const tube = Math.max(0.1, p.r2);
      const cs = CrossSection.circle(tube, Math.max(8, Math.round(seg / 2))).translate(p.r, 0);
      return cs.revolve(seg).translate(0, 0, tube);
    }
    case 'tube': {
      const outer = Manifold.cylinder(p.h, p.r, p.r, seg, false);
      const inner = Manifold.cylinder(p.h + 2, Math.min(p.r2, p.r - 0.2), Math.min(p.r2, p.r - 0.2), seg, false).translate(0, 0, -1);
      return Manifold.difference(outer, inner);
    }
    case 'wedge': {
      const cs = new CrossSection([[[-p.w / 2, 0], [p.w / 2, 0], [-p.w / 2, p.h]]]);
      // extrude along y: build in xz then rotate
      return cs.extrude(p.d).rotate(90, 0, 0).translate(0, p.d / 2, 0);
    }
    case 'hexPrism': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; pts.push([p.r * Math.cos(a), p.r * Math.sin(a)]); }
      return new CrossSection([pts]).extrude(p.h);
    }
    case 'star': {
      const n = Math.max(3, Math.round(p.teeth)); const pts: [number, number][] = [];
      for (let i = 0; i < n * 2; i++) { const a = (Math.PI / n) * i - Math.PI / 2; const rr = i % 2 === 0 ? p.r : p.r2; pts.push([rr * Math.cos(a), rr * Math.sin(a)]); }
      return new CrossSection([pts]).extrude(p.h);
    }
    case 'gear': return gear(Math.max(6, Math.round(p.teeth)), p.r, p.h, p.r2);
    case 'pyramid': { const n = Math.max(3, Math.round(p.teeth)); const pts: [number, number][] = []; for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n + Math.PI / n; pts.push([p.r * Math.cos(a), p.r * Math.sin(a)]); } return new CrossSection([pts]).extrude(p.h, 1, 0, 0.001); }
    case 'prism': { const n = Math.max(3, Math.round(p.teeth)); const pts: [number, number][] = []; for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n + Math.PI / n; pts.push([p.r * Math.cos(a), p.r * Math.sin(a)]); } return new CrossSection([pts]).extrude(p.h); }
    case 'ellipsoid': return Manifold.sphere(1, seg).scale([p.w / 2, p.d / 2, p.h / 2]).translate(0, 0, p.h / 2);
    case 'capsule': { const body = Manifold.cylinder(Math.max(0.1, p.h - 2 * p.r), p.r, p.r, seg, false).translate(0, 0, p.r); return Manifold.union([body, Manifold.sphere(p.r, seg).translate(0, 0, p.r), Manifold.sphere(p.r, seg).translate(0, 0, p.h - p.r)]); }
    case 'dome': return Manifold.sphere(p.r, seg).trimByPlane([0, 0, 1], 0);
    case 'arch': { const block = Manifold.cube([p.w, p.d, p.h], true).translate(0, 0, p.h / 2); const open = Manifold.union(Manifold.cylinder(p.d + 2, p.r, p.r, seg, false).rotate(90, 0, 0).translate(0, p.d / 2 + 1, p.h - p.r - 1), Manifold.cube([2 * p.r, p.d + 2, p.h - p.r - 1 + 0.01], true).translate(0, 0, (p.h - p.r - 1) / 2 - 0.5)); return Manifold.difference(block, open); }
    case 'spring': { const turns = Math.max(0.25, p.turns); const wire = CrossSection.circle(Math.max(0.3, p.r2), 16).translate(p.r, 0); return wire.extrude(p.h, Math.max(8, Math.ceil(turns * 32)), 360 * turns); }
    case 'heart': { const pts: [number, number][] = []; for (let i = 0; i < 96; i++) { const t = (Math.PI * 2 * i) / 96; pts.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]); } return new CrossSection([pts], 'NonZero').scale(p.w / 32).extrude(p.h); }
    case 'bolt': { const size = Math.max(2, p.r * 2); const pitch = Math.max(0.5, p.pitch); const hh = size * 0.65; const af = size * 1.6; const pts: [number, number][] = []; for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; pts.push([(af / Math.sqrt(3)) * Math.cos(a), (af / Math.sqrt(3)) * Math.sin(a)]); } const head = new CrossSection([pts]).extrude(hh); return Manifold.union(head, threadSolid(size, pitch, p.h, 0).translate(0, 0, hh - 0.01)); }
    case 'nut': { const size = Math.max(2, p.r * 2); const pitch = Math.max(0.5, p.pitch); const af = size * 1.6, nh = size * 0.8; const pts: [number, number][] = []; for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; pts.push([(af / Math.sqrt(3)) * Math.cos(a), (af / Math.sqrt(3)) * Math.sin(a)]); } return Manifold.difference(new CrossSection([pts]).extrude(nh), threadSolid(size, pitch, nh + 2, 0.3).translate(0, 0, -1)); }
    case 'knob': { const n = Math.max(8, Math.round(p.teeth)); const pts: [number, number][] = []; for (let i = 0; i < n * 2; i++) { const a = (Math.PI / n) * i; const rr = i % 2 === 0 ? p.r : p.r - Math.min(p.fillet, p.r * 0.3); pts.push([rr * Math.cos(a), rr * Math.sin(a)]); } let k = new CrossSection([pts]).offset(0.6, 'Round', 2, 8).offset(-0.6, 'Round', 2, 8).extrude(p.h, 1, 0, 0.9); if (p.r2 > 0) k = Manifold.difference(k, Manifold.cylinder(p.h + 2, p.r2, p.r2, 32, false).translate(0, 0, -1)); return k; }
    case 'icosa': { const t = (1 + Math.sqrt(5)) / 2; const v: [number, number, number][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]; const sc = p.r / Math.sqrt(1 + t * t); const m = Manifold.hull(v.map(([x, y, z]) => [x * sc, y * sc, z * sc] as [number, number, number])); const bb = m.boundingBox(); return m.translate(0, 0, -bb.min[2]); }
    case 'dodeca': { const t = (1 + Math.sqrt(5)) / 2; const v: [number, number, number][] = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push([sx, sy, sz]); for (const a of [-1, 1]) for (const b of [-1, 1]) { v.push([0, a / t, b * t]); v.push([a / t, b * t, 0]); v.push([a * t, 0, b / t]); } const sc = p.r / Math.sqrt(3); const m = Manifold.hull(v.map(([x, y, z]) => [x * sc, y * sc, z * sc] as [number, number, number])); const bb = m.boundingBox(); return m.translate(0, 0, -bb.min[2]); }
    case 'elbow': { const ring = CrossSection.circle(p.r, Math.max(12, Math.round(seg / 2))).subtract(CrossSection.circle(Math.min(p.r2, p.r - 0.2), Math.max(12, Math.round(seg / 2)))).translate(p.w, 0); const m = ring.revolve(seg, 90); const bb = m.boundingBox(); return m.translate(-bb.min[0], -bb.min[1], -bb.min[2]); }
    case 'plate': { const rr = Math.min(p.fillet, p.w / 2 - 0.01, p.d / 2 - 0.01); return (rr > 0 ? CrossSection.square([p.w - 2 * rr, p.d - 2 * rr], true).offset(rr, 'Round', 2, 16) : CrossSection.square([p.w, p.d], true)).extrude(p.h); }
    case 'slot': { const L = Math.max(p.w - 2 * p.r, 0.01); return CrossSection.square([L, 2 * p.r], true).offset(p.r, 'Round', 2, 24).translate(0, 0).extrude(p.h); }
    case 'ellipseCyl': return Manifold.cylinder(p.h, 1, 1, seg, false).scale([p.w / 2, p.d / 2, 1]);
    case 'hollowSphere': return Manifold.difference(Manifold.sphere(p.r, seg), Manifold.sphere(Math.max(0.1, p.r - p.r2), seg)).translate(0, 0, p.r);
    case 'rack': { const mod = Math.max(0.5, p.pitch); const n = Math.max(3, Math.round(p.teeth)); const pts: [number, number][] = [[0, 0]]; const h = 2.25 * mod, pitchL = Math.PI * mod; const t = Math.tan((20 * Math.PI) / 180) * h;
      for (let i = 0; i < n; i++) { const x0 = i * pitchL; pts.push([x0 + pitchL / 4 - t / 2, 0], [x0 + pitchL / 4 + t / 2 - t * 0.0, 0]); pts.push([x0 + pitchL / 4 + t * 0.55, h], [x0 + (3 * pitchL) / 4 - t * 0.55, h]); pts.push([x0 + (3 * pitchL) / 4 + 0.0, 0]); }
      pts.push([n * pitchL, 0], [n * pitchL, -p.d], [0, -p.d]); return new CrossSection([pts], 'NonZero').extrude(p.w).rotate(90, 0, 0).translate(-(n * pitchL) / 2, p.w / 2, p.d); }
    case 'pulley': { const n = Math.max(10, Math.round(p.teeth)); const pitch = 2.0; const R = (n * pitch) / (2 * Math.PI) - 0.254; let body = Manifold.cylinder(p.h, R + 0.75, R + 0.75, n * 4, false);
      const grooves: Manifold[] = []; for (let i = 0; i < n; i++) { const a = (360 / n) * i; grooves.push(Manifold.cylinder(p.h + 2, 0.56, 0.56, 12, false).translate(R + 0.75 - 0.0, 0, -1).rotate(0, 0, a)); } body = Manifold.difference(body, Manifold.union(grooves));
      const flange = Manifold.cylinder(1, R + 2.5, R + 2.5, 64, false); body = Manifold.union([body, flange.translate(0, 0, -1 + 0.01), flange.translate(0, 0, p.h - 0.01)]); const hub = Manifold.cylinder(6, R - 1, R - 1, 48, false).translate(0, 0, p.h); body = Manifold.union(body, hub);
      return Manifold.difference(body, Manifold.cylinder(p.h + 10, p.r2, p.r2, 32, false).translate(0, 0, -3)).translate(0, 0, 1); }
    case 'chamferBox': { const c = Math.min(p.fillet, p.w / 2 - 0.01, p.d / 2 - 0.01, p.h / 2 - 0.01); const oct = Manifold.hull([[c, 0, 0], [-c, 0, 0], [0, c, 0], [0, -c, 0], [0, 0, c], [0, 0, -c]]); return Manifold.cube([p.w - 2 * c, p.d - 2 * c, p.h - 2 * c], true).minkowskiSum(oct).translate(0, 0, p.h / 2); }
    case 'teardrop': { const pts: [number, number][] = []; for (let i = 0; i <= 24; i++) { const a = -Math.PI / 4 + (i / 24) * (Math.PI * 1.5); pts.push([p.r * Math.cos(a), p.r * Math.sin(a)]); } pts.push([0, p.r * Math.SQRT2]); return new CrossSection([pts], 'NonZero').extrude(p.h).rotate(90, 0, 0).translate(0, p.h / 2, p.r); }
    case 'channel': { const outer = CrossSection.square([p.w, p.h]).translate(-p.w / 2, 0); const inner = CrossSection.square([p.w - 2 * p.r2, p.h]).translate(-p.w / 2 + p.r2, p.r2); return outer.subtract(inner).extrude(p.d).rotate(90, 0, 0).translate(0, p.d / 2, 0); }
    case 'lProfile': { const prof = new CrossSection([[[0, 0], [p.w, 0], [p.w, p.r2], [p.r2, p.r2], [p.r2, p.h], [0, p.h]]]); return prof.extrude(p.d).rotate(90, 0, 0).translate(-p.w / 2, p.d / 2, 0); }
    case 'tProfile': { const t = p.r2; const prof = new CrossSection([[[-t / 2, 0], [t / 2, 0], [t / 2, p.h - t], [p.w / 2, p.h - t], [p.w / 2, p.h], [-p.w / 2, p.h], [-p.w / 2, p.h - t], [-t / 2, p.h - t]]]); return prof.extrude(p.d).rotate(90, 0, 0).translate(0, p.d / 2, 0); }
    case 'rectTube': { const outer = CrossSection.square([p.w, p.h], true); const inner = CrossSection.square([p.w - 2 * p.r2, p.h - 2 * p.r2], true); return outer.subtract(inner).extrude(p.d).rotate(90, 0, 0).translate(0, p.d / 2, p.h / 2); }
    case 'roundCyl': { const f = Math.min(p.fillet, p.r - 0.1, p.h / 2 - 0.1); if (f <= 0) return Manifold.cylinder(p.h, p.r, p.r, seg, false); const prof = CrossSection.square([p.r - f, p.h - 2 * f]).translate(0, f); const edge = CrossSection.circle(f, 24).translate(p.r - f, f); const edge2 = CrossSection.circle(f, 24).translate(p.r - f, p.h - f); const mid = CrossSection.square([p.r, p.h - 2 * f]).translate(0, f); return CrossSection.union([prof, mid, edge, edge2, CrossSection.square([p.r - f, p.h])]).revolve(seg); }
  }
}

/** Approximate involute spur gear: module from pitch radius and tooth count; bore radius optional. */
export function gear(teeth: number, pitchRadius: number, height: number, bore = 0): Manifold {
  const { CrossSection } = M();
  const m = (2 * pitchRadius) / teeth;
  const rb = pitchRadius * Math.cos((20 * Math.PI) / 180); // base circle, 20 deg pressure angle
  const ra = pitchRadius + m; const rd = pitchRadius - 1.25 * m;
  const inv = (r: number) => { const t = Math.sqrt(Math.max(0, (r / rb) ** 2 - 1)); return { r, ang: t - Math.atan(t) }; };
  const halfTooth = Math.PI / (2 * teeth) + inv(pitchRadius).ang; // angular half thickness at base
  const pts: [number, number][] = [];
  const N = 8;
  for (let i = 0; i < teeth; i++) {
    const c = (2 * Math.PI * i) / teeth;
    pts.push([rd * Math.cos(c - halfTooth - 0.02), rd * Math.sin(c - halfTooth - 0.02)]);
    const side: [number, number][] = [];
    for (let k = 0; k <= N; k++) { const r = Math.max(rb, rd) + ((ra - Math.max(rb, rd)) * k) / N; const a = c - (halfTooth - inv(r).ang); side.push([r * Math.cos(a), r * Math.sin(a)]); }
    pts.push(...side);
    for (let k = N; k >= 0; k--) { const r = Math.max(rb, rd) + ((ra - Math.max(rb, rd)) * k) / N; const a = c + (halfTooth - inv(r).ang); pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    pts.push([rd * Math.cos(c + halfTooth + 0.02), rd * Math.sin(c + halfTooth + 0.02)]);
  }
  let cs = new CrossSection([pts], 'NonZero');
  if (bore > 0) cs = cs.subtract(CrossSection.circle(bore, 48));
  return cs.extrude(height);
}
