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
import { generate, verifyKey } from './ai';
import type { Persona } from '@/shared/types';

/**
 * Service Worker 엔트리.
 *
 * 책임:
 * - content script / popup / options의 메시지 라우팅 (단일 onMessage 리스너)
 * - AI 호출 (content script에서 직접 fetch 금지)
 * - 라이선스 게이트 검증
 * - 무료 한도 카운팅 — 동시 요청의 race condition을 막기 위해 inflight Promise queue로 직렬화
 */

const MANIFEST_VERSION = chrome.runtime.getManifest().version;

// onInstalled — 최초 설치 시 options 페이지 열기 (온보딩).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => void 0);
  }
});

// generate 호출을 단일 큐로 직렬화 — usage counter race + storage RMW race 제거.
// MV3 service worker는 수 분 후 suspend 되지만 큐는 resume 시 새로 시작되어 무해.
let generateQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = generateQueue.then(fn, fn);
  // 큐 체인에서 실패가 다음 작업을 깨지 않도록 catch.
  generateQueue = next.catch(() => undefined);
  return next;
}

chrome.runtime.onMessage.addListener(
  (msg: ClientMsg, _sender, sendResponse: (res: ServerMsg) => void) => {
    // 타입 가드 — 알 수 없는 형태의 메시지는 무시 (다른 확장과의 충돌 방지).
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
              sendResponse(asServerErr('PROVIDER_ERROR', r.error ?? 'Verification failed.'));
            }
            return;
          }
          case 'generate': {
            const out = await enqueue(() => handleGenerate(msg));
            sendResponse(out);
            return;
          }
          default: {
            // exhaustive check — 새 메시지 타입이 추가되면 컴파일 에러.
            const _exhaustive: never = msg;
            void _exhaustive;
            sendResponse(asServerErr('UNKNOWN', 'Unknown message kind'));
          }
        }
      } catch (e) {
        sendResponse(asServerErr('UNKNOWN', (e as Error).message || 'Unknown error'));
      }
    })();
    // async 응답 유지 계약.
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
): Promise<ServerMsg> {
  const cfg = await getKeyConfig();
  if (!cfg?.apiKey) {
    return asServerErr(
      'API_KEY_MISSING',
      'Add your AI provider key in Options to start generating.',
    );
  }

  // 자정 리셋 보장 후 본 상태 획득.
  const state = await ensureUsageFresh();

  const personaId = req.personaId ?? state.settings.activePersonaId;
  const persona = personaId ? state.personas.find((p) => p.id === personaId) : undefined;
  if (!persona) {
    return asServerErr(
      'PERSONA_MISSING',
      'Create at least one persona in Options. This teaches the AI your voice.',
    );
  }

  const paid = await licenseGateway.checkPaid();
  if (!paid && state.usage.count >= state.settings.dailyFreeLimit) {
    return asServerErr(
      'QUOTA_EXCEEDED',
      `Daily free limit reached (${state.settings.dailyFreeLimit}). Upgrade to unlock unlimited generations.`,
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
    suggestions = await generate({ cfg, prompt });
  } catch (e) {
    return asServerErr('PROVIDER_ERROR', (e as Error).message || 'Provider call failed');
  }

  if (!suggestions.length) {
    return asServerErr(
      'INVALID_RESPONSE',
      'Model returned empty output. Try again, or change model in Options.',
    );
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

/**
 * persona 팩토리 — Options UI가 이 유틸을 쓰기 원하면 shared/id로 대체 가능.
 * 현재 OptionsApp은 shared/id.uid()를 직접 사용하므로 이 헬퍼는 필요 시만 import.
 */
export function makeBlankPersona(name: string): Persona {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    toneDescription: '',
    examples: [],
    createdAt: now,
    updatedAt: now,
  };
}
