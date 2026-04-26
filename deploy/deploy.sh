#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

cd "${repo_root}"

git pull
docker compose --env-file .env build
docker compose --env-file .env run --rm scheduler pnpm db:migrate
docker compose --env-file .env up -d
