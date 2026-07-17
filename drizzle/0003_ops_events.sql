-- B-03/A-24: Betriebs-Ereignisse (Golden Signals) für Observability + SLO.
-- Schlanke, maschinen-abfragbare Persistenz: Fehler, Requests, Health-Checks
-- und ausgelöste Alerts. Kein Personenbezug (keine IP, kein Nutzer).
CREATE TABLE `ops_event` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,               -- 'error' | 'request' | 'health' | 'alert'
  `route` text,                        -- Pfad/Route (grob), optional
  `status` integer,                    -- HTTP-Status bzw. 0/1 bei health
  `duration_ms` integer,               -- Latenz, optional
  `detail` text,                       -- kurze Fehlermeldung/Notiz (gekürzt)
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ops_event_time_idx` ON `ops_event` (`created_at`);
--> statement-breakpoint
CREATE INDEX `ops_event_kind_idx` ON `ops_event` (`kind`,`created_at`);
