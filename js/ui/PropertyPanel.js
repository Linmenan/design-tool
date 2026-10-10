import { $, $$, esc, fmt, norm, area, perim, bbox, toast } from '../core/Utils.js';
import { tr, nm } from '../core/I18n.js';
import { linearLength, linearDir } from '../data/planData.js';
import { CityPicker } from './CityPicker.js';
import { findCity } from '../data/cities.js';
// 若报 linearLength 未定义，说明 planData.js 不是最新版（需要含 linearLength/linearDir/pointOnLine 的工具函数）

export class PropertyPanel {
  constructor(app, root){
    this.app = app;
    this.root = root;
    this.root.id = 'panel';
  }

  visible(){
    if (matchMedia('(max-width:1100px)').matches) return this.root.classList.contains('open');
    return !document.getElementById('app').classList.contains('hide-panel');
  }
  toggle(){
    const app = document.getElementById('app');
    if (matchMedia('(max-width:1100px)').matches) this.root.classList.toggle('open');
    else app.classList.toggle('hide-panel');
    this.app.toolbar?.sync();
  }

  mount(){ this.render(); }

  render(){
    const sel = this.app.ui.sel;
    const stage = this.app.stage.current;
    if (stage === 'edit'){
      const key = sel?.id ?? sel?.idx;
      if (sel?.kind === 'wall')       return this._wallPanel(key);
      if (sel?.kind === 'demolition') return this._demolitionPanel(key);
      if (sel?.kind === 'door')       return this._doorPanel(key);
      if (sel?.kind === 'window')     return this._windowPanel(key);
      if (sel?.kind === 'room')       return this._roomPanel(key, true);
      if (sel?.kind === 'compass')    return this._compassPanel();
      return this._editOverview();
    }
    if (sel?.kind === 'furn'){
      const f = this.app.store.getFurniture(sel.id);
      if (f) return this._furnPanel(f);
    }
    if (sel?.kind === 'room') return this._roomPanel(sel.id, false);
    if (sel?.kind === 'compass') return this._compassPanel();
    return this._overview();
  }

  /* ============ 布置阶段 ============ */
  _overview(){
    const { plan, layout } = this.app.store.state;
    const rows = (plan.rooms || []).map(r => `<tr class="click" data-room="${r.id}"><td><span class="sw" style="background:${plan.mats[r.mat].sw}"></span>${esc(nm(r.name))}${r.counted === false ? ' <span class="muted">*</span>' : ''}</td>
      <td class="r">${fmt(area(r.poly))} m²</td></tr>`).join('');
    const tot = (plan.rooms || []).filter(r => r.counted !== false).reduce((a, r) => a + area(r.poly), 0);
    const byMat = {};
    (plan.rooms || []).forEach(r => { byMat[r.mat] = (byMat[r.mat] || 0) + area(r.poly); });
    let cost = 0;
    const matRows = Object.entries(byMat).map(([m, a]) => {
      const c = a * plan.mats[m].price * 1.05; cost += c;
      return `<tr><td><span class="sw" style="background:${plan.mats[m].sw}"></span>${nm(plan.mats[m].name)}</td><td class="r">${fmt(a,2)} m²</td><td class="r">¥${Math.round(c).toLocaleString()}</td></tr>`;
    }).join('');
    let demLen = 0;
    (layout.demolished || []).forEach(id => {
      const w = (plan.walls || []).find(x => x.id === id);
      if (w) demLen += Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    });
    (layout.demolitions || []).forEach(d => {
      demLen += Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
    });
    demLen /= 1000;

    this._html(`
      <section><h3>${tr('房间面积','Room Areas')}</h3>
        <table>${rows}</table>
        <div class="total"><span>${tr('套内使用面积','Net floor area')}</span><b>${fmt(tot)} m²</b></div></section>
      <section><h3>${tr('地面材料估算','Flooring Estimate')}</h3>
        <table>${matRows}</table>
        <div class="total"><span>${tr('合计','Total')}</span><b>¥${Math.round(cost).toLocaleString()}</b></div></section>
      <section><h3>${tr('方案统计','Stats')}</h3>
        <div class="stats"><div><small>${tr('家具数量','Furniture')}</small><span class="big">${layout.furniture.length}</span></div>
          <div><small>${tr('拆除墙体','Walls removed')}</small><span class="big">${fmt(demLen,2)}</span> m</div></div>
        <div class="actions"><button class="btn" id="clearMeasure">${tr('清除测量','Clear measures')} (${layout.measures.length})</button>
          <button class="btn danger" id="clearFurn">${tr('清空布置','Clear layout')}</button></div></section>`);
    $$('#panel tr[data-room]').forEach(tr => tr.onclick = () => {
      this.app.select({ kind:'room', id:tr.dataset.room });
      if (this.app.view.mode === '3d') this.app.view3d?.flyToRoom(tr.dataset.room);
    });
    const cm = $('#clearMeasure'), cf = $('#clearFurn');
    if (cm) cm.onclick = () => this.app.store.state.layout.measures.length && this.app.store.mutate('clear measures', s => s.layout.measures = []);
    if (cf) cf.onclick = () => this.app.toolbar._clearLayout();
  }

  _furnPanel(f){
    this._html(`<section><h3>${tr('家具属性','Furniture')}</h3>
      <div class="form">
        <label class="full">${tr('名称','Name')}<input id="fName" value="${esc(nm(f.name))}"></label>
        <label>${tr('宽','Width')} (mm)<input type="number" id="fW" value="${Math.round(f.w)}" min="50" step="10"></label>
        <label>${tr('深','Depth')} (mm)<input type="number" id="fD" value="${Math.round(f.d)}" min="50" step="10"></label>
        <label>${tr('中心','Center')} X<input type="number" id="fX" value="${Math.round(f.cx)}" step="10"></label>
        <label>${tr('中心','Center')} Y<input type="number" id="fY" value="${Math.round(f.cy)}" step="10"></label>
        <label>${tr('旋转','Rotation')} (°)<input type="number" id="fR" value="${Math.round(f.rot)}" step="15"></label>
        <label>${tr('颜色','Color')}<input type="color" id="fC" value="${f.color}"></label>
      </div>
      <div class="actions">
        <button class="btn" id="aRot">${tr('旋转 90°','Rotate 90°')}</button>
        <button class="btn" id="aDup">${tr('复制','Duplicate')}</button>
        <button class="btn danger" id="aDel">${tr('删除','Delete')}</button>
        <button class="btn" id="back">${tr('← 返回','← Back')}</button>
      </div></section>`);
    const id = f.id, store = this.app.store;
    const upd = fn => store.mutate('edit', s => { const g = s.layout.furniture.find(x => x.id === id); if (g) fn(g); });
    const num = (sel, fn) => { $(sel).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(g => fn(g, v)); }; };
    $('#fName').onchange = e => upd(g => g.name = e.target.value.trim() || g.name);
    num('#fW', (g,v) => g.w = Math.max(50, Math.round(v)));
    num('#fD', (g,v) => g.d = Math.max(50, Math.round(v)));
    num('#fX', (g,v) => g.cx = v);
    num('#fY', (g,v) => g.cy = v);
    num('#fR', (g,v) => g.rot = norm(v));
    $('#fC').onchange = e => upd(g => g.color = e.target.value);
    $('#aRot').onclick = () => this.app.view2d.rotateSel(90);
    $('#aDup').onclick = () => {
      const n = { ...f, id:'f' + Date.now().toString(36), cx:f.cx+200, cy:f.cy+200 };
      this.app.select({ kind:'furn', id:n.id });
      store.mutate('duplicate', s => s.layout.furniture.push(n));
    };
    $('#aDel').onclick = () => { this.app.select(null); store.mutate('delete', s => s.layout.furniture = s.layout.furniture.filter(x => x.id !== id)); };
    $('#back').onclick = () => this.app.select(null);
  }

  _roomPanel(key, isEdit){
    const rooms = this.app.store.state.plan.rooms || [];
    const r = (typeof key === 'number' ? rooms[key] : rooms.find(x => x.id === key));
    if (!r) return this._editOverview();
    const roomId = r.id;
    const a = area(r.poly), [x0, y0, x1, y1] = bbox(r.poly);
    const inside = (this.app.store.state.layout.furniture || []).filter(f => f.cx > x0 && f.cx < x1 && f.cy > y0 && f.cy < y1);
    const mats = Object.entries(this.app.store.state.plan.mats).map(([k, m]) =>
      `<button class="mat ${k === r.mat ? 'on' : ''}" data-mat="${k}"><i style="background:${m.sw}"></i><span>${nm(m.name)}<small>¥${m.price}/m²</small></span></button>`).join('');

    const lamp = r.lamp || {};
    this._html(`<section><h3>${tr('房间','Room')}</h3>
      <div class="form"><label class="full">${tr('名称','Name')}<input id="rName" value="${esc(nm(r.name))}"></label></div>
      <div class="stats" style="margin-top:10px">
        <div><small>${tr('面积','Area')}</small><span class="big">${fmt(a)}</span> m²</div>
        <div><small>${tr('周长','Perimeter')}</small><span class="big">${fmt(perim(r.poly),2)}</span> m</div>
        <div><small>${tr('开间','Width')}</small><span class="big">${Math.round(x1-x0)}</span> mm</div>
        <div><small>${tr('进深','Depth')}</small><span class="big">${Math.round(y1-y0)}</span> mm</div></div></section>
    <section><h3>${tr('地面材料','Flooring')}</h3><div class="mats">${mats}</div></section>
    <section><h3>${tr('顶灯','Ceiling lamp')}</h3>
      <div class="form">
        <label class="full"><input type="checkbox" id="lampOn" ${lamp.on !== false ? 'checked' : ''} style="width:auto"> ${tr('夜间自动开启','On at night')}</label>
        <label>${tr('色温','Color')}<input type="color" id="lampColor" value="${lamp.color || '#ffd9a8'}"></label>
        <label>${tr('亮度','Intensity')}<input type="number" id="lampInt" min=".2" max="2" step=".1" value="${lamp.intensity ?? 1}"></label>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px">${tr('顶灯安装在房间几何中心的天花板下，白天不发光，夜景时作为主光。','Installed at the room center below the ceiling. Off during day, main light at night.')}</div>
    </section>
    ${isEdit ? '' : `<section><h3>${tr('房间内家具','Furniture')} <small>${inside.length}</small></h3>
      <table>${inside.map(f => `<tr class="click" data-fid="${f.id}"><td>${esc(nm(f.name))}</td><td class="r muted">${f.w}×${f.d}</td></tr>`).join('') || `<tr><td class="muted">${tr('暂无','None')}</td></tr>`}</table></section>`}
    <div class="actions"><button class="btn" id="back">${tr('← 返回总览','← Back')}</button></div>`);

    const id = r.id, store = this.app.store;
    $('#rName').onchange = e => store.mutate('rename room', s => {
      const t = s.plan.rooms.find(x => x.id === id);
      if (t) t.name = e.target.value.trim() || t.name;
    });
    $$('#panel [data-mat]').forEach(b => b.onclick = () => store.mutate('mat', s => {
      const t = s.plan.rooms.find(x => x.id === id);
      if (t) t.mat = b.dataset.mat;
    }));
    $$('#panel tr[data-fid]').forEach(tr => tr.onclick = () => this.app.select({ kind:'furn', id:tr.dataset.fid }));
    $('#back').onclick = () => this.app.select(null);
    const lon = $('#lampOn'), lcol = $('#lampColor'), lint = $('#lampInt');
    if (lon)  lon.onchange  = e => store.mutate('lamp on',  s => { const t = s.plan.rooms.find(x => x.id === id); if (t){ t.lamp = t.lamp || {}; t.lamp.on = e.target.checked; } });
    if (lcol) lcol.oninput  = e => store.mutate('lamp color', s => { const t = s.plan.rooms.find(x => x.id === id); if (t){ t.lamp = t.lamp || {}; t.lamp.color = e.target.value; } });
    if (lint) lint.onchange = e => store.mutate('lamp int', s => { const t = s.plan.rooms.find(x => x.id === id); if (t){ t.lamp = t.lamp || {}; t.lamp.intensity = Math.max(.2, Math.min(2, +e.target.value || 1)); } });
  }

  /* ============ 编辑阶段 ============ */
  _editOverview(){
    const { plan } = this.app.store.state;
    const o = plan.origin || { x:0, y:0 };
    this._html(`<section><h3>${tr('户型总览','Plan Overview')}</h3>
      <div class="stats">
        <div><small>${tr('墙体','Walls')}</small><span class="big">${plan.walls.length}</span></div>
        <div><small>${tr('房间','Rooms')}</small><span class="big">${plan.rooms.length}</span></div>
        <div><small>${tr('门','Doors')}</small><span class="big">${plan.doors.length}</span></div>
        <div><small>${tr('窗','Windows')}</small><span class="big">${plan.windows.length}</span></div>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">${tr('当前原点','Origin')} <b>(${o.x}, ${o.y})</b> mm</div>
    </section>
    <section><h3>${tr('基准点 / 罗盘','Origin / Compass')}</h3>
      <div class="actions">
        <button class="btn" id="orgCursor">${tr('以光标点为原点','Set origin to cursor')}</button>
        <button class="btn" id="orgReset">${tr('重置原点 (0,0)','Reset origin')}</button>
        <button class="btn" id="editCompass">${tr('指南针 / 位置','Compass / Location')}</button>
      </div></section>
    <section><h3>${tr('操作提示','Tips')}</h3>
      <div class="kbd">
        <kbd>${tr('点击选中','Click')}</kbd><span>${tr('选中墙 / 门 / 窗','Select wall/door/window')}</span>
        <kbd>${tr('拖墙身','Drag wall')}</kbd><span>${tr('整体平移，门窗跟随','Move whole wall, doors/windows follow')}</span>
        <kbd>${tr('拖门窗','Drag door/window')}</kbd><span>${tr('沿墙滑动','Slide along wall')}</span>
        <kbd>${tr('拖端点','Drag ends')}</kbd><span>${tr('改长度 / 位置','Resize')}</span>
      </div></section>`);
    const orgCursor = $('#orgCursor');
    if (orgCursor) orgCursor.onclick = () => {
      const p = this.app.view2d._lastPos;
      if (!p) return toast(tr('请先把光标移到目标位置', 'Move cursor first'));
      this.app.view2d.setOrigin(p.x, p.y, 'cursor');
    };
    const orgReset = $('#orgReset');
    if (orgReset) orgReset.onclick = () => this.app.view2d.setOrigin(0, 0, '');
    const ec = $('#editCompass');
    if (ec) ec.onclick = () => this.app.select({ kind:'compass' });
  }

  /* ---- 指南针 / 位置面板 ---- */
  _compassPanel(){
    // 干掉上一次可能残留的 CityPicker 下拉，避免面板重建后 DOM 累积
    if (window.__activeCityPicker){ try { window.__activeCityPicker.destroy(); } catch {} }

    const { plan } = this.app.store.state;
    const c = plan.compass || { north:0, lat:39.9, lng:116.4, city:'北京' };
    this._html(`<section><h3>${tr('指南针与位置','Compass & Location')}</h3>
      <div class="form">
        <label>${tr('北向角度','North angle')} (°)<input type="number" id="cpNorth" value="${c.north||0}" step="5" min="0" max="359"></label>
        <label class="full">${tr('城市（输入后从候选选择）','City (type to search)')}
          <input id="cpCity" value="${esc(c.city||'')}"
                 placeholder="${tr('如：北京 / 上海 / 杭州 / 广东','e.g. Beijing / Shanghai')}" autocomplete="off"></label>
        <label>${tr('纬度','Latitude')} (°)<input type="number" id="cpLat" value="${c.lat ?? 39.9}" step=".01" min="-89" max="89"></label>
        <label>${tr('经度','Longitude')} (°)<input type="number" id="cpLng" value="${c.lng ?? 116.4}" step=".01" min="-180" max="180"></label>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">${tr(
        '北向角度：0° = 画布上方为正北，顺时针为正；也可以直接在 2D 罗盘上拖拽指针。经纬度由所选城市自动填充，也可手动微调。',
        '0° = up is north. Drag the needle on the 2D compass to rotate. Lat/Lng auto-filled from the city.')}</div>
      <div class="actions">
        <button class="btn" id="cpReset">${tr('恢复默认','Reset')}</button>
        <button class="btn" id="cpBack">${tr('← 返回','← Back')}</button>
      </div></section>`);

    const store = this.app.store;
    const readCommon = () => ({
      north: ((+$('#cpNorth').value || 0) % 360 + 360) % 360,
      lat:   Math.max(-89, Math.min(89, +$('#cpLat').value || 39.9)),
      lng:   Math.max(-180, Math.min(180, +$('#cpLng').value || 116.4)),
      city:  $('#cpCity').value.trim(),
    });

    /* 北向 / 经纬度手改 */
    $('#cpNorth').onchange = () => store.mutate('edit compass', s => { s.plan.compass = readCommon(); });
    $('#cpLat').onchange   = () => store.mutate('edit compass', s => { s.plan.compass = readCommon(); });
    $('#cpLng').onchange   = () => store.mutate('edit compass', s => { s.plan.compass = readCommon(); });

    /* 城市搜索选择器：选择后自动同步经纬度 */
    const cityInput = $('#cpCity');
    if (cityInput){
      new CityPicker(cityInput, {
        onChange: city => {
          const north = ((+$('#cpNorth').value || 0) % 360 + 360) % 360;
          // 直接把经纬度写回输入框，再一次性入库，避免二次渲染闪烁
          $('#cpLat').value = city.lat;
          $('#cpLng').value = city.lng;
          store.mutate('set city', s => {
            s.plan.compass = { north, lat: city.lat, lng: city.lng, city: city.name };
          });
        },
      });
    }

    /* 若历史数据里的 city 已经是合法城市名，进入面板时同步一次经纬度（用户改了 city 但没更新 lng/lat 的旧数据） */
    const cur = findCity(c.city);
    if (cur && (Math.abs(cur.lat - (c.lat ?? 0)) > 1 || Math.abs(cur.lng - (c.lng ?? 0)) > 1)){
      // 仅提示，不覆盖用户输入
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.cssText = 'font-size:12px;margin-top:6px';
      hint.textContent = tr(`提示：${cur.name} 对应经纬度约为 ${cur.lat}°, ${cur.lng}°（可点“恢复默认”或从候选重新选择）`,
                            `Hint: ${cur.name} ≈ ${cur.lat}°, ${cur.lng}°`);
      $('#panel section')?.appendChild(hint);
    }

    $('#cpReset').onclick = () => store.mutate('reset compass', s => {
      s.plan.compass = { north:0, lat:39.9, lng:116.4, city:'北京' };
    });
    $('#cpBack').onclick = () => {
      if (window.__activeCityPicker){ try { window.__activeCityPicker.destroy(); } catch {} }
      this.app.select(null);
    };
  }

  _wallPanel(key){
    const { plan } = this.app.store.state;
    const w = (typeof key === 'number' ? plan.walls[key] : plan.walls.find(x => x.id === key));
    if (!w) return this._editOverview();
    const wallId = w.id;
    const L = Math.round(linearLength(w));
    const angle = Math.round(Math.atan2(w.y1-w.y0, w.x1-w.x0) * 180 / Math.PI);
    const kindLabel = { n:'隔墙', b:'承重', e:'外墙', low:'矮墙' }[w.kind] || '—';
    this._html(`<section><h3>${tr('墙体属性','Wall')} <small>${kindLabel}</small></h3>
      <div class="form">
        <label>X0 (mm)<input type="number" id="wX0" value="${Math.round(w.x0)}" step="10"></label>
        <label>Y0 (mm)<input type="number" id="wY0" value="${Math.round(w.y0)}" step="10"></label>
        <label>X1 (mm)<input type="number" id="wX1" value="${Math.round(w.x1)}" step="10"></label>
        <label>Y1 (mm)<input type="number" id="wY1" value="${Math.round(w.y1)}" step="10"></label>
        <label>${tr('厚度','Thickness')} (mm)<input type="number" id="wT" value="${w.t}" min="40" max="600" step="10"></label>
        <label>${tr('类型','Type')}
          <select id="wKind">
            <option value="n"   ${w.kind==='n'   ? 'selected' : ''}>${tr('普通隔墙','Partition')}</option>
            <option value="b"   ${w.kind==='b'   ? 'selected' : ''}>${tr('承重墙','Bearing')}</option>
            <option value="e"   ${w.kind==='e'   ? 'selected' : ''}>${tr('外墙','Exterior')}</option>
            <option value="low" ${w.kind==='low' ? 'selected' : ''}>${tr('矮墙','Low')}</option>
          </select></label>
      </div>
      <div class="stats" style="margin-top:8px">
        <div><small>${tr('长度','Length')}</small><span class="big">${L}</span> mm</div>
        <div><small>${tr('角度','Angle')}</small><span class="big">${angle}</span> °</div>
      </div>
      <div class="actions">
        <button class="btn" id="wFlip">${tr('翻转方向','Flip')}</button>
        <button class="btn" id="wAsOrigin">${tr('以起点为原点','Origin')}</button>
        <button class="btn danger" id="wDel">${tr('删除','Delete')}</button>
        <button class="btn" id="back">${tr('← 返回','← Back')}</button>
      </div></section>`);
    const store = this.app.store;
    const upd = fn => store.mutate('edit wall', s => { const t = s.plan.walls.find(x => x.id === wallId); if (t) fn(t); });
    const num = (sel, key) => { $(sel).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(t => t[key] = v); }; };
    num('#wX0','x0'); num('#wY0','y0'); num('#wX1','x1'); num('#wY1','y1'); num('#wT','t');
    $('#wKind').onchange = e => upd(t => t.kind = e.target.value);
    $('#wFlip').onclick = () => upd(t => { const a = t.x0, b = t.y0; t.x0 = t.x1; t.y0 = t.y1; t.x1 = a; t.y1 = b; });
    $('#wAsOrigin').onclick = () => this.app.view2d.setOrigin(w.x0, w.y0, 'wall');
    $('#wDel').onclick = () => { this.app.select(null); store.mutate('del wall', s => s.plan.walls = s.plan.walls.filter(x => x.id !== wallId)); };
    $('#back').onclick = () => this.app.select(null);
  }

  _doorPanel(key){
    const { plan } = this.app.store.state;
    const doors = plan.doors || [];
    const d = (typeof key === 'number' ? doors[key] : doors.find(x => x.id === key));
    if (!d) return this._editOverview();
    const doorId = d.id;
    const L = Math.round(linearLength(d));
    const angleDeg = Math.round(Math.atan2(d.y1 - d.y0, d.x1 - d.x0) * 180 / Math.PI);

    this._html(`<section><h3>${tr('门属性','Door')} <small>${d.entry ? tr('入户门','Entry') : tr('普通门','Standard')}</small></h3>
      <div class="form">
        <label class="full">${tr('名称','Name')}<input id="dName" value="${esc(d.name || '门')}"></label>
        <label>${tr('门宽','Width')} (mm)<input type="number" id="dLen" value="${L}" min="500" max="2400" step="10"></label>
        <label>${tr('厚度','Thickness')} (mm)<input type="number" id="dT" value="${d.t}" min="40" step="10"></label>

        <label class="full">${tr('门类型','Type')}
          <select id="dEntry">
            <option value="0" ${!d.entry ? 'selected' : ''}>${tr('普通门','Standard')}</option>
            <option value="1" ${d.entry ? 'selected' : ''}>${tr('入户门','Entry')}</option>
          </select></label>

        <label>${tr('铰链位置','Hinge')}
          <select id="dHinge">
            <option value="left"  ${d.hinge === 'left'  ? 'selected' : ''}>${tr('左端（x0y0）','Left end (x0y0)')}</option>
            <option value="right" ${d.hinge === 'right' ? 'selected' : ''}>${tr('右端（x1y1）','Right end (x1y1)')}</option>
          </select></label>

        <label>${tr('开启方向','Swing')}
          <select id="dSwing">
            <option value="in"  ${d.swing === 'in'  ? 'selected' : ''}>${tr('内侧（+法线）','Inner (+normal)')}</option>
            <option value="out" ${d.swing === 'out' ? 'selected' : ''}>${tr('外侧（-法线）','Outer (-normal)')}</option>
          </select></label>

        <label>X0 (mm)<input type="number" id="dX0" value="${Math.round(d.x0)}" step="10"></label>
        <label>Y0 (mm)<input type="number" id="dY0" value="${Math.round(d.y0)}" step="10"></label>
        <label>X1 (mm)<input type="number" id="dX1" value="${Math.round(d.x1)}" step="10"></label>
        <label>Y1 (mm)<input type="number" id="dY1" value="${Math.round(d.y1)}" step="10"></label>
      </div>

      <div class="stats" style="margin-top:8px">
        <div><small>${tr('长度','Length')}</small><span class="big">${L}</span> mm</div>
        <div><small>${tr('角度','Angle')}</small><span class="big">${angleDeg}</span> °</div>
      </div>

      <div class="actions">
        <button class="btn" id="dFlipH">${tr('左右互换铰链','Flip hinge')}</button>
        <button class="btn" id="dFlipS">${tr('内外互换','Flip swing')}</button>
        <button class="btn danger" id="dDel">${tr('删除','Delete')}</button>
        <button class="btn" id="back">${tr('← 返回','← Back')}</button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">${tr('提示：改门宽时铰链端固定不动，另一端沿墙方向伸缩。','Tip: when changing width, hinge stays fixed.')}</div>
    </section>`);

    const store = this.app.store;
    const upd = fn => store.mutate('edit door', s => {
      const t = s.plan.doors.find(x => x.id === doorId);
      if (t) fn(t);
    });

    $('#dName').onchange  = e => upd(t => t.name = e.target.value.trim() || t.name);
    $('#dEntry').onchange = e => upd(t => t.entry = e.target.value === '1');
    $('#dT').onchange     = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(t => t.t = Math.max(40, v)); };

    $('#dLen').onchange = e => {
      let v = parseFloat(e.target.value);
      if (isNaN(v)) return;
      v = Math.max(500, Math.min(2400, Math.round(v / 10) * 10));
      upd(t => {
        const dx = t.x1 - t.x0, dy = t.y1 - t.y0;
        const oldL = Math.hypot(dx, dy) || 1;
        const ux = dx / oldL, uy = dy / oldL;
        const hingeAtX0 = t.hinge !== 'right';
        const hx = hingeAtX0 ? t.x0 : t.x1;
        const hy = hingeAtX0 ? t.y0 : t.y1;
        if (hingeAtX0){ t.x1 = hx + ux * v; t.y1 = hy + uy * v; }
        else          { t.x0 = hx - ux * v; t.y0 = hy - uy * v; }
      });
    };

    $('#dHinge').onchange = e => upd(t => {
      t.hinge = e.target.value === 'right' ? 'right' : 'left';
      // 不交换端点：铰链只是「用哪一端作铰点」的开关
    });

    $('#dSwing').onchange = e => upd(t => t.swing = e.target.value);

    const num = (sel, key) => { $(sel).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(t => t[key] = v); }; };
    num('#dX0','x0'); num('#dY0','y0'); num('#dX1','x1'); num('#dY1','y1');

    $('#dFlipH').onclick = () => upd(t => {
      t.hinge = t.hinge === 'left' ? 'right' : 'left';
      // 不交换端点
    });
    $('#dFlipS').onclick = () => upd(t => t.swing = t.swing === 'in' ? 'out' : 'in');
    $('#dDel').onclick   = () => { this.app.select(null); store.mutate('del door', s => s.plan.doors = s.plan.doors.filter(x => x.id !== doorId)); };
    $('#back').onclick   = () => this.app.select(null);
  }

  _demolitionPanel(key){
    const { layout } = this.app.store.state;
    const list = layout.demolitions || [];
    const d = (typeof key === 'number' ? list[key] : list.find(x => x.id === key));
    if (!d) return this._editOverview();
    const dmId = d.id;
    const L = Math.round(Math.hypot(d.x1 - d.x0, d.y1 - d.y0));
    const angleDeg = Math.round(Math.atan2(d.y1 - d.y0, d.x1 - d.x0) * 180 / Math.PI);
    this._html(`<section><h3>${tr('拆除段','Demolition')}</h3>
      <div class="form">
        <label>${tr('宽','Width')} (mm)<input type="number" id="dmLen" value="${L}" min="100" step="10"></label>
        <label>X0 (mm)<input type="number" id="dmX0" value="${Math.round(d.x0)}" step="10"></label>
        <label>Y0 (mm)<input type="number" id="dmY0" value="${Math.round(d.y0)}" step="10"></label>
        <label>X1 (mm)<input type="number" id="dmX1" value="${Math.round(d.x1)}" step="10"></label>
        <label>Y1 (mm)<input type="number" id="dmY1" value="${Math.round(d.y1)}" step="10"></label>
      </div>
      <div class="stats" style="margin-top:8px">
        <div><small>${tr('长度','Length')}</small><span class="big">${L}</span> mm</div>
        <div><small>${tr('角度','Angle')}</small><span class="big">${angleDeg}</span> °</div>
      </div>
      <div class="actions">
        <button class="btn danger" id="dmDel">${tr('恢复墙体','Restore')}</button>
        <button class="btn" id="back">${tr('← 返回','← Back')}</button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">${tr('提示：改宽度时拆除段以中心对称伸缩。','Tip: width scales from center.')}</div>
    </section>`);

    const store = this.app.store;
    const upd = fn => store.mutate('edit demolition', s => {
      const t = (s.layout.demolitions || []).find(x => x.id === dmId);
      if (t) fn(t);
    });

    $('#dmLen').onchange = e => {
      const v = Math.max(100, Math.round(parseFloat(e.target.value) / 10) * 10);
      if (isNaN(v)) return;
      upd(t => {
        const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
        const dx = t.x1 - t.x0, dy = t.y1 - t.y0;
        const oldL = Math.hypot(dx, dy) || 1;
        const ux = dx / oldL, uy = dy / oldL;
        t.x0 = cx - ux * v / 2; t.y0 = cy - uy * v / 2;
        t.x1 = cx + ux * v / 2; t.y1 = cy + uy * v / 2;
      });
    };
    const num = (sel, key) => { $(sel).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(t => t[key] = v); }; };
    num('#dmX0','x0'); num('#dmY0','y0'); num('#dmX1','x1'); num('#dmY1','y1');
    $('#dmDel').onclick = () => {
      this.app.select(null);
      store.mutate('del demolition', s => s.layout.demolitions = (s.layout.demolitions || []).filter(x => x.id !== dmId));
    };
    $('#back').onclick = () => this.app.select(null);
  }

  _windowPanel(key){
    const { plan } = this.app.store.state;
    const wins = plan.windows || [];
    const w = (typeof key === 'number' ? wins[key] : wins.find(x => x.id === key));
    if (!w) return this._editOverview();
    const winId = w.id;
    const L = Math.round(linearLength(w));
    this._html(`<section><h3>${tr('窗属性','Window')}</h3>
      <div class="form">
        <label>${tr('宽','Width')} (mm)<input type="number" id="wLen" value="${L}" min="300" step="10"></label>
        <label>${tr('厚','Thickness')} (mm)<input type="number" id="wThk" value="${w.t}" min="60" step="10"></label>
        <label>${tr('窗台高','Sill')} (mm)<input type="number" id="wSill" value="${w.sill}" step="10"></label>
        <label>${tr('窗高','Height')} (mm)<input type="number" id="wH" value="${w.height}" step="10"></label>
      </div>
      <div class="actions">
        <button class="btn danger" id="wDel">${tr('删除','Delete')}</button>
        <button class="btn" id="back">${tr('← 返回','← Back')}</button>
      </div></section>`);
    const store = this.app.store;
    const upd = fn => store.mutate('edit window', s => { const t = s.plan.windows.find(x => x.id === winId); if (t) fn(t); });
    $('#wLen').onchange = e => {
      const v = Math.max(300, Math.round(parseFloat(e.target.value) / 10) * 10);
      if (isNaN(v)) return;
      upd(t => {
        const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
        const dx = t.x1 - t.x0, dy = t.y1 - t.y0;
        const oldL = Math.hypot(dx, dy) || 1;
        const ux = dx / oldL, uy = dy / oldL;
        t.x0 = cx - ux * v / 2; t.y0 = cy - uy * v / 2;
        t.x1 = cx + ux * v / 2; t.y1 = cy + uy * v / 2;
      });
    };
    $('#wThk').onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(t => t.t = Math.max(60, v)); };
    $('#wSill').onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(t => t.sill = v); };
    $('#wH').onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(t => t.height = v); };
    $('#wDel').onclick = () => { this.app.select(null); store.mutate('del window', s => s.plan.windows = s.plan.windows.filter(x => x.id !== winId)); };
    $('#back').onclick = () => this.app.select(null);
  }

  _html(inner){ this.root.innerHTML = inner; }
}