import { buildPrompt } from '@/shared/prompt';
import {
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
} from '@/shared/messages';
import { generate, verifyKey } from './ai';
import type { KeyConfig, Persona } from '@/shared/types';

/**
 * Service Worker 엔트리.
 *
 * 책임:
 * - content script / popup / options의 메시지 라우팅
 * - AI 호출 (content script에서 직접 fetch 금지)
 * - 라이선스 게이트 검증
 * - 무료 한도 카운팅 (일 5회, 자정 리셋)
 */

const MANIFEST_VERSION = chrome.runtime.getManifest().version;

// onInstalled — 최초 설치/업데이트 시 options 페이지 열기 (온보딩).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {
      /* 사용자가 options 접근을 막은 경우 무시. */
    });
  }
});

// 메시지 핸들러 — content/popup/options로부터 ClientMsg를 받아 ServerMsg로 응답.
chrome.runtime.onMessage.addListener(
  (msg: ClientMsg, _sender, sendResponse: (res: ServerMsg) => void) => {
    // IIFE로 async 처리 — return true로 비동기 응답 유지 계약.
    (async () => {
      try {
        switch (msg.kind) {
          case 'ping': {
            const pong: Pong = { ok: true, version: MANIFEST_VERSION };
            sendResponse(pong);
            return;
          }
          case 'getOverview': {
            const overview = await buildOverview();
            sendResponse(overview);
            return;
          }
          case 'generate': {
            const out = await handleGenerate(msg);
            sendResponse(out);
            return;
          }
        }
      } catch (e) {
        const err = e as Error;
        sendResponse(asServerErr('UNKNOWN', err.message || 'Unknown error'));
      }
    })();
    return true;
  },
);

async function buildOverview(): Promise<Overview> {
  const state = await getState();
  const paid = await licenseGateway.checkPaid();
  return {
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

  const state = await getState();
  const personaId = req.personaId ?? state.settings.activePersonaId;
  const persona = personaId ? state.personas.find((p) => p.id === personaId) : undefined;
  if (!persona) {
    return asServerErr(
      'PERSONA_MISSING',
      'Create at least one persona in Options. This is what teaches the AI your voice.',
    );
  }

  const paid = await licenseGateway.checkPaid();
  if (!paid) {
    if (state.usage.count >= state.settings.dailyFreeLimit) {
      return asServerErr(
        'QUOTA_EXCEEDED',
        `Daily free limit reached (${state.settings.dailyFreeLimit}). Upgrade to unlock unlimited generations.`,
      );
    }
  }

  const prompt = buildPrompt({
    mode: req.mode,
    persona,
    originalTweet: req.originalTweet ?? null,
    draft: req.draft ?? null,
    languagePref: state.settings.languagePref,
  });

  let suggestions: string[] = [];
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

  // 무료 유저만 카운트 증가.
  let remainingToday: number | null = null;
  if (!paid) {
    const nextUsage = await incrementUsage();
    remainingToday = Math.max(0, state.settings.dailyFreeLimit - nextUsage.count);
  }

  const out: GenerateOk = { ok: true, suggestions: suggestions.slice(0, 3), remainingToday };
  return out;
}

/**
 * options 페이지 전용 — 키 검증. storage에 저장되지 않은 임시 cfg로 호출.
 * 별도 메시지 타입으로 분기하지 않고 자체 타입 보존을 위해 따로 빼둠.
 */
chrome.runtime.onMessage.addListener(
  (
    msg: { kind: 'verifyKey'; cfg: KeyConfig } | unknown,
    _sender,
    sendResponse: (res: { ok: boolean; error?: string }) => void,
  ) => {
    if (!isVerifyKeyMsg(msg)) return false;
    (async () => {
      const r = await verifyKey(msg.cfg);
      sendResponse(r);
    })();
    return true;
  },
);

function isVerifyKeyMsg(m: unknown): m is { kind: 'verifyKey'; cfg: KeyConfig } {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { kind?: unknown }).kind === 'verifyKey' &&
    'cfg' in m
  );
}

// persona 디폴트 생성 유틸 — 첫 설치 시 options 페이지에서 호출 가능.
export function makeBlankPersona(name: string): Persona {
  return {
    id: crypto.randomUUID(),
    name,
    toneDescription: '',
    examples: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
