import { updateState } from './storage';
import type { License } from './types';

/**
 * 라이선스 게이트.
 *
 * 현재(MVP): 완전한 ExtensionPay 연결은 계정 셋팅 후 주입.
 * 이 모듈은 깔끔한 인터페이스를 제공하여 나중에 실제 결제 SDK로 스왑한다.
 *
 * 교체 지점 (Week 2 Day 13~14):
 *   1) ExtensionPay 계정 생성 → extension ID 등록
 *   2) `src/shared/extpay.ts`에 실제 클라이언트 초기화
 *   3) `checkPaid()`를 extpay.getUser().paid로 교체
 *   4) `openCheckout()`에서 extpay.openPaymentPage() 호출
 */

export interface LicenseGateway {
  checkPaid(): Promise<boolean>;
  openCheckout(): Promise<void>;
}

/**
 * 스텁 구현: 개발 중에만 사용. 프로덕션 빌드 전 반드시 실제 게이트웨이로 교체.
 * 교체 방법: 이 파일 하단 `activeGateway`의 주석을 전환.
 */
class StubGateway implements LicenseGateway {
  async checkPaid(): Promise<boolean> {
    // 스토리지의 license.paid를 그대로 반환 — 개발자가 options 페이지의 "DEV: 유료 토글"로 on/off 가능.
    const { default: extpay } = { default: null } as { default: null };
    void extpay;
    const row = await chrome.storage.local.get('xrb.state');
    const state = row['xrb.state'] as { license?: License } | undefined;
    return Boolean(state?.license?.paid);
  }

  async openCheckout(): Promise<void> {
    // 스텁: 안내 페이지를 새 탭으로 연다. 실제 결제 URL은 ExtensionPay 제품 URL로 교체.
    const fallbackUrl = chrome.runtime.getURL('src/options/index.html#/upgrade');
    await chrome.tabs.create({ url: fallbackUrl });
  }
}

export const licenseGateway: LicenseGateway = new StubGateway();

/**
 * 개발 편의: 유료 상태를 수동으로 토글. Options 페이지 "DEV" 섹션에서만 노출.
 * 프로덕션 빌드에서는 이 함수의 호출 경로를 제거하거나 비활성화할 것.
 */
export async function devSetPaid(paid: boolean): Promise<void> {
  await updateState((s) => {
    s.license.paid = paid;
    s.license.purchasedAt = paid ? Date.now() : null;
  });
}
