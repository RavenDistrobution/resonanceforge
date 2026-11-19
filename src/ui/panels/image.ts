// Image panel: relief / lithophane, silhouette extrusion, cookie cutter.
import { h, btn, num, sel, section, sectionC, desc, rowBtns, icon, fileInput, toast, range, check } from '../dom';
import { addPlaced, runOp, type Panel } from '../ctx';
import { loadImage, rasterize, relief, silhouette, cookieCutter, blur, type Raster } from '../../tools/image2mesh';
import { wrapCylinder } from '../../tools/modeling';
import { applyTexture } from '../../tools/texture';
import { project } from '../../core/project';
import { requireManifoldPart } from '../ctx';
import { DEFAULT_PATTERN } from '../../tools/patterns';

export function imagePanel(): Panel {
  let img: HTMLImageElement | null = null; let name = 'image';
  const preview = h('canvas', { class: 'preview', width: 360, height: 240 });
  const mode = sel('Mode', [['relief', 'Relief / heightmap (bright = high)'], ['litho', 'Lithophane (dark = thick)'], ['silhouette', 'Silhouette extrude'], ['cutter', 'Cookie cutter']], 'relief', () => upd());
  const width = num('Width', 80, { min: 5, step: 5, unit: 'mm' });
  const res = range('Resolution', 3, { min: 1, max: 8, step: 0.5, unit: ' px/mm' });
  const base = num('Base thickness', 0.8, { min: 0.2, step: 0.2, unit: 'mm' }), depth = num('Relief depth', 2.5, { min: 0.1, step: 0.1, unit: 'mm' });
  const smooth = range('Smoothing', 1, { min: 0, max: 6, step: 1, unit: ' px' }), border = num('Frame border', 0, { min: 0, step: 1, unit: ' px' });
  const gamma = range('Gamma', 1, { min: 0.3, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) });
  const mirror = check('Mirror (for back-lit)', false);
  const curve = num('Curve radius (0 = flat)', 0, { min: 0, step: 10, unit: 'mm' });
  const height = num('Extrude height', 5, { min: 0.2, step: 0.5, unit: 'mm' });
  const thresh = range('Threshold', 0.5, { min: 0.02, max: 0.98, step: 0.02, fmt: (v) => v.toFixed(2), onInput: () => draw() });
  const dark = check('Dark pixels are solid', true, () => draw());
  const simp = range('Simplify', 0.8, { min: 0, max: 4, step: 0.1, unit: ' px' }), smoothC = range('Smooth corners', 1, { min: 0, max: 4, step: 1, unit: ' x' });
  const minArea = num('Drop islands under', 2, { min: 0, step: 1, unit: 'mm2' });
  const wall = num('Blade thickness', 1.2, { min: 0.4, step: 0.2, unit: 'mm' }), cHeight = num('Blade height', 15, { min: 3, step: 1, unit: 'mm' }), flange = num('Flange width', 4, { min: 0, step: 1, unit: 'mm' }), flangeT = num('Flange thickness', 2, { min: 0.4, step: 0.2, unit: 'mm' });
  const info = h('p', { class: 'desc' }, 'No image loaded. PNG, JPG, WEBP, GIF or SVG.');
  const txW = num('Image width on part', 40, { min: 2, step: 2, unit: 'mm' }), txDepth = range('Depth', 0.8, { min: 0.1, max: 5, step: 0.1, unit: ' mm' }), txRepeat = check('Tile (repeat)', false), txInvert = check('Dark = raised', false);
  const txProj = sel('Projection', [['tri', 'Auto (tri-planar)'], ['z', 'From top (XY)'], ['x', 'From side (YZ)'], ['y', 'From front (XZ)'], ['cyl', 'Wrap around Z']], 'z'), txMask = sel('Apply to', [['all', 'All faces'], ['top', 'Top faces only'], ['sides', 'Side walls only']], 'top');
  const txDensity = range('Mesh density', 0.6, { min: 0.2, max: 4, step: 0.1, unit: ' mm' }), txRelax = range('Relax mesh', 1, { min: 0, max: 10, step: 1, unit: ' passes' });
  function applyImageTexture() {
    if (!img) { toast('Load an image first.', 'warn'); return; } const p = requireManifoldPart('Image texture'); if (!p) return;
    const gw = Math.min(512, Math.max(16, Math.round(txW.value * 4))); const r = rasterize(img, gw, Math.max(8, Math.round((gw * img.naturalHeight) / img.naturalWidth)), gamma.value);
    runOp('Image texture', () => applyTexture(project.bakeTransform(p)!, { kind: 'noise', params: { ...DEFAULT_PATTERN, invert: txInvert.value }, image: { w: r.w, h: r.h, v: r.v, sizeMm: txW.value, repeat: txRepeat.value }, depth: txDepth.value, scale: 1, projection: txProj.value as any, refine: txDensity.value, keepBottom: true, onlyUp: false, mask: txMask.value as any, relax: txRelax.value }), (m) => project.replaceManifold(p, m));
  }
  const upload = fileInput('image/*,.svg', async (files) => { try { img = await loadImage(files[0]); name = files[0].name.replace(/\.[^.]+$/, ''); info.textContent = `${files[0].name}: ${img.naturalWidth} x ${img.naturalHeight} px`; draw(); } catch (e: any) { toast(e.message, 'bad'); } });

  function upd() {
    const m = mode.value;
    for (const f of [base, depth, smooth, border, gamma, mirror, res, curve]) f.style.display = m === 'relief' || m === 'litho' ? '' : 'none';
    for (const f of [thresh, dark, simp, smoothC, minArea]) f.style.display = m === 'silhouette' || m === 'cutter' ? '' : 'none';
    height.style.display = m === 'silhouette' ? '' : 'none';
    for (const f of [wall, cHeight, flange, flangeT]) f.style.display = m === 'cutter' ? '' : 'none';
    if (m === 'litho') { base.value = 0.8; depth.value = 2.4; } draw();
  }
  function gridSize() { if (!img) return [1, 1]; const w = Math.max(8, Math.min(900, Math.round(width.value * res.value))); return [w, Math.max(8, Math.round((w * img.naturalHeight) / img.naturalWidth))]; }
  function draw() {
    const ctx2 = preview.getContext('2d')!; ctx2.fillStyle = '#fff'; ctx2.fillRect(0, 0, preview.width, preview.height);
    if (!img) return;
    const ar = img.naturalWidth / img.naturalHeight; const pw = preview.width, ph = Math.round(pw / ar); preview.height = ph;
    const m = mode.value;
    if (m === 'silhouette' || m === 'cutter') {
      const r = rasterize(img, Math.min(pw, img.naturalWidth), Math.min(ph, img.naturalHeight)); const id = ctx2.createImageData(r.w, r.h);
      for (let i = 0; i < r.w * r.h; i++) { const solid = dark.value ? r.v[i] < thresh.value : r.v[i] >= thresh.value; const v = solid ? 40 : 240; id.data[i * 4] = v; id.data[i * 4 + 1] = solid ? 120 : 240; id.data[i * 4 + 2] = solid ? 214 : 240; id.data[i * 4 + 3] = 255; }
      const off = document.createElement('canvas'); off.width = r.w; off.height = r.h; off.getContext('2d')!.putImageData(id, 0, 0); ctx2.imageSmoothingEnabled = false; ctx2.drawImage(off, 0, 0, pw, ph);
    } else {
      let r: Raster = rasterize(img, Math.min(pw, img.naturalWidth), Math.min(ph, img.naturalHeight), gamma.value); r = blur(r, smooth.value); const id = ctx2.createImageData(r.w, r.h);
      for (let i = 0; i < r.w * r.h; i++) { let v = r.v[i]; if (m === 'litho') v = 1 - v; const g = Math.round(v * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = g; id.data[i * 4 + 3] = 255; }
      const off = document.createElement('canvas'); off.width = r.w; off.height = r.h; off.getContext('2d')!.putImageData(id, 0, 0); ctx2.drawImage(off, 0, 0, pw, ph);
    }
  }
  function build() {
    if (!img) { toast('Load an image first.', 'warn'); return; }
    const [gw, gh] = gridSize(); const m = mode.value;
    const r = rasterize(img, gw, gh, m === 'silhouette' || m === 'cutter' ? 1 : gamma.value);
    const sil = { widthMm: width.value, height: height.value, threshold: thresh.value, darkIsSolid: dark.value, simplify: simp.value, smooth: smoothC.value, minArea: minArea.value };
    if (m === 'relief' || m === 'litho') runOp('Build relief', () => { const flat = relief(r, { widthMm: width.value, base: base.value, depth: depth.value, invert: m === 'litho', border: border.value, smooth: smooth.value, mirror: mirror.value }); if (curve.value > 0) { const bent = wrapCylinder(flat.rotate(90, 0, 0), curve.value).rotate(-90, 0, 0); flat.delete(); return bent; } return flat; }, (mm) => addPlaced(mm, `${name} ${m === 'litho' ? 'lithophane' : 'relief'}${curve.value > 0 ? ' curved' : ''}`, m === 'litho' ? '#f3f3f0' : undefined));
    else if (m === 'silhouette') runOp('Extrude silhouette', () => silhouette(r, sil), (mm) => addPlaced(mm, `${name} silhouette`));
    else runOp('Cookie cutter', () => cookieCutter(r, sil, { wall: wall.value, height: cHeight.value, flange: flange.value, flangeThick: flangeT.value, bladeTaper: 0 }), (mm) => addPlaced(mm, `${name} cutter`, '#f7c3a6'));
  }
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-chart'), 'Image to 3D'),
    desc('Relief turns brightness into height. Lithophane inverts it so dark areas print thick and glow dim when back-lit; print it standing up at 100 % infill with 0.1 mm layers. Silhouette thresholds the image into a flat outline and extrudes it. Cookie cutter wraps a blade and flange around that outline.'),
    section('Image', rowBtns(btn('Load image', () => upload.click(), { primary: true })), info, preview),
    section('Build', mode, width, res, base, depth, gamma, smooth, border, mirror, curve, height, thresh, dark, simp, smoothC, minArea, wall, cHeight, flange, flangeT,
      rowBtns(btn('Create part', build, { primary: true }))),
    sectionC('Use image as surface texture', desc('Brightness becomes height on the selected part: logos, stamps, embossed photos. Bright = raised by default. Tile repeats the image across the surface; otherwise it is centred once.'),
      txW, txDepth, txInvert, txRepeat, txProj, txMask, txDensity, txRelax, rowBtns(btn('Apply to selected part', applyImageTexture, { primary: true }))),
  ) as Panel;
  upd();
  return el;
}
