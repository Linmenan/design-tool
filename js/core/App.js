import { bus } from './EventBus.js';
import { tr, nm, getLang, setLang, applyStaticLang } from './I18n.js';
import { $, $$, toast } from './Utils.js';
import { Store } from './Store.js';
import { StageManager } from '../stage/StageManager.js';
import { defaultState } from '../data/defaultLayout.js';

/**
 * 数据清洗：把可能含 NaN / 缺字段的墙、门、窗剔除或规范化。
 * 防御旧 localStorage 数据 / 手动改坏的文件。
 */
function sanitizePlan(plan){
  if (!plan || typeof plan !== 'object') return plan;
  const num = v => Number.isFinite(+v);

  plan.walls = (Array.isArray(plan.walls) ? plan.walls : [])
    .map((w, i) => {
      // 兼容旧数组格式
      if (Array.isArray(w)){
        const [a, b, c, d, k] = w;
        const ww = c - a, hh = d - b;
        if (Math.abs(ww) >= Math.abs(hh)){
          const cy = (b + d) / 2;
          return { id:'w' + i, x0:a, y0:cy, x1:c, y1:cy, t:Math.max(40, Math.abs(hh) || 240), kind:k || 'n' };
        }
        const cx = (a + c) / 2;
        return { id:'w' + i, x0:cx, y0:b, x1:cx, y1:d, t:Math.max(40, Math.abs(ww) || 240), kind:k || 'n' };
      }
      if (!w || !num(w.x0) || !num(w.y0) || !num(w.x1) || !num(w.y1)) return null;
      const L = Math.hypot(+w.x1 - +w.x0, +w.y1 - +w.y0);
      if (L < 1) return null;
      return {
        id: w.id || ('w' + i),
        x0:+w.x0, y0:+w.y0, x1:+w.x1, y1:+w.y1,
        t: Math.max(40, +w.t || 240),
        kind: w.kind || 'n',
      };
    })
    .filter(Boolean);

  plan.windows = (Array.isArray(plan.windows) ? plan.windows : [])
    .map((w, i) => {
      if (Array.isArray(w)){
        const [a, b, c, d] = w;
        const ww = c - a, hh = d - b;
        if (Math.abs(ww) >= Math.abs(hh)){
          const cy = (b + d) / 2;
          return { id:'win' + i, kind:'window', hostWall:null, x0:a, y0:cy, x1:c, y1:cy, t:Math.max(40, Math.abs(hh) || 240), sill:900, height:1500 };
        }
        const cx = (a + c) / 2;
        return { id:'win' + i, kind:'window', hostWall:null, x0:cx, y0:b, x1:cx, y1:d, t:Math.max(40, Math.abs(ww) || 240), sill:900, height:1500 };
      }
      if (!w || !num(w.x0) || !num(w.y0) || !num(w.x1) || !num(w.y1)) return null;
      const L = Math.hypot(+w.x1 - +w.x0, +w.y1 - +w.y0);
      if (L < 1) return null;
      return {
        id: w.id || ('win' + i),
        kind:'window',
        hostWall: w.hostWall || null,
        x0:+w.x0, y0:+w.y0, x1:+w.x1, y1:+w.y1,
        t: Math.max(40, +w.t || 240),
        sill: +w.sill || 900,
        height: +w.height || 1500,
      };
    })
    .filter(Boolean);

  plan.doors = (Array.isArray(plan.doors) ? plan.doors : [])
    .map((d, i) => {
      // 旧格式 {rect,h,c,o,len}
      if (d && d.rect && d.h && d.c && d.o && num(d.len)){
        const hx = +d.h[0], hy = +d.h[1];
        const cx = hx + (+d.c[0]) * (+d.len);
        const cy = hy + (+d.c[1]) * (+d.len);
        const [rx0, ry0, rx1, ry1] = d.rect;
        const t = Math.min(Math.abs(rx1 - rx0), Math.abs(ry1 - ry0)) || 240;
        const cross = (+d.c[0]) * (+d.o[1]) - (+d.c[1]) * (+d.o[0]);
        return {
          id: d.id || ('d' + i),
          kind:'door',
          hostWall: null,
          x0: hx, y0: hy, x1: cx, y1: cy,
          t: Math.max(40, t),
          hinge: 'left',
          swing: cross > 0 ? 'in' : 'out',
          entry: !!d.entry,
          name: d.name || '门',
        };
      }
      if (!d || !num(d.x0) || !num(d.y0) || !num(d.x1) || !num(d.y1)) return null;
      const L = Math.hypot(+d.x1 - +d.x0, +d.y1 - +d.y0);
      if (L < 1) return null;
      return {
        id: d.id || ('d' + i),
        kind:'door',
        hostWall: d.hostWall || null,
        x0:+d.x0, y0:+d.y0, x1:+d.x1, y1:+d.y1,
        t: Math.max(40, +d.t || 240),
        hinge: d.hinge === 'right' ? 'right' : 'left',
        swing: d.swing === 'out' ? 'out' : 'in',
        entry: !!d.entry,
        name: d.name || '门',
      };
    })
    .filter(Boolean);

  plan.slides = Array.isArray(plan.slides) ? plan.slides.filter(s => s && s.rect && Array.isArray(s.rect) && s.rect.length === 4 && s.rect.every(num)) : [];
  plan.rooms  = Array.isArray(plan.rooms) ? plan.rooms.filter(r => r && Array.isArray(r.poly) && r.poly.length >= 3 && r.poly.every(p => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]))) : [];
  return plan;
}

export class App {
  constructor(){
    this.store = null;
    this.stage = null;
    this.view = { mode:'2d' };
    this.view2d = null;
    this.view3d = null;
    this.ui = {
      tool: 'select',
      sel: null,
      mA: null, mCur: null,
      layers: { dims:true, autoDims:false, labels:true, furn:true, grid:false, bearing:false, wallSnap:true },
    };
  }

  async boot(){
    applyStaticLang();

    /* ---- 初始化 store：读 localStorage，做版本 + 数据清洗 ---- */
    const STORE_KEY = 'huxing-design-v1';
    const CURRENT_VERSION = 3;
    let persisted = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw){
        const s = JSON.parse(raw);
        if (s && s.plan && s.layout && s.meta && s.meta.version === CURRENT_VERSION){
          s.plan = sanitizePlan(s.plan);
          persisted = s;
          console.log('[App] 复用本地数据 v' + CURRENT_VERSION, 'walls=' + (s.plan.walls?.length || 0));
        } else {
          console.warn('[App] 本地数据版本不匹配（需要 v' + CURRENT_VERSION + '），已丢弃');
          localStorage.removeItem(STORE_KEY);
        }
      }
    } catch (e){
      console.warn('[App] localStorage 读取失败', e);
      try { localStorage.removeItem(STORE_KEY); } catch {}
    }

    const initial = persisted || defaultState();
    initial.plan = sanitizePlan(initial.plan);

    this.store = new Store(initial);
    // 立即回写一份清洗后的数据，避免脏数据反复触发 NaN
    try { this.store._persist(); } catch {}

    console.log('[App] store 初始化完成', {
      name: this.store.state.meta.name,
      walls: this.store.state.plan.walls.length,
      doors: this.store.state.plan.doors.length,
      windows: this.store.state.plan.windows.length,
      rooms: this.store.state.plan.rooms.length,
      furn: this.store.state.layout.furniture.length,
    });

    this.stage = new StageManager(this);
    await this._loadViews();
    await this._loadUI();
    this._bindGlobal();
    this.stage.enter('layout');
    bus.emit('app:ready');
    console.log('[App] 启动完成 · 默认进入 layout 阶段（切到 edit 才能画户型）');
  }

  async _loadViews(){
    const [{ PlanView }, { Viewport }] = await Promise.all([
      import('../view2d/PlanView.js'),
      import('../view2d/Viewport.js'),
    ]);
    this.viewport = new Viewport($('#plan'));
    this.view2d = new PlanView(this, this.viewport);
    await this.view2d.mount();

    // 3D 懒加载，兼容 export class / export default
    this._loadView3D = async () => {
      if (this.view3d) return this.view3d;
      let mod;
      try {
        mod = await import('../view3d/Scene3D.js');
      } catch (e){
        console.error('[App] Scene3D.js 加载失败：', e);
        throw new Error('Scene3D.js 加载失败：' + (e?.message || e));
      }
      const Ctor = mod?.Scene3D || mod?.default?.Scene3D || mod?.default;
      console.log('[App] Scene3D 模块 keys：', Object.keys(mod || {}), '  Ctor =', typeof Ctor);
      if (typeof Ctor !== 'function'){
        throw new Error('Scene3D 未正确导出（keys=' + Object.keys(mod || {}).join(',') + '）');
      }
      this.view3d = new Ctor(this);
      await this.view3d.init();
      return this.view3d;
    };
  }

  async _loadUI(){
    const [{ Toolbar }, { LibraryPanel }, { PropertyPanel }] = await Promise.all([
      import('../ui/Toolbar.js'),
      import('../ui/LibraryPanel.js'),
      import('../ui/PropertyPanel.js'),
    ]);
    this.toolbar   = new Toolbar(this);
    this.libPanel  = new LibraryPanel(this, $('#libPane'));
    this.propPanel = new PropertyPanel(this, $('#propPane'));
    this.toolbar.mount($('#header'));
    this.libPanel.mount();
    this.propPanel.mount();
  }

  _bindGlobal(){
    bus.on('store:changed', () => {
      try { this.view2d?.renderAll(); } catch (e){ console.error('[App] renderAll 失败:', e); }
      try { this.propPanel?.render(); } catch (e){ console.error('[App] propPanel 失败:', e); }
      try { this.toolbar?.sync(); } catch (e){ console.error('[App] toolbar.sync 失败:', e); }
      // 3D 场景：如果已初始化，立刻重建
      try { this.view3d?.sync(); } catch (e){ console.warn('[App] view3d.sync 失败:', e); }
    });
    bus.on('lang:changed', () => {
      applyStaticLang();
      this.toolbar?.rebuild();
      this.libPanel?.rebuild();
      this.propPanel?.render();
      this.view2d?.rebuildDefs();
      this.view3d?.relang();
      this.stage?.syncBadge();
    });
    bus.on('stage:changed', () => {
      this.ui.sel = null;
      this.propPanel?.render();
    });

    /* ---- 文件导入 ---- */
    const fileIn = document.getElementById('fileIn');
    if (fileIn){
      fileIn.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const { loadFromFile } = await import('../model/PlanFile.js');
          const { plan, layout, meta } = await loadFromFile(file);
          this.store.mutate('import file', s => {
            s.plan = sanitizePlan(plan);
            s.layout = layout || { furniture: [], demolished: [], measures: [] };
            s.meta = { ...s.meta, name: meta.name || file.name.replace(/\.[^.]+$/, '') };
          });
          this.select(null);
          requestAnimationFrame(() => { this.view2d?.fit(); this.view2d?.renderAll(); });
          toast('已导入 ' + file.name);
        } catch (err){
          console.error('[import]', err);
          toast('文件读取失败：' + (err?.message || err));
        } finally {
          e.target.value = '';
        }
      });
    }

    /* ---- 全局快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Y 或 Ctrl/Cmd+Shift+Z 重做 ---- */
    window.addEventListener('keydown', e => {
      // 在输入框里不拦截（允许浏览器原生的输入撤销）
      const t = e.target;
      if (t && t.matches && t.matches('input,select,textarea,[contenteditable="true"]')) return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const k = e.key.toLowerCase();
      if (k === 'z'){
        e.preventDefault();
        if (e.shiftKey) this._redo();
        else this._undo();
      } else if (k === 'y'){
        e.preventDefault();
        this._redo();
      }
    });
  }

  /* ---- 撤销 / 重做：统一入口，通知所有视图刷新 ---- */
  _undo(){
    const ok = this.store.undo();
    if (!ok){ toast(tr('没有可撤销的操作', 'Nothing to undo')); return; }
    this._refreshAllViews();
  }
  _redo(){
    const ok = this.store.redo();
    if (!ok){ toast(tr('没有可重做的操作', 'Nothing to redo')); return; }
    this._refreshAllViews();
  }

  /** 强制刷新 2D + 3D + 属性面板 + 工具栏（幂等，重复调用无副作用） */
  _refreshAllViews(){
    try { this.view2d?.renderAll(); } catch (e){ console.warn('[App] view2d.renderAll 失败:', e); }
    try { this.propPanel?.render(); } catch (e){ console.warn('[App] propPanel.render 失败:', e); }
    try { this.toolbar?.sync(); } catch (e){ console.warn('[App] toolbar.sync 失败:', e); }
    try { this.view3d?.sync(); } catch (e){ console.warn('[App] view3d.sync 失败:', e); }
  }

  async setViewMode(m){
    if (this.view.mode === m) return;
    if (m === '3d' && this.stage.current === 'edit'){
      toast(tr('户型编辑阶段不支持 3D，请先切到「装修布置」', '3D is not available in plan-edit stage'));
      return;
    }
    document.body.classList.add('busy');
    try {
      if (m === '3d'){
        const v = await this._loadView3D();
        document.body.classList.add('m3d');
        this.view.mode = '3d';
        await v.enter();
        this.toolbar?.sync();
        return;
      }
      if (this.view3d) await this.view3d.exit();
      document.body.classList.remove('m3d');
      this.view.mode = '2d';
      this.view2d?.fit();
      this.toolbar?.sync();
    } catch (err){
      console.error('[App.setViewMode]', err);
      document.body.classList.remove('m3d');
      this.view.mode = '2d';
      this.view2d?.fit();
      const msg = err?.message || String(err);
      toast(tr('3D 加载失败：' + msg, '3D failed: ' + msg));
      this.toolbar?.sync();
    } finally {
      document.body.classList.remove('busy');
    }
  }

  setTool(t){
    this.ui.tool = t;
    this.view2d?.setTool(t);
    this.toolbar?.sync();
  }

  select(sel){
    this.ui.sel = sel;
    try { this.view2d?.renderSel(); }
    catch (e){ console.error('[App.select] renderSel 失败:', e); }
    try { this.propPanel?.render(); }
    catch (e){ console.error('[App.select] propPanel.render 失败:', e); }
  }

  setLang(l){ setLang(l); }
}