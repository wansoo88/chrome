# Skill: BYOK 보안 저장 + 유저 호출 패턴

> 사용자 API 키를 우리 서버로 보내지 않고, 브라우저 로컬에만 저장하며,
> AI 제공자에 직접 호출하는 구조. BYOK의 **프라이버시 약속**을 지키는 것이 곧 상품의 가치.

## 1. 저장 위치: `chrome.storage.local` (sync 금지)

```ts
// src/shared/storage.ts
export type Provider = 'openai' | 'anthropic' | 'openrouter';

export interface KeyConfig {
  provider: Provider;
  apiKey: string;              // 평문 저장 (아래 주의 참고)
  model: string;               // 예: 'gpt-4o-mini'
  lastVerifiedAt?: number;
}

const KEY = 'xrb.keyConfig';

export async function getKeyConfig(): Promise<KeyConfig | null> {
  const result = await chrome.storage.local.get(KEY);
  return result[KEY] ?? null;
}

export async function setKeyConfig(cfg: KeyConfig): Promise<void> {
  await chrome.storage.local.set({ [KEY]: cfg });
}

export async function clearKeyConfig(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
```

**왜 `sync`가 아닌 `local`?**
- `chrome.storage.sync`는 Google 서버 거침 → BYOK 프라이버시 훼손
- 다중 기기 동기화는 "유저가 직접 입력" 원칙이 더 안전

## 2. 평문 저장 vs 암호화 — 현실적 판단

**결론: MVP는 평문 저장.** 이유:

1. `chrome.storage.local`은 OS 레벨 사용자 계정에 귀속되어 **동일 OS 세션의 다른 확장/사이트가 읽을 수 없음**
2. 브라우저 내 "로컬 대칭 암호화"는 복호화 키도 같은 브라우저에 있어야 하므로 **실질적 보안 향상 없음**
3. 암호화하면 복구 플로우(비밀번호 분실 등) 복잡성만 증가
4. Options 페이지에 "API 키는 귀하의 브라우저 로컬에만 저장되며, 당사 서버로 전송되지 않습니다"를 명시하는 것이 더 중요

**대신 반드시 지킬 것**:
- 로그에 키를 절대 출력하지 않음 (`console.log`로 config 전체 찍지 말 것)
- 에러 메시지에 키가 포함되지 않도록 필터링
- 키는 오직 background service worker에서만 사용 (content script로 전달 금지)

## 3. 키 유효성 검증 (Options 페이지 "검증" 버튼)

```ts
// src/background/verifyKey.ts
export async function verifyOpenAIKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

- `/v1/models`는 저렴한 검증 엔드포인트 (토큰 소비 거의 0)
- 실패 시 원문 에러 메시지 노출 → 유저가 스스로 키 오타/결제 문제 판단 가능

## 4. 호출 — background에서만 실행

```ts
// src/background/ai.ts
import { getKeyConfig } from '@/shared/storage';

export async function generateReplies(payload: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<string[]> {
  const cfg = await getKeyConfig();
  if (!cfg) throw new Error('API_KEY_MISSING');
  
  if (cfg.provider === 'openai') return callOpenAI(cfg, payload);
  if (cfg.provider === 'anthropic') return callAnthropic(cfg, payload);
  if (cfg.provider === 'openrouter') return callOpenRouter(cfg, payload);
  throw new Error('UNKNOWN_PROVIDER');
}

async function callOpenAI(cfg: KeyConfig, p: { systemPrompt: string; userPrompt: string }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      temperature: 0.8,
      messages: [
        { role: 'system', content: p.systemPrompt },
        { role: 'user', content: p.userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  return text.split(/\s*###\s*/).map((s: string) => s.trim()).filter(Boolean).slice(0, 3);
}
```

**중요**: `fetch`는 **background service worker에서만** 실행. content script에서 직접 호출하면 CORS 문제는 없지만 키가 content script scope에 노출될 수 있음. 항상 `chrome.runtime.sendMessage`로 background에 요청 위임.

## 5. Content script ↔ Background 메시지 프로토콜

```ts
// src/shared/messages.ts
export type ClientMsg =
  | { kind: 'generate'; mode: 'reply' | 'threadHint'; originalTweet?: string; draft?: string; personaId: string };

export type ServerMsg =
  | { ok: true; suggestions: string[] }
  | { ok: false; code: 'API_KEY_MISSING' | 'QUOTA_EXCEEDED' | 'PROVIDER_ERROR'; message: string };
```

```ts
// content에서
const res: ServerMsg = await chrome.runtime.sendMessage({ kind: 'generate', ... });
```

```ts
// background에서
chrome.runtime.onMessage.addListener((msg: ClientMsg, _sender, sendResponse) => {
  (async () => {
    try {
      const suggestions = await generateReplies(buildPrompt(msg));
      sendResponse({ ok: true, suggestions });
    } catch (e) {
      sendResponse({ ok: false, code: mapError(e), message: (e as Error).message });
    }
  })();
  return true; // async 응답 유지
});
```

## 6. 온보딩 UX — BYOK 마찰 최소화

Options 페이지 첫 섹션 문구 (영어):

```
🔑 Connect your AI

Your key stays in your browser. We never see it.

[ OpenAI (most common)  •  Anthropic  •  OpenRouter ]

Paste key:  [____________________________]  [Verify]

New to OpenAI? Get a key in 2 minutes → platform.openai.com/api-keys
Expect ~$0.001 per reply with gpt-4o-mini.
```

- 예상 비용을 명시 → "얼마 들지 모른다"는 공포 제거
- "Get a key" 링크는 openai/anthropic/openrouter 각각 공식 페이지로
- 검증 결과는 즉시 피드백 (녹색 체크 or 빨간 원문 에러)

## 7. 로깅 정책

```ts
// 절대 금지
console.log('config:', cfg);               // ❌ 키 노출
console.error('failed:', cfg.apiKey, e);   // ❌

// 안전
console.error('[xrb] generate failed', { provider: cfg.provider, code: mapError(e) });
```
