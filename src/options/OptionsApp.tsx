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
import { devSetPaid, licenseGateway } from '@/shared/license';
import { uid } from '@/shared/id';
import type { ServerMsg, VerifyKeyRequest } from '@/shared/messages';

/**
 * Options 페이지 루트.
 *
 * 설계 주의:
 * - Provider는 OpenAI, OpenRouter만 MVP에서 노출. Anthropic 직접 호출은 CORS 관련
 *   `anthropic-dangerous-direct-browser-access` 헤더가 필요해 CWS 심사 리스크 → Claude 모델은
 *   OpenRouter 경유를 권장.
 * - prompt()/confirm() 네이티브 다이얼로그 대신 자체 modal 사용 (CWS 품질 신호).
 */

const PROVIDER_INFO: Record<
  Provider,
  { label: string; docUrl: string; modelHint: string; hideFromUi?: boolean }
> = {
  openai: {
    label: 'OpenAI',
    docUrl: 'https://platform.openai.com/api-keys',
    modelHint: 'gpt-4o-mini (default) · gpt-4o · gpt-5-mini',
  },
  openrouter: {
    label: 'OpenRouter',
    docUrl: 'https://openrouter.ai/keys',
    modelHint:
      'openai/gpt-4o-mini (default) · anthropic/claude-3.5-haiku · many more',
  },
  anthropic: {
    label: 'Anthropic (advanced)',
    docUrl: 'https://console.anthropic.com/settings/keys',
    modelHint: 'claude-3-5-haiku-latest · may require CORS override',
    hideFromUi: true,
  },
};

const UI_PROVIDERS: Provider[] = (
  Object.keys(PROVIDER_INFO) as Provider[]
).filter((p) => !PROVIDER_INFO[p].hideFromUi);

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
      <div className="muted">
        Your voice on X. Pay once $3.99. Bring your own AI key — it never leaves your browser.
      </div>

      <h2>1. Connect your AI</h2>
      <KeySection current={state.keyConfig} />

      <h2>2. Personas ({state.personas.length})</h2>
      <PersonaSection personas={state.personas} activeId={state.settings.activePersonaId} />

      <h2>3. Preferences</h2>
      <PreferencesSection state={state} />

      <h2>4. License</h2>
      <LicenseSection paid={state.license.paid} />

      <h2>Privacy</h2>
      <div className="card muted" style={{ fontSize: 13 }}>
        This extension stores your key and settings in <code>chrome.storage.local</code> on this
        device only. Tweet text you choose to process is sent directly from your browser to your
        chosen AI provider. Nothing reaches the developer's servers.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Key section
// ──────────────────────────────────────────────────────────────────────────

function KeySection({ current }: { current: KeyConfig | null }) {
  const initialProvider: Provider =
    current && UI_PROVIDERS.includes(current.provider) ? current.provider : 'openai';
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [apiKey, setApiKey] = useState<string>(current?.apiKey ?? '');
  const [model, setModel] = useState<string>(current?.model ?? defaultModelFor(provider));
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // provider 전환 시 모델이 비어있거나 다른 제공자의 기본값이면 새 기본값으로 교체.
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
        setMsg({ kind: 'err', text: res.message });
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
    setMsg({ kind: 'ok', text: 'Saved. Consider verifying before use.' });
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
        <div className="chips">
          {UI_PROVIDERS.map((p) => (
            <button
              type="button"
              key={p}
              className={`chip ${p === provider ? 'active' : ''}`}
              onClick={() => setProvider(p)}
            >
              {PROVIDER_INFO[p].label}
            </button>
          ))}
        </div>
        <div className="hint">
          New to {info.label}?{' '}
          <a href={info.docUrl} target="_blank" rel="noreferrer">
            Get a key
          </a>
          . Expect ≈$0.001 per reply with a small model.
        </div>
      </div>

      <div className="field">
        <label>API key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="paste your key"
          autoComplete="off"
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

      <div className="row">
        <button
          type="button"
          className="btn primary"
          onClick={() => void onVerify()}
          disabled={!apiKey.trim() || verifying}
        >
          {verifying ? 'Verifying…' : 'Verify & save'}
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

// ──────────────────────────────────────────────────────────────────────────
// Persona section (자체 modal — 네이티브 prompt/confirm 대신)
// ──────────────────────────────────────────────────────────────────────────

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

  return (
    <div className="card">
      <div className="muted" style={{ marginBottom: 10 }}>
        Teach the AI your voice. Each persona holds example tweets the AI will imitate. More
        examples = better match.
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
              <button
                type="button"
                className="small-btn"
                onClick={() => setConfirmDelete(p)}
              >
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

  async function onSave() {
    const trimmed = examples.map((e) => e.trim()).filter(Boolean);
    await savePersona({
      ...persona,
      name: name.trim() || persona.name,
      toneDescription: tone.trim(),
      examples: trimmed.slice(0, 10),
      updatedAt: Date.now(),
    });
    onClose();
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
        <div className="hint">Shortest useful description. Examples do most of the work.</div>
      </div>

      <div className="field">
        <label>Example tweets (up to 10)</label>
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
            disabled={examples.length >= 10}
          >
            + Add example
          </button>
          <span className="muted">{examples.filter((e) => e.trim()).length} used / 10</span>
        </div>
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
        <div className="hint">Users see this via upgrade prompts; dev can tune while testing.</div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// License
// ──────────────────────────────────────────────────────────────────────────

function LicenseSection({ paid }: { paid: boolean }) {
  return (
    <div className="card">
      {paid ? (
        <div>
          <div className="ok" style={{ fontWeight: 600 }}>Upgraded — thanks!</div>
          <div className="muted" style={{ marginTop: 4 }}>
            Unlimited generations · Up to 10 personas.
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={() => void devSetPaid(false)}
              title="Dev only — revert to free for testing."
            >
              DEV: revert to free
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Upgrade — $3.99 once, forever</div>
          <ul className="muted" style={{ margin: '8px 0 0 18px', padding: 0 }}>
            <li>Unlimited generations</li>
            <li>Up to 10 personas</li>
            <li>Thread hints for mid-compose suggestions</li>
          </ul>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void licenseGateway.openCheckout()}
            >
              Upgrade
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void devSetPaid(true)}
              title="Dev only — simulate paid state for testing."
            >
              DEV: mark paid
            </button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            Payments are processed by ExtensionPay (connected once the developer account is
            registered).
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 자체 modal — 네이티브 prompt/confirm 대신 사용. Chrome 확장 심사 품질 신호.
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
