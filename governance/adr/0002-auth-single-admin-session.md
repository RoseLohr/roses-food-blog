# 0002 — Auth: ein Admin-Konto, Session-Cookie, hash-wasm

**Kontext.** Genau eine redaktionelle Person pflegt Inhalte; öffentliche Seiten
sind anonym. Kein Multi-User-/Rollenbedarf.

**Entscheidung.** Ein `adminUser`; Passwort-Hash über `hash-wasm` (CPU-portabel,
kein natives Modul); serverseitige Session über signiertes Cookie (`auth-core`).

**Konsequenzen.** Kein Mandanten-/Rollenmodell nötig → die Cross-Tenant-Prüf-
familie des Audits ist strukturell N/A (Ausnahmen-Ledger F1). Tripwire: Einführung
eines zweiten Kontos/Mandanten reaktiviert diese Checks.

**Verworfen.** Externes IdP/OAuth (Overhead ohne Nutzen); mehrstufiges RBAC.
