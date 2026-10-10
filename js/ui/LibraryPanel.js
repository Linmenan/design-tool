import { $, $$, esc, toast } from '../core/Utils.js';
import { tr, nm } from '../core/I18n.js';
import { grouped } from '../data/furnitureLib.js';
import { furnSVG } from '../view2d/FurnSVG.js';

const COARSE = matchMedia('(pointer:coarse)').matches;
const TAP = COARSE ? 9 : 4;

/**
 * 左侧面板：
 *   layout 阶段 → 家具库（可拖放）
 *   edit   阶段 → 户型资源（可点击工具 / 参数）
 */
export class LibraryPanel {
  constructor(app, root){
    this.app = app;
    this.root = root;
    this._drag = null;
  }

  visible(){
    if (matchMedia('(max-width:1100px)').matches) return this.root.classList.contains('open');
    return !document.getElementById('app').classList.contains('hide-lib');
  }
  toggle(){
    const app = document.getElementById('app');
    if (matchMedia('(max-width:1100px)').matches) this.root.classList.toggle('open');
    else app.classList.toggle('hide-lib');
    this.app.toolbar?.sync();
  }

  mount(){ this.rebuild(); }

  rebuild(){
    const stage = this.app.stage.current;
    this.root.innerHTML = stage === 'edit' ? this._editHTML() : this._layoutHTML();
    stage === 'edit' ? this._bindEdit() : this._bindLayout();
  }

  /* =========================== 布置阶段 =========================== */
  _layoutHTML(){
    const groups = grouped();
    const body = groups.map(g => `<h4>${esc(nm(g.cat))}</h4><div class="lib-grid">${
      g.items.map((it, ii) => {
        const key = `${g.cat}:${ii}`;
        const pad = Math.max(it.w, it.d) * .08;
        return `<div class="item" data-key="${esc(key)}" title="${tr('点击添加，或拖到平面图中的指定位置', 'Click to add, or drag onto the plan')}">
          <svg viewBox="${-it.w/2-pad} ${-it.d/2-pad} ${it.w+2*pad} ${it.d+2*pad}">${furnSVG(it.type, it.w, it.d, it.color)}</svg>
          <b>${esc(nm(it.name))}</b><small>${it.w}×${it.d}</small></div>`;
      }).join('')
    }</div>`).join('');
    return `<div id="lib3d" class="only3d">
        <h4>${tr('房间 · 点击飞到该房间','Rooms · click to fly there')}</h4>
        <div id="roomList"></div>
      </div>
      <div id="lib">${body}</div>
      <div class="hint">${tr(
        `家具按真实尺寸（mm）绘制。${COARSE ? '点一下放到画面中央，或按住向右拖到平面图 / 3D 地面上的指定位置。' : '点击添加到画面中央，或直接拖到平面图 / 3D 地面上。'}`,
        `Furniture is drawn at real size (mm).`)}</div>`;
  }

  _bindLayout(){
    const app = this.app;
    this.root.querySelectorAll('.item').forEach(el => el.addEventListener('pointerdown', e => {
      if (e.button) return;
      this._drag = { el, id:e.pointerId, sx:e.clientX, sy:e.clientY, item:this._itemOf(el), ghost:null };
    }));
    this.root.querySelectorAll('#roomList button').forEach(b => b.onclick = () => app.view3d?.flyToRoom?.(b.dataset.room));
    this._bindGlobalDrag();
  }

  _itemOf(el){
    const [cat, idx] = el.dataset.key.split(':');
    const g = grouped().find(x => x.cat === cat);
    return g?.items[+idx];
  }

  _bindGlobalDrag(){
    if (this._globalsBound) return;
    this._globalsBound = true;
    const onMove = e => {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;
      const it = d.item; if (!it) return;
      if (!d.ghost){
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < TAP) return;
        const g = d.ghost = document.createElement('div'); g.id = 'ghost';
        g.innerHTML = `<svg viewBox="${-it.w/2} ${-it.d/2} ${it.w} ${it.d}">${furnSVG(it.type, it.w, it.d, it.color)}</svg>`;
        document.body.appendChild(g);
        d.el.classList.add('dragging');
      }
      const p = this.app.view2d.dropPoint(e.clientX, e.clientY);
      const s = Math.max(p?.s || (this.app.view.mode === '3d' ? .05 : this.app.viewport.s), .02);
      Object.assign(d.ghost.style, {
        width: Math.max(28, it.w*s) + 'px',
        height: Math.max(20, it.d*s) + 'px',
        left: e.clientX + 'px', top: e.clientY + 'px',
      });
    };
    const onUp = e => {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;
      this._drag = null;
      d.el.classList.remove('dragging');
      if (d.ghost){
        d.ghost.remove();
        const p = this.app.view2d.dropPoint(e.clientX, e.clientY);
        if (p) this._place(d.item, p.x, p.y);
        return;
      }
      this._place(d.item, null, null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  _place(it, x, y){
    if (!it) return;
    const app = this.app;
    if (x == null || y == null){
      if (app.ui.sel?.kind === 'room'){
        const r = app.store.state.plan.rooms.find(r => r.id === app.ui.sel.id);
        if (r){
          const xs = r.poly.map(p => p[0]), ys = r.poly.map(p => p[1]);
          x = (Math.min(...xs) + Math.max(...xs)) / 2;
          y = (Math.min(...ys) + Math.max(...ys)) / 2;
        }
      }
      if (x == null){
        x = app.viewport.x0 + app.viewport.W/2/app.viewport.s;
        y = app.viewport.y0 + app.viewport.H/2/app.viewport.s;
      }
    }
    app.view2d.addItem([it.type, it.name, it.w, it.d, it.color], x, y);
  }

  /* =========================== 编辑阶段 =========================== */
  _editHTML(){
    const ed = this.app.view2d.editor;
    const kindLabel = { n:'普通隔墙', b:'承重墙', e:'外墙', low:'矮墙 / 栏板' };
    return `<div id="lib">
      <h4>${tr('户型模板','Plan templates')}</h4>
      <div class="lib-grid" style="grid-template-columns:1fr">
        <button class="mat" data-tpl="default">
          <i style="background:#e3dccf"></i>
          <span>${tr('三室两厅两卫（默认）','3BR 2LR 2BA (default)')}<small>${tr('加载内置户型','Load built-in')}</small></span>
        </button>
        <button class="mat" data-tpl="empty">
          <i style="background:#fff;border:1px dashed #bbb"></i>
          <span>${tr('空白户型','Blank plan')}<small>${tr('从零开始绘制','Start from scratch')}</small></span>
        </button>
        <button class="mat" data-tpl="load">
          <i style="background:#f1eee8"></i>
          <span>${tr('从文件加载…','Load from file…')}<small>.plan.json</small></span>
        </button>
      </div>

      <h4>${tr('绘制工具','Draw tools')}</h4>
      <div class="lib-grid" style="grid-template-columns:1fr">
        <button class="mat tool" data-tool="select"><i style="background:#e9e3d8"></i><span>${tr('选择','Select')}<small>V</small></span></button>
        <button class="mat tool" data-tool="draw-wall"><i style="background:#a7a195"></i><span>${tr('画墙','Draw wall')}<small>W · ${tr('拖动绘制','drag')}</small></span></button>
        <button class="mat tool" data-tool="draw-room"><i style="background:#2f5d62"></i><span>${tr('画房间','Draw room')}<small>${tr('拖动框选','drag rect')}</small></span></button>
        <button class="mat tool" data-tool="auto-room"><i style="background:#2f5d62"></i><span>${tr('智能房间','Smart room')}<small>${tr('点击自动识别','click to detect')}</small></span></button>
        <button class="mat tool" data-tool="add-door"><i style="background:#b5653a"></i><span>${tr('开门','Door')}<small>${tr('在墙上点一下','click on wall')}</small></span></button>
        <button class="mat tool" data-tool="add-window"><i style="background:#4f7394"></i><span>${tr('开窗','Window')}<small>${tr('在墙上点一下','click on wall')}</small></span></button>
        <button class="mat tool" data-tool="measure"><i style="background:#2f5d62"></i><span>${tr('测量','Measure')}<small>M</small></span></button>
        <button class="mat tool" data-tool="demolish"><i style="background:#c65b3a"></i><span>${tr('拆墙','Demolish')}<small>X</small></span></button>
      </div>

      <h4>${tr('墙类型','Wall type')}</h4>
      <div class="lib-grid" style="grid-template-columns:1fr">
        <button class="mat wall-kind ${ed.wallKind === 'n' ? 'on' : ''}" data-kind="n"><i style="background:#a7a195"></i><span>${tr('普通隔墙','Partition')}<small>${tr('非承重，可拆','Non-bearing')}</small></span></button>
        <button class="mat wall-kind ${ed.wallKind === 'b' ? 'on' : ''}" data-kind="b"><i style="background:#26241f"></i><span>${tr('承重墙','Bearing')}<small>${tr('不可拆','Fixed')}</small></span></button>
        <button class="mat wall-kind ${ed.wallKind === 'e' ? 'on' : ''}" data-kind="e"><i style="background:#8f897d"></i><span>${tr('外墙','Exterior')}<small>${tr('建筑外围护','Envelope')}</small></span></button>
        <button class="mat wall-kind ${ed.wallKind === 'low' ? 'on' : ''}" data-kind="low"><i style="background:#e9e3d8;border:1px solid #ccc"></i><span>${tr('矮墙 / 栏板','Low wall')}<small>${tr('阳台用','Balcony')}</small></span></button>
      </div>

      <h4>${tr('墙厚','Wall thickness')} <small style="text-transform:none;font-weight:400">${ed.wallThickness} mm</small></h4>
      <div class="form" style="padding:0 10px 10px">
        <input type="range" min="60" max="400" step="10" value="${ed.wallThickness}" id="wallThk" style="grid-column:1/-1;accent-color:var(--edit)">
      </div>

      <h4>${tr('当前工具参数','Current tool')}</h4>
      <div class="hint">${tr('参数由左侧工具条与右侧属性面板共同控制。选择「开门 / 开窗 / 画墙」工具后，可直接在图上绘制；右侧面板会显示对应参数。', 'Parameters are shared with the tool and the right panel.')}</div>
    </div>`;
  }

  _bindEdit(){
    const app = this.app;
    const ed = app.view2d.editor;

    this.root.querySelectorAll('[data-tpl]').forEach(b => b.onclick = async () => {
      const k = b.dataset.tpl;
      if (k === 'load'){ $('#fileIn').click(); return; }
      if (!confirm(tr('加载模板将覆盖当前户型，是否继续？（可撤销）', 'Loading a template will replace the current plan. Continue? (undoable)'))) return;
      const { defaultPlanState, emptyState } = await import('../data/defaultLayout.js');
      const s = k === 'empty' ? emptyState() : defaultPlanState();
      app.select(null);
      app.store.mutate('load template', () => Object.assign(app.store.state, s));
      app.view2d.fit();
      this.rebuild();
      app.propPanel.render();
      toast(tr('已加载', 'Loaded'));
    });

    this.root.querySelectorAll('.tool').forEach(b => b.onclick = () => {
      app.setTool(b.dataset.tool);
      this._syncTools();
    });

    this.root.querySelectorAll('.wall-kind').forEach(b => b.onclick = () => {
      ed.wallKind = b.dataset.kind;
      this.root.querySelectorAll('.wall-kind').forEach(x => x.classList.toggle('on', x === b));
      app.view2d.syncEditHud();
      app.propPanel.render();
    });

    const thk = this.root.querySelector('#wallThk');
    if (thk) thk.oninput = e => {
      ed.wallThickness = +e.target.value;
      app.view2d.syncEditHud();
      this.rebuild();
    };

    this._syncTools();
  }

  _syncTools(){
    const cur = this.app.ui.tool;
    this.root.querySelectorAll('.tool').forEach(x => x.classList.toggle('on', x.dataset.tool === cur));
  }
}