#!/usr/bin/env bash
# Auto-push hook: git commit 성공 시 자동으로 git push origin HEAD 실행.
# Claude Code PostToolUse hook(matcher=Bash)에서 호출됨.
# stdin으로 tool use 컨텍스트 JSON을 받음 — tool_input.command와 tool_response.exit_code로 조건 검사.

set -u

payload="$(cat)"

# jq가 없으면 조용히 넘김 (Windows Git Bash 기본에는 jq가 없을 수 있음 → sed 폴백).
extract() {
  local path="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$path // empty" 2>/dev/null
  else
    # 매우 단순한 폴백: "command" 또는 "exit_code" 값 추출. 복잡한 JSON이면 미정확할 수 있으나
    # Claude Code 페이로드 구조는 고정이므로 실사용 범위에서 충분.
    case "$path" in
      ".tool_input.command")
        printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1
        ;;
      ".tool_response.exit_code")
        printf '%s' "$payload" | sed -n 's/.*"exit_code"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1
        ;;
    esac
  fi
}

command="$(extract '.tool_input.command')"
exit_code="$(extract '.tool_response.exit_code')"

# 조건: Bash 명령에 'git commit'이 포함되고, 해당 명령이 성공(exit 0)했을 때만 푸시.
case "$command" in
  *"git commit"*)
    if [ "${exit_code:-1}" = "0" ]; then
      project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
      cd "$project_dir" || exit 0
      # 원격 설정이 없으면 조용히 종료.
      if git remote get-url origin >/dev/null 2>&1; then
        # 현재 브랜치를 원격으로 푸시. --no-verify 등 안전장치는 유지.
        git push origin HEAD 2>&1 | sed 's/^/[auto-push] /'
      fi
    fi
    ;;
esac

exit 0
