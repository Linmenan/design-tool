import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $, esc, area, clamp01, ease, toast, shade } from '../core/Utils.js';
import { tr, nm } from '../core/I18n.js';

const OX = 6000, OY = 5300, H = 2.8, FOV = 45;
const COARSE = matchMedia('(pointer:coarse)').matches;

/**
 * Scene3D — 极简可运行的 three.js 场景。
 *
 * 相比完整版去掉了：PointerLockControls / RoomEnvironment / CSS2DRenderer
 * 保留完整接口（供 App.js / Toolbar.js 调用）：
 *   init / enter / exit / sync / relang / shot / groundAt / flyToRoom / walking
 *   setMode / setCut / toggle / setHour / goIso / goTop
 *
 * 导出方式：具名 + 默认（两种 import 写法都能拿到）
 */
export class Scene3D {
  constructor(app){
    this.app = app;
    this.opt = { cut:2.8, furn:true, labels:true, night:false, hour:10, mode:'orbit' };
    this.active = false;
    this.inited = false;
    this.anim = null;
    this.fly = null;
    this.raf = 0;
    this.grow = 1;
    this.furnGrow = 1;
    this.keys = {};
    this.clock = null;
    this.doors = [];       // 每次 buildArch 后重建，每个元素 { pivot, a0, a1, cur, open }
  }

  /* ---------- 坐标换算 ---------- */
  wx(x){ return (x - OX) / 1000; }
  wz(y){ return (y - OY) / 1000; }
  M(v){ return v / 1000; }
  SW(){ return $('#stage').clientWidth || 800; }
  SH(){ return $('#stage').clientHeight || 600; }

  /* ---------- 初始化 ---------- */
  async init(){
    if (this.inited) return;
    this.inited = true;

    const stage = $('#stage'), host = $('#view3d');
    if (!stage || !host) throw new Error('缺少 #stage 或 #view3d');
    this.stage = stage;
    this.host = host;

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(this.SW(), this.SH());
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.prepend(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f4ee);
    const camera = this.camera = new THREE.PerspectiveCamera(FOV, this.SW() / this.SH(), .05, 300);

    const orbit = this.orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI * .495;
    orbit.minDistance = 1.5;
    orbit.maxDistance = 45;

    const hemi = this.hemi = new THREE.HemisphereLight(0xfff8ee, 0xb9a88f, 1.1);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(COARSE ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left:-11, right:11, top:11, bottom:-11, near:1, far:60 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.target.position.set(0, 0, 0);
    scene.add(sun.target);

    const ground = this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color:0xf2eee7, roughness:1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    ground.receiveShadow = true;

    scene.add(hemi, sun, ground);

    this.wallMat  = new THREE.MeshStandardMaterial({ color:'#f4f1eb', roughness:.92 });
    this.capMat   = new THREE.MeshStandardMaterial({ color:'#34312d', roughness:.9 });
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color:0xcfe6ef, roughness:.05, transparent:true, opacity:.28,
      depthWrite:false, side:THREE.DoubleSide,
    });

    this.archFloor = new THREE.Group();
    this.archUp    = new THREE.Group();
    this.furnG     = new THREE.Group();
    scene.add(this.archFloor, this.archUp, this.furnG);

    /* ---- 点击门开合 ---- */
    let downAt = null;
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', e => {
      downAt = { x:e.clientX, y:e.clientY, t:performance.now() };
    });
    cv.addEventListener('pointerup', e => {
      if (!downAt) return;
      const dt = performance.now() - downAt.t;
      const dist = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      // 只把「短按 + 未拖动」当作点击（避免和 OrbitControls 冲突）
      if (dt > 400 || dist > 5) return;
      const h = this._pick(e);
      // 只对门做开合切换；距离不再做硬阈值限制（用户可能站得很远）
      if (h?.door){
        h.door.open = !h.door.open;
      }
    });

    new ResizeObserver(() => {
      if (!this.renderer) return;
      renderer.setSize(this.SW(), this.SH());
      camera.aspect = this.SW() / this.SH();
      camera.updateProjectionMatrix();
    }).observe(stage);

    this._applyLight();
  }

  /* ---------- 清理 ---------- */
  _clear(g){
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    g.clear();
  }

  /* ---------- 墙段生成（支持中心线格式 + 数组格式） ---------- */
  _wallBox(w, yb, yt){
    if (yt - yb <= .001) return;
    let cx, cy, L, T, rotY = 0;
    if (Array.isArray(w)){
      const [x0, y0, x1, y1] = w;
      L = this.M(x1 - x0);
      T = this.M(y1 - y0);
      cx = (x0 + x1) / 2;
      cy = (y0 + y1) / 2;
    } else {
      const dx = w.x1 - w.x0, dy = w.y1 - w.y0;
      L = Math.max(0.001, Math.hypot(dx, dy) / 1000);
      T = Math.max(0.02, (w.t || 240) / 1000);
      cx = (w.x0 + w.x1) / 2;
      cy = (w.y0 + w.y1) / 2;
      rotY = -Math.atan2(dy, dx);
    }
    const h = yt - yb;
    const geo = new THREE.BoxGeometry(L, h, T);
    const o = new THREE.Mesh(geo, [this.wallMat, this.wallMat, this.capMat, this.wallMat, this.wallMat, this.wallMat]);
    o.position.set(this.wx(cx), (yb + yt) / 2, this.wz(cy));
    o.rotation.y = rotY;
        o.castShadow = true; o.receiveShadow = true;
    this.archUp.add(o);
  }

  /**
   * 生成一条墙的所有几何，按它上面的门窗洞口分段。
   * @param wall      墙对象 { id, x0, y0, x1, y1, t, kind }
   * @param openings  该墙上的洞口列表 [{ kind:'door'|'window', x0,y0,x1,y1, sill }]
   * @param top       墙的最大高度（this.opt.cut）
   */
  _buildWallWithOpenings(wall, openings, top){
    const dx = wall.x1 - wall.x0, dy = wall.y1 - wall.y0;
    const wLen = Math.hypot(dx, dy);
    if (wLen < 1) return;
    const ux = dx / wLen, uy = dy / wLen;

    // 把每个洞口转成沿墙方向的参数区间 + 上下高度
    const holes = [];
    openings.forEach(op => {
      const t1 = this._projectT({ x:op.x0, y:op.y0 }, wall);
      const t2 = this._projectT({ x:op.x1, y:op.y1 }, wall);
      const a = Math.min(t1, t2) * wLen;
      const b = Math.max(t1, t2) * wLen;
      if (b - a < 1) return;
      const isDoor = op.kind === 'door';
      const isDem  = op.kind === 'demolition';
      const sill = (isDoor || isDem) ? 0 : Math.max(0, (op.sill || 900) / 1000);
      const head = isDem ? top : (isDoor ? Math.min(2.05, top) : Math.min(2.4, top));
      holes.push({
        tMin: Math.max(0, a),
        tMax: Math.min(wLen, b),
        sill,
        head,
      });
    });

    if (holes.length === 0){
      this._wallBox(wall, 0, top);
      return;
    }

    const breaks = new Set([0, wLen]);
    holes.forEach(h => { breaks.add(h.tMin); breaks.add(h.tMax); });
    const sorted = [...breaks].sort((a, b) => a - b);

    for (let i = 0; i < sorted.length - 1; i++){
      const a = sorted[i], b = sorted[i + 1];
      if (b - a < 1) continue;
      const mid = (a + b) / 2;

      let hit = null;
      for (const h of holes){
        if (mid > h.tMin + 1e-6 && mid < h.tMax - 1e-6){ hit = h; break; }
      }

      const cx0 = wall.x0 + ux * a, cy0 = wall.y0 + uy * a;
      const cx1 = wall.x0 + ux * b, cy1 = wall.y0 + uy * b;
      const segWall = { x0:cx0, y0:cy0, x1:cx1, y1:cy1, t:wall.t, kind:wall.kind };

      if (!hit){
        this._wallBox(segWall, 0, top);
      } else {
        if (hit.sill > 0.01) this._wallBox(segWall, 0, Math.min(hit.sill, top));
        if (hit.head < top - 0.01) this._wallBox(segWall, hit.head, top);
      }
    }
  }

  /** 点 p 在墙中心线上的参数 t ∈ [0,1] */
  _projectT(p, wall){
    const dx = wall.x1 - wall.x0, dy = wall.y1 - wall.y0;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1) return 0;
    const t = ((p.x - wall.x0) * dx + (p.y - wall.y0) * dy) / L2;
    return Math.max(0, Math.min(1, t));
  }

  /** 点到线段的距离 */
  _distToSeg(px, py, x0, y0, x1, y1){
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0;
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }

  /** 找一条墙上的所有洞口（先按 hostWall，再按几何距离兜底） */
  _openingsOnWall(wall, plan){
    const tol = (wall.t || 240) / 2 + 500;
    const all = [...(plan.doors || []), ...(plan.windows || [])];
    return all.filter(op => {
      if (op.hostWall === wall.id) return true;
      const cx = (op.x0 + op.x1) / 2, cy = (op.y0 + op.y1) / 2;
      const d = this._distToSeg(cx, cy, wall.x0, wall.y0, wall.x1, wall.y1);
      return d < tol;
    });
  }

  _shapeOf(poly, flip){
    const s = new THREE.Shape();
    poly.forEach(([x, y], i) => s[i ? 'lineTo' : 'moveTo'](this.wx(x), flip ? this.wz(y) : -this.wz(y)));
    return s;
  }

  /* ---------- 建筑 ---------- */
  buildArch(){
    this._clear(this.archFloor);
    this._clear(this.archUp);
    const { plan, layout } = this.app.store.state;
    const top = this.opt.cut;

    /* 地板 */
    (plan.rooms || []).forEach(r => {
      if (!r.poly || !r.poly.length) return;
      const geo = new THREE.ShapeGeometry(this._shapeOf(r.poly));
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness:.7 });
      const fl = new THREE.Mesh(geo, m);
      fl.receiveShadow = true;
      fl.userData.room = r.id;
      this.archFloor.add(fl);
    });

    /* 墙体（按门窗洞分段生成） */
    (plan.walls || []).forEach((w, i) => {
      const id = w.id || ('w' + i);
      if ((layout.demolished || []).includes(id)) return;
      const isLow = w.kind === 'low';
      if (isLow){
        this._wallBox(w, 0, Math.min(1, top));
        return;
      }
      const openings = this._openingsOnWall(w, plan);
      // 拆除段视作全高洞口（贯通到顶）
      (layout.demolitions || []).forEach(dm => {
        if (dm && dm.hostWall === w.id){
          openings.push({ kind:'demolition', x0:dm.x0, y0:dm.y0, x1:dm.x1, y1:dm.y1 });
        }
      });
      this._buildWallWithOpenings(w, openings, top);
    });

    /* 窗（上下墙 + 玻璃） */
    (plan.windows || []).forEach(win => {
      const L = this.M(Math.hypot(win.x1 - win.x0, win.y1 - win.y0));
      const cx = this.wx((win.x0 + win.x1) / 2);
      const cz = this.wz((win.y0 + win.y1) / 2);
      const rotY = -Math.atan2(win.y1 - win.y0, win.x1 - win.x0);
      const sill = (win.sill || 900) / 1000;
      const head = 2.4;
      // 上下墙已由 _buildWallWithOpenings 处理，这里只画玻璃

      const gh = Math.min(head, top) - sill;
      if (gh <= 0) return;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(L, gh, .01), this.glassMat);
      pane.position.set(cx, sill + gh / 2, cz);
      pane.rotation.y = rotY;
      this.archUp.add(pane);
    });

    /* 门（门板 + 过梁） */
    this.doors.length = 0;      // 每次重建前清空
    (plan.doors || []).forEach(d => {
      const dh = Math.min(2.05, top);
      const L = this.M(Math.hypot(d.x1 - d.x0, d.y1 - d.y0));
      const dirX = d.x1 - d.x0, dirY = d.y1 - d.y0;
      const Lw = Math.hypot(dirX, dirY) || 1;
      const ux = dirX / Lw, uy = dirY / Lw;

      // 铰点由 hinge 决定
      const hingeAtX0 = d.hinge !== 'right';
      const hx = hingeAtX0 ? d.x0 : d.x1;
      const hy = hingeAtX0 ? d.y0 : d.y1;

      // 关闭方向：从铰点指向另一端
      const cSign = hingeAtX0 ? 1 : -1;
      const cDirX = ux * cSign, cDirY = uy * cSign;
      const baseAng = Math.atan2(-cDirY, cDirX);     // 2D → three.js Y 旋转

      // 开启方向：由墙的法向量 + swing 决定，与铰点无关
      const wallNx = -uy, wallNy = ux;
      const swingSign = d.swing === 'out' ? -1 : 1;
      const oDirX = wallNx * swingSign, oDirY = wallNy * swingSign;
      const openAngRaw = Math.atan2(-oDirY, oDirX);

      // 归一化到 (-π, π]，避免插值时绕远路
      let delta = openAngRaw - baseAng;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const openAng = baseAng + delta;

      const pivot = new THREE.Group();
      pivot.position.set(this.wx(hx), 0, this.wz(hy));
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(L, dh, .04),
        new THREE.MeshStandardMaterial({ color: d.entry ? '#6b4f3a' : '#efe6d8', roughness:.5 })
      );
      leaf.position.set(L / 2, dh / 2, 0);
      leaf.castShadow = true;
      pivot.add(leaf);

      // 门把手（小圆球，便于拾取 / 视觉识别）
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(.03, 12, 8),
        this.frameMat
      );
      knob.position.set(L - .07, Math.min(1, dh - .05), 0);
      knob.scale.z = 2.2;
      pivot.add(knob);

      // ---- door 对象：状态 + 铰点 + 开合角 ----
      const door = {
        pivot,
        a0: baseAng,
        a1: openAng,
        cur: baseAng,
        open: false,       // 默认关闭
      };
      pivot.rotation.y = door.cur;

      // 把 door 引用挂到 pivot 及所有子物体上，方便 _pick 找到
      pivot.userData.door = door;
      leaf.userData.door = door;
      knob.userData.door = door;

      this.doors.push(door);
      this.archUp.add(pivot);
    });

    this._applyGrow();
  }

  /* ---------- 家具（按类型组合几何体） ---------- */
  buildFurn(){
    this._clear(this.furnG);
    (this.app.store.state.layout.furniture || []).forEach(f => {
      const w = this.M(f.w), d = this.M(f.d), c = f.color || '#dddddd';
      const g = this._furnMesh(f.type, w, d, c);
      g.position.set(this.wx(f.cx), 0, this.wz(f.cy));
      g.rotation.y = -f.rot * Math.PI / 180;
      // 把 fid 挂到组及所有子物体，便于 _pick 往上找
      g.userData.fid = f.id;
      g.traverse(o => { o.userData.fid = f.id; });
      this.furnG.add(g);
    });
    this.furnG.visible = this.opt.furn;
    this._applyGrow();
  }

  /**
   * 按家具类型生成组合几何体。
   * 约定：返回 THREE.Group，原点在俯视中心、底面 y=0，width 沿 X、depth 沿 Z。
   * @param {string} type  家具 type（与 furnitureLib 一致）
   * @param {number} w     宽（米）
   * @param {number} d     深（米）
   * @param {string} color 主色
   */
  _furnMesh(type, w, d, color){
    const g = new THREE.Group();
    const mat = (c = color, rough = .75) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    const M  = mat(color, .78);                       // 主色
    const Md = mat(shade(color, .72), .8);            // 深色 / 阴影面
    const Ml = mat(shade(color, 1.28), .55);          // 亮色 / 软包
    const Mk = mat('#2b2a26', .55);                   // 金属 / 深色零件
    const Mw = mat('#ffffff', .4);                    // 白瓷 / 玻璃面板

    const add = (geo, m, x, y, z) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const box = (W, H, D, x, y, z, m = M) => add(new THREE.BoxGeometry(W, H, D), m, x, y, z);
    const cyl = (R, H, x, y, z, m = M, seg = 16) => add(new THREE.CylinderGeometry(R, R, H, seg), m, x, y, z);
    const sph = (R, x, y, z, m = M) => add(new THREE.SphereGeometry(R, 14, 10), m, x, y, z);

    switch (type){
      /* ---------- 卧室 ---------- */
      case 'bed': {
        const bH = 0.3;
        box(w, bH, d, 0, bH/2, 0, Md);                               // 床架
        box(w * 0.94, 0.18, d * 0.88, 0, bH + 0.09, -d * 0.02, Ml);  // 床垫
        const pW = w > 1.3 ? w * 0.4 : w * 0.72;
        box(pW, 0.1, 0.32, w > 1.3 ? -w * 0.22 : 0, bH + 0.22, -d * 0.32, Ml);
        if (w > 1.3) box(pW, 0.1, 0.32, w * 0.22, bH + 0.22, -d * 0.32, Ml);
        box(w * 0.9, 0.06, d * 0.55, 0, bH + 0.22, d * 0.16, mat(shade(color, 1.12), .85)); // 被子
        break;
      }
      case 'crib': {
        const h = 0.85, ph = 0.04;
        [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]].forEach(([x, z]) => box(ph, h, ph, x, h/2, z, Md));
        box(w, 0.04, d, 0, 0.28, 0, Md);
        box(w * 0.9, 0.06, d * 0.85, 0, 0.33, 0, Ml);
        for (let i = 1; i < 6; i++){
          const x = -w/2 + i * w / 6;
          box(0.02, 0.42, 0.02, x, 0.62, -d/2 + 0.03);
          box(0.02, 0.42, 0.02, x, 0.62,  d/2 - 0.03);
        }
        break;
      }
      case 'nightstand': {
        const h = 0.5;
        box(w, h, d, 0, h/2, 0, M);
        box(w * 0.92, 0.015, 0.01, 0, h * 0.55, d/2 + 0.005, Mk);
        box(w * 0.3, 0.02, 0.02, 0, h * 0.55, d/2 + 0.02, Mk);
        break;
      }
      case 'wardrobe': {
        const h = 1.9;
        box(w, h, d, 0, h/2, 0, M);
        box(0.015, h * 0.94, 0.015, 0, h/2, d/2 + 0.005, Mk);        // 门缝
        box(0.035, 0.25, 0.03, -0.06, h * 0.5, d/2 + 0.03, Mk);      // 把手
        box(0.035, 0.25, 0.03,  0.06, h * 0.5, d/2 + 0.03, Mk);
        break;
      }
      case 'dresser': {
        const h = 0.78;
        box(w, h, d, 0, h/2, 0, M);
        box(w * 1.02, 0.03, d * 1.02, 0, h + 0.015, 0, Md);
        // 镜面
        box(w * 0.55, 0.7, 0.02, 0, h + 0.38, -d/2 + 0.02, mat('#cad2d8', .25));
        break;
      }
      case 'desk': {
        const h = 0.72;
        box(w, 0.04, d, 0, h, 0, M);
        const px = w/2 - 0.05, pz = d/2 - 0.05;
        [[-px, -pz], [px, -pz], [-px, pz], [px, pz]].forEach(([x, z]) => box(0.04, h, 0.04, x, h/2, z, Md));
        break;
      }
      case 'chair': {
        const h = 0.45;
        box(w, 0.05, d, 0, h, 0, M);
        box(w, 0.55, 0.04, 0, h + 0.3, -d/2 + 0.03, M);              // 靠背
        const px = w/2 - 0.04, pz = d/2 - 0.04;
        [[-px, -pz], [px, -pz], [-px, pz], [px, pz]].forEach(([x, z]) => box(0.03, h, 0.03, x, h/2, z, Md));
        break;
      }
      case 'bookshelf': {
        const h = 1.8;
        box(w, h, d, 0, h/2, 0, M);
        box(w * 1.01, 0.015, 0.012, 0, h * 0.32, d/2 + 0.005, Md);
        box(w * 1.01, 0.015, 0.012, 0, h * 0.64, d/2 + 0.005, Md);
        const vn = Math.max(2, Math.round(w / 0.5));
        for (let i = 1; i < vn; i++) box(0.012, h * 0.9, 0.012, -w/2 + i * w / vn, h/2, d/2 + 0.005, Md);
        break;
      }
      case 'baycushion': {
        box(w, 0.1, d, 0, 0.05, 0, M);
        box(w * 0.85, 0.03, d * 0.85, 0, 0.11, 0, Ml);
        break;
      }

      /* ---------- 客厅 ---------- */
      case 'sofa': case 'armchair': case 'cornersofa': {
        const bH = 0.36;
        box(w, bH, d, 0, bH/2, 0, Md);
        box(w, 0.65, d * 0.22, 0, 0.32, -d/2 + d * 0.11, M);          // 靠背
        box(w * 0.11, 0.5, d, -w/2 + w * 0.055, 0.25, 0, M);
        box(w * 0.11, 0.5, d,  w/2 - w * 0.055, 0.25, 0, M);
        const inner = w * 0.78;
        const n = type === 'armchair' ? 1 : (w > 2.2 ? 3 : 2);
        const cw = (inner / n) * 0.92;
        for (let i = 0; i < n; i++){
          const cx = -inner/2 + i * (inner/n) + (inner/n) / 2;
          box(cw, 0.15, d * 0.68, cx, bH + 0.075, d * 0.08, Ml);
        }
        box(inner, 0.3, 0.1, 0, 0.52, -d/2 + 0.14, Ml);
        break;
      }
      case 'beanbag': {
        const R = Math.min(w, d) / 2;
        const s = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), M);
        s.scale.y = 0.62;
        s.position.y = R * 0.55;
        s.castShadow = true; s.receiveShadow = true;
        g.add(s);
        break;
      }
      case 'coffeetable': {
        const h = 0.4;
        box(w, 0.055, d, 0, h, 0, M);
        box(w * 0.85, 0.03, d * 0.7, 0, h * 0.4, 0, Md);             // 下层隔板
        const px = w/2 - 0.05, pz = d/2 - 0.05;
        [[-px, -pz], [px, -pz], [-px, pz], [px, pz]].forEach(([x, z]) => box(0.04, h, 0.04, x, h/2, z, Md));
        break;
      }
      case 'sidetable': {
        const h = 0.55;
        cyl(w / 2, 0.04, 0, h, 0, M, 20);
        cyl(0.035, h, 0, h / 2, 0, Md, 12);
        cyl(w * 0.25, 0.03, 0, 0.015, 0, Md, 20);
        break;
      }
      case 'rug': {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), M);
        mesh.position.set(0, 0.006, 0);
        mesh.receiveShadow = true;
        g.add(mesh);
        break;
      }
      case 'tvstand': case 'cabinet': case 'shoecab': {
        const h = type === 'tvstand' ? 0.5 : 0.9;
        box(w, h, d, 0, h/2, 0, M);
        box(w * 1.02, 0.03, d * 1.03, 0, h + 0.015, 0, Md);
        // 抽屉缝
        box(w * 0.9, 0.012, 0.012, 0, h * 0.5, d/2 + 0.005, Mk);
        break;
      }
      case 'floorlamp': {
        cyl(0.15, 0.03, 0, 0.015, 0, Md, 20);
        cyl(0.018, 1.2, 0, 0.62, 0, Md, 10);
        cyl(0.18, 0.26, 0, 1.32, 0, mat('#fff6dd', .4), 20);
        break;
      }
      case 'plant': {
        const R = Math.min(w, d) / 2 * 0.4;
        cyl(R, 0.35, 0, 0.175, 0, mat('#a8794f', .85), 14);
        sph(R * 1.7, 0, 0.8, 0, mat(shade(color, .9), .9));
        sph(R * 1.2, R * 0.42, 1.05, -R * 0.22, mat(shade(color, 1.12), .9));
        sph(R * 1.0, -R * 0.5, 0.95, R * 0.3, mat(shade(color, .8), .9));
        break;
      }

      /* ---------- 餐厨 ---------- */
      case 'table': {
        const h = 0.74;
        box(w, 0.05, d, 0, h, 0, M);
        const px = w/2 - 0.06, pz = d/2 - 0.06;
        [[-px, -pz], [px, -pz], [-px, pz], [px, pz]].forEach(([x, z]) => box(0.05, h, 0.05, x, h/2, z, Md));
        break;
      }
      case 'roundtable': {
        const h = 0.74;
        cyl(w / 2, 0.05, 0, h, 0, M, 28);
        cyl(0.07, h, 0, h/2, 0, Md, 14);
        cyl(w * 0.22, 0.04, 0, 0.02, 0, Md, 20);
        break;
      }
      case 'counter': case 'island': {
        const h = 0.88;
        box(w, h - 0.04, d, 0, (h - 0.04)/2, 0, M);
        box(w * 1.02, 0.04, d * 1.05, 0, h - 0.02, 0, mat('#d0c9b8', .55));
        break;
      }
      case 'stove': {
        const h = 0.9;
        box(w, h, d, 0, h/2, 0, mat('#2f2f2f', .5));
        const r = Math.min(w, d) * 0.17;
        const pts = w / d > 1.4
          ? [[-w * 0.25, 0], [w * 0.25, 0]]
          : [[-w * 0.25, -d * 0.25], [w * 0.25, -d * 0.25], [-w * 0.25, d * 0.25], [w * 0.25, d * 0.25]];
        pts.forEach(([x, z]) => {
          cyl(r, 0.02, x, h + 0.01, z, mat('#555', .4), 18);
          cyl(r * 0.5, 0.03, x, h + 0.02, z, mat('#181818', .35), 14);
        });
        break;
      }
      case 'ksink': {
        const h = 0.88;
        box(w, h, d, 0, h/2, 0, mat('#dcdcdc', .5));
        box(w * 0.42, 0.05, d * 0.66, -w * 0.22, h - 0.02, 0, mat('#a8b0b4', .35));
        box(w * 0.42, 0.05, d * 0.66,  w * 0.22, h - 0.02, 0, mat('#a8b0b4', .35));
        cyl(0.015, 0.2, 0, h + 0.1, -d * 0.3, mat('#c8ccce', .3), 10);
        break;
      }
      case 'fridge': {
        const h = 1.85;
        box(w, h, d, 0, h/2, 0, mat(color, .45));
        box(w * 1.01, 0.015, 0.01, 0, h * 0.7, d/2 + 0.005, Mk);
        box(0.03, 0.5, 0.035, w * 0.32, h * 0.5, d/2 + 0.03, Mk);
        box(0.03, 0.5, 0.035, -w * 0.32, h * 0.5, d/2 + 0.03, Mk);
        break;
      }
      case 'barstool': {
        const h = 0.75;
        cyl(w * 0.45, 0.05, 0, h, 0, M, 20);
        cyl(0.025, h, 0, h/2, 0, Md, 10);
        cyl(w * 0.35, 0.02, 0, 0.01, 0, Md, 20);
        break;
      }

      /* ---------- 卫浴 ---------- */
      case 'toilet': {
        box(w, 0.65, d * 0.28, 0, 0.325, -d * 0.36, Mw);            // 水箱
        box(w * 0.9, 0.18, d * 0.55, 0, 0.09, d * 0.1, Mw);
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.5, 0.1, 18), Mw);
        seat.scale.z = (d / w) * 0.9;
        seat.position.set(0, 0.23, d * 0.1);
        seat.castShadow = true; seat.receiveShadow = true;
        g.add(seat);
        break;
      }
      case 'vanity': {
        const h = 0.85;
        box(w, h - 0.04, d, 0, (h - 0.04)/2, 0, M);
        box(w * 1.02, 0.04, d * 1.02, 0, h - 0.02, 0, Mw);
        const R = Math.min(w * 0.32, 0.22);
        cyl(R, 0.08, 0, h + 0.02, 0, mat('#eef3f6', .3), 20);
        cyl(0.012, 0.14, 0, h + 0.1, -d * 0.32, mat('#c8ccce', .3), 10);
        break;
      }
      case 'shower': {
        const gh = 2.0;
        box(w, 0.04, d, 0, 0.02, 0, Mw);
        const gm = new THREE.MeshPhysicalMaterial({
          color: 0xa8c8d4, roughness: .05, transparent: true, opacity: .22,
          depthWrite: false, side: THREE.DoubleSide,
        });
        box(w, gh, 0.01, 0, gh/2, -d/2 + 0.005, gm);
        box(0.01, gh, d, -w/2 + 0.005, gh/2, 0, gm);
        box(0.01, gh, d,  w/2 - 0.005, gh/2, 0, gm);
        cyl(0.018, 0.4, 0, gh - 0.2, -d/2 + 0.1, mat('#c8ccce', .3), 10);
        break;
      }
      case 'bathtub': {
        box(w, 0.55, d, 0, 0.275, 0, Mw);
        box(w * 0.85, 0.44, d * 0.78, 0, 0.4, 0, mat('#d8e0e4', .25));
        break;
      }
      case 'washer': case 'dryer': {
        const h = 0.85;
        box(w, h, d, 0, h/2, 0, mat(color, .55));
        const r = Math.min(w, d) * 0.3;
        const win = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 24), mat('#3d3d3d', .3));
        win.rotation.x = Math.PI / 2;
        win.position.set(0, h * 0.55, d/2 + 0.005);
        g.add(win);
        const inn = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.02, 24), mat('#c8d4da', .2));
        inn.rotation.x = Math.PI / 2;
        inn.position.set(0, h * 0.55, d/2 + 0.012);
        g.add(inn);
        break;
      }
      case 'waterheater': {
        const R = Math.min(w, d) / 2;
        cyl(R, 0.6, 0, 1.5, 0, Mw, 20);
        cyl(R * 0.4, 0.05, 0, 1.85, 0, mat('#c0c0c0', .4), 12);
        break;
      }

      /* ---------- 家电 ---------- */
      case 'tv': {
        box(w, 0.6, 0.04, 0, 0.7, 0, mat('#1d1d1f', .3));
        box(0.1, 0.4, 0.08, 0, 0.2, 0, Mk);
        box(w * 0.3, 0.02, 0.2, 0, 0.01, 0, Mk);
        break;
      }
      case 'aircon': {
        const h = 1.8;
        box(w, h, d, 0, h/2, 0, Mw);
        box(w * 0.7, 0.4, 0.02, 0, h * 0.85, d/2 + 0.005, mat('#c0c0c0', .4));
        break;
      }
      case 'acwall': {
        box(w, 0.3, d, 0, 2.3, 0, Mw);
        box(w * 0.85, 0.02, 0.02, 0, 2.18, d/2 + 0.02, mat('#c0c0c0', .4));
        break;
      }
      case 'dishwasher': {
        const h = 0.85;
        box(w, h, d, 0, h/2, 0, mat(color, .5));
        box(w * 0.9, 0.02, 0.012, 0, h * 0.85, d/2 + 0.005, mat('#c0c0c0', .4));
        box(w * 0.5, 0.04, 0.04, 0, h * 0.9, d/2 + 0.02, mat('#c0c0c0', .4));
        break;
      }
      case 'ovencol': {
        const h = 2.0;
        box(w, h, d, 0, h/2, 0, M);
        box(w * 0.85, 0.5, 0.02, 0, h * 0.78, d/2 + 0.005, mat('#1d1d1f', .3));
        box(w * 0.85, 0.5, 0.02, 0, h * 0.25, d/2 + 0.005, mat('#1d1d1f', .3));
        break;
      }
      case 'purifier': {
        const R = Math.min(w, d) / 2;
        cyl(R, 0.7, 0, 0.35, 0, Mw, 20);
        cyl(R * 0.6, 0.05, 0, 0.72, 0, mat('#c0c0c0', .4), 16);
        break;
      }

      /* ---------- 书房 · 休闲 ---------- */
      case 'officechair': {
        // 五星底座
        for (let i = 0; i < 5; i++){
          const a = i * Math.PI * 2 / 5;
          const l = w * 0.45;
          const leg = new THREE.Mesh(new THREE.BoxGeometry(l, 0.03, 0.05), Md);
          leg.position.set(Math.cos(a) * l / 2, 0.03, Math.sin(a) * l / 2);
          leg.rotation.y = -a;
          leg.castShadow = true; leg.receiveShadow = true;
          g.add(leg);
          cyl(0.03, 0.06, Math.cos(a) * l, 0.03, Math.sin(a) * l, Mk, 8);
        }
        cyl(0.04, 0.5, 0, 0.28, 0, Md, 10);
        box(w * 0.9, 0.1, d * 0.9, 0, 0.55, 0, M);                   // 座面
        box(w * 0.85, 0.6, 0.08, 0, 0.85, -d/2 + 0.04, M);           // 靠背
        box(0.05, 0.18, d * 0.6, -w * 0.42, 0.7, 0, Md);
        box(0.05, 0.18, d * 0.6,  w * 0.42, 0.7, 0, Md);
        break;
      }
      case 'piano': {
        box(w, 0.9, d * 0.5, 0, 0.45, -d * 0.2, Mk);
        box(w * 0.9, 0.12, d * 0.4, 0, 0.95, -d * 0.15, Mk);
        box(w * 0.85, 0.03, d * 0.35, 0, 0.9, d * 0.15, Mw);
        for (let i = 0; i < 30; i++){
          const x = -w * 0.42 + i * w * 0.84 / 30;
          box(0.008, 0.02, d * 0.3, x, 0.915, d * 0.15, Mk);
        }
        box(0.06, 0.9, 0.06, -w * 0.42, 0.45, d * 0.4, Mk);
        box(0.06, 0.9, 0.06,  w * 0.42, 0.45, d * 0.4, Mk);
        break;
      }
      case 'treadmill': {
        box(w, 0.1, d * 0.9, 0, 0.05, 0, mat(color, .6));
        box(w * 0.85, 0.05, d * 0.7, 0, 0.11, 0, Mk);
        box(0.06, 1.0, 0.06, -w * 0.4, 0.6, -d * 0.4, mat(color, .6));
        box(0.06, 1.0, 0.06,  w * 0.4, 0.6, -d * 0.4, mat(color, .6));
        box(w, 0.04, 0.04, 0, 1.05, -d * 0.4, mat('#2b2b2b', .5));
        box(w * 0.5, 0.25, 0.03, 0, 1.1, -d * 0.4, Mk);
        break;
      }

      /* ---------- 兜底：方块 ---------- */
      default: {
        box(w, 0.6, d, 0, 0.3, 0, M);
      }
    }
    return g;
  }

  /* ---------- 同步（重建建筑 + 家具） ---------- */
  sync(force){
    if (!this.inited) return;
    if (!this.active && !force) return;
    this.buildArch();
    this.buildFurn();
  }

  _applyGrow(){
    if (!this.inited) return;
    this.archUp.scale.y = Math.max(this.grow, .001);
    this.furnG.scale.y = Math.max(this.furnGrow, .001);
  }

  /* ---------- 光照 ---------- */
  _applyLight(){
    const t = (this.opt.hour - 6) / 12;
    const az = Math.PI * (.15 + t * .7);
    const el = Math.sin(Math.PI * t) * 1.05 + .15;
    const warm = 1 - Math.sin(Math.PI * t);
    this.sun.position.set(Math.cos(az) * 18, Math.sin(el) * 20 + 3, -Math.sin(az) * 10 + 8);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.setHSL(.09, .5 + warm * .4, .92 - warm * .12);
    this.sun.intensity = this.opt.night ? .05 : 1.4 + Math.sin(Math.PI * t) * 1.6;
    this.hemi.intensity = this.opt.night ? .12 : 1.1;
    this.scene.background = new THREE.Color(this.opt.night ? 0x1c2130 : 0xf7f4ee);
    this.ground.material.color.set(this.opt.night ? 0x2a2e38 : 0xf2eee7);
    const h = Math.floor(this.opt.hour);
    const m = Math.round((this.opt.hour - h) * 60);
    const t2 = $('#sunT');
    if (t2) t2.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  /* ---------- 相机 ---------- */
  _planPose(){
    const vp = this.app.viewport;
    const SW = this.SW(), SH = this.SH();
    const cx = vp.x0 + SW / 2 / vp.s;
    const cy = vp.y0 + SH / 2 / vp.s;
    const visH = SH / vp.s / 1000;
    const dist = visH / 2 / Math.tan(FOV / 2 * Math.PI / 180);
    const t = new THREE.Vector3(this.wx(cx), 0, this.wz(cy));
    return { t, p:new THREE.Vector3(t.x, dist, t.z + 1e-4) };
  }
  _isoFrom(P){
    const d = Math.max(5, Math.min(30, P.p.y));
    const dir = new THREE.Vector3(.3, .82, .49).normalize();
    return { t:P.t.clone(), p:P.t.clone().addScaledVector(dir, d) };
  }
  _isoWhole(){ return { t:new THREE.Vector3(0, 0, 0), p:new THREE.Vector3(5.5, 15.5, 10) }; }
  _topWhole(){ return { t:new THREE.Vector3(0, 0, 0), p:new THREE.Vector3(0, 19, 1e-4) }; }
  _curPose(){ return { t:this.orbit.target.clone(), p:this.camera.position.clone() }; }
  _camTween(A, B, e){
    const t = A.t.clone().lerp(B.t, e);
    const sa = new THREE.Spherical().setFromVector3(A.p.clone().sub(A.t));
    const sb = new THREE.Spherical().setFromVector3(B.p.clone().sub(B.t));
    let dth = sb.theta - sa.theta;
    dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    const s = new THREE.Spherical(
      sa.radius + (sb.radius - sa.radius) * e,
      sa.phi + (sb.phi - sa.phi) * e,
      sa.theta + dth * e
    );
    this.camera.position.copy(t).add(new THREE.Vector3().setFromSpherical(s));
    this.camera.lookAt(t);
    this.orbit.target.copy(t);
  }
  _animate(dur, fn){ return new Promise(res => { this.anim = { t0:performance.now(), dur, fn, res }; }); }
  _wait(ms){ return new Promise(r => setTimeout(r, ms)); }
  flyTo(B, dur = 900){ this.fly = { t0:performance.now(), dur, A:this._curPose(), B }; }

  /* ---------- 进入 / 退出 ---------- */
  async enter(){
    if (!this.inited) await this.init();
    this.active = true;
    this.renderer.setSize(this.SW(), this.SH());
    this.camera.aspect = this.SW() / this.SH();
    this.camera.updateProjectionMatrix();
    this.sync(true);

    this.opt.mode = 'orbit';
    this.orbit.enabled = false;

    const A = this._planPose(), B = this._isoFrom(A);
    this.grow = 0;
    this.furnGrow = 0;
    this._applyGrow();
    this.camera.position.copy(A.p);
    this.orbit.target.copy(A.t);
    this.camera.lookAt(A.t);

    this.stage.classList.add('animating');
    this._startLoop();
    this.renderer.render(this.scene, this.camera);
    this.stage.classList.add('is3d');

    await this._wait(420);
    await this._animate(1700, t => {
      this._camTween(A, B, ease(clamp01(t / .85)));
      this.grow = ease(clamp01((t - .1) / .55));
      this.furnGrow = ease(clamp01((t - .45) / .5));
      this._applyGrow();
    });
    this.orbit.enabled = true;
    this.stage.classList.remove('animating');
  }

  async exit(){
    if (!this.active) return;
    this.fly = null;
    this.orbit.enabled = false;
    this.stage.classList.add('animating');
    const A = this._curPose(), B = this._planPose();
    await this._animate(1300, t => {
      this._camTween(A, B, ease(clamp01((t - .1) / .9)));
      this.furnGrow = 1 - ease(clamp01(t / .45));
      this.grow = 1 - ease(clamp01((t - .2) / .6));
      this._applyGrow();
    });
    this.stage.classList.remove('is3d');
    await this._wait(450);
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stage.classList.remove('animating');
    this.grow = this.furnGrow = 1;
    this._applyGrow();
  }

  /* ---------- 主循环 ---------- */
  _startLoop(){
    if (this.raf) return;
    this.clock = new THREE.Clock();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      if (this.anim){
        const t = clamp01((now - this.anim.t0) / this.anim.dur);
        this.anim.fn(t);
        if (t >= 1){ const r = this.anim.res; this.anim = null; r(); }
      } else if (this.fly){
        const t = clamp01((now - this.fly.t0) / this.fly.dur);
        this._camTween(this.fly.A, this.fly.B, ease(t));
        if (t >= 1) this.fly = null;
      } else if (this.opt.mode === 'orbit'){
        this.orbit.update();
      }

      // ---- 门开合插值 ----
      if (this.doors.length){
        const dt = Math.min(this.clock.getDelta ? this.clock.getDelta() : .016, .05);
        this.doors.forEach(d => {
          const tg = d.open ? d.a1 : d.a0;
          d.cur += (tg - d.cur) * Math.min(1, dt * 6);
          d.pivot.rotation.y = d.cur;
        });
      }

      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /* ---------- 拾取（射线检测） ---------- */
  _pick(e){
    if (!this.renderer) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ptr = new THREE.Vector2(
      (e.clientX - r.left) / r.width * 2 - 1,
      -(e.clientY - r.top) / r.height * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ptr, this.camera);

    // 家具 + 建筑上部（含墙、门、窗、玻璃）都参与拾取；
    // 具体命中什么由 userData 过滤决定，未注册 userData 的对象会被跳过。
    const targets = [this.furnG, this.archUp];
    const hits = ray.intersectObjects(targets, true);
    for (const h of hits){
      // 跳过玻璃（透明，不挡视线）
      if (h.object.material === this.glassMat) continue;
      // 从命中对象往上找 userData（door / fid / room）
      let o = h.object;
      while (o && !o.userData.door && !o.userData.fid && !o.userData.room && o !== this.scene){
        o = o.parent;
      }
      if (o?.userData?.door) return { door:o.userData.door, dist:h.distance };
      if (o?.userData?.fid)  return { fid: o.userData.fid,  dist:h.distance };
      if (o?.userData?.room) return { room:o.userData.room, dist:h.distance };
    }
    return null;
  }

  /* ---------- 拖放落点（供家具库用） ---------- */
  groundAt(x, y){
    if (!this.active || this.anim) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ptr = new THREE.Vector2(
      (x - r.left) / r.width * 2 - 1,
      -(y - r.top) / r.height * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ptr, this.camera);
    const g = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(g, hit)) return null;
    if (hit.distanceTo(this.camera.position) > 60) return null;
    return { x:hit.x * 1000 + OX, y:hit.z * 1000 + OY, s:.05 };
  }

  /* ---------- 工具栏接口 ---------- */
  setMode(m){
    if (this.anim) return;
    this.opt.mode = m;
    document.querySelectorAll('#modes3d .btn').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    this.orbit.enabled = (m === 'orbit');
    this._syncHint();
  }
  setCut(v){
    this.opt.cut = v;
    document.querySelectorAll('[data-cut]').forEach(b => b.classList.toggle('on', +b.dataset.cut === v));
    this.sync();
  }
  toggle(key, btn){
    this.opt[key] = !this.opt[key];
    btn?.classList.toggle('on', this.opt[key]);
    if (key === 'furn') this.furnG.visible = this.opt.furn;
    if (key === 'night') this._applyLight();
  }
  setHour(v){ this.opt.hour = v; this._applyLight(); }
  goIso(){ if (this.anim) return; this.flyTo(this._isoWhole()); }
  goTop(){ if (this.anim) return; this.flyTo(this._topWhole()); }
  flyToRoom(id){
    const r = (this.app.store.state.plan.rooms || []).find(x => x.id === id);
    if (!r) return;
    const xs = r.poly.map(p => p[0]);
    const ys = r.poly.map(p => p[1]);
    const t = new THREE.Vector3(
      this.wx((Math.min(...xs) + Math.max(...xs)) / 2),
      .6,
      this.wz((Math.min(...ys) + Math.max(...ys)) / 2)
    );
    const size = this.M(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    this.flyTo({
      t,
      p: new THREE.Vector3(t.x + size + 3, size * 1.3 + 2.5, t.z + size + 3),
    });
  }

  /* ---------- 其他 ---------- */
  _syncHint(){
    const h = $('#hint3d');
    if (!h) return;
    h.textContent = tr(
      '左键旋转 · 右键平移 · 滚轮缩放 · 单击门板开关门',
      'Left-drag orbits · scroll zooms · click a door leaf to open/close'
    );
  }
  relang(){ this._syncHint(); }
  shot(){
    const a = document.createElement('a');
    a.download = tr('户型装修方案', 'floor-plan-design') + '-3D.png';
    a.href = this.renderer.domElement.toDataURL('image/png');
    a.click();
  }
  walking(){ return false; }
}

export default Scene3D;