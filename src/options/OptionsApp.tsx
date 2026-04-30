import { useEffect, useMemo, useState } from 'react';
import {
  deletePersona,
  getState,
  onStateChanged,
  savePersona,
  setKeyConfig,
  updateState,
} from '@/shared/storage';
import type {
  KeyConfig,
  Persona,
  Provider,
  StorageSchema,
} from '@/shared/types';
import { defaultModelFor } from '@/background/ai';
import { devSetTier, licenseGateway, trialMsRemaining } from '@/shared/license';
import type { License } from '@/shared/types';
import { uid } from '@/shared/id';
import type { ServerMsg, VerifyKeyRequest } from '@/shared/messages';

/**
 * Options 페이지 루트.
 *
 * 설계:
 * - 상단 OnboardingStepper로 "무엇을 다음에 할지"가 한 눈에 보이게.
 * - Provider는 OpenAI, OpenRouter만 MVP UI에 노출 (Anthropic 직접 호출은 CWS 심사 리스크).
 * - prompt()/confirm() 대신 자체 modal.
 * - DEV 버튼은 Vite의 import.meta.env.DEV로 프로덕션 번들에서 제거.
 */

const PROVIDER_INFO: Record<
  Provider,
  { label: string; docUrl: string; modelHint: string; hideFromUi?: boolean }
> = {
  openai: {
    label: 'OpenAI (ChatGPT)',
    docUrl: 'https://platform.openai.com/api-keys',
    modelHint: 'gpt-4o-mini (default) · gpt-4o · gpt-5-mini',
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    docUrl: 'https://console.anthropic.com/settings/keys',
    modelHint: 'claude-3-5-haiku-latest (default) · claude-3-5-sonnet-latest',
  },
  gemini: {
    label: 'Gemini (Google)',
    docUrl: 'https://aistudio.google.com/app/apikey',
    modelHint: 'gemini-2.0-flash (default) · gemini-1.5-flash · gemini-1.5-pro',
  },
  openrouter: {
    label: 'OpenRouter (advanced)',
    docUrl: 'https://openrouter.ai/keys',
    modelHint:
      'openai/gpt-4o-mini (default) · anthropic/claude-3.5-haiku · many more',
  },
};

// Display order for the dropdown.
const UI_PROVIDERS: Provider[] = (['openai', 'anthropic', 'gemini', 'openrouter'] as Provider[])
  .filter((p) => !PROVIDER_INFO[p].hideFromUi);

export function OptionsApp() {
  const [state, setState] = useState<StorageSchema | null>(null);

  useEffect(() => {
    let active = true;
    void getState().then((s) => {
      if (active) setState(s);
    });
    const unsub = onStateChanged((next) => {
      if (next) setState(next);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  if (!state) return <div className="page muted">Loading…</div>;

  return (
    <div className="page">
      <h1>✨ X Reply Booster</h1>
      <div style={{ fontSize: 15, lineHeight: 1.5, marginTop: 4 }}>
        <b>Stop posting AI-flavored replies.</b> Paste 5 of your real tweets — the AI types like
        you, not like ChatGPT.
      </div>
      <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        Free with Gemini (no card) · $19.99 once for unlimited. Your key stays in your browser —
        the developer never sees it.
      </div>

      <OnboardingStepper state={state} />

      <h2>1. Connect your AI</h2>
      <KeySection current={state.keyConfig} />

      <h2>2. Personas ({state.personas.length})</h2>
      <PersonaSection personas={state.personas} activeId={state.settings.activePersonaId} />

      <h2>3. Preferences</h2>
      <PreferencesSection state={state} />

      <h2>4. License</h2>
      <LicenseSection license={state.license} />

      <h2>Privacy</h2>
      <div className="card muted" style={{ fontSize: 13 }}>
        This extension stores your key and settings in <code>chrome.storage.local</code> on this
        device only. Tweet text you process is sent directly from your browser to your chosen AI
        provider. Nothing reaches the developer's servers.
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <b>Note for bug reports:</b> if you record Network activity in DevTools, your API key
          appears in the <code>Authorization</code> header. Please redact before sharing.
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Stepper
// ──────────────────────────────────────────────────────────────────────────

function OnboardingStepper({ state }: { state: StorageSchema }) {
  const keyDone = Boolean(state.keyConfig?.apiKey);
  const keyVerified = Boolean(state.keyConfig?.lastVerifiedAt);
  const personaReady = state.personas.some((p) => p.examples.filter((e) => e.trim()).length > 0);
  const steps = [
    {
      label: 'Connect AI',
      done: keyVerified || keyDone,
      hint: keyVerified
        ? 'verified'
        : keyDone
          ? 'saved, not yet verified'
          : 'start free with Gemini — no card needed (1 min)',
    },
    {
      label: 'Create persona',
      done: personaReady,
      hint: personaReady ? 'ready' : 'add at least 1 example tweet',
    },
    {
      label: 'Try it on X',
      done: false,
      hint: 'open x.com, click ✨ on a compose box',
      action: 'https://x.com/home',
    },
  ];
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={i} className={`step ${s.done ? 'done' : ''}`}>
          <span className="bullet">{s.done ? '✓' : i + 1}</span>
          <div className="body">
            <div className="label">{s.label}</div>
            <div className="hint">{s.hint}</div>
          </div>
          {s.action && !s.done && (
            <a
              className="btn primary small-btn"
              href={s.action}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Key section
// ──────────────────────────────────────────────────────────────────────────

function KeySection({ current }: { current: KeyConfig | null }) {
  // 새 유저는 Gemini로 시작(무료 티어). 이미 설정한 유저는 기존 선택 유지.
  const initialProvider: Provider =
    current && UI_PROVIDERS.includes(current.provider) ? current.provider : 'gemini';
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [apiKey, setApiKey] = useState<string>(current?.apiKey ?? '');
  const [model, setModel] = useState<string>(current?.model ?? defaultModelFor(provider));
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string; hint?: string } | null>(null);

  useEffect(() => {
    const allDefaults = UI_PROVIDERS.map(defaultModelFor);
    setModel((prev) => (!prev || allDefaults.includes(prev) ? defaultModelFor(provider) : prev));
  }, [provider]);

  const info = PROVIDER_INFO[provider];

  async function onVerify() {
    setVerifying(true);
    setMsg(null);
    const cfg: KeyConfig = {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim() || defaultModelFor(provider),
      lastVerifiedAt: null,
    };
    try {
      const req: VerifyKeyRequest = { kind: 'verifyKey', cfg };
      const res = (await chrome.runtime.sendMessage(req)) as ServerMsg | undefined;
      if (res && res.ok && res.kind === 'verifyKeyOk') {
        await setKeyConfig({ ...cfg, lastVerifiedAt: Date.now() });
        setMsg({ kind: 'ok', text: 'Verified and saved. You are good to go.' });
      } else if (res && res.ok === false) {
        const hint = hintForKeyError(res.message);
        setMsg({ kind: 'err', text: res.message, hint });
      } else {
        setMsg({ kind: 'err', text: 'Unexpected response from background.' });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setVerifying(false);
    }
  }

  async function onSaveWithoutVerify() {
    const cfg: KeyConfig = {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim() || defaultModelFor(provider),
      lastVerifiedAt: null,
    };
    await setKeyConfig(cfg);
    setMsg({ kind: 'ok', text: 'Saved. Verify before use to catch typos.' });
  }

  async function onClear() {
    await setKeyConfig(null);
    setApiKey('');
    setMsg({ kind: 'ok', text: 'Cleared.' });
  }

  return (
    <div className="card">
      <div className="field">
        <label>Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
        >
          {UI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_INFO[p].label}
              {p === 'gemini' ? ' — Free tier' : ''}
            </option>
          ))}
        </select>
        <div className="hint">
          New to {info.label}?{' '}
          <a href={info.docUrl} target="_blank" rel="noreferrer">
            Get a key
          </a>
          .
        </div>
        {provider === 'gemini' && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 8,
              background: 'rgba(34, 197, 94, 0.08)',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            🆓 <b>Free — no credit card required.</b> Google AI Studio gives 1,500 requests/day on{' '}
            <code>gemini-2.0-flash</code>. Sign in with any Google account, click <i>Create API key</i>,
            paste below. Takes about 1 minute.{' '}
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
              Open AI Studio →
            </a>
          </div>
        )}
      </div>

      <div className="field">
        <label>API key</label>
        <input
          type="password"
          name="xrb-api-key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="paste your key"
          autoComplete="new-password"
          spellCheck={false}
        />
        <div className="hint">Stored on this device only. Never sent to the developer.</div>
      </div>

      <div className="field">
        <label>Model</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={defaultModelFor(provider)}
        />
        <div className="hint">{info.modelHint}</div>
      </div>

      <details className="field">
        <summary className="muted" style={{ cursor: 'pointer' }}>How much will it cost?</summary>
        <div className="hint" style={{ marginTop: 8 }}>
          With <code>gpt-4o-mini</code> · <code>claude-3-5-haiku</code> · <code>gemini-2.0-flash</code>-class
          models, each reply costs roughly <b>$0.001</b>. A heavy power user (~50 replies/day) spends{' '}
          <b>~$1.50/month</b>. <b>Gemini</b> has a generous free tier on AI Studio. Cap spending in
          your provider dashboard:{' '}
          <a href="https://platform.openai.com/settings/organization/limits" target="_blank" rel="noreferrer">
            OpenAI
          </a>{' '}
          ·{' '}
          <a href="https://console.anthropic.com/settings/limits" target="_blank" rel="noreferrer">
            Anthropic
          </a>{' '}
          ·{' '}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>{' '}
          ·{' '}
          <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">
            OpenRouter
          </a>
          .
        </div>
      </details>

      <div className="row">
        <button
          type="button"
          className="btn primary"
          onClick={() => void onVerify()}
          disabled={!apiKey.trim() || verifying}
        >
          {verifying ? (
            <>
              <span className="mini-spinner" /> Verifying…
            </>
          ) : (
            'Verify & save'
          )}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void onSaveWithoutVerify()}
          disabled={!apiKey.trim()}
        >
          Save without verifying
        </button>
        {current?.apiKey && (
          <button type="button" className="btn danger" onClick={() => void onClear()}>
            Remove
          </button>
        )}
      </div>

      {msg && (
        <div style={{ marginTop: 10 }}>
          <span className={msg.kind === 'ok' ? 'ok' : 'err'}>{msg.text}</span>
          {msg.hint && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {msg.hint}
            </div>
          )}
        </div>
      )}

      {current?.lastVerifiedAt && (
        <div className="hint" style={{ marginTop: 6 }}>
          Last verified: {new Date(current.lastVerifiedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

/**
 * 키 검증 실패 메시지에 회복 힌트를 붙여줌.
 */
function hintForKeyError(raw: string): string | undefined {
  const s = raw.toLowerCase();
  if (s.includes('401') || s.includes('unauthorized') || s.includes('invalid'))
    return 'The key looks invalid or revoked. Generate a fresh one and paste again.';
  if (s.includes('429') || s.includes('rate')) return 'Rate-limited — wait a minute and retry.';
  if (s.includes('insufficient') || s.includes('quota') || s.includes('credit'))
    return 'Provider account is out of credit. Top up and retry.';
  if (s.includes('network') || s.includes('failed to fetch'))
    return 'Network issue — check your connection and retry.';
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Persona section (자체 modal + 샘플 프리셋)
// ──────────────────────────────────────────────────────────────────────────

const SAMPLE_PERSONA_PRESET: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Builder Dan',
  toneDescription:
    'terse, self-aware, building in public. Lower-case. Occasional dry wit. No hashtags.',
  examples: [
    'shipped v0.3 last night. 7 users so far. feels like a lot and also like nothing.',
    'spent 2 hours chasing a bug that was one line. classic.',
    'best feature requests come from people who already paid.',
    'the mvp does one thing. that is the feature.',
    'if you can explain the pricing in 5 seconds you will sell more of it.',
  ],
};

function PersonaSection({
  personas,
  activeId,
}: {
  personas: Persona[];
  activeId: string | null;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Persona | null>(null);

  const editing = useMemo(
    () => (editingId ? personas.find((p) => p.id === editingId) : null),
    [editingId, personas],
  );

  async function onCreate(name: string) {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    const p: Persona = {
      id: uid('p'),
      name: trimmed,
      toneDescription: '',
      examples: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await savePersona(p);
    setEditingId(p.id);
  }

  async function onAddSample() {
    const p: Persona = {
      ...SAMPLE_PERSONA_PRESET,
      id: uid('p'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await savePersona(p);
    setEditingId(p.id);
  }

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        Teach the AI your voice. Each persona holds example tweets the AI will imitate. More
        examples = better match — <b>5–10 is the sweet spot; more dilutes the signal.</b>
      </div>

      <div className="persona-list">
        {personas.map((p) => (
          <div key={p.id} className="persona-item">
            <div>
              <div className="name">
                {p.name} {p.id === activeId && <span className="chip active">active</span>}
              </div>
              <div className="count">{p.examples.length} examples</div>
            </div>
            <div className="row">
              <button type="button" className="small-btn" onClick={() => setEditingId(p.id)}>
                Edit
              </button>
              <button type="button" className="small-btn" onClick={() => setConfirmDelete(p)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => setNaming(true)}
          disabled={personas.length >= 10}
          title={personas.length >= 10 ? 'Limit: 10 personas' : ''}
        >
          + New persona
        </button>
        {personas.length === 0 && (
          <button type="button" className="btn" onClick={() => void onAddSample()}>
            Try a sample (Builder Dan)
          </button>
        )}
        <span className="muted">{personas.length}/10</span>
      </div>

      {editing && (
        <>
          <div className="divider" />
          <PersonaEditor key={editing.id} persona={editing} onClose={() => setEditingId(null)} />
        </>
      )}

      {naming && (
        <PromptModal
          title="New persona"
          label="Name"
          placeholder="e.g. Builder Dan"
          maxLength={60}
          onCancel={() => setNaming(false)}
          onSubmit={async (v) => {
            setNaming(false);
            await onCreate(v);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete "${confirmDelete.name}"?`}
          description="This will remove the persona and its examples. Cannot be undone."
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const target = confirmDelete;
            setConfirmDelete(null);
            await deletePersona(target.id);
            if (editingId === target.id) setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function PersonaEditor({ persona, onClose }: { persona: Persona; onClose: () => void }) {
  const [name, setName] = useState(persona.name);
  const [tone, setTone] = useState(persona.toneDescription);
  const [examples, setExamples] = useState<string[]>(
    persona.examples.length ? persona.examples : [''],
  );
  const [saved, setSaved] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const filledCount = examples.filter((e) => e.trim()).length;
  const atCap = examples.length >= 10;

  // 빈 줄로 구분된 트윗을 한꺼번에 받아 examples 슬롯에 분배.
  // - 빈 줄(\n\n+) 우선, 없으면 단일 \n도 분리자로 폴백 (단순 트윗 N줄 붙여넣기 케이스).
  // - 280자 잘림, 빈 항목 제거, 최대 10개 합산.
  function applyBulk() {
    const raw = bulkText.trim();
    if (!raw) return;
    let pieces = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
    if (pieces.length < 2) {
      pieces = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    }
    const existing = examples.map((e) => e.trim()).filter(Boolean);
    const combined = [...existing, ...pieces].map((s) => s.slice(0, 280)).slice(0, 10);
    setExamples(combined.length ? combined : ['']);
    setBulkText('');
    setBulkOpen(false);
  }

  async function onSave() {
    const trimmed = examples.map((e) => e.trim()).filter(Boolean);
    await savePersona({
      ...persona,
      name: name.trim() || persona.name,
      toneDescription: tone.trim(),
      examples: trimmed.slice(0, 10),
      updatedAt: Date.now(),
    });
    setSaved(true);
  }

  if (saved) {
    return (
      <div>
        <div className="ok" style={{ fontWeight: 600 }}>Saved. ready to try on X.</div>
        <div className="muted" style={{ marginTop: 6 }}>
          Open x.com, focus any reply box, and click the ✨ icon that appears in the toolbar.
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <a className="btn primary" href="https://x.com/home" target="_blank" rel="noreferrer">
            Open X →
          </a>
          <button type="button" className="btn" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </div>

      <div className="field">
        <label>Tone description (optional)</label>
        <textarea
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder={'e.g. terse, dry, building in public, occasional sarcasm'}
          maxLength={400}
        />
        <div className="hint">Short is better. Examples do most of the work.</div>
      </div>

      <div className="field">
        <label>Example tweets (5–10 is the sweet spot)</label>
        <div className="example-list">
          {examples.map((ex, idx) => (
            <div className="example-row" key={idx}>
              <textarea
                value={ex}
                onChange={(e) => {
                  const next = [...examples];
                  next[idx] = e.target.value.slice(0, 280);
                  setExamples(next);
                }}
                placeholder="Paste one of your actual tweets"
              />
              <button
                type="button"
                className="small-btn"
                onClick={() => setExamples(examples.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="small-btn"
            onClick={() => setExamples([...examples, ''])}
            disabled={atCap}
          >
            + Add example
          </button>
          <button
            type="button"
            className="small-btn"
            onClick={() => setBulkOpen((v) => !v)}
            disabled={atCap}
            title="Paste several tweets at once"
          >
            {bulkOpen ? '↑ Hide bulk paste' : '↓ Bulk paste'}
          </button>
          <span className="muted">
            {filledCount} used / 10 {atCap && ' · limit reached (more examples dilute the voice)'}
          </span>
        </div>

        {bulkOpen && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 8,
              background: 'rgba(0,0,0,0.03)',
              border: '1px dashed var(--border)',
            }}
          >
            <div className="hint" style={{ marginBottom: 6 }}>
              Paste tweets separated by a blank line (or one per line). We'll fill empty slots up to 10.
            </div>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"Tweet 1 here\n\nTweet 2 here\n\nTweet 3 here"}
              rows={6}
              style={{ width: '100%' }}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="btn primary"
                onClick={applyBulk}
                disabled={!bulkText.trim()}
              >
                Add to examples
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setBulkText('');
                  setBulkOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="row">
        <button type="button" className="btn primary" onClick={() => void onSave()}>
          Save
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Preferences
// ──────────────────────────────────────────────────────────────────────────

function PreferencesSection({ state }: { state: StorageSchema }) {
  return (
    <div className="card">
      <div className="field">
        <label>Language</label>
        <select
          value={state.settings.languagePref}
          onChange={async (e) => {
            const v = e.target.value;
            await updateState((s) => {
              s.settings.languagePref = v;
            });
          }}
        >
          <option value="auto">Auto — match original tweet</option>
          <option value="en">English</option>
          <option value="ko">한국어</option>
          <option value="ja">日本語</option>
          <option value="zh">中文</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      {import.meta.env.DEV && (
        <div className="field">
          <label>Free daily limit (dev)</label>
          <select
            value={String(state.settings.dailyFreeLimit)}
            onChange={async (e) => {
              const v = Number(e.target.value);
              await updateState((s) => {
                s.settings.dailyFreeLimit = v;
              });
            }}
          >
            <option value="5">5 (default)</option>
            <option value="3">3</option>
            <option value="10">10</option>
            <option value="1">1</option>
          </select>
          <div className="hint">DEV only — hidden in production builds.</div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// License
// ──────────────────────────────────────────────────────────────────────────

function LicenseSection({ license }: { license: License }) {
  // trial 만료를 즉시 반영 (storage에 강등 저장은 background alarm이 하지만, UI는 시간 비교만으로 표시).
  const trialActive =
    license.tier === 'trial' &&
    license.trialExpiresAt !== null &&
    license.trialExpiresAt > Date.now();
  const effectiveTier =
    license.tier === 'trial' && !trialActive ? 'free' : license.tier;

  return (
    <div className="card">
      {effectiveTier === 'lifetime' && <LifetimeBlock startedAt={license.startedAt} />}
      {effectiveTier === 'monthly' && <MonthlyBlock startedAt={license.startedAt} />}
      {effectiveTier === 'trial' && (
        <TrialActiveBlock msRemaining={trialMsRemaining(license)} email={license.trialEmail} />
      )}
      {effectiveTier === 'free' && <FreeBlock license={license} />}

      {import.meta.env.DEV && (
        <div className="row" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
          <span className="muted" style={{ marginRight: 8 }}>DEV:</span>
          <button type="button" className="small-btn" onClick={() => void devSetTier('free')}>
            Free
          </button>
          <button type="button" className="small-btn" onClick={() => void devSetTier('trial', 7)}>
            Trial 7d
          </button>
          <button type="button" className="small-btn" onClick={() => void devSetTier('monthly')}>
            Monthly
          </button>
          <button type="button" className="small-btn" onClick={() => void devSetTier('lifetime')}>
            Lifetime
          </button>
        </div>
      )}
    </div>
  );
}

function LifetimeBlock({ startedAt }: { startedAt: number | null }) {
  return (
    <div>
      <div className="ok" style={{ fontWeight: 700, fontSize: 16 }}>Lifetime Pro — thanks!</div>
      <div className="muted" style={{ marginTop: 4 }}>
        Unlimited replies · 10 personas · Thread hints. Pay once. Forever.
      </div>
      {startedAt && (
        <div className="hint" style={{ marginTop: 6 }}>
          Purchased {new Date(startedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function MonthlyBlock({ startedAt }: { startedAt: number | null }) {
  return (
    <div>
      <div className="ok" style={{ fontWeight: 700, fontSize: 16 }}>Pro Monthly — active</div>
      <div className="muted" style={{ marginTop: 4 }}>
        Unlimited replies · 10 personas · Thread hints. $3.99/month.
      </div>
      {startedAt && (
        <div className="hint" style={{ marginTop: 6 }}>
          Renewed {new Date(startedAt).toLocaleDateString()}. Manage subscription via the receipt
          email from ExtensionPay.
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn"
          onClick={() => void licenseGateway.openCheckout('lifetime')}
        >
          Switch to Lifetime ($19.99)
        </button>
      </div>
    </div>
  );
}

function TrialActiveBlock({ msRemaining, email }: { msRemaining: number; email: string | null }) {
  const days = Math.floor(msRemaining / (24 * 3600 * 1000));
  const hours = Math.floor((msRemaining % (24 * 3600 * 1000)) / (3600 * 1000));
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent, #1d9bf0)' }}>
        🎁 Pro Trial — active
      </div>
      <div className="muted" style={{ marginTop: 4 }}>
        Unlimited replies · 10 personas · Thread hints.
      </div>
      <div style={{ marginTop: 8, fontSize: 13 }}>
        <b>{days}d {hours}h remaining</b>
        {email && <span className="muted"> · {email}</span>}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => void licenseGateway.openCheckout('lifetime')}
        >
          Upgrade to Lifetime $19.99
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void licenseGateway.openCheckout('monthly')}
        >
          $3.99/mo
        </button>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        After trial: auto-downgrade to Free Forever (5/day, 1 persona). No charge unless you upgrade.
      </div>
    </div>
  );
}

function FreeBlock({ license }: { license: License }) {
  const [email, setEmail] = useState('');
  const [trialMsg, setTrialMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [starting, setStarting] = useState(false);

  const trialUsedBefore = Boolean(license.trialEmail);

  async function startTrial() {
    setStarting(true);
    setTrialMsg(null);
    const r = await licenseGateway.startTrialWithEmail(email);
    setStarting(false);
    if (!r.ok) {
      setTrialMsg({ ok: false, text: r.error ?? 'Failed to start trial.' });
    } else {
      setTrialMsg({ ok: true, text: '7-day Pro Trial started. Enjoy!' });
      setEmail('');
    }
  }

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>Free Forever</div>
      <div className="muted" style={{ marginTop: 4 }}>
        5 replies/day · 1 persona. Upgrade to remove limits.
      </div>

      {/* 가격 비교 앵커 */}
      <div
        style={{
          marginTop: 14,
          padding: 10,
          borderRadius: 8,
          background: 'rgba(29, 155, 240, 0.06)',
          border: '1px solid rgba(29, 155, 240, 0.15)',
          fontSize: 13,
        }}
      >
        💡 <b>TweetHunter</b> = $49/mo ($588/yr) · <b>Hypefury</b> = $19/mo · <b>This</b> ={' '}
        <b style={{ color: 'var(--accent, #1d9bf0)' }}>$3.99/mo or $19.99 once</b>. Up to 30× less.
      </div>

      {/* Pro Trial 시작 */}
      {!trialUsedBefore ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>🎁 Try Pro free for 7 days</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Unlimited replies · 10 personas · Thread hints. No charge after — auto-downgrade to free.
          </div>
          <div className="row" style={{ marginTop: 8, alignItems: 'stretch' }}>
            <input
              type="email"
              autoComplete="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => void startTrial()}
              disabled={!email.trim() || starting}
            >
              {starting ? 'Starting…' : 'Start 7-day Trial'}
            </button>
          </div>
          {trialMsg && (
            <div className={trialMsg.ok ? 'ok' : 'err'} style={{ marginTop: 6, fontSize: 12 }}>
              {trialMsg.text}
            </div>
          )}
          <div className="hint" style={{ marginTop: 6 }}>
            Email is used by ExtensionPay to verify trial eligibility (one trial per email). It is
            not added to any list.
          </div>
        </div>
      ) : (
        <div
          className="muted"
          style={{
            marginTop: 14,
            padding: 10,
            borderRadius: 8,
            background: 'rgba(0,0,0,0.03)',
            fontSize: 12,
          }}
        >
          Trial already used for <b>{license.trialEmail}</b>. To unlock Pro, upgrade below.
        </div>
      )}

      {/* Upgrade tier 선택 */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
          Choose your plan
        </div>
        <div className="tier-grid">
          <button
            type="button"
            className="tier-card"
            onClick={() => void licenseGateway.openCheckout('monthly')}
          >
            <div className="tier-name">Monthly</div>
            <div className="tier-price">
              <b>$3.99</b>
              <span className="muted">/mo</span>
            </div>
            <div className="tier-note muted">Cancel anytime</div>
          </button>
          <button
            type="button"
            className="tier-card recommended"
            onClick={() => void licenseGateway.openCheckout('lifetime')}
          >
            <div className="tier-badge">★ Best value</div>
            <div className="tier-name">Lifetime</div>
            <div className="tier-price">
              <b>$19.99</b>
              <span className="muted"> once</span>
            </div>
            <div className="tier-note muted">Pay once. Own forever. ~5 mo of monthly.</div>
          </button>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 12 }}>
        Secure checkout by ExtensionPay (Stripe-backed). 7-day no-questions refund. Lifetime
        license restores on any device when you log in with your purchase email.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 자체 modal
// ──────────────────────────────────────────────────────────────────────────

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        className="card"
        style={{ width: 'min(420px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function PromptModal({
  title,
  label,
  placeholder,
  maxLength,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  placeholder?: string;
  maxLength?: number;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <ModalShell title={title} onClose={onCancel}>
      <div className="field">
        <label>{label}</label>
        <input
          type="text"
          autoFocus
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) void onSubmit(value);
          }}
        />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!value.trim()}
          onClick={() => void onSubmit(value)}
        >
          Create
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onCancel}>
      {description && <div className="muted" style={{ marginBottom: 14 }}>{description}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={destructive ? 'btn danger' : 'btn primary'}
          onClick={() => void onConfirm()}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
