import { useEffect, useState } from 'react';
import { getState, onStateChanged, setActivePersona } from '@/shared/storage';
import type { Persona, StorageSchema } from '@/shared/types';
import { licenseGateway } from '@/shared/license';

/**
 * Popup은 유저가 "지금 얼마나 쓸 수 있는지 + 어디로 가야 하는지"를 1초 안에 판단하게 한다.
 * CTA 우선순위: (1) 키·퍼소나 미설정 → Setup (2) 설정 완료 → Open X (3) 무료 잔량 낮음 → Upgrade.
 */
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
  const hasPersona = state.personas.length > 0;
  const setupComplete = hasKey && hasPersona;
  const limit = state.settings.dailyFreeLimit;
  const remaining = Math.max(0, limit - state.usage.count);
  const lowRemaining = !paid && remaining <= Math.max(1, Math.floor(limit * 0.2));

  const openX = () => {
    chrome.tabs.create({ url: 'https://x.com/home' }).catch(() => void 0);
  };

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

      {!setupComplete ? (
        <SetupChecklist hasKey={hasKey} hasPersona={hasPersona} />
      ) : (
        <>
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
              {paid ? (
                <div className="stat">
                  <span className="muted">Today</span>
                  <b>∞</b>
                </div>
              ) : (
                <div className={`stat ${lowRemaining ? 'warn' : ''}`}>
                  <span className="muted">Free today</span>
                  <b>
                    {remaining}/{limit}
                  </b>
                </div>
              )}
            </div>
          </div>

          {!paid && (
            <div className="row muted" style={{ marginTop: 8, fontSize: 11 }}>
              Free: {limit} replies/day · 1 active persona
            </div>
          )}
        </>
      )}

      <div className="divider" />

      <div className="row actions">
        {setupComplete && (
          <button type="button" className="btn primary grow" onClick={openX}>
            Open X →
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => chrome.runtime.openOptionsPage?.()}
        >
          Settings
        </button>
      </div>

      {!paid && setupComplete && (
        <div className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`btn ${lowRemaining ? 'primary' : 'ghost'} grow`}
            onClick={() => void licenseGateway.openCheckout()}
          >
            {lowRemaining ? `Running low · Upgrade $3.99` : `Upgrade $3.99 (unlimited)`}
          </button>
        </div>
      )}

      {activePersona && (
        <div className="muted" style={{ marginTop: 10, fontSize: 11 }}>
          Voice: <b>{activePersona.name}</b>
          {activePersona.examples.length > 0 &&
            ` · ${activePersona.examples.length} example${activePersona.examples.length > 1 ? 's' : ''}`}
        </div>
      )}
    </div>
  );
}

function SetupChecklist({ hasKey, hasPersona }: { hasKey: boolean; hasPersona: boolean }) {
  return (
    <div>
      <div className="muted" style={{ marginBottom: 8 }}>
        Finish setup to start using ✨ on X:
      </div>
      <div className="checklist">
        <div className={`check ${hasKey ? 'done' : ''}`}>
          <span className="bullet">{hasKey ? '✓' : '1'}</span>
          <span>Add your AI key</span>
        </div>
        <div className={`check ${hasPersona ? 'done' : ''}`}>
          <span className="bullet">{hasPersona ? '✓' : '2'}</span>
          <span>Create a persona</span>
        </div>
      </div>
    </div>
  );
}
