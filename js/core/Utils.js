/* ============ 通用工具：DOM / 几何 / 颜色 / 数值 ============ */

export const $  = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
export const fmt = (n, d = 2) => Number(n).toFixed(d);
export const norm = a => ((Math.round(a) % 360) + 360) % 360;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = t => Math.max(0, Math.min(1, t));
export const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/* ---- 几何 ---- */
export const area = poly => Math.abs(poly.reduce((a, p, i) => {
  const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2 / 1e6;

export const perim = poly => poly.reduce((a, p, i) => {
  const q = poly[(i + 1) % poly.length]; return a + Math.hypot(q[0] - p[0], q[1] - p[1]);
}, 0) / 1000;

export const bbox = poly => {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** 旋转矩形的轴对齐半宽半高 */
export function aabb(f){
  const a = f.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { hw: f.w / 2 * c + f.d / 2 * s, hh: f.w / 2 * s + f.d / 2 * c };
}

/** 点到线段距离（像素/毫米单位均可） */
export function distToSeg(px, py, x0, y0, x1, y1){
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((px - x0) * dx + (py - y0) * dy) / L2, 0, 1) : 0;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/* ---- 颜色 ---- */
export function hex2rgb(h){
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(h, k){
  const f = v => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) * 2 : v * k)));
  return '#' + hex2rgb(h).map(v => f(v).toString(16).padStart(2, '0')).join('');
}

/* ---- ID ---- */
let _n = 1;
export const uid = () => 'f' + Date.now().toString(36) + (_n++);

/* ---- 下载 ---- */
export function download(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---- Toast ---- */
let toastT;
export function toast(msg){
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---- 深拷贝 ---- */
export const clone = v => JSON.parse(JSON.stringify(v));