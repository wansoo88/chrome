import { useEffect, useState } from 'react';
import { getState, onStateChanged, setActivePersona } from '@/shared/storage';
import type { LicenseTier, Persona, Stats, StorageSchema } from '@/shared/types';
import { licenseGateway, trialMsRemaining } from '@/shared/license';

/**
 * Popup은 유저가 "지금 얼마나 쓸 수 있는지 + 어디로 가야 하는지"를 1초 안에 판단하게 한다.
 * CTA 우선순위: (1) 키·퍼소나 미설정 → Setup (2) 설정 완료 → Open X (3) 무료 잔량 낮음 → Upgrade.
 */
export function PopupApp() {
  const [state, setState] = useState<StorageSchema | null>(null);
  const [tier, setTier] = useState<LicenseTier>('free');

  useEffect(() => {
    let active = true;
    (async () => {
      const [s, t] = await Promise.all([getState(), licenseGateway.currentTier()]);
      if (!active) return;
      setState(s);
      setTier(t);
    })();
    const unsub = onStateChanged((next) => {
      if (next) {
        setState(next);
        // tier도 즉시 재계산 (만료 trial 강등 반영).
        void licenseGateway.currentTier().then(setTier);
      }
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
  const isPro = tier === 'trial' || tier === 'monthly' || tier === 'lifetime';
  const lowRemaining = !isPro && remaining <= Math.max(1, Math.floor(limit * 0.2));
  const trialMs = trialMsRemaining(state.license);
  const trialDays = Math.floor(trialMs / (24 * 3600 * 1000));

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
        <TierChip tier={tier} trialDays={trialDays} />
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
              {isPro ? (
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

          {!isPro && (
            <div className="row muted" style={{ marginTop: 8, fontSize: 11 }}>
              Free: {limit} replies/day · 1 active persona
            </div>
          )}

          <WeeklyStatWidget stats={state.stats} />

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

      {!isPro && setupComplete && (
        <div className="row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`btn ${lowRemaining ? 'primary' : 'ghost'} grow`}
            onClick={() => void licenseGateway.openCheckout('lifetime')}
          >
            {lowRemaining
              ? `Running low · $19.99 unlimited`
              : `Pro: $3.99/mo or $19.99 once`}
          </button>
        </div>
      )}

      {tier === 'trial' && (
        <div
          className="row"
          style={{
            marginTop: 8,
            padding: 8,
            borderRadius: 8,
            background: 'rgba(29, 155, 240, 0.08)',
            fontSize: 12,
          }}
        >
          🎁 Trial: {trialDays}d remaining ·{' '}
          <button
            type="button"
            className="btn ghost"
            style={{ padding: '4px 10px', marginLeft: 'auto' }}
            onClick={() => void licenseGateway.openCheckout('lifetime')}
          >
            Upgrade $19.99
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

function WeeklyStatWidget({ stats }: { stats: Stats }) {
  // 최근 7일치 합산. 없으면 위젯 숨김 (첫 사용자에겐 정보 가치 낮음).
  const weekTotal = stats.weeklyInserted.reduce((sum, d) => sum + d.count, 0);
  if (weekTotal === 0 && stats.totalInserted === 0) return null;
  // 1삽입 = ~90초 절약 가정. 분 단위 표기.
  const savedMinutes = Math.round((weekTotal * 90) / 60);
  return (
    <div
      style={{
        marginTop: 10,
        padding: 8,
        borderRadius: 8,
        background: 'rgba(0, 186, 124, 0.08)',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span>
        <b>{weekTotal}</b> replies this week
      </span>
      {savedMinutes > 0 && (
        <span style={{ opacity: 0.75 }}>
          ≈ {savedMinutes} min saved
        </span>
      )}
    </div>
  );
}

function TierChip({ tier, trialDays }: { tier: LicenseTier; trialDays: number }) {
  if (tier === 'lifetime') {
    return <span className="chip" style={{ background: 'rgba(0,186,124,0.15)', color: '#00ba7c' }}>LIFETIME</span>;
  }
  if (tier === 'monthly') {
    return <span className="chip" style={{ background: 'rgba(0,186,124,0.15)', color: '#00ba7c' }}>PRO · MONTHLY</span>;
  }
  if (tier === 'trial') {
    return <span className="chip" style={{ background: 'rgba(29,155,240,0.15)' }}>TRIAL · {trialDays}d</span>;
  }
  return <span className="chip">Free</span>;
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
