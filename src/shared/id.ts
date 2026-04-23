/**
 * UUID 생성 — crypto.randomUUID가 있으면 사용, 아니면 폴백.
 * MV3 service worker는 crypto API를 지원하므로 실질적으로 항상 표준 경로.
 */
export function uid(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}-${raw}` : raw;
}
