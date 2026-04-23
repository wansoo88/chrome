import { startInjector } from './inject';

/**
 * Content script 엔트리.
 * X/Twitter의 SPA 전환(pushState) 시에도 계속 작동해야 하므로, 주입기를 한 번만 시작해
 * MutationObserver로 자동 탐지하게 한다.
 */

// 디버그용: 콘솔에 1회 알림 — 프로덕션에서도 남김 (문제 발생 시 유저/개발자 둘 다에게 유용).
console.info('[xrb] content script loaded on', location.hostname);

const stop = startInjector();

// HMR 재적용 시 이전 인스턴스 정리.
declare global {
  interface Window {
    __xrbStop?: () => void;
  }
}
if (typeof window !== 'undefined') {
  window.__xrbStop?.();
  window.__xrbStop = stop;
}
