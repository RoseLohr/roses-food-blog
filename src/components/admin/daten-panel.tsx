"use client";

/**
 * Interaktiver Teil der Daten-Seite: Import (ZIP hochladen) und Löschen
 * (mit Tippbestätigung). Der Export ist ein einfacher GET-Download und braucht
 * kein JavaScript (siehe page.tsx).
 */
import { useState } from "react";
import { t } from "@/i18n/de";

const d = t().admin.data;

type Scope = "all" | "recipes" | "travel" | "pages";

interface Counts {
  recipes: number;
  travel: number;
  pages: number;
}

interface ImportResult {
  recipes: number;
  travel: number;
  pages: number;
  imagesCreated: number;
  imagesMissing: number;
  ingredientsCreated: number;
  warnings: string[];
}

interface DeleteResult {
  recipes: number;
  travel: number;
  pages: number;
  pagesProtectedKept: number;
  ingredientsRemoved: number;
  imagesRemoved: number;
}

function fill(tpl: string, vars: Record<string, number | string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export function DatenPanel({ counts }: { counts: Counts }) {
  // ---- Import ----
  const [file, setFile] = useState<File | null>(null);
  const [impTypes, setImpTypes] = useState({
    recipes: true,
    travel: true,
    pages: true,
  });
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setImportMsg(null);
    setImportResult(null);
    setImportErr(false);
    if (!file) {
      setImportErr(true);
      setImportMsg(d.importNoFile);
      return;
    }
    if (!impTypes.recipes && !impTypes.travel && !impTypes.pages) {
      setImportErr(true);
      setImportMsg(d.importNoType);
      return;
    }
    const body = new FormData();
    body.set("datei", file);
    body.set("recipes", impTypes.recipes ? "1" : "0");
    body.set("travel", impTypes.travel ? "1" : "0");
    body.set("pages", impTypes.pages ? "1" : "0");

    setImporting(true);
    try {
      const res = await fetch("/api/admin/daten/import", {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setImportErr(true);
        setImportMsg(
          typeof data.error === "string" && data.error.length > 3
            ? data.error
            : d.importFailed,
        );
      } else {
        setImportResult(data.result as ImportResult);
        setImportMsg(d.importDone);
      }
    } catch {
      setImportErr(true);
      setImportMsg(d.importFailed);
    } finally {
      setImporting(false);
    }
  }

  // ---- Löschen ----
  const [delScope, setDelScope] = useState<Scope>("recipes");
  const [confirmWord, setConfirmWord] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState(false);
  const [deleteResult, setDeleteResult] = useState<DeleteResult | null>(null);

  const affected = (() => {
    const r = delScope === "all" || delScope === "recipes" ? counts.recipes : 0;
    const tr = delScope === "all" || delScope === "travel" ? counts.travel : 0;
    const p = delScope === "all" || delScope === "pages" ? counts.pages : 0;
    return { recipes: r, travel: tr, pages: p };
  })();

  const confirmOk = confirmWord.trim() === d.deleteConfirmWord;

  async function runDelete(e: React.FormEvent) {
    e.preventDefault();
    setDeleteMsg(null);
    setDeleteResult(null);
    setDeleteErr(false);
    if (!confirmOk) return;

    setDeleting(true);
    try {
      const res = await fetch("/api/admin/daten/loeschen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: delScope, confirm: confirmWord.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setDeleteErr(true);
        setDeleteMsg(d.deleteFailed);
      } else {
        setDeleteResult(data.result as DeleteResult);
        setDeleteMsg(d.deleteDone);
        setConfirmWord("");
      }
    } catch {
      setDeleteErr(true);
      setDeleteMsg(d.deleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  const box = "bg-white p-5 shadow-sm";
  const label = "block text-sm font-medium";
  const checkboxRow = "flex items-center gap-2 text-sm";

  return (
    <div className="space-y-6">
      {/* IMPORT */}
      <section className={box} aria-labelledby="import-h">
        <h2 id="import-h" className="mb-1 text-lg font-semibold">
          {d.importTitle}
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-ink-soft">{d.importIntro}</p>

        <details className="mb-4 border border-ink/10 bg-cream/40 p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {d.importFormatTitle}
          </summary>
          <p className="mt-2 text-ink-soft">{d.importFormatBody}</p>
        </details>

        <form onSubmit={runImport} className="space-y-4">
          <div>
            <label htmlFor="import-file" className={label}>
              {d.importFile}
            </label>
            <input
              id="import-file"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm file:mr-3 file:border file:border-ink/20 file:bg-cream file:px-3 file:py-1.5 file:text-sm"
            />
          </div>

          <fieldset>
            <legend className={label}>{d.importWhat}</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              <label className={checkboxRow}>
                <input
                  type="checkbox"
                  checked={impTypes.recipes}
                  onChange={(e) =>
                    setImpTypes((s) => ({ ...s, recipes: e.target.checked }))
                  }
                />
                {d.typeRecipes}
              </label>
              <label className={checkboxRow}>
                <input
                  type="checkbox"
                  checked={impTypes.travel}
                  onChange={(e) =>
                    setImpTypes((s) => ({ ...s, travel: e.target.checked }))
                  }
                />
                {d.typeTravel}
              </label>
              <label className={checkboxRow}>
                <input
                  type="checkbox"
                  checked={impTypes.pages}
                  onChange={(e) =>
                    setImpTypes((s) => ({ ...s, pages: e.target.checked }))
                  }
                />
                {d.typePages}
              </label>
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={importing}
            className="bg-leaf px-4 py-2 text-sm font-medium text-white hover:bg-leaf/90 disabled:opacity-60"
          >
            {importing ? d.importing : d.importButton}
          </button>
        </form>

        {importMsg && (
          <p
            className={`mt-3 text-sm ${importErr ? "text-red-700" : "text-leaf"}`}
            role="status"
          >
            {importMsg}
          </p>
        )}
        {importResult && (
          <div className="mt-2 text-sm text-ink-soft">
            <p>
              {fill(d.importResult, {
                recipes: importResult.recipes,
                travel: importResult.travel,
                pages: importResult.pages,
                images: importResult.imagesCreated,
                ingredients: importResult.ingredientsCreated,
              })}
            </p>
            {importResult.imagesMissing > 0 && (
              <p className="mt-1 text-amber-700">
                {fill(d.importMissingImages, { n: importResult.imagesMissing })}
              </p>
            )}
          </div>
        )}
      </section>

      {/* LÖSCHEN */}
      <section
        className="border border-red-200 bg-white p-5 shadow-sm"
        aria-labelledby="delete-h"
      >
        <h2 id="delete-h" className="mb-1 text-lg font-semibold text-red-800">
          {d.deleteTitle}
        </h2>
        <p className="mb-3 max-w-2xl text-sm text-ink-soft">{d.deleteIntro}</p>
        <p className="mb-4 border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {d.deleteWarn}
        </p>

        <form onSubmit={runDelete} className="space-y-4">
          <div>
            <label htmlFor="del-scope" className={label}>
              {d.deleteScope}
            </label>
            <select
              id="del-scope"
              value={delScope}
              onChange={(e) => setDelScope(e.target.value as Scope)}
              className="mt-1 block w-full max-w-xs border border-ink/20 bg-white px-3 py-2 text-sm"
            >
              <option value="recipes">{d.scopeRecipes}</option>
              <option value="travel">{d.scopeTravel}</option>
              <option value="pages">{d.scopePages}</option>
              <option value="all">{d.scopeAll}</option>
            </select>
          </div>

          <p className="text-sm text-ink-soft">
            {fill(d.deleteCountHint, affected)}
          </p>

          <div>
            <label htmlFor="del-confirm" className={label}>
              {d.deleteConfirmLabel}
            </label>
            <input
              id="del-confirm"
              type="text"
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              autoComplete="off"
              className="mt-1 block w-full max-w-xs border border-ink/20 bg-white px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={!confirmOk || deleting}
            className="bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? d.deleting : d.deleteButton}
          </button>
        </form>

        {deleteMsg && (
          <p
            className={`mt-3 text-sm ${deleteErr ? "text-red-700" : "text-leaf"}`}
            role="status"
          >
            {deleteMsg}
          </p>
        )}
        {deleteResult && (
          <p className="mt-2 text-sm text-ink-soft">
            {fill(d.deleteResult, {
              recipes: deleteResult.recipes,
              travel: deleteResult.travel,
              pages: deleteResult.pages,
              ingredients: deleteResult.ingredientsRemoved,
              images: deleteResult.imagesRemoved,
            })}
          </p>
        )}
      </section>
    </div>
  );
}
