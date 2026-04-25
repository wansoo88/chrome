import { en, type LocaleDict, type LocaleKey } from './locales/en';
import { ko } from './locales/ko';

/**
 * 최소 i18n 유틸. 4개 entry point(popup/options/content/background)에서 setLocale로
 * 현재 언어를 갱신하고, t()는 모듈 변수를 참조해 단일 호출 시그니처 유지.
 *
 * 사용 패턴:
 *   - 각 entry point가 시작 시 storage에서 settings.language를 읽어 setLocale() 호출
 *   - storage 변경 감지(onStateChanged) 후 setLocale 갱신
 *
 * fallback: 알 수 없는 lang은 en으로 폴백. 모든 키는 LocaleDict 타입으로 컴파일 시 검증.
 */
const dict: Record<string, LocaleDict> = { en, ko };

let currentLocale = 'en';

type Params = Record<string, string | number>;

export function setLocale(lang: string): void {
  currentLocale = dict[lang] ? lang : 'en';
}

export function getLocale(): string {
  return currentLocale;
}

export function t(key: LocaleKey, params?: Params, langOverride?: string): string {
  const lang = langOverride ?? currentLocale;
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
