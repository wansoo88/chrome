# Skill: Chrome Web Store 제출 체크리스트

> 신규 개발자 계정 기준 심사는 최대 **30일**까지 걸림. 1차 리젝 확률 약 30%.
> 아래 체크리스트를 제출 전 전원 통과하면 1차 통과율을 크게 높일 수 있다.

## 0. 개발자 계정 등록 (한 번만)

- [ ] [Chrome Web Store 개발자 등록](https://chrome.google.com/webstore/devconsole/register) — 일회성 **$5**
- [ ] 2단계 인증 필수
- [ ] 지급 계좌 정보 (결제는 ExtensionPay/LemonSqueezy가 담당하므로 스토어 인앱 결제는 안 씀)

## 1. 빌드 아티팩트 준비

```bash
pnpm build          # dist/ 생성
cd dist && zip -r ../extension.zip .    # 루트에 zip
```

- [ ] `dist/manifest.json`의 `version`을 올렸는가 (0.1.0 → 0.1.1 ...)
- [ ] `dist/` 안에 `.map` 파일이 없는가 (Vite config에서 `sourcemap: false` 또는 프로덕션 분기)
- [ ] zip 크기 20MB 이하 (대부분 1MB 미만일 것)

## 2. 스토어 리스팅 자산

### 2.1 아이콘
- [ ] **128×128** PNG 투명 배경 (스토어 표시용)
- [ ] **48×48** PNG (확장 관리 페이지용)
- [ ] **16×16** PNG (툴바 기본 크기)
- 디자인: Figma Community "Chrome Extension Icon" 템플릿 → 텍스트만 교체 → 3 사이즈 일괄 export

### 2.2 스크린샷 (필수 최소 1장, 권장 5장)
해상도: **1280×800** 또는 **640×400**. 권장 1280×800.

시나리오:
1. X 타임라인에서 ✨ 버튼이 보이는 장면 (어노테이션: "One click anywhere on X")
2. 팝오버에 3안이 뜬 장면 (어노테이션: "Your voice, 3 variants")
3. Persona 관리 화면 (어노테이션: "Teach it your style")
4. 무료 한도 초과 → 업그레이드 모달 (어노테이션: "$3.99 once. Forever.")
5. API 키 설정 화면 (어노테이션: "BYOK. Your key stays in your browser.")

### 2.3 프로모 이미지
- [ ] **440×280** (작은 타일, 필수)
- [ ] **920×680** (큰 타일, 선택이지만 권장)
- [ ] **1400×560** (마키, 피처링 시 사용)

## 3. 설명 페이지 (영어)

**Title** (45자 이내):
```
X Reply Booster — Your Voice, BYOK AI
```

**Short description** (132자 이내, 영어 표시 기준):
```
Generate 3 in-your-voice replies & thread hints on X. Bring your own OpenAI key. Pay once $3.99 — no subscription.
```

**Detailed description** (템플릿):
```
Tired of AI replies that sound like a robot? X Reply Booster learns YOUR voice from your past tweets and generates 3 reply variants that actually sound like you.

✨ WHAT IT DOES
• One-click 3 reply variants on any X (Twitter) compose field
• Thread Hint: suggests the next line while you're still typing
• Persona Memory: up to 10 personas, each trained on your example tweets

🔑 BRING YOUR OWN KEY
Your OpenAI, Anthropic, or OpenRouter key stays in your browser. We never see or store it.

💰 PAY ONCE
$3.99 lifetime. Unlimited generations. No subscription, ever.

🌍 WORKS IN ANY LANGUAGE
Auto-matches the language of the original tweet.

🛡️ PRIVACY BY DESIGN
• No tracking
• No remote servers
• No data leaves your browser except direct calls to your chosen AI provider

Note: This extension is not affiliated with X Corp. Works with X (formerly Twitter).
```

- [ ] "X" 상표를 **주 기능 설명**이 아닌 "Works with X"로만 사용
- [ ] 가격·환불 정책 1줄 이상 명시
- [ ] 개인정보 처리 요약 3줄

## 4. 개인정보 처리방침

- [ ] 공개 URL 준비 (Vercel/Cloudflare Pages로 정적 페이지)
- [ ] URL을 스토어 폼 "Privacy policy" 필드에 입력
- 내용:
  ```
  X Reply Booster does not collect, store, or transmit any user data to its developers.
  
  - API keys and settings are stored in chrome.storage.local on your device only.
  - Tweet text you select for AI generation is sent directly from your browser to the AI provider you configured (OpenAI/Anthropic/OpenRouter).
  - No analytics, no telemetry, no third-party trackers.
  
  Your interactions with AI providers are governed by their respective privacy policies.
  ```

## 5. 권한 정당화 (스토어 폼의 "Justification" 필드)

스토어 폼에서 각 권한마다 왜 필요한지 설명해야 한다.

- **`storage`**: "Stores your API keys, personas, and settings locally in your browser."
- **`activeTab`** (사용 시): "Accesses the current X tab when you click the ✨ button."
- **host `https://x.com/*`, `https://twitter.com/*`**: "Injects the reply generation button into X/Twitter compose fields."
- **Remote code**: **"No"** 체크. (React 등 모든 코드가 패키지 내부에 번들링)
- **Use of AI**: **"Yes"** 체크. 설명: "Uses user-provided keys to call OpenAI/Anthropic/OpenRouter APIs from the user's browser."

## 6. 카테고리 · 언어

- [ ] Primary category: **Productivity**
- [ ] Secondary (if allowed): Social & Communication
- [ ] Languages: 초기 English만. 이후 한국어 등 추가

## 7. 테스트 계정 안내

- BYOK이므로 별도 테스트 계정 불필요
- 심사관이 키를 직접 발급해서 테스트하거나, 스크린샷·데모 영상으로 심사할 가능성 → 설명 페이지에 **YouTube 데모 영상 링크** 포함 권장 (30초 언리스티드 영상)

## 8. 흔한 거절 사유 & 대응

| 사유 | 대응 |
|---|---|
| "Minimum functionality" | description에 "Generates 3 in-voice reply variants" 등 실행 흐름 명시 |
| Host permission broad | `<all_urls>` 제거, x.com/twitter.com만 |
| Privacy policy unclear | 위 템플릿 그대로 사용, "no collection" 명시 |
| Description mismatch | 기능을 과장하지 말고 실제 코드가 하는 것만 작성 |
| Single purpose | 여러 기능 나열하지 말고 "assist writing on X" 단일 목적으로 묶기 |

## 9. 제출 후

- [ ] 심사 상태는 Developer Dashboard에서 확인
- [ ] "Pending review" → "Published" 또는 "Rejected"
- [ ] 거절 시 이메일 발송. 사유 확인 후 당일 수정 → 재제출 (재심사 3~7일)
- [ ] 승인 시 공개 URL 발급 → 마케팅 시작
