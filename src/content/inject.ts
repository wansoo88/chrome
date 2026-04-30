import type { ClientMsg, ReplyLength, ServerMsg } from '@/shared/messages';
import { setLocale, t } from '@/shared/i18n';
import { getState, onStateChanged } from '@/shared/storage';
import type { Persona } from '@/shared/types';
import { findComposeTextareas, findOriginalTweet, findThreadContext } from './selectors';

// content script 초기 locale 동기화. injectStart에서 호출되도록 모듈 스코프에서 시작.
void getState().then((s) => setLocale(s.settings.languagePref));
onStateChanged((next) => {
  if (next) setLocale(next.settings.languagePref);
});

/**
 * X 컴포즈 영역 옆에 ✨ 버튼을 주입하고 클릭 시 팝오버로 3안을 제공.
 *
 * 설계 원칙:
 * - Shadow DOM으로 CSS 완전 격리 (open mode 유지 — closed로 바꿔도 페이지 스크립트의
 *   실질적 가치 탈취 경로 없음. e2e 테스트 용이성 우선).
 * - 단일 MutationObserver + rAF 디바운스 → 프레임당 최대 1회 스캔.
 * - 팝오버 키보드 내비(↑↓/Enter/Esc) + role=listbox/option으로 접근성 커버.
 * - 새 팝오버 열면 이전 요청은 background가 abort (토큰 낭비 제거).
 */

interface Mount {
  textarea: HTMLElement;
  host: HTMLElement;
}

const POPOVER_WIDTH = 420;
const POPOVER_MAX_HEIGHT = 420;
const POPOVER_MIN_HEIGHT = 160;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 12;
const FLIP_SPACE_THRESHOLD = 200;

const mounts = new Set<Mount>();
const mountedTextareas = new WeakSet<HTMLElement>();
let rafId: number | null = null;
let currentPopover: PopoverHandle | null = null;

export function startInjector(): () => void {
  const domObserver = new MutationObserver(() => scheduleScan());
  domObserver.observe(document.body, { childList: true, subtree: true });

  // SPA 네비게이션 감지 — 팝오버 자동 close.
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

/**
 * SW 콜드스타트 대응. 5분 idle 후 첫 sendMessage가 "Receiving end does not exist"로 거절될 수 있음.
 * 1회 자동 재시도 + 짧은 백오프 후 같은 요청 재전송. 두 번째도 실패면 상위 catch로 위임.
 */
async function sendMessageWithRetry<T = ServerMsg>(req: ClientMsg, maxAttempts = 2): Promise<T | undefined> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = (await chrome.runtime.sendMessage(req)) as T | undefined;
      // chrome.runtime.lastError 명시 검사 (Promise mode에서도 일부 케이스에서 채워짐).
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message ?? 'runtime.lastError set');
      }
      if (res) return res;
      // res가 undefined면 listener가 응답을 안 보낸 것 — 재시도 가치.
      lastErr = new Error('Empty response from background');
    } catch (e) {
      lastErr = e;
    }
    // 재시도 전 짧은 백오프 (SW 콜드스타트 시간).
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('sendMessage failed');
}

async function openPopoverFor(textarea: HTMLElement, anchor: HTMLElement): Promise<void> {
  currentPopover?.close();

  const draft = readDraft(textarea);
  const original = findOriginalTweet(textarea);
  const threadContext = findThreadContext(textarea);
  const mode: 'reply' | 'threadHint' = draft.length > 0 ? 'threadHint' : 'reply';

  // 퍼소나 목록 + 활성 ID는 storage에서 직접 조회. content script도 storage 권한 있음.
  let personas: Persona[] = [];
  let activePersonaId: string | null = null;
  try {
    const s = await getState();
    personas = s.personas;
    activePersonaId = s.settings.activePersonaId;
  } catch {
    // storage 실패는 치명적이지 않음 — null로 진행 (background가 활성 퍼소나 결정).
  }

  // 팝오버 상태 (퍼소나·길이). 컨트롤 변경 시 자동 재생성.
  let currentLength: ReplyLength = 'medium';
  let currentPersonaId: string | null = activePersonaId;

  const ui = createPopoverAt(anchor);
  currentPopover = ui;

  ui.setControls({
    personas,
    activePersonaId: currentPersonaId,
    length: currentLength,
    onPersonaChange: (id) => {
      currentPersonaId = id || null;
      void runGenerate();
    },
    onLengthChange: (l) => {
      currentLength = l;
      void runGenerate();
    },
    onRegenerate: () => void runGenerate(),
  });

  const runGenerate = async () => {
    ui.showLoading();
    const req: ClientMsg = {
      kind: 'generate',
      mode,
      originalTweet: original,
      draft: mode === 'threadHint' ? draft : null,
      personaId: currentPersonaId,
      length: currentLength,
      threadContext: threadContext.length > 0 ? threadContext : undefined,
    };
    let res: ServerMsg | undefined;
    try {
      res = await sendMessageWithRetry(req);
    } catch (e) {
      ui.showError({ message: t('err_no_background'), details: (e as Error).message });
      return;
    }
    if (!res) {
      ui.showError({ message: t('err_no_background') });
      return;
    }
    if (res.ok === false) {
      ui.showError({
        message: res.message,
        details: res.details,
        code: res.code,
        providerCode: res.providerCode,
        onRetry: () => void runGenerate(),
      });
      return;
    }
    if (res.kind === 'generateOk') {
      const showReviewNudge =
        (res.totalGenerated ?? 0) >= 3 && !res.reviewAsked;
      ui.showSuggestions(
        res.suggestions,
        res.remainingToday,
        (text) => {
          insertIntoTextarea(textarea, text);
          chrome.runtime.sendMessage({ kind: 'recordInsert' }).catch(() => void 0);
          ui.close();
        },
        showReviewNudge,
      );
      return;
    }
    ui.showError({ message: t('err_unknown'), code: 'INVALID_RESPONSE' });
  };

  await runGenerate();
}

// ──────────────────────────────────────────────────────────────────────────
// draft / insert
// ──────────────────────────────────────────────────────────────────────────

function readDraft(textarea: HTMLElement): string {
  // X의 contenteditable이 연속 공백을 NBSP(U+00A0)로 치환하므로 일반 공백으로 정규화.
  return (textarea.innerText ?? '').replace(/ /g, ' ').trim();
}

/**
 * React controlled input에 값 반영. 빈 textarea(placeholder 상태)는 delete를 생략 —
 * X의 placeholder 노드를 건드리면 post 버튼이 비활성화되는 이슈 회피.
 * dispatchEvent에 text data를 담지 않아 제3자 user-script가 AI 응답을 수집하지 못하게 함.
 */
function insertIntoTextarea(textarea: HTMLElement, text: string) {
  textarea.focus();
  const existing = readDraft(textarea);
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
      /* 폴백: 이어 붙임. */
    }
  }
  try {
    document.execCommand('insertText', false, text);
  } catch {
    textarea.textContent = text;
  }
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

// ──────────────────────────────────────────────────────────────────────────
// 팝오버 UI (Shadow DOM, vanilla)
// ──────────────────────────────────────────────────────────────────────────

interface ErrorInfo {
  message: string;
  details?: string;
  code?: string;
  providerCode?: 'invalid_key' | 'rate_limit' | 'no_quota' | 'generic';
  onRetry?: () => void;
}

interface ControlsConfig {
  personas: Persona[];
  activePersonaId: string | null;
  length: ReplyLength;
  onPersonaChange: (id: string) => void;
  onLengthChange: (length: ReplyLength) => void;
  onRegenerate: () => void;
}

interface PopoverFullHandle extends PopoverHandle {
  showLoading(): void;
  showError(err: ErrorInfo): void;
  showSuggestions(
    suggestions: string[],
    remaining: number | null,
    onPick: (text: string) => void,
    showReviewNudge?: boolean,
  ): void;
  setControls(controls: ControlsConfig): void;
}

function detectDark(): boolean {
  const root = document.documentElement;
  const body = document.body;
  const inlineColorScheme = (root.style.colorScheme || '') + ' ' + (body.style.colorScheme || '');
  if (inlineColorScheme.includes('dark')) return true;
  if (inlineColorScheme.includes('light')) return false;
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
  const width = Math.min(POPOVER_WIDTH, vw - VIEWPORT_MARGIN * 2);
  let left = rect.left;
  if (left + width > vw - VIEWPORT_MARGIN) left = vw - width - VIEWPORT_MARGIN;
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

  const spaceBelow = vh - rect.bottom - POPOVER_GAP;
  const spaceAbove = rect.top - POPOVER_GAP;
  let top: number;
  let maxHeight: number;
  if (spaceBelow < FLIP_SPACE_THRESHOLD && spaceAbove > spaceBelow) {
    maxHeight = Math.min(POPOVER_MAX_HEIGHT, Math.max(POPOVER_MIN_HEIGHT, spaceAbove));
    top = Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_GAP - maxHeight);
  } else {
    maxHeight = Math.min(POPOVER_MAX_HEIGHT, Math.max(POPOVER_MIN_HEIGHT, spaceBelow));
    top = rect.bottom + POPOVER_GAP;
  }

  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
  host.style.width = `${width}px`;
  host.style.maxHeight = `${maxHeight}px`;

  const shadow = host.attachShadow({ mode: 'open' });
  const isDark = detectDark();

  // CSS 변수로 팔레트 분리 — 다크/라이트 단일 스타일 블록에서 토글.
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      :host {
        --xrb-fg: ${isDark ? '#e7e9ea' : '#0f1419'};
        --xrb-bg: ${isDark ? '#15202b' : '#ffffff'};
        --xrb-border: ${isDark ? '#2f3336' : 'rgba(0,0,0,0.08)'};
        --xrb-card-bg: ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'};
        --xrb-card-hover: ${isDark ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.1)'};
        --xrb-err-bg: ${isDark ? 'rgba(244,33,46,0.1)' : 'rgba(244,33,46,0.08)'};
        --xrb-err-fg: ${isDark ? '#ff8593' : '#b81421'};
        --xrb-accent: rgb(29,155,240);
      }
      .wrap {
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: var(--xrb-fg);
        background: var(--xrb-bg);
        border: 1px solid var(--xrb-border);
        border-radius: 14px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        padding: 10px;
        max-height: ${maxHeight}px;
        overflow: auto;
      }
      .head { display:flex; align-items:center; justify-content:space-between; padding:4px 6px 8px; font-weight:600; }
      .head .meta { font-weight:400; opacity:.7; font-size:12px; }
      .list { outline: none; }
      .card {
        padding: 10px 12px;
        border-radius: 10px;
        margin-bottom: 8px;
        background: var(--xrb-card-bg);
        cursor: pointer;
        white-space: pre-wrap;
        word-break: break-word;
        transition: background 120ms ease, transform 100ms ease, outline 80ms ease;
        outline: 2px solid transparent;
        outline-offset: -2px;
      }
      .card:hover { background: var(--xrb-card-hover); }
      .card.active, .card:focus-visible { outline-color: var(--xrb-accent); background: var(--xrb-card-hover); }
      .card:last-child { margin-bottom: 0; }
      .row { display:flex; gap:8px; align-items:center; padding:6px 2px 0; font-size:12px; opacity:.85; flex-wrap: wrap; }
      .spinner {
        width:16px; height:16px; border-radius:50%;
        border: 2px solid var(--xrb-border);
        border-top-color: var(--xrb-accent);
        animation: spin .8s linear infinite;
        display:inline-block; vertical-align:middle;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .err { padding:10px 12px; border-radius:10px; background: var(--xrb-err-bg); color: var(--xrb-err-fg); font-size:13px; }
      .err details { margin-top:6px; }
      .err code { font: 11px monospace; opacity:.7; }
      .btn { all: unset; cursor:pointer; padding:6px 10px; border-radius:999px; background: var(--xrb-accent); color:white; font-weight:600; font-size:12px; }
      .btn:hover { filter: brightness(1.05); }
      .btn:focus-visible { outline: 2px solid var(--xrb-accent); outline-offset: 2px; }
      .btn.ghost { background: transparent; color: inherit; border: 1px solid var(--xrb-border); }
      .controls { display: flex; gap: 6px; align-items: center; padding: 4px 6px 8px; flex-wrap: wrap; }
      .controls select { all: unset; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--xrb-border); background: transparent; color: var(--xrb-fg); font-size: 12px; cursor: pointer; }
      .controls select:focus-visible { outline: 2px solid var(--xrb-accent); outline-offset: 2px; }
      .seg { display: inline-flex; border: 1px solid var(--xrb-border); border-radius: 999px; overflow: hidden; }
      .seg button { all: unset; cursor: pointer; padding: 4px 10px; font-size: 11px; color: var(--xrb-fg); }
      .seg button.active { background: var(--xrb-accent); color: white; }
      .icon-btn { all: unset; cursor: pointer; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--xrb-border); font-size: 12px; color: var(--xrb-fg); }
      .icon-btn:hover { background: var(--xrb-card-hover); }
      .icon-btn:focus-visible { outline: 2px solid var(--xrb-accent); outline-offset: 2px; }
      .grow { flex: 1; }
    </style>
    <div class="wrap" role="dialog" aria-label="X Reply Booster suggestions">
      <div class="head"><span>✨ Suggestions</span><span class="meta" data-slot="meta"></span></div>
      <div class="controls" data-slot="controls"></div>
      <div class="list" data-slot="body"></div>
      <div class="row" data-slot="footer"></div>
    </div>
  `;

  document.body.appendChild(host);

  const body = shadow.querySelector<HTMLElement>('[data-slot="body"]')!;
  const meta = shadow.querySelector<HTMLElement>('[data-slot="meta"]')!;
  const footer = shadow.querySelector<HTMLElement>('[data-slot="footer"]')!;
  const controlsSlot = shadow.querySelector<HTMLElement>('[data-slot="controls"]')!;

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
    if (!host.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
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
      body.innerHTML = `<div class="card"><span class="spinner"></span> &nbsp; ${t('popover_loading')}</div>`;
      meta.textContent = '';
      footer.textContent = '';
    },
    showError(err) {
      renderError({ body, footer, meta, err });
    },
    showSuggestions(items, remaining, onPick, showReviewNudge) {
      renderSuggestions({ body, footer, meta, items, remaining, onPick, showReviewNudge });
    },
    setControls(cfg) {
      renderControls(controlsSlot, cfg);
    },
  };
  return handle;
}

/**
 * 팝오버 상단 컨트롤 바: 퍼소나 드롭다운 + 길이 토글 + Regenerate 버튼.
 * 컨트롤 변경 시 콜백을 통해 즉시 재생성. 퍼소나 0개면 "no persona" 안내.
 */
function renderControls(slot: HTMLElement, cfg: ControlsConfig) {
  slot.textContent = '';

  // 퍼소나 드롭다운
  if (cfg.personas.length > 0) {
    const select = document.createElement('select');
    select.title = 'Switch persona — voice changes immediately';
    select.setAttribute('aria-label', 'Persona');
    for (const p of cfg.personas) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === cfg.activePersonaId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => cfg.onPersonaChange(select.value));
    slot.appendChild(select);
  }

  // 길이 토글 (Short / Medium / Long)
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Reply length');
  const lengths: { value: ReplyLength; label: string }[] = [
    { value: 'short', label: 'S' },
    { value: 'medium', label: 'M' },
    { value: 'long', label: 'L' },
  ];
  for (const { value, label } of lengths) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = `${value.charAt(0).toUpperCase() + value.slice(1)} replies`;
    b.setAttribute('aria-pressed', String(value === cfg.length));
    if (value === cfg.length) b.className = 'active';
    b.addEventListener('click', () => cfg.onLengthChange(value));
    seg.appendChild(b);
  }
  slot.appendChild(seg);

  // 우측 정렬용 spacer
  const spacer = document.createElement('span');
  spacer.className = 'grow';
  slot.appendChild(spacer);

  // Regenerate 버튼
  const regen = document.createElement('button');
  regen.type = 'button';
  regen.className = 'icon-btn';
  regen.textContent = '↻ Regenerate';
  regen.title = 'Generate 3 new variants with the same input';
  regen.addEventListener('click', () => cfg.onRegenerate());
  slot.appendChild(regen);
}

// ──────────────────────────────────────────────────────────────────────────
// 렌더링 헬퍼 (createPopoverAt 내부 분기 로직 추출)
// ──────────────────────────────────────────────────────────────────────────

function renderError({
  body,
  footer,
  meta,
  err,
}: {
  body: HTMLElement;
  footer: HTMLElement;
  meta: HTMLElement;
  err: ErrorInfo;
}) {
  body.textContent = '';
  meta.textContent = '';

  // QUOTA_EXCEEDED는 가장 결제 동기 강한 시점. 평범한 에러 박스 대신 비교 카드로 표시.
  if (err.code === 'QUOTA_EXCEEDED') {
    renderQuotaUpgrade(body, footer, err);
    return;
  }

  const div = document.createElement('div');
  div.className = 'err';
  const head = document.createElement('div');
  head.textContent = err.message;
  div.appendChild(head);
  if (err.details) {
    const d = document.createElement('details');
    const s = document.createElement('summary');
    s.textContent = 'Details';
    const codeEl = document.createElement('code');
    codeEl.textContent = err.details;
    d.appendChild(s);
    d.appendChild(codeEl);
    div.appendChild(d);
  }
  body.appendChild(div);

  // 에러 코드별 버튼 분기 — 유저를 다음 action에 가장 가까운 경로로 보냄.
  const buttons: HTMLElement[] = [];
  if (err.code === 'API_KEY_MISSING' || err.providerCode === 'invalid_key') {
    buttons.push(
      btn(t('btn_add_key'), 'primary', () => {
        chrome.runtime.openOptionsPage?.();
      }),
    );
  } else if (err.code === 'PERSONA_MISSING') {
    buttons.push(
      btn(t('btn_create_persona'), 'primary', () => {
        chrome.runtime.openOptionsPage?.();
      }),
    );
  }
  if (err.onRetry) {
    buttons.push(btn(t('btn_retry'), 'ghost', () => err.onRetry?.()));
  }
  buttons.push(
    btn(t('btn_open_options'), 'ghost', () => {
      chrome.runtime.openOptionsPage?.();
    }),
  );
  footer.replaceChildren(...buttons);
}

function btn(label: string, variant: 'primary' | 'ghost', onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = variant === 'primary' ? 'btn' : 'btn ghost';
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Quota 초과 = 결제 동기가 가장 강한 시점. 일반 에러 박스 대신:
 *   1) 한도 도달 사실을 부드럽게
 *   2) Free vs Pro 차이를 시각적 비교
 *   3) Lifetime / Monthly 버튼을 popover 안에서 직접 (Options 이동 마찰 제거)
 *
 * BYOK 프라이버시 원칙은 유지 — 결제 흐름만 background로 위임.
 */
function renderQuotaUpgrade(body: HTMLElement, footer: HTMLElement, err: ErrorInfo) {
  body.textContent = '';
  footer.textContent = '';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

  const head = document.createElement('div');
  head.style.cssText = 'font-weight:700;font-size:14px;';
  head.textContent = err.message;
  wrap.appendChild(head);

  const compare = document.createElement('div');
  compare.style.cssText =
    'padding:8px 10px;border-radius:8px;background:rgba(29,155,240,0.08);font-size:12px;line-height:1.5;';
  compare.innerHTML = `
    <div style="font-weight:600;margin-bottom:4px;">Pro unlocks:</div>
    <div>· Unlimited replies (vs 5/day)</div>
    <div>· 10 personas (vs 1)</div>
    <div>· Thread hint mode</div>
    <div style="margin-top:6px;opacity:.75;">TweetHunter $49/mo · Hypefury $19/mo · this $19.99 once.</div>
  `;
  wrap.appendChild(compare);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';
  const lifetime = document.createElement('button');
  lifetime.type = 'button';
  lifetime.className = 'btn';
  lifetime.style.cssText = 'flex:1;padding:8px 12px;font-size:13px;';
  lifetime.innerHTML = '★ Lifetime $19.99';
  lifetime.addEventListener('click', () => {
    chrome.runtime
      .sendMessage({ kind: 'openCheckout', tier: 'lifetime' })
      .catch(() => void 0);
  });
  const monthly = document.createElement('button');
  monthly.type = 'button';
  monthly.className = 'btn ghost';
  monthly.style.cssText = 'padding:8px 12px;font-size:13px;';
  monthly.textContent = '$3.99/mo';
  monthly.addEventListener('click', () => {
    chrome.runtime
      .sendMessage({ kind: 'openCheckout', tier: 'monthly' })
      .catch(() => void 0);
  });
  btnRow.appendChild(lifetime);
  btnRow.appendChild(monthly);
  wrap.appendChild(btnRow);

  const fine = document.createElement('div');
  fine.style.cssText = 'font-size:11px;opacity:.65;';
  fine.textContent = "Tomorrow you'll get 5 free again — or upgrade now to keep going.";
  wrap.appendChild(fine);

  body.appendChild(wrap);
}

function renderSuggestions({
  body,
  footer,
  meta,
  items,
  remaining,
  onPick,
  showReviewNudge,
}: {
  body: HTMLElement;
  footer: HTMLElement;
  meta: HTMLElement;
  items: string[];
  remaining: number | null;
  onPick: (text: string) => void;
  showReviewNudge?: boolean;
}) {
  body.textContent = '';
  body.setAttribute('role', 'listbox');
  body.setAttribute('tabindex', '-1');

  // 리뷰 넛지: 카드 위에 1줄 표시 (1회성). 클릭 시 스토어 리뷰 페이지 + reviewAsked=true 마킹.
  if (showReviewNudge) {
    const nudge = document.createElement('div');
    nudge.style.cssText =
      'padding:8px 10px;margin-bottom:8px;border-radius:8px;background:rgba(29,155,240,0.1);font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const text = document.createElement('span');
    text.textContent = '⭐ Loving it? A 30-second review unblocks another builder.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.style.cssText = 'padding:4px 10px;font-size:11px;';
    btn.textContent = 'Rate on Store';
    btn.addEventListener('click', () => {
      const id = chrome.runtime.id;
      chrome.tabs
        .create({ url: `https://chromewebstore.google.com/detail/${id}/reviews` })
        .catch(() => void 0);
      // background에 1회성 마킹 요청.
      chrome.runtime.sendMessage({ kind: 'markReviewAsked' }).catch(() => void 0);
      nudge.remove();
    });
    nudge.appendChild(text);
    nudge.appendChild(btn);
    body.appendChild(nudge);
  }

  const cards: HTMLElement[] = items.map((text, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'option');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
    card.textContent = text;
    card.addEventListener('click', () => onPick(text));
    return card;
  });

  let activeIdx = 0;
  const setActive = (idx: number) => {
    activeIdx = (idx + cards.length) % cards.length;
    cards.forEach((c, i) => {
      const selected = i === activeIdx;
      c.classList.toggle('active', selected);
      c.setAttribute('aria-selected', String(selected));
    });
    cards[activeIdx]?.focus();
  };

  cards.forEach((card, idx) => {
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPick(items[idx]!);
      } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        setActive(idx + 1);
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        setActive(idx - 1);
      }
    });
  });

  for (const c of cards) body.appendChild(c);

  // 팝오버 열리자마자 첫 카드에 focus — 키보드만 쓰는 유저도 즉시 선택 가능.
  queueMicrotask(() => cards[0]?.focus());

  // FOMO / 가치 전달 카피 분기.
  meta.textContent =
    remaining === null
      ? t('popover_unlimited')
      : remaining <= 0
        ? t('popover_last_free')
        : t('popover_free_left', { n: remaining });

  footer.textContent = t('popover_click_hint');
}
