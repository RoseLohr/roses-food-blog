#!/usr/bin/env node
/**
 * Betriebsalarm von AUSSERHALB der Anwendung.
 *
 * DER BEFUND (Gegenprüfung des Deploy-Pfads, Nr. 2): Startet der Container
 * nach einem Deploy gar nicht, erfährt es niemand. Der Selbst-Monitor
 * (`src/lib/observability.ts`) alarmiert zuverlässig — aber er läuft IN der
 * Anwendung. Ist die tot, ist auch der Alarm tot. Genau im schlimmsten Fall
 * schweigt die Meldekette.
 *
 * Dieses Skript ist deshalb eigenständig: Es liest die SMTP-Einstellungen
 * direkt aus `app.db` und verschickt die Nachricht selbst. Gefahren wird es
 * im bekannt guten Image (`:previous`), nicht im gerade gescheiterten.
 *
 *   node scripts/betriebsalarm.mjs "Betreff" "Text"       # DATA_DIR aus der Umgebung
 *
 * Rückgabe 0 auch dann, wenn NICHT verschickt wurde (kein SMTP hinterlegt) —
 * ein fehlender Alarmweg darf einen Rollback nicht zusätzlich blockieren. Was
 * geschehen ist, steht in jedem Fall auf der Ausgabe.
 */
import path from "node:path";

/**
 * Empfänger des Alarms. Dieselbe Rangfolge wie `alertRecipient()` in
 * src/lib/observability.ts — zwei Wege, dieselbe Antwort.
 */
export function empfaenger(einstellungen, env) {
  return (
    env.ALERT_EMAIL ||
    env.ADMIN_EMAIL ||
    einstellungen.smtp_from ||
    env.SMTP_FROM ||
    ""
  );
}

/** Ist überhaupt ein SMTP-Weg hinterlegt? */
export function smtpBereit(einstellungen, env) {
  return Boolean(einstellungen.smtp_host || env.SMTP_HOST);
}

/**
 * Was tun? Reine Entscheidung, damit sie prüfbar ist — ohne Datenbank, ohne
 * Netz. Der Aufrufer führt bloß aus, was hier herauskommt.
 */
export function alarmplan(einstellungen, env) {
  const an = empfaenger(einstellungen, env);
  if (!smtpBereit(einstellungen, env)) {
    return { verschicken: false, grund: "Kein SMTP-Host hinterlegt", an: "" };
  }
  if (!an) {
    return { verschicken: false, grund: "Kein Empfänger hinterlegt", an: "" };
  }
  return { verschicken: true, grund: "", an };
}

/** Die `setting`-Tabelle als schlichtes Objekt. Fehlt die Datei, ist sie leer. */
export function einstellungenLesen(datenverzeichnis, Database) {
  const datei = path.join(datenverzeichnis, "app.db");
  try {
    const db = new Database(datei, { readonly: true, fileMustExist: true });
    const zeilen = db.prepare("SELECT key, value FROM setting").all();
    db.close();
    return Object.fromEntries(zeilen.map((z) => [z.key, z.value]));
  } catch {
    // Ohne lesbare Datenbank bleibt die Umgebung als Quelle — genau der Fall,
    // in dem alarmiert werden soll. Ein Fehler hier darf den Alarm nicht
    // verhindern; er ist der Alarm.
    return {};
  }
}

async function hauptlauf() {
  const [betreff, text] = process.argv.slice(2);
  if (!betreff || !text) {
    console.error("Aufruf: node scripts/betriebsalarm.mjs <Betreff> <Text>");
    process.exit(2);
  }
  const datenverzeichnis = process.env.DATA_DIR || "/data";
  const { default: Database } = await import("better-sqlite3");
  const einstellungen = einstellungenLesen(datenverzeichnis, Database);
  const plan = alarmplan(einstellungen, process.env);
  if (!plan.verschicken) {
    console.log(`[betriebsalarm] NICHT verschickt: ${plan.grund}`);
    console.log(`[betriebsalarm] ${betreff}\n${text}`);
    return;
  }
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: einstellungen.smtp_host || process.env.SMTP_HOST,
    port: Number(einstellungen.smtp_port || process.env.SMTP_PORT || 587),
    secure: (einstellungen.smtp_secure || process.env.SMTP_SECURE) === "true",
    auth: einstellungen.smtp_user
      ? { user: einstellungen.smtp_user, pass: einstellungen.smtp_pass || "" }
      : undefined,
  });
  await transport.sendMail({
    from: einstellungen.smtp_from || process.env.SMTP_FROM || plan.an,
    to: plan.an,
    subject: betreff,
    text,
  });
  console.log(`[betriebsalarm] verschickt an ${plan.an}`);
}

// Nur ausführen, wenn direkt aufgerufen — als Modul importiert bleibt es still,
// damit die Tests die reinen Funktionen prüfen können.
if (process.argv[1] && process.argv[1].endsWith("betriebsalarm.mjs")) {
  hauptlauf().catch((e) => {
    console.error(`[betriebsalarm] Versand fehlgeschlagen: ${e.message}`);
    // Kein Abbruch mit ≠0: siehe Kopf.
  });
}
