import type { KeyConfig } from '@/shared/types';
import type { PromptPair } from '@/shared/prompt';
import { parseSuggestions } from '@/shared/prompt';

/**
 * AI 제공자 호출.
 * 원칙:
 * - background service worker에서만 실행 → 키가 content/popup/options에 노출되지 않음.
 * - 에러는 `ProviderError`로 분류하여 UI가 사용자 친화 메시지 매핑 가능하게 함.
 * - OpenAI/OpenRouter는 OpenAI-호환 프로토콜 공유 → 공통 헬퍼 재사용. Anthropic만 이질.
 */

export type ProviderErrorCode =
  | 'invalid_key'
  | 'rate_limit'
  | 'no_quota'
  | 'generic';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | null;
  readonly providerName: string;

  constructor(
    code: ProviderErrorCode,
    status: number | null,
    providerName: string,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.providerName = providerName;
    this.name = 'ProviderError';
  }
}

export interface GenerateOpts {
  cfg: KeyConfig;
  prompt: PromptPair;
  signal?: AbortSignal;
}

export async function generate(opts: GenerateOpts): Promise<string[]> {
  const { cfg } = opts;
  switch (cfg.provider) {
    case 'openai':
      return callOpenAICompatible({
        ...opts,
        url: 'https://api.openai.com/v1/chat/completions',
        providerName: 'OpenAI',
        defaultModel: 'gpt-4o-mini',
      });
    case 'openrouter':
      return callOpenAICompatible({
        ...opts,
        url: 'https://openrouter.ai/api/v1/chat/completions',
        providerName: 'OpenRouter',
        defaultModel: 'openai/gpt-4o-mini',
        extraHeaders: {
          // Referer는 확장 URL 자체로 — 개발자 식별자 노출 없이 집계만 가능.
          'HTTP-Referer': chrome.runtime.getURL('/'),
          'X-Title': 'X Reply Booster',
        },
      });
    case 'anthropic':
      return callAnthropic(opts);
  }
}

interface OpenAICompatibleOpts extends GenerateOpts {
  url: string;
  providerName: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

async function callOpenAICompatible(opts: OpenAICompatibleOpts): Promise<string[]> {
  const { cfg, prompt, signal, url, providerName, defaultModel, extraHeaders } = opts;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: cfg.model || defaultModel,
      temperature: 0.8,
      max_tokens: 600,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  if (!res.ok) throw await toProviderError(res, providerName);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  return parseSuggestions(text);
}

async function callAnthropic({ cfg, prompt, signal }: GenerateOpts): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model || 'claude-3-5-haiku-latest',
      max_tokens: 1024,
      temperature: 0.8,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    }),
  });
  if (!res.ok) throw await toProviderError(res, 'Anthropic');
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text =
    data.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n') ?? '';
  return parseSuggestions(text);
}

/**
 * HTTP 응답 → ProviderError. code는 이후 i18n 매핑에 사용된다.
 */
async function toProviderError(res: Response, providerName: string): Promise<ProviderError> {
  const status = res.status;
  let bodyMsg = '';
  try {
    const text = await res.text();
    // OpenAI/OpenRouter/Anthropic 모두 { error: { message } } 형식을 사용.
    try {
      const json = JSON.parse(text) as { error?: { message?: string } };
      bodyMsg = json?.error?.message ?? text;
    } catch {
      bodyMsg = text;
    }
  } catch {
    /* ignore */
  }
  const snippet = bodyMsg.length > 400 ? bodyMsg.slice(0, 400) + '…' : bodyMsg;

  const code: ProviderErrorCode =
    status === 401 || status === 403
      ? 'invalid_key'
      : status === 429
        ? 'rate_limit'
        : status === 402 || /credit|balance|quota|insufficient/i.test(bodyMsg)
          ? 'no_quota'
          : 'generic';

  return new ProviderError(code, status, providerName, `${providerName} ${status}: ${snippet}`);
}

/**
 * 키 유효성 검증 — Options "Verify" 버튼에서 사용. 토큰 소비 최소화 경로 선택.
 */
export async function verifyKey(cfg: KeyConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (cfg.provider) {
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
        if (r.ok) return { ok: true };
        return { ok: false, error: await readErrMessage(r) };
      }
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: cfg.model || 'claude-3-5-haiku-latest',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
        if (r.ok) return { ok: true };
        return { ok: false, error: await readErrMessage(r) };
      }
      case 'openrouter': {
        const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
        if (r.ok) return { ok: true };
        return { ok: false, error: await readErrMessage(r) };
      }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function readErrMessage(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { error?: { message?: string } };
    return body?.error?.message ?? `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

/**
 * 기본 모델 — Options 페이지에서 제공자 전환 시 자동 주입.
 */
export function defaultModelFor(provider: KeyConfig['provider']): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-3-5-haiku-latest';
    case 'openrouter':
      return 'openai/gpt-4o-mini';
  }
}
