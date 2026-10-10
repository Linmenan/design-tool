import { $, $$, esc, toast } from '../core/Utils.js';
import { tr, LANGS, getLang } from '../core/I18n.js';

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
      <div class="grp only2d" id="tools">
        <button class="btn on" data-tool="select">${tr('选择','Select')}</button>
        <button class="btn" data-tool="measure">${tr('测量','Measure')}</button>
        <button class="btn" data-tool="demolish">${tr('拆改墙体','Demolish')}</button>
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
        <button class="btn chip on" data-t="labels">${tr('房间名','Labels')}</button>
        <button class="btn chip" data-t="night">${tr('夜景','Night')}</button>
      </div>
      <div class="grp only3d"><label class="range"><span>${tr('日照','Sun')}</span> <input type="range" id="sun" min="7" max="18" step=".25" value="10" style="width:84px"><span id="sunT">10:00</span></label></div>
      <div class="spacer"></div>
      ${this._langHTML()}
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
      <div class="grp" id="editTools">
        <button class="btn on" data-tool="select">${tr('选择','Select')}</button>
        <button class="btn" data-tool="draw-wall">${tr('画墙','Wall')}</button>
        <button class="btn" data-tool="draw-room">${tr('画房间','Room')}</button>
        <button class="btn" data-tool="add-door">${tr('开门','Door')}</button>
        <button class="btn" data-tool="add-window">${tr('开窗','Window')}</button>
        <button class="btn" data-tool="measure">${tr('测量','Measure')}</button>
        <button class="btn" data-tool="demolish">${tr('拆墙','Demolish')}</button>
      </div>
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
        <button class="btn chip on" data-layer="dims">${tr('尺寸','Dims')}</button>
        <button class="btn chip" data-layer="autoDims" title="${tr('按房间自动生成尺寸链','Auto room dimension chains')}">${tr('房间尺寸','Room dims')}</button>
        <button class="btn chip on" data-layer="labels">${tr('房间','Rooms')}</button>
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

    $$('#tools .btn, #editTools .btn').forEach(b => b.onclick = () => app.setTool(b.dataset.tool));
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
    $('#newPlan')  && ($('#newPlan').onclick  = () => this._newPlan());
    $('#loadPlan') && ($('#loadPlan').onclick = () => $('#fileIn').click());
    $('#savePlan') && ($('#savePlan').onclick = () => this._savePlan());

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
    $('#sun') && ($('#sun').oninput = e => app.view3d?.setHour(+e.target.value));
    $('#vIso') && ($('#vIso').onclick = () => app.view3d?.goIso());
    $('#vTop') && ($('#vTop').onclick = () => app.view3d?.goTop());

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

    $$('#tools .btn, #editTools .btn').forEach(b => b.classList.toggle('on', b.dataset.tool === app.ui.tool));

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