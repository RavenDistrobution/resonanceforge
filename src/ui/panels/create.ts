// Create panel: parametric primitives.
import { h, btn, num, sel, section, sectionC, desc, rowBtns, icon, check } from '../dom';
import { addPlaced, addWithMode, runOp, ADD_MODES, type AddMode, type Panel } from '../ctx';
import { makePrimitive, PRIM_LABELS, type PrimKind, type PrimParams } from '../../tools/primitives';
import { gridfinityBin, gridfinityBaseplate, fitCoupon } from '../../tools/modeling';
import { PREFABS } from '../../tools/prefabs';
import { project } from '../../core/project';
import { toast } from '../dom';

export function createPanel(): Panel {
  const kind = sel('Shape', Object.entries(PRIM_LABELS) as [string, string][], 'box', () => update());
  const w = num('Width X', 30, { min: 0.1, step: 1, unit: 'mm' }), d = num('Depth Y', 20, { min: 0.1, step: 1, unit: 'mm' }), hh = num('Height Z', 15, { min: 0.1, step: 1, unit: 'mm' });
  const r = num('Radius', 10, { min: 0.1, step: 0.5, unit: 'mm' }), r2 = num('Radius 2', 4, { min: 0, step: 0.5, unit: 'mm' });
  const seg = num('Segments', 64, { min: 8, max: 256, step: 8 }), teeth = num('Teeth / points', 12, { min: 3, max: 200, step: 1 }), fillet = num('Fillet', 3, { min: 0, step: 0.5, unit: 'mm' });
  const pitch = num('Thread pitch', 1.5, { min: 0.5, max: 8, step: 0.25, unit: 'mm' }), turns = num('Turns', 5, { min: 0.25, max: 60, step: 0.25 });
  const hints: Record<PrimKind, string> = {
    box: 'Sharp box. Use Rounded box for printer-friendly edges.', roundedBox: 'Fillet is applied to all edges and corners.', cylinder: 'Radius and height. Segments control smoothness.',
    cone: 'Radius is the base, Radius 2 the top (0 for a point).', sphere: 'Sits on the bed; the bottom contact is a point, so add a flat or support.', torus: 'Radius is the ring centre line, Radius 2 the tube.',
    tube: 'Radius outer, Radius 2 inner bore.', wedge: 'Right triangle profile along Y. Good as a support block or doorstop.', gear: 'Radius is the pitch radius, Radius 2 the bore. 20 deg pressure angle involute approximation.',
    hexPrism: 'Radius is the corner radius. Nut-style prism for captive nuts or knobs.', star: 'Radius outer, Radius 2 inner, Teeth = points.',
    pyramid: 'Radius is the base corner radius, Teeth = number of sides (3 = tetrahedron-like, 4 = square pyramid).', prism: 'Regular n-sided prism; Teeth = sides.', ellipsoid: 'Width, depth and height set the three diameters.', capsule: 'Pill: cylinder with hemispherical ends. Height is the total length.',
    dome: 'Upper half of a sphere, flat face down.', arch: 'Block with a round-topped doorway; Radius sets the arch radius.', spring: 'Helical coil: Radius = coil radius, Radius 2 = wire radius, Turns and Height. Prints best lying flat or in TPU.', heart: 'Classic heart outline; Width sets the size.',
    bolt: 'Radius = half the thread diameter (M6 = 3), Height = thread length, pitch per thread. Prints head down.', nut: 'Matching nut: Radius = half the thread diameter, same pitch. 0.3 mm thread clearance built in.', knob: 'Grip knob with rounded knurls: Teeth = knurl count, Fillet = knurl depth, Radius 2 = shaft hole.',
    plate: 'Flat slab with rounded corners (Fillet = corner radius).', slot: 'Stadium / obround: Width overall, Radius = end radius. Use as a slot cutter.', ellipseCyl: 'Elliptical cylinder: Width and Depth are the two diameters.', hollowSphere: 'Sphere shell: Radius outer, Radius 2 = wall thickness. Cut it in half for domes.', rack: 'Straight gear rack: Teeth count, pitch = module (match the gear), Width along the teeth, Depth = bar thickness.', pulley: 'GT2 2 mm belt pulley: Teeth count (16 or 20 typical), Height = belt width, Radius 2 = bore radius.', chamferBox: 'Box with 45 degree chamfers on all edges (Fillet = chamfer size).', teardrop: 'Teardrop-section bar laid along Y: subtract it to make horizontal holes that print without support.', channel: 'U channel along Y: Width, Height, Radius 2 = wall thickness, Depth = length.', lProfile: 'L angle along Y: Width and Height legs, Radius 2 = thickness.', tProfile: 'T profile along Y: Width of the flange, Height, Radius 2 = thickness.', rectTube: 'Rectangular tube along Y: Width, Height, wall = Radius 2, Depth = length.',
    icosa: '20-sided solid, engrave numbers with the Text panel for a d20.', dodeca: '12-sided solid (d12 blank).', elbow: '90 degree pipe bend: Radius outer, Radius 2 bore, Width = bend radius.', roundCyl: 'Cylinder with rounded top and bottom edges (Fillet).',
  };
  const hint = h('p', { class: 'desc' });
  // ---- prefabs: parametric multi-part objects
  const pfSel = sel('Prefab', PREFABS.map((x) => [x.id, x.label]) as [string, string][], 'chest', () => pfRender());
  const pfHelp = h('p', { class: 'desc' }); const pfFields = h('div'); let pfInputs: Record<string, { value: number }> = {};
  function pfRender() { const pf = PREFABS.find((x) => x.id === pfSel.value)!; pfHelp.textContent = pf.help; pfFields.innerHTML = ''; pfInputs = {}; for (const d of pf.params) { const f = num(d.label, d.def, { min: d.min, max: d.max, step: d.step, unit: d.unit }); pfInputs[d.key] = f; pfFields.append(f); } }
  function pfBuild() {
    const pf = PREFABS.find((x) => x.id === pfSel.value)!; const vals: Record<string, number> = {}; for (const d of pf.params) vals[d.key] = pfInputs[d.key].value;
    runOp(`Building ${pf.label}`, () => { const parts = pf.build(vals); (window as any).__pf = parts; return parts[0].m; }, (first) => {
      const parts = (window as any).__pf as { name: string; m: any; color?: string }[]; delete (window as any).__pf; project.snapshot();
      const made = parts.map((pp, i) => { const part = i === 0 ? addPlaced(first, pp.name, pp.color) : addPlaced(pp.m, pp.name, pp.color); return part; });
      project.select(made.map((p) => p.id)); toast(`${pf.label}: ${parts.length} part${parts.length > 1 ? 's' : ''} added.`, 'good');
    });
  }
  const gfX = num('Units X', 2, { min: 1, max: 10, step: 1 }), gfY = num('Units Y', 1, { min: 1, max: 10, step: 1 }), gfZ = num('Height units', 3, { min: 1, max: 12, step: 1 }), gfWall = num('Wall', 1.2, { min: 0.8, step: 0.2, unit: 'mm' }), gfLip = check('Stacking lip', true);
  const addAs = sel('Add as', ADD_MODES as [string, string][], 'new');
  const fields: Record<string, HTMLElement> = { w, d, h: hh, r, r2, seg, teeth, fillet, pitch, turns };
  const needs: Record<PrimKind, string[]> = {
    box: ['w', 'd', 'h'], roundedBox: ['w', 'd', 'h', 'fillet', 'seg'], cylinder: ['r', 'h', 'seg'], cone: ['r', 'r2', 'h', 'seg'], sphere: ['r', 'seg'], torus: ['r', 'r2', 'seg'], tube: ['r', 'r2', 'h', 'seg'],
    wedge: ['w', 'd', 'h'], gear: ['teeth', 'r', 'r2', 'h'], hexPrism: ['r', 'h'], star: ['teeth', 'r', 'r2', 'h'],
    pyramid: ['teeth', 'r', 'h'], prism: ['teeth', 'r', 'h'], ellipsoid: ['w', 'd', 'h', 'seg'], capsule: ['r', 'h', 'seg'], dome: ['r', 'seg'], arch: ['w', 'd', 'h', 'r', 'seg'], spring: ['r', 'r2', 'h', 'turns'], heart: ['w', 'h'],
    plate: ['w', 'd', 'h', 'fillet'], slot: ['w', 'r', 'h'], ellipseCyl: ['w', 'd', 'h', 'seg'], hollowSphere: ['r', 'r2', 'seg'], rack: ['teeth', 'pitch', 'w', 'd'], pulley: ['teeth', 'h', 'r2'], chamferBox: ['w', 'd', 'h', 'fillet'], teardrop: ['r', 'h'], channel: ['w', 'h', 'r2', 'd'], lProfile: ['w', 'h', 'r2', 'd'], tProfile: ['w', 'h', 'r2', 'd'], rectTube: ['w', 'h', 'r2', 'd'],
    bolt: ['r', 'h', 'pitch'], nut: ['r', 'pitch'], knob: ['r', 'r2', 'h', 'teeth', 'fillet'], icosa: ['r'], dodeca: ['r'], elbow: ['r', 'r2', 'w', 'seg'], roundCyl: ['r', 'h', 'fillet', 'seg'],
  };
  function update() { const k = kind.value as PrimKind; for (const [n, f] of Object.entries(fields)) f.style.display = needs[k].includes(n) ? '' : 'none'; hint.textContent = hints[k]; }
  const params = (): PrimParams => ({ w: w.value, d: d.value, h: hh.value, r: r.value, r2: r2.value, seg: seg.value, teeth: teeth.value, fillet: fillet.value, pitch: pitch.value, turns: turns.value });
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-cpu'), 'Create primitives'),
    desc('Parametric solids that always start watertight. Combine them with booleans in the Parts panel, texture them, or use them as bases for text and images.'),
    section('Shape', kind, hint, w, d, hh, r, r2, seg, teeth, fillet, pitch, turns, addAs,
      desc('New part stands alone. Fuse and Cut apply to the selected part immediately. Negative and Modifier stay editable: move them with the gizmo; negatives are subtracted on export (or with Parts > Combine), modifiers export as their own object for per-region slicer settings.'),
      rowBtns(btn('Add to scene', () => runOp('Create', () => makePrimitive(kind.value as PrimKind, params()), (m) => { void addWithMode(m, PRIM_LABELS[kind.value as PrimKind], undefined, addAs.value as AddMode); }), { primary: true }))),
    section('Prefabs (ready-made objects)', desc('Parametric multi-part objects built from the joint, thread and hinge engine. Parts land side by side; chests arrive assembled with the lid in place.'),
      pfSel, pfHelp, pfFields, rowBtns(btn('Add prefab', pfBuild, { primary: true }))),
    sectionC('Gridfinity', desc('Standard 42 mm grid storage system. Bins have the stacking foot profile and an optional lip; baseplates hold them. Sizes are in grid units (1 unit = 42 mm, height unit = 7 mm).'),
      gfX, gfY, gfZ, gfWall, gfLip, rowBtns(btn('Gridfinity bin', () => runOp('Gridfinity bin', () => gridfinityBin(gfX.value, gfY.value, gfZ.value, gfWall.value, 1.0, gfLip.value), (m) => addPlaced(m, `Gridfinity ${gfX.value}x${gfY.value}x${gfZ.value}`)), { primary: true }), btn('Baseplate', () => runOp('Gridfinity baseplate', () => gridfinityBaseplate(gfX.value, gfY.value), (m) => addPlaced(m, `Gridfinity base ${gfX.value}x${gfY.value}`))))),
    sectionC('Quick presets', desc('Common printer test and utility parts.'),
      rowBtns(
        btn('20 mm calibration cube', () => runOp('Cube', () => makePrimitive('box', { ...params(), w: 20, d: 20, h: 20 }), (m) => addPlaced(m, 'Calibration cube'))),
        btn('Coaster 90 mm', () => runOp('Coaster', () => makePrimitive('cylinder', { ...params(), r: 45, h: 4, seg: 128 }), (m) => addPlaced(m, 'Coaster'))),
        btn('Washer M8', () => runOp('Washer', () => makePrimitive('tube', { ...params(), r: 8, r2: 4.3, h: 1.6, seg: 64 }), (m) => addPlaced(m, 'Washer M8'))),
        btn('Knob (hex 20 mm)', () => runOp('Knob', () => makePrimitive('hexPrism', { ...params(), r: 11.5, h: 12 }), (m) => addPlaced(m, 'Knob'))),
        btn('Gear 24T', () => runOp('Gear', () => makePrimitive('gear', { ...params(), teeth: 24, r: 24, r2: 4, h: 6 }), (m) => addPlaced(m, 'Gear 24T'))),
        btn('Fit test coupon (6 mm pegs)', () => runOp('Fit coupon', () => fitCoupon(6), (m) => addPlaced(m, 'Fit test coupon')), { title: 'Holes at 0.10 to 0.40 mm clearance plus matching pegs: print, test, pick your tolerance' }),
      )),
  ) as Panel;
  update(); pfRender();
  return el;
}
