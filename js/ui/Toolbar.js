import { $, $$, esc, toast } from '../core/Utils.js';
import { tr, LANGS, getLang, nm } from '../core/I18n.js';
import { CEILING_TYPES } from '../data/furnitureLib.js';

/**
 * Toolbar — 顶部工具栏（按阶段重建）。
 */
export class Toolbar {
  constructor(app){
    this.app = app;
    this.root = null;
  }

  mount(root){
    this.root = root;
    this.rebuild();
  }

  rebuild(){
    if (!this.root) return;
    const stage = this.app.stage.current || 'layout';
    this.root.innerHTML = stage === 'edit' ? this._editHTML() : this._layoutHTML();
    this._bind();
    this.sync();
  }

  /* ---------- 布置阶段 ---------- */
  _layoutHTML(){
    return `
      <div class="grp" id="paneBtns">
        <button class="btn chip" id="tgLib">◧ ${tr('家具库','Library')}</button>
        <button class="btn chip" id="tgPanel">${tr('属性','Properties')} ◨</button>
      </div>
      <div class="grp seg" id="stageSeg" title="${tr('阶段切换','Stage')}">
        <span class="pill" style="background:#2f5d62;box-shadow:0 2px 6px rgba(47,93,98,.35)"></span>
        <button class="btn" data-stage="edit">${tr('① 户型编辑','1 Edit Plan')}</button>
        <button class="btn" data-stage="layout">${tr('② 装修布置','2 Layout')}</button>
      </div>
      <div class="brand"><b>${tr('三室两厅两卫 · 装修设计','3BR 2LR 2BA · Interior Design')}</b><span id="subtitle"></span></div>
      <div class="grp seg" id="viewSeg">
        <span class="pill"></span>
        <button class="btn" data-view="2d">${tr('2D 平面','2D Plan')}</button>
        <button class="btn" data-view="3d">${tr('3D 场景','3D Scene')}</button>
      </div>
      <div class="grp only2d">
        <button class="btn" id="zoomOut">−</button>
        <button class="btn" id="zoomIn">＋</button>
        <button class="btn" id="fit">${tr('适应','Fit')}</button>
        <button class="btn" id="s60">1:60</button>
        <button class="btn" id="s100">1:100</button>
      </div>
      <div class="grp only3d" id="modes3d">
        <button class="btn on" data-mode="orbit">${tr('鸟瞰','Orbit')}</button>
        <button class="btn" data-mode="walk">${tr('漫游','Walk')}</button>
      </div>
      <div class="grp only3d">
        <button class="btn" id="vIso">${tr('斜视','Iso')}</button>
        <button class="btn" id="vTop">${tr('俯视','Top')}</button>
      </div>
      <div class="grp">
        <button class="btn" id="undo">${tr('撤销','Undo')}</button>
        <button class="btn" id="redo">${tr('重做','Redo')}</button>
        <button class="btn danger" id="clearAll">${tr('清空布置','Clear')}</button>
      </div>
      <div class="grp only2d" id="layers">
        <button class="btn chip on" data-layer="dims">${tr('尺寸','Dims')}</button>
        <button class="btn chip on" data-layer="labels">${tr('房间','Rooms')}</button>
        <button class="btn chip on" data-layer="furn">${tr('家具','Furniture')}</button>
        <button class="btn chip on" data-layer="lamps">${tr('灯具','Lighting')}</button>
        <button class="btn chip" data-layer="grid">${tr('网格','Grid')}</button>
        <button class="btn chip" data-layer="bearing">${tr('承重墙','Bearing walls')}</button>
        <button class="btn chip on" data-layer="wallSnap">${tr('贴墙吸附','Wall snap')}</button>
      </div>
      <div class="grp only3d">
        <button class="btn chip on" data-cut="2.8">${tr('全高墙','Full walls')}</button>
        <button class="btn chip" data-cut="1.2">${tr('剖切墙','Cut walls')}</button>
      </div>
      <div class="grp only3d" id="toggles3d">
        <button class="btn chip on" data-t="furn">${tr('家具','Furniture')}</button>
        <button class="btn chip on" data-t="lamps">${tr('灯具','Lighting')}</button>
        <button class="btn chip on" data-t="labels">${tr('房间名','Labels')}</button>
        <button class="btn chip" data-t="night">${tr('夜景','Night')}</button>
      </div>
      <div class="grp only3d" id="sunCfg">
        <label class="range" title="${tr('月 / 日','Month / Day')}">
          <span>${tr('日期','Date')}</span>
          <input type="number" id="month" min="1" max="12" step="1" value="6" style="width:46px;text-align:center">
          <span>/</span>
          <input type="number" id="day" min="1" max="31" step="1" value="21" style="width:46px;text-align:center">
        </label>
        <label class="range" title="${tr('时刻','Time of day')}">
          <span>${tr('时刻','Time')}</span>
          <input type="range" id="sun" min="0" max="24" step=".25" value="10" style="width:84px">
          <span id="sunT">10:00</span>
        </label>
      </div>
      <div class="spacer"></div>
      ${this._langHTML()}
      <details class="menu" id="lightMenu">
        <summary class="btn">💡 ${tr('灯光','Lights')}</summary>
        <div class="light-panel">
          <div class="lp-header">
            <span class="lp-count" id="lpCount"></span>
            <button class="btn chip" id="lpOnAll">${tr('全开','All on')}</button>
            <button class="btn chip" id="lpOffAll">${tr('全关','All off')}</button>
          </div>
          <div class="lp-list" id="lpList"></div>
        </div>
      </details>
      <button class="btn" id="fullscreen" style="border:1px solid var(--line);background:#fff">⛶ ${tr('全屏','Fullscreen')}</button>
      <details class="menu"><summary class="btn">${tr('文件','File')} ▾</summary>
        <div class="menu-pop">
          <button class="btn" data-act="switch-edit">${tr('→ 户型编辑','→ Plan Edit')}</button>
          <hr>
          <button class="btn" id="exportPng">${tr('导出图片','Export image')}</button>
          <button class="btn" id="exportJson">${tr('导出方案 JSON','Export plan JSON')}</button>
          <button class="btn" id="importJson">${tr('导入方案','Import plan')}</button>
          <button class="btn danger" id="reset">${tr('重置为默认方案','Reset to default')}</button>
        </div>
      </details>`;
  }

  /* ---------- 编辑阶段 ---------- */
    _editHTML(){
    return `
      <div class="grp" id="paneBtns">
        <button class="btn chip" id="tgLib">◧ ${tr('户型资源','Plan Source')}</button>
        <button class="btn chip" id="tgPanel">${tr('属性','Properties')} ◨</button>
      </div>
      <div class="grp seg" id="stageSeg" title="${tr('阶段切换','Stage')}">
        <span class="pill" style="background:#2f5d62;box-shadow:0 2px 6px rgba(47,93,98,.35)"></span>
        <button class="btn on" data-stage="edit">${tr('① 户型编辑','1 Edit Plan')}</button>
        <button class="btn" data-stage="layout">${tr('② 装修布置','2 Layout')}</button>
      </div>
      <div class="brand"><b>${tr('户型编辑器','Plan Editor')}</b><span id="subtitle"></span></div>
      <div class="grp">
        <button class="btn" id="zoomOut">−</button>
        <button class="btn" id="zoomIn">＋</button>
        <button class="btn" id="fit">${tr('适应','Fit')}</button>
        <button class="btn" id="s60">1:60</button>
        <button class="btn" id="s100">1:100</button>
      </div>
      <div class="grp">
        <button class="btn" id="undo">${tr('撤销','Undo')}</button>
        <button class="btn" id="redo">${tr('重做','Redo')}</button>
      </div>
      <div class="grp" id="layers">
        <button class="btn chip" data-layer="autoDims">${tr('房间尺寸','Room dims')}</button>
        <button class="btn chip on" data-layer="labels">${tr('房间名称','Room names')}</button>
        <button class="btn chip" data-layer="grid">${tr('网格','Grid')}</button>
        <button class="btn chip" data-layer="bearing">${tr('承重墙','Bearing')}</button>
      </div>
      <div class="spacer"></div>
      ${this._langHTML()}
      <button class="btn" id="fullscreen" style="border:1px solid var(--line);background:#fff">⛶ ${tr('全屏','Fullscreen')}</button>
      <details class="menu"><summary class="btn">${tr('文件','File')} ▾</summary>
        <div class="menu-pop">
          <button class="btn" data-act="switch-layout">${tr('→ 装修布置','→ Layout')}</button>
          <hr>
          <button class="btn" id="newPlan">${tr('新建空白户型','New blank plan')}</button>
          <button class="btn" id="loadDefault">${tr('加载内置默认户型','Load default plan')}</button>
          <button class="btn" id="loadPlan">${tr('加载户型文件…','Load .plan.json…')}</button>
          <button class="btn" id="savePlan">${tr('保存户型文件','Save .plan.json')}</button>
          <hr>
          <button class="btn" id="exportJson">${tr('导出 JSON','Export JSON')}</button>
          <button class="btn" id="importJson">${tr('导入 JSON','Import JSON')}</button>
        </div>
      </details>`;
  }

  _langHTML(){
    return `<div class="grp" id="langSel">${
      LANGS.map(l => `<button class="btn chip" data-lang="${l}" title="${{zh:'简体中文',zht:'繁體中文',en:'English'}[l]}">${l === 'zh' ? '简' : l === 'zht' ? '繁' : 'EN'}</button>`).join('')
    }</div>`;
  }

  /* ---------- 事件绑定 ---------- */
  _bind(){
    const app = this.app;

    // 编辑 / 装修阶段的绘图工具已迁移到左侧面板（LibraryPanel），顶部只留视图与操作
    $('#zoomIn')  && ($('#zoomIn').onclick  = () => app.viewport.zoomBy(1.25));
    $('#zoomOut') && ($('#zoomOut').onclick = () => app.viewport.zoomBy(.8));
    $('#fit')     && ($('#fit').onclick     = () => app.view2d.fit());
    $('#s60')     && ($('#s60').onclick     = () => app.viewport.setRatio(60));
    $('#s100')    && ($('#s100').onclick    = () => app.viewport.setRatio(100));
    $('#undo')    && ($('#undo').onclick    = () => app._undo());
    $('#redo')    && ($('#redo').onclick    = () => app._redo());
    $('#clearAll')&& ($('#clearAll').onclick= () => this._clearLayout());

    $('#tgLib')   && ($('#tgLib').onclick   = () => app.libPanel.toggle());
    $('#tgPanel') && ($('#tgPanel').onclick = () => app.propPanel.toggle());

    $$('#viewSeg .btn').forEach(b => b.onclick = () => app.setViewMode(b.dataset.view));

    // 编辑阶段：新建/加载/保存
    $('#newPlan')     && ($('#newPlan').onclick     = () => this._newPlan());
    $('#loadDefault') && ($('#loadDefault').onclick = () => this._loadDefaultPlan());
    $('#loadPlan')    && ($('#loadPlan').onclick    = () => $('#fileIn').click());
    $('#savePlan')    && ($('#savePlan').onclick    = () => this._savePlan());

    $('#exportPng')  && ($('#exportPng').onclick  = () => this._exportPNG());
    $('#exportJson') && ($('#exportJson').onclick = () => this._exportJson());
    $('#importJson') && ($('#importJson').onclick = () => $('#fileIn').click());
    $('#reset')      && ($('#reset').onclick      = () => this._reset());

    $$('[data-lang]').forEach(b => b.onclick = () => app.setLang(b.dataset.lang));

    // 菜单里的阶段切换
    $$('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'switch-edit')   app.stage.enter('edit');
      if (act === 'switch-layout') app.stage.enter('layout');
      b.closest('details').open = false;
    });

    // 顶栏阶段切换
    $$('#stageSeg .btn').forEach(b => b.onclick = () => app.stage.enter(b.dataset.stage));

    // 图层
    $$('#layers .btn').forEach(b => b.onclick = () => {
      const k = b.dataset.layer;
      app.ui.layers[k] = !app.ui.layers[k];
      b.classList.toggle('on', app.ui.layers[k]);
      app.view2d.renderAll();
    });

    // 3D 相关
    $$('#modes3d .btn').forEach(b => b.onclick = () => app.view3d?.setMode(b.dataset.mode));
    $$('[data-cut]').forEach(b => b.onclick = () => app.view3d?.setCut(+b.dataset.cut));
    $$('#toggles3d .btn').forEach(b => b.onclick = () => app.view3d?.toggle(b.dataset.t, b));
    $('#sun')   && ($('#sun').oninput   = e => app.view3d?.setHour(+e.target.value));
    $('#month') && ($('#month').oninput = e => app.view3d?.setDate(+e.target.value, undefined));
    $('#day')   && ($('#day').oninput   = e => app.view3d?.setDate(undefined, +e.target.value));
    $('#vIso') && ($('#vIso').onclick = () => app.view3d?.goIso());
    $('#vTop') && ($('#vTop').onclick = () => app.view3d?.goTop());

    // 灯光中控面板：全开 / 全关
    const lpOn = $('#lpOnAll'), lpOff = $('#lpOffAll');
    if (lpOn)  lpOn.onclick  = e => { e.preventDefault(); e.stopPropagation(); this._allLamps(true); };
    if (lpOff) lpOff.onclick = e => { e.preventDefault(); e.stopPropagation(); this._allLamps(false); };

    // 灯光中控 fab（挂到 #view3d 左上角，3D 夜景下才显示）
    this._mountLightFab();

    // 全屏
    $('#fullscreen') && ($('#fullscreen').onclick = () => this._toggleFullscreen());

    // 语言切换后更新下拉菜单的关闭逻辑
    $$('details.menu').forEach(m => m.addEventListener('toggle', () => {
      if (m.open) $$('details.menu').forEach(x => x !== m && (x.open = false));
    }));
  }

  sync(){
    const app = this.app;
    const u = $('#undo'), r = $('#redo');
    if (u){ u.disabled = !app.store.canUndo(); u.style.opacity = app.store.canUndo() ? 1 : .4; }
    if (r){ r.disabled = !app.store.canRedo(); r.style.opacity = app.store.canRedo() ? 1 : .4; }

    if (app.view.mode === '3d'){
      $$('#viewSeg .btn').forEach(b => b.classList.toggle('on', b.dataset.view === '3d'));
      document.body.classList.add('m3d');
    } else {
      $$('#viewSeg .btn').forEach(b => b.classList.toggle('on', b.dataset.view === '2d'));
      document.body.classList.remove('m3d');
    }

    // 图层 chip 状态
    $$('#layers .btn').forEach(b => b.classList.toggle('on', !!app.ui.layers[b.dataset.layer]));

    $('#tgLib')   && $('#tgLib').classList.toggle('on', app.libPanel?.visible());
    $('#tgPanel') && $('#tgPanel').classList.toggle('on', app.propPanel?.visible());

    // 阶段 pill 位置由 CSS 根据 [data-stage] 自动控制，这里只需同步按钮高亮
    const seg = $('#stageSeg');
    if (seg){
      const isEdit = app.stage.current === 'edit';
      seg.querySelectorAll('.btn').forEach(b => b.classList.toggle('on', (b.dataset.stage === 'edit') === isEdit));
    }

    /* 3D 夜景下显示灯光 fab；其他模式一律隐藏 */
    const is3d = app.view.mode === '3d';
    const isNight = !!(app.view3d?.opt?.night);
    document.body.classList.toggle('night-on', is3d && isNight);

    /* 灯光中控面板：数据变化时同步刷新（开关状态、灯的数量） */
    this._syncLightPanel();
  }

  /** 挂载 3D 场景左上角的灯光中控 fab（原罗盘位置） */
  _mountLightFab(){
    /* 移除旧版放在顶部工具栏里的灯光菜单（如果存在） */
    const oldMenu = document.getElementById('lightMenu');
    if (oldMenu && oldMenu.parentNode) oldMenu.parentNode.removeChild(oldMenu);

    /* 已挂载过就不重复创建 */
    if (document.getElementById('lightFab')) return;
    const host = document.getElementById('view3d');
    if (!host) return;

    const el = document.createElement('div');
    el.id = 'lightFab';
    el.innerHTML = `
      <button class="lf-btn" id="lfToggle" type="button">
        <span class="lf-icon">💡</span>
        <span class="lf-label" id="lfLabel">${tr('灯光','Lights')}</span>
      </button>
      <div class="lf-panel">
        <div class="lp-header">
          <span class="lp-count" id="lpCount"></span>
          <button class="btn chip" id="lpOnAll"  type="button">${tr('全开','All on')}</button>
          <button class="btn chip" id="lpOffAll" type="button">${tr('全关','All off')}</button>
        </div>
        <div class="lp-list" id="lpList"></div>
      </div>`;
    host.appendChild(el);

    /* 按钮切换展开 / 折叠 */
    el.querySelector('#lfToggle').onclick = e => {
      e.stopPropagation();
      el.classList.toggle('open');
    };
    /* 全开 / 全关 */
    el.querySelector('#lpOnAll').onclick  = e => { e.stopPropagation(); this._allLamps(true);  };
    el.querySelector('#lpOffAll').onclick = e => { e.stopPropagation(); this._allLamps(false); };

    /* 点击面板外部时自动折叠 */
    document.addEventListener('pointerdown', e => {
      if (!el.classList.contains('open')) return;
      if (el.contains(e.target)) return;
      el.classList.remove('open');
    });
  }

  /**
   * 刷新灯光面板中的灯列表。
   * 显示名称由"所属房间 + 灯具类型"智能生成：
   *   [房间名]_[灯具类型]_[idx]
   * 其中 idx 只在同一房间内出现多盏同类型灯时才附加（从 1 开始）。
   * 不属于任何房间的灯归类到「室外」。
   */
  _syncLightPanel(){
    const list = $('#lpList'), cnt = $('#lpCount');
    if (!list) return;                    // 当前不在 layout 阶段
    const s = this.app.store.state;
    const furn = s.layout.furniture || [];
    const lamps = furn.filter(f => CEILING_TYPES.has(f.type));
    const onN = lamps.filter(f => (f.lamp?.on) !== false).length;
    if (cnt) cnt.textContent = lamps.length ? `${onN}/${lamps.length} ${tr('亮','on')}` : '';

    if (!lamps.length){
      list.innerHTML = `<div class="lp-empty">${tr('暂无灯具，从左侧「灯具」分类拖入','No lights. Drag one from the Lights category.')}</div>`;
      return;
    }

    /* ① 计算每盏灯的所属房间 */
    const rooms = s.plan.rooms || [];
    const roomOf = f => {
      for (const r of rooms){
        if (r.poly && this._pointInPoly(f.cx, f.cy, r.poly)) return r.name || tr('房间','Room');
      }
      return tr('室外','Outside');
    };

    /* ② 生成基础名（房间_类型） */
    const baseNames = lamps.map(f => {
      const room = roomOf(f);
      const typeName = nm(f.name) || nm(f.type);   // 优先用户自定义名；否则库中默认名
      return `${room}_${typeName}`;
    });

    /* ③ 同名计数：只有 >1 才追加 _idx */
    const countMap = new Map();
    baseNames.forEach(b => countMap.set(b, (countMap.get(b) || 0) + 1));
    const idxMap = new Map();
    const displayNames = baseNames.map(b => {
      if (countMap.get(b) <= 1) return b;
      const i = (idxMap.get(b) || 0) + 1;
      idxMap.set(b, i);
      return `${b}_${i}`;
    });

    /* ④ 渲染列表 */
    list.innerHTML = lamps.map((f, i) => {
      const on = (f.lamp?.on) !== false;
      const display = displayNames[i];
      return `<label class="lp-row" data-id="${f.id}" title="${esc(display)}">
        <input type="checkbox" ${on ? 'checked' : ''}>
        <span class="lp-name">${esc(display)}</span>
      </label>`;
    }).join('');

    /* 逐个绑定：只改这一盏灯的 on 开关，不动其他家具 → 3D 只更新灯具 */
    list.querySelectorAll('.lp-row').forEach(row => {
      const id = row.dataset.id;
      const cb = row.querySelector('input');
      cb.onchange = () => {
        this.app.store.mutate('toggle lamp', s => {
          const g = s.layout.furniture.find(x => x.id === id);
          if (g){ g.lamp = g.lamp || {}; g.lamp.on = cb.checked; }
        });
      };
    });
  }

  /** 点在多边形内（射线法）；用于判断灯具属于哪个房间 */
  _pointInPoly(px, py, poly){
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++){
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /** 全开 / 全关：一次性修改所有灯的 on 开关 */
  _allLamps(on){
    const furn = this.app.store.state.layout.furniture || [];
    const has = furn.some(f => CEILING_TYPES.has(f.type));
    if (!has) return toast(tr('当前方案里还没有灯具','No lights in the current plan'));
    this.app.store.mutate(on ? 'lamps all on' : 'lamps all off', s => {
      (s.layout.furniture || []).forEach(f => {
        if (CEILING_TYPES.has(f.type)){ f.lamp = f.lamp || {}; f.lamp.on = on; }
      });
    });
  }

  /* ---------- 动作 ---------- */
  _clearLayout(){
    const n = this.app.store.state.layout.furniture.length;
    if (!n) return toast(tr('当前没有布置任何家具', 'There is no furniture to clear'));
    if (!confirm(tr(`确定清空全部 ${n} 件家具 / 家电吗？\n墙体、地面材料和测量线会保留，可点「撤销」恢复。`, `Remove all ${n} furniture / appliance items?`))) return;
    this.app.select(null);
    this.app.store.mutate('clear layout', s => s.layout.furniture = []);
    toast(tr('已清空布置，可点「撤销」恢复', 'Layout cleared — Undo to restore'));
  }

  async _newPlan(){
    if (!confirm(tr('新建空白户型？当前未保存的改动将丢失（可撤销）', 'Create a blank plan? Unsaved changes will be lost (undoable)'))) return;
    const { emptyState } = await import('../data/defaultLayout.js');
    this.app.select(null);
    this.app.store.mutate('new plan', () => {
      const s = emptyState();
      Object.assign(this.app.store.state, s);
    });
    this.app.view2d.fit();
    toast(tr('已新建空白户型', 'Blank plan created'));
  }

  async _loadDefaultPlan(){
    if (!confirm(tr('加载内置默认户型（含家具与灯具）将覆盖当前方案（可撤销），是否继续？',
                    'Load the built-in default plan with furniture and lights? (undoable)'))) return;
    const { defaultState } = await import('../data/defaultLayout.js');
    this.app.select(null);
    this.app.store.mutate('load default plan', () => {
      const s = defaultState();
      Object.assign(this.app.store.state, s);
    });
    this.app.view2d.fit();
    toast(tr('已加载内置默认户型（含家具与灯具）', 'Default plan loaded (furniture + lights)'));
  }

    async _savePlan(){
    const { makePlanBlob, makeDesignBlob } = await import('../model/PlanFile.js');
    const { download } = await import('../core/Utils.js');
    const { plan, layout, meta } = this.app.store.state;
    const name = meta.name || '未命名';
    if (this.app.stage.current === 'edit'){
      download(name + '.plan.json', makePlanBlob(plan, name));
      toast(tr('已保存户型文件 (.plan.json)', 'Plan file saved'));
    } else {
      download(name + '.design.json', makeDesignBlob(plan, layout, name));
      toast(tr('已保存装修方案 (.design.json)', 'Design file saved'));
    }
  }

  async _exportJson(){
    const { download } = await import('../core/Utils.js');
    const { buildPlanFile, buildDesignFile } = await import('../model/PlanFile.js');
    const { plan, layout, meta } = this.app.store.state;
    const name = meta.name || 'plan';
    const data = this.app.stage.current === 'edit'
      ? buildPlanFile(plan, name)
      : buildDesignFile(plan, layout, name);
    download(name + '.json', new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }));
  }

  _exportPNG(){
    if (this.app.view.mode === '3d') return this.app.view3d?.shot();
    const svg = $('#plan');
    const clone = svg.cloneNode(true);
    const b = this.app.store.state.plan.bounds;
    const W = 3200, H = Math.round(W * b.h / b.w);
    clone.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    clone.querySelector('#gSel') && (clone.querySelector('#gSel').innerHTML = '');
    clone.querySelector('#gEdit') && (clone.querySelector('#gEdit').innerHTML = '');
    clone.querySelector('#gGrid').innerHTML = `<rect x="${b.x-5000}" y="${b.y-5000}" width="${b.w+10000}" height="${b.h+10000}" fill="#f7f4ee"/>`;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(img, 0, 0, W, H);
      cv.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = tr('户型装修方案', 'floor-plan-design') + '.png';
        a.click();
      });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  }

  _reset(){
    if (!confirm(tr('恢复为默认设计方案？（可撤销）', 'Reset to the default design? (undoable)'))) return;
    import('../data/defaultLayout.js').then(({ defaultState }) => {
      this.app.select(null);
      this.app.store.mutate('reset', () => {
        Object.assign(this.app.store.state, defaultState());
      });
    });
  }

  _toggleFullscreen(){
    const de = document.documentElement;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const req = de.requestFullscreen || de.webkitRequestFullscreen;
      if (!req) return toast(tr('当前浏览器不支持网页全屏，可在 Safari 中「添加到主屏幕」后以全屏方式打开', 'Fullscreen is not supported here'));
      Promise.resolve(req.call(de)).catch(() => toast(tr('无法进入全屏', 'Could not enter fullscreen')));
    }
  }
}