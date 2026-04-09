#!/usr/bin/env bash
set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-git --redact
  exit 0
fi

echo "gitleaks not found; running fallback regex scan."
results="$(rg -n --hidden --glob '!.git' --glob '!**/node_modules/**' --glob '!**/venv/**' --glob '!scripts/security/scan-secrets.sh' \
  '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AWS_SECRET_ACCESS_KEY|aws_secret_access_key|BEGIN (RSA|OPENSSH|PRIVATE) KEY|ghp_[A-Za-z0-9]{36}|xox[baprs]-|AIza[0-9A-Za-z_-]{35})' \
  . || true)"

if [ -n "$results" ]; then
  echo "$results"
  exit 1
fi

echo "No key-like secret patterns found."
