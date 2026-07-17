# KI-Governance — konsolidierte Track-C-Dimensionen

Deckt die verbleibenden Track-C-Prüfungen ab, die primär Governance/Politik sind.
Jede trägt eine **owning role**, ein **Maß/eine Kontrolle** und einen **Tripwire**.
Kadenz-Reviews sind in-command (kalendarisch); die maschinellen Kontrollen laufen im Gate.

## C-11 · KI-Risikoprogramm (NIST AI RMF) — Owner: ai-governance
- **Govern:** `governance/ai-policy.md` (Tier-Map), diese Datei, `constitution.md`.
- **Map:** `governance/ai-system-inventory.md` (AIS-1, admin-only, limited-risk).
- **Measure:** LLM-Matrix (C-05), Injection-Containment (C-07), Golden-Eval (C-10).
- **Manage:** Residual-Register + Tripwires; Evidenz **pipeline-emittiert** (CI-Logs,
  Gate-Ausgaben) statt vor einem Audit von Hand gesammelt.
- **Tripwire:** ein KI-System ohne Evidenz in der Periode → Finding.

## C-20 · Responsible-AI-Dimensionen — Owner: je Dimension
| Dimension | Maß/Kontrolle | Owner |
|---|---|---|
| Transparenz | „KI-Entwurf"-Badge + `ai-disclosure.test.ts` (C-36) | product |
| Kontestierbarkeit | Admin editiert/verwirft jeden Entwurf; Taxonomien deferred bis Speichern — der Korrekturmechanismus existiert und funktioniert | ai-quality |
| Robustheit | Schema-Bindung + Injection-Containment-Test | ai-security |
| Fairness/Bias | Rezept-Domäne, geringe Bias-Fläche; keine Entscheidungen über Personen | ai-governance |
- **Tripwire:** eine Dimension ohne laufendes Maß in der Periode → Finding.

## C-28 · Residency — Owner: platform-infrastructure
- Single-Node-Self-Host (EU); alle Stores ko-lokalisiert (SQLite-Datei, Medien-FS,
  Caches). Kein Vektor-Store, kein externer Log-/Trace-Store.
- Inferenz-Region: Anthropic-Anbieter-Region; **keine Abonnenten-PII** fließt in den
  KI-Aufruf. SMTP-Region je Betreiber.
- **Kontrolle:** Datenkarte (C-04) kennt jeden Store; ein neuer Store fällt den Build.
- **Tripwire:** Einführung eines Stores außerhalb der Region → data-map-Diff.

## C-29 · Content-Safety — Owner: trust-and-safety
- Generatives Feature **admin-only** (nicht öffentlich); geringe Missbrauchsfläche.
- Refusal-Pfad behandelt (`stop_reason === "refusal"` → klare Meldung).
- **Tripwire:** ein öffentlich-nutzerseitiger KI-Endpunkt reaktiviert C-29 mit Pflicht
  zu Klassifikatoren + gemessenen FP/FN-Raten (ai-capability-guard flankiert).

## C-30 · Jailbreak-Resistenz (Restrisiko) — Owner: ai-security
- ASR nicht separat gemessen (admin-only, schema-gebunden, nicht-konsequent).
- **Kompensierende Kontrolle:** selbst eine jailbreakte Ausgabe ist ein
  nicht-konsequenter Entwurf, den der Admin prüft (siehe injection-residual.md).
- **Tripwire:** Provider-Modellwechsel oder öffentlicher Endpunkt → ASR messen.

## C-31 · Adversarial-Taxonomie / 7-Schichten — Owner: ai-security
- Threat-Model (C-02) bildet die Boundaries ab; die 7 agentischen Schichten sind
  hier überwiegend **leer** (kein Agenten-Framework, keine Tool-Ebene, kein
  Agent-Ökosystem) — der ai-capability-guard hält sie leer.
- **Tripwire:** Einführung einer agentischen Schicht reaktiviert das Mapping.

## C-33 · KI-Nutzungspolitik erzwungen — Owner: engineering-leadership + legal
| Klausel (ai-policy.md) | Erzwungen durch |
|---|---|
| Modell gepinnt | source-gates Alias-Lint (B-13) |
| Prompt nur in Registry | source-gates Inline-Prompt-Verbot (A-20) |
| Kein Secret im Prompt | prompt-scan.mjs (C-24) |
| Tier-Map je Änderungsklasse | CI-Gate + CODEOWNERS-Separation (B-35) |
| Keine Tool-/Agenten-Fähigkeit | ai-capability-guard |
- **Nicht-erzwingbare Klauseln** (rein prozedural) sind im Policy-Dokument als solche
  markiert. **Tripwire:** eine neue maschinen-relevante Klausel ohne Gate → Finding.

## C-34 · Provider-Training auf deinen Daten — Owner: legal + ai-platform
- Anthropic-kommerzielle API: **kein Training** auf API-Ein-/Ausgaben per Default
  (Provider-Terms). Ausgangstext wird nicht persistiert; keine Abonnenten-PII im Aufruf.
- **Assertion:** Modell/Provider gepinnt (B-13); ein Wechsel ist eine Code-Änderung
  durchs Gate. Eine programmatische Konto-Assertion gegen die Provider-API ist als
  Kadenz vorgesehen (Netzwerk nötig), Owner ai-platform.
- **Tripwire:** Provider-/Modellwechsel oder Termänderung → Neubewertung.

## C-38 · Fabrikation — Owner: ai-quality
- Keine Zitat-/Link-/Identifier-Fläche im Rezeptentwurf → kein „Citation-resolve"-Fehler.
- Zahlen/Zeiten: der Entwurf erreicht **nie** einen Nutzer ungeprüft; der Admin ist
  in-command-Autor. Saison deterministisch gematcht (kein KI-Raten).
- **Tripwire:** ein öffentlich-nutzerseitiger KI-Output reaktiviert C-38 mit Pflicht
  zu programmatischer Verifikation/Zurückhaltung des Unverifizierbaren.

## C-40 · Gesellschaft/Umwelt — Owner: platform
- Immateriell: ein admin-only-Generativaufruf je Rezept; keine Hochrisiko-Nutzung
  (A-40/B-38 bereits N/A). Ehrlich als immateriell dokumentiert (keine erfundene Zahl).
- **Tripwire:** Berichtspflicht oder Workload-Formänderung → re-banden + messen.
