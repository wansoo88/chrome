import type { LocaleDict } from './en';

/**
 * 한국어 사전. en.ts와 같은 LocaleDict 타입을 만족 — 키 누락 시 컴파일 에러.
 * 본인이 한국인이라 첫 검증 마찰 + 한국 유저 5★ 리뷰 동시 노림.
 */
export const ko: LocaleDict = {
  // 에러
  err_api_key_missing: 'Options에서 AI 제공자 키를 먼저 등록해 주세요.',
  err_persona_missing: 'Options에서 퍼소나를 1개 이상 만들어 주세요. AI에게 당신의 목소리를 알려주는 핵심입니다.',
  err_quota_exceeded:
    '오늘 무료 한도({limit}/{limit})를 모두 사용했습니다. 업그레이드하면 무제한입니다.',
  err_provider_invalid_key: 'API 키가 유효하지 않거나 취소된 것 같습니다. Options에서 새로 발급받은 키로 교체해 주세요.',
  err_provider_rate_limit: 'AI 제공자가 일시적으로 속도 제한 중입니다. 1분 정도 후에 다시 시도해 주세요.',
  err_provider_no_quota:
    '제공자 계정의 크레딧이 부족합니다. 충전하거나 Options에서 모델을 변경해 주세요.',
  err_provider_generic: 'AI 제공자가 오류를 반환했습니다. 잠시 후 다시 시도하거나 Options에서 모델을 바꿔 보세요.',
  err_invalid_response: '모델이 빈 응답을 반환했습니다. 다시 시도하거나 Options에서 모델을 바꿔 보세요.',
  err_no_background: '확장 프로그램 백그라운드에 연결할 수 없습니다. 페이지를 새로고침해 주세요.',
  err_unknown: '오류가 발생했습니다. 다시 시도해 주세요.',

  // 팝오버
  popover_loading: '3개의 답변을 만드는 중…',
  popover_click_hint: '↑↓ 이동 · Enter 삽입 · Esc 닫기',
  popover_unlimited: '무제한 · 업그레이드해 주셔서 감사합니다 💙',
  popover_free_left: '오늘 {n}회 남음',
  popover_last_free: '오늘의 마지막 무료 답변 · 업그레이드하면 무제한',

  // 버튼
  btn_open_options: '설정 열기',
  btn_upgrade: '업그레이드',
  btn_retry: '다시 시도',
  btn_add_key: 'API 키 추가',
  btn_create_persona: '퍼소나 만들기',
};
