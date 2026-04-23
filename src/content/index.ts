import { startInjector } from './inject';

/**
 * Content script 엔트리.
 * X/Twitter의 SPA 전환 시에도 계속 작동하도록 주입기를 한 번만 시작하고,
 * MutationObserver가 자동으로 새 compose를 탐지.
 */

if (import.meta.env.DEV) {
  console.info('[xrb] content script loaded on', location.hostname);
}

const stop = startInjector();

declare global {
  interface Window {
    __xrbStop?: () => void;
  }
}
if (typeof window !== 'undefined') {
  window.__xrbStop?.();
  window.__xrbStop = stop;
}
