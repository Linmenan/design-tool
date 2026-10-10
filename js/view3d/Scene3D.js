import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $, esc, area, clamp01, ease, toast } from '../core/Utils.js';
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

  /* ---------- 家具（简化方块，带基本高度差异） ---------- */
  buildFurn(){
    this._clear(this.furnG);
    (this.app.store.state.layout.furniture || []).forEach(f => {
      const w = this.M(f.w), d = this.M(f.d), c = f.color || '#dddddd';
      const h = ({
        bed: .45, sofa: .6, armchair: .65, cornersofa: .65, wardrobe: 1.6,
        cabinet: 1, shoecab: 1.0, dresser: .75, desk: .72, chair: .85,
        bookshelf: 1.8, coffeetable: .4, table: .72, roundtable: .75,
        counter: .88, island: .88, stove: .9, fridge: 1.8,
        toilet: .4, vanity: .85, shower: .02, bathtub: .55,
        washer: .85, dryer: .85, plant: 1.2, tvstand: .5, tv: .6,
        rug: .02, baycushion: .5,
      }[f.type] ?? .6);

      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color:c, roughness:.75 })
      );
      m.position.set(this.wx(f.cx), h / 2, this.wz(f.cy));
      m.rotation.y = -f.rot * Math.PI / 180;
      m.castShadow = true; m.receiveShadow = true;
      m.userData.fid = f.id;
      this.furnG.add(m);
    });
    this.furnG.visible = this.opt.furn;
    this._applyGrow();
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