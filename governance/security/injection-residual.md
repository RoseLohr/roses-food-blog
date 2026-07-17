# Restrisiko-Annahme — Prompt-Injection (C-07, UNSETTLED)

**Stand:** 2026-07-17 · **Owner:** ai-security (in-command) · **Band:** BLOCKER-1
**Re-Akzeptanz-Kadenz:** bei jeder Modell-/Prompt-Änderung, mind. vierteljährlich.

## Doktrin
Es gibt keine zuverlässige allgemeine Prompt-Injection-Abwehr; publizierte Filter
werden reihenweise mit >90 % Erfolg umgangen. Deshalb ist die einzige durable
Mitigation **architektonisch**: eine erfolgreiche Injection darf keine konsequente
Aktion auslösen.

## Warum das Restrisiko hier niedrig ist (checkbar, nicht gehofft)
1. **Kein handlungsfähiges Bein.** Der KI-Pfad hat kein Tool, keinen Egress, keine
   Schreibfähigkeit. Erzwungen durch `ai-capability-guard` (Build fällt bei Tool/
   Egress) — die „gefährliche Drei" kann nicht zusammentreten (C-08).
2. **Schema-gebundene Ausgabe.** Selbst eine voll injizierte Modellantwort kann nur
   Rezeptfelder füllen; alles andere strippt zod. Bewiesen:
   `tests/injection.containment.test.ts`.
3. **In-command-Review.** Der Entwurf erreicht keinen Nutzer und keine DB, bevor
   die Admin-Autorin ihn geprüft und gespeichert hat (Taxonomien deferred bis
   Speichern). Der „Nutzer als Review-Layer" existiert hier nicht — der Admin ist
   Autor, nicht Reviewer-of-record.

## Kompensierende Kontrolle & Tripwire
- **Kontrolle:** `ai-capability-guard` (kein konsequentes Bein) + Schema-Bindung +
  Kalibrier-Seeds S7/S8.
- **Tripwire:** Führt jemand Tool-Use/Egress/Autopublish im KI-Pfad ein, fällt der
  Guard-Build und dieses Restrisiko wird neu bewertet (dann ist es nicht mehr
  niedrig). Ein öffentlich-nutzerseitiger KI-Endpunkt reaktiviert C-07/C-29
  ebenfalls.

## Was NICHT als Kontrolle zählt
Ein Klassifikator/Filter (häufigste Fehl-Remediation) und ein menschlicher
Freigeber pro Aufruf (zweithäufigste, hier fiktiv). Beide sind hier nicht die
Kontrolle; die Architektur ist es.
