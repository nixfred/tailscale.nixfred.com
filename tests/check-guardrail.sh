#!/usr/bin/env bash
# Guardrail gate, specific to this site (docs/PRD.md site rules).
#
# Two protections, both scanned across src/, docs/, public/, README.md,
# and CLAUDE.md (this repo is PUBLIC; everything tracked is published):
#
#   1. Positioning: this is a product field guide. Career, recruiting,
#      and hiring vocabulary must never appear.
#   2. Tailnet privacy: no private machine names, no local user paths.
#
# Lines that must legitimately contain a banned term (for example the
# rule that BANS the term) carry the marker: guardrail:allow
#
# NEGATIVE CONTROL: this gate was proven against known bad input on
# 2026-08-10 (a temp file containing a banned word made it exit 1)
# before its first green result was trusted. If you change the pattern,
# prove it again.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

scan() {
  local label="$1" pattern="$2"
  local hits
  hits=$(grep -rniE "$pattern" src docs public README.md CLAUDE.md 2>/dev/null |
    grep -v 'guardrail:allow' |
    grep -v '^tests/' || true)
  if [ -n "$hits" ]; then
    echo "VIOLATION [$label]:"
    echo "$hits" | head -12
    echo
    fail=1
  fi
}

# Positioning vocabulary. Word boundaries so ordinary prose does not
# false positive. "resume" is deliberately absent: it is a common verb
# in networking prose (transfers resume, sessions resume).
scan "career framing" '\b(interview|interviews|interviewing|recruit|recruiter|recruiting|hiring|job posting|cover letter|career|careers)\b'

# Tailnet and machine privacy.
scan "private machine or path" '/Users/|\bfnix\b|\bnixf\b|\bnixnet\b'

if [ "$fail" -eq 1 ]; then
  echo "GUARDRAIL: FAILED"
  exit 1
fi
echo "GUARDRAIL: CLEAN"
