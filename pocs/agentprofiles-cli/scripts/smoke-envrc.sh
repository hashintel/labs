#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_CMD=${CLI_CMD:-"node ${ROOT_DIR}/dist/index.js"}

if [[ ! -f "${ROOT_DIR}/dist/index.js" ]]; then
  echo "dist/ not found; run 'npm run build' first." >&2
  exit 1
fi

tmp_dir="$(mktemp -d /tmp/agentprofiles-smoke.XXXXXX)"
trap 'rm -rf "${tmp_dir}"' EXIT

# Isolate config directory for testing (don't touch real user config)
export AGENTPROFILES_CONFIG_DIR="${tmp_dir}/config"

# Pre-initialize config (non-interactive)
mkdir -p "${tmp_dir}/config/claude" "${tmp_dir}/config/opencode"
echo '{"version":1}' > "${tmp_dir}/config/config.json"

run_cli() {
  (cd "${tmp_dir}" && ${CLI_CMD} "$@")
}

has_rg() {
  command -v rg >/dev/null 2>&1
}

debug_dump() {
  local file="$1"
  if [[ "${DEBUG:-}" == "1" && -f "${file}" ]]; then
    echo "--- ${file} ---" >&2
    cat "${file}" >&2
    echo "---" >&2
  fi
}

fail() {
  local file="$1"
  local message="$2"
  debug_dump "${file}"
  echo "${message}" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  if has_rg; then
    rg --quiet --fixed-strings "${pattern}" "${file}" || \
      fail "${file}" "Expected pattern not found in ${file}: ${pattern}"
    return
  fi
  grep -qF "${pattern}" "${file}" || \
    fail "${file}" "Expected pattern not found in ${file}: ${pattern}"
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  if has_rg; then
    if rg --quiet --fixed-strings "${pattern}" "${file}"; then
      fail "${file}" "Unexpected pattern found in ${file}: ${pattern}"
    fi
    return
  fi
  if grep -qF "${pattern}" "${file}"; then
    fail "${file}" "Unexpected pattern found in ${file}: ${pattern}"
  fi
}

# Create test profiles (using Docker-style names)
run_cli add claude eager-tesla
run_cli add opencode vibrant-curie

run_cli set claude eager-tesla

assert_contains "${tmp_dir}/.envrc" "agentprofiles:begin"
assert_contains "${tmp_dir}/.envrc" "watch_file .envrc.agentprofiles"
assert_contains "${tmp_dir}/.envrc.agentprofiles" "agentprofiles:begin claude"
# Note: Path uses tmp_dir since AGENTPROFILES_CONFIG_DIR is set to tmp_dir/config
assert_contains "${tmp_dir}/.envrc.agentprofiles" 'CLAUDE_CONFIG_DIR="'
assert_contains "${tmp_dir}/.envrc.agentprofiles" '/config/claude/eager-tesla"'

run_cli set opencode vibrant-curie

assert_contains "${tmp_dir}/.envrc.agentprofiles" "agentprofiles:begin claude"
assert_contains "${tmp_dir}/.envrc.agentprofiles" "agentprofiles:begin opencode"

run_cli unset claude

assert_not_contains "${tmp_dir}/.envrc.agentprofiles" "agentprofiles:begin claude"
assert_contains "${tmp_dir}/.envrc.agentprofiles" "agentprofiles:begin opencode"

echo "Smoke test passed: ${tmp_dir}"
