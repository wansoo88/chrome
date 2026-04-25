import { getLicense, updateState } from './storage';
import type { LicenseTier } from './types';

/**
 * 라이선스 게이트 — 4-tier 모델 (free / trial / monthly / lifetime).
 *
 * 현재(MVP): ExtensionPay 연결은 계정 셋팅 후 주입. 이 모듈은 stable interface를 제공하며
 * `src/shared/extpay.ts`를 추가해 `licenseGateway`만 교체하면 된다.
 *
 * 교체 절차:
 *   1) ExtensionPay 계정 + 2개 product 생성 (Monthly $3.99 / Lifetime $19.99 + Trial 7day)
 *   2) `pnpm add extensionpay`
 *   3) 이 파일의 `licenseGateway`를 ExtPayGateway로 교체. ExtPay user.paid·user.subscriptionStatus·trialStartedAt
 *      등을 폴링해 우리 storage의 tier로 동기화.
 *   4) startTrialWithEmail이 ExtensionPay magic-link를 발송하도록 연결.
 *      같은 이메일 재시도는 ExtensionPay 백엔드가 거부 → abuse 방지.
 *
 * 권한:
 * - free: dailyFreeLimit 차감 + persona 1개
 * - trial · monthly · lifetime: 무제한 + persona 10개
 *
 * trial 만료 자동 강등:
 * - background에서 chrome.alarms로 매시간 isTrialActive를 체크. 만료 시 tier='free'로 다운.
 */

export interface LicenseGateway {
  /** 현재 활성 tier (만료된 trial은 free로 보임). */
  currentTier(): Promise<LicenseTier>;

  /** Pro 권한이 활성인가. trial/monthly/lifetime이면 true. */
  isPro(): Promise<boolean>;

  /** 결제 페이지 열기. tier 인자에 따라 monthly·lifetime 결제 URL로 분기. */
  openCheckout(tier: 'monthly' | 'lifetime'): Promise<void>;

  /** Trial 시작 — 이메일 verify 후 7일 카운트다운. 같은 이메일 재시도는 거부. */
  startTrialWithEmail(email: string): Promise<{ ok: boolean; error?: string }>;
}

class StubGateway implements LicenseGateway {
  async currentTier(): Promise<LicenseTier> {
    const license = await getLicense();
    // trial 만료 검사: storage가 stale일 수 있으므로 호출 시점 비교.
    if (license.tier === 'trial' && license.trialExpiresAt && license.trialExpiresAt < Date.now()) {
      return 'free';
    }
    return license.tier;
  }

  async isPro(): Promise<boolean> {
    const tier = await this.currentTier();
    return tier === 'trial' || tier === 'monthly' || tier === 'lifetime';
  }

  async openCheckout(tier: 'monthly' | 'lifetime'): Promise<void> {
    // Stub: Options 페이지로 이동 (해시로 어떤 tier인지 힌트).
    // 실제 ExtensionPay 연결 시 product 별 결제 URL로 분기.
    const url = chrome.runtime.getURL(`src/options/index.html#upgrade=${tier}`);
    await chrome.tabs.create({ url });
  }

  async startTrialWithEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    const trimmed = email.trim().toLowerCase();
    if (!isValidEmail(trimmed)) {
      return { ok: false, error: 'Please enter a valid email.' };
    }
    // Stub: 이메일 verify 없이 즉시 trial 시작.
    // 실제 ExtensionPay 연결 시 magic-link 발송 + 같은 이메일 재시도 거부.
    const license = await getLicense();
    if (license.trialEmail) {
      return {
        ok: false,
        error: `Trial already used for ${license.trialEmail}. Upgrade to continue.`,
      };
    }
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    await updateState((s) => {
      s.license = {
        tier: 'trial',
        startedAt: now,
        trialExpiresAt: now + sevenDays,
        trialEmail: trimmed,
      };
    });
    return { ok: true };
  }
}

export const licenseGateway: LicenseGateway = new StubGateway();

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Trial 만료 자동 강등 — background의 hourly alarm에서 호출.
 * 만료된 trial이면 tier='free'로 변경 (trialEmail은 보존 → 같은 이메일 재시작 방지).
 */
export async function checkAndDowngradeExpiredTrial(): Promise<boolean> {
  const license = await getLicense();
  if (license.tier !== 'trial' || !license.trialExpiresAt) return false;
  if (license.trialExpiresAt > Date.now()) return false;
  await updateState((s) => {
    s.license = {
      ...s.license,
      tier: 'free',
      // trialEmail·trialExpiresAt는 보존 — 같은 이메일 재발급 방지 + UI에 만료 사실 표시.
    };
  });
  return true;
}

/**
 * Trial 남은 시간 (ms). active가 아니거나 만료면 0.
 */
export function trialMsRemaining(license: {
  tier: LicenseTier;
  trialExpiresAt: number | null;
}): number {
  if (license.tier !== 'trial' || !license.trialExpiresAt) return 0;
  return Math.max(0, license.trialExpiresAt - Date.now());
}

/**
 * 개발 편의: 수동 tier 토글. Options "DEV" 섹션에서만 노출 (env.DEV 가드).
 */
export async function devSetTier(
  tier: LicenseTier,
  trialDays = 7,
): Promise<void> {
  await updateState((s) => {
    const now = Date.now();
    if (tier === 'trial') {
      s.license = {
        tier: 'trial',
        startedAt: now,
        trialExpiresAt: now + trialDays * 24 * 3600 * 1000,
        trialEmail: 'dev@local.test',
      };
    } else if (tier === 'monthly' || tier === 'lifetime') {
      s.license = {
        tier,
        startedAt: now,
        trialExpiresAt: null,
        // trialEmail은 보존(만약 이전에 trial 썼다면).
        trialEmail: s.license.trialEmail,
      };
    } else {
      s.license = {
        tier: 'free',
        startedAt: null,
        trialExpiresAt: null,
        trialEmail: s.license.trialEmail, // abuse 방지: free로 돌아가도 trialEmail 보존
      };
    }
  });
}
