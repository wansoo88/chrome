import { buildPrompt } from '@/shared/prompt';
import {
  ensureUsageFresh,
  getKeyConfig,
  getState,
  incrementUsage,
} from '@/shared/storage';
import { licenseGateway } from '@/shared/license';
import { asServerErr } from '@/shared/messages';
import type {
  ClientMsg,
  GenerateOk,
  Overview,
  Pong,
  ServerMsg,
  VerifyKeyOk,
} from '@/shared/messages';
import { generate, ProviderError, verifyKey } from './ai';
import { t } from '@/shared/i18n';

/**
 * Service Worker 엔트리.
 *
 * 책임:
 * - content script / popup / options의 메시지 라우팅 (단일 onMessage 리스너)
 * - AI 호출 (content script에서 직접 fetch 금지)
 * - 라이선스 게이트 검증
 * - 무료 한도 카운팅 직렬화 — navigator.locks 우선, 미지원 시 Promise chain 폴백.
 * - 새 generate 요청이 들어오면 이전 요청의 fetch를 AbortController로 취소 → AI 토큰 낭비 제거.
 */

const MANIFEST_VERSION = chrome.runtime.getManifest().version;

// onInstalled — 최초 설치 시 options 페이지 열기 (온보딩).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => void 0);
  }
});

/**
 * generate 직렬화 + 이전 요청 abort. 새 요청이 오면 이전 fetch를 취소해 토큰 소비를 멈춘다.
 * storage RMW race 방지를 위해 lock 내부에서만 usage를 건드린다.
 */
let currentGenerateAC: AbortController | null = null;
let queueFallback: Promise<unknown> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  // MV3 SW(Chrome 95+) 에서 Web Locks API 지원. suspend 중에도 re-acquire 안전.
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks && typeof locks.request === 'function') {
    return locks.request('xrb-generate', fn);
  }
  const next = queueFallback.then(fn, fn);
  queueFallback = next.catch(() => undefined);
  return next;
}

chrome.runtime.onMessage.addListener(
  (msg: ClientMsg, _sender, sendResponse: (res: ServerMsg) => void) => {
    if (!msg || typeof msg !== 'object' || typeof (msg as { kind?: unknown }).kind !== 'string') {
      return false;
    }
    (async () => {
      try {
        switch (msg.kind) {
          case 'ping': {
            const pong: Pong = { kind: 'pong', ok: true, version: MANIFEST_VERSION };
            sendResponse(pong);
            return;
          }
          case 'getOverview': {
            sendResponse(await buildOverview());
            return;
          }
          case 'verifyKey': {
            const r = await verifyKey(msg.cfg);
            if (r.ok) {
              const out: VerifyKeyOk = { kind: 'verifyKeyOk', ok: true };
              sendResponse(out);
            } else {
              sendResponse(
                asServerErr('PROVIDER_ERROR', r.error ?? 'Verification failed.', {
                  details: r.error,
                }),
              );
            }
            return;
          }
          case 'generate': {
            // 이전 in-flight 요청 취소 → AI 토큰 낭비 제거.
            currentGenerateAC?.abort();
            const ac = new AbortController();
            currentGenerateAC = ac;
            try {
              const out = await withLock(() => handleGenerate(msg, ac.signal));
              sendResponse(out);
            } finally {
              if (currentGenerateAC === ac) currentGenerateAC = null;
            }
            return;
          }
          default: {
            const _exhaustive: never = msg;
            void _exhaustive;
            sendResponse(asServerErr('UNKNOWN', t('err_unknown')));
          }
        }
      } catch (e) {
        // AbortError는 사용자가 다른 요청으로 갈아탄 정상 경로 — 에러로 올리지 않음.
        const err = e as Error;
        if (err.name === 'AbortError') {
          sendResponse(asServerErr('UNKNOWN', 'Request aborted'));
          return;
        }
        sendResponse(asServerErr('UNKNOWN', err.message || t('err_unknown')));
      }
    })();
    return true;
  },
);

async function buildOverview(): Promise<Overview> {
  const state = await getState();
  const paid = await licenseGateway.checkPaid();
  return {
    kind: 'overview',
    ok: true,
    hasKey: Boolean(state.keyConfig?.apiKey),
    paid,
    usageToday: state.usage.count,
    dailyLimit: state.settings.dailyFreeLimit,
    activePersonaId: state.settings.activePersonaId,
    personaCount: state.personas.length,
  };
}

async function handleGenerate(
  req: Extract<ClientMsg, { kind: 'generate' }>,
  signal: AbortSignal,
): Promise<ServerMsg> {
  const cfg = await getKeyConfig();
  if (!cfg?.apiKey) {
    return asServerErr('API_KEY_MISSING', t('err_api_key_missing'));
  }

  const state = await ensureUsageFresh();

  const personaId = req.personaId ?? state.settings.activePersonaId;
  const persona = personaId ? state.personas.find((p) => p.id === personaId) : undefined;
  if (!persona) {
    return asServerErr('PERSONA_MISSING', t('err_persona_missing'));
  }

  const paid = await licenseGateway.checkPaid();
  if (!paid && state.usage.count >= state.settings.dailyFreeLimit) {
    return asServerErr(
      'QUOTA_EXCEEDED',
      t('err_quota_exceeded', { limit: state.settings.dailyFreeLimit }),
    );
  }

  const prompt = buildPrompt({
    mode: req.mode,
    persona,
    originalTweet: req.originalTweet ?? null,
    draft: req.draft ?? null,
    languagePref: state.settings.languagePref,
  });

  let suggestions: string[];
  try {
    suggestions = await generate({ cfg, prompt, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      // 상위 catch에서 별도 처리 — 여기선 전파.
      throw e;
    }
    if (e instanceof ProviderError) {
      const friendly =
        e.code === 'invalid_key'
          ? t('err_provider_invalid_key')
          : e.code === 'rate_limit'
            ? t('err_provider_rate_limit')
            : e.code === 'no_quota'
              ? t('err_provider_no_quota')
              : t('err_provider_generic');
      return asServerErr('PROVIDER_ERROR', friendly, {
        details: e.message,
        providerCode: e.code,
      });
    }
    return asServerErr('PROVIDER_ERROR', (e as Error).message || t('err_provider_generic'));
  }

  if (!suggestions.length) {
    return asServerErr('INVALID_RESPONSE', t('err_invalid_response'));
  }

  let remainingToday: number | null = null;
  if (!paid) {
    const nextUsage = await incrementUsage();
    remainingToday = Math.max(0, state.settings.dailyFreeLimit - nextUsage.count);
  }

  const out: GenerateOk = {
    kind: 'generateOk',
    ok: true,
    suggestions: suggestions.slice(0, 3),
    remainingToday,
  };
  return out;
}
