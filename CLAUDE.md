# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 프로젝트 정체성

**제품명(코드명)**: X Reply Booster (출시명은 마케팅 단계에서 확정, 후보: *ReplyForge*, *VoiceMatch*, *TwinReply*)

**한 줄 요약**: X(Twitter) 작성 창에 "내 말투"로 답변·이어쓰기 3안을 생성해주는 BYOK Chrome 확장. 평생 $3.99, 구독 없음.

**수익 모델**: 박리다매 일회성 결제. 월 $500 목표 = $3.99 × 약 125건/월 = 하루 4건.

**비전 한 문단**: TweetHunter($49/월)·Hypefury($19/월)는 월 구독으로 접근 장벽을 높이고, 생성 결과는 "AI 티"가 난다. 우리는 (1) 평생 $3.99 박리다매, (2) 사용자의 과거 트윗을 학습한 **톤 퍼소나**, (3) 이미 쓰기 시작한 문장의 *다음 줄*을 제안하는 "스레드 힌트"로 구매 허들을 지우고 차별화한다.

## 핵심 의사결정 (바뀌면 CLAUDE.md부터 업데이트)

| 항목 | 결정 | 이유 |
|---|---|---|
| 번들/빌드 | **Vite + @crxjs/vite-plugin** | MV3 + HMR 지원, 2026년 사실상 표준 |
| 언어 | **TypeScript (strict)** | 글로벌 규칙 + AI 바이브코딩 정확도 향상 |
| UI (popup/options) | **React + shadcn/ui** | AI에게 생성시키기 가장 쉬운 조합 |
| UI (content script) | **Vanilla TS + Shadow DOM** | X.com CSS 충돌 회피, 번들 최소화 |
| 상태/저장 | **chrome.storage.local** + zustand (popup) | 서버 없이 로컬 완결 |
| AI 호출 | **사용자 브라우저에서 직접 fetch** (OpenAI/Anthropic/OpenRouter) | BYOK, 서버 경유 금지 (키 노출 방지) |
| 기본 제공자 | **OpenAI** (기본) + **OpenRouter** (옵션) | 키 보유 유저 비율 최대 |
| 결제 | **ExtensionPay** (MVP) → 검증 후 LemonSqueezy 전환 검토 | 서버 없음, 5% 수수료, 24시간 안에 붙임 |
| i18n | Chrome `_locales` (en/ko/ja/zh/de/es/fr) | MVP는 en만, 출시 후 점진 추가 |
| 테스트 | **수동 E2E + Playwright 스모크 1개** | 바이브코딩 시간 예산 보호 |
| 플랫폼 | Chrome + Edge (Chromium 기반 공통 패키지) | 저비용 고수익. Firefox는 보류 |

## 아키텍처 (읽어두면 시간 절약)

```
extension/
├── src/
│   ├── background/       # Service Worker (MV3). 결제 게이트, 저장소 라우팅, 라이선스 검증
│   ├── content/          # x.com에 주입. DOM 감시 → ✨ 버튼 주입 → 선택 시 메시지로 백그라운드 호출
│   ├── popup/            # React. 퍼소나 전환, 남은 무료 사용량, 업그레이드 진입점
│   ├── options/          # React. API 키 입력/검증, 퍼소나 관리(CRUD), 사용량/언어 설정
│   ├── shared/           # 프롬프트 템플릿, 타입, storage 래퍼, 라이선스 훅
│   └── locales/          # _locales 복사 대상 (기본은 영어만, 후에 자동 복제 스크립트)
├── public/manifest.json  # MV3. host_permissions: ["https://x.com/*","https://twitter.com/*"]
└── dist/                 # 스토어 업로드용 zip 타겟
```

**메시지 흐름 (핵심 플로우)**:
1. content script가 X compose/reply textarea 근처에 ✨ 버튼 주입
2. 클릭 → background로 `{ kind: "generate", mode: "reply"|"threadHint", ctx, persona }`
3. background가 (a) 라이선스/한도 체크 (b) storage에서 API 키 읽기 (c) 제공자 API 직접 호출
4. 결과 3안 → content script 팝오버에 표시 → 유저가 클릭한 안만 textarea에 삽입
5. 유저가 수동 전송 (**자동 전송 금지** — 플랫폼 정책 + 스팸 리스크)

## 개발 워크플로우 (바이브코딩 전제)

**원칙**: 처음 크롬 확장 개발자 + AI 의존 → 큰 설계보다 "한 화면, 한 기능, 한 테스트"의 작은 루프 유지.

- 한 번에 하나의 파일/기능만 수정하고 수동으로 `chrome://extensions`에서 **재로드하여 눈으로 확인** 후 다음 변경
- 복잡한 기능은 먼저 Claude Code에게 계획을 세우게 한 뒤, 승인 후 구현
- TypeScript 에러 0을 항상 유지 (누적되면 AI가 헛손질함)
- 의존성 추가는 주 1회 이하로 제한. 번들 크기는 gzipped 300KB 이하 목표

## Commands (초기 스캐폴드 후 채움)

> ⚠️ 아직 `package.json` 없음. 첫 세션 최우선 과제.

```bash
# 최초 스캐폴드 (계획 중)
pnpm create vite@latest . -- --template react-ts
pnpm add -D @crxjs/vite-plugin @types/chrome
pnpm add zustand

# 개발 (예정)
pnpm dev              # Vite dev 서버 + HMR
pnpm build            # dist/ 생성, 스토어 업로드용
pnpm zip              # dist를 zip으로 묶음 (배포용)

# 테스트 (예정)
pnpm test:smoke       # Playwright 기본 플로우 1개

# 로컬 설치 (개발 확인)
# chrome://extensions → 개발자 모드 → "압축해제된 확장 프로그램 로드" → dist/ 선택
```

## 절대 금지 사항 (프로젝트 고유)

- ❌ 우리 서버 경유해서 사용자 API 키 전송 — BYOK의 생명이 프라이버시
- ❌ X에서 자동 게시/자동 좋아요/자동 팔로우 — 정책 위반, 계정/확장 BAN 리스크
- ❌ 무료 기능을 설치 직후 잠그는 하드 페이월 — 평점·리뷰 폭락의 주 원인
- ❌ manifest에 `<all_urls>` 권한 — 스토어 심사 지연 + 유저 불신. `https://x.com/*`만 사용
- ❌ 내부 분석 외 제3자 트래커 (Mixpanel/GA 등) — BYOK 프라이버시 포지셔닝과 모순

## 문서 인덱스 (이 순서로 읽으면 빠름)

1. `docs/01-product-spec.md` — 제품 스펙(기능·화면·프롬프트·에러 UX)
2. `docs/02-roadmap-4-weeks.md` — 4주 주간 로드맵 + 스토어 심사 타임라인
3. `docs/03-market-research.md` — 시장 조사 아카이브 (근거 · 출처 링크)
4. `docs/04-compliance.md` — X 플랫폼/Chrome Web Store 정책/BYOK 법적 고려

## 세션 시작 루틴 (Claude Code용)

새 세션 시작 시 Claude는 다음을 순서대로 수행:
1. `CLAUDE.md`(이 파일) 읽기 — 전체 맥락 파악
2. `.claude/skills/*.md` 훑기 — 필요한 레시피 확인
3. `docs/02-roadmap-4-weeks.md`의 현재 주차 확인
4. 사용자에게 "현재 X주차, [항목] 작업 예정. 시작할까요?"로 짧게 확인 후 진행
