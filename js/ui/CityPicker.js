import { CITIES } from '../data/cities.js';
import { tr } from '../core/I18n.js';

/**
 * 城市搜索选择器。
 * 用法：
 *   new CityPicker(inputEl, { onChange: city => {...} });
 * - 输入时下拉候选（名称包含 / 省份包含），按匹配位置排序；
 * - 支持 ↑ ↓ Enter Esc；
 * - 失焦时若非合法城市名，则回滚到上一个合法值；
 * - 全局单例：新建实例会自动销毁旧实例（避免下拉 DOM 累积）。
 */
export class CityPicker {
  constructor(input, { onChange, max = 60 } = {}){
    // 全局单例
    if (window.__activeCityPicker && window.__activeCityPicker !== this){
      try { window.__activeCityPicker.destroy(); } catch {}
    }
    window.__activeCityPicker = this;

    this.input = input;
    this.onChange = onChange;
    this.max = max;
    this.value = input.value.trim();   // 当前合法城市名（用于回滚）
    this.items = [];
    this.sel = -1;
    this._composing = false;

    this.pop = document.createElement('div');
    this.pop.className = 'city-picker-pop';
    document.body.appendChild(this.pop);

    this._bind();
  }

  _bind(){
    const inp = this.input;
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('spellcheck', 'false');

    inp.addEventListener('focus', () => this._open());
    inp.addEventListener('input', () => this._update());
    inp.addEventListener('keydown', e => this._key(e));
    inp.addEventListener('blur', () => setTimeout(() => this._close(true), 180));
    inp.addEventListener('compositionstart', () => { this._composing = true; });
    inp.addEventListener('compositionend', () => { this._composing = false; this._update(); });
  }

  _update(){
    if (this._composing) return;
    const q = (this.input.value || '').trim();
    let hits = [];
    if (!q){
      hits = CITIES.slice(0, this.max);
    } else {
      const arr = [];
      for (const c of CITIES){
        const i = c.name.indexOf(q);
        if (i >= 0){ arr.push({ c, s: i }); continue; }
        if (c.province.indexOf(q) >= 0) arr.push({ c, s: 100 });
      }
      arr.sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name));
      hits = arr.slice(0, this.max).map(x => x.c);
    }
    this.items = hits;
    this.sel = hits.length ? 0 : -1;
    this._render();
  }

  _render(){
    if (!this.items.length){
      this.pop.innerHTML = `<div class="cp-empty">${tr('无匹配城市，请继续输入', 'No matching city')}</div>`;
    } else {
      this.pop.innerHTML = this.items.map((c, i) =>
        `<div class="cp-item ${i === this.sel ? 'on' : ''}" data-i="${i}">
           <span>${c.name}</span><small>${c.province}</small>
         </div>`).join('');
      this.pop.querySelectorAll('.cp-item').forEach(el => {
        el.addEventListener('mousedown', e => { e.preventDefault(); this._pick(+el.dataset.i); });
        el.addEventListener('mousemove', () => {
          const i = +el.dataset.i;
          if (i !== this.sel){ this.sel = i; this._highlight(); }
        });
      });
    }
    this._place();
    this.pop.classList.add('show');
  }

  _highlight(){
    this.pop.querySelectorAll('.cp-item').forEach((el, i) => el.classList.toggle('on', i === this.sel));
  }

  _place(){
    const r = this.input.getBoundingClientRect();
    const w = Math.max(220, Math.min(360, r.width));
    const H = Math.min(280, this.pop.scrollHeight || 260);
    let top = r.bottom + 4;
    if (r.bottom + H + 8 > window.innerHeight) top = Math.max(8, r.top - 4 - H);
    Object.assign(this.pop.style, {
      left: r.left + 'px', top: top + 'px', width: w + 'px', maxHeight: H + 'px',
    });
  }

  _key(e){
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape'){
      if (!this.pop.classList.contains('show') && e.key !== 'ArrowDown') return;
    } else return;
    if (e.key === 'ArrowDown'){
      e.preventDefault();
      if (!this.items.length) this._open();
      this.sel = Math.min(this.items.length - 1, this.sel + 1);
      this._highlight();
    } else if (e.key === 'ArrowUp'){
      e.preventDefault();
      this.sel = Math.max(0, this.sel - 1);
      this._highlight();
    } else if (e.key === 'Enter'){
      e.preventDefault();
      if (this.sel >= 0) this._pick(this.sel);
    } else if (e.key === 'Escape'){
      e.preventDefault();
      this._close(true);
      this.input.blur();
    }
  }

  _pick(i){
    const c = this.items[i];
    if (!c) return;
    this.input.value = c.name;
    this.value = c.name;
    this._close(false);
    this.onChange?.(c);
  }

  _open(){ this._update(); }

  /** validate=true 时校验当前文本，非法则回滚到 this.value */
  _close(validate){
    this.pop.classList.remove('show');
    if (validate !== true) return;
    const v = (this.input.value || '').trim();
    const hit = CITIES.find(c => c.name === v);
    if (hit){
      this.value = v;
      if (this.input.value !== v) this.input.value = v;
    } else {
      this.input.value = this.value;
    }
  }

  destroy(){
    if (this.pop && this.pop.parentNode) this.pop.parentNode.removeChild(this.pop);
    if (window.__activeCityPicker === this) window.__activeCityPicker = null;
  }
}