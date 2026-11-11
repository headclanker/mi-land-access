import './style.css';
import { startApp } from './app/app';
import { registerSW } from 'virtual:pwa-register';

void startApp().catch((err: unknown) => {
  console.error(err);
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = 'Sorry — the map failed to start. Please reload. ' + (err instanceof Error ? err.message : '');
  document.body.append(el);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}
