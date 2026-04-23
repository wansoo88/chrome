import { useEffect, useState } from 'react';
import { getState, onStateChanged, setActivePersona } from '@/shared/storage';
import type { Persona, StorageSchema } from '@/shared/types';
import { licenseGateway } from '@/shared/license';

export function PopupApp() {
  const [state, setState] = useState<StorageSchema | null>(null);
  const [paid, setPaid] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [s, p] = await Promise.all([getState(), licenseGateway.checkPaid()]);
      if (!active) return;
      setState(s);
      setPaid(p);
    })();
    const unsub = onStateChanged((next) => {
      if (next) setState(next);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  if (!state) {
    return (
      <div className="container">
        <div className="muted">Loading…</div>
      </div>
    );
  }

  const activePersona: Persona | undefined = state.personas.find(
    (p) => p.id === state.settings.activePersonaId,
  );

  const hasKey = Boolean(state.keyConfig?.apiKey);
  const usageToday = state.usage.count;
  const limit = state.settings.dailyFreeLimit;
  const remaining = Math.max(0, limit - usageToday);

  return (
    <div className="container">
      <div className="row">
        <div className="title">
          <span>✨</span>
          <span>X Reply Booster</span>
        </div>
        {paid ? <span className="chip">PRO</span> : <span className="chip">Free</span>}
      </div>

      <div className="divider" />

      <div className="row">
        <div className="muted">Active persona</div>
        <select
          className="select"
          value={state.settings.activePersonaId ?? ''}
          onChange={(e) => void setActivePersona(e.target.value || null)}
        >
          <option value="">(none)</option>
          {state.personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <div className="stats">
          <div className="stat">
            <span className="muted">Personas</span>
            <b>{state.personas.length}</b>
          </div>
          {!paid && (
            <div className="stat">
              <span className="muted">Free today</span>
              <b>
                {remaining}/{limit}
              </b>
            </div>
          )}
          {paid && (
            <div className="stat">
              <span className="muted">Today</span>
              <b>∞</b>
            </div>
          )}
        </div>
      </div>

      <div className="divider" />

      {!hasKey && (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted">⚠ Add an AI key to start.</span>
        </div>
      )}

      {!activePersona && state.personas.length === 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted">Create a persona (teach it your voice).</span>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn"
          onClick={() => chrome.runtime.openOptionsPage?.()}
        >
          Settings
        </button>
        {!paid && (
          <button
            type="button"
            className="btn primary"
            onClick={() => void licenseGateway.openCheckout()}
          >
            Upgrade $3.99
          </button>
        )}
      </div>
    </div>
  );
}
