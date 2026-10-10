import { clamp } from '../core/Utils.js';

const PX_MM = 25.4 / 96;   // 1 CSS px = 0.2646 mm

/**
 * 2D 视口：管理 SVG 的 viewBox，负责缩放 / 平移 / 屏幕坐标 ↔ 户型坐标换算。
 */
export class Viewport {
  constructor(svg){
    this.svg = svg;
    this.x0 = 0; this.y0 = 0;   // viewBox 左上角（户型 mm）
    this.s = 0.06;              // 缩放：px / mm
    this._listeners = new Set();
  }
  get W(){ return this.svg.clientWidth || 1; }
  get H(){ return this.svg.clientHeight || 1; }
  get ratio(){ return 1 / (this.s * PX_MM); }  // 显示比例 1:N

  onChange(fn){ this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit(){ this._listeners.forEach(fn => fn()); }

  apply(){
    const W = this.svg.clientWidth, H = this.svg.clientHeight;
    if (!W || !H) return;                              // 尺寸未就绪，跳过（否则算出天文级 viewBox）
    this.svg.setAttribute('viewBox', `${this.x0} ${this.y0} ${W / this.s} ${H / this.s}`);
    this.emit();
  }

  /**
   * 适配到指定范围（bounds: {x, y, w, h}）。
   * @returns {boolean} 尺寸就绪并执行 → true；尺寸为 0 → false（调用方应重试）
   */
  fit(bounds, pad = 1.0){
    const W = this.svg.clientWidth, H = this.svg.clientHeight;
    if (!W || !H || !bounds || !bounds.w || !bounds.h) return false;
    this.s = Math.min(W / bounds.w, H / bounds.h) / pad;
    // 保险：s 太小/太大直接钳制到合理范围
    this.s = clamp(this.s, 0.012, 2);
    this.x0 = bounds.x - (W / this.s - bounds.w) / 2;
    this.y0 = bounds.y - (H / this.s - bounds.h) / 2;
    this.apply();
    return true;
  }

  zoomAt(ns, mx, my){
    ns = clamp(ns, 0.012, 2);
    const px = this.x0 + mx / this.s, py = this.y0 + my / this.s;
    this.s = ns;
    this.x0 = px - mx / ns;
    this.y0 = py - my / ns;
    this.apply();
  }
  zoomBy(k){ this.zoomAt(this.s * k, this.W / 2, this.H / 2); }
  setRatio(r){ this.zoomAt(1 / (r * PX_MM), this.W / 2, this.H / 2); }
  panBy(dxPx, dyPx){ this.x0 -= dxPx / this.s; this.y0 -= dyPx / this.s; this.apply(); }

  /** 屏幕事件 → 户型坐标（mm） */
  toMM(e){
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }
  /** 屏幕像素坐标 → SVG 局部像素（用于拖动平滑） */
  svgXY(x, y){
    const r = this.svg.getBoundingClientRect();
    return [x - r.left, y - r.top];
  }
}