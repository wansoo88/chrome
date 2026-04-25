import type { GenerateMode, Persona } from './types';
import type { ReplyLength } from './messages';

/**
 * 프롬프트 조립 — 핵심 지적 자산.
 *
 * 원칙:
 * - 예시(few-shot)가 톤 매칭의 생명. 사용자가 퍼소나에 붙인 예시 트윗이 곧 품질.
 * - "###" 구분자는 결과 파싱의 안정성 (숫자/불릿은 모델이 무시할 때가 있음).
 * - em-dash / bullet / hashtag 금지로 "AI 티" 1차 억제.
 */

export interface BuildPromptInput {
  mode: GenerateMode;
  persona: Persona;
  originalTweet?: string | null;
  draft?: string | null;
  languagePref: 'auto' | string;
  /** 답변 길이. 미지정 시 'medium'. */
  length?: ReplyLength;
}

const LENGTH_RULES: Record<ReplyLength, string> = {
  short: 'Each reply must be SHORT — 1 to 8 words, sentence fragment OK. Punchy. No filler.',
  medium: 'Each reply must be MEDIUM length — one complete sentence, ~80-180 characters.',
  long: 'Each reply must be LONG — 2 to 3 sentences, up to 280 characters total. Add nuance or context.',
};

export interface PromptPair {
  system: string;
  user: string;
}

function joinExamples(examples: string[]): string {
  if (!examples.length) return '(no examples provided)';
  return examples
    .slice(0, 10)
    .map((e, i) => `Example ${i + 1}: ${e.trim()}`)
    .join('\n---\n');
}

export function buildPrompt(input: BuildPromptInput): PromptPair {
  const { mode, persona, originalTweet, draft, languagePref, length = 'medium' } = input;
  const lengthRule = LENGTH_RULES[length];

  // system 블록이지만 mode에 따라 기본 언어 폴백이 다름 — reply는 원문 언어에 맞추고,
  // threadHint는 사용자가 이미 쓰기 시작한 언어(draft) 우선. 명시적 languagePref가 있으면 그 값 고정.
  const languageDirective =
    languagePref === 'auto'
      ? mode === 'reply'
        ? 'Match the language of ORIGINAL_TWEET.'
        : 'Match the language of DRAFT_SO_FAR if non-empty; otherwise English.'
      : `Write in language code: ${languagePref}.`;

  const system = [
    `You are rewriting as "${persona.name}".`,
    `Voice and style: ${persona.toneDescription || '(not specified — infer from examples)'}`,
    `Here are real examples of how ${persona.name} writes:`,
    joinExamples(persona.examples),
    '',
    'Rules:',
    `- ${languageDirective}`,
    `- ${lengthRule}`,
    '- Always under 280 characters total.',
    '- No em-dashes. No bullet points. No hashtags unless they appear in the examples.',
    '- Do not prepend greetings ("Hey", "Hi") unless the examples do.',
    '- Sound like the examples — if they are terse, be terse; if they joke, joke.',
    '- Return exactly 3 outputs separated by a line containing only "###".',
    '- Output only the 3 texts and separators. No numbering, no preface, no explanation.',
  ].join('\n');

  const user =
    mode === 'reply'
      ? [
          'MODE: reply',
          'ORIGINAL_TWEET:',
          (originalTweet || '').trim() || '(unknown — generate 3 standalone engaging replies)',
        ].join('\n')
      : [
          'MODE: threadHint',
          'ORIGINAL_TWEET (the tweet the user is responding to; may be empty):',
          (originalTweet || '').trim() || '(none — this is a fresh compose)',
          '',
          'DRAFT_SO_FAR (what the user has started typing):',
          (draft || '').trim() || '(empty)',
          '',
          'TASK: Suggest 3 short continuations (2-3 sentences max) that a reader with the voice above would naturally type NEXT. Each suggestion replaces DRAFT_SO_FAR entirely if chosen — include the full rewritten message, not just the tail.',
        ].join('\n');

  return { system, user };
}

/**
 * 모델 응답에서 3안을 뽑음. "###" 분리자 우선, 폴백으로 연속 줄바꿈.
 */
export function parseSuggestions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const bySep = trimmed
    .split(/\n\s*#{3,}\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySep.length >= 2) return bySep.slice(0, 3);
  // 폴백: 모델이 "###"을 무시하고 1., 2., 3. 또는 빈 줄로 분리한 경우.
  const byNumber = trimmed.split(/\n\s*(?:\d+[\.\)]|-)\s+/).map((s) => s.trim()).filter(Boolean);
  if (byNumber.length >= 2) return byNumber.slice(0, 3);
  const byBlank = trimmed.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (byBlank.length >= 2) return byBlank.slice(0, 3);
  return [trimmed];
}
