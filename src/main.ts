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
  // After the first view has settled: installing the worker downloads the whole app again for
  // offline use, which should not compete with the map's own first requests.
  const register = (): void => void registerSW({ immediate: true });
  const later = (): void => void ('requestIdleCallback' in window ? requestIdleCallback(register, { timeout: 8000 }) : setTimeout(register, 4000));
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}
