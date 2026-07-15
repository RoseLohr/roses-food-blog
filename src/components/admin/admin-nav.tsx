"use client";

/**
 * Admin-Navigation (Desktop-Sidebar + mobiles Panel teilen sich diese
 * Komponente). Unterstützt aufklappbare Gruppen wie „Beiträge": ein Klick auf
 * die Gruppe zeigt/versteckt die Unterpunkte. Eine Gruppe ist automatisch
 * offen, wenn man gerade in einem ihrer Bereiche ist; der aktive Punkt wird
 * hervorgehoben.
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
}

const activeCls = "bg-leaf/10 font-medium text-leaf";
const idleCls = "text-ink-soft hover:bg-cream hover:text-ink";

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
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
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
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
          {section.label && (
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-ink-soft/70">
              {section.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.entries.map((entry) =>
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
                    aria-current={
                      isActivePath(pathname, entry.href!) ? "page" : undefined
                    }
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
        </div>
      ))}
    </div>
  );
}
