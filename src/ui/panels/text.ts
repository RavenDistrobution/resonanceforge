// Text panel: 3D text, plates, keychains, engraving.
import type opentype from 'opentype.js';
import { h, btn, num, sel, text, section, sectionC, desc, rowBtns, icon, fileInput, toast, range, check } from '../dom';
import { addPlaced, addWithMode, runOp, requireManifoldPart, ADD_MODES, type AddMode, type Panel } from '../ctx';
import { BUNDLED_FONTS, loadFont, fontFromBuffer, buildText, textCrossSection, curvedTextCrossSection, type TextOpts, type PlateOpts } from '../../tools/text3d';
import { project } from '../../core/project';
import { qrPlate } from '../../tools/modeling';
import { M } from '../../core/manifold';

export function textPanel(): Panel {
  const fonts: [string, string][] = [...BUNDLED_FONTS];
  const custom = new Map<string, opentype.Font>();
  const txt = text('Text', 'HELLO', { multiline: true });
  const font = sel('Font', fonts, fonts[0][0]);
  const size = num('Letter size', 20, { min: 1, step: 1, unit: 'mm' }), height = num('Extrude height', 4, { min: 0.2, step: 0.5, unit: 'mm' });
  const spacing = range('Letter spacing', 0, { min: -0.2, max: 0.5, step: 0.01, fmt: (v) => v.toFixed(2) }), lineSp = num('Line spacing', 1.2, { min: 0.6, max: 3, step: 0.1 });
  const align = sel('Align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], 'center');
  const plate = sel('Base', [['none', 'None (letters only)'], ['raised', 'Raised letters on plate'], ['engraved', 'Engraved into plate'], ['cutout', 'Cut through plate (stencil)'], ['keychain', 'Keychain plate with ring']], 'none', () => upd());
  const margin = num('Plate margin', 4, { min: 0, step: 0.5, unit: 'mm' }), thick = num('Plate thickness', 3, { min: 0.4, step: 0.2, unit: 'mm' }), corner = num('Corner radius', 3, { min: 0, step: 0.5, unit: 'mm' });
  const addAs = sel('Add as', ADD_MODES as [string, string][], 'new');
  const ringO = num('Ring outer', 5, { min: 2, step: 0.5, unit: 'mm' }), ringI = num('Ring hole', 2.5, { min: 1, step: 0.25, unit: 'mm' });
  const qrText = text('Text / URL', 'https://example.com'), qrSize = num('Plate size', 40, { min: 15, step: 5, unit: 'mm' }), qrHeight = num('Module height', 1, { min: 0.2, step: 0.2, unit: 'mm' }), qrPlateT = num('Plate thickness', 2, { min: 0.6, step: 0.2, unit: 'mm' }), qrInvert = check('Raise the light modules instead', false);
  const cvRadius = num('Arc radius', 25, { min: 5, step: 1, unit: 'mm' }), cvInside = check('Text on the inside of the arc', false), cvStart = num('Centre angle', 90, { min: 0, max: 360, step: 15, unit: 'deg' }), cvBase = num('Disc base thickness (0 = none)', 2, { min: 0, step: 0.5, unit: 'mm' }), cvHole = num('Ring hole radius (0 = solid)', 0, { min: 0, step: 1, unit: 'mm' });
  const upload = fileInput('.ttf,.otf,.woff', async (files) => {
    for (const f of files) { try { const key = `custom:${f.name}`; custom.set(key, fontFromBuffer(await f.arrayBuffer(), key)); font.select.append(h('option', { value: key, selected: true }, `${f.name} (uploaded)`)); toast(`Font ${f.name} loaded`, 'good'); } catch (e: any) { toast(`Font failed: ${e.message}`, 'bad'); } }
  }, true);
  function upd() { const k = plate.value; const isPlate = k !== 'none'; for (const f of [margin, thick, corner]) f.style.display = isPlate ? '' : 'none'; for (const f of [ringO, ringI]) f.style.display = k === 'keychain' ? '' : 'none'; }
  async function getFont() { const v = font.value; return custom.get(v) ?? (await loadFont(v)); }
  const opts = (): TextOpts => ({ text: txt.value || 'A', size: size.value, height: height.value, letterSpacing: spacing.value, lineSpacing: lineSp.value, align: align.value as any });
  const plateOpts = (): PlateOpts => ({ kind: plate.value as any, margin: margin.value, thickness: thick.value, corner: corner.value, ringOuter: ringO.value, ringInner: ringI.value });

  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-doc'), 'Text to 3D'),
    desc('Type text, pick a bundled font or upload any TTF/OTF, and extrude it. Bases turn the text into signs, stencils or keychains. Emboss and Engrave push the text onto the selected part where it currently sits (move the text part with the gizmo first).'),
    section('Text', txt, font, rowBtns(btn('Upload font', () => upload.click())), size, height, spacing, lineSp, align),
    section('Base plate', plate, margin, thick, corner, ringO, ringI),
    addAs,
    rowBtns(
      btn('Add text part', async () => { const f = await getFont(); runOp('Build text', () => buildText(f, opts(), plateOpts()), (m) => { void addWithMode(m, `Text "${txt.value.slice(0, 12)}"`, '#eb6834', addAs.value as AddMode); }); }, { primary: true }),
    ),
    sectionC('Curved text (badges, coins, rings)', desc('Lays the text along a circle. Outside: letters stand on the arc reading clockwise over the top. Add a disc base for a coin or medallion; set the ring hole for a bracelet or napkin ring.'),
      cvRadius, cvInside, cvStart, cvBase, cvHole, rowBtns(btn('Add curved text', async () => { const f = await getFont(); runOp('Curved text', () => { const { Manifold, CrossSection } = M(); const cs = curvedTextCrossSection(f, txt.value.replace(/\n/g, ' '), size.value, cvRadius.value, spacing.value, cvStart.value, cvInside.value); let m = cs.extrude(height.value);
        if (cvBase.value > 0) { let disc = CrossSection.circle(cvRadius.value + size.value * 0.9, 96); if (cvHole.value > 0) disc = disc.subtract(CrossSection.circle(cvHole.value, 96)); m = Manifold.union(disc.extrude(cvBase.value), m.translate(0, 0, cvBase.value)); } return m; }, (m) => addPlaced(m, `Curved "${txt.value.slice(0, 10)}"`, '#eb6834')); }, { primary: true }))),
    sectionC('QR code plate', desc('Any text or URL becomes a scannable raised-module plate. Print modules in a contrasting colour (paint the top faces, or pause at the module layer).'),
      qrText, qrSize, qrHeight, qrPlateT, qrInvert, rowBtns(btn('Add QR plate', () => { if (!qrText.value.trim()) { toast('Enter text or a URL.', 'warn'); return; } runOp('QR plate', () => qrPlate(qrText.value.trim(), qrSize.value, qrHeight.value, qrPlateT.value, 2, qrInvert.value), (m) => addPlaced(m, 'QR plate', '#f3f3f0')); }, { primary: true }))),
    sectionC('Onto an existing part',
      desc('Select a part, then: Emboss unions the text part(s) onto it, Engrave subtracts them. Select the target first, then shift-click the text part.'),
      rowBtns(btn('Emboss selected text onto target', () => stamp('union')), btn('Engrave selected text into target', () => stamp('difference')))),
  ) as Panel;
  function stamp(op: 'union' | 'difference') {
    const sel2 = project.selected; if (sel2.length < 2) { toast('Select the target part, then shift-click the text part(s).', 'warn'); return; }
    const target = requireManifoldPart('Emboss/engrave'); if (!target) return;
    const tools = sel2.slice(1); if (tools.some((t) => !t.manifold)) { toast('Text parts must be watertight.', 'bad'); return; }
    runOp(op === 'union' ? 'Emboss' : 'Engrave', () => { const { Manifold } = M(); const base = project.bakeTransform(target)!; const ts = tools.map((t) => project.bakeTransform(t)!); return op === 'union' ? Manifold.union([base, ...ts]) : Manifold.difference([base, ...ts]); }, (m) => { project.snapshot(); project.replaceManifold(target, m, false); project.remove(tools.map((t) => t.id), false); project.select([target.id]); });
  }
  upd();
  void textCrossSection; void addPlaced;
  return el;
}
