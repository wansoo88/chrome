import type { GenerateMode, KeyConfig } from './types';

/**
 * Content script / Popup / Options ↔ Background service worker 메시지 프로토콜.
 *
 * 원칙:
 * - 키(apiKey)는 생성 요청에는 절대 포함되지 않음 — background가 자체 storage에서 읽음.
 *   verifyKey만 예외: 사용자가 "검증" 버튼을 눌렀을 때 임시 cfg를 전달.
 * - 모든 응답은 discriminated union으로 타입 좁힘 단순화.
 */

export type ReplyLength = 'short' | 'medium' | 'long';

export interface GenerateRequest {
  kind: 'generate';
  mode: GenerateMode;
  originalTweet?: string | null;
  draft?: string | null;
  personaId: string | null;
  /** 답변 길이. 미지정 시 'medium'. */
  length?: ReplyLength;
  /**
   * 스레드 부모 트윗들 — oldest-first. originalTweet 위쪽에 있던 대화 흐름.
   * 답변이 맥락 없는 일반론이 되는 것을 방지. content script가 채움.
   */
  threadContext?: string[];
}

export interface PingRequest {
  kind: 'ping';
}

export interface GetOverviewRequest {
  kind: 'getOverview';
}

export interface VerifyKeyRequest {
  kind: 'verifyKey';
  cfg: KeyConfig;
}

/** 카드 클릭하여 textarea에 답변 삽입 직후 호출. stats.totalInserted++. */
export interface RecordInsertRequest {
  kind: 'recordInsert';
}

/** 리뷰 넛지 클릭(또는 닫힘) 시 1회성 마킹. stats.reviewAsked = true. */
export interface MarkReviewAskedRequest {
  kind: 'markReviewAsked';
}

/**
 * Popover/Options에서 직접 결제 흐름을 트리거 — content script는 chrome.tabs 권한을
 * licenseGateway 경유로만 사용해야 하므로 background에 위임.
 */
export interface OpenCheckoutRequest {
  kind: 'openCheckout';
  tier: 'monthly' | 'lifetime';
}

export type ClientMsg =
  | GenerateRequest
  | PingRequest
  | GetOverviewRequest
  | VerifyKeyRequest
  | RecordInsertRequest
  | MarkReviewAskedRequest
  | OpenCheckoutRequest;

export type ErrorCode =
  | 'API_KEY_MISSING'
  | 'PERSONA_MISSING'
  | 'QUOTA_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export interface GenerateOk {
  kind: 'generateOk';
  ok: true;
  suggestions: string[];
  remainingToday: number | null; // paid면 null.
  /** 누적 생성 수 (3안 받은 횟수). UI에서 리뷰 넛지 트리거 판단에 사용. */
  totalGenerated?: number;
  /** 리뷰 넛지를 이미 노출한 적 있는지 (1회성). */
  reviewAsked?: boolean;
}

export interface RecordInsertOk {
  kind: 'recordInsertOk';
  ok: true;
}

export interface Overview {
  kind: 'overview';
  ok: true;
  hasKey: boolean;
  paid: boolean;
  usageToday: number;
  dailyLimit: number;
  activePersonaId: string | null;
  personaCount: number;
}

export interface Pong {
  kind: 'pong';
  ok: true;
  version: string;
}

export interface VerifyKeyOk {
  kind: 'verifyKeyOk';
  ok: true;
}

export interface ServerErr {
  kind: 'error';
  ok: false;
  code: ErrorCode;
  message: string;
  /** 원문 provider 에러 (개발자/고급 유저용). UI에선 code 기반 친화 메시지를 우선 노출. */
  details?: string;
  /** code === 'PROVIDER_ERROR'일 때 세부 분류 — UI 버튼 분기에 사용. */
  providerCode?: 'invalid_key' | 'rate_limit' | 'no_quota' | 'generic';
}

export type ServerMsg =
  | GenerateOk
  | Overview
  | Pong
  | VerifyKeyOk
  | RecordInsertOk
  | ServerErr;

export function asServerErr(
  code: ErrorCode,
  message: string,
  extra?: Pick<ServerErr, 'details' | 'providerCode'>,
): ServerErr {
  return { kind: 'error', ok: false, code, message, ...extra };
}
