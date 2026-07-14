"use client";

/**
 * Mobiles Admin-Menü: klappt nach der Auswahl eines Menüpunkts (und bei
 * jedem Routenwechsel) automatisch wieder ein.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function AdminMobileNav({
  groups,
  label,
  menuLabel,
}: {
  groups: Array<{ label: string; items: Array<[string, string]> }>;
  label: string;
  menuLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="cursor-pointer px-2 py-1 text-sm font-semibold text-ink"
      >
        {menuLabel}
      </button>
      {open && (
        <nav
          aria-label={label}
          className="absolute z-20 mt-1 max-h-[80vh] overflow-y-auto border border-ink/10 bg-white p-3 shadow-lg"
        >
          {groups.map((group, i) => (
            <div key={i} className="mb-2 last:mb-0">
              {group.label && (
                <p className="px-2 pb-0.5 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-soft/70">
                  {group.label}
                </p>
              )}
              {group.items.map(([href, itemLabel]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="block px-2 py-1 text-sm"
                >
                  {itemLabel}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
