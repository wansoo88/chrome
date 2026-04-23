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
 * - 모든 상태를 단일 "xrb.state" 루트 아래 보관 → 한 번의 read/write로 원자적.
 * - getState는 read-only — 자정 리셋 판정/쓰기는 ensureUsageFresh에서 별도로 수행.
 *   (여러 UI 컨텍스트가 동시에 열려 있을 때 읽기만으로 쓰기 연쇄가 터지는 걸 방지)
 * - updateState는 background 내부에서만 써야 이상적이지만, Options/Popup에서 쓰기도
 *   허용 (유저 조작 빈도가 낮고 한 번에 하나의 UI만 활성).
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
    keyConfig: null,
    personas: [],
    settings: { ...DEFAULT_SETTINGS },
    license: { ...DEFAULT_LICENSE },
    usage: defaultUsage(),
  };
}

/**
 * 저장본 병합 — 구버전/누락 필드를 기본값으로 채움.
 * 자정 리셋은 반영하지 않음 (읽기 전용; ensureUsageFresh 참조).
 */
function mergeState(raw: Partial<StorageSchema>): StorageSchema {
  return {
    version: raw.version ?? SCHEMA_VERSION,
    keyConfig: raw.keyConfig ?? null,
    personas: Array.isArray(raw.personas) ? raw.personas : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    license: { ...DEFAULT_LICENSE, ...(raw.license ?? {}) },
    usage:
      raw.usage && typeof raw.usage.isoDate === 'string'
        ? raw.usage
        : defaultUsage(),
  };
}

export async function getState(): Promise<StorageSchema> {
  const row = await chrome.storage.local.get(ROOT_KEY);
  const raw = row[ROOT_KEY] as Partial<StorageSchema> | undefined;
  if (!raw) return defaultState();
  return mergeState(raw);
}

/**
 * 오늘 날짜와 다르면 usage를 초기화. write는 실제로 바뀐 경우에만.
 * background에서 필요한 시점(generate 처리 직전)에 호출.
 */
export async function ensureUsageFresh(): Promise<StorageSchema> {
  const row = await chrome.storage.local.get(ROOT_KEY);
  const raw = row[ROOT_KEY] as Partial<StorageSchema> | undefined;
  const merged = raw ? mergeState(raw) : defaultState();
  const iso = todayIso();
  if (merged.usage.isoDate !== iso) {
    merged.usage = defaultUsage();
    await chrome.storage.local.set({ [ROOT_KEY]: merged });
  } else if (!raw) {
    // 빈 저장소에 기본값을 쓴 적이 없다면 최초 1회 물질화.
    await chrome.storage.local.set({ [ROOT_KEY]: merged });
  }
  return merged;
}

/**
 * read-modify-write. 두 호출이 동시에 들어오면 마지막 승자가 이김 → 가능한 한 background
 * 단일 컨텍스트로 수렴시키는 게 바람직. UI 쓰기는 결정성이 낮은 설정/퍼소나 CRUD로 제한.
 */
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

/**
 * usage.count += 1. ensureUsageFresh와 쌍으로 사용. 호출 측(background)이 직렬화 보장.
 */
export async function incrementUsage(): Promise<UsageDay> {
  const next = await updateState((s) => {
    if (s.usage.isoDate !== todayIso()) s.usage = defaultUsage();
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

export const CONSTANTS = {
  SCHEMA_VERSION,
  ROOT_KEY,
  DEFAULT_DAILY_LIMIT: DEFAULT_SETTINGS.dailyFreeLimit,
} as const;
