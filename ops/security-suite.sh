#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../backend"
npm run security:static
npm run security:pentest
