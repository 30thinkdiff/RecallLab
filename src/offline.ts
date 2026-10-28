// Cache only the public production shell; development origins keep no persistent build cache.
type OfflineState = 'development' | 'preparing' | 'ready' | 'failed';
let state: OfflineState = import.meta.env.PROD ? 'preparing' : 'development';
const listeners = new Set<() => void>();
export const offlineSnapshot = () => state;
export const subscribeOffline = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function update(next: OfflineState) {
  state = next;
  listeners.forEach((listener) => listener());
}
if (import.meta.env.PROD) {
  if (!('serviceWorker' in navigator)) update('failed');
  else
    window.addEventListener('load', () => {
      const timer = setTimeout(() => {
        if (state !== 'ready') update('failed');
      }, 30000);
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}service-worker.js`)
        .then(async () => {
          await navigator.serviceWorker.ready;
          clearTimeout(timer);
          update('ready');
        })
        .catch(() => {
          clearTimeout(timer);
          update('failed');
        });
    });
}
