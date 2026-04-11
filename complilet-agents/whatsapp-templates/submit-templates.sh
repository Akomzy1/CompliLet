#!/usr/bin/env bash
# =============================================================================
# CompliLet — WhatsApp Message Template Submission Script
#
# Reads templates from templates.json and submits each to the Meta Graph API
# for pre-approval. Templates must be APPROVED before they can be sent to
# users who have not messaged CompliLet in the last 24 hours.
#
# Prerequisites:
#   export WABA_ID="your_whatsapp_business_account_id"
#   export META_ACCESS_TOKEN="your_system_user_access_token"
#
# Usage:
#   chmod +x submit-templates.sh
#   ./submit-templates.sh              # submit all templates
#   ./submit-templates.sh --status    # check approval status
#   ./submit-templates.sh --dry-run   # print what would be submitted, no API calls
#
# Meta API docs:
#   https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
# =============================================================================

set -euo pipefail

API_VERSION="v20.0"
API_BASE="https://graph.facebook.com/${API_VERSION}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_FILE="${SCRIPT_DIR}/templates.json"

# ── Validate dependencies ─────────────────────────────────────────────────────

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required."
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is required."
  exit 1
fi

if [[ ! -f "${TEMPLATES_FILE}" ]]; then
  echo "ERROR: templates.json not found at ${TEMPLATES_FILE}"
  exit 1
fi

# ── Mode: --status ─────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--status" ]]; then
  if [[ -z "${WABA_ID:-}" || -z "${META_ACCESS_TOKEN:-}" ]]; then
    echo "ERROR: WABA_ID and META_ACCESS_TOKEN must be set."
    exit 1
  fi
  echo "Fetching template approval status from Meta API..."
  echo ""
  curl -s "${API_BASE}/${WABA_ID}/message_templates?fields=name,status,category,language&limit=25" \
    -H "Authorization: Bearer ${META_ACCESS_TOKEN}" | \
    python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'error' in data:
    print('API error:', data['error'].get('message'))
    sys.exit(1)
templates = data.get('data', [])
if not templates:
    print('No templates found for this WABA.')
else:
    col = '{:<35} {:<12} {:<15} {}'
    print(col.format('NAME', 'STATUS', 'CATEGORY', 'LANGUAGE'))
    print('-' * 76)
    for t in sorted(templates, key=lambda x: x.get('name','')):
        print(col.format(t.get('name',''), t.get('status',''), t.get('category',''), t.get('language','')))
    total = len(templates)
    approved = sum(1 for t in templates if t.get('status') == 'APPROVED')
    print()
    print(f'Total: {total}   Approved: {approved}   Pending/Other: {total - approved}')
"
  exit 0
fi

# ── Mode: --dry-run ────────────────────────────────────────────────────────────

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "DRY RUN — no API calls will be made."
  echo ""
fi

# ── Validate credentials (not needed for dry-run) ────────────────────────────

if [[ "${DRY_RUN}" == "false" ]]; then
  if [[ -z "${WABA_ID:-}" ]]; then
    echo "ERROR: WABA_ID is not set."
    echo "  export WABA_ID=\"your_waba_id\""
    exit 1
  fi
  if [[ -z "${META_ACCESS_TOKEN:-}" ]]; then
    echo "ERROR: META_ACCESS_TOKEN is not set."
    echo "  export META_ACCESS_TOKEN=\"your_system_user_token\""
    exit 1
  fi
fi

# ── Extract templates from templates.json ────────────────────────────────────
# Writes each template to a temp file, submits, then removes.

TEMPLATE_COUNT=$(python3 -c "
import json
data = json.load(open('${TEMPLATES_FILE}'))
print(len(data.get('templates', [])))
")

echo "Found ${TEMPLATE_COUNT} templates in templates.json"
if [[ "${DRY_RUN}" == "false" ]]; then
  echo "Submitting to WABA: ${WABA_ID}"
fi
echo ""

SUCCESS=0
FAILED=0
TMPDIR_LOCAL=$(mktemp -d)
trap 'rm -rf "${TMPDIR_LOCAL}"' EXIT

# Extract each template to its own temp JSON and submit
python3 -c "
import json, os
data = json.load(open('${TEMPLATES_FILE}'))
tmpdir = '${TMPDIR_LOCAL}'
for i, tpl in enumerate(data.get('templates', [])):
    # Remove _meta-only fields, keep only API fields
    api_payload = {k: v for k, v in tpl.items() if k != 'status'}
    path = os.path.join(tmpdir, f'tpl_{i}.json')
    with open(path, 'w') as f:
        json.dump(api_payload, f)
    print(tpl['name'])
" | while read -r template_name; do
  # Find the matching temp file by index
  idx=$(python3 -c "
import json
data = json.load(open('${TEMPLATES_FILE}'))
names = [t['name'] for t in data.get('templates', [])]
print(names.index('${template_name}'))
")
  payload_file="${TMPDIR_LOCAL}/tpl_${idx}.json"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "  [dry-run] Would submit: ${template_name}"
    echo "  Payload: $(cat "${payload_file}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps({k:v for k,v in d.items() if k!='components'}, indent=2))")"
    SUCCESS=$((SUCCESS + 1))
    continue
  fi

  echo -n "  Submitting ${template_name}... "

  response=$(curl -s -w "\n%{http_code}" \
    "${API_BASE}/${WABA_ID}/message_templates" \
    -H "Authorization: Bearer ${META_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d @"${payload_file}")

  http_code=$(echo "${response}" | tail -1)
  body=$(echo "${response}" | head -n -1)

  if [[ "${http_code}" == "200" ]]; then
    status=$(echo "${body}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','PENDING'))" 2>/dev/null)
    id=$(echo "${body}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    echo "OK (${status}, id: ${id})"
    SUCCESS=$((SUCCESS + 1))
  elif [[ "${http_code}" == "400" ]]; then
    error_code=$(echo "${body}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',{}).get('error_subcode',''))" 2>/dev/null)
    error_msg=$(echo "${body}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',{}).get('message',''))" 2>/dev/null)
    if [[ "${error_code}" == "2388127" ]] || echo "${error_msg}" | grep -qi "already exists"; then
      echo "SKIP (already exists — will update status on next sync)"
      SUCCESS=$((SUCCESS + 1))
    else
      echo "FAILED (HTTP 400): ${error_msg}"
      FAILED=$((FAILED + 1))
    fi
  else
    error=$(echo "${body}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',{}).get('message','Unknown error'))" 2>/dev/null || echo "Parse error")
    echo "FAILED (HTTP ${http_code}): ${error}"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Dry run complete. ${TEMPLATE_COUNT} templates would be submitted."
else
  echo "Done. ${SUCCESS} submitted/skipped, ${FAILED} failed."
  echo ""
  echo "Templates are reviewed by Meta — approval typically takes 24-48 hours."
  echo ""
  echo "Check status:"
  echo "  ./submit-templates.sh --status"
  echo "  https://business.facebook.com/wa/manage/message-templates/"
fi
