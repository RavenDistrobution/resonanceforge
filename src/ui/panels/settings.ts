// Settings panel: printer and material presets plus part-aware slicer recommendations.
import * as THREE from 'three';
import { h, btn, sel, section, sectionC, desc, rowBtns, icon, toast, busy, setBusyLabel, num } from '../dom';
import { ctx, type Panel } from '../ctx';
import { project } from '../../core/project';
import { MATERIALS, PRINTERS } from '../../data/materials';
import { analyzeHeuristic, type Heuristic } from '../../tools/stress';
import { downloadBlob } from '../../core/exporters';

export function settingsPanel(): Panel {
  const printer = sel('Printer', PRINTERS.map((p) => [p.id, p.name]) as [string, string][], ctx.printerId, (v) => { const p = PRINTERS.find((x) => x.id === v)!; ctx.printerId = v; ctx.bedSize = [...p.bed] as any; ctx.viewer.setBedSize(p.bed[0], p.bed[1]); bedX.value = p.bed[0]; bedY.value = p.bed[1]; bedZ.value = p.bed[2]; project.emit(); });
  const bedX = num('Bed X', ctx.bedSize[0], { min: 50, step: 10, unit: 'mm', onChange: () => customBed() }), bedY = num('Bed Y', ctx.bedSize[1], { min: 50, step: 10, unit: 'mm', onChange: () => customBed() }), bedZ = num('Height Z', ctx.bedSize[2], { min: 50, step: 10, unit: 'mm', onChange: () => customBed() });
  function customBed() { ctx.bedSize = [bedX.value, bedY.value, bedZ.value]; ctx.viewer.setBedSize(bedX.value, bedY.value); printer.value = 'custom'; project.emit(); }
  const nozzle = sel('Nozzle', [['0.2', '0.2 mm'], ['0.25', '0.25 mm'], ['0.4', '0.4 mm (standard)'], ['0.6', '0.6 mm'], ['0.8', '0.8 mm']], String(ctx.nozzle), (v) => { ctx.nozzle = parseFloat(v); project.emit(); });
  const material = sel('Material', MATERIALS.map((m) => [m.id, m.name]) as [string, string][], project.material, (v) => { project.material = v; matCard(); project.emit(); });
  const use = sel('Part use', [['deco', 'Decorative / display'], ['func', 'Functional (fit, light load)'], ['strong', 'Load bearing / mechanical'], ['flex', 'Flexible / living hinge'], ['litho', 'Lithophane / translucent']], 'func');
  const quality = sel('Priority', [['balanced', 'Balanced'], ['speed', 'Speed'], ['quality', 'Surface quality'], ['strength', 'Strength']], 'balanced');
  const mat = h('div'); const rec = h('div'); const sheet = h('pre', { class: 'sheet' });
  let lastText = '', lastJson: any = null;
  function matCard() {
    const m = MATERIALS.find((x) => x.id === material.value)!; mat.innerHTML = '';
    const rows: [string, string][] = [['Nozzle', `${m.nozzle[0]} to ${m.nozzle[1]} C`], ['Bed', `${m.bed[0]} to ${m.bed[1]} C`], ['Part cooling fan', `${m.fan[0]} to ${m.fan[1]} %`], ['Speed', `${m.speed[0]} to ${m.speed[1]} mm/s`], ['Enclosure', m.enclosure], ['Drying', m.dry], ['Retraction', m.retraction], ['Density', `${m.density} g/cm3`], ['Max service temp', `${m.maxServiceTemp} C`], ['Shrinkage', `about ${m.shrinkage} %`], ['Price', `${m.pricePerKg[0]} to ${m.pricePerKg[1]} USD/kg`]];
    const dl = h('dl', { class: 'kv' }); for (const [k, v] of rows) dl.append(h('dt', null, k), h('dd', null, v));
    mat.append(dl, h('p', { class: 'desc', style: { marginTop: '6px' } }, m.notes), h('p', { class: 'note' }, `Strong: ${m.strengths.join(', ')}. Weak: ${m.weaknesses.join(', ')}.`));
  }
  async function recommend() {
    const p = project.primary; if (!p) { toast('Select a part to get part-specific settings.', 'warn'); return; }
    let r: Heuristic;
    if (ctx.lastHeuristic && ctx.lastHeuristic.partId === p.id && Date.now() - ctx.lastHeuristic.stamp < 120000) r = ctx.lastHeuristic.result;
    else { const g = project.worldGeometry(p); const mf = p.manifold ? project.bakeTransform(p) : null; r = await busy('Measuring part', () => analyzeHeuristic(g, mf, { overhangAngle: 45, nozzle: ctx.nozzle, layers: 60 }, setBusyLabel)); ctx.lastHeuristic = { partId: p.id, result: r, stamp: Date.now() }; }
    const m = MATERIALS.find((x) => x.id === material.value)!; const nz = ctx.nozzle; const pr = PRINTERS.find((x) => x.id === ctx.printerId) ?? PRINTERS[0];
    const size = r.bbox.getSize(new THREE.Vector3()); const maxDim = Math.max(size.x, size.y, size.z), minDim = Math.min(size.x, size.y);
    const u = use.value, q = quality.value;
    // layer height
    let layer = nz * 0.5; if (q === 'speed') layer = nz * 0.7; if (q === 'quality' || u === 'litho' || r.minThickness < nz * 2.5 || maxDim < 30) layer = Math.min(layer, nz * 0.3); if (u === 'litho') layer = Math.min(layer, 0.12);
    layer = Math.round(layer / 0.04) * 0.04; layer = Math.max(0.08, Math.min(layer, nz * 0.75));
    // walls
    let walls = 3; if (u === 'strong' || q === 'strength') walls = 4; if (u === 'deco') walls = 2; if (r.minThickness < nz * 3) walls = Math.max(walls, 3);
    const thinWall = r.minThickness < nz * 2 + 0.05;
    // infill
    let infill = 15, pattern = 'gyroid'; if (u === 'deco') { infill = 10; pattern = 'grid or lightning'; } if (u === 'strong' || q === 'strength') { infill = 30; pattern = 'gyroid or cubic'; } if (u === 'litho') { infill = 100; pattern = 'solid (100 %)'; } if (u === 'flex') { infill = 20; pattern = 'gyroid'; }
    const neck = r.hotspots.find((x) => x.kind === 'neck'); if (neck && u !== 'litho') { infill = Math.max(infill, 25); walls = Math.max(walls, 4); }
    const topBottom = Math.max(4, Math.round(0.8 / layer));
    // supports
    const ovPct = (r.overhangArea / r.surfaceArea) * 100; const supports = r.overhangArea > 20 ? (ovPct > 15 ? 'normal (grid) supports, 45 deg threshold' : 'tree / organic supports, 45 deg threshold') : 'none needed';
    const brim = r.stability > 1.4 || r.footprintArea < 400 || (m.shrinkage >= 0.7 && maxDim > 80) ? `${m.shrinkage >= 0.7 ? 8 : 5} mm brim` : 'skirt only';
    const speedBase = Math.min(pr.maxSpeed, m.speed[1]); const speed = q === 'speed' ? speedBase : q === 'quality' ? Math.round((m.speed[0] + speedBase) / 2) : Math.round(speedBase * 0.75);
    const tempIdx = q === 'strength' || u === 'strong' ? 0.75 : q === 'quality' ? 0.3 : 0.5; const temp = Math.round((m.nozzle[0] + (m.nozzle[1] - m.nozzle[0]) * tempIdx) / 5) * 5;
    const fan = r.overhangArea > 20 && m.fan[1] > 30 ? m.fan[1] : Math.round((m.fan[0] + m.fan[1]) / 2);
    const volMm3 = r.volume; const shellVol = r.surfaceArea * walls * nz * 0.9 + 2 * r.footprintArea * topBottom * layer; const effVol = Math.min(volMm3, shellVol + Math.max(0, volMm3 - shellVol) * (infill / 100));
    const grams = (effVol / 1000) * m.density; const cost = (grams / 1000) * ((m.pricePerKg[0] + m.pricePerKg[1]) / 2);
    const flow = layer * nz * speed * 0.6; const minutes = effVol / (flow || 1) / 60 * 1.35 + 6;
    const orient = r.stability > 2.5 ? 'Lay the part down or split it: it is tall for its footprint.' : ovPct > 25 ? 'Rotate so the largest overhang faces up or touches the bed (Parts > Lay flat).' : 'Current orientation is fine.';
    const lines: [string, string][] = [
      ['Printer', `${pr.name}, ${nz} mm nozzle`], ['Material', m.name], ['Layer height', `${layer.toFixed(2)} mm (first layer ${(layer * 1.25).toFixed(2)} mm)`], ['Line width', `${(nz * 1.1).toFixed(2)} mm`],
      ['Walls', `${walls} perimeters${thinWall ? ', enable thin wall / arachne' : ''}`], ['Top / bottom', `${topBottom} layers`], ['Infill', `${infill} % ${pattern}`], ['Supports', supports],
      ['Adhesion', brim], ['Nozzle temp', `${temp} C`], ['Bed temp', `${m.bed[0]} to ${m.bed[1]} C`], ['Fan', `${fan} % (first layer 0 %)`], ['Speed', `${speed} mm/s outer wall ${Math.round(speed * 0.6)} mm/s`],
      ['Retraction', m.retraction], ['Enclosure', m.enclosure], ['Orientation', orient], ['Estimated filament', `${grams.toFixed(0)} g, about ${cost.toFixed(2)} USD`], ['Rough print time', `${minutes > 90 ? (minutes / 60).toFixed(1) + ' h' : minutes.toFixed(0) + ' min'} (order of magnitude; the slicer knows better)`],
    ];
    if (m.enclosure === 'required') lines.push(['Note', 'Close the enclosure and let it warm 10 min before printing.']); if (m.id === 'TPU') lines.push(['Note', 'Direct drive only. Disable retraction tricks, print slow and steady.']); if (u === 'litho') lines.push(['Note', 'Print standing up, 100 % infill, no top/bottom distinction. Dark areas thick.']);
    rec.innerHTML = ''; const dl = h('dl', { class: 'kv' }); for (const [k, v] of lines) dl.append(h('dt', null, k), h('dd', null, v)); rec.append(dl);
    lastText = `${p.name} print settings (ResonanceForge)\n` + lines.map(([k, v]) => `${k}: ${v}`).join('\n');
    lastJson = { part: p.name, printer: pr.id, nozzle_mm: nz, material: m.id, layer_height_mm: layer, first_layer_height_mm: +(layer * 1.25).toFixed(2), line_width_mm: +(nz * 1.1).toFixed(2), wall_loops: walls, top_bottom_layers: topBottom, sparse_infill_percent: infill, sparse_infill_pattern: pattern, supports, brim, nozzle_temperature_c: temp, bed_temperature_c: m.bed, fan_percent: fan, speed_mm_s: speed, outer_wall_speed_mm_s: Math.round(speed * 0.6), retraction: m.retraction, enclosure: m.enclosure, estimated_filament_g: +grams.toFixed(1), overhang_area_mm2: +r.overhangArea.toFixed(1), min_wall_mm: +r.minThickness.toFixed(2) };
    sheet.textContent = lastText;
  }
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-list'), 'Recommended settings'),
    desc('Pick the printer and material, then let the part analysis drive layer height, walls, infill, supports and adhesion. Copy the sheet into your slicer or the model description.'),
    section('Printer', printer, bedX, bedY, bedZ, nozzle),
    section('Material', material, mat),
    section('Part-aware recommendation', use, quality, rowBtns(btn('Recommend for selected part', recommend, { primary: true })), rec,
      rowBtns(btn('Copy as text', async () => { if (!lastText) return; await navigator.clipboard.writeText(lastText); toast('Copied', 'good'); }), btn('Download JSON', () => { if (!lastJson) return; downloadBlob(new Blob([JSON.stringify(lastJson, null, 2)], { type: 'application/json' }), `${lastJson.part}-settings.json`); })), sheet),
    sectionC('Material comparison', h('div', { class: 'tbl' }, h('table', { class: 'mat-table' }, h('thead', null, h('tr', null, ...['Material', 'Nozzle C', 'Bed C', 'Fan %', 'Enclosure', 'Max use C'].map((t) => h('th', null, t)))), h('tbody', null, ...MATERIALS.map((m) => h('tr', null, h('td', null, m.name), h('td', { class: 'n' }, `${m.nozzle[0]}-${m.nozzle[1]}`), h('td', { class: 'n' }, `${m.bed[0]}-${m.bed[1]}`), h('td', { class: 'n' }, `${m.fan[0]}-${m.fan[1]}`), h('td', null, m.enclosure), h('td', { class: 'n' }, String(m.maxServiceTemp)))))))),
  ) as Panel;
  matCard();
  return el;
}
