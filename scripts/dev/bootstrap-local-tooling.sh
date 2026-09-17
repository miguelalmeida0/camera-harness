#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

EXCLUDE="$ROOT/.git/info/exclude"
mkdir -p "$(dirname "$EXCLUDE")"
touch "$EXCLUDE"

link_local() {
  canonical="$1"
  local_path="$2"

  if [ ! -e "$canonical" ]; then
    echo "SKIP: canonical path missing: $canonical"
    return 0
  fi

  if git ls-files --error-unmatch "$local_path" >/dev/null 2>&1; then
    echo "ERROR: $local_path is still tracked."
    exit 1
  fi

  rm -rf "$local_path"
  ln -s "$canonical" "$local_path"

  if ! grep -Fxq "/$local_path" "$EXCLUDE"; then
    printf '/%s\n' "$local_path" >> "$EXCLUDE"
  fi

  echo "LOCAL: $local_path -> $canonical"
}

link_local "docs/internal/automation/AGENTS.md" "AGENTS.md"

echo
echo "Local Claude/Codex compatibility paths are ready."
echo "They remain ignored and do not appear in the GitHub root."
