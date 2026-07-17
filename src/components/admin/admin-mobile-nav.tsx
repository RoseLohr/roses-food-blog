"use client";

/**
 * Mobiles Admin-Menü: klappt nach der Auswahl eines Menüpunkts (und bei
 * jedem Routenwechsel) automatisch wieder ein. Nutzt dieselbe AdminNav wie
 * die Desktop-Sidebar (inkl. aufklappbarer Gruppe „Beiträge").
 */
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminNav, type AdminNavSection } from "@/components/admin/admin-nav";

export function AdminMobileNav({
  sections,
  label,
  menuLabel,
}: {
  sections: AdminNavSection[];
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
          className="absolute z-20 mt-1 max-h-[80vh] w-60 overflow-y-auto border border-ink/10 bg-white p-3 shadow-lg"
        >
          <AdminNav sections={sections} onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}
