import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { $, toast } from '../core/Utils.js';
import { tr } from '../core/I18n.js';
import { CEILING_TYPES } from '../data/furnitureLib.js';

const OX = 6000, OY = 5300, H = 2.8, FOV = 45;
const WALK_FOV = 72, WALK_FOV_MIN = 50, WALK_FOV_MAX = 95;
const COARSE = matchMedia('(pointer:coarse)').matches;

const rgbK = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16 & 255)},${f(n >> 8 & 255)},${f(n & 255)})`;
};
const darken = (hex, k = .8) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const lighten = (hex, k = .2) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();

/** 地板纹理规格：sx/sy 是一块贴图的真实尺寸（米），base 底色、grout 缝色、rough 粗糙度 */
const TEX = {
  wood:     { sx: 1.8, sy: .36, base: '#d6b58a', rough: .55 },
  walnut:   { sx: 1.8, sy: .36, base: '#9a6f4b', rough: .5  },
  tile800:  { sx: .8,  sy: .8,  base: '#ebe6dd', grout: '#cfc6b7', rough: .3  },
  tile600:  { sx: .6,  sy: .6,  base: '#dfe3e0', grout: '#bfc6c1', rough: .35 },
  antislip: { sx: .3,  sy: .3,  base: '#d3d8d4', grout: '#aab2ac', rough: .8  },
  marble:   { sx: 1.2, sy: 1.2, base: '#f2efe9', grout: '#d9d2c4', rough: .18 },
  terrazzo: { sx: .5,  sy: .5,  base: '#e6dfd3', rough: .4  },
  carpet:   { sx: .3,  sy: .3,  base: '#c6bfd2', rough: 1   },
};

export class Scene3D {
  constructor(app){
    this.app = app;
    this.opt = { cut: H, furn: true, lamps: true, labels: true, night: false, hour: 10, month: 6, day: 21, mode: 'orbit' };
    this.active = false;
    this.inited = false;
    this.anim = null;
    this.fly = null;
    this.raf = 0;
    this.grow = 1;
    this.furnGrow = 1;
    this.keys = {};
    this.clock = null;
    this.doors = [];
    this.walk = null;
    this._joy = null;
    this.lamps = [];        // 顶灯引用；_applyLight 里按 night 开关

    /* 材质 / 几何缓存 */
    this._matCache = new Map();
    this._floorMats = {};
    this._rngCache = new Map();
  }

  /* ---------- 坐标换算 ---------- */
  wx(x){ return (x - OX) / 1000; }
  wz(y){ return (y - OY) / 1000; }
  M(v){ return v / 1000; }
  SW(){ return $('#stage').clientWidth || 800; }
  SH(){ return $('#stage').clientHeight || 600; }

  /* ============================================================
   *  材质 / 随机 / 颜色
   * ============================================================ */
  _mat(color, o = {}){
    const key = color + JSON.stringify(o);
    if (!this._matCache.has(key)){
      const m = new THREE.MeshStandardMaterial({ color, roughness: .7, ...o });
      this._matCache.set(key, m);
    }
    return this._matCache.get(key);
  }
  _rng(seed){
    if (this._rngCache.has(seed)) return this._rngCache.get(seed);
    let s = seed | 0;
    const fn = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    this._rngCache.set(seed, fn);
    return fn;
  }

  /**
   * 按房间地面材料 key 生成纹理材质。
   * 贴图按真实尺寸平铺（RepeatWrapping，UV 单位 = 米）。
   */
  _floorMat(kind){
    if (this._floorMats[kind]) return this._floorMats[kind];
    const s = TEX[kind] || TEX.tile800;
    const R = this._rng(kind.length * 977 + 13);
    const cvs = document.createElement('canvas');
    const wood = kind === 'wood' || kind === 'walnut';
    cvs.width  = wood ? 1024 : 512;
    cvs.height = wood ? 205  : 512;
    const g = cvs.getContext('2d'), W = cvs.width, Hh = cvs.height;
    g.fillStyle = s.base; g.fillRect(0, 0, W, Hh);

    if (wood){
      /* 两排错缝木板 + 木纹曲线 */
      const rowH = Hh / 2;
      const joints = [[W * 2 / 3], [W / 3]];
      for (let r = 0; r < 2; r++){
        let x0 = 0;
        [...joints[r], W].forEach(x1 => {
          g.fillStyle = rgbK(s.base, .9 + R() * .2);
          g.fillRect(x0, r * rowH, x1 - x0, rowH);
          g.strokeStyle = rgbK(s.base, .8);
          g.globalAlpha = .35; g.lineWidth = 1.2;
          for (let k = 0; k < 7; k++){
            const y = r * rowH + 6 + R() * (rowH - 12);
            g.beginPath(); g.moveTo(x0, y);
            for (let x = x0; x <= x1; x += 40) g.lineTo(x, y + Math.sin(x * .02 + k) * 2.5);
            g.stroke();
          }
          g.globalAlpha = 1;
          g.fillStyle = rgbK(s.base, .62);
          g.fillRect(x1 - 1.5, r * rowH, 3, rowH);
          x0 = x1;
        });
        g.fillStyle = rgbK(s.base, .62);
        g.fillRect(0, r * rowH, W, 2.5);
      }
    } else if (kind === 'marble'){
      /* 大理石：几条横向裂纹 */
      g.strokeStyle = 'rgba(160,150,135,.35)';
      for (let k = 0; k < 6; k++){
        g.lineWidth = 1 + R() * 3;
        g.beginPath(); g.moveTo(R() * W, 0);
        g.bezierCurveTo(R() * W, R() * Hh, R() * W, R() * Hh, R() * W, Hh);
        g.stroke();
      }
    } else if (kind === 'terrazzo'){
      /* 水磨石：撒彩色石子 */
      const cs = ['#b9a58c', '#8fa3a0', '#c9b7a2', '#a88f76', '#7e8a86'];
      for (let k = 0; k < 160; k++){
        g.fillStyle = cs[k % 5];
        g.beginPath(); g.arc(R() * W, R() * Hh, 2 + R() * 7, 0, 7); g.fill();
      }
    } else if (kind === 'carpet'){
      /* 地毯：细密噪点 */
      for (let k = 0; k < 3000; k++){
        g.fillStyle = `rgba(0,0,0,${R() * .05})`;
        g.fillRect(R() * W, R() * Hh, 2, 2);
      }
    } else {
      /* 地砖：细噪点 */
      for (let k = 0; k < 1500; k++){
        g.fillStyle = `rgba(0,0,0,${R() * .04})`;
        g.fillRect(R() * W, R() * Hh, 2, 2);
      }
    }
    if (s.grout){
      g.fillStyle = s.grout;
      g.fillRect(0, 0, W, 3); g.fillRect(0, 0, 3, Hh);
    }

    const tex = new THREE.CanvasTexture(cvs);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / s.sx, 1 / s.sy);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.renderer) tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: s.rough });
    this._floorMats[kind] = m;
    return m;
  }

  /* ============================================================
   *  几何工具（y = 底面高度，除 blob / ring 明确说明外）
   * ============================================================ */
  _sh(o){ o.castShadow = true; o.receiveShadow = true; return o; }
  _mesh(geo, m){ return this._sh(new THREE.Mesh(geo, m)); }
  _box(w, h, d, m, x = 0, y = 0, z = 0){
    const o = this._mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y + h / 2, z); return o;
  }
  _rbox(w, h, d, m, x = 0, y = 0, z = 0, r = .04){
    const rr = Math.min(r, w / 2 - .001, h / 2 - .001, d / 2 - .001);
    const o = this._mesh(new RoundedBoxGeometry(w, h, d, 3, rr), m);
    o.position.set(x, y + h / 2, z); return o;
  }
  _cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 28){
    const o = this._mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    o.position.set(x, y + h / 2, z); return o;
  }
  _lathe(pts, m, x = 0, y = 0, z = 0, seg = 40){
    const o = this._mesh(new THREE.LatheGeometry(
      pts.map(([r, h]) => new THREE.Vector2(Math.max(r, 1e-4), h)), seg), m);
    o.position.set(x, y, z); return o;
  }
  _rod(a, b, r0, m, r1 = r0, seg = 12){
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const o = this._mesh(new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), seg), m);
    o.position.copy(A).add(B).multiplyScalar(.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
    return o;
  }
  _tube(pts, r, m, seg = 40){
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    return this._mesh(new THREE.TubeGeometry(curve, seg, r, 10), m);
  }
  _blob(rx, ry, rz, m, x = 0, y = 0, z = 0, seg = 24){
    const o = this._mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * .7)), m);
    o.scale.set(rx, ry, rz); o.position.set(x, y, z); return o;
  }
  _ring(R, r, m, x = 0, y = 0, z = 0){
    const o = this._mesh(new THREE.TorusGeometry(R, r, 10, 48), m);
    o.rotation.x = Math.PI / 2; o.position.set(x, y, z); return o;
  }
  _rrect(w, d, r){
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    r = Math.min(r, w / 2 - .001, d / 2 - .001);
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /** 中空圆角框（浴缸/水槽沿）：外 w×d、壁厚 t、高 h */
  _shell(w, d, h, t, r, m, x = 0, y = 0, z = 0){
    const s = this._rrect(w, d, r);
    s.holes.push(this._rrect(w - 2 * t, d - 2 * t, Math.max(.004, r - t)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 });
    geo.rotateX(-Math.PI / 2);
    const o = this._mesh(geo, m); o.position.set(x, y, z); return o;
  }
  /** 四条收分腿（椅子、桌子等） */
  _legs(g, w, d, h, m, inset = .05, r = .02){
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a, b]) =>
      g.add(this._rod(
        [a * (w / 2 - inset), 0, b * (d / 2 - inset)],
        [a * (w / 2 - inset), h, b * (d / 2 - inset)],
        r * .7, m, r)));
  }
  /** 拉手：y 为拉手中心，z 为门板正面 */
  _pull(g, len, vert, x, y, z){
    const m = this._mat('#b9b3a8', { metalness: .85, roughness: .3 }), o = new THREE.Group();
    o.add(vert ? this._box(.01, len, .01, m, 0, -len / 2, .028)
              : this._box(len, .01, .01, m, 0, -.005, .028));
    [-1, 1].forEach(s => o.add(vert
      ? this._box(.008, .008, .028, m, 0, s * (len / 2 - .015) - .004, .014)
      : this._box(.008, .008, .028, m, s * (len / 2 - .015), -.004, .014)));
    o.position.set(x, y, z); g.add(o);
  }
  _knob(g, x, y, z){
    const m = this._mat('#b9b3a8', { metalness: .85, roughness: .3 });
    const k = this._cyl(.011, .014, .02, m, x, y - .01, z + .01, 16);
    k.rotation.x = Math.PI / 2;
    g.add(k, this._blob(.014, .014, .008, m, x, y, z + .022, 12));
  }
  /**
   * 柜门/抽屉面板：x0..x0+w、y0..y0+h 区域内 nx 列 × ny 行。
   * z = 柜体正面；hd='bar' 金属拉手 | 'knob' 圆钮 | 'edge' 顶部隐形拉槽 | 'none'
   */
  _fronts(g, x0, y0, w, h, z, nx, ny, m, hd = 'bar', hy = null){
    const gap = .005, pw = w / nx, ph = h / ny, fz = z + .018;
    g.add(this._box(w, h, .002, this._mat('#2a2724', { roughness: .9 }), x0 + w / 2, y0, z + .001));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++){
      const cx = x0 + pw * (i + .5), yb = y0 + ph * j;
      const drawer = ph < .4 && pw >= ph;
      g.add(this._rbox(pw - gap, ph - gap, .018, m, cx, yb + gap / 2, z + .009, .003));
      if (hd === 'none') continue;
      if (hd === 'edge'){ g.add(this._box(pw - .05, .01, .006, this._mat('#3c3a37', { roughness: .6 }), cx, yb + ph - gap - .018, fz)); continue; }
      if (drawer){
        hd === 'knob' ? this._knob(g, cx, yb + ph / 2, fz)
                      : this._pull(g, Math.min(.3, pw * .45), false, cx, yb + ph / 2, fz);
        continue;
      }
      const len = Math.min(.45, ph * .35);
      const hx = nx === 1 ? cx + pw / 2 - .045 : (i % 2 ? cx - pw / 2 + .04 : cx + pw / 2 - .04);
      const y = Math.min(yb + ph - .05 - len / 2, Math.max(yb + .05 + len / 2, hy ?? yb + ph / 2));
      hd === 'knob' ? this._knob(g, hx, y, fz) : this._pull(g, len, true, hx, y, fz);
    }
  }
  _plate(g, r, x, y, z){
    g.add(this._lathe([[0, 0], [r * .6, 0], [r * .72, .008], [r, .02]],
      this._mat('#fbfbf9', { roughness: .12, side: THREE.DoubleSide }), x, y, z, 32));
  }
  _vase(g, x, y, z, r, h, c, R, flowers = true){
    const pts = [[0, 0], [r * .65, 0], [r, h * .32], [r * .92, h * .62], [r * .42, h * .86], [r * .5, h]];
    g.add(this._lathe(pts, this._mat(c, { roughness: .35, side: THREE.DoubleSide }), x, y, z, 32));
    if (!flowers) return;
    const cols = ['#f3e6d8', '#e8b4a0', '#f6d27a', '#ffffff'];
    for (let k = 0; k < 5; k++){
      const a = k * 1.26 + R() * .4, s = .03 + R() * .05;
      const top = [x + Math.cos(a) * s, y + h + .12 + R() * .14, z + Math.sin(a) * s];
      g.add(this._rod([x, y + h * .6, z], top, .003, this._mat('#6f8f4a', { roughness: .7 }), .003, 6),
            this._blob(.022, .018, .022, this._mat(cols[k % 4], { roughness: .8 }), ...top, 12));
    }
  }
  _tableLamp(g, x, y, z, s = 1){
    g.add(this._lathe([[0, 0], [.06 * s, 0], [.075 * s, .05 * s], [.08 * s, .12 * s], [.055 * s, .2 * s], [.018 * s, .25 * s], [.012 * s, .3 * s]],
      this._mat('#fbfbf9', { roughness: .3 }), x, y, z, 32));
    g.add(this._lathe([[.13 * s, 0], [.1 * s, .18 * s]],
      this._mat('#f6ecd9', { emissive: '#ffdca0', emissiveIntensity: .35, roughness: .9, side: THREE.DoubleSide }),
      x, y + .26 * s, z, 40),
      this._blob(.03 * s, .03 * s, .03 * s, this._mat('#fff', { emissive: '#ffe2b0', emissiveIntensity: 1, roughness: .6 }), x, y + .31 * s, z, 12));
  }

  /* ============================================================
   *  家具模型（局部坐标：原点在俯视中心、y=0 为底面，宽沿 X、深沿 Z）
   * ============================================================ */
  _furnMesh(type, w, d, color){
    const g = new THREE.Group();
    const M = this._mat(color, { roughness: .78 });
    const Md = this._mat(darken(color, .72), { roughness: .82 });
    const Ml = this._mat(lighten(color, .22), { roughness: .55 });
    const R = this._rng(Math.round(w * 1000) + Math.round(d * 1000) + (type.charCodeAt(0) || 0) * 7);

    const woodM = c => this._mat(c, { roughness: .55 });
    const fabric = c => this._mat(c, { roughness: .96 });
    const ceramic = (o = {}) => this._mat('#fbfbf9', { roughness: .12, ...o });
    const blackMetal = () => this._mat('#2b2b2d', { metalness: .6, roughness: .4 });
    const hwMat = () => this._mat('#b9b3a8', { metalness: .85, roughness: .3 });
    const chrome = () => this._mat('#eef0f2', { metalness: 1, roughness: .08 });
    const mirror = () => this._mat('#dfeaee', { metalness: .55, roughness: .06 });
    const screenMat = (glow = '#1a2636') => this._mat('#0b0e13', { roughness: .1, metalness: .3, emissive: glow, emissiveIntensity: .35 });
    const glowMat = (c = '#fff4dc', e = '#ffdca0', k = .5) => this._mat(c, { emissive: e, emissiveIntensity: k, roughness: .9, side: THREE.DoubleSide });
    const bz = -d / 2;

    switch (type){
      /* ---------- 卧室 ---------- */
      case 'bed': {
        const fr = woodM('#8d7258'), fab = fabric(color);
        const fh = .3, mt = .22, top = fh + mt, n = Math.max(3, Math.round(w / .28)), sw = (w - .04) / n;
        g.add(this._box(w - .12, .06, d - .14, this._mat('#4a3e33', { roughness: .7 }), 0, 0, .03));
        g.add(this._rbox(w, fh - .06, d - .08, fr, 0, .06, .04, .015));
        g.add(this._rbox(w, 1.08, .06, fr, 0, 0, bz + .03, .012));
        for (let i = 0; i < n; i++)
          g.add(this._rbox(sw - .006, .62, .06, fabric(darken(color, .8)), -w / 2 + .02 + sw * (i + .5), .42, bz + .08, .025));
        const md = d - .13, dd = md * .66, dz = d / 2 - .015 - dd / 2;
        g.add(this._rbox(w - .06, mt, md, this._mat('#f6f3ee', { roughness: .35 }), 0, fh, bz + .11 + md / 2, .07));
        g.add(this._rbox(w + .02, .27, dd, fab, 0, top - .2, dz, .04),
              this._rbox(w + .024, .06, .22, fabric('#fbfaf7'), 0, top + .025, dz - dd / 2 + .11, .025));
        g.add(this._rbox(w + .05, .285, .42, fabric(darken(color, .62)), 0, top - .205, d / 2 - .35, .03));
        const np = w >= 1.3 ? 2 : 1, pw = (w - .16 - (np - 1) * .06) / np;
        for (let i = 0; i < np; i++){
          const x = -w / 2 + .08 + pw / 2 + i * (pw + .06);
          const p1 = this._rbox(pw, .15, .42, fabric('#ffffff'), x, top - .01, bz + .34, .07); p1.rotation.x = -.28;
          const p2 = this._rbox(pw * .62, .3, .1, fabric(i ? '#efe7da' : darken(color, .7)), x, top, bz + .54, .045); p2.rotation.x = -.3;
          g.add(p1, p2);
        }
        break;
      }
      case 'crib': {
        const wm = woodM(color);
        g.add(this._rbox(w - .09, .12, d - .09, fabric('#ffffff'), 0, .3, 0, .04),
              this._box(w - .06, .025, d - .06, wm, 0, .28));
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a, b]) =>
          g.add(this._rbox(.045, .95, .045, wm, a * (w / 2 - .022), 0, b * (d / 2 - .022), .008),
                this._blob(.028, .028, .028, wm, a * (w / 2 - .022), .97, b * (d / 2 - .022), 14)));
        [-1, 1].forEach(s => {
          const z = s * (d / 2 - .022), x = s * (w / 2 - .022);
          g.add(this._rbox(w - .05, .035, .03, wm, 0, .88, z, .008),
                this._rbox(w - .05, .035, .03, wm, 0, .25, z, .008),
                this._rbox(.03, .035, d - .05, wm, x, .88, 0, .008),
                this._rbox(.03, .035, d - .05, wm, x, .25, 0, .008));
          for (let p = -w / 2 + .09; p < w / 2 - .05; p += .075)
            g.add(this._rod([p, .28, z], [p, .88, z], .009, wm, .009, 8));
          for (let p = -d / 2 + .09; p < d / 2 - .05; p += .075)
            g.add(this._rod([x, .28, p], [x, .88, p], .009, wm, .009, 8));
        });
        g.add(this._rbox(w * .5, .03, d - .14, fabric('#f3d9c9'), w * .12, .42, 0, .015),
              this._rbox(.3, .06, .2, fabric('#fbfaf7'), -w / 2 + .22, .42, 0, .03));
        const bx = -w * .3 + .1, bear = '#c9a27a';
        g.add(this._blob(.05, .06, .045, this._mat(bear, { roughness: .95 }), bx, .5, .12),
              this._blob(.045, .042, .04, this._mat(bear, { roughness: .95 }), bx, .59, .12),
              this._blob(.016, .016, .01, this._mat(bear, { roughness: .95 }), bx - .032, .625, .12),
              this._blob(.016, .016, .01, this._mat(bear, { roughness: .95 }), bx + .032, .625, .12));
        break;
      }
      case 'nightstand': {
        const wm = woodM(color);
        this._legs(g, w, d, .1, woodM('#5a4a3b'), .04, .014);
        g.add(this._rbox(w, .4, d - .02, wm, 0, .1, -.01, .012));
        this._fronts(g, -w / 2 + .02, .12, w - .04, .36, d / 2 - .02, 1, 2, wm, 'bar');
        this._tableLamp(g, -w * .12, .5, -d * .12);
        g.add(this._box(.16, .025, .22, this._mat('#2f5d62', { roughness: .5 }), w * .24, .5, .04),
              this._box(.14, .02, .2, this._mat('#e6dccd', { roughness: .7 }), w * .24, .525, .04));
        break;
      }
      case 'wardrobe': {
        const cm = this._mat(color, { roughness: .55 }), h = 2.2, fz = d / 2 - .02, n = Math.max(1, Math.round(w / .5));
        g.add(this._box(w - .02, .08, d - .06, this._mat('#4a4641', { roughness: .7 }), 0, 0, -.03),
              this._box(w, h - .08, d - .02, cm, 0, .08, -.01));
        this._fronts(g, -w / 2, .08, w, h - .1, fz, n, 1, cm, 'bar', 1.05);
        g.add(this._box(w, .02, d - .02, this._mat(darken(color, .9), { roughness: .5 }), 0, h - .02, -.01));
        break;
      }
      case 'dresser': {
        const wm = woodM(color), r = Math.min(.34, w * .3);
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a, b]) =>
          g.add(this._rod([a * (w / 2 - .04), 0, b * (d / 2 - .04)], [a * (w / 2 - .05), .58, b * (d / 2 - .05)], .012, wm, .02)));
        g.add(this._box(w - .04, .14, d - .04, wm, 0, .58), this._rbox(w, .03, d, wm, 0, .72, 0, .008));
        this._fronts(g, -w / 2 + .03, .585, w - .06, .13, d / 2 - .02, 2, 1, wm, 'knob');
        const mr = this._mesh(new THREE.TorusGeometry(r, .018, 12, 64), woodM(darken(color, .7)));
        mr.position.set(0, .77 + r, bz + .04); g.add(mr);
        const mg = new THREE.Mesh(new THREE.CircleGeometry(r, 64), mirror());
        mg.position.set(0, .77 + r, bz + .035); g.add(mg);
        g.add(this._box(.08, .03, .06, woodM(darken(color, .7)), 0, .75, bz + .04));
        [['#e7c9b5', .03, .09], ['#b9d0d8', .025, .12], ['#f0e3cf', .02, .07]].forEach(([cc, rr, hh], i) =>
          g.add(this._cyl(rr, rr, hh, this._mat(cc, { roughness: .15, transparent: true, opacity: .8 }), w * .25 + i * .06, .75, .02)));
        g.add(this._rbox(.16, .06, .1, woodM('#6b543f'), -w * .28, .75, .03, .01));
        const sz = d / 2 + .25;
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a, b]) =>
          g.add(this._rod([a * .13, 0, sz + b * .13], [a * .12, .4, sz + b * .12], .01, wm, .014)));
        g.add(this._rbox(.34, .08, .34, fabric('#e8ddd0'), 0, .4, sz, .035));
        break;
      }
      case 'desk': {
        const tm = woodM(color), bm = blackMetal();
        g.add(this._rbox(w, .025, d, tm, 0, .72, 0, .006));
        [-1, 1].forEach(s => {
          const x = s * (w / 2 - .06);
          g.add(this._box(.03, .72, .03, bm, x, 0, d / 2 - .06),
                this._box(.03, .72, .03, bm, x, 0, bz + .06),
                this._box(.03, .03, d - .1, bm, x, 0, 0),
                this._box(.03, .03, d - .1, bm, x, .69, 0));
        });
        g.add(this._box(w - .12, .04, .015, bm, 0, .66, bz + .06),
              this._box(.4, .09, d - .12, tm, w / 2 - .32, .63, 0));
        this._pull(g, .16, false, w / 2 - .32, .675, d / 2 - .06);
        const my = .745, mz = bz + .15;
        g.add(this._rbox(.22, .012, .16, bm, 0, my, mz, .004),
              this._rod([0, my, mz - .02], [0, my + .2, mz - .03], .012, bm));
        g.add(this._rbox(.62, .37, .02, this._mat('#1d1d1f', { roughness: .5 }), 0, my + .12, mz - .04, .006),
              this._box(.6, .33, .002, screenMat('#27405c'), 0, my + .15, mz - .029));
        g.add(this._rbox(.42, .015, .13, this._mat('#e8e8ea', { roughness: .5 }), 0, my, .06, .004),
              this._rbox(.4, .004, .11, this._mat('#d2d2d6', { roughness: .5 }), 0, my + .014, .06, .002),
              this._blob(.03, .015, .05, this._mat('#e8e8ea', { roughness: .5 }), .3, my + .012, .07, 16));
        const lx = -w / 2 + .15, lz = bz + .12;
        g.add(this._cyl(.07, .075, .02, bm, lx, my, lz, 28),
              this._tube([[lx, my + .02, lz], [lx, my + .3, lz + .03], [lx + .12, my + .42, lz + .1]], .008, bm));
        g.add(this._cyl(.04, .038, .09, ceramic({ roughness: .3 }), w / 2 - .15, my, .05, 20),
              this._rbox(.2, .015, .28, this._mat('#3b5566', { roughness: .7 }), -w / 2 + .3, my, .1, .004));
        break;
      }
      case 'chair': {
        const lw = woodM('#6b543f'), fab = fabric(color), sy = .44;
        [-1, 1].forEach(s => g.add(this._rod([s * (w / 2 - .04), 0, d / 2 - .05], [s * (w / 2 - .05), sy, d / 2 - .07], .012, lw, .018)));
        [-1, 1].forEach(s => g.add(this._rod([s * (w / 2 - .04), 0, bz + .03], [s * (w / 2 - .05), .86, bz + .07], .012, lw, .018)));
        g.add(this._box(w - .08, .025, .02, lw, 0, .15, d / 2 - .06),
              this._box(w - .08, .025, .02, lw, 0, .15, bz + .05));
        [-1, 1].forEach(s => g.add(this._box(.02, .025, d - .12, lw, s * (w / 2 - .045), .18, 0)));
        g.add(this._box(w - .06, .04, d - .1, lw, 0, sy - .03, 0),
              this._rbox(w - .04, .05, d - .08, fab, 0, sy, .005, .022));
        const b1 = this._rbox(w - .08, .15, .025, lw, 0, .66, bz + .065, .012); b1.rotation.x = -.12;
        const b2 = this._box(w - .08, .025, .02, lw, 0, .52, bz + .055); b2.rotation.x = -.12;
        g.add(b1, b2);
        break;
      }
      case 'bookshelf': {
        const h = 1.8, t = .022, ns = 5, wm = woodM(color), sh0 = (h - .06 - t) / ns;
        const cols = ['#b88a6a', '#6f8f8a', '#d9c08c', '#9aa58c', '#a8675e', '#e6dccd', '#7d8ea3', '#c9bfae'];
        g.add(this._box(w, h, .012, woodM(darken(color, .85)), 0, 0, bz + .006),
              this._box(t, h, d, wm, -w / 2 + t / 2),
              this._box(t, h, d, wm, w / 2 - t / 2),
              this._box(w - 2 * t, .06, d - .03, wm, 0, 0, 0));
        for (let s = 0; s <= ns; s++){
          const y = s < ns ? .06 + s * sh0 : h - t;
          g.add(this._box(w - 2 * t, t, d - .012, wm, 0, y, .006));
          if (s === ns) break;
          const yb = y + t, end = w / 2 - t - .01; let x = -w / 2 + t + .01;
          const deco = R() < .55 ? x + R() * (w - .45) : 99;
          while (x < end - .03){
            if (x >= deco){
              if (R() < .5) this._vase(g, x + .07, yb, 0, .045, .16, cols[Math.floor(R() * 8)], R, false);
              else for (let k = 0; k < 3; k++)
                g.add(this._box(.2 - k * .02, .028, d * .7, this._mat(cols[Math.floor(R() * 8)], { roughness: .8 }), x + .1, yb + k * .028, .01));
              x += .2; continue;
            }
            if (R() < .07){ x += .03 + R() * .05; continue; }
            const bw = .018 + R() * .03, bh = Math.min(sh0 - t - .03, .17 + R() * .13), bd = d * (.62 + R() * .22);
            if (x + bw > end) break;
            g.add(this._box(bw, bh, bd, this._mat(cols[Math.floor(R() * 8)], { roughness: .75 }), x + bw / 2, yb, d / 2 - .015 - bd / 2));
            x += bw + .002;
          }
        }
        break;
      }
      case 'baycushion': {
        g.add(this._rbox(w, .08, d, fabric(color), 0, .45, 0, .03));
        const b1 = this._rbox(w - .1, .34, .14, fabric('#ffffff'), 0, .52, bz + .14, .06); b1.rotation.x = .25;
        const b2 = this._rbox(w - .1, .34, .14, fabric('#f0e6d6'), 0, .52, d / 2 - .14, .06); b2.rotation.x = -.25;
        g.add(b1, b2,
              this._rbox(w * .8, .04, .3, fabric(darken(color, .7)), 0, .53, d * .12, .02),
              this._rbox(.28, .015, .2, woodM('#8d7258'), 0, .53, -d * .15, .006),
              this._cyl(.035, .03, .06, ceramic(), 0, .545, -d * .15, 20));
        break;
      }

      /* ---------- 客厅 ---------- */
      case 'sofa': case 'armchair': {
        const fab = fabric(color), dk = fabric(darken(color, .88));
        const a = Math.min(.18, w * .14), n = type === 'armchair' ? 1 : (w > 2.2 ? 3 : 2), cw = (w - 2 * a) / n;
        const bd = Math.min(.2, d * .24), lh = .12, sd = d - bd - .02;
        this._legs(g, w, d, lh, woodM('#3a3027'), .07, .018);
        g.add(this._rbox(w, .16, d, dk, 0, lh, 0, .03), this._rbox(w, .73, bd, dk, 0, lh, bz + bd / 2, .06));
        [-1, 1].forEach(s => g.add(this._rbox(a, .5, d, dk, s * (w / 2 - a / 2), lh, 0, .07)));
        for (let i = 0; i < n; i++){
          const x = -w / 2 + a + cw / 2 + i * cw;
          const c1 = this._rbox(cw - .012, .15, sd, fab, x, lh + .16, bz + bd + sd / 2, .055);
          const c2 = this._rbox(cw - .03, .44, .16, fab, x, lh + .3, bz + bd + .08, .07); c2.rotation.x = -.16;
          g.add(c1, c2);
        }
        if (n > 1) [-1, 1].forEach(s => {
          const p = this._rbox(.42, .42, .12, fabric(s < 0 ? '#ece5d8' : darken(color, .7)), s * (w / 2 - a - .26), lh + .32, bz + bd + .22, .06);
          p.rotation.set(-.3, s * -.25, 0); g.add(p);
        });
        else {
          const p = this._rbox(.4, .26, .1, fabric('#ece5d8'), 0, lh + .33, bz + bd + .2, .05); p.rotation.x = -.25; g.add(p);
        }
        break;
      }
      case 'cornersofa': {
        const k = Math.min(.95, d * .56, w * .4), b = .2, fab = fabric(color), dk = fabric(darken(color, .88)), lh = .1, sw = (w - b - .2) / 2;
        [[-w/2+.07, bz+.07], [w/2-.07, bz+.07], [w/2-.07, bz+k-.07], [-w/2+.07, d/2-.07], [-w/2+k-.07, d/2-.07], [-w/2+k-.07, bz+k-.07]]
          .forEach(([x, z]) => g.add(this._rod([x, 0, z], [x, lh, z], .012, woodM('#3a3027'), .018)));
        g.add(this._rbox(w, .18, k, dk, 0, lh, bz + k / 2, .03),
              this._rbox(k, .18, d - k + .02, dk, -w / 2 + k / 2, lh, bz + k + (d - k) / 2 - .01, .03),
              this._rbox(w, .72, b, dk, 0, lh, bz + b / 2, .06),
              this._rbox(b, .72, d, dk, -w / 2 + b / 2, lh, 0, .06),
              this._rbox(.2, .5, k, dk, w / 2 - .1, lh, bz + k / 2, .07),
              this._rbox(k, .5, .2, dk, -w / 2 + k / 2, lh, d / 2 - .1, .07));
        for (let i = 0; i < 2; i++){
          const x = -w / 2 + b + sw / 2 + i * sw;
          const c1 = this._rbox(sw - .012, .15, k - b - .02, fab, x, lh + .18, bz + b + (k - b) / 2, .055);
          const c2 = this._rbox(sw - .04, .42, .16, fab, x, lh + .3, bz + b + .07, .07); c2.rotation.x = -.16;
          g.add(c1, c2);
        }
        g.add(this._rbox(k - b - .02, .15, d - k - .22, fab, -w / 2 + b + (k - b) / 2, lh + .18, bz + k + (d - k - .2) / 2, .055));
        const L = d - .2 - b - .18, nl = Math.max(1, Math.round(L / .75));
        for (let i = 0; i < nl; i++){
          const p = this._rbox(.16, .42, L / nl - .03, fab, -w / 2 + b + .07, lh + .3, bz + b + .18 + L / nl * (i + .5), .07);
          p.rotation.z = .16; g.add(p);
        }
        break;
      }
      case 'beanbag': {
        const fab = fabric(color);
        g.add(this._blob(w * .5, .3, d * .5, fab, 0, .3, 0, 40),
              this._blob(w * .42, .22, d * .22, fab, 0, .5, bz + d * .26, 32));
        break;
      }
      case 'coffeetable': {
        const tm = this._mat(color, { roughness: .35 }), lw = woodM('#3a3027');
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a, b]) =>
          g.add(this._rod([a * (w / 2 - .05), 0, b * (d / 2 - .05)], [a * (w / 2 - .07), .365, b * (d / 2 - .07)], .012, lw, .02)));
        g.add(this._rbox(w, .035, d, tm, 0, .365, 0, .015),
              this._rbox(w - .12, .02, d - .12, woodM(darken(color, .85)), 0, .12, 0, .006),
              this._box(.3, .03, .22, this._mat('#2f5d62', { roughness: .5 }), w * .2, .14, 0),
              this._box(.26, .025, .19, this._mat('#d9b36c', { roughness: .6 }), w * .2, .17, .01),
              this._rbox(.38, .015, .24, woodM('#6b543f'), -w * .2, .4, 0, .006),
              this._box(.22, .025, .16, this._mat('#e6dccd', { roughness: .7 }), -w * .22, .415, 0));
        g.add(this._lathe([[0, 0], [.025, 0], [.035, .07], [.034, .08]], ceramic({ side: THREE.DoubleSide }), -w * .12, .415, .06, 20));
        this._vase(g, w * .24, .4, -.05, .055, .18, '#e9e2d6', R);
        break;
      }
      case 'sidetable': {
        const r = Math.min(w, d) / 2, bm = blackMetal();
        g.add(this._lathe([[r * .55, 0], [r * .55, .012], [.03, .035], [.018, .3], [.025, .5], [.08, .52]], bm, 0, 0, 0, 40),
              this._cyl(r, r * .98, .025, this._mat(color, { roughness: .35 }), 0, .52, 0, 48),
              this._box(.16, .02, .12, this._mat('#4f6b8a', { roughness: .7 }), -r * .25, .545, 0));
        this._vase(g, r * .35, .545, -r * .1, .035, .12, '#e9e2d6', R, false);
        break;
      }
      case 'tvstand': {
        const sm = this._mat(color, { roughness: .5 }), n = Math.max(2, Math.round(w / .6));
        this._legs(g, w, d, .1, blackMetal(), .08, .012);
        g.add(this._rbox(w, .4, d - .02, sm, 0, .1, -.01, .01));
        this._fronts(g, -w / 2 + .005, .105, w - .01, .39, d / 2 - .02, n, 1, sm, 'edge');
        g.add(this._rbox(1.45, .84, .025, this._mat('#18181a', { roughness: .4, metalness: .3 }), 0, .95, bz + .03, .004),
              this._box(1.43, .81, .002, screenMat(), 0, .962, bz + .0435),
              this._rbox(.9, .06, .09, this._mat('#2a2a2c', { roughness: .7 }), 0, .5, -.02, .02),
              this._box(.86, .045, .002, fabric('#3a3a3c'), 0, .507, .026));
        this._vase(g, w / 2 - .25, .5, 0, .06, .26, '#d8cfc2', R);
        break;
      }
      case 'rug':
        [[w, d, .01, color, 0], [w - .16, d - .16, .002, darken(color, .82), .01], [w - .26, d - .26, .002, lighten(color, .12), .0115]]
          .forEach(([a, b, h, cc, y]) => {
            const r = this._box(a, h, b, this._mat(cc, { roughness: 1 }), 0, y + .002);
            r.castShadow = false; g.add(r);
          });
        break;
      case 'plant': {
        const r = Math.min(w, d) / 2, H = .9 + r * 1.6;
        const pot = this._mat('#d9d2c5', { roughness: .6 });
        const lm = [this._mat('#5f8f4e', { roughness: .6, side: THREE.DoubleSide }), this._mat('#79a862', { roughness: .6, side: THREE.DoubleSide })];
        g.add(this._lathe([[0, 0], [r * .4, 0], [r * .44, .02], [r * .54, .36], [r * .57, .4], [r * .52, .4], [r * .5, .37], [0, .37]], pot, 0, 0, 0, 36),
              this._cyl(r * .49, r * .49, .005, this._mat('#4a3a2c', { roughness: .9 }), 0, .368, 0, 28));
        g.add(this._rod([0, .37, 0], [.02, H * .62, -.01], .016, this._mat('#6b5540', { roughness: .8 }), .009));
        const N = 20 + Math.round(r * 36), sc = Math.sqrt(r / .25);
        for (let k = 0; k < N; k++){
          const t = k / N, a = k * 2.399 + R() * .3;
          const len = (.14 + R() * .08) * (1.1 - t * .4) * sc, s0 = .03 + R() * .08 * sc;
          const p = new THREE.Group();
          p.position.set(0, H * (.42 + .58 * t), 0);
          p.rotation.set(0, -a, .1 + t * .5 + R() * .3, 'YXZ');
          const lf = this._blob(len / 2, .005, len * .27, lm[k % 2], s0 + len / 2, 0, 0, 16); lf.rotation.z = -.3;
          p.add(this._box(s0, .005, .005, this._mat('#6f8f4a', { roughness: .7 }), s0 / 2, 0, 0), lf);
          g.add(p);
        }
        break;
      }
      case 'floorlamp': {
        const r = Math.min(w, d) / 2, lm = this._mat(color, { roughness: .35, metalness: .5 });
        g.add(this._lathe([[0, 0], [r * .55, 0], [r * .58, .012], [r * .5, .03], [.02, .035]], lm, 0, 0, 0, 40),
              this._rod([0, .03, 0], [0, 1.36, 0], .011, lm));
        g.add(this._lathe([[r * .85, 0], [r * .55, .36]], glowMat('#f6ecd9', '#ffdca0', .45), 0, 1.22, 0, 48),
              this._blob(.035, .035, .035, glowMat('#fff', '#ffe2b0', 1.2), 0, 1.36, 0, 12),
              this._ring(r * .85, .004, lm, 0, 1.22, 0),
              this._ring(r * .55, .004, lm, 0, 1.58, 0));
        break;
      }

      /* ---------- 餐厨 ---------- */
      case 'table': {
        const tm = this._mat(color, { roughness: .4 }), lw = woodM(darken(color, .55));
        const ns = Math.max(1, Math.round(w / .62)), top = .75;
        [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a, b]) =>
          g.add(this._rod([a * (w / 2 - .08), 0, b * (d / 2 - .08)], [a * (w / 2 - .1), .715, b * (d / 2 - .1)], .016, lw, .026)));
        g.add(this._rbox(w, .035, d, tm, 0, .715, 0, .012),
              this._box(w - .22, .07, d - .22, lw, 0, .645),
              this._box(w * .7, .003, .32, fabric('#b9a58c'), 0, top, 0));
        for (let i = 0; i < ns; i++) [-1, 1].forEach(s => {
          const x = -w / 2 + w / ns * (i + .5), z = s * (d / 2 - .17);
          g.add(this._box(.38, .003, .28, fabric('#e7dfd1'), x, top, z));
          this._plate(g, .12, x, top + .003, z);
          g.add(this._cyl(.03, .026, .1, this._mat('#dfeef3', { transparent: true, opacity: .35, roughness: .05 }), x + .15, top + .003, z - s * .1, 16));
        });
        this._vase(g, 0, top + .003, 0, .06, .2, '#e9e2d6', R);
        break;
      }
      case 'roundtable': {
        const b = Math.min(.25, w * .3), lw = woodM('#4a3e33'), top = .75;
        g.add(this._lathe([[b, 0], [b, .015], [b * .8, .035], [.06, .12], [.045, .35], [.05, .6], [.12, .69], [.18, .715]], lw, 0, 0, 0, 40),
              this._cyl(w / 2, w / 2, .035, this._mat(color, { roughness: .4 }), 0, .715, 0, 64));
        for (let k = 0; k < 4; k++){
          const a = k * Math.PI / 2 + .4, rr = w / 2 - .17;
          this._plate(g, .11, Math.cos(a) * rr, top, Math.sin(a) * rr);
        }
        this._vase(g, 0, top, 0, .05, .18, '#e9e2d6', R);
        break;
      }
      case 'counter': {
        const cm = this._mat(color, { roughness: .45 }), stone = this._mat('#dcd7cf', { roughness: .22 });
        const n = Math.max(1, Math.round(w / .6)), fz = d / 2 - .04;
        g.add(this._box(w - .01, .1, d - .1, this._mat('#4a4641', { roughness: .7 }), 0, 0, -.05),
              this._box(w, .72, d - .04, cm, 0, .1, -.02));
        this._fronts(g, -w / 2, .64, w, .18, fz, n, 1, cm, 'bar');
        this._fronts(g, -w / 2, .1, w, .54, fz, n, 1, cm, 'bar', .56);
        g.add(this._rbox(w + .01, .04, d, stone, 0, .82, 0, .004),
              this._box(w, .62, .01, this._mat('#efece6', { roughness: .3 }), 0, .86, bz + .005));
        g.add(this._box(w, .7, .33, cm, 0, 1.48, bz + .165));
        this._fronts(g, -w / 2, 1.48, w, .7, bz + .33, n, 1, cm, 'bar', 1.56);
        g.add(this._box(w - .04, .01, .02, glowMat('#fff7e6', '#ffe9c4', .8), 0, 1.47, bz + .29));
        if (w >= .8){
          g.add(this._rbox(.36, .018, .25, woodM('#c9a27a'), -w / 2 + .3, .86, 0, .005));
          [.07, .06, .05].forEach((r, i) =>
            g.add(this._cyl(r, r, .16 - i * .03, this._mat(['#e9e2d6', '#d6cfc3', '#bfb6a8'][i], { roughness: .4 }), w / 2 - .15 - i * .15, .86, bz + .1, 24)));
          g.add(this._cyl(.05, .045, .14, ceramic({ roughness: .3 }), w / 2 - .6, .86, bz + .1, 20));
          for (let k = 0; k < 4; k++)
            g.add(this._rod([w / 2 - .6, .9, bz + .1], [w / 2 - .6 + (k - 1.5) * .018, 1.1, bz + .1 + (k % 2 - .5) * .02], .005, woodM('#8d7258'), .006, 6));
        }
        break;
      }
      case 'stove': {
        const sm = this._mat('#b9bec3', { metalness: .8, roughness: .3 });
        g.add(this._rbox(w, .012, d, this._mat('#0d0d0e', { roughness: .06, metalness: .3 }), 0, .862, 0, .004));
        (w / d > 1.4 ? [[-w/4, 0], [w/4, 0]] : [[-w/4,-d/4],[w/4,-d/4],[-w/4,d/4],[w/4,d/4]]).forEach(([x, z]) => {
          g.add(this._cyl(.085, .09, .008, this._mat('#2b2b2b', { roughness: .4 }), x, .874, z, 32),
                this._cyl(.045, .05, .014, this._mat('#6b5a45', { metalness: .7, roughness: .35 }), x, .874, z, 28),
                this._cyl(.028, .028, .022, this._mat('#1a1a1a', { roughness: .5 }), x, .874, z, 20));
          for (let k = 0; k < 5; k++){
            const a = k * Math.PI * 2 / 5;
            g.add(this._box(.07, .014, .012, this._mat('#1c1c1c', { roughness: .6 }), x + Math.cos(a) * .1, .874, z + Math.sin(a) * .1));
          }
          g.add(this._cyl(.02, .022, .018, this._mat('#222', { roughness: .5 }), x, .874, d / 2 - .04, 20));
        });
        g.add(this._rbox(w, .06, .5, sm, 0, 1.55, bz + .25, .01),
              this._box(.3, .72, .26, sm, 0, 1.61, bz + .13));
        const scr = this._box(w - .02, .3, .008, this._mat('#15181b', { roughness: .05, metalness: .5 }), 0, 1.58, bz + .38);
        scr.rotation.x = -.9;
        g.add(scr, this._box(.16, .012, .003, this._mat('#101214', { emissive: '#6fd0ff', emissiveIntensity: .6, roughness: .5 }), 0, 1.575, bz + .502));
        break;
      }
      case 'ksink': {
        const st = this._mat('#c7ccd1', { metalness: .85, roughness: .28 });
        const inner = this._mat('#9aa1a8', { metalness: .8, roughness: .35 });
        const two = w >= .75, bw = two ? w * .42 : w * .7, bd = d * .66;
        g.add(this._box(w, .008, d, st, 0, .862, 0));
        (two ? [-w*.23, w*.23] : [0]).forEach(x => g.add(
          this._shell(bw, bd, .02, .015, .04, st, x, .862, .03),
          this._box(bw - .03, .002, bd - .03, inner, x, .87, .03),
          this._cyl(.03, .03, .003, chrome(), x, .872, .03, 20)));
        const fx = two ? 0 : w * .3, cm = chrome();
        g.add(this._cyl(.025, .028, .03, cm, fx, .87, bz + .06, 20),
              this._tube([[fx, .9, bz + .06], [fx, 1.12, bz + .06], [fx, 1.17, bz + .1], [fx, 1.14, bz + .18], [fx, 1.08, bz + .2]], .012, cm));
        break;
      }
      case 'fridge': {
        const fm = this._mat(color, { metalness: .45, roughness: .28 }), h = 1.8, fz = d / 2 - .05;
        g.add(this._box(w - .02, .06, d - .06, this._mat('#2a2c2e', { roughness: .5 }), 0, 0, -.03),
              this._rbox(w, h - .06, d - .05, fm, 0, .06, -.025, .02),
              this._box(w - .01, h - .07, .003, this._mat('#2a2c2e', { roughness: .5 }), 0, .065, fz + .0015));
        if (w > .85){
          [-1, 1].forEach(s => {
            g.add(this._rbox(w / 2 - .004, h - .08, .04, fm, s * w / 4, .07, fz + .023, .012));
            this._pull(g, .8, true, s * .035, 1.05, fz + .043);
          });
          g.add(this._box(.1, .14, .003, screenMat('#2a6f8f'), -w / 4, 1.25, fz + .044));
        } else {
          g.add(this._rbox(w - .006, 1.06, .04, fm, 0, .72, fz + .023, .012),
                this._rbox(w - .006, .64, .04, fm, 0, .07, fz + .023, .012));
          this._pull(g, .5, true, -w / 2 + .06, 1.05, fz + .043);
          this._pull(g, w * .5, false, 0, .64, fz + .043);
          g.add(this._box(.08, .1, .003, screenMat('#2a6f8f'), w * .22, 1.4, fz + .044));
        }
        break;
      }
      case 'cabinet': case 'shoecab': {
        const cm = this._mat(color, { roughness: .55 }), fz = d / 2 - .02;
        if (type === 'shoecab'){
          const h = 1.0, y0 = .16, n = Math.max(1, Math.round(w / .45));
          g.add(this._box(w, h - y0, d - .02, cm, 0, y0, -.01),
                this._box(w - .04, .01, .03, glowMat('#fff7e6', '#ffe9c4', .8), 0, y0 - .01, fz - .06));
          this._fronts(g, -w / 2, y0, w, h - y0, fz, n, 1, cm, 'edge');
          g.add(this._rbox(w + .01, .025, d, woodM(darken(color, .8)), 0, h, 0, .006),
                this._rbox(.22, .015, .14, woodM('#6b543f'), -w * .25, h + .025, 0, .006));
          this._vase(g, w * .28, h + .025, -.03, .05, .2, '#d8cfc2', R);
        } else {
          const h = .85, n = Math.max(1, Math.round(w / .5));
          this._legs(g, w, d, .1, woodM('#3a3027'), .05, .016);
          g.add(this._box(w, h - .13, d - .02, cm, 0, .1, -.01));
          this._fronts(g, -w / 2, .62, w, .2, fz, n, 1, cm, 'bar');
          this._fronts(g, -w / 2, .1, w, .52, fz, n, 1, cm, 'bar', .52);
          g.add(this._rbox(w + .02, .03, d + .01, woodM(darken(color, .78)), 0, h - .03, 0, .008));
          this._vase(g, w * .3, h, 0, .07, .24, '#e9e2d6', R);
        }
        break;
      }
      case 'island': {
        const cm = this._mat(color, { roughness: .45 }), stone = this._mat('#dcd7cf', { roughness: .2 });
        const cd = d - .3, n = Math.max(1, Math.round((w - .1) / .6));
        const cab = new THREE.Group(), fz = cd / 2 - .03;
        cab.add(this._box(w - .12, .1, cd - .08, this._mat('#4a4641', { roughness: .7 }), 0, 0, -.04),
                this._box(w - .1, .74, cd - .03, cm, 0, .1, -.015));
        this._fronts(cab, -w / 2 + .05, .64, w - .1, .2, fz, n, 1, cm, 'bar');
        this._fronts(cab, -w / 2 + .05, .1, w - .1, .54, fz, n, 1, cm, 'bar', .56);
        cab.rotation.y = Math.PI; cab.position.z = bz + cd / 2; g.add(cab);
        g.add(this._rbox(w, .05, d, stone, 0, .84, 0, .006));
        [-1, 1].forEach(s => g.add(this._box(.04, .84, d, stone, s * (w / 2 - .02), 0, 0)));
        g.add(this._lathe([[0, 0], [.06, 0], [.14, .06], [.15, .07]],
          this._mat('#6b543f', { roughness: .5, side: THREE.DoubleSide }), w * .22, .89, 0, 32));
        for (let k = 0; k < 4; k++)
          g.add(this._blob(.04, .04, .04, this._mat(['#d98c4a', '#9fbf5a', '#b5463a', '#e6c14f'][k], { roughness: .8 }),
            w * .22 + Math.cos(k * 1.6) * .05, .935 + (k === 3 ? .04 : 0), Math.sin(k * 1.6) * .05, 14));
        this._vase(g, -w * .25, .89, -.05, .05, .22, '#e9e2d6', R);
        break;
      }
      case 'barstool': {
        const r = Math.min(w, d) / 2, bm = blackMetal(), sy = .7;
        [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([a, b]) =>
          g.add(this._rod([a * r * .72, 0, b * r * .72], [a * r * .4, sy, b * r * .4], .011, bm)));
        g.add(this._ring(Math.SQRT2 * r * (.72 - .32 * .4), .008, bm, 0, .28, 0),
              this._cyl(r * .55, r * .55, .02, bm, 0, sy - .01, 0, 32),
              this._lathe([[0, 0], [r * .85, 0], [r * .95, .02], [r * .97, .045], [r * .9, .07], [0, .075]], this._mat(color, { roughness: .6 }), 0, sy, 0, 40));
        break;
      }

      /* ---------- 卫浴 ---------- */
      case 'toilet': {
        const cer = ceramic(), Rb = w * .45, zc = bz + d * .62, kz = (d * .37) / Rb, cm = chrome();
        g.add(this._rbox(w * .88, .4, d * .24, cer, 0, .36, bz + d * .12, .04),
              this._rbox(w * .92, .03, d * .27, cer, 0, .76, bz + d * .135, .012),
              this._cyl(.022, .022, .006, cm, 0, .79, bz + d * .135, 20));
        const ped = this._lathe([[0, 0], [Rb * .62, 0], [Rb * .66, .02], [Rb * .56, .12], [Rb * .62, .22], [Rb * .92, .33], [Rb, .37]], cer, 0, 0, zc, 40);
        const seat = this._cyl(Rb * 1.01, Rb * 1.01, .022, this._mat('#f4f4f2', { roughness: .2 }), 0, .37, zc, 40);
        const lid = this._cyl(Rb * .97, Rb * .99, .02, this._mat('#f4f4f2', { roughness: .2 }), 0, .392, zc, 40);
        ped.scale.z = seat.scale.z = lid.scale.z = kz;
        g.add(ped, seat, lid);
        [-1, 1].forEach(s => g.add(this._box(.03, .02, .03, cm, s * w * .18, .39, zc - Rb * kz - .005)));
        break;
      }
      case 'vanity': {
        const vm = this._mat(color, { roughness: .5 }), stone = this._mat('#fafafa', { roughness: .18 });
        const nb = w >= 1.1 ? 2 : 1, cd = d - .04, cm = chrome();
        g.add(this._rbox(w, .45, cd, vm, 0, .33, bz + cd / 2, .008));
        this._fronts(g, -w / 2 + .005, .335, w - .01, .44, d / 2 - .04, nb, 2, vm, 'edge');
        g.add(this._rbox(w, .03, d, stone, 0, .78, 0, .006));
        const rb = Math.min(.19, w / nb * .36);
        for (let i = 0; i < nb; i++){
          const x = nb === 1 ? 0 : (i ? w / 4 : -w / 4);
          g.add(this._lathe([[0, 0], [rb * .55, 0], [rb * .85, .03], [rb, .1], [rb * .97, .12]], ceramic({ side: THREE.DoubleSide }), x, .81, .03, 40),
                this._cyl(.018, .018, .003, cm, x, .812, .03, 16),
                this._cyl(.02, .022, .02, cm, x, .81, bz + .06, 16),
                this._tube([[x, .83, bz + .06], [x, 1.03, bz + .06], [x, 1.07, bz + .11], [x, 1.03, bz + .15]], .01, cm));
        }
        const mw = Math.min(w * .9, nb * .7);
        g.add(this._rbox(mw + .02, .82, .02, glowMat('#fff7e6', '#ffe9c4', .9), 0, 1.14, bz + .01, .01),
              this._box(mw, .8, .01, mirror(), 0, 1.15, bz + .025),
              this._cyl(.028, .028, .12, this._mat('#c8b8a6', { roughness: .3 }), w / 2 - .08, .81, bz + .1, 16),
              this._rbox(.18, .03, .12, fabric('#e9e2d6'), -w / 2 + .12, .81, .05, .012));
        break;
      }
      case 'shower': {
        const cm = chrome(), x = -w / 4;
        g.add(this._rbox(w, .05, d, this._mat('#f4f4f2', { roughness: .3 }), 0, 0, 0, .01),
              this._box(w * .6, .003, .05, this._mat('#9aa1a8', { metalness: .8, roughness: .3 }), 0, .05, bz + .08));
        [[w, .01, 0, d / 2 - .005], [.01, d, w / 2 - .005, 0]].forEach(([gw, gd, px, pz]) => {
          const p = this._box(gw, 1.95, gd, this.glassMat, px, .05, pz); p.castShadow = false; g.add(p);
        });
        g.add(this._box(.02, 1.95, .02, this.frameMat, w / 2 - .01, .05, d / 2 - .01),
              this._box(.02, 1.95, .03, this.frameMat, -w / 2 + .01, .05, d / 2 - .005),
              this._box(.03, 1.95, .02, this.frameMat, w / 2 - .005, .05, bz + .01),
              this._box(w, .015, .02, this.frameMat, 0, 1.985, d / 2 - .005),
              this._box(.02, .015, d, this.frameMat, w / 2 - .005, 1.985, 0),
              this._rbox(.14, .1, .04, cm, x, 1.0, bz + .02, .01),
              this._rod([x, 1.1, bz + .03], [x, 1.95, bz + .03], .012, cm),
              this._tube([[x, 1.95, bz + .03], [x, 2.02, bz + .06], [x, 2.03, bz + .22]], .01, cm),
              this._rbox(.24, .012, .24, cm, x, 2.02, bz + .25, .004));
        g.add(this._box(.26, .012, .1, ceramic(), w / 2 - .2, 1.2, bz + .05));
        break;
      }
      case 'bathtub': {
        const cer = ceramic(), h = .56, t = .07, cm = chrome();
        g.add(this._shell(w, d, h, t, .14, cer),
              this._box(w - .1, .12, d - .1, cer, 0, 0, 0),
              this._box(w - 2 * t + .004, .004, d - 2 * t + .004, this._mat('#bfe0ea', { roughness: .03, transparent: true, opacity: .6 }), 0, .4, 0));
        const fx = w / 2 - t / 2;
        g.add(this._tube([[fx, h - .02, 0], [fx, h + .1, 0], [fx - .06, h + .13, 0], [fx - .13, h + .09, 0]], .014, cm));
        [-1, 1].forEach(s => g.add(this._cyl(.02, .02, .04, cm, fx, h, s * .1, 16)));
        break;
      }
      case 'washer': case 'dryer': {
        const bm = this._mat(color, { roughness: .35 });
        const R0 = Math.min(w, d) * .25, fz = d / 2 - .02;
        g.add(this._box(w - .02, .04, d - .04, this._mat('#8f969b', { roughness: .5 }), 0, 0, -.02),
              this._rbox(w, .81, d - .02, bm, 0, .04, -.01, .025),
              this._box(w - .04, .1, .006, this._mat(lighten(color, .3), { roughness: .4 }), 0, .72, fz + .003),
              this._rbox(.18, .07, .01, bm, -w / 2 + .12, .735, fz + .006, .004),
              this._box(.12, .035, .003, screenMat('#1f6f6a'), w * .14, .745, fz + .007));
        const kn = this._cyl(.03, .03, .02, chrome(), -w * .02, .75, fz + .016, 28); kn.rotation.x = Math.PI / 2; g.add(kn);
        const dr = new THREE.Mesh(new THREE.CircleGeometry(R0, 40), this._mat('#1b1f22', { roughness: .6 }));
        dr.position.set(0, .4, fz + .004); g.add(dr);
        const rg = this._mesh(new THREE.TorusGeometry(R0 + .02, .022, 14, 48), this._mat('#c7cfd5', { metalness: .7, roughness: .25 }));
        rg.position.set(0, .4, fz + .016); g.add(rg);
        const Rs = R0 * 1.42;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(Rs, 32, 12, 0, Math.PI * 2, 0, .78),
          this._mat(type === 'dryer' ? '#4a4038' : '#26343d', { roughness: .04, metalness: .2, transparent: true, opacity: .8 }));
        cap.rotation.x = Math.PI / 2;
        cap.position.set(0, .4, fz + .012 - Rs * Math.cos(.78));
        g.add(cap);
        break;
      }
      case 'waterheater': {
        const r = Math.min(d / 2, .23), L = w - .06, yc = 1.95, zc = bz + r + .02;
        const tm = this._mat(color, { roughness: .35 }), cp = this._mat('#cfd4d8', { roughness: .4 });
        const tank = this._mesh(new THREE.CylinderGeometry(r, r, L, 40), tm);
        tank.rotation.z = Math.PI / 2; tank.position.set(0, yc, zc); g.add(tank);
        [-1, 1].forEach(s => g.add(
          this._blob(.035, r * .99, r * .99, cp, s * L / 2, yc, zc, 32),
          this._box(.05, r * 1.1, .02, this._mat('#9a9ea3', { roughness: .5 }), s * L * .3, yc - r * .55, bz + .01)));
        g.add(this._rbox(.2, .09, .02, this._mat('#e7eaec', { roughness: .4 }), L * .18, yc - .05, zc + r * .93, .008),
              this._box(.07, .03, .002, screenMat('#2f8f7a'), L * .18 - .04, yc - .02, zc + r * .93 + .011));
        break;
      }

      /* ---------- 家电 ---------- */
      case 'tv': {
        const th = w * .5625, yb = 1.2 - th / 2, z = bz + .03;
        g.add(this._rbox(w * .6, th * .6, .03, this._mat('#222', { roughness: .5 }), 0, yb + th * .2, bz + .015, .01),
              this._rbox(w, th, .025, this._mat('#18181a', { roughness: .4, metalness: .3 }), 0, yb, z + .01, .004),
              this._box(w - .016, th - .022, .002, screenMat('#1f2b3a'), 0, yb + .014, z + .0235),
              this._box(.04, .006, .002, this._mat('#8a8a8e', { roughness: .5 }), 0, yb + .004, z + .0235));
        break;
      }
      case 'aircon': {
        const am = this._mat(color, { roughness: .3 }), h = 1.8, fz = d / 2 - .005;
        g.add(this._rbox(w, .06, d, this._mat('#cfd3d6', { roughness: .4 }), 0, 0, 0, .015),
              this._rbox(w - .01, h - .06, d - .01, am, 0, .06, 0, .06),
              this._rbox(w - .06, 1.0, .01, this._mat(lighten(color, .4), { roughness: .12 }), 0, .22, fz, .005),
              this._box(w - .1, .42, .01, this._mat('#3d4145', { roughness: .5 }), 0, 1.28, fz));
        for (let i = 0; i < 8; i++){
          const b = this._box(w - .11, .012, .03, this._mat('#e4e7ea', { roughness: .4 }), 0, 1.3 + i * .05, fz + .008);
          b.rotation.x = -.35; g.add(b);
        }
        g.add(this._box(.1, .035, .003, screenMat('#4fb3a5'), 0, 1.12, fz + .006));
        break;
      }
      case 'acwall': {
        const h = .3, am = this._mat(color, { roughness: .3 }), s = new THREE.Shape();
        s.moveTo(0, .02); s.lineTo(0, h); s.lineTo(d * .75, h);
        s.quadraticCurveTo(d, h, d, h * .55); s.quadraticCurveTo(d, 0, d * .55, 0);
        s.lineTo(.02, 0); s.lineTo(0, .02);
        const geo = new THREE.ExtrudeGeometry(s, { depth: w - .02, bevelEnabled: true, bevelThickness: .01, bevelSize: .006, bevelSegments: 3, curveSegments: 16 });
        geo.rotateY(-Math.PI / 2); geo.translate((w - .02) / 2, 2.2, bz);
        g.add(this._mesh(geo, am),
              this._box(w - .12, .004, .07, this._mat('#3a3d40', { roughness: .5 }), 0, 2.19, bz + d * .55));
        break;
      }
      case 'dishwasher': {
        const dm = this._mat(color, { metalness: .55, roughness: .28 }), fz = d / 2 - .02;
        g.add(this._box(w - .01, .08, d - .07, this._mat('#3a3834', { roughness: .6 }), 0, 0, -.035),
              this._box(w - .005, .76, d - .03, this._mat('#8b9095', { roughness: .5 }), 0, .08, -.015),
              this._rbox(w - .006, .7, .02, dm, 0, .085, fz, .004),
              this._box(w - .006, .055, .02, this._mat('#26282a', { roughness: .4 }), 0, .785, fz));
        for (let i = 0; i < 4; i++)
          g.add(this._box(.012, .006, .002, this._mat('#101214', { emissive: i ? '#6fd0ff' : '#7fe08a', emissiveIntensity: .8, roughness: .5 }), w * .1 + i * .03, .81, fz + .011));
        this._pull(g, w * .6, false, 0, .74, fz + .01);
        break;
      }
      case 'ovencol': {
        const cm = this._mat(color, { roughness: .5 }), h = 2.1, fz = d / 2 - .02;
        const frm = this._mat('#1c1d1f', { roughness: .3, metalness: .5 }), gl = this._mat('#0b0c0d', { roughness: .03, metalness: .6 });
        g.add(this._box(w - .02, .08, d - .06, this._mat('#4a4641', { roughness: .7 }), 0, 0, -.03),
              this._box(w, h - .08, d - .02, cm, 0, .08, -.01));
        this._fronts(g, -w / 2, .08, w, .6, fz, 1, 2, cm, 'bar');
        this._fronts(g, -w / 2, 1.78, w, h - 1.8, fz, 1, 1, cm, 'bar', 1.84);
        [[.7, .58], [1.3, .46]].forEach(([y, ah]) => {
          g.add(this._box(w - .02, ah - .01, .02, frm, 0, y, fz + .01),
                this._box(w - .1, ah * .52, .003, gl, 0, y + ah * .1, fz + .021),
                this._box(w - .04, .06, .003, this._mat('#2a2c2e', { roughness: .5 }), 0, y + ah - .075, fz + .021),
                this._box(.08, .022, .002, this._mat('#101214', { emissive: '#ff9a3c', emissiveIntensity: .7, roughness: .5 }), 0, y + ah - .056, fz + .023));
          this._pull(g, w * .7, false, 0, y + ah * .72, fz + .02);
        });
        break;
      }
      case 'purifier': {
        const pm = this._mat(color, { roughness: .45 }), h = .72;
        g.add(this._rbox(w, h, d, pm, 0, 0, 0, Math.min(w, d) * .2),
              this._rbox(w - .05, .006, d - .05, this._mat('#8d959b', { roughness: .4 }), 0, h - .002, 0, .02));
        for (let i = 0; i < 7; i++)
          g.add(this._box(w - .07, .004, .006, this._mat('#6f777d', { roughness: .6 }), 0, h + .002, -d / 2 + .05 + i * (d - .1) / 6));
        g.add(this._rbox(w - .06, .42, .006, fabric('#c8ccd0'), 0, .06, d / 2 - .001, .01));
        const rg = this._mesh(new THREE.TorusGeometry(.03, .004, 8, 32), this._mat('#101214', { emissive: '#4fb3a5', emissiveIntensity: .8, roughness: .5 }));
        rg.position.set(0, .6, d / 2 + .002); g.add(rg);
        break;
      }

      /* ---------- 书房 · 休闲 ---------- */
      case 'officechair': {
        const r = Math.min(w, d) * .46, dk = darken(color, .75), bm = this._mat('#2b2b2d', { roughness: .45 }), cm = chrome();
        for (let k = 0; k < 5; k++){
          const a = k * Math.PI * 2 / 5, tx = Math.sin(a) * r * .95, tz = Math.cos(a) * r * .95;
          g.add(this._rod([0, .1, 0], [tx, .07, tz], .022, bm, .014, 10),
                this._cyl(.008, .008, .03, bm, tx, .04, tz, 8));
        }
        g.add(this._cyl(.05, .06, .05, bm, 0, .08, 0, 20),
              this._cyl(.025, .025, .22, cm, 0, .12, 0, 16),
              this._cyl(.036, .036, .12, bm, 0, .12, 0, 16),
              this._rbox(.22, .05, .22, bm, 0, .34, .02, .01),
              this._rbox(w * .78, .03, d * .72, bm, 0, .38, .04, .01),
              this._rbox(w * .8, .08, d * .74, fabric(color), 0, .4, .05, .035),
              this._tube([[0, .36, 0], [0, .38, bz + .12], [0, .6, bz + .07]], .02, bm));
        const bf = this._shell(w * .72, .6, .03, .025, .08, bm);
        bf.rotation.x = Math.PI / 2 - .12; bf.position.set(0, .88, bz + .06); g.add(bf);
        const bk = this._box(w * .68, .56, .006, this._mat(dk, { roughness: .85, transparent: true, opacity: .88, side: THREE.DoubleSide }), 0, .6, bz + .085);
        bk.rotation.x = -.12;
        const bl = this._rbox(w * .5, .08, .03, fabric(color), 0, .66, bz + .11, .015); bl.rotation.x = -.12;
        g.add(bk, bl,
              this._rod([-.05, 1.14, bz + .025], [-.05, 1.22, bz + .015], .008, bm),
              this._rod([.05, 1.14, bz + .025], [.05, 1.22, bz + .015], .008, bm),
              this._rbox(w * .45, .12, .05, fabric(dk), 0, 1.2, bz + .02, .025));
        [-1, 1].forEach(s => g.add(this._box(.035, .22, .035, bm, s * w * .4, .42, .04),
                                    this._rbox(.07, .03, d * .4, bm, s * w * .4, .63, .04, .012)));
        break;
      }
      case 'piano': {
        const pk = this._mat(color, { roughness: .12, metalness: .1 });
        const bd = d * .5, kz = bz + bd, h = 1.25, kd = d * .22 - .03;
        const iv = this._mat('#faf8f3', { roughness: .3 }), eb = this._mat('#111', { roughness: .25 }), kw = (w - .12) / 52;
        g.add(this._box(w, h, bd, pk, 0, 0, bz + bd / 2),
              this._rbox(w + .02, .03, bd + .03, pk, 0, h, bz + bd / 2 + .01, .008));
        [-1, 1].forEach(s => g.add(this._rbox(.06, .13, kd + .06, pk, s * (w / 2 - .03), .6, kz + (kd + .06) / 2, .01),
                                    this._box(.05, .6, .05, pk, s * (w / 2 - .08), 0, kz + kd + .01),
                                    this._box(.06, .04, d - bd, pk, s * (w / 2 - .08), 0, kz + (d - bd) / 2)));
        g.add(this._box(w - .12, .08, kd + .05, pk, 0, .6, kz + (kd + .05) / 2),
              this._box(w - .12, .1, .03, pk, 0, .68, kz + .015));
        for (let i = 0; i < 52; i++){
          const x = -w / 2 + .06 + kw * (i + .5);
          g.add(this._box(kw - .0015, .022, kd, iv, x, .68, kz + .03 + kd / 2));
          if (i < 51 && 'ACDFG'.includes('ABCDEFG'[i % 7]))
            g.add(this._box(kw * .58, .02, kd * .62, eb, x + kw / 2, .7, kz + .03 + kd * .31));
        }
        const mk = this._box(w * .42, .18, .012, pk, 0, .84, kz + .012); mk.rotation.x = -.25;
        g.add(mk);
        break;
      }
      case 'treadmill': {
        const tm = this._mat(color, { roughness: .55 }), bm = this._mat('#2a2a2c', { roughness: .5 });
        const al = this._mat('#9a9ea3', { metalness: .6, roughness: .4 });
        g.add(this._rbox(w, .14, d - .25, tm, 0, .03, .125, .03),
              this._box(w - .16, .006, d - .5, this._mat('#141414', { roughness: .7 }), 0, .17, .15));
        [-1, 1].forEach(s => g.add(this._box(.07, .008, d - .45, al, s * (w / 2 - .05), .17, .15)));
        [bz + .06, d / 2 - .06].forEach(z => [-1, 1].forEach(s =>
          g.add(this._box(.06, .03, .06, bm, s * (w / 2 - .06), 0, z))));
        g.add(this._rbox(w, .22, .32, tm, 0, 0, bz + .16, .05));
        [-1, 1].forEach(s => g.add(
          this._rod([s * (w / 2 - .06), .15, bz + .2], [s * (w / 2 - .06), 1.15, bz + .3], .025, bm, .022),
          this._tube([[s * (w / 2 - .06), 1.0, bz + .28], [s * (w / 2 - .06), 1.0, bz + .5], [s * (w / 2 - .07), .97, bz + .62]], .018, bm)));
        const cg = new THREE.Group(); cg.position.set(0, 1.2, bz + .31); cg.rotation.x = -.5;
        cg.add(this._rbox(w * .8, .2, .08, bm, 0, -.1, 0, .02),
               this._box(w * .4, .11, .004, screenMat('#2a5d8f'), 0, -.055, .041));
        g.add(cg);
        break;
      }

      default: g.add(this._box(w, .8, d, M));
    }
    return g;
  }

  /* ============================================================
   *  初始化
   * ============================================================ */
  async init(){
    if (this.inited) return;
    this.inited = true;

    const stage = $('#stage'), host = $('#view3d');
    if (!stage || !host) throw new Error('缺少 #stage 或 #view3d');
    this.stage = stage;
    this.host = host;

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(this.SW(), this.SH());
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    /* Canvas 显式绝对定位 + z-index 0，锁死在最底层。
       否则 CSS2DRenderer 的 DOM 层（position:absolute; inset:0）会把它盖住，
       出现"房间名能看见、WebGL 场景全黑"的现象。 */
    Object.assign(renderer.domElement.style, {
      position: 'absolute', inset: '0', zIndex: '0',
    });
    host.prepend(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f4ee);
    const camera = this.camera = new THREE.PerspectiveCamera(FOV, this.SW() / this.SH(), .05, 300);

    const orbit = this.orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true; orbit.dampingFactor = 0.08;
    orbit.maxPolarAngle = Math.PI * .495; orbit.minDistance = 1.5; orbit.maxDistance = 45;

    const hemi = this.hemi = new THREE.HemisphereLight(0xfff8ee, 0xb9a88f, 1.1);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(COARSE ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 60 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    sun.target.position.set(0, 0, 0);
    scene.add(sun.target);

    const ground = this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0xf2eee7, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    ground.receiveShadow = true;
    scene.add(hemi, sun, ground);

    this.wallMat  = this._mat('#f4f1eb', { roughness: .92 });
    this.capMat   = this._mat('#34312d', { roughness: .9 });
    this.frameMat = this._mat('#5d6166', { roughness: .5, metalness: .4 });
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xcfe6ef, roughness: .05, transparent: true, opacity: .28,
      depthWrite: false, side: THREE.DoubleSide,
    });
    /* 只投阴影、不显示：用来在剖切模式下补"不可见全高墙"，或补凸窗顶板，
       保证采光表现与全墙模式一致，但视角仍然能穿透看到室内。 */
    this.shadowMat = new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    });

    this.archFloor = new THREE.Group();
    this.archUp    = new THREE.Group();
    this.furnG     = new THREE.Group();          // 家具 mesh（不含灯具）
    this.lampG     = new THREE.Group();          // 灯具 mesh（可见模型）
    this.lightG    = new THREE.Group();          // 光源容器：永远 visible，独立于灯具模型
    this.labelG    = new THREE.Group();          // 房间名标签
    this.ceilingG  = new THREE.Group();          // 只投阴影、不渲染颜色（视角仍可穿透）
    this.ceilMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    });
    scene.add(this.archFloor, this.archUp, this.furnG, this.lampG, this.lightG, this.labelG, this.ceilingG);

    /* CSS2D 标签渲染器：叠加在 WebGL canvas 之上，用于显示房间名。
       关键：显式声明 background 透明 —— 不写的话某些浏览器 / 主题会用默认底色，
       把底下的 canvas 整个盖住。 */
    const lr = this.labelRenderer = new CSS2DRenderer();
    lr.setSize(this.SW(), this.SH());
    Object.assign(lr.domElement.style, {
      position: 'absolute', inset: '0',
      zIndex: '1', pointerEvents: 'none',
      background: 'transparent', overflow: 'visible',
    });
    host.appendChild(lr.domElement);

    /* ---- 点击门开合 ---- */
    let downAt = null;
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    cv.addEventListener('pointerup', e => {
      if (!downAt) return;
      const dt = performance.now() - downAt.t;
      const dist = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (dt > 400 || dist > 5) return;
      if (this.walk) return;
      const h = this._pick(e);
      if (h?.door){
        h.door.open = !h.door.open;
        return;
      }
      /* 只有灯具在 3D 里支持点击选中；
         普通家具的编辑仍然通过 2D 或左侧属性栏进行。 */
      if (h?.fid && h.isLamp){
        this.app?.select?.({ kind:'furn', id: h.fid });
        if (matchMedia('(max-width:1100px)').matches){
          document.querySelector('aside.right')?.classList.add('open');
        }
        return;
      }
      /* 点击房间 / 家具不改变选中状态 */
    });

    new ResizeObserver(() => {
      if (!this.renderer) return;
      renderer.setSize(this.SW(), this.SH());
      if (this.labelRenderer) this.labelRenderer.setSize(this.SW(), this.SH());
      camera.aspect = this.SW() / this.SH();
      camera.updateProjectionMatrix();
    }).observe(stage);

    this._applyLight();
    this._bindWalkEvents();
  }

  _bindWalkEvents(){
    const cv = this.renderer.domElement;
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (e.shiftKey) this.keys['shift'] = true;
      if (!this.walk) return;
      if (k === 'escape'){ this.exitWalk(); return; }
      if (k === 'e'){ this._toggleDoorAhead(); e.preventDefault(); }
    });
    document.addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
      if (!e.shiftKey) this.keys['shift'] = false;
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.walk) return;
      const locked = document.pointerLockElement === cv;
      this.walk.locked = locked;
      if (!locked) this.exitWalk();
    });
    document.addEventListener('mousemove', e => {
      if (!this.walk || !this.walk.locked) return;
      this.walk.yaw   -= e.movementX * 0.0022;
      this.walk.pitch -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.05;
      this.walk.pitch = Math.max(-lim, Math.min(lim, this.walk.pitch));
      this._applyWalkCam();
    });

    let drag = null;
    cv.addEventListener('mousedown', e => {
      if (!this.walk || this.walk.locked || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY };
    });
    document.addEventListener('mousemove', e => {
      if (!drag || !this.walk || this.walk.locked) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      this.walk.yaw   -= dx * 0.005;
      this.walk.pitch -= dy * 0.005;
      const lim = Math.PI / 2 - 0.05;
      this.walk.pitch = Math.max(-lim, Math.min(lim, this.walk.pitch));
      this._applyWalkCam();
    });
    document.addEventListener('mouseup', () => { drag = null; });

    const joy = document.getElementById('joy');
    if (joy){
      let joyId = null, cx = 0, cy = 0;
      const apply = e => {
        if (!this._joy) return;
        const R = 55;
        const dx = e.clientX - cx, dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const k = dist > R ? R / dist : 1;
        const x = dx * k, y = dy * k;
        const knob = joy.querySelector('i');
        if (knob) knob.style.transform = `translate(${x}px,${y}px)`;
        this._joy = { x: x / R, y: -y / R };
      };
      joy.addEventListener('pointerdown', e => {
        if (!this.walk) return;
        joyId = e.pointerId;
        joy.setPointerCapture(joyId);
        const r = joy.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        this._joy = { x: 0, y: 0 };
        apply(e);
        e.preventDefault();
      });
      joy.addEventListener('pointermove', e => { if (e.pointerId === joyId){ apply(e); e.preventDefault(); } });
      const jEnd = e => {
        if (e.pointerId !== joyId) return;
        joyId = null; this._joy = null;
        const knob = joy.querySelector('i');
        if (knob) knob.style.transform = '';
      };
      joy.addEventListener('pointerup', jEnd);
      joy.addEventListener('pointercancel', jEnd);
    }

    let touchLook = null;
    cv.addEventListener('pointerdown', e => {
      if (!this.walk || e.pointerType === 'mouse') return;
      touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointermove', e => {
      if (!this.walk || !touchLook || e.pointerId !== touchLook.id) return;
      const dx = e.clientX - touchLook.x, dy = e.clientY - touchLook.y;
      touchLook.x = e.clientX; touchLook.y = e.clientY;
      this.walk.yaw   -= dx * 0.005;
      this.walk.pitch -= dy * 0.005;
      const lim = Math.PI / 2 - 0.05;
      this.walk.pitch = Math.max(-lim, Math.min(lim, this.walk.pitch));
      this._applyWalkCam();
    });
    cv.addEventListener('pointerup', e => { if (touchLook && e.pointerId === touchLook.id) touchLook = null; });
    cv.addEventListener('pointercancel', () => { touchLook = null; });

    cv.addEventListener('wheel', e => {
      if (!this.walk) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY);
      const nv = Math.max(WALK_FOV_MIN, Math.min(WALK_FOV_MAX, (this.walk.fov || WALK_FOV) - delta * 2));
      this.walk.fov = nv;
      this.camera.fov = nv;
      this.camera.updateProjectionMatrix();
    }, { passive: false });

    const exit = document.getElementById('walkExit');
    if (exit) exit.addEventListener('click', () => this.exitWalk());
  }

  /* ============================================================
   *  墙 / 建筑
   * ============================================================ */
  _clear(g){ g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); g.clear(); }

  _wallBox(w, yb, yt, mat){
    if (yt - yb <= .001) return;
    let cx, cy, L, T, rotY = 0;
    if (Array.isArray(w)){
      const [x0, y0, x1, y1] = w;
      L = this.M(x1 - x0); T = this.M(y1 - y0);
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
    } else {
      const dx = w.x1 - w.x0, dy = w.y1 - w.y0;
      L = Math.max(0.001, Math.hypot(dx, dy) / 1000);
      T = Math.max(0.02, (w.t || 240) / 1000);
      cx = (w.x0 + w.x1) / 2; cy = (w.y0 + w.y1) / 2;
      rotY = -Math.atan2(dy, dx);
    }
    const h = yt - yb;
    const geo = new THREE.BoxGeometry(L, h, T);
    const mats = mat || [this.wallMat, this.wallMat, this.capMat, this.wallMat, this.wallMat, this.wallMat];
    const o = new THREE.Mesh(geo, mats);
    o.position.set(this.wx(cx), (yb + yt) / 2, this.wz(cy));
    o.rotation.y = rotY;
    o.castShadow = true; o.receiveShadow = true;
    this.archUp.add(o);
  }

  /**
   * 按门窗洞把墙拆成若干盒体。mat 可选：
   *   - 传 undefined → 使用默认墙材质（可见）
   *   - 传 this.shadowMat → 只投阴影、不可见（用于剖切模式下补全高墙）
   */
  _buildWallWithOpenings(wall, openings, top, mat){
    const dx = wall.x1 - wall.x0, dy = wall.y1 - wall.y0;
    const wLen = Math.hypot(dx, dy);
    if (wLen < 1) return;
    const ux = dx / wLen, uy = dy / wLen;
    const holes = [];
    openings.forEach(op => {
      const t1 = this._projectT({ x: op.x0, y: op.y0 }, wall);
      const t2 = this._projectT({ x: op.x1, y: op.y1 }, wall);
      const a = Math.min(t1, t2) * wLen;
      const b = Math.max(t1, t2) * wLen;
      if (b - a < 1) return;
      const isDoor = op.kind === 'door';
      const isDem = op.kind === 'demolition';
      const sill = (isDoor || isDem) ? 0 : Math.max(0, (op.sill || 900) / 1000);
      const head = isDem ? top : (isDoor ? Math.min(2.05, top) : Math.min(2.4, top));
      holes.push({ tMin: Math.max(0, a), tMax: Math.min(wLen, b), sill, head });
    });
    if (holes.length === 0){ this._wallBox(wall, 0, top, mat); return; }
    const breaks = new Set([0, wLen]);
    holes.forEach(h => { breaks.add(h.tMin); breaks.add(h.tMax); });
    const sorted = [...breaks].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++){
      const a = sorted[i], b = sorted[i + 1];
      if (b - a < 1) continue;
      const mid = (a + b) / 2;
      let hit = null;
      for (const h of holes) if (mid > h.tMin + 1e-6 && mid < h.tMax - 1e-6){ hit = h; break; }
      const cx0 = wall.x0 + ux * a, cy0 = wall.y0 + uy * a;
      const cx1 = wall.x0 + ux * b, cy1 = wall.y0 + uy * b;
      const segWall = { x0: cx0, y0: cy0, x1: cx1, y1: cy1, t: wall.t, kind: wall.kind };
      if (!hit) this._wallBox(segWall, 0, top, mat);
      else {
        if (hit.sill > 0.01) this._wallBox(segWall, 0, Math.min(hit.sill, top), mat);
        if (hit.head < top - 0.01) this._wallBox(segWall, hit.head, top, mat);
      }
    }
  }

  _projectT(p, wall){
    const dx = wall.x1 - wall.x0, dy = wall.y1 - wall.y0;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1) return 0;
    const t = ((p.x - wall.x0) * dx + (p.y - wall.y0) * dy) / L2;
    return Math.max(0, Math.min(1, t));
  }
  _distToSeg(px, py, x0, y0, x1, y1){
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0;
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
  }
  _openingsOnWall(wall, plan){
    const tol = (wall.t || 240) / 2 + 500;
    const all = [...(plan.doors || []), ...(plan.windows || [])];
    return all.filter(op => {
      if (op.hostWall === wall.id) return true;
      const cx = (op.x0 + op.x1) / 2, cy = (op.y0 + op.y1) / 2;
      return this._distToSeg(cx, cy, wall.x0, wall.y0, wall.x1, wall.y1) < tol;
    });
  }

  /** 补充：落在墙缺口处的独立窗，需要主动补上窗台墙 + 窗楣墙 */
  _ensureWindowWalls(plan, layout, top){
    const walls = plan.walls || [];
    const dem = layout.demolished || [];
    const winWallMat = [this.wallMat, this.wallMat, this.capMat, this.wallMat, this.wallMat, this.wallMat];
    (plan.windows || []).forEach(win => {
      if (!win || !Number.isFinite(+win.x0) || !Number.isFinite(+win.y0)
        || !Number.isFinite(+win.x1) || !Number.isFinite(+win.y1)) return;
      const winLen = Math.hypot(win.x1 - win.x0, win.y1 - win.y0);
      if (winLen < 1) return;
      const wcx = (win.x0 + win.x1) / 2, wcy = (win.y0 + win.y1) / 2;
      const winT = win.t || 240;
      let maxCover = 0;
      for (const w of walls){
        if (dem.includes(w.id)) continue;
        const d = this._distToSeg(wcx, wcy, w.x0, w.y0, w.x1, w.y1);
        if (d > (w.t + winT) / 2 + 200) continue;
        const t1 = this._projectT({ x: win.x0, y: win.y0 }, w);
        const t2 = this._projectT({ x: win.x1, y: win.y1 }, w);
        const wallLen = Math.hypot(w.x1 - w.x0, w.y1 - w.y0) || 1;
        const ovl = Math.abs(t2 - t1) * wallLen;
        if (ovl > maxCover) maxCover = ovl;
      }
      if (maxCover > winLen * 0.9) return;
      const sill = (win.sill || 900) / 1000;
      const head = Math.min(2.4, top);
      if (sill > 0.01) this._wallBox(win, 0, Math.min(sill, top), winWallMat);
      if (head < top - 0.01) this._wallBox(win, head, top, winWallMat);
    });
  }

  /**
   * 缺口处的门：补一段从门顶到顶面的过梁墙。
   * 判定：门沿其自身方向，被任一未拆除的墙覆盖超过 90% → 认为该门在墙中间（由
   * _buildWallWithOpenings 打洞处理），跳过；否则认为门在墙缺口处，需要补门头。
   */
  _ensureDoorWalls(plan, layout, top){
    const walls = plan.walls || [];
    const dem = layout.demolished || [];
    const doorTop = Math.min(2.05, top);
    if (top <= doorTop + .01) return;
    const mat = [this.wallMat, this.wallMat, this.capMat, this.wallMat, this.wallMat, this.wallMat];
    (plan.doors || []).forEach(d => {
      const len = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
      if (len < 1) return;
      const dcx = (d.x0 + d.x1) / 2, dcy = (d.y0 + d.y1) / 2;
      const dT = d.t || 240;
      let maxCover = 0;
      for (const w of walls){
        if (dem.includes(w.id)) continue;
        const dist = this._distToSeg(dcx, dcy, w.x0, w.y0, w.x1, w.y1);
        if (dist > (w.t + dT) / 2 + 200) continue;
        const t1 = this._projectT({ x: d.x0, y: d.y0 }, w);
        const t2 = this._projectT({ x: d.x1, y: d.y1 }, w);
        const wLen = Math.hypot(w.x1 - w.x0, w.y1 - w.y0) || 1;
        const ovl = Math.abs(t2 - t1) * wLen;
        if (ovl > maxCover) maxCover = ovl;
      }
      if (maxCover > len * 0.9) return;
      this._wallBox(d, doorTop, top, mat);
    });
  }

  _shapeOf(poly, flip){
    const s = new THREE.Shape();
    poly.forEach(([x, y], i) => s[i ? 'lineTo' : 'moveTo'](this.wx(x), flip ? this.wz(y) : -this.wz(y)));
    return s;
  }

  /**
   * 多边形向外扩张 d 毫米。
   *
   * 实现对两个方向都做一遍，取面积更大的结果作为"外扩" —— 这样就不依赖
   * 多边形绕序假设。户型坐标里 y 轴向下，用有向面积判断绕序容易搞反，
   * 一旦方向算反，"外扩"就变成"内缩"，天花板会沿墙一圈往里收，反而漏光。
   *
   * 用途：生成房间天花板前，把房间多边形向外扩一小段，让相邻房间顶板重叠，
   *      覆盖"两个房间之间没有绘制过门石/墙体中线"导致的小缝隙，防止阳光从缝隙漏入。
   */
  _expandPolygon(poly, d){
    if (!poly || poly.length < 3 || d <= 0) return poly;
    const a = this._offsetPoly(poly, d, 1);
    const b = this._offsetPoly(poly, d, -1);
    return this._polyArea(a) >= this._polyArea(b) ? a : b;
  }

  /** 角平分线法 offset：sign=+1/-1 分别沿两个相反的法向外移 */
  _offsetPoly(poly, d, sign){
    const n = poly.length;
    const out = [];
    for (let i = 0; i < n; i++){
      const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
      const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1];
      const e2x = p2[0] - p1[0], e2y = p2[1] - p1[1];
      const l1 = Math.hypot(e1x, e1y) || 1;
      const l2 = Math.hypot(e2x, e2y) || 1;
      const n1x = sign * (-e1y) / l1, n1y = sign * ( e1x) / l1;
      const n2x = sign * (-e2y) / l2, n2y = sign * ( e2x) / l2;
      let bx = n1x + n2x, by = n1y + n2y;
      const bl = Math.hypot(bx, by);
      if (bl < 1e-6){ out.push([p1[0], p1[1]]); continue; }
      bx /= bl; by /= bl;
      /* 沿角平分线外移 d，需除以 cos(半角)，保证相邻两边都正好平移 d */
      const cosHalf = n1x * bx + n1y * by;
      const k = cosHalf > 0.01 ? 1 / cosHalf : 1;
      out.push([p1[0] + bx * d * k, p1[1] + by * d * k]);
    }
    return out;
  }

  /** 多边形面积（有向面积绝对值） */
  _polyArea(poly){
    return Math.abs(poly.reduce((a, p, i) => {
      const q = poly[(i + 1) % poly.length];
      return a + p[0] * q[1] - q[0] * p[1];
    }, 0)) / 2;
  }

  /* ---------- 建筑 ---------- */
  buildArch(){
    this._clear(this.archFloor);
    this._clear(this.archUp);
    this._clear(this.ceilingG);
    const { plan, layout } = this.app.store.state;
    const top = this.opt.cut;

    /* 地板：按房间地面材料取纹理 */
    (plan.rooms || []).forEach(r => {
      if (!r.poly || !r.poly.length) return;
      const matKey = r.mat || 'tile800';
      const floorM = this._floorMat(matKey);
      const bay = r.counted === false;
      const geo = bay
        ? new THREE.ExtrudeGeometry(this._shapeOf(r.poly), { depth: .45, bevelEnabled: false })
        : new THREE.ShapeGeometry(this._shapeOf(r.poly));
      geo.rotateX(-Math.PI / 2);
      const fl = new THREE.Mesh(geo, bay ? [floorM, this._mat('#e9e4da', { roughness: .8 })] : floorM);
      fl.receiveShadow = true;
      fl.userData.room = r.id;
      if (bay){ fl.castShadow = true; this.archUp.add(fl); } else this.archFloor.add(fl);

      /* 房顶 shadowOnly：遮挡阳光 → 室内只能靠窗口直射光 + 间接光。
         要求：
           ① 不受 opt.cut 影响 —— 剖切墙模式下也要生成，否则阳光会越过矮墙照进来；
           ② 所有房间都要生成 —— 凸窗（counted === false）也有顶板，
              否则凸窗开口处会成为漏光通道；
           ③ 每个房间的多边形向外扩张 EXPAND 毫米后再生成 —— 覆盖房间之间
              未绘制过门石/墙体中线导致的缝隙，避免阳光从缝隙漏入；
              相邻房间扩张后必然重叠，重叠部分只投一次阴影，无副作用。
         ceilMat 的 colorWrite=false / depthWrite=false，视角依旧能穿透看到室内。 */
      {
        const EXPAND = 220;   // 大于 1/2 常见墙厚（240/2=120）；对 120/240/360 墙均能覆盖
        const ceilPoly = this._expandPolygon(r.poly, EXPAND);
        const cg = new THREE.ShapeGeometry(this._shapeOf(ceilPoly, true));
        cg.rotateX(Math.PI / 2);
        const ceil = new THREE.Mesh(cg, this.ceilMat);
        ceil.position.y = H;
        ceil.castShadow = true;
        ceil.receiveShadow = false;
        this.ceilingG.add(ceil);
      }

    });

    /* 墙体（按门窗洞分段生成） */
    (plan.walls || []).forEach((w, i) => {
      const id = w.id || ('w' + i);
      if ((layout.demolished || []).includes(id)) return;
      const isLow = w.kind === 'low';
      if (isLow){ this._wallBox(w, 0, Math.min(1, top)); return; }
      const openings = this._openingsOnWall(w, plan);
      (layout.demolitions || []).forEach(dm => {
        if (dm && dm.hostWall === w.id){
          openings.push({ kind: 'demolition', x0: dm.x0, y0: dm.y0, x1: dm.x1, y1: dm.y1 });
        }
      });

      /* 剖切模式：可见墙只到 opt.cut，但采光要和全墙一样 → 先补一段
         0 ~ H 的"不可见全高墙"（shadowMat：不写颜色、不写深度，只投阴影）。 */
      if (top < H - .01){
        this._buildWallWithOpenings(w, openings, H, this.shadowMat);
      }
      /* 可见墙体（0 到 opt.cut） */
      this._buildWallWithOpenings(w, openings, top);
    });

    /* 缺口处的独立窗（外凸窗）：补齐上下墙段 */
    this._ensureWindowWalls(plan, layout, top);

    /* 缺口处的门：补门头（过梁） */
    this._ensureDoorWalls(plan, layout, top);

    /* 窗玻璃 */
    (plan.windows || []).forEach(win => {
      const L = this.M(Math.hypot(win.x1 - win.x0, win.y1 - win.y0));
      const cx = this.wx((win.x0 + win.x1) / 2);
      const cz = this.wz((win.y0 + win.y1) / 2);
      const rotY = -Math.atan2(win.y1 - win.y0, win.x1 - win.x0);
      const sill = (win.sill || 900) / 1000;
      const gh = Math.min(2.4, top) - sill;
      if (gh <= 0) return;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(L, gh, .01), this.glassMat);
      pane.position.set(cx, sill + gh / 2, cz);
      pane.rotation.y = rotY;
      this.archUp.add(pane);
    });

    /* 门 */
    this.doors.length = 0;
    (plan.doors || []).forEach(d => {
      const dh = Math.min(2.05, top);
      const L = this.M(Math.hypot(d.x1 - d.x0, d.y1 - d.y0));
      const dirX = d.x1 - d.x0, dirY = d.y1 - d.y0;
      const Lw = Math.hypot(dirX, dirY) || 1;
      const ux = dirX / Lw, uy = dirY / Lw;
      const hingeAtX0 = d.hinge !== 'right';
      const hx = hingeAtX0 ? d.x0 : d.x1;
      const hy = hingeAtX0 ? d.y0 : d.y1;
      const cSign = hingeAtX0 ? 1 : -1;
      const cDirX = ux * cSign, cDirY = uy * cSign;
      const baseAng = Math.atan2(-cDirY, cDirX);
      const wallNx = -uy, wallNy = ux;
      const swingSign = d.swing === 'out' ? -1 : 1;
      const oDirX = wallNx * swingSign, oDirY = wallNy * swingSign;
      const openAngRaw = Math.atan2(-oDirY, oDirX);
      let delta = openAngRaw - baseAng;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const openAng = baseAng + delta;

      const pivot = new THREE.Group();
      pivot.position.set(this.wx(hx), 0, this.wz(hy));
      const leaf = this._box(L, dh, .04,
        this._mat(d.entry ? '#6b4f3a' : '#efe6d8', { roughness: .5 }), L / 2);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 8),
        this._mat('#cfd2d4', { metalness: .9, roughness: .25 }));
      knob.position.set(L - .07, Math.min(1, dh - .05), 0);
      knob.scale.z = 2.2;
      pivot.add(leaf, knob);

      const door = { pivot, a0: baseAng, a1: openAng, cur: baseAng, open: false };
      pivot.rotation.y = door.cur;
      pivot.userData.door = door;
      leaf.userData.door = door;
      knob.userData.door = door;

      this.doors.push(door);
      this.archUp.add(pivot);
    });

    this._applyGrow();
  }

  /* ---------- 家具 ---------- */
  buildFurn(){
    /* 清空随机数缓存：_rng() 返回的是有状态的闭包，不清空的话，
       第二次重建时同一 seed 的生成器会从上次的位置继续推进，
       导致书架上的书本、绿植叶片等随机摆件"换了一批"。
       清空后每件家具的随机序列都从同一个 seed 初值重新开始，
       摆件位置 / 数量稳定不变。 */
    this._rngCache.clear();

    /* 清理旧灯（含 SpotLight 目标） */
    (this.lamps || []).forEach(entry => {
      (entry.targets || []).forEach(t => this.scene.remove(t));
    });
    this._clear(this.furnG);
    this._clear(this.lampG);
    this._clear(this.lightG);
    this.lamps = [];
    /* 全局阴影光源配额：每次重建都归零，由 _buildCeilingLight 逐个消耗 */
    this._lampShadowCount = 0;

    (this.app.store.state.layout.furniture || []).forEach(f => {
      if (CEILING_TYPES.has(f.type)){
        this._buildCeilingLight(f);
        return;
      }
      const g = this._furnMesh(f.type, this.M(f.w), this.M(f.d), f.color || '#dddddd');
      g.position.set(this.wx(f.cx), 0, this.wz(f.cy));
      g.rotation.y = -f.rot * Math.PI / 180;
      g.userData.fid = f.id;
      g.traverse(o => { o.userData.fid = f.id; });
      this.furnG.add(g);
    });

    /* 家具与灯具模型分别由独立开关控制；光源容器 lightG 永远 visible。 */
    this.furnG.visible  = !!this.opt.furn;
    this.lampG.visible  = !!this.opt.lamps;
    this.lightG.visible = true;      // 光源容器始终可见，显隐只由夜景开关的强度控制

    /* 夜景开关 + 单灯开关 → 光源强度 */
    (this.lamps || []).forEach(entry => {
      entry.lights.forEach(l => {
        const en = l.light.userData.enabled !== false;
        l.light.intensity = (this.opt.night && en) ? l.base : 0;
      });
    });

    this._applyGrow();
  }

  /** 灯具颜色：优先自定义 color，其次按 colorTemp 预设 */
  _lampColor(lamp){
    if (!lamp) return '#ffd9a8';
    if (lamp.color) return lamp.color;
    const t = lamp.colorTemp;
    if (t === 'cool')    return '#cfe4ff';
    if (t === 'neutral') return '#fff4dc';
    return '#ffd9a8';
  }

  /** 找包含点 (cx, cy)（毫米）的房间，返回内切圆半径近似（米）；找不到返回 4m */
  _roomRadiusAt(cxMM, cyMM){
    const rooms = (this.app.store.state.plan && this.app.store.state.plan.rooms) || [];
    for (const r of rooms){
      if (!r.poly || r.poly.length < 3) continue;
      if (!this._pointInPoly(cxMM, cyMM, r.poly)) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of r.poly){
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const w = (maxX - minX) / 1000, d = (maxY - minY) / 1000;
      return Math.max(1.5, Math.min(w, d) / 2);
    }
    return 4;
  }
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

  /**
   * 生成一盏天花板灯。
   *
   * WebGL 硬限制：MAX_TEXTURE_IMAGE_UNITS = 16。
   *   一个带阴影的 PointLight 占 6 张 shadow map；
   *   一个带阴影的 SpotLight  占 1 张 shadow map。
   * 所以：
   *   ① 每盏灯只让 1 个"主光源"带阴影 —— 用 SpotLight 朝下，只占 1 张纹理；
   *   ② 主光源的 shadow.camera.far 按"房间内切圆半径 × 1.6"约束，
   *      只对本房间范围内的墙 / 家具计算阴影，隔壁墙 / 家具根本不进 shadow map，
   *      天然不漏光，也大幅降低每帧阴影渲染量；
   *   ③ 其余"辅助光源"用 PointLight、**不开阴影**、distance 缩到
   *      "房间内切圆 × 0.9"，只做本房间内的柔和补光，越界即衰减到 0，
   *      也照不到隔壁房间；
   *   ④ 全局带阴影光源 ≤ MAX_SHADOW（桌面 6 / 触屏 3），避免纹理单元超限。
   */
  _buildCeilingLight(f){
    const w = this.M(f.w), d = this.M(f.d);
    const cx = this.wx(f.cx), cz = this.wz(f.cy);
    const rot = -f.rot * Math.PI / 180;
    const lamp = f.lamp || {};
    const enabled = lamp.on !== false;
    const hex = this._lampColor(lamp);
    const intensity = Math.max(.2, Math.min(3, lamp.intensity ?? 1));
    const y = H - 0.02;
    const mat = this._mat('#fbfbf9', { emissive: new THREE.Color(hex), emissiveIntensity: .55, roughness: .5 });
    const lights = [];          // [{ light, base }]
    const targets = [];         // SpotLight 目标

    /* 房间约束：阴影与光照都被房间内切圆限制，超出即忽略 */
    const roomR = this._roomRadiusAt(f.cx, f.cy);
    const shadowFar = Math.max(2.5, Math.min(7, roomR * 1.6));   // 阴影相机远平面
    const lightFar  = shadowFar + 2;                             // 主光源有效距离
    const auxDist   = Math.min(2.5, roomR * 0.9);                // 辅助光源有效距离

    /* 全局阴影配额：超过就不再给新光源开阴影，避免纹理单元超限 */
    const MAX_SHADOW = COARSE ? 3 : 6;
    if (this._lampShadowCount == null) this._lampShadowCount = 0;
    const allowShadow = this._lampShadowCount < MAX_SHADOW;
    this._lampShadowCount++;

    /** 主光源：1 个 SpotLight 朝下；受配额控制是否带阴影（占 1 张纹理） */
    const addMain = (x, yPos, z, base, coneDeg) => {
      const sp = new THREE.SpotLight(new THREE.Color(hex), 0, lightFar, coneDeg * Math.PI / 180, .4, 1.4);
      sp.position.set(x, yPos, z);
      sp.userData.fid = f.id;
      sp.userData.enabled = enabled;
      sp.userData.main = true;
      if (allowShadow){
        sp.castShadow = true;
        sp.shadow.mapSize.setScalar(COARSE ? 256 : 512);
        sp.shadow.bias = -0.003;
        sp.shadow.normalBias = 0.02;
        sp.shadow.camera.near = 0.05;
        sp.shadow.camera.far = shadowFar;
      } else {
        sp.castShadow = false;
      }
      const tg = new THREE.Object3D();
      tg.position.set(x, 0, z);
      this.scene.add(tg);
      sp.target = tg;
      lights.push({ light: sp, base });
      targets.push(tg);
    };

    /** 辅助光源：PointLight，无阴影，短距离（照不到隔壁） */
    const addAux = (x, yPos, z, base) => {
      const pl = new THREE.PointLight(new THREE.Color(hex), 0, auxDist, 1.6);
      pl.position.set(x, yPos, z);
      pl.userData.fid = f.id;
      pl.userData.enabled = enabled;
      pl.castShadow = false;
      lights.push({ light: pl, base });
    };

    let mesh = null;

    switch (f.type){
      case 'ceilround': {
        const r = Math.min(w, d) / 2;
        mesh = this._mesh(new THREE.CylinderGeometry(r, r * .95, .05, 24), mat);
        mesh.position.set(cx, y - .025, cz);
        /* 主光源：中心大锥角 SpotLight 朝下，覆盖整间房；辅助：4 个短距点光补柔光 */
        addMain(cx, y - .1, cz, intensity * 4, 120);
        const per = intensity * 1.2 / 4;
        for (let i = 0; i < 4; i++){
          const a = i * Math.PI / 2 + rot;
          addAux(cx + Math.cos(a) * r * .55, y - .12, cz + Math.sin(a) * r * .55, per);
        }
        break;
      }
      case 'ceilsquare': {
        mesh = this._mesh(new THREE.BoxGeometry(w, .05, d), mat);
        mesh.position.set(cx, y - .025, cz);
        mesh.rotation.y = rot;
        addMain(cx, y - .1, cz, intensity * 4, 120);
        const per = intensity * 1.2 / 4;
        const hw = w * .25, hd = d * .25;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]){
          const lx =  sx * hw, lz = sz * hd;
          addAux(cx + cs * lx - sn * lz, y - .12, cz + sn * lx + cs * lz, per);
        }
        break;
      }
      case 'lightstrip': {
        mesh = this._mesh(new THREE.BoxGeometry(w, .025, d), mat);
        mesh.position.set(cx, y - .013, cz);
        mesh.rotation.y = rot;
        /* 沿长边 2~4 个"主光源"，锥角略小，覆盖条状区域；无辅助光源 */
        const isHoriz = w >= d;
        const L = isHoriz ? w : d;
        const n = Math.max(2, Math.min(4, Math.round(L / .6)));
        const per = intensity * 3 / n;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        for (let i = 0; i < n; i++){
          const t = (i / (n - 1) - .5) * L;
          const lx = isHoriz ? t : 0, lz = isHoriz ? 0 : t;
          addMain(cx + cs * lx - sn * lz, y - .08, cz + sn * lx + cs * lz, per, 100);
        }
        break;
      }
      case 'downlight': {
        const r = Math.min(w, d) / 2;
        mesh = this._mesh(new THREE.CylinderGeometry(r, r, .06, 16), mat);
        mesh.position.set(cx, y - .03, cz);
        addMain(cx, y - .05, cz, intensity * 3, 60);
        break;
      }
      case 'spotlight': {
        const r = Math.min(w, d) / 2;
        mesh = this._mesh(new THREE.CylinderGeometry(r, r * .7, .08, 16), mat);
        mesh.position.set(cx, y - .04, cz);
        addMain(cx, y - .05, cz, intensity * 4, 45);
        break;
      }
      default: return;
    }

    /* 灯体（可见模型）→ lampG（由"灯具"开关控制显隐）
       光源（SpotLight / PointLight）→ lightG（永远 visible，仅由夜景开关控制强度） */
    if (mesh){
      mesh.userData.fid = f.id;
      mesh.userData.isLamp = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.lampG.add(mesh);
    }
    lights.forEach(l => this.lightG.add(l.light));

    /* 光照 = 夜景开关 AND 单灯开关 */
    const on = !!this.opt.night && enabled;
    lights.forEach(l => { l.light.intensity = on ? l.base : 0; });

    this.lamps.push({ lights, targets });
  }

  /* ---------- 房间名标签（CSS2D） ---------- */
  buildLabels(){
    if (!this.labelG) return;
    /* 清掉旧标签（含 DOM 节点） */
    this.labelG.children.slice().forEach(o => {
      if (o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
      this.labelG.remove(o);
    });

    (this.app.store.state.plan.rooms || []).filter(r => r.at).forEach(r => {
      const el = document.createElement('div');
      el.className = 'rlabel3d';
      const name = r.name || '';
      el.textContent = name;
      const obj = new CSS2DObject(el);
      obj.position.set(this.wx(r.at[0]), H + .15, this.wz(r.at[1]));
      this.labelG.add(obj);
    });
    this.labelG.visible = !!this.opt.labels;
    this.labelG.children.forEach(o => { o.visible = !!this.opt.labels; });
  }

  /**
   * 增量同步：把"数据变化类型"分成三类，各自独立处理：
   *   1. 建筑（墙 / 门 / 窗 / 房间 / 地面 / cut） → buildArch()
   *   2. 家具几何（type / cx / cy / w / d / rot / color）→ buildFurn()
   *      否则只更新灯具光照（亮度 / 颜色 / 开关），不重建家具，
   *      这样书架上的书本、绿植叶片等随机摆件就不会变化。
   *   3. 房间名 / labels 开关 → buildLabels()
   */
  sync(force){
    if (!this.inited) return;
    if (!this.active && !force) return;

    const s = this.app.store.state;

    /* ---- 1. 建筑摘要 ---- */
    const archSum = JSON.stringify([
      s.plan.walls, s.plan.doors, s.plan.windows, s.plan.slides,
      s.plan.rooms, s.plan.mats,
      s.layout.demolished, s.layout.demolitions,
      this.opt.cut,
    ]);
    if (force || archSum !== this._archSum){
      this._archSum = archSum;
      this.buildArch();
    }

    /* ---- 2. 家具几何摘要（不含 lamp 字段）---- */
    const furn = s.layout.furniture || [];
    const geoSum = furn.map(f =>
      `${f.id}|${f.type}|${f.cx}|${f.cy}|${f.w}|${f.d}|${f.rot}|${f.color}`
    ).join(';');
    if (force || geoSum !== this._furnGeoSum){
      this._furnGeoSum = geoSum;
      this.buildFurn();
    } else {
      /* 家具几何没变 → 只刷新灯具光照参数（颜色 / 强度 / 开关） */
      this._refreshLamps();
    }

    /* ---- 3. 房间名标签 ---- */
    const labelSum = JSON.stringify([s.plan.rooms, this.opt.labels]);
    if (force || labelSum !== this._labelSum){
      this._labelSum = labelSum;
      this.buildLabels();
    }
  }

  /** 只重建所有灯具（不含普通家具），用于亮度 / 颜色 / 开关微调 */
  _refreshLamps(){
    this._lampShadowCount = 0;   // 重置阴影配额，与全量重建保持一致
    const furn = this.app.store.state.layout.furniture || [];
    furn.forEach(f => { if (CEILING_TYPES.has(f.type)) this._updateLamp(f); });
  }

  /** 重建单盏灯：先移除旧 light + light mesh，再 _buildCeilingLight */
  _updateLamp(f){
    const idx = (this.lamps || []).findIndex(e => e.lights[0]?.light.userData.fid === f.id);
    if (idx >= 0){
      const entry = this.lamps[idx];
      entry.lights.forEach(l => this.lightG.remove(l.light));
      entry.targets.forEach(t => this.scene.remove(t));
      this.lamps.splice(idx, 1);
    }
    const oldMesh = this.lampG.children.find(o => o.userData.fid === f.id);
    if (oldMesh){
      this.lampG.remove(oldMesh);
      if (oldMesh.geometry) oldMesh.geometry.dispose();
    }
    this._buildCeilingLight(f);
  }

  _applyGrow(){
    if (!this.inited) return;
    this.archUp.scale.y = Math.max(this.grow, .001);
    this.furnG.scale.y = Math.max(this.furnGrow, .001);
  }

  _applyLight(){
    const hour = this.opt.hour;
    const month = Math.max(1, Math.min(12, +this.opt.month || 6));
    const day   = Math.max(1, Math.min(31, +this.opt.day   || 21));
    const compass = (this.app.store.state.plan && this.app.store.state.plan.compass)
      || { north: 0, lat: 39.9, lng: 116.4 };
    const lat = Math.max(-89, Math.min(89, +compass.lat || 39.9));
    const northDeg = ((+compass.north || 0) % 360 + 360) % 360;

    /* 年积日 → 太阳赤纬（Spencer 近似，误差 < 0.5°） */
    const mdLen = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let N = day;
    for (let i = 0; i < month - 1; i++) N += mdLen[i];
    const γ = 2 * Math.PI * (N - 1) / 365;
    const δ = 0.006918
            - 0.399912 * Math.cos(γ)     + 0.070257 * Math.sin(γ)
            - 0.006758 * Math.cos(2 * γ) + 0.000907 * Math.sin(2 * γ)
            - 0.002697 * Math.cos(3 * γ) + 0.00148  * Math.sin(3 * γ);

    const φ = lat * Math.PI / 180;
    const ω = (hour - 12) * 15 * Math.PI / 180;                 // 时角
    const sinAlt = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(ω);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));   // 高度角
    const cosAlt = Math.cos(alt) || 1e-4;
    const cosAz = (Math.sin(δ) - Math.sin(alt) * Math.sin(φ)) / (cosAlt * Math.cos(φ) || 1e-4);
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));       // 方位角（0=北，顺时针）
    if (ω > 0) az = 2 * Math.PI - az;                            // 下午在西侧
    az += northDeg * Math.PI / 180;                              // 图纸北向旋转

    /* 场景方向：东 = +x，北 = -z */
    const y = Math.sin(alt);
    const horiz = cosAlt;
    const sx = Math.sin(az) * horiz;
    const sz = -Math.cos(az) * horiz;
    const dir = new THREE.Vector3(sx, y, sz).normalize();
    const dist = 25;
    this.sun.position.copy(dir.clone().multiplyScalar(dist));
    this.sun.target.position.set(0, 0, 0);

    const above = Math.max(0, Math.sin(alt));                    // 0（夜晚）~ 1（正午）
    const warm = 1 - Math.min(1, above * 2);
    this.sun.color.setHSL(.09, .35 + warm * .4, .95 - warm * .12);
    this.sun.intensity = this.opt.night ? .05 : (.15 + above * 2.9);
    this.hemi.intensity = this.opt.night ? .12 : (.35 + above * .65);
    this.scene.background = new THREE.Color(this.opt.night ? 0x1c2130 : 0xf7f4ee);
    this.ground.material.color.set(this.opt.night ? 0x2a2e38 : 0xf2eee7);

    /* 顶灯：夜景开关 + 单灯开关；灯具模型可见性不影响光照 */
    (this.lamps || []).forEach(entry => {
      entry.lights.forEach(l => {
        const en = l.light.userData.enabled !== false;
        l.light.intensity = (this.opt.night && en) ? l.base : 0;
      });
    });

    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    const t2 = $('#sunT');
    if (t2) t2.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  _planPose(){
    const vp = this.app.viewport;
    const SW = this.SW(), SH = this.SH();
    const cx = vp.x0 + SW / 2 / vp.s;
    const cy = vp.y0 + SH / 2 / vp.s;
    const visH = SH / vp.s / 1000;
    const dist = visH / 2 / Math.tan(FOV / 2 * Math.PI / 180);
    const t = new THREE.Vector3(this.wx(cx), 0, this.wz(cy));
    return { t, p: new THREE.Vector3(t.x, dist, t.z + 1e-4) };
  }
  _isoFrom(P){
    const d = Math.max(5, Math.min(30, P.p.y));
    const dir = new THREE.Vector3(.3, .82, .49).normalize();
    return { t: P.t.clone(), p: P.t.clone().addScaledVector(dir, d) };
  }
  _isoWhole(){ return { t: new THREE.Vector3(0, 0, 0), p: new THREE.Vector3(5.5, 15.5, 10) }; }
  _topWhole(){ return { t: new THREE.Vector3(0, 0, 0), p: new THREE.Vector3(0, 19, 1e-4) }; }
  _curPose(){ return { t: this.orbit.target.clone(), p: this.camera.position.clone() }; }
  _camTween(A, B, e){
    const t = A.t.clone().lerp(B.t, e);
    const sa = new THREE.Spherical().setFromVector3(A.p.clone().sub(A.t));
    const sb = new THREE.Spherical().setFromVector3(B.p.clone().sub(B.t));
    let dth = sb.theta - sa.theta;
    dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    const s = new THREE.Spherical(
      sa.radius + (sb.radius - sa.radius) * e,
      sa.phi + (sb.phi - sa.phi) * e,
      sa.theta + dth * e);
    this.camera.position.copy(t).add(new THREE.Vector3().setFromSpherical(s));
    this.camera.lookAt(t);
    this.orbit.target.copy(t);
  }
  _animate(dur, fn){ return new Promise(res => { this.anim = { t0: performance.now(), dur, fn, res }; }); }
  _wait(ms){ return new Promise(r => setTimeout(r, ms)); }
  flyTo(B, dur = 900){ this.fly = { t0: performance.now(), dur, A: this._curPose(), B }; }

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
    this.grow = 0; this.furnGrow = 0; this._applyGrow();
    this.camera.position.copy(A.p);
    this.orbit.target.copy(A.t);
    this.camera.lookAt(A.t);

    this.stage.classList.add('animating');
    this._startLoop();
    this.renderer.render(this.scene, this.camera);
    this.stage.classList.add('is3d');

    await this._wait(420);
    await this._animate(1700, t => {
      this._camTween(A, B, 1 - Math.pow(1 - Math.min(1, t / .85), 3));
      this.grow = 1 - Math.pow(1 - Math.max(0, Math.min(1, (t - .1) / .55)), 3);
      this.furnGrow = 1 - Math.pow(1 - Math.max(0, Math.min(1, (t - .45) / .5)), 3);
      this._applyGrow();
    });
    this.orbit.enabled = true;
    this.stage.classList.remove('animating');
  }

  async exit(){
    if (!this.active) return;
    if (this.walk) this.exitWalk(true);
    this.fly = null;
    this.orbit.enabled = false;
    this.stage.classList.add('animating');
    const A = this._curPose(), B = this._planPose();
    await this._animate(1300, t => {
      const e = Math.max(0, Math.min(1, (t - .1) / .9));
      this._camTween(A, B, 1 - Math.pow(1 - e, 3));
      this.furnGrow = 1 - Math.max(0, Math.min(1, t / .45));
      this.grow = 1 - Math.max(0, Math.min(1, (t - .2) / .6));
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
    /* 清掉标签 DOM，避免 2D 界面残留 */
    if (this.labelG){
      this.labelG.children.slice().forEach(o => {
        if (o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
      });
    }
    if (this.labelRenderer) this.labelRenderer.render(this.scene, this.camera);
  }

  _startLoop(){
    if (this.raf) return;
    this.clock = new THREE.Clock();
    this._lastT = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - this._lastT) / 1000, .05);
      this._lastT = now;

      if (this.anim){
        const t = Math.max(0, Math.min(1, (now - this.anim.t0) / this.anim.dur));
        this.anim.fn(t);
        if (t >= 1){ const r = this.anim.res; this.anim = null; r(); }
      } else if (this.fly){
        const t = Math.max(0, Math.min(1, (now - this.fly.t0) / this.fly.dur));
        const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this._camTween(this.fly.A, this.fly.B, e);
        if (t >= 1) this.fly = null;
      } else if (this.walk){
        this._walkStep(dt);
      } else if (this.opt.mode === 'orbit'){
        this.orbit.update();
      }

      if (this.doors.length){
        this.doors.forEach(d => {
          const tg = d.open ? d.a1 : d.a0;
          d.cur += (tg - d.cur) * Math.min(1, dt * 6);
          d.pivot.rotation.y = d.cur;
        });
      }
      this.renderer.render(this.scene, this.camera);
      if (this.labelRenderer) this.labelRenderer.render(this.scene, this.camera);
    };
    loop();
  }

  _pick(e){
    if (!this.renderer) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ptr = new THREE.Vector2(
      (e.clientX - r.left) / r.width * 2 - 1,
      -(e.clientY - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ptr, this.camera);
    /* 优先拾取灯具，其次家具，最后建筑（墙、门、窗）；
       lampG 里的灯体较小，若放后面会被同位置的家具/天花挡住。 */
    const targets = [this.lampG, this.furnG, this.archUp];
    const hits = ray.intersectObjects(targets, true);
    for (const h of hits){
      if (h.object.material === this.glassMat) continue;
      let o = h.object, isLamp = false;
      while (o && o !== this.scene){
        if (o.userData.isLamp) isLamp = true;
        if (o.userData.door || o.userData.fid || o.userData.room) break;
        o = o.parent;
      }
      if (o?.userData?.door) return { door: o.userData.door, dist: h.distance };
      if (o?.userData?.fid)  return { fid: o.userData.fid, isLamp, dist: h.distance };
      if (o?.userData?.room) return { room: o.userData.room, dist: h.distance };
    }
    return null;
  }

  groundAt(x, y){
    if (!this.active || this.anim) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ptr = new THREE.Vector2(
      (x - r.left) / r.width * 2 - 1,
      -(y - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ptr, this.camera);
    const g = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(g, hit)) return null;
    if (hit.distanceTo(this.camera.position) > 60) return null;
    return { x: hit.x * 1000 + OX, y: hit.z * 1000 + OY, s: .05 };
  }

  setMode(m){
    if (this.anim) return;
    if (m === 'walk'){ this._showWalkOverlay(); document.querySelectorAll('#modes3d .btn').forEach(b => b.classList.toggle('on', b.dataset.mode === 'walk')); return; }
    this._hideWalkOverlay();
    if (this.walk) this.exitWalk(true);
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
    if (key === 'furn'){
      // 家具开关只管家具 mesh；不影响灯具与光照
      this.furnG.visible = !!this.opt.furn;
    }
    if (key === 'lamps'){
      // 灯具开关只隐藏灯具模型（lampG）；光源在 lightG 里，不受影响
      this.lampG.visible = !!this.opt.lamps;
    }
    if (key === 'labels'){
      // 房间名标签显隐
      this.labelG.visible = !!this.opt.labels;
      this.labelG.children.forEach(o => { o.visible = !!this.opt.labels; });
    }
    if (key === 'night'){
      this._applyLight();
      /* 通知工具栏刷新：3D 夜景 → 显示灯光中控 fab；白天 → 隐藏 */
      this.app.toolbar?.sync();
    }
  }
  setHour(v){ this.opt.hour = Math.max(0, Math.min(24, +v || 0)); this._applyLight(); }
  setDate(m, d){
    if (m != null) this.opt.month = Math.max(1, Math.min(12, +m || 6));
    if (d != null) this.opt.day   = Math.max(1, Math.min(31, +d || 21));
    this._applyLight();
  }
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
      this.wz((Math.min(...ys) + Math.max(...ys)) / 2));
    const size = this.M(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    this.flyTo({ t, p: new THREE.Vector3(t.x + size + 3, size * 1.3 + 2.5, t.z + size + 3) });
  }

  _syncHint(){
    const h = $('#hint3d');
    if (!h) return;
    if (this.walk){
      h.textContent = tr('WASD 移动 · 鼠标转向 · Shift 快走 · 滚轮调焦 · E 开门 · Esc 退出',
                        'WASD move · mouse look · Shift run · wheel FOV · E door · Esc exit');
    } else {
      h.textContent = tr('左键旋转 · 右键平移 · 滚轮缩放 · 单击门板开关门 · 点击灯具 / 家具可编辑',
                        'Left-drag orbits · scroll zooms · click a door leaf to open/close · click a light or furniture to edit');
    }
  }
  relang(){ this._syncHint(); if (this.inited) this.buildLabels(); }
  shot(){
    const a = document.createElement('a');
    a.download = tr('户型装修方案', 'floor-plan-design') + '-3D.png';
    a.href = this.renderer.domElement.toDataURL('image/png');
    a.click();
  }
  walking(){ return this.walk != null; }

  /* ---------- 漫游辅助 ---------- */
  _showWalkOverlay(){
    const ov = document.getElementById('walkOverlay');
    if (!ov){ this.enterWalk(); return; }
    const w1 = document.getElementById('wo1'), w2 = document.getElementById('wo2'), w3 = document.getElementById('wo3');
    if (w1) w1.textContent = tr('点击开始，从入户门进入', 'Click to start from the entry door');
    if (w2) w2.textContent = tr('WASD 移动 · 鼠标转向 · Shift 快走', 'WASD to move · mouse to look · Shift to run');
    if (w3) w3.textContent = tr('E 开关正前方的门 · Esc 退出漫游', 'E toggles the door ahead · Esc exits');
    ov.style.display = 'flex';
    ov.onclick = () => { ov.style.display = 'none'; this.enterWalk(); };
  }
  _hideWalkOverlay(){
    const ov = document.getElementById('walkOverlay');
    if (ov) ov.style.display = 'none';
  }
  enterWalk(){
    if (!this.active) return;
    const plan = this.app.store.state.plan;
    const doors = plan.doors || [];
    const entry = doors.find(d => d.entry) || doors[0];
    let px, pz, yaw;
    if (entry){
      const cx = (entry.x0 + entry.x1) / 2;
      const cy = (entry.y0 + entry.y1) / 2;
      const dx = entry.x1 - entry.x0, dy = entry.y1 - entry.y0;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const nx = -uy, ny = ux;
      const sgn = entry.swing === 'out' ? -1 : 1;
      const oX = nx * sgn, oY = ny * sgn;
      px = this.wx(cx - oX * 900);
      pz = this.wz(cy - oY * 900);
      yaw = Math.atan2(-oX, -oY);
    } else {
      const b = plan.bounds || { x: -4000, y: -4000, w: 14000, h: 12000 };
      px = this.wx(b.x + b.w / 2);
      pz = this.wz(b.y + b.h / 2) + 3;
      yaw = 0;
    }
    this.anim = null; this.fly = null;
    this.walk = { x: px, z: pz, y: 1.6, yaw, pitch: 0, speed: 2.4, runMul: 1.8, locked: false, fov: WALK_FOV };
    this.opt.mode = 'walk';
    this.orbit.enabled = false;
    this.camera.fov = WALK_FOV;
    this.camera.updateProjectionMatrix();
    this._applyWalkCam();

    const cross = document.getElementById('cross');
    if (cross) cross.style.display = 'block';
    const joy = document.getElementById('joy');
    if (joy && matchMedia('(pointer:coarse)').matches) joy.style.display = 'block';
    const we = document.getElementById('walkExit');
    if (we){ we.style.display = 'block'; we.textContent = tr('退出漫游', 'Exit walk'); }
    document.querySelectorAll('#modes3d .btn').forEach(b => b.classList.toggle('on', b.dataset.mode === 'walk'));

    try { const p = this.renderer.domElement.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch {}
    this._syncHint();
  }
  exitWalk(silent){
    if (!this.walk) return;
    this.walk = null;
    this._joy = null;
    if (document.pointerLockElement) document.exitPointerLock?.();
    const cross = document.getElementById('cross');
    if (cross) cross.style.display = 'none';
    const joy = document.getElementById('joy');
    if (joy) joy.style.display = 'none';
    const we = document.getElementById('walkExit');
    if (we) we.style.display = 'none';
    this.opt.mode = 'orbit';
    this.orbit.enabled = true;
    this.camera.fov = FOV;
    this.camera.updateProjectionMatrix();
    document.querySelectorAll('#modes3d .btn').forEach(b => b.classList.toggle('on', b.dataset.mode === 'orbit'));
    if (!silent){ this.flyTo(this._isoWhole(), 700); toast(tr('已退出漫游', 'Exited walk mode')); }
    this._syncHint();
  }
  _applyWalkCam(){
    const w = this.walk;
    if (!w) return;
    this.camera.position.set(w.x, w.y, w.z);
    const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw);
    const cp = Math.cos(w.pitch), sp = Math.sin(w.pitch);
    const dir = new THREE.Vector3(-sy * cp, sp, -cy * cp);
    this.camera.lookAt(w.x + dir.x, w.y + dir.y, w.z + dir.z);
  }
  _walkStep(dt){
    const w = this.walk;
    if (!w) return;
    const keys = this.keys;
    let fwd = 0, side = 0;
    if (keys['w'] || keys['arrowup'])    fwd += 1;
    if (keys['s'] || keys['arrowdown'])  fwd -= 1;
    if (keys['a'] || keys['arrowleft'])  side -= 1;
    if (keys['d'] || keys['arrowright']) side += 1;
    if (this._joy){ fwd += this._joy.y; side += this._joy.x; }
    if (fwd || side){
      const len = Math.hypot(fwd, side) || 1;
      fwd /= len; side /= len;
      const sp = w.speed * (keys['shift'] ? w.runMul : 1) * dt;
      const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw);
      const fx = -sy, fz = -cy, rx = cy, rz = -sy;
      w.x += (fx * fwd + rx * side) * sp;
      w.z += (fz * fwd + rz * side) * sp;
      this._walkCollide();
    }
    this._applyWalkCam();
  }
  _walkCollide(){
    const w = this.walk;
    if (!w) return;
    const { plan, layout } = this.app.store.state;
    const R = 0.28;
    const walls = plan.walls || [];
    const doors = plan.doors || [];
    const dem   = layout.demolished || [];
    const dems  = layout.demolitions || [];
    const passThrough = (px, pz, wallId) => {
      const chk = el => {
        if (el.hostWall && el.hostWall !== wallId) return false;
        const d0x = this.wx(el.x0), d0z = this.wz(el.y0);
        const d1x = this.wx(el.x1), d1z = this.wz(el.y1);
        const ddx = d1x - d0x, ddz = d1z - d0z;
        const L2d = ddx * ddx + ddz * ddz || 1;
        const tt = ((px - d0x) * ddx + (pz - d0z) * ddz) / L2d;
        if (tt < 0 || tt > 1) return false;
        const qx = d0x + tt * ddx, qz = d0z + tt * ddz;
        return Math.hypot(px - qx, pz - qz) < R + 0.15;
      };
      for (const d of doors) if (chk(d)) return true;
      for (const dm of dems) if (chk(dm)) return true;
      return false;
    };
    for (let iter = 0; iter < 3; iter++){
      let moved = false;
      for (const wall of walls){
        if (dem.includes(wall.id)) continue;
        const half = (wall.t || 240) / 2000;
        const collR = half + R;
        const x0 = this.wx(wall.x0), z0 = this.wz(wall.y0);
        const x1 = this.wx(wall.x1), z1 = this.wz(wall.y1);
        const dx = x1 - x0, dz = z1 - z0;
        const L2 = dx * dx + dz * dz || 1;
        let t = ((w.x - x0) * dx + (w.z - z0) * dz) / L2;
        t = Math.max(0, Math.min(1, t));
        const cx = x0 + t * dx, cz = z0 + t * dz;
        const ddx = w.x - cx, ddz = w.z - cz;
        const dist = Math.hypot(ddx, ddz);
        if (dist < collR){
          if (passThrough(w.x, w.z, wall.id)) continue;
          const push = (collR - dist) + 1e-4;
          if (dist < 1e-4){
            const invL = 1 / Math.sqrt(L2);
            w.x += -dz * invL * push;
            w.z +=  dx * invL * push;
          } else {
            w.x += ddx / dist * push;
            w.z += ddz / dist * push;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  _toggleDoorAhead(){
    const w = this.walk;
    if (!w || !this.doors.length) return;
    const origin = new THREE.Vector3(w.x, w.y, w.z);
    const dir = new THREE.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    const ray = new THREE.Raycaster(origin, dir, 0, 2.2);
    const hits = ray.intersectObjects(this.doors.map(d => d.pivot), true);
    if (!hits.length) return;
    let o = hits[0].object;
    while (o && !o.userData.door && o !== this.scene) o = o.parent;
    if (o?.userData?.door){
      const d = o.userData.door;
      d.open = !d.open;
      toast(d.open ? tr('开门', 'Opened') : tr('关门', 'Closed'));
    }
  }
}

export default Scene3D;