world-50m.geojson
=================

Weltkarte (Ländergrenzen, 1:50m) für die Restaurant-Karte auf /reisen.

Quelle:  Natural Earth (naturalearthdata.com), Datensatz
         "Admin 0 – Countries" (50m).
Lizenz:  Gemeinfrei / Public Domain — frei nutzbar ohne Namensnennung.
         Wir nennen die Quelle trotzdem in der Karten-Attribution.

Aufbereitung: Nur die benötigten Eigenschaften behalten — Ländername
(NAME_DE), Label-Ankerpunkt (LABEL_X/Y → lx/ly) und Zoom-Schwelle
(MIN_LABEL → min). Koordinaten auf 2 Nachkommastellen gerundet und
aufeinanderfolgende Doppelpunkte entfernt, um die Datei klein zu halten.
Rein statisch, wird lokal ausgeliefert (keine externen Kartenserver,
CSP-konform).


capitals.json
=============

Nationale Hauptstädte (Punkte) für die Restaurant-Karte auf /reisen — werden
erst ab einer höheren Zoomstufe (in ein Land hinein) eingeblendet.

Quelle:  Natural Earth (naturalearthdata.com), Datensatz
         "Populated Places" (50m), gefiltert auf nationale Hauptstädte
         (ADM0CAP = 1).
Lizenz:  Gemeinfrei / Public Domain — frei nutzbar ohne Namensnennung.

Aufbereitung: Kompaktes JSON-Array [{ n, lat, lng, min }] — deutscher Name
(NAME_DE, sonst NAME), Koordinaten auf 2 Nachkommastellen gerundet, sowie eine
Zoom-Schwelle „min" (aus MIN_ZOOM, auf 4–7 begrenzt), ab der die Hauptstadt
eingeblendet wird. Rein statisch, lokal ausgeliefert (keine externen
Kartenserver, CSP-konform).
