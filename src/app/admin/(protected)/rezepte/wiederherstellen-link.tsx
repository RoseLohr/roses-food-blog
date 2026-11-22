"use client";

/**
 * Der Link „Wiederherstellen" im Angebot eines Zwischenstands — erst bedienbar,
 * wenn er eingehängt ist.
 *
 * Der Server liefert nur den Anker; die Felder des Formulars daneben sind aber
 * schon bedienbar, bevor das Skript da ist. Wer in diesem Fenster tippt und
 * den Link anklickt, lädt die Seite mit dem Zwischenstand neu, und das
 * Getippte ist ersetzt — ohne dass der Editor davon wüsste oder etwas dazu
 * sagen könnte: Was er an den Klick hängt, hängt erst mit dem Skript daran.
 * Deshalb ist der Link so lange `inert`: nicht anklickbar, nicht fokussierbar,
 * für Vorleseprogramme nicht da. Die Adresse steht trotzdem im ausgelieferten
 * HTML.
 *
 * Eine eigene Datei mit "use client": Der Baustein daneben
 * (zwischenstand-hinweis.tsx) bleibt ohne Hook und damit von jeder Seite aus
 * verwendbar, auch von einer, die nur auf dem Server rendert.
 */
import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";

/** Es gibt nichts zu abonnieren: Der Wert wechselt genau einmal, mit dem Einhängen. */
const nichtsZuAbonnieren = () => () => {};

/** `beimKlick`: vor dem Folgen des Links — der Editor fragt dort nach, wenn er Ungespeichertes hält, und kann ablehnen. */
export function WiederherstellenLink(props: { adresse: string; beimKlick?: (e: MouseEvent<HTMLAnchorElement>) => void; children: ReactNode }) {
  // Auf dem Server und beim Hydrieren nein, danach ja — ohne Zustand, den ein Effekt setzen müsste.
  // Der Wechsel kommt mit DIESEM Baustein: Bedienbar wird der Link, sobald sein eigenes Skript läuft.
  const eingehaengt = useSyncExternalStore(
    nichtsZuAbonnieren,
    () => true,
    () => false,
  );
  return (
    <a href={props.adresse} onClick={props.beimKlick} inert={!eingehaengt} className="font-semibold underline-offset-2 hover:underline">
      {props.children}
    </a>
  );
}
