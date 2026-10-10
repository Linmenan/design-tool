import { $, $$, esc, fmt, norm, area, perim, bbox, aabb, uid, toast, shade, clamp, distToSeg } from '../core/Utils.js';
import { tr, nm } from '../core/I18n.js';
import {
  linearPoly, linearLength, linearDir, linearNormal, pointOnLine,
} from '../data/planData.js';
import { furnSVG, NOLABEL } from './FurnSVG.js';
import { typeColor } from '../data/furnitureLib.js';

const COARSE = matchMedia('(pointer:coarse)').matches;
const TAP = COARSE ? 9 : 4;
const LOG = true;
const log = (...a) => LOG && console.log('[PV]', ...a);

/**
 * PlanView — 2D 平面渲染 + 交互（v3）。
 *
 * 墙体 / 门 / 窗全部使用线性构件格式：
 *   { id, kind, x0, y0, x1, y1, t, ... }
 *
 * 拖拽规则：
 *   - 拖墙端点 / 门窗端点：改端点
 *   - 拖墙身：整体平移，联动 hostWall 的门窗
 *   - 拖门/窗身：沿墙中心线滑动
 *   - 家具：原有的旋转 / 尺寸 / 移动
 *   - 房间：暂不支持整体拖拽（避免和墙联动复杂化）
 */
export class PlanView {
  constructor(app, viewport){
    this.app = app;
    this.vp = viewport;
    this.svg = $('#plan');
    this.drag = null;
    this.touches = new Map();
    this.pinch = null;
    this._stage = 'layout';
    this._fitDone = false;

    this.editor = {
      wallKind: 'n',
      wallThickness: 240,
      roomMat: 'tile800',
      doorWidth: 900,
      doorHinge: 'left',
      doorSwing: 'in',
      doorEntry: false,
      winSill: 900,
      winHeight: 1500,
      winWidth: 1200,
    };

    this.vp.onChange(() => { this.renderSel(); this.renderMeasure(); this.syncScalebar(); });
    this._bind();
  }

  /* =========================== 生命周期 =========================== */
  async mount(){
    this.rebuildDefs();
    this.renderAll();
    this.setTool('select');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let i = 0; i < 60 && !this.vp.fit(this.app.store.state.plan.bounds); i++){
      await new Promise(r => requestAnimationFrame(r));
    }
    this._fitDone = true;
    this.renderAll();
    this._ro = new ResizeObserver(() => {
      if (!this.svg.clientWidth) return;
      if (!this._fitDone) this._fitDone = this.vp.fit(this.app.store.state.plan.bounds);
      else this.vp.apply();
    });
    this._ro.observe(this.svg);
  }

  onStageChange(stage){
    this._stage = stage;
    const hud = $('#editHud');
    if (hud) hud.style.display = stage === 'edit' ? 'flex' : 'none';
    this.renderAll();
  }

  get isEdit(){ return this._stage === 'edit'; }

  /* =========================== defs =========================== */
  rebuildDefs(){
    const plank = (id, base, line) => `<pattern id="m-${id}" patternUnits="userSpaceOnUse" width="1800" height="360">
      <rect width="1800" height="360" fill="${base}"/>
      <path d="M0 0H1800M0 180H1800M1200 0V180M600 180V360" stroke="${line}" stroke-width="10"/>
      <path d="M100 70Q500 60 900 85T1700 75M200 260Q700 250 1100 275T1750 262" stroke="${line}" stroke-width="5" fill="none" opacity=".45"/></pattern>`;
    const tile = (id, size, base, line) => `<pattern id="m-${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="${base}"/><path d="M0 0H${size}M0 0V${size}" stroke="${line}" stroke-width="10"/></pattern>`;
    $('#defs').innerHTML =
      plank('wood','#dcc09a','#bf9d70') + plank('walnut','#a57c56','#80593a') +
      tile('tile800',800,'#ece7de','#d3cabb') + tile('tile600',600,'#e2e6e3','#c4cbc6') + tile('antislip',300,'#d6dbd7','#b3bab4') +
      `<pattern id="m-marble" patternUnits="userSpaceOnUse" width="1200" height="1200">
        <rect width="1200" height="1200" fill="#f3f0ea"/><path d="M0 0H1200M0 0V1200" stroke="#dcd5c8" stroke-width="10"/>
        <path d="M-50 300C250 260 380 520 700 470S1100 640 1260 600M200 1200C300 950 520 980 640 820" stroke="#d6cfc2" stroke-width="12" fill="none"/></pattern>
      <pattern id="m-terrazzo" patternUnits="userSpaceOnUse" width="500" height="500">
        <rect width="500" height="500" fill="#e8e1d5"/>
        <circle cx="60" cy="80" r="22" fill="#b9a58c"/><circle cx="310" cy="140" r="16" fill="#8fa3a0"/><circle cx="190" cy="330" r="26" fill="#c9b7a2"/>
        <circle cx="420" cy="400" r="18" fill="#a88f76"/><circle cx="90" cy="440" r="12" fill="#8fa3a0"/><circle cx="440" cy="40" r="10" fill="#b9a58c"/></pattern>
      <pattern id="m-carpet" patternUnits="userSpaceOnUse" width="120" height="120">
        <rect width="120" height="120" fill="#c9c3d3"/><circle cx="30" cy="30" r="8" fill="#bab3c6"/><circle cx="90" cy="90" r="8" fill="#bab3c6"/></pattern>
      <pattern id="grid" patternUnits="userSpaceOnUse" width="1000" height="1000">
        <path d="M500 0V1000M0 500H1000" stroke="#e5dfd3" stroke-width="8"/><path d="M0 0V1000M0 0H1000" stroke="#d8d0c1" stroke-width="14"/></pattern>`;
  }

  /* =========================== 渲染 =========================== */
  renderAll(){
    const steps = ['renderGrid','renderRooms','renderFurn','renderWalls','renderOpenings','renderLabels','renderDims','renderMeasure','renderSel','syncScalebar','syncFooter','syncEditHud'];
    for (const name of steps){
      try { this[name](); } catch (e) { console.error('[PV] ' + name + ' 失败:', e); }
    }
  }

  renderGrid(){
    const b = this.app.store.state.plan.bounds || { x:-4000, y:-4000, w:14000, h:12000 };
    const pad = 5000;
    const fill = this.app.ui.layers.grid ? 'url(#grid)' : 'transparent';
    $('#gGrid').innerHTML = `<rect x="${b.x-pad}" y="${b.y-pad}" width="${b.w+pad*2}" height="${b.h+pad*2}" fill="${fill}"/>`;
  }

  renderRooms(){
    const { plan } = this.app.store.state;
    let s = '';
    (plan.rooms || []).forEach(r => {
      if (!r.poly || !r.poly.length) return;
      s += `<polygon class="room" data-room="${r.id}" points="${r.poly.map(p => p.join(',')).join(' ')}" fill="url(#m-${r.mat})"/>`;
    });
    // 门/窗洞底板（浅色，最终会被 gOpen 的门套覆盖）
    const sill = el => {
      const poly = linearPoly(el);
      if (!poly) return '';
      return `<polygon points="${poly.map(p => p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="#e2dacb" pointer-events="none"/>`;
    };
    (plan.doors || []).forEach(d => s += sill(d));
    (plan.windows || []).forEach(w => s += sill(w));
    $('#gRooms').innerHTML = s;
  }

  renderFurn(){
    const g = $('#gFurn');
    const show = !this.isEdit && this.app.ui.layers.furn;
    g.setAttribute('display', show ? 'inline' : 'none');
    if (!show){ g.innerHTML = ''; return; }
    g.innerHTML = (this.app.store.state.layout.furniture || []).map(f => {
      const fs = Math.max(80, Math.min(170, Math.min(f.w, f.d) * .2));
      const label = Math.min(f.w, f.d) >= 380 && !NOLABEL.includes(f.type)
        ? `<text transform="rotate(${-f.rot})" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="#4a443c" opacity=".8" pointer-events="none">${esc(nm(f.name))}</text>` : '';
      return `<g class="furn" data-fid="${f.id}" transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">${furnSVG(f.type, f.w, f.d, f.color)}${label}</g>`;
    }).join('');
  }

  renderWalls(){
    const { plan, layout } = this.app.store.state;
    const bearing = this.app.ui.layers.bearing;
    const dem = this.isEdit ? [] : (layout.demolished || []);
    $('#gWalls').innerHTML = (plan.walls || []).map((w, i) => {
      // 数值校验，防止 NaN 渗透到 SVG
      if (!w
        || !Number.isFinite(+w.x0) || !Number.isFinite(+w.y0)
        || !Number.isFinite(+w.x1) || !Number.isFinite(+w.y1)
        || !Number.isFinite(+w.t) || +w.t <= 0) return '';
      if (Math.hypot(+w.x1 - +w.x0, +w.y1 - +w.y0) < 1) return '';
      const poly = linearPoly(w);
      if (!poly) return '';
      const id = w.id || ('w' + i);
      const isDem = dem.includes(id);
      const k = w.kind || 'n';
      let fill = k === 'b' ? (bearing ? '#b8412c' : '#26241f') : k === 'low' ? '#e9e3d8' : k === 'e' ? '#8f897d' : '#a7a195';
      let ex = k === 'low' ? 'stroke="#8f897d" stroke-width="1" vector-effect="non-scaling-stroke"' : '';
      if (isDem){
        fill = 'rgba(198,91,58,.12)';
        ex = 'stroke="#c65b3a" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"';
      }
      return `<polygon class="wall" data-wall="${id}" points="${poly.map(p => p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="${fill}" ${ex}/>`;
    }).join('');
  }

  /**
   * 门窗：完全用线性构件渲染
   *   - 门套（白色多边形）覆盖门洞 → 解决"被墙压住"
   *   - 门扇 + 开门弧；窗 = 双线玻璃
   */
  renderOpenings(){
    const { plan } = this.app.store.state;
    let s = '';
    const isOK = el => el
      && Number.isFinite(+el.x0) && Number.isFinite(+el.y0)
      && Number.isFinite(+el.x1) && Number.isFinite(+el.y1)
      && Math.hypot(+el.x1 - +el.x0, +el.y1 - +el.y0) > 1;

    /* ---- 窗 ---- */
    (plan.windows || []).forEach(win => {
      if (!isOK(win)) return;
      const poly = linearPoly(win);
      if (!poly) return;
      const pstr = poly.map(p => p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
      // 窗洞底板（白色，盖住墙）
      s += `<polygon points="${pstr}" fill="#fff" stroke="#4f7394" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
      // 玻璃双线
      const [dx, dy] = linearDir(win);
      const nx = -dy, ny = dx;
      const gap = Math.max(8, win.t * .18);
      const [x0, y0, x1, y1] = [win.x0, win.y0, win.x1, win.y1];
      s += `<line x1="${x0 + nx*gap}" y1="${y0 + ny*gap}" x2="${x1 + nx*gap}" y2="${y1 + ny*gap}" stroke="#4f7394" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      s += `<line x1="${x0 - nx*gap}" y1="${y0 - ny*gap}" x2="${x1 - nx*gap}" y2="${y1 - ny*gap}" stroke="#4f7394" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    });

    /* ---- 门 ---- */
    (plan.doors || []).forEach(door => {
      if (!isOK(door)) return;
      const poly = linearPoly(door);
      if (!poly) return;
      const pstr = poly.map(p => p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
      const entry = door.entry;
      const strokeCol = entry ? '#b5653a' : '#3d3a34';

      // ① 门套白色底板（覆盖墙）
      s += `<polygon points="${pstr}" fill="#fff" stroke="${strokeCol}" stroke-width="${entry?1.8:1.2}" vector-effect="non-scaling-stroke" pointer-events="none"/>`;

      // ② 铰点 & 关闭方向 & 开启方向（三者解耦）
      const len = linearLength(door);
      const [dx, dy] = linearDir(door);            // 沿墙方向：x0y0 → x1y1
      // 开启方向：由「墙的法向量」+ swing 决定，与铰点无关
      const wallN = [-dy, dx];                     // 墙的法向量（逆时针 90°）
      const swingSign = door.swing === 'out' ? -1 : 1;
      const oDir = [wallN[0] * swingSign, wallN[1] * swingSign];
      // 铰点位置：由 hinge 决定在哪一端
      const hingeAtX0 = door.hinge !== 'right';
      const hx = hingeAtX0 ? door.x0 : door.x1;
      const hy = hingeAtX0 ? door.y0 : door.y1;
      // 关闭方向：从铰点指向另一端
      const cDir = hingeAtX0 ? [dx, dy] : [-dx, -dy];

      // ③ 门扇（40mm 厚）
      const leafT = 42;
      const ex = hx + oDir[0] * len, ey = hy + oDir[1] * len;
      // 门扇四角：铰点沿 o 方向展开一个 40mm 宽的板
      const leafPoly = [
        [hx + cDir[0]*0, hy + cDir[1]*0],
        [ex, ey],
        [ex + cDir[0]*leafT, ey + cDir[1]*leafT],
        [hx + cDir[0]*leafT, hy + cDir[1]*leafT],
      ];
      s += `<polygon points="${leafPoly.map(p => p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" fill="#efe6d8" stroke="${strokeCol}" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;

      // ④ 开门弧线
      const sweep = (cDir[0]*oDir[1] - cDir[1]*oDir[0]) > 0 ? 0 : 1;
      const arcEnd = [hx + cDir[0]*len, hy + cDir[1]*len];
      s += `<path d="M${ex} ${ey}A${len} ${len} 0 0 ${sweep} ${arcEnd[0]} ${arcEnd[1]}" fill="none" stroke="${strokeCol}" stroke-width="1" stroke-dasharray="5 3" opacity=".7" vector-effect="non-scaling-stroke"/>`;

      // ⑤ 入户标识
      if (entry){
        const cx = (door.x0 + door.x1) / 2, cy = (door.y0 + door.y1) / 2;
        const tx = cx - oDir[0] * 900, ty = cy - oDir[1] * 900;
        const ex2 = cx + oDir[0] * 900, ey2 = cy + oDir[1] * 900;
        s += `<line x1="${tx}" y1="${ty}" x2="${ex2}" y2="${ey2}" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke"/>
              <text x="${tx}" y="${ty - 240}" font-size="220" fill="#b5653a">${tr('入户','Entry')}</text>`;
      }
    });

    /* ---- 推拉门 ---- */
    (plan.slides || []).forEach(sl => {
      if (!sl.rect) return;
      const [x0, y0, x1, y1] = sl.rect;
      const xa = Math.min(x0, x1), ya = Math.min(y0, y1), xb = Math.max(x0, x1), yb = Math.max(y0, y1);
      const DS = 'stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"';
      if (sl.v){
        const L = yb - ya, m = (xa + xb) / 2;
        s += `<rect x="${m-45}" y="${ya}" width="40" height="${L*.55}" fill="#fff" ${DS}/><rect x="${m+5}" y="${yb-L*.55}" width="40" height="${L*.55}" fill="#fff" ${DS}/>`;
      } else {
        const L = xb - xa, m = (ya + yb) / 2;
        s += `<rect x="${xa}" y="${m-45}" width="${L*.55}" height="40" fill="#fff" ${DS}/><rect x="${xb-L*.55}" y="${m+5}" width="${L*.55}" height="40" fill="#fff" ${DS}/>`;
      }
    });

    $('#gOpen').innerHTML = s;
  }

  renderLabels(){
    const g = $('#gLabels');
    g.setAttribute('display', this.app.ui.layers.labels ? 'inline' : 'none');
    const halo = 'stroke="#fbf9f4" stroke-width="45" paint-order="stroke" stroke-linejoin="round"';
    g.innerHTML = (this.app.store.state.plan.rooms || []).filter(r => r.at).map(r => {
      const [x, y] = r.at;
      return `<text x="${x}" y="${y}" font-size="250" font-weight="600" text-anchor="middle" fill="#2b2824" ${halo}>${esc(nm(r.name))}</text>
        <text x="${x}" y="${y+260}" font-size="175" text-anchor="middle" fill="#7d7366" ${halo}>${fmt(area(r.poly))} m²</text>`;
    }).join('');
  }

  renderDims(){
    const DC = '#7d7160';
    const LS = `stroke="${DC}" stroke-width="1" vector-effect="non-scaling-stroke"`;
    const TK = `stroke="${DC}" stroke-width="2" vector-effect="non-scaling-stroke"`;
    const txt = (x, y, v, rot) => `<text x="${x}" y="${y}" font-size="${v < 400 ? 140 : 200}" text-anchor="middle" fill="${DC}" ${rot ? `transform="rotate(-90 ${x} ${y})"` : ''}>${v}</text>`;
    const chain = (horiz, at, start, segs) => {
      const pts = [start]; segs.forEach(v => pts.push(pts[pts.length-1] + v));
      let s = horiz ? `<line x1="${pts[0]}" y1="${at}" x2="${pts.at(-1)}" y2="${at}" ${LS}/>` : `<line x1="${at}" y1="${pts[0]}" x2="${at}" y2="${pts.at(-1)}" ${LS}/>`;
      pts.forEach(p => s += horiz
        ? `<line x1="${p}" y1="${at-170}" x2="${p}" y2="${at+170}" ${LS}/><line x1="${p-80}" y1="${at+80}" x2="${p+80}" y2="${at-80}" ${TK}/>`
        : `<line x1="${at-170}" y1="${p}" x2="${at+170}" y2="${p}" ${LS}/><line x1="${at-80}" y1="${p+80}" x2="${at+80}" y2="${p-80}" ${TK}/>`);
      segs.forEach((v, i) => { const mid = (pts[i] + pts[i+1]) / 2; s += horiz ? txt(mid, at-70, v) : txt(at-70, mid, v, true); });
      return s;
    };
    const g = $('#gDims');

    // 固定尺寸链（仅默认户型）
    const isDefault = this.app.store.state.meta.name === '三室两厅两卫';
    const fixed = isDefault
      ? chain(true,-750,0,[1580,240,2760,240,1540,240,3670]) + chain(true,-1250,0,[10270]) +
        chain(true,11350,0,[2180,240,2160,240,5450,240,1340]) + chain(true,11850,0,[11850]) +
        chain(false,-800,0,[3370,1580,240,2770,240,2360]) + chain(false,-1300,0,[10560]) +
        chain(false,12750,0,[3370,240,2760,240,3950]) + chain(false,13250,0,[10560])
      : '';

    // 自动房间尺寸链
    const auto = this.app.ui.layers.autoDims ? this._buildAutoDims() : '';

    g.innerHTML = fixed + auto;
    // 只要「固定尺寸」或「房间尺寸」任一开启，这个 SVG 组就显示
    const visible = this.app.ui.layers.dims || this.app.ui.layers.autoDims;
    g.setAttribute('display', visible ? 'inline' : 'none');
  }

  /* ============================================================
   *  房间自动尺寸链（方案 B）
   *
   *  对每个房间：
   *    ① 找最长边作为「主方向」d，法向 n = perp(d)
   *    ② 把房间所有顶点投影到 d / n，得到沿两个方向的坐标集合
   *    ③ 沿主方向 d，在 nMin 侧偏移 OFFSET 生成一条尺寸链
   *    ④ 沿法方向 n，在 dMin 侧偏移 OFFSET 生成一条尺寸链
   *
   *  支持斜房间：以最长边为主方向
   *  支持凹形房间：所有顶点都参与投影（角点自然被包含）
   *  相邻房间会各标一次（分别属于两个房间），视觉上分区清晰
   * ============================================================ */
  _buildAutoDims(){
    const rooms = this.app.store.state.plan.rooms || [];
    const k = 1 / vpSafe(this.vp.s);
    const FS = 12 * k;              // 字号（屏幕像素换算到用户单位）
    const OFFSET = 420;             // 尺寸线距房间边界的偏移 mm
    const LABEL_INSET = 90;         // 数字距尺寸线的内偏移 mm
    const TICK = 100;               // 端点刻度短横长度 mm
    const MIN_SEG = 40;             // 小于此长度的段不标注

    const out = [];

    for (const r of rooms){
      if (!r.poly || r.poly.length < 3) continue;
      // 跳过飘窗这种辅助房间
      if (r.counted === false) continue;

      const poly = r.poly;
      const n = poly.length;

      // ① 找最长边
      let best = null, bestL = 0;
      for (let i = 0; i < n; i++){
        const a = poly[i], b = poly[(i + 1) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        if (L > bestL){ bestL = L; best = { a, b, dx, dy, L }; }
      }
      if (!best || bestL < 500) continue;

      // ② 主方向 d 与法向 n
      const dx = best.dx / bestL, dy = best.dy / bestL;
      const nx = -dy, ny = dx;
      const ox = best.a[0], oy = best.a[1];

      // ③ 投影所有顶点
      const dVals = [], nVals = [];
      for (const p of poly){
        const px = p[0] - ox, py = p[1] - oy;
        dVals.push(px * dx + py * dy);
        nVals.push(px * nx + py * ny);
      }
      const dMin = Math.min(...dVals), dMax = Math.max(...dVals);
      const nMin = Math.min(...nVals), nMax = Math.max(...nVals);

      // ④ 生成沿 d 方向的尺寸链（放在 nMin 侧）
      const dNodes = this._uniqueSorted(dVals, 50);
      // 只有分段 > 1 才画
      if (dNodes.length >= 2){
        out.push(this._chainSVG(
          [ox, oy], [dx, dy], [nx, ny],
          dNodes, nMin - OFFSET, 'd',
          { k, FS, LABEL_INSET, TICK, MIN_SEG, isFirst:true }
        ));
      }

      // ⑤ 生成沿 n 方向的尺寸链（放在 dMin 侧）
      const nNodes = this._uniqueSorted(nVals, 50);
      if (nNodes.length >= 2){
        out.push(this._chainSVG(
          [ox, oy], [nx, ny], [dx, dy],
          nNodes, dMin - OFFSET, 'n',
          { k, FS, LABEL_INSET, TICK, MIN_SEG, isFirst:true }
        ));
      }
    }

    return out.join('');
  }

  /** 数组排序 + 去重（相邻差 < minGap 的合并取中值） */
  _uniqueSorted(arr, minGap){
    const s = [...arr].sort((a, b) => a - b);
    const out = [s[0]];
    for (let i = 1; i < s.length; i++){
      if (s[i] - out[out.length - 1] >= minGap) out.push(s[i]);
      else out[out.length - 1] = (out[out.length - 1] + s[i]) / 2;
    }
    return out;
  }

  /**
   * 生成一条尺寸链的 SVG。
   * @param origin   局部坐标系原点 [x, y]（mm）
   * @param dir      沿尺寸方向单位向量 [dx, dy]
   * @param normal   垂直方向单位向量 [nx, ny]（尺寸线朝这一侧的 -offset 放置）
   * @param params   沿 dir 方向的所有节点坐标（已排序去重）
   * @param offset   尺寸线相对 normal 方向的偏移量
   * @param mode     'd' 或 'n'（仅用于 debug / 微调）
   * @param opts     { k, FS, LABEL_INSET, TICK, MIN_SEG }
   */
  _chainSVG(origin, dir, normal, params, offset, mode, opts){
    const { k, FS, LABEL_INSET, TICK, MIN_SEG } = opts;
    const [ox, oy] = origin;
    const [dx, dy] = dir;
    const [nx, ny] = normal;
    const LS = `stroke="#7d7160" stroke-width="1" vector-effect="non-scaling-stroke"`;
    const TXT_STYLE = `text-anchor="middle" fill="#7d7160" font-weight="600"`;
    const HALO = `stroke="#fbf9f4" stroke-width="${3.5*k}" paint-order="stroke" stroke-linejoin="round"`;

    const px = (t, o) => ox + t * dx + o * nx;
    const py = (t, o) => oy + t * dy + o * ny;

    const parts = [];
    const t0 = params[0], t1 = params[params.length - 1];

    // 主尺寸线
    parts.push(`<line x1="${px(t0, offset)}" y1="${py(t0, offset)}" x2="${px(t1, offset)}" y2="${py(t1, offset)}" ${LS}/>`);

    // 每条节点的延长线（从房间边界垂直到尺寸线）
    params.forEach(t => {
      parts.push(`<line x1="${px(t, offset - 160)}" y1="${py(t, offset - 160)}" x2="${px(t, offset + 160)}" y2="${py(t, offset + 160)}" ${LS}/>`);
    });

    // 每段数值 —— 中国建筑制图规范：文字头朝上/朝右，角度归一化到 [-90°, 90°]
    let ang = Math.atan2(dy, dx) * 180 / Math.PI;
    if (ang > 90)  ang -= 180;
    else if (ang < -90) ang += 180;
    for (let i = 0; i < params.length - 1; i++){
      const seg = params[i + 1] - params[i];
      if (seg < MIN_SEG) continue;
      const mid = (params[i] + params[i + 1]) / 2;
      const x = px(mid, offset - LABEL_INSET);
      const y = py(mid, offset - LABEL_INSET);
      const value = Math.round(seg);
      parts.push(`<text x="${x}" y="${y}" font-size="${FS}" ${TXT_STYLE} ${HALO} transform="rotate(${ang} ${x} ${y})">${value}</text>`);
    }

    return parts.join('');
  }

  renderMeasure(){
    const k = 1 / this.vp.s, fs = 12 * k;
    const { measures } = this.app.store.state.layout;
    const one = (a, b, tmp) => {
      const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1) return '';
      let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y) / L * 5 * k, ny = (b.x - a.x) / L * 5 * k;
      const col = tmp ? '#2f5d62' : '#b5653a';
      const S = `stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"`;
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${S}/>
        <line x1="${a.x-nx}" y1="${a.y-ny}" x2="${a.x+nx}" y2="${a.y+ny}" ${S}/><line x1="${b.x-nx}" y1="${b.y-ny}" x2="${b.x+nx}" y2="${b.y+ny}" ${S}/>
        <text x="${mx}" y="${my-5*k}" font-size="${fs}" text-anchor="middle" fill="${col}" font-weight="600" transform="rotate(${ang} ${mx} ${my})"
          stroke="#fff" stroke-width="${3.5*k}" paint-order="stroke">${Math.round(L)} mm</text>`;
    };
    let s = (measures || []).map(m => one(m.a, m.b)).join('');
    const { mA, mCur } = this.app.ui;
    if (mA && mCur) s += one(mA, mCur, true);
    if (mA) s += `<circle cx="${mA.x}" cy="${mA.y}" r="${3*k}" fill="#2f5d62"/>`;
    $('#gMeasure').innerHTML = s;
  }

  /* ---- 选中高亮 + 控制点 ---- */
  renderSel(){
    const k = 1/vpSafe(this.vp.s), sel = this.app.ui.sel;
    let s = '';
    const R = 6 * k, HIT = 18 * k;

    if (sel?.kind === 'wall'){
      const w = (this.app.store.state.plan.walls || []).find(x => x.id === sel.id);
      if (w) s += this._selLinear(w, '#2f5d62', R, HIT, 'wall');
    } else if (sel?.kind === 'door'){
      const d = (this.app.store.state.plan.doors || []).find(x => x.id === sel.id);
      if (d) s += this._selLinear(d, '#2f5d62', R, HIT, 'door');
    } else if (sel?.kind === 'window'){
      const w = (this.app.store.state.plan.windows || []).find(x => x.id === sel.id);
      if (w) s += this._selLinear(w, '#4f7394', R, HIT, 'window');
    } else if (sel?.kind === 'room'){
      const r = (this.app.store.state.plan.rooms || []).find(x => x.id === sel.id);
      if (r){
        // 房间多边形高亮
        s += `<polygon points="${r.poly.map(p => p.join(',')).join(' ')}" fill="rgba(181,101,58,.08)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;

        // 顶点（实心圆，可拖动）+ 边中点（空心圆，点击插入新顶点）
        const n = r.poly.length;
        const HIT = 16 * k, R = 6 * k;
        for (let i = 0; i < n; i++){
          const [vx, vy] = r.poly[i];
          s += `<circle data-handle="room-vertex" data-idx="${i}" cx="${vx}" cy="${vy}" r="${HIT}" fill="transparent"/>`;
          s += `<circle cx="${vx}" cy="${vy}" r="${R}" fill="#b5653a" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`;

          const [vx2, vy2] = r.poly[(i + 1) % n];
          const mx = (vx + vx2) / 2, my = (vy + vy2) / 2;
          s += `<circle data-handle="room-edge-mid" data-idx="${i}" cx="${mx}" cy="${my}" r="${HIT * 0.8}" fill="transparent"/>`;
          s += `<circle cx="${mx}" cy="${my}" r="${R * 0.7}" fill="#fff" stroke="#b5653a" stroke-width="1.2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
        }
      }
    } else if (sel?.kind === 'furn' && !this.isEdit){
      const f = this.app.store.getFurniture(sel.id);
      if (f){
        const p = 5 * k, A = 'stroke="#b5653a" vector-effect="non-scaling-stroke"';
        const hs = COARSE ? 1.7 : 1, ro = (COARSE ? 40 : 26) * k, hit = (COARSE ? 24 : 11) * k;
        const sx = f.w/2 + p, sy = f.d/2 + p;
        s += `<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">
          <rect x="${-f.w/2-p}" y="${-f.d/2-p}" width="${f.w+2*p}" height="${f.d+2*p}" fill="none" ${A} stroke-width="1.5" stroke-dasharray="5 3" pointer-events="none"/>
          <circle data-handle="rot" cx="0" cy="${-f.d/2-ro}" r="${hit}" fill="transparent"/>
          <circle data-handle="rot" cx="0" cy="${-f.d/2-ro}" r="${6*hs*k}" fill="#fff" ${A} stroke-width="1.5"/>
          <circle data-handle="size" cx="${sx}" cy="${sy}" r="${hit}" fill="transparent"/>
          <rect data-handle="size" x="${sx-5*hs*k}" y="${sy-5*hs*k}" width="${10*hs*k}" height="${10*hs*k}" fill="#b5653a"/></g>`;
      }
    }
    $('#gSel').innerHTML = s;
  }

  /** 线性构件选中高亮 + 两端控制点 */
  _selLinear(el, color, R, HIT, kind){
    const poly = linearPoly(el);
    if (!poly) return '';
    const pstr = poly.map(p => p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    const L = Math.round(linearLength(el));
    const tag = kind === 'wall' ? `L=${L} t=${el.t}` : kind === 'door' ? `门 ${L} t=${el.t}` : `窗 ${L} t=${el.t}`;
    const mx = (el.x0 + el.x1)/2, my = (el.y0 + el.y1)/2 - 220/viewFromHack(this.vp);
    return `
      <polygon points="${pstr}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>
      <circle data-handle="linear-end" data-end="0" cx="${el.x0}" cy="${el.y0}" r="${HIT}" fill="transparent"/>
      <circle data-handle="linear-end" data-end="0" cx="${el.x0}" cy="${el.y0}" r="${R}" fill="${color}" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>
      <circle data-handle="linear-end" data-end="1" cx="${el.x1}" cy="${el.y1}" r="${HIT}" fill="transparent"/>
      <circle data-handle="linear-end" data-end="1" cx="${el.x1}" cy="${el.y1}" r="${R}" fill="${color}" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>
      <text x="${mx}" y="${my}" font-size="${13/viewFromHack(this.vp)}" text-anchor="middle" fill="${color}" font-weight="600" pointer-events="none">${tag}</text>`;
  }

  syncScalebar(){
    const s = this.vp.s;
    const nice = [100,200,500,1000,2000,5000].find(v => v * s >= 60) || 5000;
    const bar = $('#sbBar'); if (bar) bar.style.width = nice * s + 'px';
    const txt = $('#sbText'); if (txt) txt.textContent = nice >= 1000 ? `${nice/1000} m` : `${nice} mm`;
    const ratio = $('#ratio'); if (ratio) ratio.textContent = '1:' + Math.round(this.vp.ratio);
  }

  syncFooter(){
    const { plan } = this.app.store.state;
    const tot = (plan.rooms || []).filter(r => r.counted !== false).reduce((a, r) => a + area(r.poly), 0);
    const sub = $('#subtitle');
    if (sub) sub.textContent = this.isEdit
      ? tr(`墙体 ${plan.walls.length} · 房间 ${plan.rooms.length} · 门 ${plan.doors.length} · 窗 ${plan.windows.length}`, `Walls ${plan.walls.length} · Rooms ${plan.rooms.length} · Doors ${plan.doors.length} · Windows ${plan.windows.length}`)
      : tr(`套内使用面积约 ${fmt(tot)} m² · 尺寸单位 mm`, `Net floor area ≈ ${fmt(tot)} m² · Units: mm`);
  }

  syncEditHud(){
    if (!this.isEdit) return;
    const hud = $('#editHud');
    if (!hud) return;
    if (!hud.querySelector('[data-pos]')){
      hud.innerHTML = `
        <div class="row"><span>${tr('光标','Cursor')}</span><b data-pos>—</b></div>
        <div class="row"><span>${tr('原点','Origin')}</span><b data-origin>—</b></div>
        <div class="row"><span>${tr('当前工具','Tool')}</span><b data-hint>—</b></div>`;
    }
    const o = this.app.store.state.plan.origin || { x:0, y:0 };
    const posEl = hud.querySelector('[data-pos]');
    if (posEl && this._lastPos) posEl.textContent = `${Math.round(this._lastPos.x)}, ${Math.round(this._lastPos.y)}`;
    const org = hud.querySelector('[data-origin]');
    if (org) org.textContent = `(${o.x}, ${o.y})`;
    const hint = hud.querySelector('[data-hint]');
    if (hint){
      const t = this.app.ui.tool;
      const map = {
        'draw-wall':  tr(`画墙 · 厚 ${this.editor.wallThickness} · ${this.editor.wallKind}`, `Wall`),
        'add-door':   tr(`门 ${this.editor.doorWidth}`, `Door`),
        'add-window': tr(`窗 ${this.editor.winWidth}×${this.editor.winHeight}`, `Window`),
        'draw-room':  tr(`画房间 · ${this.editor.roomMat}`, `Room`),
        'auto-room':  tr('智能房间 · 点击空白处自动识别', `Smart room`),
        'measure':    tr('测量 · 点两点', 'Measure'),
        'demolish':   tr('拆墙', 'Demolish'),
        'select':     tr('选择 · 拖动墙身联动门窗', 'Select'),
      };
      hint.textContent = map[t] || t;
    }
  }

  setTool(t){
    // 装修阶段不允许使用编辑类工具
    const EDIT_ONLY = ['draw-wall','draw-room','add-door','add-window'];
    if (!this.isEdit && EDIT_ONLY.includes(t)){
      t = 'select';
      toast(tr('装修布置阶段不能编辑墙体，请先切到「户型编辑」', 'Switch to Plan Edit to modify walls'));
    }
    this.app.ui.tool = t;
    this.svg.setAttribute('class', 'tool-' + t);
    this.syncModeHint();
    this.syncEditHud();
    this.renderMeasure();
    this.renderSel();
  }

  syncModeHint(){
    const hints = {
      select: tr('点击选中 · 拖墙身整体移动 · 拖端点改长度', 'Click to select; drag body to move; drag ends to resize'),
      measure: tr('点击两点测量距离 · Shift 锁定水平/垂直', 'Click two points'),
      demolish: tr('点击灰色非承重墙标记拆除', 'Click a grey wall to remove'),
      'draw-wall': tr('拖动绘制墙体 · Shift 锁定正交 · 斜墙沿中心线生成', 'Drag to draw; Shift locks'),
      'draw-room': tr('拖动绘制矩形房间', 'Drag to draw a rect room'),
      'auto-room': tr('点击房间内部空白处，自动沿墙识别多边形房间 · 识别后可直接拖动顶点微调 · 右键顶点删除', 'Click inside an empty room area to detect the polygon automatically · Drag vertices to adjust · Right-click a vertex to delete'),
      'add-door': tr('在墙上点一下放置门', 'Click a wall'),
      'add-window': tr('在墙上点一下放置窗', 'Click a wall'),
    };
    const h = $('#modehint');
    if (!h) return;
    h.textContent = hints[this.app.ui.tool] || '';
    h.classList.toggle('show', !!(hints[this.app.ui.tool]));
  }

  fit(){ this._fitDone = this.vp.fit(this.app.store.state.plan.bounds); }

  /* =========================== 吸附 =========================== */
  snapRects(){
    const { plan, layout } = this.app.store.state;
    const rects = [];
    (plan.walls || []).forEach((w, i) => {
      const id = w.id || ('w' + i);
      if ((layout.demolished || []).includes(id)) return;
      const poly = linearPoly(w);
      if (!poly) return;
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    });
    (plan.windows || []).forEach(w => {
      const poly = linearPoly(w); if (!poly) return;
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    });
    return rects;
  }

  snapMove(f, cx, cy){
    let nx = Math.round(cx/10)*10, ny = Math.round(cy/10)*10;
    if (!this.app.ui.layers.wallSnap) return [nx, ny];
    const { hw, hh } = aabb(f), tol = 10/this.vp.s;
    let bx = tol, by = tol;
    for (const r of this.snapRects()){
      if (!(r[3] < cy-hh-tol || r[1] > cy+hh+tol))
        for (const ex of [r[0], r[2]]) for (const c of [ex+hw, ex-hw]) if (Math.abs(c-cx) < bx){ bx = Math.abs(c-cx); nx = c; }
      if (!(r[2] < cx-hw-tol || r[0] > cx+hw+tol))
        for (const ey of [r[1], r[3]]) for (const c of [ey+hh, ey-hh]) if (Math.abs(c-cy) < by){ by = Math.abs(c-cy); ny = c; }
    }
    return [nx, ny];
  }

  snapPoint(p, shift, ref){
    let x = Math.round(p.x/10)*10, y = Math.round(p.y/10)*10;
    const tol = 8/this.vp.s;
    let bx = tol, by = tol;
    for (const r of this.snapRects()){
      for (const ex of [r[0], r[2]]) if (Math.abs(ex-p.x) < bx){ bx = Math.abs(ex-p.x); x = ex; }
      for (const ey of [r[1], r[3]]) if (Math.abs(ey-p.y) < by){ by = Math.abs(ey-p.y); y = ey; }
    }
    if (shift && ref){
      if (Math.abs(x-ref.x) > Math.abs(y-ref.y)) y = ref.y;
      else x = ref.x;
    }
    return { x, y };
  }

  pickWall(x, y, tol = 500){
    const { plan } = this.app.store.state;
    let best = null, bestD = tol;
    (plan.walls || []).forEach((w, i) => {
      const d = distToSeg(x, y, w.x0, w.y0, w.x1, w.y1);
      const half = (w.t || 240) / 2;
      const dd = Math.max(0, d - half);
      if (dd < bestD){ bestD = dd; best = { idx:i, wall:w, dist:d }; }
    });
    return best;
  }

  hitWall(p){
    const { plan } = this.app.store.state;
    let best = null, bestD = 30 / this.vp.s;
    (plan.walls || []).forEach((w, i) => {
      const d = distToSeg(p.x, p.y, w.x0, w.y0, w.x1, w.y1);
      const dd = Math.max(0, d - (w.t || 240) / 2);
      if (dd < bestD){ bestD = dd; best = w; }
    });
    return best;
  }

  hitDoor(p){
    const { plan } = this.app.store.state;
    let best = null, bestD = 30 / this.vp.s;
    (plan.doors || []).forEach(d => {
      const dd = distToSeg(p.x, p.y, d.x0, d.y0, d.x1, d.y1) - (d.t || 240) / 2;
      if (dd < bestD && dd < 30/this.vp.s){ bestD = Math.max(0, dd); best = d; }
    });
    // 选中时若 hostWall 为空，自动绑定最近的墙
    if (best && !best.hostWall){
      const cx = (best.x0 + best.x1) / 2, cy = (best.y0 + best.y1) / 2;
      let bw = null, bwd = Infinity;
      (plan.walls || []).forEach(w => {
        const dw = distToSeg(cx, cy, w.x0, w.y0, w.x1, w.y1);
        if (dw < bwd){ bwd = dw; bw = w; }
      });
      if (bw && bwd < (bw.t || 240) + 400) best.hostWall = bw.id;
    }
    return best;
  }

  hitWindow(p){
    const { plan } = this.app.store.state;
    let best = null, bestD = 30 / this.vp.s;
    (plan.windows || []).forEach(w => {
      const dd = distToSeg(p.x, p.y, w.x0, w.y0, w.x1, w.y1) - (w.t || 240) / 2;
      if (dd < bestD && dd < 30/this.vp.s){ bestD = Math.max(0, dd); best = w; }
    });
    if (best && !best.hostWall){
      const cx = (best.x0 + best.x1) / 2, cy = (best.y0 + best.y1) / 2;
      let bw = null, bwd = Infinity;
      (plan.walls || []).forEach(w => {
        const dw = distToSeg(cx, cy, w.x0, w.y0, w.x1, w.y1);
        if (dw < bwd){ bwd = dw; bw = w; }
      });
      if (bw && bwd < (bw.t || 240) + 400) best.hostWall = bw.id;
    }
    return best;
  }

  /* =========================== 交互 =========================== */
  _bind(){
    const svg = this.svg;
    if (!svg){ console.error('[PV] #plan 未找到'); return; }

    svg.addEventListener('pointerdown', e => {
      if (e.button === 1 || e.button === 2) return;
      $$('details.menu[open]').forEach(m => m.open = false);
      if (e.pointerType !== 'mouse'){
        this.touches.set(e.pointerId, { x:e.clientX, y:e.clientY });
        try { svg.setPointerCapture(e.pointerId); } catch {}
        if (this.touches.size >= 2){
          this._endDrag(this.drag?.kind === 'measure' || this.drag?.kind === 'pan');
          const info = this._pinchInfo();
          this.pinch = { ...info, s:this.vp.s, px:this.vp.x0 + info.c[0]/this.vp.s, py:this.vp.y0 + info.c[1]/this.vp.s };
          return;
        }
      }
      if (this.pinch) return;
      this._pointerDown(e);
    });

    svg.addEventListener('pointermove', e => {
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x:e.clientX, y:e.clientY });
      if (this.pinch){
        if (this.touches.size < 2) return;
        const info = this._pinchInfo();
        const ns = clamp(this.pinch.s * info.d / this.pinch.d, 0.012, 2);
        this.vp.s = ns;
        this.vp.x0 = this.pinch.px - info.c[0]/ns;
        this.vp.y0 = this.pinch.py - info.c[1]/ns;
        this.vp.apply();
        return;
      }
      this._pointerMove(e);
    });

    const end = e => this._pointerEnd(e, e.type === 'pointercancel');
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    ['gesturestart','gesturechange','gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault()));

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.vp.zoomAt(this.vp.s * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive:false });

    svg.addEventListener('dblclick', e => {
      if (this.app.ui.tool === 'select' && e.target.closest('[data-fid]')) this.rotateSel(90);
    });
    svg.addEventListener('contextmenu', e => {
      if (this.app.ui.tool === 'measure'){ e.preventDefault(); this.app.ui.mA = null; this.renderMeasure(); return; }

      // 右键房间顶点 → 删除该顶点
      const h = e.target.closest('[data-handle="room-vertex"]');
      if (h && this.app.ui.sel?.kind === 'room'){
        e.preventDefault();
        const r = (this.app.store.state.plan.rooms || []).find(x => x.id === this.app.ui.sel.id);
        if (!r) return;
        if (r.poly.length <= 3){
          toast(tr('房间至少需要 3 个顶点', 'A room needs at least 3 vertices'));
          return;
        }
        const idx = +h.dataset.idx, roomId = r.id;
        this.app.store.mutate('del vertex', s => {
          const t2 = s.plan.rooms.find(x => x.id === roomId);
          if (t2 && t2.poly.length > 3) t2.poly.splice(idx, 1);
        });
      }
    });
  }

  _pinchInfo(){
    const [a, b] = [...this.touches.values()];
    return { d: Math.max(1, Math.hypot(b.x-a.x, b.y-a.y)), c: this.vp.svgXY((a.x+b.x)/2, (a.y+b.y)/2) };
  }

  _pointerDown(e){
    const p = this.vp.toMM(e), t = e.target;
    const tool = this.app.ui.tool;

    if (tool === 'measure'){
      const q = this.snapPoint(p, e.shiftKey, this.app.ui.mA);
      const { mA } = this.app.ui;
      if (!mA){
        this.app.ui.mA = q; this.app.ui.mCur = q;
        this.drag = { kind:'measure', sx:e.clientX, sy:e.clientY, moved:false };
      } else {
        const a = this.app.ui.mA;
        this.app.ui.mA = null; this.app.ui.mCur = null;
        if (Math.hypot(q.x-a.x, q.y-a.y) > 20){
          this.app.store.mutate('measure', s => s.layout.measures.push({ a, b:q }));
        }
      }
      this.renderMeasure();
      try { this.svg.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    if (tool === 'draw-wall' || tool === 'draw-room'){
      const start = this.snapPoint(p);
      this.drag = { kind:tool, sx:e.clientX, sy:e.clientY, start, cur:start, moved:false };
      try { this.svg.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    if (tool === 'add-door' || tool === 'add-window'){
      const hit = this.pickWall(p.x, p.y);
      if (!hit){ toast(tr('请点击一堵墙体', 'Click on a wall')); return; }
      tool === 'add-door' ? this._placeDoor(hit, p) : this._placeWindow(hit, p);
      return;
    }

    /* ---- 智能房间：点击空白区域，自动沿墙生成房间 ---- */
    if (tool === 'auto-room'){
      // 如果点击点已经在某个现有房间内，忽略
      const inRoom = (this.app.store.state.plan.rooms || []).some(r => this._pointInPoly(p, r.poly));
      if (inRoom){
        toast(tr('该位置已在某个房间内', 'Already inside a room'));
        return;
      }
      const poly = this._smartRoomAt(p);
      if (!poly || poly.length < 3){
        toast(tr('未能识别房间边界，请点击房间内部的空白区域', 'Could not detect a room here — click inside an empty room area'));
        return;
      }
      const id = 'room_' + uid();
      const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
      const at = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      this.app.store.mutate('auto room', s => s.plan.rooms.push({
        id, name:'新房间', poly, mat: this.editor.roomMat, at,
      }));
      this.app.select({ kind:'room', id });
      this.setTool('select');
      toast(tr(`已识别房间（${poly.length} 个顶点）`, `Room detected (${poly.length} vertices)`));
      return;
    }

    /* ---- 房间顶点 / 边中点 ---- */
    const hh = t.closest('[data-handle]');
    if (hh?.dataset.handle === 'room-vertex' && this.app.ui.sel?.kind === 'room'){
      this.drag = {
        kind:'room-vertex', idx:+hh.dataset.idx,
        sx:e.clientX, sy:e.clientY,
        before:this.app.store.snapshot(), moved:false,
      };
      try { this.svg.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (hh?.dataset.handle === 'room-edge-mid' && this.app.ui.sel?.kind === 'room'){
      const r = (this.app.store.state.plan.rooms || []).find(x => x.id === this.app.ui.sel.id);
      if (r){
        const idx = +hh.dataset.idx;
        const a = r.poly[idx], b = r.poly[(idx + 1) % r.poly.length];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const roomId = r.id;
        this.app.store.mutate('add vertex', s => {
          const t2 = s.plan.rooms.find(x => x.id === roomId);
          if (t2) t2.poly.splice(idx + 1, 0, [mx, my]);
        });
        this.drag = {
          kind:'room-vertex', idx:idx + 1,
          sx:e.clientX, sy:e.clientY,
          before:this.app.store.snapshot(), moved:false,
        };
        try { this.svg.setPointerCapture(e.pointerId); } catch {}
      }
      return;
    }

    /* ---- 端点控制点 ---- */
    const handle = t.closest('[data-handle]');
    if (handle?.dataset.handle === 'linear-end' && (this.app.ui.sel?.kind === 'wall' || this.app.ui.sel?.kind === 'door' || this.app.ui.sel?.kind === 'window')){
      const sel = this.app.ui.sel;
      const el = this._selEntity(sel);
      if (el){
        this.drag = {
          kind:'linear-end', sel,
          end:+handle.dataset.end,
          sx:e.clientX, sy:e.clientY,
          before:this.app.store.snapshot(), moved:false,
        };
        try { this.svg.setPointerCapture(e.pointerId); } catch {}
        return;
      }
    }
    if (handle && this.app.ui.sel?.kind === 'furn'){
      this.drag = { kind:handle.dataset.handle, id:this.app.ui.sel.id, sx:e.clientX, sy:e.clientY, before:this.app.store.snapshot(), moved:false };
      try { this.svg.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    if (tool === 'demolish' && t.closest('[data-wall]')){
      this.toggleWall(t.closest('[data-wall]').dataset.wall);
      return;
    }

    if (tool === 'select' && !this.isEdit && t.closest('[data-fid]')){
      const f = this.app.store.getFurniture(t.closest('[data-fid]').dataset.fid);
      if (this.app.ui.sel?.id !== f.id) this.app.select({ kind:'furn', id:f.id });
      this.drag = { kind:'move', id:f.id, sx:e.clientX, sy:e.clientY, ox:p.x-f.cx, oy:p.y-f.cy, before:this.app.store.snapshot(), moved:false };
      try { this.svg.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    if (tool === 'select'){
      // 装修布置阶段：锁定硬装（墙/门/窗），只允许操作家具和房间
      if (this.isEdit){
        const hitD = this.hitDoor(p);
        if (hitD){
          this.app.select({ kind:'door', id: hitD.id });
          this.drag = { kind:'drag-door', id:hitD.id, sx:e.clientX, sy:e.clientY, before:this.app.store.snapshot(), moved:false };
          try { this.svg.setPointerCapture(e.pointerId); } catch {}
          return;
        }
        const hitW = this.hitWindow(p);
        if (hitW){
          this.app.select({ kind:'window', id: hitW.id });
          this.drag = { kind:'drag-window', id:hitW.id, sx:e.clientX, sy:e.clientY, before:this.app.store.snapshot(), moved:false };
          try { this.svg.setPointerCapture(e.pointerId); } catch {}
          return;
        }
        const hitWall = this.hitWall(p);
        if (hitWall){
          this.app.select({ kind:'wall', id: hitWall.id });
          this.drag = { kind:'drag-wall', id:hitWall.id, sx:e.clientX, sy:e.clientY, ox:p.x, oy:p.y, before:this.app.store.snapshot(), moved:false };
          try { this.svg.setPointerCapture(e.pointerId); } catch {}
          return;
        }
      }
      const room = t.closest('[data-room]');
      if (room){ this.app.select({ kind:'room', id:room.dataset.room }); return; }
      this.app.select(null);
    }

    this.drag = { kind:'pan', sx:e.clientX, sy:e.clientY, x0:this.vp.x0, y0:this.vp.y0, moved:false };
    try { this.svg.setPointerCapture(e.pointerId); } catch {}
  }

  _selEntity(sel){
    const { plan } = this.app.store.state;
    if (sel.kind === 'wall') return (plan.walls || []).find(x => x.id === sel.id);
    if (sel.kind === 'door') return (plan.doors || []).find(x => x.id === sel.id);
    if (sel.kind === 'window') return (plan.windows || []).find(x => x.id === sel.id);
    return null;
  }

  /**
   * 拖墙端点后，把依附此墙的门窗重新投影到新墙中心线，
   * 保持它们沿墙方向的相对参数 t。
   */
  _followWallChanges(wall){
    const { plan } = this.app.store.state;
    const dir = linearDir(wall);
    const wLen = linearLength(wall);
    if (wLen < 1) return;
    const applyTo = el => {
      // 只有 hostWall 匹配才处理
      if (el.hostWall !== wall.id) return;
      const len = linearLength(el);
      // 保持门窗中心沿墙的相对位置
      const cxn = ((el.x0 + el.x1) / 2 - wall.x0) / (wall.x1 - wall.x0 || 1);
      // 用投影法更稳：重新算参数
      const cnx = (el.x0 + el.x1) / 2, cny = (el.y0 + el.y1) / 2;
      const proj = pointOnLine({ x:cnx, y:cny }, wall);
      const half = len / 2;
      const tMin = half / wLen, tMax = 1 - half / wLen;
      const t = Math.max(tMin, Math.min(tMax, proj.t));
      const cx = wall.x0 + (wall.x1 - wall.x0) * t;
      const cy = wall.y0 + (wall.y1 - wall.y0) * t;
      el.x0 = cx - dir[0] * half; el.y0 = cy - dir[1] * half;
      el.x1 = cx + dir[0] * half; el.y1 = cy + dir[1] * half;
    };
    (plan.doors || []).forEach(applyTo);
    (plan.windows || []).forEach(applyTo);
  }

  _pointerMove(e){
    const p = this.vp.toMM(e);
    this._lastPos = p;
    const cx = $('#cx'), cy = $('#cy');
    if (cx) cx.textContent = Math.round(p.x) + ' mm';
    if (cy) cy.textContent = Math.round(p.y) + ' mm';
    const hud = $('#editHud');
    if (hud && this.isEdit){
      const posEl = hud.querySelector('[data-pos]');
      if (posEl) posEl.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
    }

    if (!this.drag){
      const hover = $('#hover');
      if (hover){
        const room = e.target.closest && e.target.closest('[data-room]');
        if (room){
          const r = (this.app.store.state.plan.rooms || []).find(x => x.id === room.dataset.room);
          hover.innerHTML = r ? `<b>${esc(nm(r.name))}</b> ${fmt(area(r.poly))} m²` : '';
        } else hover.innerHTML = '';
      }
      if (this.app.ui.tool === 'measure' && this.app.ui.mA){
        this.app.ui.mCur = this.snapPoint(p, e.shiftKey, this.app.ui.mA);
        this.renderMeasure();
      }
      return;
    }

    const far = Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) >= TAP;

    if (this.drag.kind === 'measure'){
      if (far) this.drag.moved = true;
      this.app.ui.mCur = this.snapPoint(p, e.shiftKey, this.app.ui.mA);
      this.renderMeasure();
      return;
    }
    if (this.drag.kind === 'pan'){
      if (!this.drag.moved && !far) return;
      this.drag.moved = true;
      this.svg.classList.add('panning');
      this.vp.x0 = this.drag.x0 - (e.clientX - this.drag.sx) / this.vp.s;
      this.vp.y0 = this.drag.y0 - (e.clientY - this.drag.sy) / this.vp.s;
      this.vp.apply();
      return;
    }
    if (this.drag.kind === 'draw-wall' || this.drag.kind === 'draw-room'){
      if (far) this.drag.moved = true;
      this.drag.cur = this.snapPoint(p, e.shiftKey, this.drag.start);
      this.renderEditPreview();
      return;
    }

    /* ---- 线性构件端点拖拽 ----
     * 墙端点：改端点位置
     * 门/窗端点：固定另一端，沿 hostWall 滑动当前端点（改宽度 / 位置）
     */
    if (this.drag.kind === 'linear-end'){
      if (!this.drag.moved && !far) return;
      this.drag.moved = true;
      const el = this._selEntity(this.drag.sel);
      if (!el) return;
      const end = this.drag.end;

      if (this.drag.sel.kind === 'wall'){
        // 墙端点：网格 + 墙吸附
        const ref = end === 0 ? { x:el.x1, y:el.y1 } : { x:el.x0, y:el.y0 };
        const q = this.snapPoint(p, e.shiftKey, ref);
        if (end === 0){ el.x0 = q.x; el.y0 = q.y; }
        else { el.x1 = q.x; el.y1 = q.y; }
        // 拖墙端点时，也要联动依附的门窗（几何判断）
        this._followWallChanges(el);
      } else {
        // 门/窗端点：只吸附到 hostWall（不吸网格）
        const { plan } = this.app.store.state;
        let wall = el.hostWall ? plan.walls.find(x => x.id === el.hostWall) : null;
        if (!wall){
          const hit = this.hitWall(p);
          if (hit){ wall = hit; el.hostWall = hit.id; }
        }
        const fixedEnd = end === 0 ? { x:el.x1, y:el.y1 } : { x:el.x0, y:el.y0 };
        if (wall){
          // 投影到墙中心线
          const proj = pointOnLine(p, wall);
          let newP = { x:proj.x, y:proj.y };
          const wLen = Math.hypot(newP.x - fixedEnd.x, newP.y - fixedEnd.y);
          if (wLen < 200){
            const dx = newP.x - fixedEnd.x, dy = newP.y - fixedEnd.y;
            const L = Math.hypot(dx, dy) || 1;
            newP = { x: fixedEnd.x + dx / L * 200, y: fixedEnd.y + dy / L * 200 };
          }
          if (end === 0){ el.x0 = newP.x; el.y0 = newP.y; }
          else { el.x1 = newP.x; el.y1 = newP.y; }
        } else {
          // 找不到墙：沿构件自身方向延伸（绝不吸网格）
          const dxDir = el.x1 - el.x0, dyDir = el.y1 - el.y0;
          const L = Math.hypot(dxDir, dyDir) || 1;
          const ux = dxDir / L, uy = dyDir / L;
          let tProj = (p.x - fixedEnd.x) * ux + (p.y - fixedEnd.y) * uy;
          if (Math.abs(tProj) < 200) tProj = tProj < 0 ? -200 : 200;
          const newP = { x: fixedEnd.x + ux * tProj, y: fixedEnd.y + uy * tProj };
          if (end === 0){ el.x0 = newP.x; el.y0 = newP.y; }
          else { el.x1 = newP.x; el.y1 = newP.y; }
        }
      }
      this.renderWalls(); this.renderOpenings(); this.renderSel();
      return;
    }

    /* ---- 房间顶点拖拽 ---- */
    if (this.drag.kind === 'room-vertex'){
      if (!this.drag.moved && !far) return;
      this.drag.moved = true;
      const r = (this.app.store.state.plan.rooms || []).find(x => x.id === this.app.ui.sel.id);
      if (!r) return;
      const q = this.snapPoint(p, e.shiftKey, null);
      r.poly[this.drag.idx] = [q.x, q.y];
      // 更新房间名位置到包围盒中心
      const xs = r.poly.map(x => x[0]), ys = r.poly.map(x => x[1]);
      r.at = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      this.renderRooms(); this.renderLabels(); this.renderSel();
      return;
    }

    /* ---- 墙身拖拽：整体平移 + 联动门窗（无限长直线判断，比 distToSeg 宽容） ---- */
    if (this.drag.kind === 'drag-wall'){
      if (!this.drag.moved && !far) return;
      this.drag.moved = true;
      const dx = p.x - this.drag.ox, dy = p.y - this.drag.oy;
      this.drag.ox = p.x; this.drag.oy = p.y;
      const { plan } = this.app.store.state;
      const w = plan.walls.find(x => x.id === this.drag.id);
      if (!w) return;

      // 记住老位置用于门窗联动
      const oldW = { x0:w.x0, y0:w.y0, x1:w.x1, y1:w.y1 };
      w.x0 += dx; w.y0 += dy; w.x1 += dx; w.y1 += dy;

      // 用「无限长直线 + 垂直距离」判断依附关系
      const dwx = oldW.x1 - oldW.x0, dwy = oldW.y1 - oldW.y0;
      const wLen = Math.hypot(dwx, dwy) || 1;
      const ux = dwx / wLen, uy = dwy / wLen;
      const followEl = el => {
        const cx = (el.x0 + el.x1) / 2, cy = (el.y0 + el.y1) / 2;
        const px = cx - oldW.x0, py = cy - oldW.y0;
        const tProj = px * ux + py * uy;             // 沿墙方向的投影
        if (tProj < -wLen * 0.5 || tProj > wLen * 1.5) return;   // 不在墙段附近
        const perp = Math.abs(px * (-uy) + py * ux);  // 垂直距离
        if (perp > (el.t || 240) / 2 + 300) return;   // 离墙太远
        el.x0 += dx; el.y0 += dy; el.x1 += dx; el.y1 += dy;
        el.hostWall = w.id;
      };
      (plan.doors || []).forEach(followEl);
      (plan.windows || []).forEach(followEl);

      this.renderWalls(); this.renderOpenings(); this.renderSel();
      return;
    }

    /* ---- 门/窗沿墙滑动（拖身） ---- */
    if (this.drag.kind === 'drag-door' || this.drag.kind === 'drag-window'){
      if (!this.drag.moved && !far) return;
      this.drag.moved = true;
      const { plan } = this.app.store.state;
      const list = this.drag.kind === 'drag-door' ? plan.doors : plan.windows;
      const el = (list || []).find(x => x.id === this.drag.id);
      if (!el) return;
      let wall = el.hostWall ? plan.walls.find(x => x.id === el.hostWall) : null;
      if (!wall){
        const hit = this.hitWall(p);
        if (hit){ wall = hit; el.hostWall = hit.id; }
      }
      if (!wall) return;
      const len = linearLength(el);
      const proj = pointOnLine(p, wall);
      const dir = linearDir(wall);
      const half = len / 2;
      const wallLen = linearLength(wall);
      const t = proj.t;
      const minT = half / wallLen, maxT = 1 - half / wallLen;
      let nx0, ny0, nx1, ny1;
      if (t < minT){
        nx0 = wall.x0; ny0 = wall.y0;
        nx1 = wall.x0 + dir[0] * len; ny1 = wall.y0 + dir[1] * len;
      } else if (t > maxT){
        nx1 = wall.x1; ny1 = wall.y1;
        nx0 = wall.x1 - dir[0] * len; ny0 = wall.y1 - dir[1] * len;
      } else {
        nx0 = proj.x - dir[0] * half; ny0 = proj.y - dir[1] * half;
        nx1 = proj.x + dir[0] * half; ny1 = proj.y + dir[1] * half;
      }
      el.x0 = nx0; el.y0 = ny0; el.x1 = nx1; el.y1 = ny1;
      this.renderOpenings(); this.renderSel();
      return;
    }

    /* ---- 家具 ---- */
    const f = this.app.store.getFurniture(this.drag.id);
    if (!f) return;
    if (!this.drag.moved && !far) return;
    this.drag.moved = true;
    if (this.drag.kind === 'move'){
      [f.cx, f.cy] = this.snapMove(f, p.x - this.drag.ox, p.y - this.drag.oy);
    } else if (this.drag.kind === 'rot'){
      let a = Math.atan2(p.y-f.cy, p.x-f.cx)*180/Math.PI + 90;
      f.rot = norm(e.shiftKey ? a : Math.round(a/15)*15);
    } else if (this.drag.kind === 'size'){
      const a = f.rot*Math.PI/180, c = Math.cos(a), s = Math.sin(a);
      const dx = p.x-f.cx, dy = p.y-f.cy, lx = dx*c + dy*s, ly = -dx*s + dy*c;
      const ax = -f.w/2, ay = -f.d/2;
      const nw = Math.max(100, Math.round((lx-ax)/10)*10), nd = Math.max(100, Math.round((ly-ay)/10)*10);
      const mx = ax + nw/2, my = ay + nd/2;
      f.cx += mx*c - my*s; f.cy += mx*s + my*c;
      f.w = nw; f.d = nd;
    }
    this.renderFurn(); this.renderSel();
  }

  _pointerEnd(e, cancel){
    this.touches.delete(e.pointerId);
    if (this.pinch){ if (this.touches.size < 2) this.pinch = null; return; }
    this._endDrag(cancel);
  }

  _endDrag(cancel){
    const d = this.drag;
    this.drag = null;
    if (d) this.svg.classList.remove('panning');
    if (!d) return;

    if (d.kind === 'measure'){
      if (cancel){ this.app.ui.mA = this.app.ui.mCur = null; this.renderMeasure(); return; }
      if (d.moved && this.app.ui.mA && this.app.ui.mCur && Math.hypot(this.app.ui.mCur.x - this.app.ui.mA.x, this.app.ui.mCur.y - this.app.ui.mA.y) > 20){
        const a = this.app.ui.mA, b = this.app.ui.mCur;
        this.app.ui.mA = this.app.ui.mCur = null;
        this.app.store.mutate('measure', s => s.layout.measures.push({ a, b }));
      }
      this.renderMeasure(); return;
    }

    if (d.kind === 'draw-wall'){
      let drew = false;
      if (d.moved && !cancel){
        const [x0, y0] = [d.start.x, d.start.y], [x1, y1] = [d.cur.x, d.cur.y];
        const L = Math.hypot(x1-x0, y1-y0);
        if (L > 20){
          const wall = { id:'w_' + uid(), x0, y0, x1, y1, t:this.editor.wallThickness, kind:this.editor.wallKind };
          this.app.store.mutate('draw wall', s => s.plan.walls.push(wall));
          drew = true;
          this.app.select({ kind:'wall', id:wall.id });
          toast(tr(`已绘制墙体 ${Math.round(L)}mm`, `Wall ${Math.round(L)}mm`));
        }
      }
      const g = $('#gEdit'); if (g) g.innerHTML = '';
      if (drew) this.renderAll();
      return;
    }

    if (d.kind === 'draw-room'){
      let drew = false;
      if (d.moved && !cancel){
        const x0 = Math.min(d.start.x, d.cur.x), y0 = Math.min(d.start.y, d.cur.y);
        const x1 = Math.max(d.start.x, d.cur.x), y1 = Math.max(d.start.y, d.cur.y);
        if (x1 - x0 > 200 && y1 - y0 > 200){
          const id = 'room_' + uid();
          const poly = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
          this.app.store.mutate('draw room', s => s.plan.rooms.push({ id, name:'新房间', poly, mat:this.editor.roomMat, at:[(x0+x1)/2, (y0+y1)/2] }));
          drew = true;
          toast(tr(`已绘制房间`, `Room drawn`));
        }
      }
      const g = $('#gEdit'); if (g) g.innerHTML = '';
      if (drew) this.renderAll();
      return;
    }

    if (d.kind === 'linear-end' || d.kind === 'drag-wall' || d.kind === 'drag-door' || d.kind === 'drag-window' || d.kind === 'room-vertex'){
      if (d.moved && d.before){
        this.app.store.commitWith(d.before, 'edit');
        this.renderAll();
      }
      return;
    }

    if (d.kind === 'pan') return;

    if (d.moved && d.before){
      this.app.store.commitWith(d.before, 'move');
      this.renderAll();
    }
  }

  renderEditPreview(){
    const g = $('#gEdit');
    if (!g) return;
    const d = this.drag;
    if (!d || (d.kind !== 'draw-wall' && d.kind !== 'draw-room')){ g.innerHTML = ''; return; }
    const [x0, y0] = [d.start.x, d.start.y], [x1, y1] = [d.cur.x, d.cur.y];

    if (d.kind === 'draw-wall'){
      const len = Math.round(Math.hypot(x1-x0, y1-y0));
      const t = this.editor.wallThickness;
      const mx = (x0+x1)/2, my = (y0+y1)/2;
      g.innerHTML =
        `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#2f5d62" stroke-width="${t}" stroke-linecap="round" opacity=".35"/>
         <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#2f5d62" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>
         <circle cx="${x0}" cy="${y0}" r="6" fill="#2f5d62" vector-effect="non-scaling-stroke"/>
         <circle cx="${x1}" cy="${y1}" r="6" fill="#2f5d62" vector-effect="non-scaling-stroke"/>
         <text x="${mx}" y="${my - 260}" font-size="320" text-anchor="middle" fill="#2f5d62"
           stroke="#fff" stroke-width="60" paint-order="stroke" font-weight="600">${len} mm</text>`;
      return;
    }

    const a = Math.min(x0,x1), b = Math.min(y0,y1), c = Math.max(x0,x1), e = Math.max(y0,y1);
    const W = Math.round(c-a), H = Math.round(e-b);
    g.innerHTML =
      `<rect x="${a}" y="${b}" width="${c-a}" height="${e-b}" fill="#2f5d62" fill-opacity=".12"
         stroke="#2f5d62" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>
       <text x="${(a+c)/2}" y="${(b+e)/2}" font-size="320" text-anchor="middle" fill="#2f5d62"
         stroke="#fff" stroke-width="60" paint-order="stroke" font-weight="600">${W} × ${H}</text>`;
  }

  /* =========================== 操作 =========================== */
  rotateSel(d){
    if (this.app.ui.sel?.kind !== 'furn') return;
    this.app.store.mutate('rotate', s => {
      const f = s.layout.furniture.find(x => x.id === this.app.ui.sel.id);
      if (f) f.rot = norm(f.rot + d);
    });
  }

  toggleWall(id){
    const idx = this.app.store.state.plan.walls.findIndex(w => w.id === id);
    if (idx < 0) return;
    const w = this.app.store.state.plan.walls[idx];
    if (w.kind === 'b') return toast(tr('承重墙不可拆除', 'Load-bearing'));
    if (w.kind === 'e') return toast(tr('外墙不建议拆除', 'Exterior wall'));
    const on = this.app.store.state.layout.demolished.includes(id);
    this.app.store.mutate(on ? 'restore' : 'demolish', s => {
      if (on) s.layout.demolished = s.layout.demolished.filter(x => x !== id);
      else s.layout.demolished.push(id);
    });
    toast(on ? tr('已恢复', 'Restored') : tr('已标记拆除', 'Marked'));
  }

  /* ---- 放置门/窗：用墙中心线作为基准 ---- */
  _placeDoor(hit, p){
    const cfg = this.editor;
    const w = hit.wall;
    const len = Math.min(cfg.doorWidth, linearLength(w) - 20);
    if (len < 300){ toast(tr('墙体太短', 'Wall too short')); return; }
    const proj = pointOnLine(p, w);
    const dir = linearDir(w);
    const half = len / 2;
    const tMin = half / linearLength(w);
    const tMax = 1 - half / linearLength(w);
    const t = Math.max(tMin, Math.min(tMax, proj.t));
    const cx = w.x0 + (w.x1 - w.x0) * t;
    const cy = w.y0 + (w.y1 - w.y0) * t;

    const door = {
      id: 'd_' + uid(),
      kind: 'door',
      hostWall: w.id,
      x0: cx - dir[0] * half, y0: cy - dir[1] * half,
      x1: cx + dir[0] * half, y1: cy + dir[1] * half,
      t: w.t || 240,
      hinge: cfg.doorHinge === 'right' ? 'right' : 'left',
      swing: cfg.doorSwing === 'out' ? 'out' : 'in',
      entry: !!cfg.doorEntry,
      name: cfg.doorEntry ? '入户门' : '新门',
    };
    this.app.store.mutate('add door', s => s.plan.doors.push(door));
    this.app.select({ kind:'door', id:door.id });
    toast(tr(`已放置门 ${Math.round(len)}mm`, `Door ${Math.round(len)}mm`));
  }

  _placeWindow(hit, p){
    const cfg = this.editor;
    const w = hit.wall;
    const len = Math.min(cfg.winWidth, linearLength(w) - 20);
    if (len < 300){ toast(tr('墙体太短', 'Wall too short')); return; }
    const proj = pointOnLine(p, w);
    const dir = linearDir(w);
    const half = len / 2;
    const tMin = half / linearLength(w);
    const tMax = 1 - half / linearLength(w);
    const t = Math.max(tMin, Math.min(tMax, proj.t));
    const cx = w.x0 + (w.x1 - w.x0) * t;
    const cy = w.y0 + (w.y1 - w.y0) * t;
    const win = {
      id: 'win_' + uid(),
      kind: 'window',
      hostWall: w.id,
      x0: cx - dir[0] * half, y0: cy - dir[1] * half,
      x1: cx + dir[0] * half, y1: cy + dir[1] * half,
      t: w.t || 240,
      sill: cfg.winSill,
      height: cfg.winHeight,
    };
    this.app.store.mutate('add window', s => s.plan.windows.push(win));
    this.app.select({ kind:'window', id:win.id });
    toast(tr(`已放置窗 ${Math.round(len)}mm`, `Window ${Math.round(len)}mm`));
  }

  addItem(it, x, y){
    const [type, name, w, d, color] = it;
    const f = { id:uid(), type, name, cx:Math.round(x/10)*10, cy:Math.round(y/10)*10, w, d, rot:0, color:color || typeColor(type) };
    this._pushOut(f);
    this.app.select({ kind:'furn', id:f.id });
    this.app.store.mutate('add ' + name, s => {
      if (type === 'rug') s.layout.furniture.unshift(f);
      else s.layout.furniture.push(f);
    });
    toast(tr(`已添加「${name}」${w}×${d}`, `Added "${nm(name)}"`));
  }

  _pushOut(f){
    for (let n = 0; n < 4; n++){
      let moved = false;
      for (const r of this.snapRects()){
        const { hw, hh } = aabb(f);
        const ox = Math.min(f.cx+hw, r[2]) - Math.max(f.cx-hw, r[0]);
        const oy = Math.min(f.cy+hh, r[3]) - Math.max(f.cy-hh, r[1]);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) f.cx = f.cx < (r[0]+r[2])/2 ? r[0]-hw : r[2]+hw;
        else f.cy = f.cy < (r[1]+r[3])/2 ? r[1]-hh : r[3]+hh;
        moved = true;
      }
      if (!moved) return;
    }
  }

  dropPoint(x, y){
    const stage = $('#stage'), r = stage.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    if (document.elementFromPoint(x, y)?.closest('aside.open,#fab,#walkOverlay,#joy,#walkExit,.edit-hud')) return null;
    const p = this.vp.toMM({ clientX:x, clientY:y });
    return { x:p.x, y:p.y, s:this.vp.s };
  }

  setOrigin(x, y, note = ''){
    const dx = -x, dy = -y;
    this.app.store.mutate('set origin', s => {
      (s.plan.walls || []).forEach(w => { w.x0+=dx; w.y0+=dy; w.x1+=dx; w.y1+=dy; });
      (s.plan.doors || []).forEach(d => { d.x0+=dx; d.y0+=dy; d.x1+=dx; d.y1+=dy; });
      (s.plan.windows || []).forEach(w => { w.x0+=dx; w.y0+=dy; w.x1+=dx; w.y1+=dy; });
      (s.plan.slides || []).forEach(sl => { if (sl.rect) sl.rect = [sl.rect[0]+dx, sl.rect[1]+dy, sl.rect[2]+dx, sl.rect[3]+dy]; });
      (s.plan.rooms || []).forEach(r => {
        r.poly = r.poly.map(([px, py]) => [px+dx, py+dy]);
        if (r.at) r.at = [r.at[0]+dx, r.at[1]+dy];
      });
      (s.layout.furniture || []).forEach(f => { f.cx += dx; f.cy += dy; });
      s.plan.bounds.x += dx; s.plan.bounds.y += dy;
      s.plan.origin = { x:0, y:0, note };
    });
    toast(tr(`已把 (${x}, ${y}) 设为原点`, `Origin set`));
    this.fit();
  }

  /* ============================================================
   *  智能房间识别：点击空白处，自动沿墙生成多边形房间
   *
   *  算法（射线扫描法）：
   *    ① 从点击点 P 出发，均匀发 N 条射线
   *    ② 每条射线找最近的墙交点
   *    ③ 所有交点按角度排序 → 得到多边形顶点
   *    ④ 去重 + 共线简化
   * ============================================================ */
  _smartRoomAt(p){
    const walls = this.app.store.state.plan.walls || [];
    if (!walls.length) return null;

    // 若点击点离任何墙太近，直接拒绝
    let minDist = Infinity;
    for (const w of walls){
      const d = distToSeg(p.x, p.y, w.x0, w.y0, w.x1, w.y1) - (w.t || 240) / 2;
      if (d < minDist) minDist = d;
    }
    if (minDist < 30) return null;

    const N = 128;
    const hits = [];
    for (let i = 0; i < N; i++){
      const ang = (i + 0.5) / N * Math.PI * 2;
      const dir = [Math.cos(ang), Math.sin(ang)];
      const hit = this._rayHitWalls(p, dir, walls);
      if (hit) hits.push({ ang, x:hit.x, y:hit.y });
    }
    if (hits.length < 3) return null;

    hits.sort((a, b) => a.ang - b.ang);
    const pts = hits.map(h => [h.x, h.y]);
    const simplified = this._simplifyPolygon(pts);
    if (simplified.length < 3) return null;

    // 反向检查：点击点必须在新多边形的内部（用射线法验证）
    if (!this._pointInPoly(p, simplified)) return null;

    return simplified;
  }

  /** 从 p 沿 dir 方向发射线，返回最近的墙交点（或 null） */
  _rayHitWalls(p, dir, walls){
    let bestT = Infinity, best = null;
    for (const w of walls){
      const t = this._raySegIntersect(p, dir, [w.x0, w.y0], [w.x1, w.y1]);
      if (t != null && t > 1 && t < bestT){
        bestT = t;
        best = { x: p.x + dir[0] * t, y: p.y + dir[1] * t };
      }
    }
    return best;
  }

  /** 射线 origin + t·dir 与线段 a→b 求交，返回沿射线的距离 t；无交点返回 null */
  _raySegIntersect(o, d, a, b){
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const det = d[0] * ey - d[1] * ex;
    if (Math.abs(det) < 1e-9) return null;       // 平行
    const dx = a[0] - o.x, dy = a[1] - o.y;
    const t = (dx * ey - dy * ex) / det;
    const u = (dx * d[1] - dy * d[0]) / det;
    if (t > 0.5 && u >= 0 && u <= 1) return t;
    return null;
  }

  /** 多边形顶点简化：去重 + 删除近似共线的点 */
  _simplifyPolygon(pts){
    // 去重（相邻 < 100mm 合并）
    const dedup = [];
    for (const p of pts){
      const prev = dedup[dedup.length - 1];
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 100) dedup.push([p[0], p[1]]);
    }
    if (dedup.length > 1){
      const f = dedup[0], l = dedup[dedup.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 100) dedup.pop();
    }

    // 删除近似共线的点
    const n = dedup.length;
    if (n < 3) return dedup;
    const out = [];
    for (let i = 0; i < n; i++){
      const a = dedup[(i - 1 + n) % n], b = dedup[i], c = dedup[(i + 1) % n];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const bcx = c[0] - b[0], bcy = c[1] - b[1];
      const cross = abx * bcy - aby * bcx;
      const lenAB = Math.hypot(abx, aby);
      const lenBC = Math.hypot(bcx, bcy);
      if (lenAB < 1e-6 || lenBC < 1e-6) continue;
      // 夹角接近 0° 或 180° 时叉积 / 长度积 很小
      if (Math.abs(cross) / (lenAB * lenBC) < 0.03) continue;
      out.push(b);
    }
    return out;
  }

  /** 点是否在多边形内部（射线法） */
  _pointInPoly(p, poly){
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++){
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const hit = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
}

/* 工具：避免 vp.s = 0 */
function vpSafe(s){ return s > 1e-6 ? s : 0.06; }
function viewFromHack(vp){ return vpSafe(vp.s); }