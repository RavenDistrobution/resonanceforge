// Tiny DOM helpers so panels stay readable without a framework.
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'form') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function icon(name: string, cls = 'ico') { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.innerHTML = `<use href="#${name}"/>`; return s; }

export function btn(label: string, onClick: (e: MouseEvent) => void, opts: { cls?: string; icon?: string; title?: string; primary?: boolean } = {}) {
  const b = h('button', { class: `${opts.cls ?? ''}${opts.primary ? ' primary' : ''}`, title: opts.title, onClick });
  if (opts.icon) b.append(icon(opts.icon));
  b.append(label);
  return b;
}

function withValue<T extends HTMLElement, V>(el: T, extra: Record<string, any>, get: () => V, set: (v: V) => void) {
  Object.assign(el, extra);
  Object.defineProperty(el, 'value', { get, set, configurable: true });
  return el as T & typeof extra & { value: V };
}

export interface NumOpts { min?: number; max?: number; step?: number; unit?: string; onInput?: (v: number) => void; onChange?: (v: number) => void }
export function num(label: string, value: number, o: NumOpts = {}) {
  const input = h('input', { type: 'number', value: String(value), min: o.min, max: o.max, step: o.step ?? 1 });
  input.addEventListener('input', () => o.onInput?.(parseFloat(input.value)));
  input.addEventListener('change', () => o.onChange?.(parseFloat(input.value)));
  const wrap = h('label', { class: 'fld' }, h('span', null, label), h('span', { class: 'in' }, input, o.unit ? h('em', null, o.unit) : null));
  return withValue(wrap, { input }, () => parseFloat(input.value), (v: number) => { input.value = String(v); });
}
export function range(label: string, value: number, o: NumOpts & { fmt?: (v: number) => string } = {}) {
  const input = h('input', { type: 'range', value: String(value), min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1 });
  const out = h('em', null, (o.fmt ?? ((v) => `${v}${o.unit ?? ''}`))(value));
  input.addEventListener('input', () => { const v = parseFloat(input.value); out.textContent = (o.fmt ?? ((x) => `${x}${o.unit ?? ''}`))(v); o.onInput?.(v); });
  input.addEventListener('change', () => o.onChange?.(parseFloat(input.value)));
  const wrap = h('label', { class: 'fld' }, h('span', null, label), h('span', { class: 'in' }, input, out));
  return withValue(wrap, { input }, () => parseFloat(input.value), (v: number) => { input.value = String(v); out.textContent = (o.fmt ?? ((x) => `${x}${o.unit ?? ''}`))(v); });
}
export function sel(label: string, options: [string, string][], value: string, onChange?: (v: string) => void) {
  const s = h('select', null, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  const wrap = h('label', { class: 'fld' }, h('span', null, label), h('span', { class: 'in' }, s));
  return withValue(wrap, { select: s }, () => s.value, (v: string) => { s.value = v; });
}
export function text(label: string, value: string, o: { placeholder?: string; onInput?: (v: string) => void; multiline?: boolean } = {}) {
  const input = o.multiline ? h('textarea', { rows: 3 }, value) : h('input', { type: 'text', value, placeholder: o.placeholder });
  input.addEventListener('input', () => o.onInput?.((input as HTMLInputElement).value));
  const wrap = h('label', { class: 'fld' }, h('span', null, label), h('span', { class: 'in' }, input));
  return withValue(wrap, { input }, () => (input as HTMLInputElement).value, (v: string) => { (input as HTMLInputElement).value = v; });
}
export function check(label: string, value: boolean, onChange?: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox', checked: value });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  const wrap = h('label', { class: 'fld chk' }, h('span', null, label), h('span', { class: 'in' }, input));
  return withValue(wrap, { input }, () => input.checked, (v: boolean) => { input.checked = v; });
}
export function color(label: string, value: string, onInput?: (v: string) => void) {
  const input = h('input', { type: 'color', value });
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  const wrap = h('label', { class: 'fld' }, h('span', null, label), h('span', { class: 'in' }, input));
  return withValue(wrap, { input }, () => input.value, (v: string) => { input.value = v; });
}
export function section(title: string, ...children: Child[]) { return h('div', { class: 'sec-card' }, h('h3', null, title), ...children); }
/** Collapsed-by-default section for advanced or reference content. */
export function sectionC(title: string, ...children: Child[]) { return h('details', { class: 'sec-card sec-c' }, h('summary', null, h('h3', null, title)), h('div', { class: 'sec-body' }, ...children)); }
export function desc(textContent: string) { return h('p', { class: 'desc' }, textContent); }
export function rowBtns(...b: HTMLElement[]) { return h('div', { class: 'tools' }, ...b); }
export function fileInput(accept: string, onFiles: (files: File[]) => void, multiple = false) {
  const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
  i.addEventListener('change', () => { if (i.files?.length) onFiles(Array.from(i.files)); i.value = ''; });
  document.body.append(i);
  return i;
}

let toastHost: HTMLElement | null = null;
export function toast(msg: string, kind: 'info' | 'good' | 'warn' | 'bad' = 'info', ms = 3800) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.append(toastHost); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function busy<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const o = h('div', { class: 'busy' }, h('div', { class: 'spin' }), h('div', { class: 'busy-l' }, label));
  document.body.append(o);
  return new Promise<T>((res, rej) => setTimeout(async () => { try { res(await fn()); } catch (e) { rej(e); } finally { o.remove(); } }, 30));
}
export function setBusyLabel(label: string) { const l = document.querySelector('.busy .busy-l'); if (l) l.textContent = label; }
