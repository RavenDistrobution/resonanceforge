// Mandatory left-edge "Legend & how to read" drawer: how to read, how numbers are calculated, filterable glossary.
import { h, icon, btn } from './dom';
import { ICON_DATA_URL } from '../brand/brand';

const HOW = [
  'Blue parts are selected (primary target), orange ones are additional selections. The gizmo moves the primary part.',
  'Colour maps run blue (low) through green and yellow to red (high). Red never means failure by itself; it marks where to look first.',
  'Severity words are fixed: critical blocks the print, serious degrades it, warning is a defect to fix, info is a fact, good is a strength.',
  'Hotspot spheres in the viewport use the same severity colours. Click a hotspot row to aim the camera.',
  'Units are millimetres, grams and degrees Celsius. Z is up and the bed is the grey plate at z = 0.',
  'Mesh-only parts (not watertight) can be moved, painted and exported but not combined or textured until repaired.',
];
const CALC: [string, string][] = [
  ['Wall thickness', 'For every triangle a ray is cast inward along the negative normal; the distance to the first surface hit is the local thickness. Thin score is 1 at or below two line widths (2 x nozzle) and 0 at seven line widths. The reported thin wall figure is the area-weighted 1st percentile so a single sliver triangle cannot dominate it.'],
  ['Overhang', 'A triangle is an overhang when its normal points down more steeply than the limit (default 45 deg from vertical) and it does not sit on the bed. Overhang area sums those triangles; support footprint is their horizontal projection.'],
  ['Layer load index', 'The part is sliced into N layers. For each layer, volume above the layer divided by the layer area, normalised to the largest value. Spikes mark necks: little material carrying a lot.'],
  ['Combined risk', 'Per vertex: the maximum of thin score, 0.85 x layer load index, and overhang score.'],
  ['Stability ratio', 'Height of the centre of gravity above the bed divided by the square root of the bed contact area. Above 1.4 a brim is advised, above 2.5 the part is tippy.'],
  ['Voxel FEA', 'The part is voxelised by column ray casting; each occupied voxel becomes an 8-node linear elastic hex element (E = 1, Poisson 0.33). Bottom-layer nodes are fixed. Load is self weight, a downward unit pressure on top faces, or a sideways push. A Jacobi-preconditioned conjugate gradient solves K u = f; stress is recovered at element centres and von Mises is colour-mapped relative to the 95th percentile.'],
  ['Estimated filament', 'Solid volume from the mesh, reduced to shells (surface area x walls x line width, plus top and bottom layers) plus infill percentage of the rest, times material density.'],
  ['Rough print time', 'Extruded volume divided by a flow of layer height x line width x 60 % of speed, plus 35 % for travel and acceleration and 6 minutes for heat-up. An order-of-magnitude figure only.'],
  ['Fit tolerance', 'Radial clearance added to cutters per side. 0.1 press fit, 0.2 normal, 0.3 to 0.4 sliding.'],
  ['Pattern value', 'Each pattern is a function of surface position returning 0 to 1. Texture displacement is (value - 0.5) x depth along the vertex normal, so the mean surface stays in place.'],
];
const GLOSSARY: [string, string, string][] = [
  ['Files', 'STL', 'Triangle-only mesh format. No units, colours or multiple objects. Universal.'],
  ['Files', '3MF', '3D Manufacturing Format. Zip of XML with units, multiple objects, colours and metadata. Preferred by Bambu Studio, PrusaSlicer and Cura.'],
  ['Files', 'SVG', 'Scalable Vector Graphics. Used here for patterns and outlines; import extrudes closed paths.'],
  ['Files', 'Colour group', '3MF materials extension resource that stores one colour per triangle (m:colorgroup).'],
  ['Geometry', 'Manifold / watertight', 'A closed mesh with no holes, every edge shared by exactly two triangles, consistent orientation. Required for booleans, slicing and texturing.'],
  ['Geometry', 'Boolean', 'Union (fuse), difference (subtract) or intersection of solids.'],
  ['Geometry', 'Convex hull', 'Smallest convex shape containing the part. Used by Rounded box and as a rough repair.'],
  ['Geometry', 'Refine', 'Split triangles into smaller ones so a texture or smooth deformation has enough vertices.'],
  ['Geometry', 'Simplify', 'Merge coplanar triangles and remove tiny edges within a tolerance.'],
  ['Geometry', 'Genus', 'Number of through-holes in a closed surface. A donut has genus 1.'],
  ['Geometry', 'Shell', 'One connected closed surface. A part may have several.'],
  ['Geometry', 'Normal', 'Direction a triangle faces. Used for overhang detection and texture displacement.'],
  ['Printing', 'Overhang', 'Surface that leans out over empty space. Beyond about 45 deg it needs support or droops.'],
  ['Printing', 'Bridge', 'Horizontal span between two supported points; short bridges print without support.'],
  ['Printing', 'Brim', 'Single-layer flat ring attached to the part for adhesion and stability.'],
  ['Printing', 'Skirt', 'Loop around the part, not touching it, that primes the nozzle.'],
  ['Printing', 'Infill', 'Internal fill pattern and percentage. Gyroid is isotropic; grid is fast; lightning is minimal.'],
  ['Printing', 'Walls / perimeters', 'Outer solid loops of each layer. Most strength comes from walls, not infill.'],
  ['Printing', 'Line width', 'Width of an extruded line, typically 1.0 to 1.2 x nozzle diameter.'],
  ['Printing', 'Arachne / thin wall', 'Slicer mode that varies line width to fill thin features.'],
  ['Printing', 'Layer adhesion', 'Bond between layers; the weakest direction of an FDM part (Z).'],
  ['Printing', 'Lithophane', 'Relief where thickness encodes image brightness; viewed back-lit.'],
  ['Printing', 'Heat-set insert', 'Brass threaded insert pressed into a hole with a hot soldering iron.'],
  ['Printing', 'Elephant foot', 'First-layer bulge from squish; compensate in the slicer or chamfer the base.'],
  ['Analysis', 'FEA', 'Finite element analysis: splitting a solid into small elements and solving equilibrium for displacement and stress.'],
  ['Analysis', 'Von Mises stress', 'Single scalar combining all stress components; the usual yield criterion for ductile materials.'],
  ['Analysis', 'Hex element', 'Eight-node brick element used by the voxel FEA.'],
  ['Analysis', 'Conjugate gradient', 'Iterative solver for large symmetric systems; residual shows how converged it is.'],
  ['Analysis', 'Centre of gravity (COG)', 'Mass-weighted centre of the solid, assuming uniform density.'],
  ['Analysis', 'Neck', 'Layer whose cross-section is much smaller than those above it while carrying their weight.'],
  ['Analysis', 'p95', '95th percentile, used to normalise stress colours so single singular voxels do not wash out the map.'],
  ['Materials', 'PLA / PETG / ABS / ASA / TPU / PA / PC', 'Common filament families; see the Settings panel table for temperatures and properties.'],
  ['Materials', 'Shrinkage', 'Percentage a part contracts on cooling; higher values warp more.'],
  ['Materials', 'Hygroscopic', 'Absorbs moisture from air; wet filament pops, strings and weakens.'],
  ['Roles', 'Negative part', 'Translucent red solid that is subtracted from every printed part it overlaps when you export or run Combine by role. Stays editable until then.'],
  ['Roles', 'Modifier', 'Translucent blue region exported as its own object named [modifier]; assign it different infill, walls or material in the slicer.'],
  ['Roles', 'Combine by role', 'Bakes the selected (or all visible) parts: positives fused into the first printed part, negatives subtracted, modifiers left alone.'],
  ['Drawing', 'Sketch plane', 'Each shape remembers the plane it was drawn on (face under the cursor in Auto mode, or a locked preset with tilt, spin and offset) and extrudes along that plane normal.'],
  ['Drawing', 'Free draw brush', 'Each stroke is a chain of capsules (convex hulls of spheres or cubes) unioned together; circles and rectangles are closed chains, filled ones are extruded discs or plates.'],
  ['Drawing', 'Anchor', 'The 3D point the drawing plane passes through; set by the last surface touched or the end of the last air stroke.'],
  ['Drawing', 'Edit points', 'Handles appear on every sketch point; drag to move (snapped), Alt+click to remove, Shift+click to insert a midpoint. The table lists the selected shape in plane coordinates u, v.'],
  ['Drawing', 'Live preview', 'The sketch is extruded and shown translucent on every pointer move: green for added material, red for a cut. Combined preview hides the part and shows the boolean result instead.'],
  ['Drawing', 'Hole', 'A shape flagged as hole is subtracted from the filled shapes of the same sketch; a ring is a circle with its inner circle removed.'],
  ['Drawing', 'Snap grid', 'Sketch points round to the nearest grid step in millimetres; 0 disables snapping.'],
  ['Texture', 'Soften', 'Box blur of the pattern over the given radius before displacement; rounds ridges.'],
  ['Texture', 'Relax', 'Taubin smoothing passes on displaced vertices; removes faceting without shrinking the part.'],
  ['UI', 'Section view', 'Clipping plane that hides everything on one side so you can look inside a part; display only, nothing is cut.'],
  ['UI', 'Measure', 'Two clicked points on parts; shows straight distance and the X, Y, Z deltas.'],
  ['Geometry', 'Shell / offset / round', 'Morphological operations: the part is grown or shrunk by a sphere (Minkowski sum or difference). Shell = part minus its shrunk copy; rounding = opening then closing.'],
  ['Geometry', 'Auto-orient', 'Tries axis-aligned and tilted orientations and keeps the one with the least projected overhang area and the most bed contact.'],
  ['Geometry', 'Gridfinity', 'Open storage standard on a 42 mm grid with 7 mm height units; bins have a chamfered foot that sits in baseplate sockets.'],
  ['UI', 'Gizmo', 'On-screen handles for move (W), rotate (E) and scale (R).'],
  ['UI', 'Mesh-only part', 'Imported part that could not be made watertight; limited to move, paint, export and analysis.'],
  ['UI', 'Place mode', 'Click on a surface to position a joint; its axis follows the surface normal.'],
  ['Joints', 'Smart joint', 'Placing a peg on one part also subtracts the matching socket from any watertight part the peg runs into (and the reverse for sockets). Mates are found by overlap test.'],
  ['Joints', 'Cut with joint', 'Split a part on an axis-aligned plane; connectors are placed along the cut face where a probe circle fits fully inside the cross-section.'],
  ['Joints', 'Thread', 'Single-start helical thread made by extruding a sinusoidal lobe profile with a twist of 360 degrees per pitch. Female sockets use the same profile grown by the tolerance.'],
  ['Joints', 'Magnet floor', 'Thin wall left between a magnet pocket and the outer face so the magnet is hidden; pockets on mating faces share the same positions.'],
  ['Joints', 'Hinge and latch', 'Barrel hinge whose knuckles alternate between the two parts with a pin on the lid, bridged to each part below and above the axis height; the latch is a hooked tab on the lid with a slot and notch cut in the base.'],
  ['Joints', 'Dowel', 'Loose pin with sockets on both sides; print pins separately, often in a tougher material.'],
];

export function buildLegend() {
  const filter = h('input', { id: 'legendFilter', type: 'search', placeholder: 'Filter glossary' });
  const glossary = h('div');
  function renderGlossary(q = '') {
    glossary.innerHTML = ''; const ql = q.toLowerCase(); let group = '';
    for (const [g, t, d] of GLOSSARY) { if (ql && !(t.toLowerCase().includes(ql) || d.toLowerCase().includes(ql) || g.toLowerCase().includes(ql))) continue; if (g !== group) { group = g; glossary.append(h('div', { class: 'lg-grp' }, g)); } glossary.append(h('dl', { class: 'lg' }, h('dt', null, t), h('dd', null, d))); }
    if (!glossary.children.length) glossary.append(h('p', { class: 'note' }, 'No matching term.'));
  }
  filter.addEventListener('input', () => renderGlossary(filter.value));
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Legend and how to read' },
    h('div', { class: 'drawer-head' }, h('h3', null, 'Legend and how to read'), btn('Close', () => close(), { icon: 'i-x' })),
    h('h3', null, 'How to read the workspace'), h('ul', { class: 'lg-how' }, ...HOW.map((x) => h('li', null, x))),
    h('h3', null, 'How numbers are calculated'), h('dl', { class: 'lg' }, ...CALC.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('h3', null, 'Glossary'), filter, glossary,
    h('h3', null, 'About'), h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, h('img', { src: ICON_DATA_URL, alt: '', style: { width: '40px', height: '40px', borderRadius: '10px', flex: 'none' } }), h('p', { class: 'note', style: { margin: 0 } }, 'ResonanceForge, designed and authored by MB. Open-source use only. Distribution: RavenDistro.')),
    h('h3', null, 'Keyboard'), h('ul', { class: 'lg-how' }, h('li', null, h('kbd', null, 'W'), ' move, ', h('kbd', null, 'E'), ' rotate, ', h('kbd', null, 'R'), ' scale, ', h('kbd', null, 'F'), ' fit view'), h('li', null, h('kbd', null, 'Ctrl/Cmd+Z'), ' undo, ', h('kbd', null, 'Ctrl/Cmd+Shift+Z'), ' redo, ', h('kbd', null, 'Ctrl/Cmd+D'), ' duplicate, ', h('kbd', null, 'Delete'), ' remove'), h('li', null, 'Arrow keys nudge the selection 1 mm (', h('kbd', null, 'Shift'), ' 10 mm, ', h('kbd', null, 'Alt'), ' 0.1 mm), ', h('kbd', null, 'PgUp'), '/', h('kbd', null, 'PgDn'), ' for Z.'), h('li', null, h('kbd', null, 'Shift'), '+click adds to selection; ', h('kbd', null, 'Esc'), ' clears selection or cancels placement'), h('li', null, 'In draw, paint and place modes: right-drag orbits, middle-drag pans, wheel zooms, ', h('kbd', null, 'Space'), ' + left-drag orbits.'), h('li', null, 'Drag and drop STL, 3MF or OBJ files anywhere on the viewport to import them.')),
  );
  const scrim = h('div', { class: 'drawer-scrim' });
  const tab = h('button', { class: 'lg-tab', 'aria-expanded': 'false', onClick: () => (drawer.classList.contains('open') ? close() : open()) }, icon('i-info'), 'Legend & how to read');
  function open() { drawer.classList.add('open'); scrim.classList.add('open'); tab.setAttribute('aria-expanded', 'true'); }
  function close() { drawer.classList.remove('open'); scrim.classList.remove('open'); tab.setAttribute('aria-expanded', 'false'); }
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('open')) close(); });
  renderGlossary();
  document.body.append(tab, scrim, drawer);
  return { open, close };
}
