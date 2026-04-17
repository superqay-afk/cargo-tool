#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

python3 -m py_compile \
  feishu_backend.py \
  api/_lib.py \
  api/auth/feishu/login.py \
  api/auth/feishu/callback.py \
  api/feishu/status.py \
  api/feishu/logout.py \
  api/bitable/fields.py \
  api/bitable/fields/init.py \
  api/bitable/records/search.py \
  api/bitable/records/batch_create.py \
  api/bitable/records/batch_update.py

node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const must=['btnFeishuManage','btnFeishuCheck','btnOpenFeishuDoc','btnInsertExample']; const miss=must.filter(x=>!html.includes(x)); if(miss.length){console.error('Missing ids in index.html:',miss.join(',')); process.exit(1)} console.log('index.html ids ok')"

node -e "const fs=require('fs'); const js=fs.readFileSync('app.js','utf8'); const must=['feishuBackendBase','driverCandidatesForMatch','renderStrategySection']; const miss=must.filter(x=>!js.includes(x)); if(miss.length){console.error('Missing symbols in app.js:',miss.join(',')); process.exit(1)} console.log('app.js symbols ok')"

echo "Selftest OK"

