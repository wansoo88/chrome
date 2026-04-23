import { en, type LocaleDict, type LocaleKey } from './locales/en';

/**
 * 최소 i18n 유틸. 다국어 확장은 dict에 locale을 추가하고 t(key, params, lang) 호출.
 * 현재 MVP는 en만 구현 — 다른 언어 사전은 후속 PR에서 채움.
 */
const dict: Record<string, LocaleDict> = { en };

type Params = Record<string, string | number>;

export function t(key: LocaleKey, params?: Params, lang: string = 'en'): string {
  const d = dict[lang] ?? dict.en!;
  let text: string = d[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export type { LocaleKey };
