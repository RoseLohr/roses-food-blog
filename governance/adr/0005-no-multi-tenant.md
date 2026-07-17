# 0005 — Kein Mandanten-Modell (bewusst)

**Kontext.** Ein einziger Blog, eine Redaktion. Keine fremden Kunden-Daten.

**Entscheidung.** Kein Tenant-Konzept; öffentliche Inhalte sind global, Admin-
Bereich ist single-user (ADR 0002).

**Konsequenzen.** Die Cross-Tenant-Ownership-Prüffamilie (C-01 u. a.) ist N/A
(Ledger F1, Kalibrier-Seed S2 inaktiv). Datenzugriff braucht keine Tenant-Prädikate.
Tripwire: Einführung eines zweiten Mandanten macht die Familie sofort „aktiv".

**Verworfen.** Vorsorgliche Mandantenschicht (Komplexität ohne Anforderung).
