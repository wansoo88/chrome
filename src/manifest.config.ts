import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

/**
 * Manifest V3 정의 (CRXJS가 빌드 시 public/manifest.json으로 emit).
 *
 * 권한 선택 사유는 docs/04-compliance.md §1.2 참조.
 * host_permissions는 x.com / twitter.com만 — 스토어 심사 리젝션 방지.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'X Reply Booster',
  version: pkg.version,
  description:
    'Generate 3 in-your-voice replies on X. Free Forever 5/day, 7-day Pro Trial, $3.99/mo or $19.99 lifetime. BYOK.',
  default_locale: 'en',

  icons: {
    '16': 'icons/16.png',
    '48': 'icons/48.png',
    '128': 'icons/128.png',
  },

  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'X Reply Booster',
    default_icon: {
      '16': 'icons/16.png',
      '48': 'icons/48.png',
      '128': 'icons/128.png',
    },
  },

  options_page: 'src/options/index.html',

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['https://x.com/*', 'https://twitter.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  host_permissions: ['https://x.com/*', 'https://twitter.com/*'],

  // alarms: 매시간 trial 만료 검사 (license.ts checkAndDowngradeExpiredTrial)
  permissions: ['storage', 'alarms'],

  // chrome.runtime.sendMessage의 Promise 시그니처는 Chrome 99+부터 기본 지원.
  minimum_chrome_version: '99',
});
