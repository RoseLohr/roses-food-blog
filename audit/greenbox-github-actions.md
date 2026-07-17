# Was DU tun musst — greenbox & GitHub (Rest der Freigabe)

Track C ist geschlossen; von 19 offenen Part-1-Blockern sind noch **3** offen.
Zwei davon (`A-01`/`A-39`) sind mit **einem Handgriff** aktivierbar. Alles unten
ist deine Aktion — der Rest läuft schon automatisch im Repo/CI.

## 1. Fremd-Vendor-Verifier aktivieren → schließt A-01/A-39 (die 2 STOP-SHIP)
Ein Zweit-Anbieter-Schlüssel (NICHT Anthropic — z. B. OpenAI/Gemini). Das
Harness (`scripts/regime/independent-verify.mjs` + Workflow) wartet darauf.

**Auf GitHub** (Repo → Settings → Secrets and variables → Actions):
- Secret `OPENAI_API_KEY` **oder** `SECOND_VENDOR_API_KEY` = dein Zweit-Anbieter-Key
  (NICHT Anthropic). Beide Namen werden akzeptiert — `OPENAI_API_KEY` reicht.
- (optional Variables) `VERIFIER_BASE_URL`, `VERIFIER_MODEL`
  (Default `https://api.openai.com/v1` / `gpt-4o-2024-08-06`, gepinnt).

Per CLI (falls `gh` vorhanden) — einer der beiden genügt:
```
gh secret set OPENAI_API_KEY --repo RoseLohr/roses-food-blog
```
Danach greift bei jedem PR ein unabhängiger Fremd-Vendor-Verifier den Diff an
und blockiert bei einem Refutat (confidence ≥ medium).

> Status: `OPENAI_API_KEY` ist bereits hinterlegt → A-39-Harness ist **aktiv**,
> sobald dieser Branch/PR läuft.

## 2. Branch-Protection einschalten → macht das Gate erst bindend
Ohne Branch-Protection ist CI grün, aber ein Merge ist trotzdem erzwingbar.

Repo → Settings → Branches → Add rule für `main`:
- ✅ Require status checks to pass → wähle **CI-Gate / gate**, **security**,
  **mutation**, **Independent-Verify / cross-vendor**.
- ✅ Require branches to be up to date · ✅ Include administrators.

Per CLI:
```
gh api -X PUT repos/RoseLohr/roses-food-blog/branches/main/protection -f 'required_status_checks[strict]=true' -f 'required_status_checks[contexts][]=gate' -f 'enforce_admins=true' -f 'required_pull_request_reviews=' -f 'restrictions='
```

## 3. Erster echter Rollback-Drill auf der greenbox → protokolliert A-06/B-11
Das Skript ist da und getimt; einmal real üben und die Zeit notieren.

Auf dem Server (nach mind. zwei Deploys, damit `:previous` existiert):
```
DATA_DIR=/opt/roses/data ./deploy/rollback.sh --dry-run   # zeigt, was passieren würde
DATA_DIR=/opt/roses/data ./deploy/rollback.sh             # echter Rollback, misst die Dauer
```
(Die Ausgabe „Rollback erfolgreich in Ns" in `audit/evidence/` ablegen.)

## 4. (Optional) Blockierender Prod-DAST gegen die greenbox → härtet A-08
CI-DAST läuft schon wöchentlich; ein Scan gegen die echte Seite (mit nginx-Headern)
ist die Kür:
```
podman run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://DEINE-DOMAIN -I
```

## 5. (Optional) WAF vor nginx → Restpunkt von B-12
Patch-Automatik (dependabot) läuft; eine WAF (z. B. `nginx` + ModSecurity/CRS oder
Cloudflare davor) ist optional für einen Solo-Blog. Keine Terminal-Einzeiler —
Infrastruktur-Entscheidung.

---

## Was NICHT du bist — läuft schon automatisch
CI-Gate (21 Selbsttest-Gates), nightly-Kadenz (Kalibrierung/Bootstrap), DAST +
Lighthouse (wöchentlich), Dependabot (wöchentlich), Erasure-/Kill-Switch-/Fuzz-Tests,
Datenkarte, Provenance, Mandat-/Verfassungs-Hash. Kein Handanlegen nötig.

## Was echtes Residual bleibt (kein Handgriff schließt es kurzfristig)
`A-33` Erfolgsraten-SLI des Agenten — braucht Telemetrie über viele Läufe. Tripwire
+ Owner protokolliert; kein Blocker für den täglichen Betrieb.

**Wenn (1) + (2) erledigt sind, bleibt production_eligible nur noch an A-33 hängen —
und A-33 ist ein SLI-Aufbau über Zeit, kein Sicherheits-/Datenschutz-Loch.**

## 4. Auto-Deploy nach Push/Merge auf den Deploy-Branch (GitHub-Webhook)

> **Wichtig — Branch:** Der Default-Branch dieses Repos ist
> `claude/roses-food-blog-vxs3vm` (NICHT `main`). `deploy.sh` deployt den auf der
> greenbox ausgecheckten Branch — also denselben. Der Webhook triggert daher auf
> dem **Deploy-Branch**, nicht auf `main`. Automatik: der Empfänger liest den
> `repository.default_branch` aus dem Payload; abweichend per Env
> `DEPLOY_HOOK_BRANCH` überschreibbar. „Auf Main gemerged" = Push auf diesen
> Deploy-Branch.

Nach jedem Push/Merge auf den Deploy-Branch ruft GitHub den Webhook auf dem
Foodblog-Container auf; `POST /api/deploy-hook` verifiziert die HMAC-Signatur und
schreibt dieselbe Auslöse-Datei wie das Panel. Der bereits laufende Host-Watcher
startet daraufhin `./deploy.sh`. **Kein neuer Host-Setup nötig** (der Watcher aus
„Deploy-from-panel" reicht); der Container führt kein Host-Kommando aus.

**a) Secret erzeugen** (auf der greenbox oder lokal):
```
openssl rand -hex 32
```

**b) Secret dem Container geben** — dieselbe Env wie `ANTHROPIC_API_KEY`, Variable
`GITHUB_WEBHOOK_SECRET=<der-hex-Wert>`, dann Container neu starten (`./deploy.sh`).
Ohne diese Env ist der Endpunkt **aus** (503, fail-closed). Optional
`DEPLOY_HOOK_BRANCH=<branch>` setzen, falls ein anderer als der Default-Branch
deployt werden soll.

**c) Webhook bei GitHub anlegen** — Repo → Settings → Webhooks → Add webhook:
- Payload URL: `https://<deine-blog-domain>/api/deploy-hook`
- Content type: `application/json`
- Secret: **derselbe** hex-Wert aus (a)
- Events: nur „Just the push event."

Per CLI (Secret vorher exportieren: `export GITHUB_WEBHOOK_SECRET=<hex aus a>`):
```
gh api -X POST repos/RoseLohr/roses-food-blog/hooks -f name=web -F active=true -f 'events[]=push' -f config[url]=https://<deine-blog-domain>/api/deploy-hook -f config[content_type]=json -f config[secret]="$GITHUB_WEBHOOK_SECRET"
```

**d) Testen** — GitHub sendet beim Anlegen automatisch ein `ping` (erwartet 200) —
das bestätigt bereits, dass Endpunkt + Secret stimmen. Prüfbar unter GitHub →
Settings → Webhooks → dein Hook → „Recent Deliveries" (grünes Häkchen / 200).
Einen echten Deploy löst danach JEDER Push/Merge auf den Deploy-Branch aus (also
der normale Betrieb) — kein Sonder-Testcommit nötig. Kontrolle im Panel unter
„Aktualisierung" (Status/Log). Ungültige Signatur → 401, fremder Branch →
ignoriert (kein Deploy).

> **NICHT** `git push origin main` zum Testen benutzen: du arbeitest auf dem
> Deploy-Branch, dein lokales `main` ist verwaist/zurück — der Push wird als
> non-fast-forward abgelehnt und triggert ohnehin nichts. Push (oder Merge) auf
> `claude/roses-food-blog-vxs3vm` ist der richtige Auslöser.
