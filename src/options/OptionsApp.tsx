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

const PROVIDER_INFO: Record<
  Provider,
  { label: string; docUrl: string; modelHint: string }
> = {
  openai: {
    label: 'OpenAI',
    docUrl: 'https://platform.openai.com/api-keys',
    modelHint: 'gpt-4o-mini (default) · gpt-4o · gpt-5-mini',
  },
  anthropic: {
    label: 'Anthropic',
    docUrl: 'https://console.anthropic.com/settings/keys',
    modelHint: 'claude-3-5-haiku-latest (default) · claude-sonnet-4-5',
  },
  openrouter: {
    label: 'OpenRouter',
    docUrl: 'https://openrouter.ai/keys',
    modelHint: 'openai/gpt-4o-mini (default) · anthropic/claude-3.5-haiku',
  },
};

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
  const [provider, setProvider] = useState<Provider>(current?.provider ?? 'openai');
  const [apiKey, setApiKey] = useState<string>(current?.apiKey ?? '');
  const [model, setModel] = useState<string>(current?.model ?? defaultModelFor(provider));
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // provider 전환 시 모델 힌트 자동 갱신.
  useEffect(() => {
    setModel((prev) => {
      const defaults = Object.values(PROVIDER_INFO).map((_, i) => {
        const p: Provider = (['openai', 'anthropic', 'openrouter'] as const)[i]!;
        return defaultModelFor(p);
      });
      // 이전 값이 다른 provider의 기본 모델이라면 교체.
      if (!prev || defaults.includes(prev)) return defaultModelFor(provider);
      return prev;
    });
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
      const res = (await chrome.runtime.sendMessage({ kind: 'verifyKey', cfg })) as {
        ok: boolean;
        error?: string;
      };
      if (res?.ok) {
        await setKeyConfig({ ...cfg, lastVerifiedAt: Date.now() });
        setMsg({ kind: 'ok', text: 'Verified and saved. You are good to go.' });
      } else {
        setMsg({ kind: 'err', text: res?.error ?? 'Verification failed.' });
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
          {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
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
// Persona section
// ──────────────────────────────────────────────────────────────────────────

function PersonaSection({
  personas,
  activeId,
}: {
  personas: Persona[];
  activeId: string | null;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = useMemo(
    () => (editingId ? personas.find((p) => p.id === editingId) : null),
    [editingId, personas],
  );

  async function onCreate() {
    const name = prompt('New persona name?');
    if (!name) return;
    const p: Persona = {
      id: uid('p'),
      name: name.trim().slice(0, 60),
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
                onClick={async () => {
                  if (confirm(`Delete persona "${p.name}"?`)) {
                    await deletePersona(p.id);
                    if (editingId === p.id) setEditingId(null);
                  }
                }}
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
          onClick={() => void onCreate()}
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
