#!/usr/bin/env bash
set -eu
cd -- "$(dirname -- "$0")"
# The launcher builds the existing project; it never installs system software or downloads models.
npm run build
exec node scripts/recalllab-local.mjs --open
