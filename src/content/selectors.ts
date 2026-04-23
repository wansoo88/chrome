/**
 * X.com DOM selector 폴백 체인.
 * 상위가 우선. X가 구조를 바꾸면 아래쪽 selector가 흡수.
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

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * 답장 컨텍스트의 원 트윗 추출 — textarea 위쪽의 가장 가까운 article에서 tweetText를 찾는다.
 * 찾지 못하면 null.
 */
export function findOriginalTweet(textarea: HTMLElement): string | null {
  // 1) textarea를 감싸는 dialog/layer가 있으면 그 안에서 먼저 탐색.
  const dialog = textarea.closest('[role="dialog"]');
  const scope: ParentNode = dialog ?? document;

  const articles = Array.from(scope.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR));
  if (!articles.length) return null;

  // 2) textarea보다 "위쪽"에 있는 article 중 가장 가까운 것.
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
