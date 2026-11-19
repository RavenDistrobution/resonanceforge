// Analyze panel: printability map, layer load chart, hotspots, voxel FEA stress map.
import * as THREE from 'three';
import { h, btn, num, sel, section, sectionC, desc, rowBtns, icon, range, toast, busy, setBusyLabel } from '../dom';
import { ctx, type Panel } from '../ctx';
import { project, type Part } from '../../core/project';
import { analyzeHeuristic, analyzeFEA, colormap, RAMP_CSS, type Heuristic, type FeaResult, type Hotspot } from '../../tools/stress';
import { lines, ramp } from '../charts';

export function analyzePanel(): Panel {
  const overhang = num('Overhang limit', 45, { min: 20, max: 80, step: 5, unit: 'deg' });
  const layersN = num('Layers sampled', 80, { min: 20, max: 300, step: 10 });
  const mapSel = sel('Colour map', [['score', 'Combined risk'], ['thin', 'Wall thickness'], ['sigma', 'Layer load (weight over area)'], ['overhang', 'Overhangs'], ['fea', 'FEA von Mises stress']], 'score', () => applyMap());
  const res = range('FEA resolution', 24, { min: 12, max: 48, step: 2, unit: ' cells' });
  const load = sel('Load case', [['gravity', 'Self weight (gravity)'], ['top', 'Press down on top faces'], ['side', 'Push sideways on -X faces']], 'gravity');
  const iters = num('Max iterations', 600, { min: 50, max: 5000, step: 50 });
  const kv = h('dl', { class: 'kv' }); const hot = h('div'); const chartArea = h('div', { class: 'chart' }); const chartFea = h('div', { class: 'chart' }); const rampEl = h('div'); const feaKv = h('dl', { class: 'kv' });
  let heur: { part: Part; r: Heuristic } | null = null; let fea: { part: Part; r: FeaResult } | null = null;
  let saved: { part: Part; colors: Float32Array | null; color: string } | null = null; let heurMatrixInv = new THREE.Matrix4();
  const markers = new THREE.Group(); let markersAdded = false; void markersAdded;

  function keepOriginal(p: Part) { if (!saved || saved.part !== p) { if (saved) restore(); saved = { part: p, colors: p.faceColors, color: p.color }; } }
  function restore() { if (!saved) return; const p = saved.part; if (project.parts.includes(p)) project.setFaceColors(p, saved.colors); saved = null; markers.clear(); markers.parent?.remove(markers); }
  function applyMap() {
    const p = project.primary; if (!p) return;
    const m = mapSel.value; let values: Float32Array | null = null;
    if (m === 'fea') { if (!fea || fea.part !== p) { toast('Run the FEA first.', 'warn'); return; } values = fea.r.vertexStress; }
    else { if (!heur || heur.part !== p) { toast('Run the printability analysis first.', 'warn'); return; } values = (heur.r as any)[m] as Float32Array; }
    const n = p.object.geometry.getAttribute('position').count; if (values.length !== n) { toast('Geometry changed since the analysis. Run it again.', 'warn'); return; }
    keepOriginal(p); const fc = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const [r, g, b] = colormap(values[i]); fc[i * 3] = r; fc[i * 3 + 1] = g; fc[i * 3 + 2] = b; }
    project.setFaceColors(p, fc); p.faceColors = fc;
    const legends: Record<string, [string, string]> = { score: ['low risk', 'high risk'], thin: ['thick', `thin (< ${(ctx.nozzle * 2).toFixed(1)} mm)`], sigma: ['light load', 'heaviest layer load'], overhang: ['supported', 'steep overhang'], fea: ['0', '95th percentile von Mises'] };
    ramp(rampEl, RAMP_CSS, legends[m][0], legends[m][1]);
  }
  function showMarkers(hs: Hotspot[], p: Part) {
    // markers live in the part's local frame so they follow moves, rotations and undo
    markers.parent?.remove(markers); p.object.add(markers); markersAdded = true; markers.clear();
    p.object.updateMatrixWorld(); const inv = p.object.matrixWorld.clone().invert();
    const colors: Record<string, number> = { critical: 0xd03b3b, serious: 0xec835a, warning: 0xfab219, info: 0x2a78d6 };
    const size = Math.max(1.5, p.object.geometry.boundingSphere ? p.object.geometry.boundingSphere.radius * 0.025 : 2);
    for (const hsp of hs) { const s = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color: colors[hsp.severity], transparent: true, opacity: 0.85, depthTest: false })); s.position.set(...hsp.pos).applyMatrix4(inv); s.renderOrder = 10; markers.add(s); }
  }
  function focus(pos: [number, number, number]) { const v = ctx.viewer; const p = project.primary; const w = new THREE.Vector3(...pos); if (p && heur && heur.part === p) w.applyMatrix4(p.object.matrixWorld.clone().multiply(heurMatrixInv)); v.orbit.target.copy(w); const d = v.camera.position.clone().sub(v.orbit.target); if (d.length() > 120) v.camera.position.copy(v.orbit.target).add(d.setLength(120)); }
  function hotspotList(hs: Hotspot[], p: Part) {
    hot.innerHTML = '';
    if (!hs.length) { hot.append(h('p', { class: 'desc' }, 'No hotspots found at these thresholds. Good sign.')); return; }
    const iconFor: Record<string, string> = { thin: 'i-alert', neck: 'i-layers', overhang: 'i-alert', stress: 'i-bolt', stability: 'i-info' };
    for (const x of hs) hot.append(h('div', { class: 'hot', onClick: () => focus(x.pos) }, h('div', { class: `ic ${x.severity}` }, icon(iconFor[x.kind])), h('div', null, h('h4', null, x.title), h('p', null, x.advice), h('p', { class: 'note' }, `at x ${x.pos[0].toFixed(1)}, y ${x.pos[1].toFixed(1)}, z ${x.pos[2].toFixed(1)} mm`))));
    showMarkers(hs, p);
  }
  async function runHeuristic() {
    const p = project.primary; if (!p) { toast('Select a part.', 'warn'); return; }
    if (saved && saved.part === p) restore();
    const g = project.worldGeometry(p);
    const manifold = p.manifold ? project.bakeTransform(p) : null;
    try {
      const r = await busy('Analysing printability', () => analyzeHeuristic(g, manifold, { overhangAngle: overhang.value, nozzle: ctx.nozzle, layers: layersN.value }, setBusyLabel));
      heur = { part: p, r }; p.object.updateMatrixWorld(); heurMatrixInv = p.object.matrixWorld.clone().invert(); ctx.lastHeuristic = { partId: p.id, result: r, stamp: Date.now() };
      kv.innerHTML = '';
      const rows: [string, string][] = [
        ['Volume', `${(r.volume / 1000).toFixed(2)} cm3`], ['Surface area', `${(r.surfaceArea / 100).toFixed(1)} cm2`],
        ['Thin wall (1st percentile)', `${r.minThickness.toFixed(2)} mm`], ['Overhang area', `${(r.overhangArea / 100).toFixed(1)} cm2 (${((r.overhangArea / r.surfaceArea) * 100).toFixed(1)} % of surface)`],
        ['Support footprint', `${(r.supportFootprint / 100).toFixed(1)} cm2 projected`], ['Centre of gravity height', `${(r.cog.z - r.bbox.min.z).toFixed(1)} mm`],
        ['Stability ratio', `${r.stability.toFixed(2)} ${r.stability > 2.5 ? '(tippy)' : r.stability > 1.4 ? '(use brim)' : '(stable)'}`], ['Bed contact', `${(r.footprintArea / 100).toFixed(1)} cm2`],
      ];
      for (const [k, v] of rows) kv.append(h('dt', null, k), h('dd', null, v));
      const L = r.layers; const amax = Math.max(...L.area);
      lines(chartArea, L.z, [{ name: 'Cross-section area (normalised)', v: L.area.map((a) => a / (amax || 1)), color: 'var(--s1)' }, { name: 'Layer load index', v: L.sigma, color: 'var(--s2)' }], { xlabel: 'Height z (mm)', ylabel: 'relative (0 to 1)', fmt: (v) => v.toFixed(1), H: 260, markers: r.hotspots.filter((x) => x.kind === 'neck').map((x) => ({ x: x.pos[2], label: 'neck' })) });
      hotspotList(r.hotspots, p);
      mapSel.value = 'score'; applyMap();
    } catch (e: any) { console.error(e); toast(`Analysis failed: ${e.message}`, 'bad'); }
  }
  async function runFea() {
    const p = project.primary; if (!p) { toast('Select a part.', 'warn'); return; }
    if (saved && saved.part === p) restore();
    const g = project.worldGeometry(p); const t0 = performance.now();
    try {
      const r = await busy('Voxel FEA', () => analyzeFEA(g, { res: res.value, load: load.value as any, maxIter: iters.value, tol: 1e-4, nu: 0.33 }, (s, f) => setBusyLabel(`${s} ${(f * 100).toFixed(0)} %`)));
      fea = { part: p, r }; feaKv.innerHTML = '';
      const rows: [string, string][] = [['Elements / unknowns', `${r.nElem.toLocaleString()} / ${r.nDof.toLocaleString()}`], ['Solver', `${r.iterations} iterations, residual ${r.residual.toExponential(1)}${r.residual > 1e-3 ? ' (not converged, raise iterations)' : ''}`], ['Peak stress location', `x ${r.maxAt[0].toFixed(1)}, y ${r.maxAt[1].toFixed(1)}, z ${r.maxAt[2].toFixed(1)} mm`], ['Peak / 95th percentile', `${(r.maxStress / (r.p95 || 1)).toFixed(1)} x`], ['Largest deflection at', `x ${r.maxDispAt[0].toFixed(1)}, y ${r.maxDispAt[1].toFixed(1)}, z ${r.maxDispAt[2].toFixed(1)} mm`], ['Time', `${((performance.now() - t0) / 1000).toFixed(1)} s at ${r.vox.h.toFixed(2)} mm cells`]];
      for (const [k, v] of rows) feaKv.append(h('dt', null, k), h('dd', null, v));
      const mx = Math.max(...r.layerMax) || 1;
      lines(chartFea, r.layerZ, [{ name: 'Layer max von Mises (relative)', v: r.layerMax.map((x) => x / mx), color: 'var(--s8)' }, { name: 'Layer mean', v: r.layerMean.map((x) => x / mx), color: 'var(--s3)' }], { xlabel: 'Height z (mm)', ylabel: 'relative stress', fmt: (v) => v.toFixed(1), H: 240, markers: [{ x: r.maxAt[2], label: 'peak' }] });
      const hs: Hotspot[] = [{ kind: 'stress', pos: r.maxAt, value: r.maxStress, severity: 'serious', title: 'Highest stress under this load', advice: 'Layer lines here see the most stress. Add material (fillet, gusset, thicker wall), raise wall count locally, or rotate the part so layers are not loaded in tension across this spot.' }, { kind: 'stress', pos: r.maxDispAt, value: r.maxDisp, severity: 'info', title: 'Largest deflection', advice: 'This is the part of the model that moves most. If it is a thin arm or clip, stiffen it or use a tougher material (PETG, nylon).' }];
      hotspotList([...(heur && heur.part === p ? heur.r.hotspots : []), ...hs], p);
      mapSel.value = 'fea'; applyMap();
    } catch (e: any) { console.error(e); toast(`FEA failed: ${e.message}`, 'bad'); }
  }
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-pulse'), 'Stress and printability'),
    desc('Printability maps thin walls, overhangs and how much weight each layer carries. The voxel FEA runs a real linear-elastic solve on a voxel copy of the part (bottom fixed) and paints relative von Mises stress. Both are estimates to decide where supports, walls or material belong, not certified engineering.'),
    section('Printability map', overhang, layersN, rowBtns(btn('Analyse selected part', runHeuristic, { primary: true })), kv),
    section('Layer load', desc('Blue: cross-section area per layer. Orange: weight above that layer divided by its area; peaks mark necks that carry a lot on little material.'), chartArea),
    sectionC('Voxel FEA (beta)', res, load, iters, rowBtns(btn('Run FEA on selected part', runFea, { primary: true })), feaKv, chartFea),
    section('Colour map', mapSel, rampEl, rowBtns(btn('Restore part colours', () => { restore(); project.emit(); }))),
    section('Hotspots', desc('Click a hotspot to aim the camera at it. Spheres in the viewport mark the same spots.'), hot),
  ) as Panel;
  el.refresh = () => { /* keep results; they are keyed to the part */ };
  el.deactivate = () => { /* leave map visible until restored */ };
  return el;
}
