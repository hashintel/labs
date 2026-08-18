#!/usr/bin/env bash
# Seed a HASH web with synthetic SAP supply-chain data.
#
#   ./seed-mock.sh --web alice                    seed the "alice" web (localhost graph)
#   ./seed-mock.sh --web alice --scale-factor 5   five times the volume (scaling is linear)
#   ./seed-mock.sh                                dry run: stub graph, writes nothing
#
# Options:
#   --web <shortname>       resolve the web + actor on the graph and write for real
#                           (graph defaults to http://localhost:4000; HASH_GRAPH_URL overrides)
#   --scale-factor <n>      dataset size, default 1; also positional or --sf
#   --seed <n>              RNG seed. Default: random, printed at start. Same seed =
#                           same data, so re-seeding a web is only a no-op with --seed.
#   --scenarios <x>         demo (default) | none | SCN003,SCN011 (see README)
#
# Scale (linear):   SF        0.1     1      5      10
#                   entities  ~18k   ~175k  ~0.9M  ~1.8M
#                   orders     500    5k     25k    50k
#
# Toolchain: uv (runs libs/sap-mock-data at the repo root) + node 20+, or nix
# for either half -- whatever is on PATH is used. Setup: ../../README.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(cd "$HERE/../.." && pwd)"

SF="${SCALE_FACTOR:-1}"
SEED="${RANDOM_SEED:-}"
WEB=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) sed -n '2,21p' "$0" | sed 's/^#//; s/^ //'; exit 0;;
    --web) WEB="$2"; shift 2;;
    --scale-factor|--sf) SF="$2"; shift 2;;
    --seed) SEED="$2"; shift 2;;
    --scenarios) SCENARIOS="$2"; shift 2;;
    -*) echo "unknown option: $1 (see --help)" >&2; exit 2;;
    *) SF="$1"; shift;;
  esac
done
[ -n "$SEED" ] || SEED=$(( (RANDOM << 15) | RANDOM ))

RUNNER_DIR="${RUNNER_DIR:-$PKG_ROOT/../integration-runner}"
SAPLIB="${SAPLIB:-$PKG_ROOT/../../libs/sap-mock-data}"
WAREHOUSE="${MOCK_WAREHOUSE:-$HERE/.mock-warehouse}"

# Generator: the sap-mock-data uv project, via uv on PATH or its nix shell.
if command -v uv >/dev/null 2>&1; then
  SAPMOCK=(uv run --project "$SAPLIB" sap-mock)
elif command -v nix >/dev/null 2>&1; then
  # path: works regardless of git tracking
  SAPMOCK=(nix develop "path:$SAPLIB" -c uv run --project "$SAPLIB" sap-mock)
else
  echo "generating data needs uv or nix; the generator is the uv project at $SAPLIB." >&2
  exit 1
fi

# Runner node: PATH node, else nix.
if command -v node >/dev/null 2>&1; then
  NODE=(node)
  TSX=(node_modules/.bin/tsx)
elif command -v nix >/dev/null 2>&1; then
  NODE=(nix develop "$RUNNER_DIR" -c node)
  TSX=(nix develop "$RUNNER_DIR" -c node_modules/.bin/tsx)
else
  echo "no node and no nix; install node 20+ (or nix)." >&2
  exit 1
fi

if [ ! -x "$RUNNER_DIR/node_modules/.bin/tsx" ]; then
  echo "integration-runner dependencies missing. Install them once, then re-run:" >&2
  echo "  (cd $RUNNER_DIR && npm install)" >&2
  exit 1
fi

if [ -n "$WEB" ]; then
  # Resolves HASH_GRAPH_URL / HASH_WEB_ID / HASH_ACTOR_ID; fails if the graph is
  # down, the web is unknown, or the supply-chain ontology is missing. The
  # assignment (not a bare eval) makes a resolver failure abort the run.
  WEB_ENV="$("${NODE[@]}" "$HERE/resolve-web.mjs" "$WEB")" || exit 1
  eval "$WEB_ENV"
fi

echo "[seed-mock 1/2] generating synthetic SAP data (SF=$SF, seed $SEED -- reproduce with --seed $SEED) -> $WAREHOUSE"
# SCNxxx_CONFIG env vars pass through as --scenario-config flags.
SCENARIO_FLAGS=()
for var in $(env | grep -oE '^SCN[0-9]{3}_CONFIG'); do
  SCENARIO_FLAGS+=(--scenario-config "${var%_CONFIG}=${!var}")
done
"${SAPMOCK[@]}" generate "$WAREHOUSE" --seed "$SEED" --scale-factor "$SF" \
  --scenarios "${SCENARIOS:-demo}" ${SCENARIO_FLAGS[@]+"${SCENARIO_FLAGS[@]}"}

TARGET="stub graph (dry run -- pass --web <shortname> to write for real)"
[ -n "${HASH_GRAPH_URL:-}" ] && TARGET="graph at $HASH_GRAPH_URL (web ${HASH_WEB_ID:-?})"
echo "[seed-mock 2/2] running the integration -> $TARGET"
export SOURCE_FOLDER="$WAREHOUSE"
export HASH_WEB_ID="${HASH_WEB_ID:-00000000-0000-0000-0000-000000000000}"
export HASH_TYPE_BASE="${HASH_TYPE_BASE:-https://hash.ai/@h/types}"
export RUNNER_BASE_DIR="${RUNNER_BASE_DIR:-$HERE/.mock-state}"
# tsx resolves the runner's @integrations/* tsconfig paths from its cwd
cd "$RUNNER_DIR"
"${TSX[@]}" src/runner.ts "$HERE/sap-mock.yaml"
