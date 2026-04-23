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

export interface License {
  paid: boolean;
  purchasedAt: number | null;
}

export interface UsageDay {
  isoDate: string;
  count: number;
}

export interface StorageSchema {
  version: number;
  keyConfig: KeyConfig | null;
  personas: Persona[];
  settings: Settings;
  license: License;
  usage: UsageDay;
}
