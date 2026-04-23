# 03. 시장 조사 아카이브

> 2026-04-23 시점 조사. 출처 링크는 하단.
> 아이디어 선정의 근거이며, 의사결정 재검토 시 돌아와서 읽어야 함.

---

## 1. Chrome Web Store 거시 지표 (2026-04)

- 전체 확장 수: **111,933개** (품질 심사 후, 이전 137,000에서 감축)
- 평균 유저 수: ~12,304명
- **86.3%가 1,000 유저 미만** — 대부분 실패
- 100만+ 유저는 전체의 **0.24%** 뿐
- Chrome 유저 평균 설치: 8~12개, 활성 사용: 2~3개
- 생산성 카테고리: 전체의 **55.5%** (가장 크지만 레드오션)

## 2. AI 확장 성장세 (Incogni 2026-01 리포트)

- 1,000+ 유저 보유 AI 확장: **442개** (YoY +86%)
- 누적 다운로드: **115.5M회**
- AI 확장이 가장 빠른 성장 세그먼트 — "AI 미탑재 = 이미 뒤처짐"으로 여겨짐

## 3. 성공한 인디 케이스 (박리다매·일회성 참고)

| 제품 | 수익/월 | 포지션 | 교훈 |
|---|---|---|---|
| Gmass | $130k | Gmail 대량메일, 구독 | 구독이 더 크게 벌지만 차트 진입 어려움 |
| Closet Tools | $42k | Poshmark 리셀러 | 니치+워크플로 고정 유저 지불 |
| **Easy Folders** | **$3.7k** | ChatGPT 폴더 정리 | 1인 개발자 MVP가 월 $500+ 달성 증명 |
| Dark Reader | $10k (2021) | 다크 모드 | 무료 도네이션 모델도 가능 |
| NoteLinker | (비공개) | **$5.90 평생** | 박리다매 가격 전례 — 우리와 동일 전략 |

## 4. BYOK 모델 벤치마크

### 선행 제품
- **HARPA**: BYOK + 일회성 구매 옵션
- **SnapMind**: 스크린샷 + GPT, BYOK 기본
- **GPT Breeze**: 4.9★ 유튜브/웹 요약, BYOK
- **ClickRemix**: OpenRouter BYOK 오픈소스
- **dossi**: GitHub 이슈 + BYOK
- **OpenAI API Explorer**: 순수 BYOK 도구

### BYOK 장점 (우리가 활용)
1. 서버 0 = 운영비 0 (박리다매 가격 성립)
2. 사용자가 본인 제공자 프라이버시 정책 적용 — 프라이버시 의식 유저 공략
3. 토큰 비용 사용자 부담 — 우리는 순수 UI/UX/프롬프트 가치로 과금
4. OpenAI BYOK 정책상 합법 (OpenAI 공식 허용)

### BYOK 단점 (우리가 설계로 완화)
1. 키 입력 마찰 → Options 페이지에 "3분이면 끝" 안내 동영상
2. 키 유효성 실패 시 이탈 → 원문 에러 메시지 그대로 노출 (자체 해결 유도)
3. 기술 낮은 유저 제외 → 우리 타겟(빌더·인플루언서)과 일치하므로 문제 아님

## 5. X(Twitter) 글쓰기 보조 카테고리 경쟁 분석

| 제품 | 가격 | 모델 | 핵심 기능 | 약점 |
|---|---|---|---|---|
| **TweetHunter** | $49/월 | 웹앱+확장 | 스케줄+AI 리라이트+분석 | 고가 구독, 대규모 스위트 |
| **Hypefury** | $19/월 | 웹앱 | 스레드 자동화+반복 | 월구독, AI 결과 "티" 남 |
| **Typefully** | $15/월 | 웹앱 | 작성 UX+AI | 월구독 |
| **Tweet Hunter Chrome Ext** | 포함 | 확장 | TweetHunter의 브라우저 모듈 | 본제품 구독 강제 |
| **기타 무료 확장** | 무료 | 광고/페이월 | 기본 답변 생성 | AI 티 강함, 퍼소나 없음 |

### 기회 (차별화 근거)
1. **가격 격차**: 구독 $15~49/월 vs 우리 $3.99 평생 → 14배 이상 저렴
2. **톤 퍼소나**: 경쟁작 전원 이 기능 미제공 (프리셋 톤만 있음)
3. **스레드 힌트 (이어쓰기)**: 모든 경쟁작이 "완성된 트윗 리라이트"만 제공

## 6. Truth Social 크립토 시그널 아이디어 평가

### 배경 (2025~2026)
- Trump Media가 Cronos(CRO) 연동, ETF 승인 신청 (2026-02)
- $TRUMP 밈코인 활성화
- 기존 "Trump Truth Social Alert" 무료 확장 존재 (단순 알림)

### 왜 1차 프로젝트로 부적합
1. **MVP 2~4주 불가**: 크롤링+신호엔진+알림 = 최소 8주
2. **법적 리스크 중상**: 투자자문업 저촉 가능, Chrome AI 정책/SEC 해석 변동
3. **유지보수 고비용**: Truth Social/X ToS 변경, 안티봇 대응 지속
4. **박리다매와 불일치**: $3 받고 서버/크롤러 유지 = 적자

### 2차 프로젝트로 재검토할 때
- 1차로 스토어·결제·마케팅 파이프라인 구축 완료 후
- BYOK AI로 신호 *점수화*만 담당 (크롤링은 공식 API 우선)
- "투자 추천이 아닌 정보 정리" 포지션 강제
- 구조: 뉴스/포스트 입력 → AI 센티먼트 요약 → 사용자가 판단
- 가격: 구독 $9/월 or 평생 $29 (자원 요구 반영)

## 7. 의사결정 근거 요약

**선정 아이디어**: X Reply Booster

**근거 4줄 요약**:
1. AI 확장은 YoY +86% 성장 → 진입 타이밍 좋음
2. X 글쓰기 보조는 검증된 $15~49/월 카테고리 → 지불 의사 확실
3. 박리다매·BYOK로 가격 차별화 + 기술 차별화 3개(퍼소나·스레드힌트·평생가격) 확보
4. 바이브코딩 + 2~4주 MVP 제약에 기술 난이도가 가장 적합 (content script 단순)

---

## 출처 링크

- [Chrome extension statistics (chrome-stats.com)](https://chrome-stats.com/chrome/stats)
- [Counting Chrome Extensions — DebugBear](https://www.debugbear.com/blog/counting-chrome-extensions)
- [Google Chrome Extension Ecosystem 2026](https://www.aboutchromebooks.com/chrome-extension-ecosystem/)
- [Best AI Chrome Extensions 2026 (Unite.AI)](https://www.unite.ai/chrome-extensions/)
- [Pickaxe: Top 25 AI Browsers & Extensions 2026](https://pickaxe.co/post/top-ai-browsers-extensions)
- [Chrome Web Store AI-powered extensions](https://chromewebstore.google.com/collection/gen_ai_extensions)
- [8 Chrome Extensions with Impressive Revenue (ExtensionPay)](https://extensionpay.com/articles/browser-extensions-make-money)
- [How to Monetize Your Chrome Extension in 2025 (Extension Radar)](https://www.extensionradar.com/blog/how-to-monetize-chrome-extension)
- [How to Price Your Chrome Extension (ExtensionFast)](https://www.extensionfast.com/blog/how-to-price-your-chrome-extension-and-what-actually-sells)
- [ExtensionPay](https://extensionpay.com/)
- [Bring Your Own API Key guide (xiegerts.com)](https://www.xiegerts.com/post/browser-extension-genai-key-prompts/)
- [OpenAI Developer: BYOK policy](https://community.openai.com/t/bring-your-own-key-policy/446168)
- [SnapMind — BYOK extension](https://chromewebstore.google.com/detail/snapmind-capture-analyze/kjhpjjagphjnaobobionnaoklnafphop)
- [Trump Truth Social Alert — Chrome Web Store](https://chromewebstore.google.com/detail/trump-truth-social-alert/jejkgcbmeejmgldkpkdlmmpgkincppoe)
- [Trump-linked Truth Social seeks SEC approval for crypto ETFs — CoinDesk](https://www.coindesk.com/markets/2026/02/13/trump-linked-truth-social-seeks-sec-approval-for-two-crypto-etfs)
- [Top Chrome Extension Ideas 2026 (5ly.co)](https://5ly.co/blog/chrome-extension-ideas/)
