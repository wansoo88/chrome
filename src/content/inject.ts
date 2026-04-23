import type { ClientMsg, ServerMsg } from '@/shared/messages';
import { findComposeTextareas, findOriginalTweet } from './selectors';

/**
 * X 컴포즈 영역 옆에 ✨ 버튼을 주입하고, 클릭 시 팝오버로 3안을 제공.
 *
 * 동작 원칙:
 * - Shadow DOM으로 CSS 완전 격리.
 * - 단일 MutationObserver + requestAnimationFrame 디바운스 → 성능 안전.
 * - WeakSet으로 이미 장착된 textarea 중복 방지. host가 DOM에서 떨어지면 WeakSet에서도 제거.
 * - SPA 네비게이션(pushState/popstate) 시 열린 팝오버 자동 close.
 * - 뷰포트 하단 compose에선 팝오버를 위로 플립, 스크롤/리사이즈 시 close(재포지셔닝 복잡성 회피).
 */

interface Mount {
  textarea: HTMLElement;
  host: HTMLElement;
}

const mounts = new Set<Mount>();
const mountedTextareas = new WeakSet<HTMLElement>();
let rafId: number | null = null;
let currentPopover: PopoverHandle | null = null;

export function startInjector(): () => void {
  // DOM 변경 관찰 — 단일 observer로 모든 compose 탐지.
  const domObserver = new MutationObserver(() => {
    scheduleScan();
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  // SPA 네비게이션 감지 — X는 pushState로 라우팅 전환 시 content를 재구성하므로
  // 열린 팝오버는 바로 닫는 것이 사용자가 가장 덜 놀람.
  const navHandler = () => currentPopover?.close();
  window.addEventListener('popstate', navHandler);
  const origPush = history.pushState;
  history.pushState = function patched(...args) {
    const res = origPush.apply(this, args);
    navHandler();
    return res;
  };

  scheduleScan();
  return () => {
    domObserver.disconnect();
    if (rafId !== null) cancelAnimationFrame(rafId);
    currentPopover?.close();
    window.removeEventListener('popstate', navHandler);
    history.pushState = origPush;
    for (const m of mounts) m.host.remove();
    mounts.clear();
  };
}

function scheduleScan() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    rafId = null;
    scanAndMount();
    pruneDeadMounts();
  });
}

function scanAndMount() {
  for (const ta of findComposeTextareas()) {
    if (mountedTextareas.has(ta)) continue;
    mountedTextareas.add(ta);
    mountButton(ta);
  }
}

/**
 * X가 compose 노드를 제거했거나 재사용했을 때 우리 host도 정리하고, textarea가 재등장하면
 * 다시 장착될 수 있도록 WeakSet에서 빼줌.
 */
function pruneDeadMounts() {
  for (const m of [...mounts]) {
    if (!document.contains(m.host) || !document.contains(m.textarea)) {
      m.host.remove();
      mounts.delete(m);
      mountedTextareas.delete(m.textarea);
    }
  }
}

function mountButton(textarea: HTMLElement) {
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
    if (button) void openPopoverFor(textarea, button);
  });

  mounts.add({ textarea, host });
}

function findToolbarFor(textarea: HTMLElement): HTMLElement | null {
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

  const req: ClientMsg = {
    kind: 'generate',
    mode,
    originalTweet: original,
    draft: mode === 'threadHint' ? draft : null,
    personaId: null,
  };

  let res: ServerMsg | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as ServerMsg | undefined;
  } catch (e) {
    ui.showError(
      'Could not reach the extension background. Try reloading the page.',
      (e as Error).message,
    );
    return;
  }
  if (!res) {
    ui.showError('No response from background. Try reloading the page.');
    return;
  }
  if (res.ok === false) {
    ui.showError(res.message || 'Unknown error', res.code);
    return;
  }
  if (res.kind === 'generateOk') {
    ui.showSuggestions(res.suggestions, res.remainingToday, (text) => {
      insertIntoTextarea(textarea, text);
      ui.close();
    });
    return;
  }
  ui.showError('Unexpected response.', 'INVALID_RESPONSE');
}

// ──────────────────────────────────────────────────────────────────────────
// draft / insert
// ──────────────────────────────────────────────────────────────────────────

function readDraft(textarea: HTMLElement): string {
  // NBSP( )를 일반 공백으로 정규화 — X의 contenteditable이 연속 공백을 NBSP로 치환하는 경우 보정.
  return (textarea.innerText ?? '').replace(/ /g, ' ').trim();
}

/**
 * X의 React controlled input에 값을 반영하는 유일하게 안정적인 경로.
 * execCommand는 deprecated이지만 2026-04 기준 Chrome + X 조합에서 작동 확인.
 * 빈 textarea는 delete가 placeholder 노드를 건드릴 수 있으므로 생략.
 */
function insertIntoTextarea(textarea: HTMLElement, text: string) {
  textarea.focus();
  const existing = (textarea.innerText ?? '').replace(/ /g, ' ').trim();
  if (existing) {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    try {
      document.execCommand('delete', false);
    } catch {
      /* 폴백: 그냥 뒤에 이어 붙임. */
    }
  }
  try {
    document.execCommand('insertText', false, text);
  } catch {
    textarea.textContent = text;
  }
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
}

// ──────────────────────────────────────────────────────────────────────────
// 팝오버 UI (Shadow DOM, vanilla)
// ──────────────────────────────────────────────────────────────────────────

interface PopoverFullHandle extends PopoverHandle {
  showLoading(): void;
  showError(msg: string, code?: string): void;
  showSuggestions(
    suggestions: string[],
    remaining: number | null,
    onPick: (text: string) => void,
  ): void;
}

const POPOVER_MAX_HEIGHT = 420;
const POPOVER_GAP = 8;

function detectDark(): boolean {
  // X의 `html` 또는 `body`에 라이트/다크 관련 클래스·인라인 스타일이 있는지 우선 체크.
  const root = document.documentElement;
  const body = document.body;
  const inlineColorScheme =
    (root.style.colorScheme || '') + ' ' + (body.style.colorScheme || '');
  if (inlineColorScheme.includes('dark')) return true;
  if (inlineColorScheme.includes('light')) return false;
  // body 배경색 샘플 — X의 Dim(#15202b)/Lights out(#000000)는 luminance가 낮음.
  const bg = getComputedStyle(body).backgroundColor;
  const m = bg.match(/\d+/g);
  if (m && m.length >= 3) {
    const [r, g, b] = m.map(Number) as [number, number, number];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum < 0.35) return true;
    if (lum > 0.7) return false;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function createPopoverAt(anchor: HTMLElement): PopoverFullHandle {
  const host = document.createElement('div');
  host.setAttribute('data-xrb', 'popover');
  host.style.cssText = 'position:fixed;z-index:2147483647;';

  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(420, vw - 24);
  let left = rect.left;
  if (left + width > vw - 12) left = vw - width - 12;
  if (left < 12) left = 12;

  // 아래 여유 공간이 팝오버 최대 높이보다 적으면 위로 플립.
  const spaceBelow = vh - rect.bottom - POPOVER_GAP;
  const spaceAbove = rect.top - POPOVER_GAP;
  let top: number;
  let maxHeight: number;
  if (spaceBelow < 200 && spaceAbove > spaceBelow) {
    // flip: 위쪽에 배치. bottom anchor.
    maxHeight = Math.min(POPOVER_MAX_HEIGHT, Math.max(160, spaceAbove));
    top = Math.max(12, rect.top - POPOVER_GAP - maxHeight);
  } else {
    maxHeight = Math.min(POPOVER_MAX_HEIGHT, Math.max(160, spaceBelow));
    top = rect.bottom + POPOVER_GAP;
  }

  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  host.style.width = `${width}px`;
  host.style.maxHeight = `${maxHeight}px`;

  const shadow = host.attachShadow({ mode: 'open' });
  const isDark = detectDark();

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
        max-height: ${maxHeight}px;
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

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    host.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
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
  // 스크롤/리사이즈 시 anchor 위치가 달라지므로, 복잡한 재포지셔닝 대신 조용히 닫음.
  const onViewportChange = () => close();

  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
  }, 0);

  const handle: PopoverFullHandle = {
    close,
    showLoading() {
      body.innerHTML = `<div class="card"><span class="spinner"></span> &nbsp; Generating 3 variants…</div>`;
      meta.textContent = '';
      footer.textContent = '';
    },
    showError(msg: string, code?: string) {
      body.textContent = '';
      const div = document.createElement('div');
      div.className = 'err';
      div.textContent = msg;
      if (code) {
        const c = document.createElement('div');
        const codeEl = document.createElement('code');
        codeEl.textContent = code;
        c.appendChild(codeEl);
        div.appendChild(c);
      }
      body.appendChild(div);
      const footerBtn = document.createElement('button');
      footerBtn.className = 'btn ghost';
      footerBtn.textContent = 'Open Options';
      footerBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage?.();
      });
      footer.replaceChildren(footerBtn);
    },
    showSuggestions(items, remaining, onPick) {
      body.textContent = '';
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
