import type { GenerateMode } from './types';

/**
 * Content script ↔ Background service worker 메시지 프로토콜.
 *
 * 원칙:
 * - 키(apiKey)는 절대 이 경로로 전송되지 않음 — background가 자체 storage에서 직접 읽음.
 * - 에러는 code + human message로 분리 → 다국어 UI 가능.
 */

export interface GenerateRequest {
  kind: 'generate';
  mode: GenerateMode;
  originalTweet?: string | null;
  draft?: string | null;
  personaId: string | null;
}

export interface PingRequest {
  kind: 'ping';
}

export interface GetOverviewRequest {
  kind: 'getOverview';
}

export type ClientMsg = GenerateRequest | PingRequest | GetOverviewRequest;

export type ErrorCode =
  | 'API_KEY_MISSING'
  | 'PERSONA_MISSING'
  | 'QUOTA_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export interface GenerateOk {
  ok: true;
  suggestions: string[];
  remainingToday: number | null; // paid일 때 null.
}

export interface Overview {
  ok: true;
  hasKey: boolean;
  paid: boolean;
  usageToday: number;
  dailyLimit: number;
  activePersonaId: string | null;
  personaCount: number;
}

export interface Pong {
  ok: true;
  version: string;
}

export interface ServerErr {
  ok: false;
  code: ErrorCode;
  message: string;
}

export type ServerMsg = GenerateOk | Overview | Pong | ServerErr;

export function asServerErr(code: ErrorCode, message: string): ServerErr {
  return { ok: false, code, message };
}
