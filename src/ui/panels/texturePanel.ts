// Texture panel: displace a selected part's surface with a procedural pattern.
import { h, btn, sel, section, desc, rowBtns, icon, range, check, num } from '../dom';
import { ctx, runOp, requireManifoldPart, type Panel } from '../ctx';
import { PATTERN_LABELS, PATTERN_PRESETS, type PatternKind, type PatternParams } from '../../tools/patterns';
import { applyTexture, estimateTriangles } from '../../tools/texture';
import { project } from '../../core/project';

export function texturePanel(): Panel {
  const depth = range('Depth', 0.6, { min: 0.1, max: 5, step: 0.1, unit: ' mm' });
  const soften = range('Soften pattern', 0, { min: 0, max: 3, step: 0.1, unit: ' mm' });
  const relax = range('Relax mesh', 0, { min: 0, max: 10, step: 1, unit: ' passes' });
  const refine = range('Mesh density', 0.8, { min: 0.2, max: 4, step: 0.1, unit: ' mm', onInput: () => est() });
  const preset = sel('Preset', [['', 'Custom'], ...PATTERN_PRESETS.map((x) => [x.id, x.label] as [string, string])], '', (v) => { const pr = PATTERN_PRESETS.find((x) => x.id === v); if (!pr) return; kind.value = pr.kind; cell.value = pr.params.cell; line.value = pr.params.line; amp.value = pr.params.amp; seed.value = pr.params.seed; invert.value = pr.params.invert; stagger.value = pr.params.stagger; depth.value = pr.depth; refine.value = Math.max(0.2, Math.min(1, pr.params.cell / 8)); est(); });
  const kind = sel('Pattern', Object.entries(PATTERN_LABELS) as [string, string][], 'knurl', () => { preset.value = ''; });
  const cell = range('Cell size', 4, { min: 0.5, max: 30, step: 0.5, unit: ' mm' }), line = range('Line width', 1, { min: 0.2, max: 6, step: 0.1, unit: ' mm' });
  const amp = range('Amplitude', 1, { min: 0, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) }), invert = check('Invert', false), stagger = check('Stagger', true), seed = num('Seed', 7, { min: 0, step: 1 });
  const proj = sel('Projection', [['tri', 'Auto (tri-planar)'], ['z', 'From top (XY)'], ['x', 'From side (YZ)'], ['y', 'From front (XZ)'], ['cyl', 'Wrap around Z (cylindrical)']], 'tri');
  const mask = sel('Apply to', [['all', 'All faces'], ['sides', 'Side walls only'], ['top', 'Top faces only']], 'all');
  const keepBottom = check('Keep bottom flat', true);
  const estimate = h('p', { class: 'desc' });
  function est() { const p = project.primary; if (!p?.manifold) { estimate.textContent = 'Select a watertight part.'; return; } const n = estimateTriangles(p.manifold, refine.value); estimate.textContent = `About ${n.toLocaleString()} triangles after refinement${n > 1.5e6 ? ' (heavy, raise mesh density value)' : ''}.`; }
  const params = (): PatternParams => ({ cell: cell.value, line: line.value, amp: amp.value, invert: invert.value, stagger: stagger.value, seed: seed.value });
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-beaker'), 'Surface texture'),
    desc('Subdivides the selected part and pushes vertices in and out along their normals following the pattern. Depth is total peak-to-valley; 0.4 to 1 mm reads well with a 0.4 mm nozzle. Keep bottom flat protects the bed contact.'),
    section('Pattern', preset, kind, cell, line, amp, seed, invert, stagger),
    section('Mapping', depth, proj, mask, keepBottom, refine, estimate),
    section('Smoothing', desc('Soften blurs the pattern before it is applied, turning hard ridges into rounded bumps. Relax runs volume-preserving Taubin smoothing over the displaced vertices to remove faceting; a few passes are enough.'), soften, relax,
      rowBtns(btn('Apply texture', () => { const p = requireManifoldPart('Texture'); if (!p) return; runOp('Texturing', () => applyTexture(project.bakeTransform(p)!, { kind: kind.value as PatternKind, params: params(), depth: depth.value, scale: 1, projection: proj.value as any, refine: refine.value, keepBottom: keepBottom.value, onlyUp: false, mask: mask.value as any, soften: soften.value, relax: relax.value }), (m) => project.replaceManifold(p, m)); }, { primary: true }))),
    h('p', { class: 'note' }, 'Tip: for slicer-side textures instead, export the PNG heightmap from the Patterns panel and use the slicer texture painting tool.'),
  ) as Panel;
  el.refresh = est;
  el.activate = () => {
    const pt = ctx.pendingTexture; if (!pt) return; ctx.pendingTexture = null;
    kind.value = pt.kind; cell.value = pt.params.cell; line.value = pt.params.line; amp.value = pt.params.amp; seed.value = pt.params.seed; invert.value = pt.params.invert; stagger.value = pt.params.stagger; depth.value = pt.depth; preset.value = ''; est();
  };
  return el;
}
