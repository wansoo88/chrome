import type { ClientMsg, ServerMsg } from '@/shared/messages';
import { findComposeTextareas, findOriginalTweet } from './selectors';

/**
 * X 컴포즈 영역 옆에 ✨ 버튼을 주입하고, 클릭 시 팝오버를 열어 3안을 표시.
 *
 * 동작 원칙:
 * - Shadow DOM으로 CSS 완전 격리 (X의 테마 변수는 외부에서 읽어 변수로 주입).
 * - MutationObserver + requestAnimationFrame 디바운스로 잦은 DOM 변경에 대응.
 * - 이미 장착된 textarea는 WeakSet으로 중복 방지 → 메모리 누수 없음.
 */

const MOUNTED = new WeakSet<HTMLElement>();
let rafId: number | null = null;
let currentPopover: PopoverHandle | null = null;

export function startInjector(): () => void {
  const observer = new MutationObserver(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      scanAndMount();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // 초기 1회.
  scanAndMount();
  return () => {
    observer.disconnect();
    if (rafId !== null) cancelAnimationFrame(rafId);
    currentPopover?.close();
  };
}

function scanAndMount() {
  for (const ta of findComposeTextareas()) {
    if (MOUNTED.has(ta)) continue;
    MOUNTED.add(ta);
    mountButton(ta);
  }
}

function mountButton(textarea: HTMLElement) {
  // 상위 toolbar를 찾아 그 오른쪽 끝에 버튼을 붙임.
  // toolbar가 없으면 textarea 바로 옆에 배치.
  const toolbar = findToolbarFor(textarea);
  const host = document.createElement('span');
  host.className = 'xrb-host';
  host.style.cssText =
    'display:inline-flex;align-items:center;margin-left:6px;vertical-align:middle;position:relative;z-index:10;';
  host.setAttribute('data-xrb', 'anchor');

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 9999px;
        cursor: pointer;
        font-size: 18px;
        background: rgba(29, 155, 240, 0.1);
        color: rgb(29, 155, 240);
        transition: background 120ms ease;
        user-select: none;
      }
      .btn:hover { background: rgba(29, 155, 240, 0.2); }
      .btn:active { transform: scale(0.96); }
      .btn[disabled] { opacity: 0.5; cursor: wait; }
    </style>
    <button class="btn" title="X Reply Booster — generate 3 in-voice replies" aria-label="X Reply Booster">✨</button>
  `;

  if (toolbar) {
    toolbar.appendChild(host);
  } else {
    textarea.parentElement?.insertBefore(host, textarea.nextSibling);
  }

  const button = shadow.querySelector<HTMLButtonElement>('.btn');
  button?.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void openPopoverFor(textarea, button);
  });

  // textarea가 DOM에서 제거되면 버튼도 정리.
  const lifeWatcher = new MutationObserver(() => {
    if (!document.contains(textarea)) {
      host.remove();
      lifeWatcher.disconnect();
    }
  });
  lifeWatcher.observe(document.body, { childList: true, subtree: true });
}

function findToolbarFor(textarea: HTMLElement): HTMLElement | null {
  // X는 컴포즈 툴바를 `[data-testid="toolBar"]` 또는 그 후속에 둠.
  // DOM 탐색 범위를 textarea의 상위 5단계로 제한 → 오작동 방지.
  let el: HTMLElement | null = textarea;
  for (let i = 0; i < 6 && el; i++) {
    const scope: HTMLElement | null = el.parentElement;
    if (!scope) break;
    const candidate: HTMLElement | null =
      scope.querySelector<HTMLElement>('[data-testid="toolBar"]') ??
      scope.querySelector<HTMLElement>('[role="group"]');
    if (candidate) return candidate;
    el = scope;
  }
  return null;
}

interface PopoverHandle {
  close(): void;
}

async function openPopoverFor(textarea: HTMLElement, anchor: HTMLElement): Promise<void> {
  currentPopover?.close();

  const draft = readDraft(textarea);
  const original = findOriginalTweet(textarea);
  const mode: 'reply' | 'threadHint' = draft.length > 0 ? 'threadHint' : 'reply';

  const ui = createPopoverAt(anchor);
  currentPopover = ui;
  ui.showLoading();

  // background에 생성 요청. activePersonaId는 background가 내부 state에서 해결.
  const req: ClientMsg = {
    kind: 'generate',
    mode,
    originalTweet: original,
    draft: mode === 'threadHint' ? draft : null,
    personaId: null,
  };

  let res: ServerMsg;
  try {
    res = await chrome.runtime.sendMessage(req);
  } catch (e) {
    ui.showError(
      'Could not reach the extension background. Try reloading the page.',
      (e as Error).message,
    );
    return;
  }

  if (!res || (res as ServerMsg).ok === false) {
    const err = res as Extract<ServerMsg, { ok: false }>;
    ui.showError(err.message || 'Unknown error', err.code);
    return;
  }
  const ok = res as Extract<ServerMsg, { kind?: undefined; ok: true }>;
  if ('suggestions' in ok) {
    ui.showSuggestions(ok.suggestions, ok.remainingToday, (text) => {
      insertIntoTextarea(textarea, text);
      ui.close();
    });
  } else {
    ui.showError('Unexpected response.', 'INVALID_RESPONSE');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// draft / insert
// ──────────────────────────────────────────────────────────────────────────

function readDraft(textarea: HTMLElement): string {
  return (textarea.innerText ?? '').replace(/ /g, ' ').trim();
}

/**
 * X의 React controlled input에 값을 반영하는 유일하게 안정적인 경로.
 * execCommand는 deprecated이지만 2026-04 기준 Chrome + X 조합에서 작동 확인.
 */
function insertIntoTextarea(textarea: HTMLElement, text: string) {
  textarea.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(textarea);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  try {
    document.execCommand('delete', false);
    document.execCommand('insertText', false, text);
  } catch {
    // 폴백 — innerText 교체 후 InputEvent 발사. React가 못 읽는 경우가 있으나 최후 수단.
    textarea.innerText = text;
  }
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
}

// ──────────────────────────────────────────────────────────────────────────
// 팝오버 UI (Shadow DOM, vanilla — React 번들을 content에 넣지 않기 위함)
// ──────────────────────────────────────────────────────────────────────────

function createPopoverAt(anchor: HTMLElement): PopoverHandle & {
  showLoading: () => void;
  showError: (msg: string, code?: string) => void;
  showSuggestions: (s: string[], remaining: number | null, onPick: (t: string) => void) => void;
} {
  const host = document.createElement('div');
  host.setAttribute('data-xrb', 'popover');
  host.style.cssText = 'position:fixed;z-index:2147483647;';

  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const width = Math.min(420, vw - 24);
  let left = rect.left;
  if (left + width > vw - 12) left = vw - width - 12;
  if (left < 12) left = 12;
  const top = rect.bottom + 8;

  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  host.style.width = `${width}px`;

  const shadow = host.attachShadow({ mode: 'open' });
  const isDark =
    (document.documentElement.style.colorScheme || '').includes('dark') ||
    document.documentElement.getAttribute('data-color-mode') === 'dark' ||
    matchMedia('(prefers-color-scheme: dark)').matches;

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap {
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: ${isDark ? '#e7e9ea' : '#0f1419'};
        background: ${isDark ? '#15202b' : '#ffffff'};
        border: 1px solid ${isDark ? '#2f3336' : 'rgba(0,0,0,0.08)'};
        border-radius: 14px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        padding: 10px;
        max-height: 70vh;
        overflow: auto;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 6px 8px;
        font-weight: 600;
      }
      .head .meta {
        font-weight: 400;
        opacity: 0.7;
        font-size: 12px;
      }
      .card {
        padding: 10px 12px;
        border-radius: 10px;
        margin-bottom: 8px;
        background: ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'};
        cursor: pointer;
        white-space: pre-wrap;
        word-break: break-word;
        transition: background 120ms ease, transform 100ms ease;
      }
      .card:hover { background: ${isDark ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.1)'}; }
      .card:active { transform: scale(0.99); }
      .card:last-child { margin-bottom: 0; }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 6px 2px 0;
        font-size: 12px;
        opacity: 0.7;
      }
      .spinner {
        width: 16px; height: 16px; border-radius: 50%;
        border: 2px solid ${isDark ? '#2f3336' : 'rgba(0,0,0,0.1)'};
        border-top-color: rgb(29,155,240);
        animation: spin 0.8s linear infinite;
        display: inline-block;
        vertical-align: middle;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .err {
        padding: 10px 12px;
        border-radius: 10px;
        background: ${isDark ? 'rgba(244,33,46,0.1)' : 'rgba(244,33,46,0.08)'};
        color: ${isDark ? '#ff8593' : '#b81421'};
        font-size: 13px;
      }
      .err code {
        font: 11px monospace;
        opacity: 0.7;
      }
      .btn {
        all: unset;
        cursor: pointer;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgb(29,155,240);
        color: white;
        font-weight: 600;
        font-size: 12px;
      }
      .btn:hover { background: rgb(26,140,216); }
      .btn.ghost { background: transparent; color: inherit; border: 1px solid ${isDark ? '#2f3336' : 'rgba(0,0,0,0.1)'}; }
    </style>
    <div class="wrap" role="dialog" aria-label="X Reply Booster suggestions">
      <div class="head"><span>✨ Suggestions</span><span class="meta" data-slot="meta"></span></div>
      <div data-slot="body"></div>
      <div class="row" data-slot="footer"></div>
    </div>
  `;

  document.body.appendChild(host);

  const body = shadow.querySelector<HTMLElement>('[data-slot="body"]')!;
  const meta = shadow.querySelector<HTMLElement>('[data-slot="meta"]')!;
  const footer = shadow.querySelector<HTMLElement>('[data-slot="footer"]')!;

  const close = () => {
    host.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
    if (currentPopover === handle) currentPopover = null;
  };
  const onOutside = (e: Event) => {
    if (!host.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      close();
    }
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  // 다음 tick부터 outside click 인식 (열 때의 클릭이 바로 닫히는 것 방지).
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
  }, 0);

  const handle = {
    close,
    showLoading() {
      body.innerHTML = `<div class="card"><span class="spinner"></span> &nbsp; Generating 3 variants…</div>`;
      meta.textContent = '';
      footer.textContent = '';
    },
    showError(msg: string, code?: string) {
      body.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'err';
      div.textContent = msg;
      if (code) {
        const c = document.createElement('div');
        c.innerHTML = `<code>${code}</code>`;
        div.appendChild(c);
      }
      body.appendChild(div);
      const footerBtn = document.createElement('button');
      footerBtn.className = 'btn ghost';
      footerBtn.textContent = 'Open Options';
      footerBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ kind: 'ping' }).catch(() => void 0);
        chrome.runtime.openOptionsPage?.();
      });
      footer.innerHTML = '';
      footer.appendChild(footerBtn);
    },
    showSuggestions(items: string[], remaining: number | null, onPick: (t: string) => void) {
      body.innerHTML = '';
      for (const text of items) {
        const card = document.createElement('div');
        card.className = 'card';
        card.textContent = text;
        card.addEventListener('click', () => onPick(text));
        body.appendChild(card);
      }
      meta.textContent =
        remaining === null ? 'Unlimited · Thanks for the upgrade 💙' : `${remaining} free left today`;
      footer.textContent = 'Click a card to insert';
    },
  };
  return handle;
}
