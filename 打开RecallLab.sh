#!/usr/bin/env bash
set -eu
cd -- "$(dirname -- "$0")"
runtime_ok() {
  command -v node >/dev/null 2>&1 && node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>20||(major===20&&minor>=19)?0:1)' >/dev/null 2>&1
}
if [ -n "${RECALLLAB_NODE_BIN:-}" ] && [ -x "$RECALLLAB_NODE_BIN" ]; then
  export PATH="$(dirname -- "$RECALLLAB_NODE_BIN"):$PATH"
fi
if ! runtime_ok; then
  for task_node_bin in "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin; do
    if [ -x "$task_node_bin/node" ] && "$task_node_bin/node" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' >/dev/null 2>&1; then
      export PATH="$task_node_bin:$PATH"
      break
    fi
  done
fi
if ! runtime_ok; then
  printf '%s\n' '没有找到所需的现有 Node 20.19 或更新版本。没有安装软件或修改学习数据。' >&2
  exit 1
fi
if [ "${1:-}" = '--check-runtime' ]; then
  node --version
  exit 0
fi
# Use existing dependencies only; do not install software or download models.
npm run build
exec node scripts/recalllab-local.mjs --open
