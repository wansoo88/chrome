# Skill: MVP 초기 스캐폴드 (Vite + React + CRXJS)

> Week 1 Day 1~2에 한 번만 사용. 프로젝트 0 → "hello popup"까지.

## 0. 사전

- Node 20 LTS, pnpm 9+ 설치
- `D:/cashflow/chrome` 빈 디렉터리 + 기존 docs/.claude만 존재하는 상태 가정

## 1. Vite 스캐폴드

```bash
# 현재 디렉터리에 react-ts 템플릿 생성 (이미 파일이 있어도 비충돌 파일은 유지)
pnpm create vite@latest temp -- --template react-ts
# temp 디렉터리의 내용을 루트로 이동 후 temp 제거
# (docs/, .claude/, CLAUDE.md는 그대로 유지)
```

또는 수동으로:
```bash
pnpm init
pnpm add react react-dom zustand
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/chrome @crxjs/vite-plugin
```

## 2. 필수 파일

### 2.1 `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["chrome", "vite/client"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

### 2.2 `vite.config.ts`
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: { alias: { '@': '/src' } },
  build: { sourcemap: false },
});
```

### 2.3 `src/manifest.config.ts`
```ts
import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'X Reply Booster',
  version: pkg.version,
  description: 'Generate 3 in-your-voice replies & thread hints on X. BYOK. Pay once.',
  icons: {
    '16': 'icons/16.png',
    '48': 'icons/48.png',
    '128': 'icons/128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: 'icons/48.png',
  },
  options_page: 'src/options/index.html',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['https://x.com/*', 'https://twitter.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  host_permissions: ['https://x.com/*', 'https://twitter.com/*'],
  permissions: ['storage'],
});
```

### 2.4 `package.json` 스크립트
```json
{
  "name": "x-reply-booster",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "zip": "cd dist && zip -r ../extension.zip ."
  }
}
```

## 3. 최소 동작 파일 (스텁)

### 3.1 `src/background/index.ts`
```ts
console.log('[xrb] background started');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[xrb] installed');
});
```

### 3.2 `src/content/index.ts`
```ts
console.log('[xrb] content on', location.hostname);
```

### 3.3 `src/popup/index.html` + `src/popup/main.tsx`
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>X Reply Booster</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```
```tsx
import { createRoot } from 'react-dom/client';
function App() { return <div style={{ padding: 16, width: 320 }}>Hello, ready to boost.</div>; }
createRoot(document.getElementById('root')!).render(<App />);
```

### 3.4 `src/options/index.html` + `src/options/main.tsx`
(popup과 동일 패턴)

## 4. 아이콘 자리 차지하기

실제 디자인 전까지 단색 placeholder:
```bash
mkdir -p public/icons
# 16/48/128 크기의 단색 PNG. ImageMagick이 있으면:
#   magick -size 128x128 xc:'#1DA1F2' public/icons/128.png
# 없으면 Figma에서 1분에 만들 것
```

## 5. 첫 로드 확인

```bash
pnpm dev
```

1. `chrome://extensions` 열기
2. 우측 상단 "개발자 모드" ON
3. "압축해제된 확장 프로그램 로드" → `dist/` 선택 (`pnpm build` 후) 또는 `.vite/dev-build` (CRXJS dev)
4. 툴바에 아이콘 → 클릭 → "Hello, ready to boost." 확인
5. x.com 방문 → DevTools Console에 `[xrb] content on x.com` 로그 확인

**여기까지 나오면 Week 1 Day 2 종료.** 다음은 `x-dom-injection.md` 레시피로 이동.

## 6. 트러블슈팅

- **`chrome` 타입 미인식**: `tsconfig.json`의 `types: ["chrome"]` 누락 + `@types/chrome` 미설치
- **Popup 클릭 시 흰 화면**: Vite manifest_version 또는 HTML entry 경로 오타 — `pnpm build`로 `dist/` 확인
- **HMR이 CRXJS에서 안 먹음**: content script는 기본적으로 HMR 제한. background/popup은 자동 리로드, content는 `chrome://extensions`에서 수동 리로드 필요
