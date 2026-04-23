# Skill: X.com DOM 주입 레시피

> X.com의 compose/reply 영역을 안정적으로 찾아 ✨ 버튼을 주입하고,
> Shadow DOM 팝오버로 3안을 표시하며, 삽입은 React 내부 상태까지 반영하는 패턴.

## 배경 — 왜 까다로운가

X.com은 React 기반 SPA + 잦은 selector 변경. 단순 `textContent = ...` 주입은 React state를 업데이트 못해 전송 시 빈 트윗이 나간다. 아래 패턴은 2026-04 시점 안정적.

## 1. 컴포즈 영역 탐지 (다중 폴백)

```ts
// src/content/selectors.ts
export const COMPOSE_SELECTORS = [
  '[data-testid="tweetTextarea_0"]',               // 우선
  '[role="textbox"][contenteditable="true"]',      // fallback 1
  'div[aria-label][contenteditable="true"]',       // fallback 2
];

export function findComposeElements(root: Document | Element = document) {
  const found = new Set<Element>();
  for (const sel of COMPOSE_SELECTORS) {
    root.querySelectorAll(sel).forEach((el) => found.add(el));
  }
  return [...found];
}
```

X가 selector를 바꾸면 첫 폴백이 커버. 유지보수 시 이 배열만 업데이트.

## 2. 버튼 주입 (MutationObserver + 디바운스)

```ts
// src/content/inject.ts
let debounceId: number | null = null;

function mountButtons() {
  for (const textarea of findComposeElements()) {
    if ((textarea as any).__xrbMounted) continue;
    (textarea as any).__xrbMounted = true;
    
    const host = document.createElement('div');
    host.className = 'xrb-host';
    host.style.display = 'inline-block';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>/* shadow-scoped CSS here */</style>
      <button class="xrb-button" aria-label="Generate replies">✨</button>
    `;
    
    // textarea 옆에 배치. 보통 상위 Toolbar div의 끝에 붙임.
    const toolbar = textarea.closest('[role="group"]') || textarea.parentElement;
    toolbar?.appendChild(host);
    
    shadow.querySelector('.xrb-button')?.addEventListener('click', () => {
      openPopover(textarea as HTMLElement);
    });
  }
}

const observer = new MutationObserver(() => {
  if (debounceId) cancelAnimationFrame(debounceId);
  debounceId = requestAnimationFrame(mountButtons);
});
observer.observe(document.body, { childList: true, subtree: true });

mountButtons(); // 초기 1회
```

- `__xrbMounted` 플래그로 중복 주입 방지
- `requestAnimationFrame` 디바운스 — X의 잦은 DOM 변경에서 CPU 보호
- Shadow DOM으로 X CSS와 완전 격리 (다크/라이트 테마만 외부에서 주입)

## 3. 원본 트윗 컨텍스트 수집

답변 모드에서는 "무엇에 답하는가"가 필요. X의 답변 폼은 보통 원 트윗 바로 아래에 있다.

```ts
export function getOriginalTweetContext(textarea: HTMLElement): string | null {
  // textarea 상위에서 가장 가까운 '원 트윗' article 탐색
  let el: HTMLElement | null = textarea;
  while (el && el !== document.body) {
    const article = el.parentElement?.closest('article[role="article"]');
    if (article) {
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      if (tweetText) return (tweetText as HTMLElement).innerText.slice(0, 500);
    }
    el = el.parentElement;
  }
  return null;
}
```

## 4. 초안(DRAFT_SO_FAR) 읽기

스레드 힌트 모드에서 현재 입력 중인 텍스트 필요.

```ts
export function readDraft(textarea: HTMLElement): string {
  // X의 textarea는 contenteditable div — textContent를 쓰면 개행이 손실
  return (textarea as HTMLElement).innerText.trim();
}
```

## 5. 삽입 — React state까지 반영하는 패턴 ⭐

단순 `el.innerText = text`는 작동하지 않는다. React의 controlled input은 `InputEvent`를 거쳐야 상태가 갱신된다.

```ts
export function insertIntoTextarea(textarea: HTMLElement, text: string) {
  textarea.focus();
  
  // 전체 선택 후 삭제
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  
  // 텍스트 삽입 — execCommand는 레거시지만 X에서 가장 안정적
  document.execCommand('insertText', false, text);
  
  // 안전망: React가 value prop를 다시 읽도록 input 이벤트 발사
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
}
```

`execCommand('insertText')`는 deprecated 경고가 뜨지만 **현재 Chrome에서 X React 상태를 갱신하는 유일한 안정적 방법**. 미래 대체(Input Events Level 2)가 X에 적용될 때 교체.

## 6. 팝오버 UI (Shadow DOM)

```ts
function openPopover(anchor: HTMLElement) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:99999;';
  const shadow = host.attachShadow({ mode: 'open' });
  
  // 위치: 앵커 바로 위 또는 아래 (viewport 경계 체크)
  const rect = anchor.getBoundingClientRect();
  host.style.top = `${rect.bottom + 8}px`;
  host.style.left = `${rect.left}px`;
  
  shadow.innerHTML = `
    <style>
      .popover { background: var(--bg, #fff); border: 1px solid rgba(0,0,0,.1);
                 border-radius: 12px; padding: 12px; min-width: 360px;
                 box-shadow: 0 10px 40px rgba(0,0,0,.15); font: 14px system-ui; }
      .card { padding: 10px; border-radius: 8px; margin-bottom: 8px; cursor: pointer; }
      .card:hover { background: rgba(0,0,0,.05); }
    </style>
    <div class="popover"><!-- 카드 렌더 --></div>
  `;
  document.body.appendChild(host);
  
  // outside click으로 닫기
  const onOutside = (e: Event) => {
    if (!host.contains(e.target as Node)) {
      host.remove();
      document.removeEventListener('mousedown', onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}
```

## 7. 디버깅 체크리스트

- 버튼이 안 보임 → DevTools에서 `.xrb-host` 존재 확인. 없으면 selector 업데이트 필요.
- 삽입 후 전송 시 빈 트윗 → `execCommand('insertText')` 대신 `document.dispatchEvent(new InputEvent(...))` 직접 호출로 변경 시도
- 테마 안 맞음 → `document.documentElement.style.colorScheme` 읽어서 Shadow DOM `--bg` CSS 변수로 주입
