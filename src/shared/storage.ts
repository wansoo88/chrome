import type {
  KeyConfig,
  License,
  Persona,
  Settings,
  StorageSchema,
  UsageDay,
} from './types';

/**
 * chrome.storage.local 단일-진입 래퍼.
 *
 * 설계:
 * - 모든 키를 단일 "xrb.state" 루트 아래 보관 → atomic read/write.
 * - 초기화(get + 기본값 주입)는 getState()에서 통합.
 * - 소비자는 getState/updateState만 사용 → 필드별 오프셋 오차 제거.
 */

const ROOT_KEY = 'xrb.state';
const SCHEMA_VERSION = 1;

const DEFAULT_SETTINGS: Settings = {
  activePersonaId: null,
  languagePref: 'auto',
  dailyFreeLimit: 5,
};

const DEFAULT_LICENSE: License = {
  paid: false,
  purchasedAt: null,
};

const DEFAULT_KEY_CONFIG: KeyConfig | null = null;

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultUsage(): UsageDay {
  return { isoDate: todayIso(), count: 0 };
}

function defaultState(): StorageSchema {
  return {
    version: SCHEMA_VERSION,
    keyConfig: DEFAULT_KEY_CONFIG,
    personas: [],
    settings: { ...DEFAULT_SETTINGS },
    license: { ...DEFAULT_LICENSE },
    usage: defaultUsage(),
  };
}

export async function getState(): Promise<StorageSchema> {
  const row = await chrome.storage.local.get(ROOT_KEY);
  const raw = row[ROOT_KEY] as Partial<StorageSchema> | undefined;
  if (!raw) {
    const fresh = defaultState();
    await chrome.storage.local.set({ [ROOT_KEY]: fresh });
    return fresh;
  }
  // 안전한 병합 — 저장본이 구버전이면 기본값으로 채움.
  const merged: StorageSchema = {
    version: raw.version ?? SCHEMA_VERSION,
    keyConfig: raw.keyConfig ?? DEFAULT_KEY_CONFIG,
    personas: Array.isArray(raw.personas) ? raw.personas : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    license: { ...DEFAULT_LICENSE, ...(raw.license ?? {}) },
    usage:
      raw.usage && typeof raw.usage.isoDate === 'string'
        ? raw.usage
        : defaultUsage(),
  };
  // 자정 넘김 리셋.
  if (merged.usage.isoDate !== todayIso()) {
    merged.usage = defaultUsage();
    await chrome.storage.local.set({ [ROOT_KEY]: merged });
  }
  return merged;
}

export async function updateState(
  mutator: (s: StorageSchema) => StorageSchema | void,
): Promise<StorageSchema> {
  const current = await getState();
  const draft: StorageSchema = structuredClone(current);
  const result = mutator(draft);
  const next = result ?? draft;
  await chrome.storage.local.set({ [ROOT_KEY]: next });
  return next;
}

export async function setKeyConfig(cfg: KeyConfig | null): Promise<void> {
  await updateState((s) => {
    s.keyConfig = cfg;
  });
}

export async function getKeyConfig(): Promise<KeyConfig | null> {
  const s = await getState();
  return s.keyConfig;
}

export async function savePersona(p: Persona): Promise<void> {
  await updateState((s) => {
    const idx = s.personas.findIndex((x) => x.id === p.id);
    if (idx === -1) s.personas.push(p);
    else s.personas[idx] = p;
    if (!s.settings.activePersonaId) s.settings.activePersonaId = p.id;
  });
}

export async function deletePersona(id: string): Promise<void> {
  await updateState((s) => {
    s.personas = s.personas.filter((p) => p.id !== id);
    if (s.settings.activePersonaId === id) {
      s.settings.activePersonaId = s.personas[0]?.id ?? null;
    }
  });
}

export async function setActivePersona(id: string | null): Promise<void> {
  await updateState((s) => {
    s.settings.activePersonaId = id;
  });
}

export async function incrementUsage(): Promise<UsageDay> {
  const next = await updateState((s) => {
    if (s.usage.isoDate !== todayIso()) {
      s.usage = defaultUsage();
    }
    s.usage.count += 1;
  });
  return next.usage;
}

export function onStateChanged(
  listener: (newState: StorageSchema | null) => void,
): () => void {
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area !== 'local') return;
    if (!changes[ROOT_KEY]) return;
    const next = changes[ROOT_KEY].newValue as StorageSchema | undefined;
    listener(next ?? null);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

// 파일 상단 상수 노출 — 다른 모듈(e.g. 온보딩)에서 기본 한도 참조.
export const CONSTANTS = {
  SCHEMA_VERSION,
  ROOT_KEY,
  DEFAULT_DAILY_LIMIT: DEFAULT_SETTINGS.dailyFreeLimit,
} as const;
