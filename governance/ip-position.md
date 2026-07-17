# IP-Position zu maschinen-generiertem Code (C-25)

**Version:** 1.0 · **Stand:** 2026-07-17 · **Owner:** legal + platform-security (in-command)
**Kadenz:** jährlich gegen Rechtsentwicklung geprüft (in-command, kalendarisch).

## Sachverhalt
Praktisch der gesamte Anwendungscode dieses Blogs ist maschinen-generiert. Es gibt
keinen menschlichen Reviewer, der ein kopiertes Snippet oder eine inkompatible
Lizenz bemerkt — deshalb ist der Lizenz-Scanner (`scripts/regime/license-scan.mjs`)
nicht Assistent, sondern **die Kontrolle** (A-01 aus anderer Richtung).

## Position
1. **Urheberrecht am Output:** Rein maschinen-generierter Code entbehrt in mehreren
   Jurisdiktionen (u. a. US) der für Urheberschutz nötigen menschlichen Schöpfung.
   Die Betreiberin erhebt daher **keinen** starken Urheberrechtsanspruch auf den
   generierten Code als solchen; der Wert liegt im lauffähigen System, den Daten
   und der Marke, nicht in einem Code-Copyright.
2. **Eingebettete Fremd-Fragmente:** Dritt-Abhängigkeiten stehen unter ihren
   Lizenzen; starkes Copyleft (AGPL/GPL/SSPL) ist per Scan ausgeschlossen und
   blockiert den Merge. Der Blog wird nicht distribuiert (SaaS-artiger Self-Host),
   die AGPL-Sorge wäre dennoch relevant → deshalb hart geblockt.
3. **Assistenz-Werkzeuge:** Zulässig ist die Nutzung von KI-Codeassistenz unter
   Anbieter-Terms ohne Trainings-Rückfluss (vgl. C-34); generierte Artefakte tragen
   Provenance-Trailer (Modellfamilie/Session) im Commit.

## Kontrolle & Ratchet
- Lizenz-Scan blockierend in CI (kein starkes Copyleft).
- Ungelöste Copyleft-Konflikte bleiben bei 0 (Ratchet S11).
- Diese Position wird jährlich in-command geprüft; eine Rechtsänderung triggert
  Neubewertung.
