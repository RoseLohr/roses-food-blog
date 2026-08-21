# Infrastruktur-Befund und Plan (Erhebung 2026-08-21)

Grundlage ist eine rein lesende Erhebung auf `leaf.klee.me`, ausgeführt vom
Betreiber am 21.08.2026 um 19:37 UTC. Sie misst die Auslieferung auf **drei
Ebenen getrennt** — Anwendung, Reverse Proxy, CDN — und macht damit zuordenbar,
welche Schicht welche Bytes und welche Millisekunden verursacht.

Dieses Dokument hält fest, was gefunden wurde, was daraus folgt und was
ausdrücklich **nicht** getan werden soll. Es ersetzt keine ADR; wo es eine
Architekturentscheidung berührt, ist das benannt.

---

## 0. Was diese Erhebung NICHT gemessen hat

Ehrlich vorweg, weil es sonst eine falsche Zahl im Umlauf hält:

**Die Messung „Ebene 3: App direkt" ist ungültig.** Das Erhebungsskript sprach
fest `127.0.0.1:3000` an. Der Container veröffentlicht die Anwendung aber auf
`127.0.0.1:3011`; auf `*:3000` lauscht ein anderer Node-Dienst. Die dort
ausgewiesenen 3 ms und die 404er stammen von einem fremden Prozess, nicht von
dieser Anwendung. Der reine Anwendungsanteil an der Antwortzeit ist damit
**unbekannt** — er lässt sich nur als Differenz grob eingrenzen.

Der Port muss aus `podman ps` gelesen werden statt geraten. Das ist der erste
Punkt im Plan (A1).

---

## 1. Die Auslieferungskette, wie sie wirklich ist

```
Browser ──https──▶ Cloudflare (colo CDG) ──https──▶ NPM / OpenResty 1.29.2.5 ──http──▶ roses-blog
                    br, cacht statisch          Container, Ports 80/443/81        127.0.0.1:3011
```

Das weicht von README §4 und `deploy/nginx.conf.example` ab. Dort steht ein
Betrieb mit **Debian-nginx auf dem Host plus certbot**. Den gibt es hier nicht:

- `nginx.service` ist `failed` (`MainPID=0`), seit unbestimmter Zeit, und
  `enabled` — sie versucht bei jedem Systemstart erneut zu starten und scheitert.
- Die nginx-Pakete (1.24.0, samt `libnginx-mod-http-brotli-filter`) sind
  installiert, aber unbenutzt.
- `/etc/letsencrypt/live` existiert auf dem Host **nicht**; die Zertifikate
  liegen im NPM-Container (`npm-18`, `npm-20`, `npm-21`).
- `/etc/nginx/conf.d/roses-kompression.conf` — von mir am 19.08. geschrieben —
  ist **wirkungslos**. Sie gehört zu einem nginx, der nicht läuft.

Für den A-37-Takeover-Drill ist das der schwerwiegendste Befund: Ein Mensch
ohne Vorwissen, der der README folgt, richtet einen zweiten Webserver ein, der
mit dem laufenden Betrieb nichts zu tun hat.

---

## 2. Befunde nach Hebelwirkung

### B1 — Der Ursprung komprimiert statische Dateien überhaupt nicht

Gemessen am Origin (Cloudflare umgangen), Bytes auf der Leitung:

| Ressource | identity | gzip | br |
|---|---:|---:|---:|
| `/` (HTML) | 135 424 | **21 263** | 135 424 |
| `…/04bv4jz9i8omc.css` | 67 818 | 67 818 | 67 818 |
| `…/310vm2bl3xxpt.js` | 5 364 | 5 364 | 5 364 |
| `raleway.woff2` | 47 080 | 47 080 | 47 080 |
| `w160.webp` | 7 070 | 7 070 | 7 070 |

Die gesamte aktive Kompressionskonfiguration des Proxys ist **eine einzige
Zeile**: `gzip on;` in `/etc/nginx/nginx.conf`. Ohne `gzip_types` gilt nginx'
Voreinstellung — und die umfasst ausschließlich `text/html`. Deshalb schrumpft
die Startseite um 84 %, während CSS und JavaScript unkomprimiert durchlaufen.

Bei Schrift und WebP ist „keine Kompression" korrekt: die Formate sind bereits
komprimiert.

**Warum das trotzdem selten weh tut:** Cloudflare komprimiert nach. Der Browser
bekommt das CSS als brotli mit 13 160 Bytes. Die Lücke kostet also nicht den
Besucher, sondern den Ursprungs-Hop — 67,8 KB statt ~13 KB bei jedem
Cache-Miss, und Cache-Misses gibt es nach jedem Deployment für jede neue
Chunk-URL.

### B2 — Die bestehende Kompressionsprüfung kann diesen Fehler nicht finden

`.github/workflows/perf-uptime.yml` prüft täglich, ob Assets komprimiert
ausgeliefert werden — aber gegen `$ZIEL`, also gegen die öffentliche Domain und
damit **gegen Cloudflare**. Die Prüfung ist grün, weil das CDN die Arbeit
übernimmt, die der eigene Server nicht tut.

Das ist der eigentliche Regime-Befund: Die Prüfung misst eine Schicht, die uns
nicht gehört, und ist gegenüber der Schicht, die uns gehört, blind. Eine
Messung, die bei kaputter eigener Konfiguration grün bleibt, prüft nichts.

### B3 — Brotli ist am Ursprung technisch nicht verfügbar

`nginx -V` im Proxy-Container zeigt OpenResty 1.29.2.5 mit `http_v2`, `http_v3`,
`gzip_static` und genau einem dynamischen Zusatzmodul: geoip2. **Kein brotli.**

Damit ist `deploy/nginx.conf.example` samt seinem `BROTLI-ANFANG`/`BROTLI-ENDE`-
Block und die brotli-Sonde in `bootstrap.sh` für diesen Betrieb gegenstandslos.
Sie beschreiben einen Host-nginx, den es nicht gibt.

### B4 — Der Ursprung sendet gzip ohne `Vary: Accept-Encoding`

Die Origin-Antwort auf `/` trägt `content-encoding: gzip`, aber nur
`vary: rsc, next-router-…` — kein `accept-encoding`. `gzip_vary` steht auf der
Voreinstellung `off`.

Cloudflare setzt sein eigenes `vary` und fängt es ab, deshalb ist heute nichts
kaputt. Korrekt ist es nicht: Jeder Zwischenspeicher, der diese Antwort ablegt,
darf sie einem Client ausliefern, der gar kein gzip angefragt hat.

### B5 — Jede öffentliche Seite ist `force-dynamic`

Sämtliche Seiten unter `src/app/(public)/` tragen `export const dynamic =
"force-dynamic"`. Folge: Next.js setzt
`Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`,
Cloudflare meldet konsequent `cf-cache-status: DYNAMIC`, und **jeder einzelne
Seitenaufruf** läuft bis in die Anwendung und in SQLite durch.

Das ist der mit Abstand größte Hebel des ganzen Systems — und zugleich der
einzige Befund, der eine Produktentscheidung berührt, keine Konfiguration:
Redaktionelle Änderungen sollen sofort sichtbar sein. Der Standardweg dafür
heißt nicht „dynamisch rendern", sondern **bedarfsgesteuerte Revalidierung**
(`revalidateTag` / `revalidatePath` nach dem Speichern im Admin-Bereich). Damit
bleibt die Sofortsichtbarkeit erhalten, und die Seite wird trotzdem cachebar.

Gemessene Mediane (7 Proben je Ebene, `time_starttransfer`):

| | Ursprung (NPM) | Rand (Cloudflare) |
|---|---:|---:|
| `/` | 41 ms | 85 ms |
| `/rezepte` | 41 ms | 80 ms |
| CSS | 10 ms | 47 ms |

Die 41 ms für HTML gegenüber 10 ms für eine Datei aus dem Dateisystem sind der
Preis für SSR plus gzip über 135 KB — bei **jeder** Anfrage.

### B6 — Die Anwendung sieht Cloudflare-Adressen statt Besucheradressen

Die Proxy-Konfiguration enthält 268 `set_real_ip_from`-Zeilen. Die
Stichprobe zeigt jedoch AWS-CloudFront-Bereiche (`54.230.…`, `65.9.…`,
`99.86.…`). Im Fehlerlog erscheinen die tatsächlichen Clients als
`client: 172.69.224.171`, `141.101.99.147` — das **sind** Cloudflare-Adressen.
Wären sie als vertrauenswürdig hinterlegt, stünde dort die Besucheradresse.

Betroffen ist alles, was auf Herkunft aufbaut: Zugriffsprotokolle,
Missbrauchserkennung und insbesondere die Newsletter-Ratenbegrenzung
(`EMAIL_RATE_PER_MINUTE`) — die derzeit alle Besucher hinter derselben
Cloudflare-Adresse in denselben Topf wirft.

### B7 — Der Ursprung ist unter seiner eigenen Adresse direkt erreichbar

`https://88.214.24.208/` mit SNI `gourmetcompass.de` antwortet mit **200**.
Wer die Adresse kennt, umgeht Cloudflare vollständig: WAF, Ratenbegrenzung,
Bot-Abwehr und Caching. Die ufw-Regeln öffnen 80/443 für „Anywhere".

Vorsicht bei der Behebung: Die Origin-Zertifikate stammen von Let's Encrypt.
Ob deren Erneuerung über Port 80 läuft und ob sie eine Einschränkung auf
Cloudflare-Bereiche überlebt, ist **vor** dem 31.10.2026 (Ablauf `npm-20`) zu
prüfen — nicht danach.

### B8 — `www.gourmetcompass.de` liefert 525

Cloudflare meldet „SSL handshake failed" zum Ursprung. Der Proxy-Host kennt nur
`server_name gourmetcompass.de`, und das Zertifikat trägt nur diesen einen Namen
(`X509v3 SAN: DNS:gourmetcompass.de`). Wer `www.` eintippt, sieht eine
Fehlerseite.

### B9 — Wahrscheinlich HTTP/1.0 zwischen Proxy und Anwendung

In der gesamten aktiven Konfiguration taucht **kein** `proxy_http_version` auf.
Die Voreinstellung ist 1.0 — ohne Keepalive, ohne Chunked-Transfer. Jede
Anfrage kostet einen neuen TCP-Aufbau zur Anwendung, und Streaming-Antworten
werden gepuffert.

Das ist zugleich die naheliegendste Hypothese für den wiederkehrenden
Anwendungsabsturz aus dem Journal:

```
⨯ uncaughtException: TypeError: Invalid state: ReadableStream is already closed
  code: 'ERR_INVALID_STATE'
```

React Server Components streamen. Eine Gegenstelle, die den Stream nach
HTTP/1.0-Regeln behandelt, schließt ihn früher als die Anwendung erwartet.
**Das ist eine Hypothese, keine Feststellung** — sie ist zu belegen, bevor
daraus eine Änderung wird.

### B10 — Aufräumbares

- Podman-Images: 5,996 GB, davon **4,757 GB (79 %) rückgewinnbar**.
- `/etc/nginx/conf.d/roses-kompression.conf` — wirkungslos, gehört gelöscht.
- `nginx.service` — `enabled` und `failed`; entweder deaktivieren oder die
  Pakete entfernen. So ist sie dauerhaftes Rauschen in jeder Zustandsprüfung.
- Das Fehlerlog des Proxys füllt sich mit
  `using uninitialized "trust_forwarded_proto" variable` — betrifft einen
  anderen Host auf demselben Proxy, macht aber unsere Fehler unauffindbar.

### B11 — Für dauerhafte Messung ist auf dem Server nichts vorhanden

Kein Lighthouse, kein k6, kein Prometheus, kein node_exporter. Und, wichtiger:
**kein `node`, kein `npm`, kein `npx`, kein `gh` auf dem Host.** Alles, was dort
dauerhaft messen soll, muss als Container laufen — anders ist es nicht
wartbar.

Vorhanden und nutzbar: `podman`, `zstd`, `jq`, `dig`, `openssl`, `sysstat`
(Timer läuft alle 10 Minuten), `podman-auto-update.timer`.

---

## 3. Plan

Die Reihenfolge folgt dem Verhältnis von Wirkung zu Risiko, nicht der
Nummerierung der Befunde. Jede Spur nennt das **Standardwerkzeug**, mit dem sie
umgesetzt wird — Maßarbeit nur dort, wo es keines gibt.

### Spur A — Die Erhebung wartbar machen (Voraussetzung für alles andere)

| | Schritt | Werkzeug |
|---|---|---|
| A1 | Erhebungsskript nach `scripts/regime/erhebung.sh` übernehmen, Port aus `podman ps` ableiten statt raten (§0) | vorhandenes Regime-Skriptverzeichnis |
| A2 | README §4, `docs/ABNAHME.md` und `deploy/nginx.conf.example` auf den tatsächlichen Betrieb umschreiben (NPM statt Host-nginx+certbot) | — |
| A3 | Brotli-Sonde und Brotli-Block aus `bootstrap.sh` / `nginx.conf.example` entfernen oder als „nur für Host-nginx-Betrieb" kennzeichnen (B3) | — |

A2 ist kein Schönheitsfehler: Solange die Doku einen anderen Server beschreibt,
ist der A-37-Drill nicht bestanden.

### Spur B — Die Prüfung dorthin richten, wo sie etwas findet

| | Schritt | Werkzeug |
|---|---|---|
| B1 | `perf-uptime.yml` misst Kompression zusätzlich **am Ursprung**, nicht nur am Rand (B2) | `curl --resolve`, wie in der Erhebung erprobt |
| B2 | Schwellen als Zahlen festhalten: HTML-Rohgröße, CSS/JS komprimiert am Ursprung, TTFB-Median je Ebene | `scripts/regime/lighthouse-budget.mjs` als Vorbild |

Ohne B1 bleibt jede Korrektur an der Proxy-Konfiguration ungeschützt: Sie kann
beim nächsten NPM-Update still verschwinden, ohne dass eine Ampel rot wird.

### Spur C — Ursprungskonfiguration (kleine Eingriffe, große Wirkung)

Alle über NPMs eigenen Mechanismus `/data/nginx/custom/` — eine Datei, kein
Image-Neubau, überlebt NPM-Updates.

| | Schritt | Wirkung |
|---|---|---|
| C1 | `gzip_types`, `gzip_vary on`, `gzip_comp_level`, `gzip_min_length` (B1, B4) | CSS 67,8 KB → ~13 KB je Cache-Miss |
| C2 | Cloudflare-Adressbereiche in `set_real_ip_from` + `real_ip_header CF-Connecting-IP` (B6) | Ratenbegrenzung und Protokolle werden wieder wahr |
| C3 | `proxy_http_version 1.1` + Keepalive — **erst nach Beleg** der Hypothese aus B9 | Latenz je Anfrage, evtl. der Absturz |
| C4 | Proxy-Host für `www.` samt Zertifikat (B8) | 525 verschwindet |

Zu C1 gehört eine Gegenprobe: Die NPM-Vorlage setzt `add_header` sowohl im
`server`- als auch im `location`-Block, weil ein `add_header` in `location`
alle geerbten verwirft. Wer dort später Header ergänzt, muss `server_proxy.conf`
nehmen, nicht `http_top.conf`.

### Spur D — Der große Hebel: cachebares HTML

| | Schritt | Werkzeug |
|---|---|---|
| D1 | Belegen, warum `force-dynamic` gesetzt wurde — Vermutung: Sofortsichtbarkeit redaktioneller Änderungen | — |
| D2 | Bedarfsgesteuerte Revalidierung in den Admin-Aktionen (`revalidatePath`) statt `force-dynamic` (B5) | Next.js-Bordmittel |
| D3 | Erst danach: Cloudflare-Regel, die HTML für anonyme Besucher zwischenspeichert | Cloudflare Cache Rules |

D2 ist eine echte Verhaltensänderung und gehört über das volle Gate,
seitenweise, mit E2E-Beleg dass eine Admin-Änderung sofort sichtbar bleibt.
**Nicht** in einem Zug mit Spur C.

### Spur E — Absicherung und Aufräumen

| | Schritt |
|---|---|
| E1 | ufw 80/443 auf Cloudflare-Bereiche einschränken (B7) — **vorher** Zertifikatserneuerung prüfen |
| E2 | `ReadableStream is already closed` untersuchen (B9); bis dahin ist es ein ungeklärter Absturz in Produktion |
| E3 | `/etc/nginx/conf.d/roses-kompression.conf` löschen, `nginx.service` deaktivieren (B10) |
| E4 | Podman-Aufräumroutine für die 4,76 GB rückgewinnbaren Ebenen (B10) |

### Spur F — Dauermessung

Erst sinnvoll, wenn C und D stehen — sonst misst man einen Zustand, den man
gerade ändert.

| | Schritt | Werkzeug |
|---|---|---|
| F1 | `scripts/regime/erhebung.sh` (A1) wöchentlich, Kennzahlen gegen die Schwellen aus B2 | vorhandener Workflow-Mechanismus |
| F2 | Host- und Containermetriken, falls dauerhaft nötig | node_exporter + cAdvisor als Container — Standardpaar, keine Eigenbauten |

---

## 4. Was ausdrücklich NICHT getan wird

**Brotli am Ursprung wird nicht nachgerüstet.** Das OpenResty-Image hat kein
Brotli-Modul (B3); nachrüsten hieße, ein eigenes OpenResty zu bauen und diesen
Build dauerhaft gegen Upstream-Änderungen zu pflegen. Der Nutzen wäre auf den
internen Hop Ursprung → Cloudflare begrenzt, denn der Browser bekommt sein
brotli bereits vom Rand. `gzip_types` ist eine Konfigurationszeile, Brotli wäre
eine Bau-Pipeline — für denselben Besucher, der davon nichts merkt. Das ist
genau die Grenze zwischen „tief angepasst" und „selbstgebaut und ungepflegt".

Sollte Cloudflare später wegfallen, kehrt diese Entscheidung zurück. Dann wird
sie neu getroffen, nicht stillschweigend vorweggenommen.
