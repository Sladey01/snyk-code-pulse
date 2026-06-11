/** Pick-your-fields CSV/JSON export. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[], fields: string[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [fields.join(","), ...rows.map((r) => fields.map((f) => esc(r[f])).join(","))].join("\n");
  triggerDownload(filename, csv, "text/csv");
}

export function downloadJson(filename: string, rows: unknown) {
  triggerDownload(filename, JSON.stringify(rows, null, 2), "application/json");
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
