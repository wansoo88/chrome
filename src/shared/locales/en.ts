/**
 * 유저향 문자열 단일 사전.
 * 다국어 확장 시 locales/{ko,ja,zh}.ts를 같은 LocaleDict 타입으로 추가하고 i18n.ts의 dict에 등록.
 * 파라미터는 {name} 형태의 placeholder를 사용.
 */
export interface LocaleDict {
  // 에러 (사용자 친화 버전 — 원문은 code/details로 접힘)
  err_api_key_missing: string;
  err_persona_missing: string;
  err_quota_exceeded: string;
  err_provider_invalid_key: string;
  err_provider_rate_limit: string;
  err_provider_no_quota: string;
  err_provider_generic: string;
  err_invalid_response: string;
  err_no_background: string;
  err_unknown: string;

  // 팝오버
  popover_loading: string;
  popover_click_hint: string;
  popover_unlimited: string;
  popover_free_left: string;
  popover_last_free: string;

  // 버튼
  btn_open_options: string;
  btn_upgrade: string;
  btn_retry: string;
  btn_add_key: string;
  btn_create_persona: string;
}

export const en: LocaleDict = {
  err_api_key_missing: 'Add your AI provider key in Options to start.',
  err_persona_missing: 'Create at least one persona in Options. This teaches the AI your voice.',
  err_quota_exceeded:
    'Daily free limit reached ({limit}/{limit}). Upgrade for unlimited generations.',
  err_provider_invalid_key: 'Your API key looks invalid or revoked. Paste a fresh one in Options.',
  err_provider_rate_limit: 'Your AI provider is rate-limiting. Wait a minute and retry.',
  err_provider_no_quota:
    'Your provider account is out of credits. Top up, or change model in Options.',
  err_provider_generic: 'AI provider returned an error. Try again, or switch model in Options.',
  err_invalid_response: 'Model returned empty output. Try again, or change model in Options.',
  err_no_background: 'Could not reach the extension background. Try reloading the page.',
  err_unknown: 'Something went wrong. Try again.',

  popover_loading: 'Generating 3 variants…',
  popover_click_hint: '↑↓ to move · Enter to insert · Esc to close',
  popover_unlimited: 'Unlimited · Thanks for the upgrade 💙',
  popover_free_left: '{n} free left today',
  popover_last_free: 'Last free reply — Upgrade for unlimited',

  btn_open_options: 'Open Options',
  btn_upgrade: 'Upgrade',
  btn_retry: 'Try again',
  btn_add_key: 'Add API key',
  btn_create_persona: 'Create persona',
};

export type LocaleKey = keyof LocaleDict;
