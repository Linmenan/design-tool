/**
 * 入口：创建 App 实例并启动。
 * 加载失败时给出可见提示，避免"白屏无提示"。
 */
import { App } from './core/App.js';

const app = new App();
window.__app = app;                      // 调试用；也可以在控制台里操作

app.boot().catch(err => {
  console.error('[boot]', err);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f3efe7;color:#2b2824;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;padding:24px;text-align:center;z-index:9999';
  el.innerHTML = '<div><h2>启动失败</h2><p>' + (err?.message || String(err)) + '</p></div>';
  document.body.appendChild(el);
});

export default app;