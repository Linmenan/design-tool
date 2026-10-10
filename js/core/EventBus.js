/**
 * 极简事件总线。用于跨模块通信，例如：
 *   bus.emit('stage:changed', 'edit');
 *   bus.on('store:changed', () => view.render());
 */
export class EventBus {
  constructor(){ this.map = new Map(); }
  on(evt, fn){
    let s = this.map.get(evt);
    if (!s){ s = new Set(); this.map.set(evt, s); }
    s.add(fn);
    return () => s.delete(fn);            // 返回取消订阅函数
  }
  off(evt, fn){ this.map.get(evt)?.delete(fn); }
  emit(evt, payload){
    this.map.get(evt)?.forEach(fn => { try { fn(payload); } catch (e){ console.error('[bus]', evt, e); } });
  }
  clear(){ this.map.clear(); }
}
export const bus = new EventBus();