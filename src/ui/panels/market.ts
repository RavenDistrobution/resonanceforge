// Market panel: search hub across model repositories plus a publishing checklist.
import { h, btn, section, sectionC, desc, rowBtns, icon, text, toast } from '../dom';
import type { Panel } from '../ctx';
import { MARKETPLACES } from '../../data/materials';
import { project } from '../../core/project';

export function marketPanel(): Panel {
  const q = text('Search', '', { placeholder: 'e.g. cable clip, phone stand, gridfinity' });
  const cards = h('div', { class: 'market' });
  const open = (url: string) => window.open(url, '_blank', 'noopener');
  function render() {
    cards.innerHTML = '';
    for (const m of MARKETPLACES) cards.append(h('div', { class: 'card-m' }, h('h4', null, m.name, h('a', { href: m.home, target: '_blank', rel: 'noopener' }, 'home')), h('p', null, m.blurb), h('p', { style: { marginTop: '4px' } }, h('small', null, `Licensing: ${m.license}`)), rowBtns(btn(`Search ${m.name}`, () => { const s = q.value.trim(); if (!s) { toast('Type a search term first.', 'warn'); return; } open(m.search(s)); }, { cls: 'sm' }))));
  }
  const el = h('div', { class: 'panel' },
    h('h2', null, icon('i-net'), 'Marketplaces and sharing'),
    desc('Search every major model repository from one box, or read what each site is good for before you publish. Searches open in a new tab; nothing is sent until you click.'),
    section('Search all', q, rowBtns(btn('Open all searches', () => { const s = q.value.trim(); if (!s) { toast('Type a search term first.', 'warn'); return; } for (const m of MARKETPLACES.slice(0, 6)) open(m.search(s)); }, { primary: true }), btn('Use selected part name', () => { const p = project.primary; if (p) q.value = p.name; }))),
    section('Sites', cards),
    sectionC('Publishing checklist', h('ul', { class: 'lg-how' },
      h('li', null, 'Export 3MF for multi-colour or when you want to bundle orientation and part arrangement; STL for maximum compatibility. Offer both.'),
      h('li', null, 'Run the Analyze panel: list overhang areas and recommended supports in the description.'),
      h('li', null, 'Put recommended layer height, walls, infill and material in the description (copy them from the Settings panel).'),
      h('li', null, 'Photograph the real print on a plain background; renders alone get fewer downloads.'),
      h('li', null, 'Pick a licence on purpose: CC BY lets others remix and sell with credit, CC BY-NC blocks commercial use, CC BY-ND blocks remixes.'),
      h('li', null, 'Name files clearly: part-name_v1_qty2.stl. Include a quantity when a model needs several copies.'),
      h('li', null, 'Credit sources when remixing and link the original.'))),
  ) as Panel;
  render();
  return el;
}
