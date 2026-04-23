# 01. 제품 스펙 (X Reply Booster)

## 1. 타겟 유저 페르소나

| 페르소나 | 설명 | 왜 산다 |
|---|---|---|
| **인디 빌더** | X에서 제품을 홍보하는 1인 개발자/창업자 | 답변 속도 ↑ = 팔로워 증가 속도 ↑ |
| **기술 인플루언서** | 팔로워 5k~50k, 일 50+ 답변 해야 함 | AI 티 안 나는 일관된 톤이 핵심 |
| **해외 공략 한국인** | 한국어 생각 → 영어 트윗이 어색함 | "내 스타일 영어"로 생성 |
| **크리에이터 에이전시 주니어** | 클라이언트 계정 3~10개 관리 | 퍼소나 전환이 생명 |

모두 OpenAI/Claude/OpenRouter 키를 이미 가지고 있거나 30분 안에 발급 가능.

## 2. 기능 범위 (MVP = 4주 안에 릴리스)

### 2.1 MVP 필수 (F)
- **F1. ✨ 버튼 주입**: X의 답변/새 트윗 작성창 옆에 버튼
- **F2. 답변 3안 생성**: 원 트윗 + 선택 퍼소나 → 3개 답변안을 팝오버에 표시
- **F3. 스레드 힌트**: 사용자가 이미 작성 중인 경우 "다음 줄 제안 3개"
- **F4. 퍼소나 1개 기본 + 신규 1개 등록**: 무료 1개, 유료 최대 10개
- **F5. API 키 관리**: OpenAI 키 입력 + 검증 + 저장
- **F6. 무료 한도**: 일 5회 생성, 초과 시 업그레이드 모달
- **F7. 결제**: ExtensionPay로 평생 $3.99

### 2.2 출시 후 2주 내 (S)
- S1. OpenRouter 지원 (모델 선택 드롭다운)
- S2. Anthropic Claude 지원
- S3. 언어 자동 감지 → 같은 언어로 답변
- S4. "다시 생성" 버튼 (같은 입력으로 새 3안)

### 2.3 차기 버전 (L = Later)
- L1. 퍼소나 자동 학습 (사용자의 과거 트윗 30개 붙여넣기 → 자동 스타일 분석)
- L2. 스레드 전체 다중 트윗 생성
- L3. Edge/Brave/Opera 인증 스토어 제출
- L4. 다국어 UI (ko/ja/zh/de/es)

## 3. 화면별 스펙

### 3.1 Content Script 팝오버 (X.com 내부)
- **트리거**: compose/reply textarea 포커스 → ✨ 버튼 나타남
- **열림**: 버튼 클릭 → 팝오버 열림 (Shadow DOM, 다크/라이트 테마 자동 매칭)
- **구성**:
  - 상단: 퍼소나 드롭다운 (최근 선택 기억)
  - 중단: 3안 카드 (각각 "복사" · "삽입" 버튼)
  - 하단: "다시 생성" + "무료 사용량 X/5" 표시
- **에러 UX**:
  - API 키 미설정 → "키를 먼저 설정하세요" + options 페이지 링크
  - 키 유효성 실패 → 원문 에러 메시지 그대로 표시 (사용자가 디버깅 가능)
  - 한도 초과 → 업그레이드 모달 (결제 버튼 + 무료 계속 안내)

### 3.2 Popup (툴바 아이콘 클릭)
- 현재 퍼소나 + 빠른 전환 드롭다운
- 오늘 사용량 (무료 x/5, 유료면 숨김)
- "설정 열기" 버튼
- 업그레이드 상태 배지

### 3.3 Options 페이지
- API 키 입력 (OpenAI / OpenRouter / Anthropic 라디오)
- "키 검증" 버튼 → 작은 테스트 호출 성공/실패 표시
- 퍼소나 CRUD:
  - 이름
  - 톤 설명 (5줄 제한)
  - 예시 트윗 (최대 10개, 각 280자)
  - "이 퍼소나로 미리보기" 버튼
- 언어 기본 설정 (자동/한국어/영어/...)
- 라이선스 상태 (구매 전: 업그레이드 버튼 / 구매 후: 감사 메시지)

## 4. 프롬프트 아키텍처 (핵심 지적 자산)

```
SYSTEM:
You are rewriting as {persona.name}.
Voice and style: {persona.tone_description}
Examples of how {persona.name} writes:
{persona.examples.join("\n---\n")}

Rules:
- Match the language of the ORIGINAL_TWEET unless USER_LANGUAGE_PREF is set.
- Under 280 characters.
- No hashtags unless they appear in the examples.
- Never use em-dashes or bullet points; mimic the persona.
- Return exactly 3 replies separated by "###" only.

USER:
MODE: {"reply" | "threadHint"}
ORIGINAL_TWEET: {tweet}
DRAFT_SO_FAR: {optional, only for threadHint}
```

**왜 이 구조인가**:
- 예시 트윗(few-shot)이 톤 매칭의 핵심 → 퍼소나 품질이 곧 제품 품질
- "###" 구분자는 스트리밍 파싱 안정성
- "no em-dash / no bullet" 제약이 "AI 티" 억제의 1차 방어선

## 5. 성공 지표 (출시 후 30일)

| 지표 | 목표 |
|---|---|
| 설치 → 생성 1회 전환 | 60%+ |
| 생성 1회 → 유료 전환 | 3%+ |
| 평점 (20개 이상 리뷰 후) | 4.5+ |
| 월 매출 | $500+ (= 하루 4건 이상 판매) |
| 환불율 | 5% 이하 |

## 6. 차별화 3가지 (마케팅 카피의 축)

1. **"Pay once. Reply forever. Bring your own key."** — 구독 피로 공략
2. **Persona Memory** — 과거 트윗 학습으로 "내 말투" 유지
3. **Thread Hint** — 리라이트가 아닌 *작성 흐름*에 붙는 AI (경쟁작 미탑재)
