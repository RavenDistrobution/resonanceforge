// ResonanceForge entry: boots Manifold, builds the workspace shell, wires panels, import/export and shortcuts.
import icons from './ui/icons.svg?raw';
import { initManifold, M } from './core/manifold';
import { project } from './core/project';
import { Viewer } from './viewer/scene';
import { h, btn, icon, toast, busy, sel } from './ui/dom';
import { ctx, type Panel, dropToBed } from './ui/ctx';
import { importFile } from './core/importers';
import { exportSTL, export3MF, downloadBlob, resolveForExport, exportProject3MF } from './core/exporters';
import { zipSync } from 'fflate';
import { scheduleSessionSave, loadSession, loadPrefs, savePref, armSession } from './core/session';
import { PRINTERS as PRINTER_LIST } from './data/materials';
import { buildLegend } from './ui/legend';
import { PRINTERS } from './data/materials';
import { partsPanel } from './ui/panels/parts';
import { createPanel } from './ui/panels/create';
import { textPanel } from './ui/panels/text';
import { imagePanel } from './ui/panels/image';
import { patternsPanel } from './ui/panels/patternsPanel';
import { texturePanel } from './ui/panels/texturePanel';
import { paintPanel } from './ui/panels/paint';
import { jointsPanel } from './ui/panels/jointsPanel';
import { analyzePanel } from './ui/panels/analyze';
import { settingsPanel } from './ui/panels/settings';
import { marketPanel } from './ui/panels/market';
import { drawPanel } from './ui/panels/draw';
import { draw3dPanel } from './ui/panels/draw3d';
import { makePrimitive } from './tools/primitives';
import { verifySignature, onKonami, ICON_DATA_URL, SIGNATURE } from './brand/brand';
import * as THREE from 'three';

async function main() {
  const app = document.getElementById('app')!;
  if (!verifySignature()) { app.innerHTML = '<div class="card" style="margin:40px auto;max-width:520px"><h3>Signature missing</h3><p>This build is incomplete: the authorship signature is required. Restore src/brand/brand.ts from the original distribution.</p></div>'; return; }
  const fav = document.querySelector('link[rel=icon]') as HTMLLinkElement | null; if (fav) fav.href = ICON_DATA_URL;
  (document.documentElement as HTMLElement).dataset.rf = SIGNATURE.slice(0, 16);
  const sprite = document.createElement('div'); sprite.innerHTML = icons; sprite.firstElementChild!.setAttribute('style', 'display:none'); document.body.prepend(sprite.firstElementChild!);
  app.append(h('div', { class: 'busy' }, h('div', { class: 'spin' }), h('div', { class: 'busy-l' }, 'Loading geometry engine')));
  try { await initManifold(); } catch (e: any) { app.innerHTML = `<div class="card" style="margin:40px auto;max-width:600px"><h3>Could not load the geometry engine</h3><p>${e?.message ?? e}</p><p>Serve the app with start.sh / start.bat (not file://) and use a current Chrome, Edge, Firefox or Safari.</p></div>`; return; }
  app.innerHTML = '';
  const prefs = loadPrefs(); if (prefs.theme) document.documentElement.setAttribute('data-theme', prefs.theme); if (prefs.printer && PRINTER_LIST.some((x) => x.id === prefs.printer)) { ctx.printerId = prefs.printer; const pp = PRINTER_LIST.find((x) => x.id === prefs.printer)!; ctx.bedSize = [...pp.bed] as any; } if (prefs.nozzle) ctx.nozzle = parseFloat(prefs.nozzle) || 0.4; if (prefs.material) project.material = prefs.material;

  // ---------- top bar
  const fileIn = h('input', { type: 'file', accept: '.stl,.3mf,.obj', multiple: true, style: { display: 'none' } });
  fileIn.addEventListener('change', async () => { if (fileIn.files) await importFiles(Array.from(fileIn.files)); fileIn.value = ''; });
  async function importFiles(files: File[]) {
    for (const f of files) {
      try { const parts = await busy(`Importing ${f.name}`, () => importFile(f)); for (const p of parts) dropToBed(p); project.emit(); viewer.fitView(parts); const mo = parts.filter((p) => !p.manifold); toast(mo.length ? `${f.name}: ${parts.length} part(s), ${mo.length} not watertight (${mo[0].manifoldError}). Use Parts > Repair before booleans.` : `${f.name}: ${parts.length} part(s) imported`, mo.length ? 'warn' : 'good', 5000); }
      catch (e: any) { toast(`${f.name}: ${e.message}`, 'bad', 6000); }
    }
  }
  const exportParts = () => {
    const sel2 = project.selected.filter((p) => p.visible); let list = sel2.length ? sel2 : project.parts.filter((p) => p.visible);
    // a selection of only positives still gets every visible negative applied, so a cutter does not need to be selected too
    if (sel2.length) list = [...list, ...project.parts.filter((p) => p.visible && p.role === 'negative' && !list.includes(p))];
    if (!list.filter((p) => p.role !== 'negative').length) { toast('Nothing to export (negatives alone are not printed).', 'warn'); return []; }
    const info = { negativesApplied: 0, skipped: [] as string[] };
    const out = resolveForExport(list, (p) => project.bakeTransform(p), info);
    if (info.negativesApplied) toast(`${info.negativesApplied} negative part(s) subtracted on export.`, 'info');
    if (info.skipped.length) toast(`Could not subtract negatives from mesh-only part(s): ${info.skipped.join(', ')}. Repair them first.`, 'warn', 6000);
    return out;
  };
  const fname = () => (project.parts.length === 1 ? project.parts[0].name : 'resonanceforge-scene').replace(/[^\w.-]+/g, '_');
  const undoB = btn('Undo', () => { if (!project.undo()) toast('Nothing to undo', 'info'); }, { icon: 'i-refresh', title: 'Ctrl/Cmd+Z' });
  const redoB = btn('Redo', () => { if (!project.redo()) toast('Nothing to redo', 'info'); }, { title: 'Ctrl/Cmd+Shift+Z' });
  const printerSel = sel('', PRINTERS.map((p) => [p.id, p.name]) as [string, string][], ctx.printerId, (v) => { const p = PRINTERS.find((x) => x.id === v)!; ctx.printerId = v; ctx.bedSize = [...p.bed] as any; viewer.setBedSize(p.bed[0], p.bed[1]); savePref('printer', v); project.emit(); });
  printerSel.querySelector('span')!.remove();
  const themeB = btn('Theme', () => { const r = document.documentElement; const cur = r.getAttribute('data-theme'); const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.setAttribute('data-theme', dark ? 'light' : 'dark'); savePref('theme', dark ? 'light' : 'dark'); }, { icon: 'i-sun' });
  const top = h('div', { class: 'topbar' },
    fileIn,
    h('div', { class: 'brand' }, icon('i-pulse'), 'ResonanceForge', h('small', null, '3D print studio')),
    btn('Import', () => fileIn.click(), { icon: 'i-doc', title: 'STL, 3MF, OBJ' }),
    btn('Export STL', () => { const l = exportParts(); if (l.length) downloadBlob(exportSTL(l), `${fname()}.stl`); }, { title: 'Selected parts, or all when nothing is selected' }),
    btn('Export 3MF', () => { const l = exportParts(); if (l.length) downloadBlob(export3MF(l, { title: fname() }), `${fname()}.3mf`); }, { primary: true, title: 'Keeps per-triangle paint colours' }),
    btn('3MF split by colour', () => { const l = exportParts(); if (l.length) downloadBlob(export3MF(l, { splitByColor: true, title: fname() }), `${fname()}-by-colour.3mf`); }, { title: 'One object per colour for multi-material slicers' }),
    btn('ZIP of STLs', () => { const l = exportParts(); if (!l.length) return; const files: Record<string, Uint8Array> = {}; l.filter((p) => p.role === 'part').forEach((p, i) => { files[`${String(i + 1).padStart(2, '0')}-${p.name.replace(/[^\w.-]+/g, '_')}.stl`] = new Uint8Array(0); }); (async () => { const entries: Record<string, Uint8Array> = {}; for (const p of l.filter((x) => x.role === 'part')) entries[`${p.name.replace(/[^\w.-]+/g, '_')}.stl`] = new Uint8Array(await exportSTL([p]).arrayBuffer()); downloadBlob(new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }), `${fname()}-parts.zip`); })(); void files; }, { title: 'One STL per part, zipped (what most repositories want)' }),
    btn('Save project', () => { if (!project.parts.length) { toast('Nothing to save.', 'warn'); return; } downloadBlob(exportProject3MF(project.parts, fname()), `${fname()}-project.3mf`); toast('Project saved as 3MF with part roles. Import it later to continue.', 'good'); }, { title: 'All parts incl. negatives and modifiers, nothing subtracted; re-import restores roles' }),
    undoB, redoB,
    h('span', { class: 'sp' }),
    printerSel, themeB,
    btn('Screenshot', () => { const a = document.createElement('a'); a.href = viewer.screenshot(); a.download = `${fname()}.png`; a.click(); }),
  );

  // ---------- viewport
  const vp = h('div', { class: 'viewport' });
  const viewer = new Viewer(vp); ctx.viewer = viewer;
  const gz = (label: string, mode: 'translate' | 'rotate' | 'scale', key: string) => btn(label, () => { viewer.setGizmoMode(mode); viewer.setMode('select'); for (const b of gzBtns) b.setAttribute('aria-pressed', b === btnMap[mode] ? 'true' : 'false'); }, { title: `Key ${key}` });
  const btnMap = { translate: gz('Move', 'translate', 'W'), rotate: gz('Rotate', 'rotate', 'E'), scale: gz('Scale', 'scale', 'R') };
  const gzBtns = Object.values(btnMap); btnMap.translate.setAttribute('aria-pressed', 'true');
  const hint = h('div', { class: 'vp-hint' }, 'Left-drag orbit, right-drag pan, wheel zoom. Click a part to select, shift-click to add.');
  const hintFor = (m: string) => (m === 'select' ? 'Left-drag orbit, right-drag pan, wheel zoom. Click a part to select, shift-click to add.' : 'Left-drag uses the tool. Right-drag orbit, middle-drag pan, wheel zoom, Space + left-drag orbit.');
  const origSetMode = viewer.setMode.bind(viewer); viewer.setMode = (m) => { origSetMode(m); hint.textContent = hintFor(m); };
  const view = (label: string, dir: [number, number, number], title: string) => btn(label, () => { const box = new THREE.Box3(); const list = project.parts.filter((p) => p.visible); if (list.length) for (const p of list) { p.object.updateMatrixWorld(); box.expandByObject(p.object); } else box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50)); const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()).length() || 50; viewer.orbit.target.copy(c); viewer.camera.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(size * 1.4 + 20)); viewer.camera.up.set(0, 0, 1); }, { title });
  const measureOut = h('div', { class: 'vp-measure', style: { display: 'none' } });
  let measurePts: THREE.Vector3[] = []; const measureGroup = new THREE.Group(); viewer.scene.add(measureGroup);
  const measureBtn = btn('Measure', () => { const on = viewer.mode !== 'place' || viewer.onPlace !== measurePlace; if (on) { measurePts = []; measureGroup.clear(); viewer.onPlace = measurePlace; viewer.setMode('place'); measureOut.style.display = ''; measureOut.textContent = 'Click two points on parts to measure.'; measureBtn.setAttribute('aria-pressed', 'true'); } else { viewer.onPlace = null; viewer.setMode('select'); measureOut.style.display = 'none'; measureGroup.clear(); measureBtn.setAttribute('aria-pressed', 'false'); } }, { title: 'Distance between two clicked points' });
  function measurePlace(hit: { point: THREE.Vector3; part?: import('./core/project').Part }) {
    measurePts.push(hit.point.clone()); const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xeb6834, depthTest: false })); s.position.copy(hit.point); s.renderOrder = 40; measureGroup.add(s);
    if (measurePts.length === 2) { const [a, b] = measurePts; const d = a.distanceTo(b); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xeb6834, depthTest: false })); line.renderOrder = 40; measureGroup.add(line);
      const target = h('input', { type: 'number', step: 0.5, value: d.toFixed(2), style: { width: '70px', font: 'inherit', fontSize: '12px', padding: '1px 6px', borderRadius: '6px', border: '1px solid var(--glass-edge)' } });
      const scaleBtn = btn('Scale selected to this', () => { const p = hit.part; const v = parseFloat(target.value); if (!(v > 0) || !p) return; project.snapshot(); p.object.scale.multiplyScalar(v / d); p.object.updateMatrixWorld(); dropToBed(p); project.emit(); toast(`Scaled ${p.name} by ${(v / d).toFixed(3)} x`, 'good'); }, { cls: 'sm', title: 'Uniformly scale the clicked part so this distance becomes the typed value (great for scans and downloads without units)' });
      measureOut.innerHTML = ''; measureOut.append(`Distance ${d.toFixed(2)} mm  (dx ${Math.abs(b.x - a.x).toFixed(2)}, dy ${Math.abs(b.y - a.y).toFixed(2)}, dz ${Math.abs(b.z - a.z).toFixed(2)})  set to `, target, ' mm ', scaleBtn); measurePts = []; }
    else measureOut.textContent = `First point (${hit.point.x.toFixed(1)}, ${hit.point.y.toFixed(1)}, ${hit.point.z.toFixed(1)}). Click the second point.`;
  }
  // section view: a clipping plane that slides along an axis so you can look inside parts
  const secAxis = h('select', null, h('option', { value: 'z' }, 'Z'), h('option', { value: 'x' }, 'X'), h('option', { value: 'y' }, 'Y'));
  const secRange = h('input', { type: 'range', min: 0, max: 100, value: 100, step: 0.5 }); const secOn = h('input', { type: 'checkbox' });
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6); viewer.renderer.localClippingEnabled = true;
  function applySection() {
    const on = secOn.checked; const box = new THREE.Box3(); for (const p of project.parts.filter((p) => p.visible)) { p.object.updateMatrixWorld(); box.expandByObject(p.object); }
    const ax = secAxis.value as 'x' | 'y' | 'z'; const t = parseFloat(secRange.value) / 100; const v = box.isEmpty() ? 0 : box.min[ax] + (box.max[ax] - box.min[ax]) * t;
    clipPlane.normal.set(ax === 'x' ? -1 : 0, ax === 'y' ? -1 : 0, ax === 'z' ? -1 : 0); clipPlane.constant = v;
    for (const p of project.parts) { const m = p.object.material as THREE.MeshStandardMaterial; m.clippingPlanes = on ? [clipPlane] : []; m.clipShadows = true; m.side = on ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; }
  }
  secRange.addEventListener('input', applySection); secAxis.addEventListener('change', applySection); secOn.addEventListener('change', applySection); project.onChange(() => { if (secOn.checked) applySection(); });
  const sectionBar = h('div', { class: 'vp-section' }, h('label', null, secOn, ' Section view'), secAxis, secRange);
  vp.append(h('div', { class: 'vp-tools' }, ...gzBtns, btn('Fit', () => viewer.fitView(), { title: 'Key F' }), btn('Drop all to bed', () => { project.snapshot(); for (const p of project.parts) dropToBed(p); project.emit(); }), btn('Arrange', () => arrange()), measureBtn),
    h('div', { class: 'vp-views' }, view('Iso', [1, -1, 0.8], 'Isometric view'), view('Top', [0, 0, 1], 'Top view'), view('Front', [0, -1, 0.001], 'Front view (looking +Y)'), view('Right', [1, 0, 0.001], 'Right view (looking -X)')), sectionBar, measureOut, hint);
  vp.addEventListener('dragover', (e) => { e.preventDefault(); vp.classList.add('drop'); });
  vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
  vp.addEventListener('drop', async (e) => { e.preventDefault(); vp.classList.remove('drop'); if (e.dataTransfer?.files.length) await importFiles(Array.from(e.dataTransfer.files)); });
  viewer.onTransform = () => { throttleRefresh(); };
  function arrange() {
    project.snapshot(); const parts = project.parts.filter((p) => p.visible); const gap = 8; let x = -ctx.bedSize[0] / 2 + gap, y = -ctx.bedSize[1] / 2 + gap, rowH = 0;
    for (const p of parts) { p.object.updateMatrixWorld(); const b = p.object.geometry.boundingBox!.clone().applyMatrix4(p.object.matrixWorld); const w = b.max.x - b.min.x, d = b.max.y - b.min.y; if (x + w > ctx.bedSize[0] / 2 && x > -ctx.bedSize[0] / 2 + gap) { x = -ctx.bedSize[0] / 2 + gap; y += rowH + gap; rowH = 0; } p.object.position.x += x - b.min.x; p.object.position.y += y - b.min.y; p.object.position.z -= b.min.z; p.object.updateMatrixWorld(); x += w + gap; rowH = Math.max(rowH, d); }
    project.emit();
  }

  // ---------- side panels
  const tabs: { id: string; label: string; icon: string; make: () => Panel }[] = [
    { id: 'parts', label: 'Parts', icon: 'i-layers', make: partsPanel }, { id: 'create', label: 'Create', icon: 'i-cpu', make: createPanel }, { id: 'text', label: 'Text', icon: 'i-doc', make: textPanel },
    { id: 'image', label: 'Image', icon: 'i-chart', make: imagePanel }, { id: 'patterns', label: 'Patterns', icon: 'i-net', make: patternsPanel }, { id: 'texture', label: 'Texture', icon: 'i-beaker', make: texturePanel },
    { id: 'draw', label: 'Draw', icon: 'i-beaker', make: drawPanel }, { id: 'draw3d', label: 'Free draw', icon: 'i-flame', make: draw3dPanel }, { id: 'paint', label: 'Paint', icon: 'i-flame', make: paintPanel }, { id: 'joints', label: 'Joints', icon: 'i-bolt', make: jointsPanel }, { id: 'analyze', label: 'Analyze', icon: 'i-pulse', make: analyzePanel },
    { id: 'settings', label: 'Print settings', icon: 'i-list', make: settingsPanel }, { id: 'market', label: 'Share', icon: 'i-shield', make: marketPanel },
  ];
  const groups: { label: string; ids: string[] }[] = [
    { label: 'Build', ids: ['create', 'text', 'image', 'patterns', 'draw', 'draw3d'] },
    { label: 'Shape', ids: ['parts', 'joints', 'texture', 'paint'] },
    { label: 'Print', ids: ['analyze', 'settings', 'market'] },
  ];
  const panels = new Map<string, Panel>(); const tabBar = h('div', { class: 'tabs' }); const host = h('div', { style: { minHeight: 0, display: 'grid' } });
  let active: Panel | null = null, activeId = '';
  function setTab(id: string) {
    const t = tabs.find((x) => x.id === id)!; let p = panels.get(id); if (!p) { p = t.make(); panels.set(id, p); }
    if (active && active !== p) active.deactivate?.();
    host.innerHTML = ''; host.append(p); active = p; activeId = id; p.refresh?.(); p.activate?.();
    for (const b of tabButtons) b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false');
  }
  ctx.setTab = setTab;
  const tabButtons: HTMLButtonElement[] = [];
  for (const g of groups) { const row = h('div', { class: 'grp' }); for (const id of g.ids) { const t = tabs.find((x) => x.id === id)!; const b = btn(t.label, () => setTab(t.id), { icon: t.icon }); b.dataset.id = t.id; tabButtons.push(b); row.append(b); } tabBar.append(h('span', { class: 'grp-l' }, g.label), row); }
  const side = h('div', { class: 'side' }, tabBar, host);

  // ---------- status bar
  const status = h('div', { class: 'statusbar' });
  function refreshStatus() {
    const tris = project.parts.reduce((s, p) => s + p.object.geometry.getAttribute('position').count / 3, 0);
    const p = project.primary; const printer = PRINTERS.find((x) => x.id === ctx.printerId);
    status.innerHTML = '';
    const sz = p ? (() => { p.object.updateMatrixWorld(); const g = p.object.geometry; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox!.clone().applyMatrix4(p.object.matrixWorld); const v = b.getSize(new THREE.Vector3()); return ` ${v.x.toFixed(1)} x ${v.y.toFixed(1)} x ${v.z.toFixed(1)} mm`; })() : '';
    status.append(h('span', null, h('b', null, String(project.parts.length)), ' parts'), h('span', null, h('b', null, tris.toLocaleString()), ' triangles'), h('span', null, 'Selected: ', h('b', null, p ? p.name : 'none'), p ? (p.manifold ? ' (watertight)' : ' (mesh-only)') + sz : ''), h('span', null, 'Bed: ', h('b', null, `${ctx.bedSize[0]} x ${ctx.bedSize[1]} x ${ctx.bedSize[2]} mm`), printer && printer.id !== 'custom' ? ` ${printer.name.split(' (')[0]}` : ''), h('span', null, 'Nozzle: ', h('b', null, `${ctx.nozzle} mm`)), h('span', { class: 'sp' }), h('span', null, 'Material: ', h('b', null, project.material)));
    undoB.disabled = !project.canUndo; redoB.disabled = !project.canRedo;
  }
  let raf = 0; function throttleRefresh() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; active?.refresh?.(); refreshStatus(); }); }
  project.onChange(() => { throttleRefresh(); if (printerSel.value !== ctx.printerId) printerSel.value = ctx.printerId; scheduleSessionSave(); savePref('material', project.material); savePref('nozzle', String(ctx.nozzle)); });
  viewer.onTransform = () => { throttleRefresh(); scheduleSessionSave(); };
  // explode view: spread parts away from the scene centre for assembly screenshots; toggling back restores positions
  let exploded: Map<string, THREE.Vector3> | null = null;
  const explodeBtn = btn('Explode', () => {
    if (exploded) { for (const p of project.parts) { const o = exploded.get(p.id); if (o) p.object.position.copy(o); p.object.updateMatrixWorld(); } exploded = null; explodeBtn.setAttribute('aria-pressed', 'false'); project.emit(); return; }
    const list = project.parts.filter((p) => p.visible); if (list.length < 2) { toast('Explode needs two or more parts.', 'info'); return; }
    const c = new THREE.Vector3(); list.forEach((p) => c.add(worldBoxOf(p).getCenter(new THREE.Vector3()))); c.divideScalar(list.length); exploded = new Map();
    for (const p of list) { exploded.set(p.id, p.object.position.clone()); const d = worldBoxOf(p).getCenter(new THREE.Vector3()).sub(c); p.object.position.add(d.multiplyScalar(0.8).add(new THREE.Vector3(0, 0, 0))); p.object.updateMatrixWorld(); }
    explodeBtn.setAttribute('aria-pressed', 'true'); project.emit();
  }, { title: 'Spread parts apart to see an assembly; click again to restore' });
  function worldBoxOf(p: import('./core/project').Part) { p.object.updateMatrixWorld(); const g = p.object.geometry; if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox!.clone().applyMatrix4(p.object.matrixWorld); }
  (vp.querySelector('.vp-tools') as HTMLElement).append(explodeBtn);

  app.append(top, h('div', { class: 'main' }, vp, side), status);
  buildLegend();
  onKonami(() => { if (document.querySelector('.egg')) return; const egg = h('div', { class: 'egg', onClick: () => egg.remove() }, h('div', { class: 'pane' }, h('img', { src: ICON_DATA_URL, alt: '' }), h('h3', { style: { fontSize: '26px', margin: '4px 0 6px' } }, 'Get ducked'), h('p', { class: 'note' }, 'Click anywhere to close.'))); document.body.append(egg); });
  (window as any).resonanceforge = { project, ctx, viewer, THREE, manifold: M() }; // console access for scripting and debugging
  setTab('parts'); refreshStatus();
  viewer.setBedSize(ctx.bedSize[0], ctx.bedSize[1]);

  // ---------- keyboard
  document.addEventListener('keydown', (e) => {
    const tgt = e.target as HTMLElement; if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) project.redo(); else project.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); project.redo(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); const p = project.primary; if (p) project.duplicate(p); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (project.selection.length) project.remove([...project.selection]); }
    else if (e.key.toLowerCase() === 'w') btnMap.translate.click(); else if (e.key.toLowerCase() === 'e') btnMap.rotate.click(); else if (e.key.toLowerCase() === 'r') btnMap.scale.click();
    else if (e.key.toLowerCase() === 'f') viewer.fitView(project.selected);
    else if (e.key === 'Escape' && viewer.mode === 'select') project.select([]);
    else if (viewer.mode === 'select' && project.selected.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) { e.preventDefault(); const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; const d = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, step, 0], ArrowDown: [0, -step, 0], PageUp: [0, 0, step], PageDown: [0, 0, -step] }[e.key]!; project.snapshot(); for (const p of project.selected) { p.object.position.x += d[0]; p.object.position.y += d[1]; p.object.position.z += d[2]; p.object.updateMatrixWorld(); } project.emit(); }
    else if (e.key === 'Enter' && viewer.mode === 'draw') { /* handled by draw panel */ }
  });

  // ---------- offer to restore the previous session
  const saved = await loadSession();
  if (saved && saved.parts > 0) {
    const bar = h('div', { class: 'toast good', style: { position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: '70px', zIndex: '300', display: 'flex', gap: '10px', alignItems: 'center' } }, `Previous session found (${saved.parts} part${saved.parts > 1 ? 's' : ''}, ${new Date(saved.when).toLocaleString()}).`,
      btn('Restore', async () => { bar.remove(); project.remove(project.parts.map((p) => p.id), false); await importFiles([new File([saved.blob], 'session.3mf')]); viewer.fitView(); armSession(); }, { primary: true }), btn('Dismiss', () => { bar.remove(); armSession(); }));
    document.body.append(bar); setTimeout(() => { if (bar.isConnected) { bar.remove(); armSession(); } }, 60000);
  } else armSession();
  // ---------- starter part so the workspace is never empty
  if (!project.parts.length) { const m = makePrimitive('roundedBox', { w: 40, d: 30, h: 16, r: 0, r2: 0, seg: 32, teeth: 0, fillet: 3, pitch: 1.5, turns: 5 }); project.addManifold(m, 'Sample block', '#8fb3e8', false); project.select([]); viewer.fitView(); }
  void activeId;
}
main();
// installable app: register the service worker on real hosts (not the dev server) so the page works offline once visited
if ('serviceWorker' in navigator && !location.hostname.startsWith('127.') && location.hostname !== 'localhost') { window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* optional */ }); }); }
