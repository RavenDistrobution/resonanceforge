// Patterns and SVG panel: procedural tiles as SVG/PNG, 3D texture tiles, SVG import to solid.
import { h, btn, num, sel, section, sectionC, desc, rowBtns, icon, fileInput, toast, range, check, color } from '../dom';
import { ctx, addPlaced, runOp, requireManifoldPart, type Panel } from '../ctx';
import { project } from '../../core/project';
import { patternSVG, patternPNG, PATTERN_LABELS, PATTERN_PRESETS, DEFAULT_PATTERN, type PatternKind, type PatternParams } from '../../tools/patterns';
import { applyTexture } from '../../tools/texture';
import { svgToShapes } from '../../core/importers';
import { shapesToPolygons } from '../../core/geom';
import { M } from '../../core/manifold';
import { downloadBlob } from '../../core/exporters';
import { perforatedPanel, perforatePart } from '../../tools/modeling';

export function patternsPanel(): Panel {
  const tileThick = num('Tile base', 2, { min: 0.4, step: 0.2, unit: 'mm' }), tileDepth = num('Relief depth', 1, { min: 0.1, step: 0.1, unit: 'mm' }), tileRes = range('Mesh density', 0.6, { min: 0.2, max: 2, step: 0.1, unit: ' mm' });
  const preset = sel('Preset', [['', 'Custom'], ...PATTERN_PRESETS.map((x) => [x.id, x.label] as [string, string])], '', (v) => { const pr = PATTERN_PRESETS.find((x) => x.id === v); if (!pr) return; kind.value = pr.kind; cell.value = pr.params.cell; line.value = pr.params.line; amp.value = pr.params.amp; seed.value = pr.params.seed; invert.value = pr.params.invert; stagger.value = pr.params.stagger; tileDepth.value = pr.depth; vector.value = false; draw(); });
  const kind = sel('Pattern', Object.entries(PATTERN_LABELS) as [string, string][], 'hex', () => { preset.value = ''; draw(); });
  const cell = range('Cell size', 6, { min: 1, max: 30, step: 0.5, unit: ' mm', onInput: () => draw() });
  const line = range('Line / dot width', 1, { min: 0.2, max: 6, step: 0.1, unit: ' mm', onInput: () => draw() });
  const amp = range('Amplitude', 1, { min: 0, max: 3, step: 0.1, fmt: (v) => v.toFixed(1), onInput: () => draw() });
  const seed = num('Seed', 7, { min: 0, step: 1, onChange: () => draw() });
  const invert = check('Invert', false, () => draw()), stagger = check('Stagger rows', true, () => draw());
  const tileW = num('Tile width', 60, { min: 5, step: 5, unit: 'mm', onChange: () => draw() }), tileH = num('Tile height', 60, { min: 5, step: 5, unit: 'mm', onChange: () => draw() });
  const ink = color('Ink colour', '#0b0b0b', () => draw()), paper = color('Background', '#ffffff', () => draw());
  const vector = check('Vector output (when possible)', true, () => draw());
  const preview = h('div', { class: 'preview pattern' });
  const params = (): PatternParams => ({ cell: cell.value, line: line.value, amp: amp.value, invert: invert.value, stagger: stagger.value, seed: seed.value });
  let svgText = '';
  const VECTOR_KINDS = ['grid', 'stripes', 'knurl', 'triangles', 'hex', 'dots', 'bricks', 'chevron', 'scales'];
  function draw() {
    const k = kind.value as PatternKind;
    svgText = patternSVG(k, params(), { width: tileW.value, height: tileH.value, stroke: ink.value, fill: paper.value, mode: vector.value ? 'vector' : 'raster' });
    if (vector.value && VECTOR_KINDS.includes(k)) preview.innerHTML = svgText;
    else { preview.innerHTML = ''; preview.append(h('img', { src: patternPNG(k, params(), Math.max(tileW.value, tileH.value), 256), style: { width: '100%', display: 'block', imageRendering: 'auto' }, alt: 'pattern height preview (white = raised)' })); }
  }

  const svgHeight = num('Extrude height', 3, { min: 0.2, step: 0.5, unit: 'mm' }), svgWidth = num('Target width', 60, { min: 1, step: 5, unit: 'mm' });
  const texProj = sel('Projection', [['tri', 'Auto (tri-planar)'], ['z', 'From top (XY)'], ['x', 'From side (YZ)'], ['y', 'From front (XZ)'], ['cyl', 'Wrap around Z']], 'tri');
  const texMask = sel('Apply to', [['all', 'All faces'], ['sides', 'Side walls only'], ['top', 'Top faces only']], 'all');
  const texDensity = range('Mesh density', 0.8, { min: 0.2, max: 4, step: 0.1, unit: ' mm' }), texSoften = range('Soften', 0, { min: 0, max: 3, step: 0.1, unit: ' mm' }), texRelax = range('Relax mesh', 0, { min: 0, max: 10, step: 1, unit: ' passes' });
  const texKeep = check('Keep bottom flat', true);
  const pfW = num('Panel width', 100, { min: 10, step: 5, unit: 'mm' }), pfH = num('Panel height', 100, { min: 10, step: 5, unit: 'mm' }), pfT = num('Thickness', 2, { min: 0.4, step: 0.2, unit: 'mm' }), pfMargin = num('Solid margin', 4, { min: 0, step: 1, unit: 'mm' }), pfInv = check('Invert (keep pattern, cut background)', false);
  let svgFile: { text: string; name: string } | null = null; const svgInfo = h('p', { class: 'desc' }, 'No SVG loaded.');
  const svgUpload = fileInput('.svg', async (f) => { svgFile = { text: await f[0].text(), name: f[0].name.replace(/\.svg$/i, '') }; try { const s = svgToShapes(svgFile.text); svgInfo.textContent = `${f[0].name}: ${s.shapes.length} shapes, ${s.width.toFixed(0)} x ${s.height.toFixed(0)} units`; } catch (e: any) { svgInfo.textContent = `Could not parse: ${e.message}`; } });

  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-net'), 'Patterns and SVG'),
    desc('Design a repeating pattern, then export it as SVG (for laser, vinyl, slicer texture painting) or PNG displacement map, print it as a textured tile, or apply it to a part in the Texture panel. Import any SVG to extrude logos and outlines.'),
    section('Pattern', preset, kind, cell, line, amp, seed, invert, stagger, tileW, tileH, ink, paper, vector, preview,
      rowBtns(
        btn('Download SVG', () => downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), `pattern-${kind.value}-${cell.value}mm.svg`), { primary: true }),
        btn('Download PNG heightmap', () => { const url = patternPNG(kind.value as PatternKind, params(), tileW.value, 1024); const a = document.createElement('a'); a.href = url; a.download = `pattern-${kind.value}-heightmap.png`; a.click(); }),
        btn('Copy SVG', async () => { await navigator.clipboard.writeText(svgText); toast('SVG copied', 'good'); }),
      )),
    section('Print this pattern as a tile', desc('Creates a flat tile with the pattern embossed on top. Use it as a texture swatch, a stamp or a decorative panel.'), tileThick, tileDepth, tileRes,
      rowBtns(btn('Create tile part', () => runOp('Build tile', () => { const { Manifold } = M(); const base = Manifold.cube([tileW.value, tileH.value, tileThick.value], true).translate(0, 0, tileThick.value / 2); return applyTexture(base, { kind: kind.value as PatternKind, params: params(), depth: tileDepth.value, scale: 1, projection: 'z', refine: tileRes.value, keepBottom: true, onlyUp: true, mask: 'top' }); }, (m) => addPlaced(m, `Tile ${PATTERN_LABELS[kind.value as PatternKind]}`)), { primary: true }))),
    section('Use as texture on the selected part', desc('Applies this pattern (same cell, line and seed as the preview) as surface displacement to the selected part. Relief depth above sets the height.'), texProj, texMask, texDensity, texSoften, texRelax, texKeep,
      rowBtns(
        btn('Apply to selected part', () => { const p = requireManifoldPart('Texture'); if (!p) return; runOp('Texturing', () => applyTexture(project.bakeTransform(p)!, { kind: kind.value as PatternKind, params: params(), depth: tileDepth.value, scale: 1, projection: texProj.value as any, refine: texDensity.value, keepBottom: texKeep.value, onlyUp: false, mask: texMask.value as any, soften: texSoften.value, relax: texRelax.value }), (m) => project.replaceManifold(p, m)); }, { primary: true }),
        btn('Open in Texture panel', () => { ctx.pendingTexture = { kind: kind.value, params: params(), depth: tileDepth.value }; ctx.setTab('texture'); }),
      )),
    sectionC('Perforated panel (cut the pattern through)', desc('Turns the pattern into holes: a flat panel for speaker grilles, vents, lamp panels and trivets, or cut straight through the selected part along Z. Invert swaps holes and solid.'),
      pfW, pfH, pfT, pfMargin, pfInv, rowBtns(btn('Make perforated panel', () => runOp('Perforated panel', () => perforatedPanel(kind.value as PatternKind, params(), pfW.value, pfH.value, pfT.value, pfInv.value, pfMargin.value), (m) => addPlaced(m, `Perforated ${PATTERN_LABELS[kind.value as PatternKind]}`)), { primary: true }),
        btn('Cut through selected part', () => { const p = requireManifoldPart('Perforate'); if (!p) return; runOp('Perforating', () => perforatePart(project.bakeTransform(p)!, kind.value as PatternKind, params(), pfInv.value), (m) => project.replaceManifold(p, m)); }))),
    sectionC('SVG to solid', rowBtns(btn('Load SVG', () => svgUpload.click())), svgInfo, svgWidth, svgHeight,
      rowBtns(btn('Extrude SVG', () => {
        if (!svgFile) { toast('Load an SVG first.', 'warn'); return; }
        runOp('Extrude SVG', () => { const { CrossSection } = M(); const s = svgToShapes(svgFile!.text); const polys = shapesToPolygons(s.shapes, 10); if (!polys.length) throw new Error('No closed paths in SVG'); let cs = new CrossSection(polys, 'NonZero'); const b = cs.bounds(); const w = b.max[0] - b.min[0]; cs = cs.translate(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2).scale(svgWidth.value / (w || 1)).mirror([0, 1]); return cs.extrude(svgHeight.value); }, (m) => addPlaced(m, svgFile!.name));
      }, { primary: true }))),
  ) as Panel;
  draw();
  void DEFAULT_PATTERN;
  return el;
}
