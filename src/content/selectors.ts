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
  // Fast path: textarea가 article 내부면 동일 article의 tweetText 추출.
  const directArticle = textarea.closest<HTMLElement>(ARTICLE_SELECTOR);
  if (directArticle) {
    const tt = directArticle.querySelector<HTMLElement>(TWEET_TEXT_SELECTOR);
    const text = (tt?.innerText ?? '').trim();
    if (text) return text;
  }

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
  const target = best?.el ?? articles[0];
  if (!target) return null;
  const tt = target.querySelector<HTMLElement>(TWEET_TEXT_SELECTOR);
  const text = (tt?.innerText ?? '').trim();
  return text || null;
}
