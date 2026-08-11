#!/usr/bin/env bash
# House style gate.
#
# Enforces the four rules every factory site shares:
#   1. No dash punctuation. Periods and commas.
#   2. No curly quotes.
#   3. Capital C on Customer.
#   4. Tokens are law. No raw hex or rgba() outside tokens.css.
#
# HISTORY, read before "improving" this gate. It was written on the
# tools.nixfred.com run and produced three false positives against its
# own codebase on the first pass, then a fix made it silently stop
# catching real prose dashes (the // comment marker contains a slash,
# so every comment line looked like arithmetic). Both were caught by
# feeding the gate KNOWN BAD input. If you change a rule here, run a
# negative control before trusting a green result: create a file with a
# deliberate violation and confirm the gate fails on it.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

SRC_GLOBS=(--include='*.astro' --include='*.ts' --include='*.css' --include='*.md')

report() {
  local label="$1" hits="$2"
  if [ -n "$hits" ]; then
    echo "VIOLATION [$label]:"
    echo "$hits" | head -12
    echo
    fail=1
  fi
}

scanned=$(grep -rl '' src "${SRC_GLOBS[@]}" 2>/dev/null | wc -l | tr -d ' ')
echo "house style gate: scanning $scanned files under src/"

# 1a. Em dash and en dash. No legitimate use, no exclusions needed.
report "em dash or en dash" \
  "$(grep -rn $'—\|–' src "${SRC_GLOBS[@]}" 2>/dev/null || true)"

# 1b. Spaced hyphen used as punctuation. Only prose lines are scanned
# (comments, markdown, quoted strings); template interpolations are
# stripped first and arithmetic context is excluded. See HISTORY above.
spaced_hyphen=$(python3 - <<'PYEOF'
import os, re, sys

EXTS = ('.astro', '.ts', '.css', '.md')
PROSE = re.compile(r'^\s*(//|\*|<!--)')
QUOTED = re.compile(r'["\'`]')
INTERP = re.compile(r'\$\{[^}]*\}')
ARITH = re.compile(r'[\w)\].] - [\w(]')
OPS = re.compile(r'[*/+=<>]|Math\.')
SKIP_LINE = re.compile(r'calc\(|-->|^\s*---\s*$|^[-|:+ ]+$|^\s*[-*] |^\s*#')

hits = []
for base, dirs, files in os.walk('src'):
    for name in files:
        if not name.endswith(EXTS):
            continue
        path = os.path.join(base, name)
        try:
            lines = open(path, encoding='utf-8', errors='ignore').read().split('\n')
        except OSError:
            continue
        for i, raw in enumerate(lines, 1):
            if not (PROSE.search(raw) or QUOTED.search(raw)):
                continue
            if SKIP_LINE.search(raw.strip()):
                continue
            line = INTERP.sub('', raw)
            if ' - ' not in line:
                continue
            body = re.sub(r'^\s*(//+|/\*|\*/|\*|<!--)', '', line)
            if ARITH.search(body) and OPS.search(body):
                continue
            hits.append('%s:%d:%s' % (path, i, raw.strip()[:120]))

sys.stdout.write('\n'.join(hits))
PYEOF
)
report "spaced hyphen used as punctuation" "$spaced_hyphen"

# 2. Curly quotes. The escape marker exists for code that STRIPS curly
# quotes from user input and therefore must contain them.
report "curly quote" \
  "$(grep -rn $'‘\|’\|“\|”' src "${SRC_GLOBS[@]}" 2>/dev/null |
    grep -v 'check-copy:allow-curly' || true)"

# 3. Capital C on Customer, standalone word only.
report "lowercase customer" \
  "$(grep -rnw 'customer' src "${SRC_GLOBS[@]}" 2>/dev/null || true)"

# 4. Tokens are law. A real color is # plus 3, 4, 6, or 8 hex digits NOT
# followed by an identifier character (so #about-section never matches),
# or rgb()/rgba() with a numeric first argument (so prose about rgba()
# never matches). tokens.css is the one allowed home for color values;
# Base.astro is allowed exactly one documented theme-color meta.
color_scan=$(python3 - <<'PYEOF'
import os, re, sys

COLOR = re.compile(r'#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])|rgba?\(\s*[0-9]')
EXTS = ('.astro', '.ts', '.css')

hits = []
for base, _dirs, files in os.walk('src'):
    for name in files:
        if not name.endswith(EXTS):
            continue
        path = os.path.join(base, name)
        if path.replace(os.sep, '/').endswith('styles/tokens.css'):
            continue
        try:
            lines = open(path, encoding='utf-8', errors='ignore').read().split('\n')
        except OSError:
            continue
        for i, raw in enumerate(lines, 1):
            if not COLOR.search(raw):
                continue
            if path.endswith('Base.astro') and 'theme-color' in raw:
                continue
            hits.append('%s:%d:%s' % (path, i, raw.strip()[:120]))

sys.stdout.write('\n'.join(hits))
PYEOF
)
report "raw color literal outside tokens.css" "$color_scan"

if [ "$fail" -eq 1 ]; then
  echo "HOUSE STYLE: FAILED"
  exit 1
fi
echo "HOUSE STYLE: CLEAN"
