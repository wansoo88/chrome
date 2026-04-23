import type { KeyConfig } from '@/shared/types';
import type { PromptPair } from '@/shared/prompt';
import { parseSuggestions } from '@/shared/prompt';

/**
 * AI 제공자별 호출 구현.
 * 원칙:
 * - background service worker에서만 실행 (키가 다른 컨텍스트에 노출되지 않도록).
 * - 실패 시 원문 에러 메시지를 보존하여 UI에 표시 (유저 디버깅 가능).
 * - 응답 파싱은 parseSuggestions가 담당 (여러 구분 방식 폴백).
 */

export interface GenerateOpts {
  cfg: KeyConfig;
  prompt: PromptPair;
  signal?: AbortSignal;
}

export async function generate(opts: GenerateOpts): Promise<string[]> {
  const { cfg } = opts;
  switch (cfg.provider) {
    case 'openai':
      return callOpenAI(opts);
    case 'anthropic':
      return callAnthropic(opts);
    case 'openrouter':
      return callOpenRouter(opts);
  }
}

async function callOpenAI({ cfg, prompt, signal }: GenerateOpts): Promise<string[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      temperature: 0.8,
      max_tokens: 600,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  if (!res.ok) throw await toHttpError(res, 'OpenAI');
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
  if (!res.ok) throw await toHttpError(res, 'Anthropic');
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text =
    data.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n') ?? '';
  return parseSuggestions(text);
}

async function callOpenRouter({ cfg, prompt, signal }: GenerateOpts): Promise<string[]> {
  // OpenRouter는 호출 집계/크레딧 할당을 위해 HTTP-Referer와 X-Title을 권장.
  // Referer는 사용자 확장 URL 자체로 — 개발자 식별자를 외부에 노출하지 않음.
  const referer = chrome.runtime.getURL('/');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'X Reply Booster',
    },
    body: JSON.stringify({
      model: cfg.model || 'openai/gpt-4o-mini',
      temperature: 0.8,
      max_tokens: 600,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });
  if (!res.ok) throw await toHttpError(res, 'OpenRouter');
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  return parseSuggestions(text);
}

async function toHttpError(res: Response, providerName: string): Promise<Error> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  // 긴 HTML 오류 페이지를 요약.
  const snippet = body.length > 400 ? body.slice(0, 400) + '…' : body;
  return new Error(`${providerName} ${res.status}: ${snippet || res.statusText}`);
}

/**
 * 키 유효성 검증 — Options 페이지 "Verify" 버튼에서 사용.
 * 가장 싼 엔드포인트로 왕복.
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
        // Anthropic은 저렴한 검증 엔드포인트가 없어 최소 1토큰 호출로 대체.
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
