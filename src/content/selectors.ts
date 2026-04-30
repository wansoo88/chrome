/**
 * X.com DOM selector 폴백 체인.
 * 상위가 우선. X가 구조를 바꾸면 아래쪽 selector가 흡수.
 *
 * TODO(유지보수): 언젠가 ✨ 버튼이 X에서 안 보이면, DevTools → Elements로
 * 새 textarea의 data-testid/role/aria-label을 캡처해 **배열 맨 위**에 추가하라.
 * 하위 폴백은 호환성을 위해 그대로 남겨두는 게 안전.
 */
export const COMPOSE_SELECTORS: readonly string[] = [
  '[data-testid="tweetTextarea_0"]',
  '[data-testid^="tweetTextarea_"]',
  'div[role="textbox"][contenteditable="true"][aria-label]',
  'div[contenteditable="true"][aria-multiline="true"]',
] as const;

export const ARTICLE_SELECTOR = 'article[role="article"]';
export const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';

export function findComposeTextareas(root: ParentNode = document): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  for (const sel of COMPOSE_SELECTORS) {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (isVisible(el)) seen.add(el);
    });
  }
  return [...seen];
}

/**
 * 가시성 체크 — 먼저 offsetParent로 reflow 없이 판정하고, 통과한 경우만
 * getBoundingClientRect로 치수 검증. 이 2단계가 layout thrashing을 크게 줄임.
 */
function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && el.offsetWidth === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * 답장 컨텍스트의 원 트윗 추출. 우선순위:
 *   1) textarea가 article 내부 또는 직접 closest — O(depth) 빠른 경로
 *   2) dialog 모달 scope에서 textarea 상단의 가장 가까운 article
 *   3) 전체 document에서 가장 가까운 article (폴백)
 */
export function findOriginalTweet(textarea: HTMLElement): string | null {
  const article = pickReplyTargetArticle(textarea);
  if (!article) return null;
  const tt = article.querySelector<HTMLElement>(TWEET_TEXT_SELECTOR);
  const text = (tt?.innerText ?? '').trim();
  return text || null;
}

/**
 * 스레드 부모 컨텍스트 추출 — 답변 품질의 결정적 차이.
 * 직접 답변 대상(가장 가까운 article) 위쪽에 있는 0..N개의 article들을 스크롤 위 → 아래 순으로 모은다.
 *
 * 동작:
 * - 모달 답글: dialog 내 모든 article을 답글 대상 위쪽에서 모음.
 * - 페이지 답글(/i/status/...): 같은 timeline 컨테이너에서 답글 대상 위쪽 article을 모음.
 * - 최대 4개까지 (오래된 → 최신 순). 각 트윗은 280자 내라 4*280=1120자 ≈ 토큰 부담 적음.
 *
 * 반환값은 oldest-first 배열. 답변 대상 자체(=findOriginalTweet 결과)는 *제외*하여 중복 회피.
 */
const MAX_THREAD_PARENTS = 4;

export function findThreadContext(textarea: HTMLElement): string[] {
  const target = pickReplyTargetArticle(textarea);
  if (!target) return [];

  const dialog = textarea.closest('[role="dialog"]');
  const scope: ParentNode = dialog ?? document;
  const articles = Array.from(scope.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR));
  if (articles.length <= 1) return [];

  // target보다 화면상 위에 있는 article들만 — DOM 순서 = 시간 순서 (오래된 → 최신).
  const targetRect = target.getBoundingClientRect();
  const parents: HTMLElement[] = [];
  for (const art of articles) {
    if (art === target) continue;
    const r = art.getBoundingClientRect();
    if (r.bottom <= targetRect.top + 4) parents.push(art);
  }
  if (!parents.length) return [];

  // 최근 N개만 (스레드가 길어도 토큰 폭주 방지). DOM 순서 유지 = 오래된 → 최신.
  const trimmed = parents.slice(-MAX_THREAD_PARENTS);

  const out: string[] = [];
  for (const art of trimmed) {
    const tt = art.querySelector<HTMLElement>(TWEET_TEXT_SELECTOR);
    const text = (tt?.innerText ?? '').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * 답변 대상 article 선정. findOriginalTweet과 findThreadContext 양쪽이 공유.
 */
function pickReplyTargetArticle(textarea: HTMLElement): HTMLElement | null {
  const directArticle = textarea.closest<HTMLElement>(ARTICLE_SELECTOR);
  if (directArticle) return directArticle;

  const dialog = textarea.closest('[role="dialog"]');
  const scope: ParentNode = dialog ?? document;
  const articles = Array.from(scope.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR));
  if (!articles.length) return null;

  const taRect = textarea.getBoundingClientRect();
  let best: { el: HTMLElement; dist: number } | null = null;
  for (const art of articles) {
    const rect = art.getBoundingClientRect();
    if (rect.bottom <= taRect.top + 4) {
      const dist = taRect.top - rect.bottom;
      if (!best || dist < best.dist) best = { el: art, dist };
    }
  }
  return best?.el ?? articles[0] ?? null;
}
