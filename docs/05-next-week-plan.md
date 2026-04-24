# 05. 다음 주 1차 프로젝트 작업 계획 (2026-04-24 ultrareview 인터뷰 반영)

> 이 문서는 사용자 인터뷰 결과를 확정 문서화한 것. 다음 세션에서 이 목록을 그대로 구현 → 빌드 → 실 브라우저 테스트.

## 인터뷰 결과 요약 (2026-04-24)

| 질문 | 답변 |
|---|---|
| 집중 영역 | **제품 완성도** (기능 추가 + 안정화 + UX 디테일) |
| 새 기능 우선순위 | **UX 번들** — Regenerate + 팝오버 내 퍼소나 전환 + 길이 토글 |
| 안정화 우선순위 | **SW 콜드스타트 재시도 + fetch 30s 타임아웃** |
| 수익화 (복수) | Popup 개인 stat · 3회 성공 후 리뷰 요청 · 가격 비교 앵커 |
| 실 테스트 | 다음 세션 작업 직후 함께 |

## 구현 체크리스트 (다음 세션에서 한 덩어리로)

### A. UX 번들 (최우선)
- [ ] 팝오버 footer에 **Regenerate 버튼** (↻) 추가 — 같은 프롬프트로 다른 3안. 무료 유저는 남은 횟수 차감.
- [ ] 팝오버 상단에 **퍼소나 드롭다운** — content script에서 Options 열지 않고 즉시 전환.
- [ ] 팝오버 하단에 **길이 토글** (Short / Medium / Long) — 프롬프트에 max_tokens + 지시 추가.
- [ ] 3안이 "짧은·중간·긴" 구성으로 자동 분배되도록 프롬프트 보강 (`src/shared/prompt.ts`).
- [ ] `ClientMsg.generate`에 `length?: 'short' | 'medium' | 'long'` 필드 추가.

### B. 안정화 (High)
- [ ] content의 `chrome.runtime.sendMessage`에 **1회 자동 재시도** (500ms 백오프) — SW 콜드스타트 대응 (`src/content/inject.ts`).
- [ ] `chrome.runtime.lastError` 명시적 처리.
- [ ] background `fetch`에 **30s 타임아웃** (AbortController + setTimeout) — 오프라인·5xx·DNS 실패 시 영구 hang 방지 (`src/background/ai.ts`).
- [ ] 5xx / 429 한정 **최대 2회 지수 백오프 재시도** (Retry-After 헤더 존중).
- [ ] UI는 10s 지점에 로딩 문구 변경 ("Still generating…").

### C. 수익화 (High)
- [ ] **가격 비교 앵커**: LicenseSection에 한 줄 "TweetHunter $49/mo = $588/yr vs this $3.99 once — 147× less" (`src/options/OptionsApp.tsx` + Popup).
- [ ] **리뷰 요청 넛지**: `storage.ts`에 `successCount`·`reviewAsked` 추가. content에서 삽입 성공 시 +1. 3회 되면 팝오버 하단에 1회성 "★ Rate on Web Store" 링크 (`inject.ts`).
- [ ] **Popup 개인 stat**: 주간 생성 수 + 절약 시간 추정 (count × 90s). `UsageDay`를 `weeklyHistory: {iso, count}[]`로 확장 (storage.ts). Popup 중단에 위젯 (`PopupApp.tsx`).

### D. 한국어 UI (주관식 답변 후 확정)
- [ ] `src/shared/locales/ko.ts` 신규 — 에러·팝오버·버튼 문자열 ~20개 번역.
- [ ] `i18n.ts`의 dict에 ko 등록.
- [ ] Options Preferences의 언어 선택이 실제 UI에 반영되도록 루트 레벨 state 연결.

### E. 마무리
- [ ] `pnpm build` 통과 확인.
- [ ] **실 브라우저 로드 테스트** — 사용자가 지정한 AI 제공자(기본 OpenAI)로:
  1. Options에서 키 2종 Verify
  2. 샘플 퍼소나 생성
  3. X.com에서 ✨ 클릭 → 3안 확인
  4. Regenerate 클릭 → 다른 3안
  5. 팝오버 퍼소나 전환 → 톤 변화 확인
  6. 길이 토글 전환 → 글자 수 변화 확인
  7. 무료 3회 도달 → 리뷰 요청 넛지 뜨는지
  8. 5회 도달 → 업그레이드 모달 + 가격 앵커 문구 확인
  9. Popup에서 주간 stat 확인
- [ ] 발견된 버그 즉시 수정 + 재빌드.
- [ ] 커밋 → 자동 push.

## 다음 주(그 이후) 미뤄진 것들

매출 $200 달성 후 또는 2주 내 반영 검토:
- 스레드 전체 컨텍스트 읽기 (답변 품질 근본)
- Rewrite 모드
- 번역 일회성 버튼
- Persona Import/Export + 미리보기
- 전역 Keyboard shortcut
- Privacy Trust bar 상단 배치
- 편집 중 자동 저장 + beforeunload
- IME 조합 중 auto-close 억제
- 아리아 라이브 + 다크 WCAG AA

MVP 이후 (2차 프로젝트와 병행):
- Reply Stack / Make-it-a-thread / Split-thread
- PPP 가격 조정
- Referral 링크 인프라
- Win-back 쿠폰 플로우
- 팀/에이전시 라이선스
- 스토어 자산 (아이콘 디자인, 스크린샷 5장, 프로모 이미지) + 제출

## 참고

인터뷰 원본 리뷰(4관점 에이전트)는 별도 보관 없이 이 작업이 실행되는 세션의 로그 안에만 존재. 추후 재검토 필요 시 새 ultrareview 실행이 나음. 본 문서의 결정은 **2026-04-24 시점 사용자 선호**이고 1주일 뒤 매출·평점·실 버그 데이터로 재조정 대상.
