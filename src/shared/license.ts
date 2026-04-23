import { CONSTANTS, updateState } from './storage';
import type { StorageSchema } from './types';

/**
 * 라이선스 게이트.
 *
 * 현재(MVP): ExtensionPay 연결은 계정 셋팅 이후 주입. 이 모듈은 stable interface를 제공하며
 * `src/shared/extpay.ts`를 추가해 `licenseGateway`만 교체하면 된다.
 *
 * 교체 절차 (Week 2 Day 13~14):
 *   1) ExtensionPay 계정 생성 → extension ID 등록.
 *   2) `pnpm add extensionpay` (또는 CDN 번들).
 *   3) 이 파일의 `licenseGateway`를 ExtPayGateway로 교체.
 *   4) 외부 결제 페이지 URL 반영.
 *
 * 주의: 실제 결제 페이지로 전환할 때 `chrome.tabs.create`가 extension 외부 URL을
 * 열기 위해 manifest `permissions`에 `"tabs"` 추가가 필요할 수 있음. 단, Chromium은
 * `chrome.tabs.create({ url })`에 대해 "tabs 권한 없이도 자체 페이지/외부 URL 오픈 허용"
 * 하므로 먼저 권한 없이 시도 후 필요시 추가. CWS 심사에는 permission 정당화 필요.
 */

export interface LicenseGateway {
  checkPaid(): Promise<boolean>;
  openCheckout(): Promise<void>;
}

class StubGateway implements LicenseGateway {
  async checkPaid(): Promise<boolean> {
    const row = await chrome.storage.local.get(CONSTANTS.ROOT_KEY);
    const state = row[CONSTANTS.ROOT_KEY] as Partial<StorageSchema> | undefined;
    return Boolean(state?.license?.paid);
  }

  async openCheckout(): Promise<void> {
    // 스텁: 내부 Options 페이지로 이동. 실제 결제 URL은 ExtensionPay product URL로 교체.
    const fallbackUrl = chrome.runtime.getURL('src/options/index.html');
    await chrome.tabs.create({ url: fallbackUrl });
  }
}

export const licenseGateway: LicenseGateway = new StubGateway();

/**
 * 개발 편의: 유료 상태 수동 토글. Options 페이지의 "DEV" 섹션에서만 노출.
 * 프로덕션 릴리스 직전 UI에서 이 버튼의 렌더 경로를 제거할 것.
 */
export async function devSetPaid(paid: boolean): Promise<void> {
  await updateState((s) => {
    s.license.paid = paid;
    s.license.purchasedAt = paid ? Date.now() : null;
  });
}
