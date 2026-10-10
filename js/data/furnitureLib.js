/**
 * 家具库定义。每个条目：
 *   { type, name, w, d, color, cat }
 *
 * 说明：
 * - `type` 是渲染 key，2D / 3D 各自维护一个渲染注册表（registry），
 *   没注册的类型会退化为一个纯色方块，因此扩展家具不需要改核心代码。
 * - 想扩展家具库：往 ITEMS 里 push 一条，然后在 FurnSVG / Scene3D 里按需注册 type。
 * - 也支持从 JSON 文件追加（见 loadExtra）。
 */

export const CATEGORIES = ['卧室', '客厅', '餐厨', '卫浴', '家电', '书房 · 休闲'];

export const ITEMS = [
  /* --- 卧室 --- */
  { cat:'卧室', type:'bed',        name:'双人床 1.8m', w:1800, d:2000, color:'#c9d6df' },
  { cat:'卧室', type:'bed',        name:'双人床 1.5m', w:1500, d:2000, color:'#d8c7dc' },
  { cat:'卧室', type:'bed',        name:'单人床',     w:1200, d:2000, color:'#e8d5b5' },
  { cat:'卧室', type:'crib',       name:'婴儿床',     w:1250, d:700,  color:'#efe3d0' },
  { cat:'卧室', type:'nightstand', name:'床头柜',     w:450,  d:400,  color:'#e8dccb' },
  { cat:'卧室', type:'wardrobe',   name:'衣柜',       w:2000, d:600,  color:'#efe6d8' },
  { cat:'卧室', type:'wardrobe',   name:'小衣柜',     w:1200, d:550,  color:'#efe6d8' },
  { cat:'卧室', type:'dresser',    name:'梳妆台',     w:1000, d:450,  color:'#efe6d8' },
  { cat:'卧室', type:'desk',       name:'书桌',       w:1200, d:600,  color:'#e2cfb4' },
  { cat:'卧室', type:'chair',      name:'椅子',       w:450,  d:480,  color:'#cfc6b8' },
  { cat:'卧室', type:'bookshelf',  name:'书架',       w:800,  d:300,  color:'#e2cfb4' },
  { cat:'卧室', type:'baycushion', name:'飘窗垫',     w:520,  d:1800, color:'#e7dccd' },

  /* --- 客厅 --- */
  { cat:'客厅', type:'sofa',        name:'三人沙发',   w:2400, d:900,  color:'#b7c4b0' },
  { cat:'客厅', type:'sofa',        name:'双人沙发',   w:1700, d:880,  color:'#c3cbd6' },
  { cat:'客厅', type:'cornersofa',  name:'转角沙发',   w:2800, d:1700, color:'#b7c4b0' },
  { cat:'客厅', type:'armchair',    name:'单人沙发',   w:850,  d:850,  color:'#d6b99a' },
  { cat:'客厅', type:'beanbag',     name:'懒人沙发',   w:800,  d:800,  color:'#e0b98f' },
  { cat:'客厅', type:'coffeetable', name:'茶几',       w:1300, d:650,  color:'#e8dccb' },
  { cat:'客厅', type:'sidetable',   name:'边几',       w:500,  d:500,  color:'#d9c3a3' },
  { cat:'客厅', type:'tvstand',     name:'电视柜',     w:2400, d:400,  color:'#e2cfb4' },
  { cat:'客厅', type:'rug',         name:'地毯',       w:2400, d:1700, color:'#d9cbb8' },
  { cat:'客厅', type:'shoecab',     name:'鞋柜',       w:1000, d:350,  color:'#efe6d8' },
  { cat:'客厅', type:'shoecab',     name:'玄关柜',     w:1400, d:380,  color:'#e6dccc' },
  { cat:'客厅', type:'floorlamp',   name:'落地灯',     w:450,  d:450,  color:'#3d3a34' },
  { cat:'客厅', type:'plant',       name:'绿植',       w:500,  d:500,  color:'#a9c39b' },
  { cat:'客厅', type:'plant',       name:'大绿植',     w:700,  d:700,  color:'#9dbb8c' },

  /* --- 餐厨 --- */
  { cat:'餐厨', type:'table',      name:'餐桌',       w:1400, d:800,  color:'#e2cfb4' },
  { cat:'餐厨', type:'table',      name:'六人餐桌',   w:1800, d:900,  color:'#d8c2a2' },
  { cat:'餐厨', type:'roundtable', name:'圆桌',       w:1000, d:1000, color:'#e2cfb4' },
  { cat:'餐厨', type:'chair',      name:'餐椅',       w:450,  d:480,  color:'#cfc6b8' },
  { cat:'餐厨', type:'island',     name:'岛台',       w:1800, d:900,  color:'#e9e5de' },
  { cat:'餐厨', type:'barstool',   name:'吧椅',       w:420,  d:420,  color:'#6b5d4c' },
  { cat:'餐厨', type:'counter',    name:'橱柜台面',   w:1600, d:600,  color:'#e9e5de' },
  { cat:'餐厨', type:'stove',      name:'燃气灶',     w:750,  d:450,  color:'#dcdcdc' },
  { cat:'餐厨', type:'ksink',      name:'水槽',       w:800,  d:450,  color:'#e1e6ea' },
  { cat:'餐厨', type:'fridge',     name:'冰箱',       w:700,  d:700,  color:'#dfe4e8' },
  { cat:'餐厨', type:'cabinet',    name:'餐边柜',     w:1600, d:400,  color:'#efe6d8' },

  /* --- 卫浴 --- */
  { cat:'卫浴', type:'toilet',     name:'马桶',       w:400,  d:700,  color:'#ffffff' },
  { cat:'卫浴', type:'vanity',     name:'浴室柜',     w:800,  d:500,  color:'#eef1f3' },
  { cat:'卫浴', type:'vanity',     name:'双盆浴室柜', w:1200, d:500,  color:'#eef1f3' },
  { cat:'卫浴', type:'shower',     name:'淋浴房',     w:900,  d:900,  color:'#e4edf2' },
  { cat:'卫浴', type:'bathtub',    name:'浴缸',       w:1600, d:750,  color:'#eef3f6' },
  { cat:'卫浴', type:'washer',     name:'洗衣机',     w:600,  d:600,  color:'#e6ebee' },
  { cat:'卫浴', type:'waterheater',name:'电热水器',   w:800,  d:450,  color:'#f4f4f2' },
  { cat:'卫浴', type:'cabinet',    name:'储物柜',     w:1000, d:400,  color:'#efe6d8' },

  /* --- 家电 --- */
  { cat:'家电', type:'tv',        name:'65 寸电视',   w:1450, d:80,  color:'#1d1d1f' },
  { cat:'家电', type:'tv',        name:'55 寸电视',   w:1230, d:80,  color:'#1d1d1f' },
  { cat:'家电', type:'fridge',    name:'对开门冰箱', w:910,  d:700, color:'#c9ced3' },
  { cat:'家电', type:'aircon',    name:'柜机空调',   w:500,  d:380, color:'#f6f7f8' },
  { cat:'家电', type:'acwall',    name:'挂机空调',   w:900,  d:250, color:'#f6f7f8' },
  { cat:'家电', type:'dishwasher',name:'洗碗机',     w:600,  d:600, color:'#c9ced3' },
  { cat:'家电', type:'ovencol',   name:'蒸烤箱高柜', w:600,  d:600, color:'#efe6d8' },
  { cat:'家电', type:'dryer',     name:'烘干机',     w:600,  d:600, color:'#e6ebee' },
  { cat:'家电', type:'purifier',  name:'空气净化器', w:400,  d:300, color:'#f4f4f2' },

  /* --- 书房 · 休闲 --- */
  { cat:'书房 · 休闲', type:'desk',        name:'长书桌',   w:1600, d:700,  color:'#d8c2a2' },
  { cat:'书房 · 休闲', type:'officechair', name:'办公椅',   w:620,  d:620,  color:'#4a4f55' },
  { cat:'书房 · 休闲', type:'bookshelf',   name:'大书架',   w:1600, d:350,  color:'#e2cfb4' },
  { cat:'书房 · 休闲', type:'piano',       name:'立式钢琴', w:1500, d:600,  color:'#1f1d1b' },
  { cat:'书房 · 休闲', type:'treadmill',   name:'跑步机',   w:800,  d:1800, color:'#3a3a3c' },
  { cat:'书房 · 休闲', type:'armchair',    name:'阅读椅',   w:750,  d:800,  color:'#c9a98a' },
];

/** 查找类型默认颜色 */
export function typeColor(t){
  const it = ITEMS.find(i => i.type === t);
  return it ? it.color : '#eeeeee';
}

/** 追加自定义家具（来自 JSON 文件等） */
export function loadExtra(list){
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const it of list){
    if (!it?.type || !it?.name || !it?.w || !it?.d) continue;
    ITEMS.push({
      cat: it.cat || '自定义',
      type: it.type,
      name: it.name,
      w: +it.w, d: +it.d,
      color: it.color || '#ddd',
    });
    n++;
  }
  if (n && !CATEGORIES.includes('自定义')) CATEGORIES.push('自定义');
  return n;
}

/** 按分类分组 */
export function grouped(){
  return CATEGORIES.map(cat => ({ cat, items: ITEMS.filter(i => i.cat === cat) })).filter(g => g.items.length);
}