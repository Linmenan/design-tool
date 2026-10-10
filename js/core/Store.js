import { bus } from './EventBus.js';
import { clone } from './Utils.js';

/**
 * Store — 应用状态 + 撤销/重做 + 持久化
 *
 * 结构：
 *   state = {
 *     meta:   { name, createdAt, modifiedAt, version },
 *     plan:   { walls, windows, doors, slides, rooms, bounds, mats },   // 户型（编辑阶段）
 *     layout: { furniture, demolished, measures },                       // 布置（装修阶段）
 *   }
 *
 * 变更方式：
 *   store.mutate('添加家具', () => { state.layout.furniture.push(f); });
 *   不传 label 的 mutate 不进撤销栈（例如拖动过程中的实时更新）。
 */
export class Store {
  constructor(initialState){
    this.state = initialState;
    this.undoStack = [];
    this.redoStack = [];
    this.maxUndo = 150;
  }

  /* ---- 快照 / 恢复 ---- */
  snapshot(){ return JSON.stringify(this.state); }
  restore(json){ this.state = JSON.parse(json); bus.emit('store:changed'); }

  /* ---- 变更 ---- */
  mutate(label, fn){
    const before = label ? this.snapshot() : null;
    fn(this.state);
    if (label){
      this.undoStack.push(before);
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.state.meta.modifiedAt = Date.now();
    bus.emit('store:changed', label);
    if (label) this._persist();
  }

  /* ---- 用外部快照作为撤销点 ----
   * 场景：交互式拖动（拖动过程中只改内存，不入栈；
   *      结束时把拖动前的快照 commit 一次作为撤销点）。
   */
  commitWith(before, label){
    if (before){
      this.undoStack.push(before);
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.state.meta.modifiedAt = Date.now();
    bus.emit('store:changed', label || 'commit');
    this._persist();
  }

  /* ---- 撤销 / 重做 ---- */
  undo(){
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.state = JSON.parse(this.undoStack.pop());
    bus.emit('store:changed', 'undo');
    this._persist();
    return true;
  }
  redo(){
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.state = JSON.parse(this.redoStack.pop());
    bus.emit('store:changed', 'redo');
    this._persist();
    return true;
  }
  canUndo(){ return this.undoStack.length > 0; }
  canRedo(){ return this.redoStack.length > 0; }

  /* ---- 家具查询 ---- */
  getFurniture(id){ return this.state.layout.furniture.find(f => f.id === id); }

  /* ---- 持久化（装修阶段内容写到 localStorage，避免刷新丢失） ---- */
  _persist(){
    try { localStorage.setItem('huxing-design-v1', JSON.stringify(this.state)); } catch {}
  }
  loadPersisted(){
    try {
      const s = JSON.parse(localStorage.getItem('huxing-design-v1'));
      if (s && s.plan && s.layout) return s;
    } catch {}
    return null;
  }

  /* ---- 序列化：按用途导出 ---- */
  toPlanFile(){
    const { meta, plan, layout } = this.state;
    return { format:'huxing-plan', version:1, meta: clone(meta), plan: clone(plan), layout: clone(layout) };
  }
  toPlanOnly(){
    const { meta, plan } = this.state;
    return { format:'huxing-plan', version:1, meta: clone(meta), plan: clone(plan) };
  }
}

/** 深合并：把 plan 的结构覆盖进 base（保证新增字段有默认值） */
export function mergePlan(base, incoming){
  const p = { ...base, ...incoming };
  p.walls    = incoming.walls    ?? base.walls;
  p.windows  = incoming.windows  ?? base.windows;
  p.doors    = incoming.doors    ?? base.doors;
  p.slides   = incoming.slides   ?? base.slides;
  p.rooms    = incoming.rooms    ?? base.rooms;
  p.bounds   = incoming.bounds   ?? base.bounds;
  return p;
}