import { bus } from '../core/EventBus.js';
import { tr } from '../core/I18n.js';
import { $, toast } from '../core/Utils.js';

/**
 * StageManager — 两阶段切换
 *
 *   'edit'   户型编辑（画墙 / 门窗 / 房间 / 精确输入）
 *   'layout' 装修布置（家具 / 地面 / 3D）
 *
 * 切换时：
 *   - 更新 <body> 的 data-stage 属性
 *   - 顶栏重建（Toolbar.rebuild）
 *   - 侧栏内容重建
 *   - 若从 layout 切到 edit，先切回 2D
 */
export class StageManager {
  constructor(app){
    this.app = app;
    this.current = null;
    this.badge = $('#stageBadge');
  }

  async enter(name){
    if (this.current === name) return;
    if (name === 'edit' && this.app.view.mode === '3d'){
      await this.app.setViewMode('2d');
    }
    this.current = name;
    document.getElementById('app').dataset.stage = name;
    // 切阶段时清掉可能残留的光标标签与轮盘
    document.getElementById('toolCursor')?.classList.remove('show');
    this.app.hideRadial?.();
    this.syncBadge();
    this.app.toolbar?.rebuild();
    this.app.libPanel?.mount();
    this.app.propPanel?.render();
    this.app.view2d?.onStageChange(name);
    bus.emit('stage:changed', name);
    toast(name === 'edit' ? tr('已进入户型编辑', 'Plan edit stage') : tr('已进入装修布置', 'Layout stage'));
  }

  syncBadge(){
    if (!this.badge) return;
    this.badge.textContent = this.current === 'edit' ? tr('户型编辑', 'Plan Edit') : tr('装修布置', 'Layout');
  }
}