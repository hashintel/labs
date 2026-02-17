#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_CMD=${CLI_CMD:-"node ${ROOT_DIR}/dist/index.js"}

if [[ ! -f "${ROOT_DIR}/dist/index.js" ]]; then
  echo "dist/ not found; run 'npm run build' first." >&2
  exit 1
fi

tmp_dir="$(mktemp -d /tmp/agentprofiles-smoke.XXXXXX)"
tmp_home="${tmp_dir}/home"
mkdir -p "${tmp_home}"
trap 'rm -rf "${tmp_dir}"' EXIT

# Isolate config and home directories for testing
export AGENTPROFILES_CONFIG_DIR="${tmp_dir}/config"
export AGENTPROFILES_CONTENT_DIR="${tmp_dir}/content"
export HOME="${tmp_home}"

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
  local message="$1"
  echo "${message}" >&2
  exit 1
}

assert_symlink() {
  local path="$1"
  local expected_target="$2"
  if [[ ! -L "${path}" ]]; then
    fail "Expected ${path} to be a symlink"
  fi
  local actual_target
  actual_target=$(readlink "${path}")
  if [[ "${actual_target}" != "${expected_target}" ]]; then
    fail "Expected ${path} to point to ${expected_target}, but points to ${actual_target}"
  fi
}

assert_is_dir() {
  local path="$1"
  if [[ ! -d "${path}" ]] || [[ -L "${path}" ]]; then
    fail "Expected ${path} to be a real directory (not a symlink)"
  fi
}

# Test 1: Initialize config manually (setup is interactive, so we skip it)
echo "Test 1: Initialize config..."
mkdir -p "${AGENTPROFILES_CONFIG_DIR}"
mkdir -p "${AGENTPROFILES_CONTENT_DIR}"
for agent in claude opencode codex gemini amp augment; do
  mkdir -p "${AGENTPROFILES_CONTENT_DIR}/${agent}"
done
echo '{}' > "${AGENTPROFILES_CONFIG_DIR}/config.json"

# Verify config dir was created
if [[ ! -d "${AGENTPROFILES_CONFIG_DIR}" ]]; then
  fail "Config directory not created"
fi

# Test 2: Create profiles manually (add command is interactive)
echo "Test 2: Create profiles..."
mkdir -p "${AGENTPROFILES_CONTENT_DIR}/claude/work"
mkdir -p "${AGENTPROFILES_CONTENT_DIR}/opencode/personal"
echo '{"name":"work","slug":"work","agent":"claude"}' > "${AGENTPROFILES_CONTENT_DIR}/claude/work/meta.json"
echo '{"name":"personal","slug":"personal","agent":"opencode"}' > "${AGENTPROFILES_CONTENT_DIR}/opencode/personal/meta.json"

# Verify profiles exist
if [[ ! -d "${AGENTPROFILES_CONTENT_DIR}/claude/work" ]]; then
  fail "Claude work profile not created"
fi
if [[ ! -d "${AGENTPROFILES_CONTENT_DIR}/opencode/personal" ]]; then
  fail "OpenCode personal profile not created"
fi

# Test 3: List profiles
echo "Test 3: List profiles..."
list_output=$(run_cli list claude)
if ! echo "${list_output}" | grep -q "work"; then
  fail "List output does not contain 'work' profile"
fi

# Test 4: Adopt existing directory and switch
echo "Test 4: Adopt and switch..."
# Create a real directory at global path
mkdir -p "${tmp_home}/.claude"
echo '{"existing":"config"}' > "${tmp_home}/.claude/settings.json"

# Manually adopt it (simulate what setup would do)
mkdir -p "${AGENTPROFILES_CONTENT_DIR}/claude/_base"
mv "${tmp_home}/.claude"/* "${AGENTPROFILES_CONTENT_DIR}/claude/_base/" 2>/dev/null || true
rmdir "${tmp_home}/.claude"
ln -s "${AGENTPROFILES_CONTENT_DIR}/claude/_base" "${tmp_home}/.claude"

# Verify it was adopted as _base
if [[ ! -f "${AGENTPROFILES_CONTENT_DIR}/claude/_base/settings.json" ]]; then
  fail "Existing directory not adopted as _base"
fi

# Verify global path is now a symlink
assert_symlink "${tmp_home}/.claude" "${AGENTPROFILES_CONTENT_DIR}/claude/_base"

# Switch to work profile
run_cli set claude work

# Verify symlink now points to work
assert_symlink "${tmp_home}/.claude" "${AGENTPROFILES_CONTENT_DIR}/claude/work"

# Test 5: Status command
echo "Test 5: Status..."
status_output=$(run_cli status)
if ! echo "${status_output}" | grep -q "claude"; then
  fail "Status output does not contain 'claude'"
fi
if ! echo "${status_output}" | grep -q "work"; then
  fail "Status output does not contain active profile 'work'"
fi

# Test 6: Unset (switch back to _base)
echo "Test 6: Unset..."
run_cli unset claude

# Verify symlink now points to _base
assert_symlink "${tmp_home}/.claude" "${AGENTPROFILES_CONTENT_DIR}/claude/_base"

# Test 7: Verify symlink structure
echo "Test 7: Verify symlink structure..."
# Verify that the symlink is correctly set up
if [[ ! -L "${tmp_home}/.claude" ]]; then
  fail "Global path should be a symlink"
fi

# Verify symlink target
target=$(readlink "${tmp_home}/.claude")
if [[ "${target}" != "${AGENTPROFILES_CONTENT_DIR}/claude/_base" ]]; then
  fail "Symlink should point to _base profile, but points to ${target}"
fi

echo "✓ Symlink structure verified"

echo "✅ Smoke test passed: ${tmp_dir}"

