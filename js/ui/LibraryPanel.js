import { $, $$, esc, toast } from '../core/Utils.js';
import { tr, nm } from '../core/I18n.js';
import { grouped } from '../data/furnitureLib.js';
import { furnSVG } from '../view2d/FurnSVG.js';

const COARSE = matchMedia('(pointer:coarse)').matches;
const TAP = COARSE ? 9 : 4;

/**
 * 左侧面板：
 *   layout 阶段 → 家具库（可拖放）
 *   edit   阶段 → 绘制工具（两级菜单，无「户型模板」栏目；模板改用文件菜单加载）
 *
 * 一级：选择 / 画墙 / 画房间 / 测量 / 开门窗
 * 二级：仅「画墙」「开门窗」展开
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
  /** 根据当前工具推断一级类别 */
  _catOf(t){
    if (t === 'draw-wall' || t === 'demolish') return 'wall';
    if (t === 'add-door' || t === 'add-window') return 'opening';
    if (t === 'draw-room' || t === 'auto-room') return 'room';
    if (t === 'measure') return 'measure';
    return 'select';
  }

  _editHTML(){
    const ed = this.app.view2d.editor;
    const t = this.app.ui.tool;
    const cat = this._catOf(t);

    const catBtn = (key, bg, label, sub, hint) =>
      `<button class="mat cat ${cat === key ? 'on' : ''}" data-cat="${key}" title="${hint || ''}">
         <i style="background:${bg}"></i>
         <span>${label}${sub ? `<small>${sub}</small>` : ''}</span>
       </button>`;

    const top =
      `<h4>${tr('绘制工具','Draw tools')}</h4>
       <div class="lib-grid" style="grid-template-columns:1fr">
         ${catBtn('select',  '#e9e3d8', tr('选择','Select'),       'V',  tr('选择 / 拖动 / 编辑对象','V'))}
         ${catBtn('wall',    '#a7a195', tr('画墙','Draw wall'),     'W',  tr('画墙 / 拆墙，二级菜单可选墙体类型','W'))}
         ${catBtn('room',    '#2f5d62', tr('画房间','Draw room'),   'R',  tr('拖动绘制矩形房间','R'))}
         ${catBtn('measure', '#2f5d62', tr('测量','Measure'),       'M',  tr('两点测量距离','M'))}
         ${catBtn('opening', '#b5653a', tr('开门窗','Door / Window'),'D',  tr('开门 / 开窗，二级菜单切换','D'))}
       </div>`;

    let sub = '';
    if (cat === 'wall'){
      const k = ed.wallKind;
      const kindBtn = (kind, bg, label, hint) =>
        `<button class="mat wall-kind ${k === kind ? 'on' : ''}" data-kind="${kind}">
           <i style="background:${bg}"></i>
           <span>${label}${hint ? `<small>${hint}</small>` : ''}</span>
         </button>`;
      sub =
        `<h4>${tr('墙体类型','Wall type')}</h4>
         <div class="lib-grid" style="grid-template-columns:1fr">
           ${kindBtn('e',   '#8f897d', tr('外墙','Exterior'),       tr('建筑外围护','Envelope'))}
           ${kindBtn('b',   '#26241f', tr('承重墙','Bearing'),      tr('不可拆','Fixed'))}
           ${kindBtn('n',   '#a7a195', tr('隔墙','Partition'),      tr('非承重','Non-bearing'))}
           ${kindBtn('low', '#e9e3d8', tr('矮墙 / 栏板','Low wall'),tr('阳台用','Balcony'))}
           <button class="mat tool ${t === 'demolish' ? 'on' : ''}" data-tool="demolish">
             <i style="background:#c65b3a"></i>
             <span>${tr('拆墙','Demolish')}<small>${tr('在墙上点一下，可拖动 / 改宽度','click on wall')}</small></span>
           </button>
         </div>
         <h4>${tr('墙厚','Wall thickness')} <small style="text-transform:none;font-weight:400">${ed.wallThickness} mm</small></h4>
         <div class="form" style="padding:0 10px 10px">
           <input type="range" min="60" max="400" step="10" value="${ed.wallThickness}" id="wallThk" style="grid-column:1/-1;accent-color:var(--edit)">
         </div>`;
    } else if (cat === 'opening'){
      sub =
        `<h4>${tr('门窗类型','Openings')}</h4>
         <div class="lib-grid" style="grid-template-columns:1fr">
           <button class="mat tool ${t === 'add-door' ? 'on' : ''}" data-tool="add-door">
             <i style="background:#b5653a"></i>
             <span>${tr('开门','Door')}<small>${tr('在墙上点一下','click on wall')}</small></span>
           </button>
           <button class="mat tool ${t === 'add-window' ? 'on' : ''}" data-tool="add-window">
             <i style="background:#4f7394"></i>
             <span>${tr('开窗','Window')}<small>${tr('在墙上点一下','click on wall')}</small></span>
           </button>
         </div>`;
    }

    return `<div id="lib">${top}${sub}</div>`;
  }

  _bindEdit(){
    const app = this.app;
    const ed = app.view2d.editor;

    /* 一级类别：setTool 会触发 libPanel.rebuild()，二级菜单动态展开 */
    this.root.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      const cat = b.dataset.cat;
      if (cat === 'select')       app.setTool('select');
      else if (cat === 'wall')    app.setTool('draw-wall');
      else if (cat === 'room')    app.setTool('draw-room');
      else if (cat === 'measure') app.setTool('measure');
      else if (cat === 'opening') app.setTool('add-door');
    });

    /* 二级：墙类型 */
    this.root.querySelectorAll('.wall-kind').forEach(b => b.onclick = () => {
      ed.wallKind = b.dataset.kind;
      app.setTool('draw-wall');
    });

    /* 二级：拆墙 / 开门 / 开窗 */
    this.root.querySelectorAll('.tool').forEach(b => b.onclick = () => {
      app.setTool(b.dataset.tool);
    });

    /* 墙厚滑块：只更新数字，不重建面板，避免拖动中断 */
    const thk = this.root.querySelector('#wallThk');
    if (thk) thk.oninput = e => {
      ed.wallThickness = +e.target.value;
      app.view2d.syncEditHud();
      const form = thk.closest('.form');
      const h4 = form?.previousElementSibling;
      const sm = h4?.querySelector('small');
      if (sm) sm.textContent = ed.wallThickness + ' mm';
    };
  }
}