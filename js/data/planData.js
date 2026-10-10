/**
 * 户型几何数据 + 线性构件通用工具。
 *
 * 线性构件（墙 / 门 / 窗）统一数据结构：
 *   { id, kind, x0, y0, x1, y1, t }
 *   - (x0,y0)-(x1,y1)：中心线
 *   - t：厚度 mm
 *
 * 门附加：hostWall, hinge:'left'|'right', swing:'in'|'out', entry, name
 * 窗附加：hostWall, sill, height
 */

export const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/* ============================================================
 *  线性构件通用工具
 *  （每个函数只声明一次，禁止在本文件其它位置重复声明）
 * ============================================================ */

export function linearLength(el){
  return Math.hypot(el.x1 - el.x0, el.y1 - el.y0);
}

export function linearDir(el){
  const L = linearLength(el) || 1;
  return [(el.x1 - el.x0) / L, (el.y1 - el.y0) / L];
}

export function linearNormal(el){
  const [dx, dy] = linearDir(el);
  return [-dy, dx];
}

/** 点 p 在构件中心线上的投影；返回参数 t∈[0,1] 及投影点 */
export function pointOnLine(p, el){
  const dx = el.x1 - el.x0, dy = el.y1 - el.y0, L2 = dx * dx + dy * dy;
  if (L2 < 1) return { t:0, x:el.x0, y:el.y0 };
  const t = ((p.x - el.x0) * dx + (p.y - el.y0) * dy) / L2;
  const tc = Math.max(0, Math.min(1, t));
  return { t:tc, x:el.x0 + tc * dx, y:el.y0 + tc * dy };
}

/** 中心线 + 厚度 → 4 角多边形 */
export function linearPoly(el){
  const dx = el.x1 - el.x0, dy = el.y1 - el.y0;
  const L = Math.hypot(dx, dy);
  if (L < 1) return null;
  const h = (el.t || 240) / 2;
  const nx = -dy / L * h, ny = dx / L * h;
  return [
    [el.x0 + nx, el.y0 + ny],
    [el.x1 + nx, el.y1 + ny],
    [el.x1 - nx, el.y1 - ny],
    [el.x0 - nx, el.y0 - ny],
  ];
}

/** 中心线 + 厚度 → AABB */
export function linearBBox(el){
  const poly = linearPoly(el);
  if (!poly) return null;
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* 兼容旧 API 别名（Scene3D / PlanView 里可能引用 wallPoly / wallBBox） */
export const wallPoly = linearPoly;
export const wallBBox = linearBBox;

/** 旧矩形 → 中心线（墙） */
export function rect2wall([x0, y0, x1, y1, kind = 'n'], id = ''){
  const w = x1 - x0, h = y1 - y0;
  if (Math.abs(w) >= Math.abs(h)){
    const cy = (y0 + y1) / 2;
    return { id, kind, x0, y0:cy, x1, y1:cy, t:Math.abs(h) || 240 };
  } else {
    const cx = (x0 + x1) / 2;
    return { id, kind, x0:cx, y0, x1:cx, y1, t:Math.abs(w) || 240 };
  }
}

/* ============================================================
 *  默认户型数据
 * ============================================================ */

const RAW_WALLS = [
  [1580,-240,2120,0,'b'],[1580,0,1820,300,'b'],[2120,-240,4580,0,'e'],[4580,-240,5140,0,'e'],
  [5760,-240,6050,0,'e'],[6050,-240,6600,0,'b'],[6360,0,6600,300,'b'],[6600,-240,9960,0,'e'],
  [9960,-240,10510,0,'b'],[10270,0,10510,300,'b'],
  [10270,300,10510,800,'e'],[10270,2600,10510,3090,'e'],[10270,3090,10510,4260,'b'],
  [10270,5740,10510,6370,'b'],[9960,6370,10510,6610,'b'],[10270,6610,10510,7400,'b'],
  [10270,9770,10510,10560,'b'],[9960,10560,10510,10800,'b'],
  [4580,10560,9960,10800,'e'],[10510,10560,12090,10800,'e'],[11850,9960,12090,10560,'e'],
  [4580,9200,4820,10560,'e'],[4580,7960,4820,8310,'e'],
  [3620,7960,4580,8200,'e'],[2180,7960,3620,8200,'b'],[2180,7590,2420,7960,'b'],[2180,7400,2420,7590,'n'],
  [-240,7960,2180,8200,'e'],[-240,3610,0,7960,'e'],
  [0,4950,200,5190,'n'],[200,4950,1275,5190,'low'],[1580,3370,2420,3825,'b'],
  [2180,4430,2420,5796,'n'],[2090,4950,2180,5190,'n'],
  [2420,4950,4580,5190,'n'],[4580,3280,4820,4075,'n'],[4580,4860,4820,5190,'n'],[2420,3370,4580,3610,'n'],
  [4580,0,4820,2400,'n'],[4820,2080,6360,2320,'n'],[6360,300,6600,1198,'n'],[6360,1983,6600,2400,'n'],
  [6083,3370,6600,3707,'b'],[6360,3280,6600,3370,'n'],[6600,3370,9960,3610,'n'],[9960,3370,10270,3610,'b'],
  [6083,4600,6323,6610,'n'],[6323,6370,9960,6610,'n'],
];

export const WALLS = RAW_WALLS.map((r, i) => rect2wall(r, 'w' + i));

/* 旧格式门窗（导入时会被 normalize 成新格式） */
const LEGACY_DOORS = [
  {name:'小孩房门',rect:[4580,2400,4820,3280],h:[4580,3280],c:[0,-1],o:[-1,0],len:880},
  {name:'主卧门',rect:[6360,2400,6600,3280],h:[6600,3280],c:[0,-1],o:[1,0],len:880},
  {name:'主卫门',rect:[6360,1198,6600,1983],h:[6360,1198],c:[0,1],o:[-1,0],len:785},
  {name:'客卫门',rect:[4580,4075,4820,4860],h:[4580,4860],c:[0,-1],o:[-1,0],len:785},
  {name:'子女房门',rect:[6083,3707,6323,4600],h:[6323,4600],c:[0,-1],o:[1,0],len:893},
  {name:'入户门',rect:[4580,8310,4820,9200],h:[4820,9200],c:[0,-1],o:[1,0],len:890,entry:true},
];
const LEGACY_WINDOWS = [
  [5140,-240,5760,0],[1580,300,1820,3370],[-240,3370,1580,3610],[2180,3825,2420,4430],
  [10510,6370,12090,6610],[11850,6610,12090,9960],
  [10510,660,11130,760],[11030,760,11130,2650],[10510,2650,11130,2750],
  [10510,4110,11130,4210],[11030,4210,11130,5785],[10510,5785,11130,5885],
];

/** 把默认门窗转成新格式（中心线） */
export function legacyDoor2new(d, id){
  const [rx0, ry0, rx1, ry1] = d.rect;
  const hx = d.h[0], hy = d.h[1];
  const ox = hx + d.c[0] * d.len, oy = hy + d.c[1] * d.len;
  const cross = d.c[0] * d.o[1] - d.c[1] * d.o[0];
  const w = Math.abs(rx1 - rx0), h = Math.abs(ry1 - ry0);
  const t = Math.min(w, h) || 240;
  return {
    id, kind:'door',
    hostWall: null,
    x0: hx, y0: hy, x1: ox, y1: oy,
    t,
    hinge: 'left',
    swing: cross > 0 ? 'in' : 'out',
    entry: !!d.entry,
    name: d.name || '门',
  };
}

export function legacyWindow2new(r, id){
  const [x0, y0, x1, y1] = r;
  const w = x1 - x0, h = y1 - y0;
  if (Math.abs(w) >= Math.abs(h)){
    const cy = (y0 + y1) / 2;
    return { id, kind:'window', hostWall:null, x0, y0:cy, x1, y1:cy, t:Math.abs(h) || 240, sill:900, height:1500 };
  }
  const cx = (x0 + x1) / 2;
  return { id, kind:'window', hostWall:null, x0:cx, y0, x1:cx, y1, t:Math.abs(w) || 240, sill:900, height:1500 };
}

export const DEFAULT_PLAN = {
  bounds: { x:-1850, y:-1750, w:15600, h:14100 },
  origin: { x:0, y:0, note:'默认原点：左上外墙内皮交点' },
  walls: WALLS,
  doors: LEGACY_DOORS.map((d, i) => legacyDoor2new(d, 'd' + i)),
  windows: LEGACY_WINDOWS.map((r, i) => legacyWindow2new(r, 'win' + i)),
  slides: [
    { id:'s0', kind:'slide', rect:[10270,7400,10510,9770], v:true },
    { id:'s1', kind:'slide', rect:[1275,4950,2090,5190], v:false },
  ],
  rooms: [
    {id:'master', name:'主卧室', poly:R(6600,0,10270,3370), mat:'wood', at:[8435,2420]},
    {id:'mbath', name:'主卫浴', poly:R(4820,0,6360,2080), mat:'antislip', at:[5980,1780]},
    {id:'kid', name:'小孩房', poly:R(1820,0,4580,3370), mat:'wood', at:[3380,2330]},
    {id:'gbath', name:'客卫浴', poly:R(2420,3610,4580,4950), mat:'antislip', at:[3760,4620]},
    {id:'laundry', name:'洗衣阳台', poly:R(0,3610,2180,4950), mat:'antislip', at:[1250,4330]},
    {id:'child', name:'子女房', poly:R(6323,3610,10270,6370), mat:'wood', at:[8850,4850]},
    {id:'kitchen', name:'厨房', poly:R(0,5190,2180,7960), mat:'tile600', at:[1300,6500]},
    {id:'dining', name:'餐厅', poly:[[2420,5190],[4820,5190],[4820,7960],[2420,7960],[2420,7400],[2180,7400],[2180,5796],[2420,5796]], mat:'tile800', at:[3900,5520]},
    {id:'hall', name:'过道', poly:[[4820,2320],[6360,2320],[6360,3370],[6083,3370],[6083,6610],[4820,6610]], mat:'tile800', at:[5450,4450]},
    {id:'living', name:'客厅', poly:R(4820,6610,10270,10560), mat:'tile800', at:[7600,7560]},
    {id:'balcony', name:'休闲阳台', poly:R(10510,6610,11850,10560), mat:'walnut', at:[11180,9450]},
    {id:'bay1', name:'主卧飘窗', poly:[[10270,800],[10510,800],[10510,760],[11030,760],[11030,2650],[10510,2650],[10510,2600],[10270,2600]], mat:'marble', counted:false},
    {id:'bay2', name:'子女房飘窗', poly:[[10270,4260],[10510,4260],[10510,4210],[11030,4210],[11030,5785],[10510,5785],[10510,5740],[10270,5740]], mat:'marble', counted:false},
  ],
  mats: {
    wood:    {name:'橡木地板', price:320, sw:'#d8b88a'},
    walnut:  {name:'胡桃木地板', price:380, sw:'#9b7250'},
    tile800: {name:'800 地砖', price:220, sw:'#ebe6dc'},
    tile600: {name:'600 地砖', price:160, sw:'#dfe3e1'},
    marble:  {name:'大理石', price:650, sw:'#f1eee8'},
    antislip:{name:'300 防滑砖', price:140, sw:'#d3d8d4'},
    terrazzo:{name:'水磨石', price:280, sw:'#e6dfd3'},
    carpet:  {name:'满铺地毯', price:200, sw:'#c9c3d3'},
  },
};

export function emptyPlan(){
  const p = JSON.parse(JSON.stringify(DEFAULT_PLAN));
  p.walls = []; p.doors = []; p.windows = []; p.slides = []; p.rooms = [];
  p.bounds = { x:-4000, y:-4000, w:14000, h:12000 };
  p.origin = { x:0, y:0, note:'' };
  return p;
}

export const cloneDefaultPlan = () => JSON.parse(JSON.stringify(DEFAULT_PLAN));