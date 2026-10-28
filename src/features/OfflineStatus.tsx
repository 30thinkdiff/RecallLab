import { useSyncExternalStore } from 'react';
import { offlineSnapshot, subscribeOffline } from '../offline';
export function OfflineStatus() {
  const state = useSyncExternalStore(subscribeOffline, offlineSnapshot);
  if (state === 'development') return null;
  return (
    <span aria-live="polite">
      {state === 'ready'
        ? '基础学习已准备离线使用'
        : state === 'preparing'
          ? '正在准备离线使用…'
          : '离线缓存尚未就绪，请保持本机服务可用'}
    </span>
  );
}
