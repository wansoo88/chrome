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
/**
 * v1: paid:bool · purchasedAt
 * v2 (2026-04-25): 4-tier 결제 모델 도입. License를 tier·startedAt·trialExpiresAt·trialEmail로 확장.
 *   migrate(): v1.paid===true → v2.tier='lifetime'; v1.paid===false → v2.tier='free'
 */
const SCHEMA_VERSION = 2;

const DEFAULT_SETTINGS: Settings = {
  activePersonaId: null,
  languagePref: 'auto',
  dailyFreeLimit: 5,
};

const DEFAULT_LICENSE: License = {
  tier: 'free',
  startedAt: null,
  trialExpiresAt: null,
  trialEmail: null,
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
 * 저장본 병합 — 구버전/누락 필드를 기본값으로 채움. 자정 리셋은 반영하지 않음(ensureUsageFresh).
 *
 * Migration:
 * - v1 → v2: paid:bool를 tier로 변환. paid===true → 'lifetime', paid===false → 'free'.
 *   purchasedAt → startedAt. 새 trial 필드는 null.
 */
function mergeState(raw: Partial<StorageSchema>): StorageSchema {
  const rawLicense = (raw.license ?? {}) as Partial<License> & {
    paid?: boolean;
    purchasedAt?: number | null;
  };
  const license = migrateLicense(rawLicense, raw.version);

  return {
    version: SCHEMA_VERSION,
    keyConfig: raw.keyConfig ?? null,
    personas: Array.isArray(raw.personas) ? raw.personas : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    license,
    usage:
      raw.usage && typeof raw.usage.isoDate === 'string'
        ? raw.usage
        : defaultUsage(),
  };
}

/**
 * v1 → v2 라이선스 마이그레이션. v2 이상이면 그대로 통과.
 */
function migrateLicense(
  raw: Partial<License> & { paid?: boolean; purchasedAt?: number | null },
  version: number | undefined,
): License {
  // v2 형식인 경우 (tier 필드 있음).
  if (typeof raw.tier === 'string') {
    return { ...DEFAULT_LICENSE, ...raw };
  }
  // v1 형식 (paid:bool).
  if (typeof raw.paid === 'boolean') {
    return {
      tier: raw.paid ? 'lifetime' : 'free',
      startedAt: raw.purchasedAt ?? null,
      trialExpiresAt: null,
      trialEmail: null,
    };
  }
  // 알 수 없는 형식 또는 빈 값.
  void version;
  return { ...DEFAULT_LICENSE };
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

/**
 * 라이선스 셀렉터 — storage 내부 구조를 외부 레이어(license.ts)에 누설하지 않기 위해 제공.
 */
export async function getLicense(): Promise<StorageSchema['license']> {
  const s = await getState();
  return s.license;
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
