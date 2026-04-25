/**
 * 도메인 타입. 변경 시 migration 고려: 저장소는 chrome.storage.local에 버저닝되어 있다 (storage.ts).
 */

export type Provider = 'openai' | 'anthropic' | 'openrouter';

export interface KeyConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  lastVerifiedAt: number | null;
}

export interface Persona {
  id: string;
  name: string;
  toneDescription: string;
  examples: string[];
  createdAt: number;
  updatedAt: number;
}

export type GenerateMode = 'reply' | 'threadHint';

export interface Settings {
  activePersonaId: string | null;
  languagePref: 'auto' | string;
  dailyFreeLimit: number;
}

/**
 * 결제 티어 — 4종.
 * - free: 기본. Free Forever 한도(5/day, 1 persona) 내에서 사용.
 * - trial: 7일 Pro 체험. 시작 시 ExtensionPay 이메일 등록(같은 이메일 1회만).
 * - monthly: Pro 월 $3.99 구독. ExtensionPay 활성 구독 상태.
 * - lifetime: Pro 평생 $19.99 일회성. 영구.
 *
 * 권한:
 * - free: dailyFreeLimit 차감 + persona 1개
 * - trial · monthly · lifetime: 무제한 + persona 10개 + threadHint 모드 풀 활용
 */
export type LicenseTier = 'free' | 'trial' | 'monthly' | 'lifetime';

export interface License {
  tier: LicenseTier;
  /** trial 또는 lifetime 시작 시각. monthly의 활성 시작 시각도 여기 기록(가장 최근). */
  startedAt: number | null;
  /** trial 종료 예정 시각 (tier === 'trial'일 때만 의미). ISO 7일 후. */
  trialExpiresAt: number | null;
  /** ExtensionPay에 등록된 trial 이메일. 같은 이메일 재시도는 백엔드에서 거부됨. */
  trialEmail: string | null;
}

export interface UsageDay {
  isoDate: string;
  count: number;
}

/**
 * 로컬-only 사용 통계. 외부 송신 없음 — Popup의 "주간 생성 수" 위젯과 리뷰 넛지 트리거용.
 * BYOK 프라이버시 원칙과 충돌하지 않도록 net 송신 일체 없음.
 */
export interface Stats {
  /** 누적 생성 성공(3안 받은 횟수). 리뷰 넛지 트리거에 사용. */
  totalGenerated: number;
  /** 누적 삽입 성공(카드 클릭하여 textarea에 삽입). */
  totalInserted: number;
  /** 리뷰 넛지를 이미 노출한 적 있는지. 1회성 보장. */
  reviewAsked: boolean;
  /** 일별 삽입 카운트 — 최근 7일치만 유지. Popup 주간 위젯용. */
  weeklyInserted: { isoDate: string; count: number }[];
}

export interface StorageSchema {
  version: number;
  keyConfig: KeyConfig | null;
  personas: Persona[];
  settings: Settings;
  license: License;
  usage: UsageDay;
  stats: Stats;
}
