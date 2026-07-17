# Threat-Model — Roses Food Blog (C-02)

**Version:** 1.0 · **Stand:** 2026-07-17 · **Aktuell gehalten durch:**
`scripts/regime/boundary-check.mjs` (fällt den Build bei neuer, nicht deklarierter
Integration/Egress) + nächtlicher Architektur-Diff (Regime §6.5.3). Ein
Threat-Model, das nur ein Mensch pflegt, ist hier null Tage aktuell — deshalb der
Detektor.

## Systemkontext & Datenflüsse

```
Besucher ──HTTP──> Next.js (öffentlich) ──> SQLite (lesend)
Admin ──HTTPS+Session──> Next.js (protected) ──> SQLite (schreibend)
                                  │
                                  ├──(admin-only)──> Anthropic API   [Egress 1]
                                  ├──(Queue/Cron)──> SMTP            [Egress 2]
                                  └──(Bildupload)──> sharp/vips exec [Exec 1]
```

## Trust-Boundaries (deklariert in boundaries.json)

| Boundary | Typ | Kernbedrohung | Minderung |
|---|---|---|---|
| Besucher → öffentlich | Netz | Injection, DoS | parametrisierte Queries, FTS-Allowlist, Zod, Rate-Limit |
| Admin → protected | Netz+Auth | Auth-Bypass, IDOR, CSRF | Session (HttpOnly/secure), **Authz-Coverage-Gate**, Same-Origin-CSRF |
| App → Anthropic | Egress | Injection, Datenabfluss, Kosten | Schema-Bindung, kein Tool/Egress, kein PII im Prompt, Caps |
| App → SMTP | Egress | PII-Abfluss, Spoofing | Einwilligung, Erasure, Provider-SPF/DKIM |
| App → Bildtool | Exec | Command-Injection | `execFile` ohne Shell, feste Argumente |
| Datei-Auslieferung | Netz | Path-Traversal | strikte Regex `^[a-f0-9]{20}$`/`^w\d{3,4}\.webp$` |

## STRIDE je Boundary (Kernpunkte)

- **Spoofing:** Session-Token = 32 zufällige Bytes, SHA-256 gehasht in DB; Login argon2id.
- **Tampering:** alle Schreibpfade server-seitig geguardet (Gate erzwingt es); Modellausgabe schema-gebunden.
- **Repudiation:** git-Provenance + Commit-Trailer + ops_event; Admission-Attest.
- **Information Disclosure:** kein Roh-IP, kein PII in Logs, kein Secret im Prompt (Scans erzwingen).
- **Denial of Service:** Rate-Limit öffentlich; KI admin-only + Caps; Single-Node bewusst (ADR 0006).
- **Elevation of Privilege:** ein Admin-Modell, kein Tenant; kein Tool-Use/Agent (Guard erzwingt).

## Orphan-Threats
Keine. Jede Boundary oben ist einer Kontrolle/einem Test zugeordnet; neue Boundaries
werden vom Detektor erzwungen, bevor sie unbemerkt entstehen.
