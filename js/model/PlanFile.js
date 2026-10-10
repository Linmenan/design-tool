import { clone } from '../core/Utils.js';
import { DEFAULT_PLAN, rect2wall, legacyDoor2new, legacyWindow2new } from '../data/planData.js';

export const FORMAT_PLAN   = 'huxing-plan';
export const FORMAT_DESIGN = 'huxing-design';
export const VERSION = 3;

/* ---------- 写 ---------- */
export function buildPlanFile(plan, name = '未命名户型'){
  return { format:FORMAT_PLAN, version:VERSION, meta:{ name, createdAt:Date.now(), modifiedAt:Date.now(), version:VERSION }, plan:clone(plan) };
}
export function buildDesignFile(plan, layout, name = '未命名方案'){
  return { format:FORMAT_DESIGN, version:VERSION, meta:{ name, createdAt:Date.now(), modifiedAt:Date.now(), version:VERSION }, plan:clone(plan), layout:clone(layout) };
}
export const makePlanBlob   = (plan, name)        => new Blob([JSON.stringify(buildPlanFile(plan, name), null, 2)], { type:'application/json' });
export const makeDesignBlob = (plan, layout, name) => new Blob([JSON.stringify(buildDesignFile(plan, layout, name), null, 2)], { type:'application/json' });

/* ---------- 读 ---------- */
export function parseFile(input){
  const json = typeof input === 'string' ? JSON.parse(input) : input;
  if (!json || typeof json !== 'object') throw new Error('文件格式不正确');
  const fmt = json.format;
  let plan, layout = null;
  if (fmt === FORMAT_DESIGN){ plan = normalizePlan(json.plan); layout = normalizeLayout(json.layout); }
  else if (fmt === FORMAT_PLAN){ plan = normalizePlan(json.plan || json); }
  else if (json.plan){ plan = normalizePlan(json.plan); if (json.layout) layout = normalizeLayout(json.layout); }
  else throw new Error('不是有效的户型 / 方案文件');
  return { plan, layout, meta: json.meta || { name:'未命名' }, format: fmt || (layout ? FORMAT_DESIGN : FORMAT_PLAN) };
}
export async function loadFromFile(file){ return parseFile(await file.text()); }

/* ---------- 规范化 ---------- */
export function normalizePlan(p){
  if (!p) throw new Error('缺少 plan 字段');
  const base = clone(DEFAULT_PLAN);
  return {
    bounds:  p.bounds  || base.bounds,
    origin:  p.origin  || { x:0, y:0, note:'' },
    walls:   normalizeWalls(p.walls),
    doors:   normalizeDoors(p.doors),
    windows: normalizeWindows(p.windows),
    slides:  normalizeSlides(p.slides),
    rooms:   Array.isArray(p.rooms) ? p.rooms : [],
    mats:    p.mats || base.mats,
  };
}

export function normalizeLayout(l){
  return {
    furniture:  Array.isArray(l?.furniture)  ? l.furniture  : [],
    demolished: Array.isArray(l?.demolished) ? l.demolished : [],
    measures:   Array.isArray(l?.measures)   ? l.measures   : [],
  };
}

/* ---------- 墙体 ---------- */
function normalizeWalls(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map((w, i) => {
    const id = w.id || ('w' + i);
    if (Array.isArray(w)) return rect2wall(w, id);
    return {
      id,
      x0:+w.x0, y0:+w.y0, x1:+w.x1, y1:+w.y1,
      t: Math.max(40, +w.t || 240),
      kind: w.kind || 'n',
    };
  });
}

/* ---------- 门 ---------- */
function normalizeDoors(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map((d, i) => {
    const id = d.id || ('d' + i);
    // 新格式：有 x0/x1/y0/y1 和 kind='door'
    if (d.kind === 'door' && d.x0 !== undefined && d.x1 !== undefined){
      return {
        id, kind:'door',
        hostWall: d.hostWall || null,
        x0:+d.x0, y0:+d.y0, x1:+d.x1, y1:+d.y1,
        t: Math.max(40, +d.t || 240),
        hinge: d.hinge === 'right' ? 'right' : 'left',
        swing: d.swing === 'out' ? 'out' : 'in',
        entry: !!d.entry,
        name: d.name || '门',
      };
    }
    // 旧格式
    if (d.rect && d.h && d.c && d.o) return legacyDoor2new(d, id);
    // 未知 → 忽略
    return null;
  }).filter(Boolean);
}

/* ---------- 窗 ---------- */
function normalizeWindows(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map((w, i) => {
    const id = w.id || ('win' + i);
    if (w.kind === 'window' && w.x0 !== undefined && w.x1 !== undefined){
      return {
        id, kind:'window',
        hostWall: w.hostWall || null,
        x0:+w.x0, y0:+w.y0, x1:+w.x1, y1:+w.y1,
        t: Math.max(40, +w.t || 240),
        sill: +w.sill || 900,
        height: +w.height || 1500,
      };
    }
    if (Array.isArray(w)) return legacyWindow2new(w, id);
    return null;
  }).filter(Boolean);
}

/* ---------- 推拉门（简化为旧格式，主要兼容） ---------- */
function normalizeSlides(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map((s, i) => ({
    id: s.id || ('s' + i),
    kind: 'slide',
    rect: s.rect,
    v: !!s.v,
  }));
}