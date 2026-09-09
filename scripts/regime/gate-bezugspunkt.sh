#!/usr/bin/env bash
# ============================================================================
# Bezugspunkt für das Migrations-Gate: der letzte main-Commit, dessen Gate
# BESTANDEN hat. (B30, Runde drei)
#
#   gate-bezugspunkt.sh <start>      läuft die First-Parent-Historie ab <start>
#                                    rückwärts und druckt den ersten Commit mit
#                                    grünem Check-Run „gate"; Status 1, wenn es
#                                    keinen gibt oder die Abfrage scheitert.
#   gate-bezugspunkt.sh --selftest   prüft den Lauf gegen eine Attrappe von gh.
#
# WARUM NICHT „DER VORIGE STAND": `github.event.before` ist der Commit, der vor
# diesem Push auf main stand — nicht einer, der das Gate bestanden hat. Zwei
# Pushes genügen (Panel-Befund, nachgemessen): B verändert einen ausgelieferten
# Journal-Eintrag (rot gegen A), C lässt ihn so stehen (grün gegen B), und die
# Korrektur D wäre gegen C wieder rot. Eine Basis ohne Nachweis ist keine.
#
# Deshalb hängt der Anker am NACHWEIS: am Check-Run „gate" des CI-Gate-
# Workflows, gelesen über die GitHub-API (nur lesend, `checks: read`). Ein
# Commit, dessen Gate rot war oder nie lief, wird übersprungen; gesucht wird
# rückwärts, bis einer bestanden hat — höchstens SPANNE Commits, sonst Befund.
# Der Weg über einen selbst gesetzten Zeugen-Ref bräuchte Schreibrechte für
# das CI-Token; das ist eine Kontrolle, die sich selbst beglaubigt.
#
# Scheitert die Abfrage (Netz, Ratenlimit), ist das ein ABBRUCH — nicht „nicht
# grün, nächster Commit": Sonst würde ein Ratenlimit den Anker still nach hinten
# schieben, und niemand sähe es.
# ============================================================================
set -euo pipefail

SPANNE="${BEZUGSPUNKT_SPANNE:-60}"

# Zahl der bestandenen „gate"-Läufe des CI-Gate-Workflows für einen Commit.
# Gefiltert auf Name UND App: ein fremder Check gleichen Namens zählt nicht.
# `gh` und das Repository werden HIER gelesen, nicht beim Skriptstart: Der
# Selbsttest setzt seine Attrappe erst, nachdem das Skript läuft.
gruen_gezaehlt() { # gruen_gezaehlt <sha>
  "${BEZUGSPUNKT_GH:-gh}" api "repos/${GITHUB_REPOSITORY:-}/commits/$1/check-runs?check_name=gate&per_page=50" \
    --jq '[.check_runs[] | select(.name=="gate" and .app.slug=="github-actions" and .conclusion=="success")] | length'
}

# Kandidaten: First-Parent-Historie ab <start>, oder — nur im Selbsttest —
# eine vorgegebene Liste.
kandidaten() { # kandidaten <start>
  if [ -n "${BEZUGSPUNKT_KANDIDATEN:-}" ]; then
    cat "$BEZUGSPUNKT_KANDIDATEN"
  else
    git rev-list --first-parent -n "$SPANNE" "$1"
  fi
}

finde() { # finde <start>  → druckt den Bezugspunkt oder scheitert
  local sha zahl anzahl=0
  while IFS= read -r sha; do
    [ -n "$sha" ] || continue
    anzahl=$((anzahl + 1))
    if ! zahl="$(gruen_gezaehlt "$sha")"; then
      echo "gate-bezugspunkt: Abfrage der Check-Runs für $sha gescheitert — kein Bezugspunkt ohne Nachweis." >&2
      return 1
    fi
    case "$zahl" in
      ''|*[!0-9]*) echo "gate-bezugspunkt: unlesbare Antwort für $sha: „$zahl“." >&2; return 1 ;;
    esac
    if [ "$zahl" -gt 0 ]; then
      printf '%s\n' "$sha"
      return 0
    fi
  done < <(kandidaten "$1")
  if [ "$anzahl" -eq 0 ]; then
    echo "gate-bezugspunkt: keine Kandidaten ab „$1“ — Historie nicht geholt?" >&2
  else
    echo "gate-bezugspunkt: unter $anzahl Commits ab „$1“ hat keiner ein bestandenes Gate — kein Bezugspunkt." >&2
  fi
  return 1
}

selbsttest() {
  local tmp; tmp="$(mktemp -d)"
  # Die Attrappe: antwortet „1" für SHAs aus GRUEN, sonst „0"; bricht mit 2 ab,
  # wenn die Abfrage nicht nach dem Check „gate" fragt — damit der Lauf nicht
  # irgendeinen grünen Check als Nachweis nimmt.
  cat > "$tmp/gh" <<'GHEOF'
#!/usr/bin/env bash
url="$2"
case "$url" in *"check_name=gate"*) ;; *) echo "Attrappe: Abfrage fragt nicht nach gate: $url" >&2; exit 2 ;; esac
sha="${url#*/commits/}"; sha="${sha%%/*}"
case " $GRUEN " in *" $sha "*) echo 1 ;; *) echo 0 ;; esac
GHEOF
  chmod +x "$tmp/gh"
  export BEZUGSPUNKT_GH="$tmp/gh" GITHUB_REPOSITORY="probe/probe"
  local fehler=0 faelle=0
  pruefe() { # pruefe <Name> <Kandidaten…> -- <GRUEN> <erwartet: SHA | FEHLER>
    faelle=$((faelle + 1))
    local name="$1"; shift
    local liste=(); while [ "$1" != "--" ]; do liste+=("$1"); shift; done; shift
    local gruen="$1" erwartet="$2" got
    printf '%s\n' "${liste[@]}" > "$tmp/kandidaten"
    [ "${#liste[@]}" -gt 0 ] || : > "$tmp/kandidaten"
    # `export`, nicht als Präfix: eine Zuweisung vor einem FUNKTIONSaufruf gilt
    # in der Funktion, wird aber nicht an deren Kindprozesse (die Attrappe)
    # vererbt — der Selbsttest sah dadurch nie einen grünen Commit.
    export GRUEN="$gruen" BEZUGSPUNKT_KANDIDATEN="$tmp/kandidaten"
    if got="$(finde start 2>/dev/null)"; then :; else got="FEHLER"; fi
    if [ "$got" != "$erwartet" ]; then
      echo "   ✗ Selbsttest: „$name“ — erwartet $erwartet, bekommen $got"; fehler=1
    fi
  }
  pruefe "erster Kandidat gruen" aaa bbb ccc -- "aaa" "aaa"
  pruefe "erster rot, zweiter gruen" aaa bbb ccc -- "bbb" "bbb"
  pruefe "nur der letzte gruen" aaa bbb ccc -- "ccc" "ccc"
  pruefe "keiner gruen → Befund" aaa bbb ccc -- "" "FEHLER"
  pruefe "keine Kandidaten → Befund" -- "aaa" "FEHLER"
  # Der Abbruch bei einer scheiternden Abfrage — die Attrappe scheitert, wenn
  # die Abfrage nicht nach „gate" fragt. Nachgestellt, indem gh durch eine
  # Attrappe ersetzt wird, die IMMER scheitert.
  faelle=$((faelle + 1))
  printf '#!/usr/bin/env bash\nexit 22\n' > "$tmp/gh-kaputt"; chmod +x "$tmp/gh-kaputt"
  printf 'aaa\nbbb\n' > "$tmp/kandidaten"
  if BEZUGSPUNKT_GH="$tmp/gh-kaputt" BEZUGSPUNKT_KANDIDATEN="$tmp/kandidaten" finde start >/dev/null 2>&1; then
    echo "   ✗ Selbsttest: scheiternde Abfrage wurde als „nicht gruen“ gewertet statt als Abbruch"; fehler=1
  fi
  rm -rf "$tmp"
  if [ "$fehler" -ne 0 ]; then
    echo "[gate-bezugspunkt] Selbsttest FEHLGESCHLAGEN."; return 1
  fi
  echo "[gate-bezugspunkt] Selbsttest: $faelle Fälle — erster Nachweis gewinnt, ohne Nachweis kein Bezugspunkt, Abfragefehler bricht ab ✓"
}

case "${1:-}" in
  --selftest) selbsttest ;;
  "") echo "Aufruf: $0 <start> | --selftest" >&2; exit 2 ;;
  *) [ -n "${GITHUB_REPOSITORY:-}" ] || { echo "gate-bezugspunkt: GITHUB_REPOSITORY fehlt." >&2; exit 1; }
     finde "$1" ;;
esac
