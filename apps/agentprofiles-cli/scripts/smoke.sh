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
  local actual_target abs_actual_target
  actual_target=$(readlink "${path}")
  abs_actual_target=$(
    cd "$(dirname "${path}")" &&
      cd "$(dirname "${actual_target}")" &&
      printf '%s/%s' "$(pwd)" "$(basename "${actual_target}")"
  )
  if [[ "${abs_actual_target}" != "${expected_target}" ]]; then
    fail "Expected ${path} to point to ${expected_target}, but points to ${actual_target}"
  fi
}

assert_is_real_dir() {
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
mkdir -p "${tmp_home}/.claude/agents"
echo "# test agent" > "${tmp_home}/.claude/agents/TEST.md"

# Manually adopt include-strategy entries to _base (simulate setup behavior)
mkdir -p "${AGENTPROFILES_CONTENT_DIR}/claude/_base"
mv "${tmp_home}/.claude/settings.json" "${AGENTPROFILES_CONTENT_DIR}/claude/_base/settings.json"
mv "${tmp_home}/.claude/agents" "${AGENTPROFILES_CONTENT_DIR}/claude/_base/agents"
ln -s "${AGENTPROFILES_CONTENT_DIR}/claude/_base/settings.json" "${tmp_home}/.claude/settings.json"
ln -s "${AGENTPROFILES_CONTENT_DIR}/claude/_base/agents" "${tmp_home}/.claude/agents"

# Verify it was adopted as _base
if [[ ! -f "${AGENTPROFILES_CONTENT_DIR}/claude/_base/settings.json" ]]; then
  fail "Existing directory not adopted as _base"
fi
if [[ ! -f "${AGENTPROFILES_CONTENT_DIR}/claude/_base/agents/TEST.md" ]]; then
  fail "Existing claude agents directory not adopted as _base"
fi

# Include-strategy invariant: global path remains a real directory
assert_is_real_dir "${tmp_home}/.claude"
assert_symlink "${tmp_home}/.claude/settings.json" "${AGENTPROFILES_CONTENT_DIR}/claude/_base/settings.json"
assert_symlink "${tmp_home}/.claude/agents" "${AGENTPROFILES_CONTENT_DIR}/claude/_base/agents"

# Ensure target entries exist in work profile so switch can repoint managed symlinks
mkdir -p "${AGENTPROFILES_CONTENT_DIR}/claude/work/agents"
echo '{"profile":"work"}' > "${AGENTPROFILES_CONTENT_DIR}/claude/work/settings.json"
echo "# work agent" > "${AGENTPROFILES_CONTENT_DIR}/claude/work/agents/WORK.md"

# Switch to work profile
run_cli set claude work

# Verify managed entries now point to work profile while global dir stays real
assert_is_real_dir "${tmp_home}/.claude"
assert_symlink "${tmp_home}/.claude/settings.json" "${AGENTPROFILES_CONTENT_DIR}/claude/work/settings.json"
assert_symlink "${tmp_home}/.claude/agents" "${AGENTPROFILES_CONTENT_DIR}/claude/work/agents"

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

# Verify include-strategy switches managed entries back to _base
assert_is_real_dir "${tmp_home}/.claude"
assert_symlink "${tmp_home}/.claude/settings.json" "${AGENTPROFILES_CONTENT_DIR}/claude/_base/settings.json"
assert_symlink "${tmp_home}/.claude/agents" "${AGENTPROFILES_CONTENT_DIR}/claude/_base/agents"

echo "✓ Include strategy structure verified"

echo "✅ Smoke test passed: ${tmp_dir}"
