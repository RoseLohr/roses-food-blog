"use client";

/**
 * Admin-Navigation (Desktop-Sidebar + mobiles Panel teilen sich diese
 * Komponente). Zwei Ebenen sind aufklappbar:
 *  - jeder Ober-Bereich mit Titel (Inhalte, Newsletter, Auswertung, System),
 *  - die Gruppe „Beiträge" innerhalb von „Inhalte".
 * Ein Bereich/eine Gruppe ist automatisch offen, wenn man sich gerade darin
 * befindet; der aktive Punkt wird hervorgehoben. Bereiche mit
 * `defaultCollapsed` (z. B. Newsletter) starten eingeklappt, sofern man nicht
 * gerade in ihnen navigiert.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface AdminNavItem {
  href: string;
  label: string;
}
export interface AdminNavEntry {
  label: string;
  /** Leaf: eigener Link. */
  href?: string;
  /** Aufklappbare Gruppe (z. B. „Beiträge"). */
  children?: AdminNavItem[];
}
export interface AdminNavSection {
  label?: string;
  entries: AdminNavEntry[];
  /** Startet eingeklappt (außer man ist gerade in diesem Bereich). */
  defaultCollapsed?: boolean;
}

const activeCls = "bg-leaf/10 font-medium text-leaf";
const idleCls = "text-ink-soft hover:bg-cream hover:text-ink";

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

function entryIsActive(entry: AdminNavEntry, pathname: string): boolean {
  if (entry.href) return isActivePath(pathname, entry.href);
  return (entry.children ?? []).some((c) => isActivePath(pathname, c.href));
}

/** Nach rechts weisender Pfeil, der beim Aufklappen um 90° rotiert. */
function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
        open ? "rotate-90" : ""
      } ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function CollapsibleGroup({
  entry,
  pathname,
  onNavigate,
}: {
  entry: AdminNavEntry;
  pathname: string;
  onNavigate?: () => void;
}) {
  const children = entry.children ?? [];
  const hasActiveChild = children.some((c) => isActivePath(pathname, c.href));
  const [open, setOpen] = useState(hasActiveChild);

  // Beim Navigieren in einen Unterpunkt die Gruppe offen halten.
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-sm ${
          hasActiveChild ? "font-medium text-leaf" : "text-ink-soft hover:bg-cream hover:text-ink"
        }`}
      >
        <Chevron open={open} className="h-3.5 w-3.5" />
        {entry.label}
      </button>
      {open && (
        <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-leaf/25 pl-2">
          {children.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                onClick={onNavigate}
                aria-current={isActivePath(pathname, c.href) ? "page" : undefined}
                className={`block px-3 py-1.5 text-sm ${
                  isActivePath(pathname, c.href) ? activeCls : idleCls
                }`}
              >
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Liste der Einträge eines Bereichs (Links + aufklappbare Gruppen). */
function NavEntries({
  entries,
  pathname,
  onNavigate,
}: {
  entries: AdminNavEntry[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) =>
        entry.children ? (
          <CollapsibleGroup
            key={entry.label}
            entry={entry}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ) : (
          <li key={entry.href}>
            <Link
              href={entry.href!}
              onClick={onNavigate}
              aria-current={isActivePath(pathname, entry.href!) ? "page" : undefined}
              className={`block px-3 py-1.5 text-sm ${
                isActivePath(pathname, entry.href!) ? activeCls : idleCls
              }`}
            >
              {entry.label}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

/** Aufklappbarer Ober-Bereich mit Titel (Inhalte, Newsletter, …). */
function CollapsibleSection({
  section,
  pathname,
  onNavigate,
}: {
  section: AdminNavSection;
  pathname: string;
  onNavigate?: () => void;
}) {
  const hasActive = section.entries.some((e) => entryIsActive(e, pathname));
  const [open, setOpen] = useState(hasActive || !section.defaultCollapsed);

  // Beim Navigieren in diesen Bereich offen halten (überschreibt defaultCollapsed).
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`mb-1 flex w-full items-center gap-1 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${
          hasActive ? "text-leaf" : "text-ink-soft/70 hover:text-ink"
        }`}
      >
        <Chevron open={open} className="h-3 w-3" />
        {section.label}
      </button>
      {open && (
        <NavEntries entries={section.entries} pathname={pathname} onNavigate={onNavigate} />
      )}
    </>
  );
}

export function AdminNav({
  sections,
  onNavigate,
}: {
  sections: AdminNavSection[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col">
      {sections.map((section, i) => (
        <div
          key={i}
          className="mt-3 border-t border-ink/5 pt-3 first:mt-0 first:border-t-0 first:pt-0"
        >
          {section.label ? (
            <CollapsibleSection
              section={section}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ) : (
            <NavEntries
              entries={section.entries}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          )}
        </div>
      ))}
    </div>
  );
}
