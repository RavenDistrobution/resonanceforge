// Small inline-SVG chart helpers in the glass style. Every chart animates on insert (path draw / bar scale).
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag: string, attrs: Record<string, string | number>, text?: string) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}
export function niceTicks(max: number, n = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / n, pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => raw <= s) ?? pow * 10;
  const out: number[] = []; for (let v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(6)); return out;
}
export interface LineSeries { name: string; v: number[]; color: string }
/** Multi-series line chart. xs are the x values (same length as each series). */
export function lines(el: HTMLElement, xs: number[], series: LineSeries[], o: { xlabel?: string; ylabel?: string; fmt?: (v: number) => string; H?: number; markers?: { x: number; label: string }[] } = {}) {
  el.innerHTML = '';
  const W = 1000, H = o.H ?? 320, padL = 70, padR = 20, padT = 16, padB = 50;
  const fmt = o.fmt ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.ylabel ?? 'chart' });
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymax = Math.max(1e-9, ...series.flatMap((s) => s.v.filter((x) => isFinite(x))));
  const ticks = niceTicks(ymax);
  const ytop = ticks[ticks.length - 1] || ymax;
  const sx = (x: number) => padL + ((x - xmin) / ((xmax - xmin) || 1)) * (W - padL - padR);
  const sy = (y: number) => H - padB - (y / ytop) * (H - padT - padB);
  const grid = svgEl('g', { class: 'grid' });
  for (const t of ticks) { grid.append(svgEl('line', { x1: padL, x2: W - padR, y1: sy(t), y2: sy(t) })); svg.append(svgEl('text', { class: 'tick', x: padL - 8, y: sy(t) + 4, 'text-anchor': 'end' }, fmt(t))); }
  svg.append(grid);
  const xt = niceTicks(xmax, 5).filter((t) => t >= xmin);
  for (const t of xt) svg.append(svgEl('text', { class: 'tick', x: sx(t), y: H - padB + 18, 'text-anchor': 'middle' }, t.toFixed(0)));
  svg.append(svgEl('path', { class: 'axis', d: `M${padL},${padT}V${H - padB}H${W - padR}`, fill: 'none' }));
  if (o.xlabel) svg.append(svgEl('text', { class: 'lbl', x: (padL + W - padR) / 2, y: H - 10, 'text-anchor': 'middle' }, o.xlabel));
  if (o.ylabel) svg.append(svgEl('text', { class: 'lbl', x: 14, y: padT + 2, 'text-anchor': 'start' }, o.ylabel));
  for (const s of series) {
    let d = '';
    s.v.forEach((y, i) => { if (!isFinite(y)) return; d += `${d ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(Math.min(y, ytop)).toFixed(1)}`; });
    const p = svgEl('path', { class: 'line path-draw', d, stroke: s.color, 'stroke-width': 2.5, fill: 'none' });
    svg.append(p);
  }
  for (const m of o.markers ?? []) {
    svg.append(svgEl('line', { x1: sx(m.x), x2: sx(m.x), y1: padT, y2: H - padB, stroke: 'var(--critical)', 'stroke-dasharray': '4 4' }));
    svg.append(svgEl('text', { class: 'val', x: sx(m.x) + 4, y: padT + 14 }, m.label));
  }
  el.append(svg);
  requestAnimationFrame(() => el.classList.add('on'));
  return svg;
}
/** Horizontal colour ramp with min/max labels for the stress map. */
export function ramp(el: HTMLElement, stops: string[], lo: string, hi: string) {
  el.innerHTML = '';
  el.append(Object.assign(document.createElement('div'), { className: 'ramp', style: `background:linear-gradient(90deg,${stops.join(',')})` }));
  const l = document.createElement('div'); l.className = 'ramp-l'; l.innerHTML = `<span>${lo}</span><span>${hi}</span>`; el.append(l);
}
export function hbars(el: HTMLElement, rows: { label: string; v: number; color?: string; vtext?: string }[], max?: number) {
  el.innerHTML = '';
  const W = 1000, rowH = 30, padL = 200, H = rows.length * rowH + 10;
  const mx = max ?? Math.max(1e-9, ...rows.map((r) => r.v));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  rows.forEach((r, i) => {
    const y = 5 + i * rowH;
    svg.append(svgEl('text', { class: 'lbl', x: padL - 10, y: y + 19, 'text-anchor': 'end' }, r.label));
    svg.append(svgEl('rect', { class: 'bar', x: padL, y: y + 5, width: Math.max(2, (r.v / mx) * (W - padL - 120)), height: rowH - 12, rx: 5, fill: r.color ?? 'var(--s1)' }));
    svg.append(svgEl('text', { class: 'val', x: padL + (r.v / mx) * (W - padL - 120) + 8, y: y + 19 }, r.vtext ?? String(r.v)));
  });
  el.append(svg);
  requestAnimationFrame(() => el.classList.add('on'));
}
