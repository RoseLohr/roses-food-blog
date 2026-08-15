#!/usr/bin/env bash
# Meldepfad für wiederkehrende Läufe.
#
# WARUM: Bis 08/2026 meldete kein einziger geplanter Lauf irgendwohin.
# Fehlschläge waren nur in der Actions-Oberfläche sichtbar — der DAST-Workflow
# war deshalb vier Wochen lang rot, ohne dass es jemand bemerkte. Eine
# Kontrolle, deren Ergebnis niemand erreicht, ist keine Kontrolle.
#
# Legt ein Issue an bzw. kommentiert das offene. Bewusst EIN Sammel-Issue je
# Workflow statt täglich ein neues: sonst erzeugt ein dauerhaft roter Lauf
# einen Strom, den man genauso zuverlässig ignoriert wie gar keine Meldung.
#
#   bash scripts/regime/kadenz-alarm.sh "<Workflow-Name>"
set -euo pipefail

WORKFLOW="${1:?Workflow-Name fehlt}"
: "${GH_TOKEN:?GH_TOKEN nicht gesetzt}"
: "${GITHUB_SERVER_URL:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_SHA:?}"

# --force: idempotent anlegen ODER aktualisieren. Kein Fehler-Verschlucken —
# ohne das Label schlüge das Anlegen des Issues unten fehl.
gh label create kadenz-alarm --force --color B60205 \
  --description "Ein wiederkehrender Lauf ist fehlgeschlagen"

TITEL="Wiederkehrender Lauf fehlgeschlagen: $WORKFLOW"
TEXT="Lauf: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID
Commit: $GITHUB_SHA"

NUMMER="$(gh issue list --label kadenz-alarm --state open \
  --search "$TITEL in:title" --json number --jq '.[0].number // empty')"

if [[ -n "$NUMMER" ]]; then
  gh issue comment "$NUMMER" --body "$TEXT"
  echo "Alarm an bestehendes Issue #$NUMMER angehängt."
else
  gh issue create --title "$TITEL" --label kadenz-alarm --body "$TEXT"
  echo "Alarm-Issue angelegt."
fi
