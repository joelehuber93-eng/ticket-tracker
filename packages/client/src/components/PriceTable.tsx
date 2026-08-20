import { useMemo, useState } from "react";
import type { DashboardRow } from "../api";
import type { DisparityInfo } from "@price-tracker/shared";
import { MultiSelect } from "./MultiSelect";

interface Props {
  rows: DashboardRow[];
  flashKeys: Set<string>;
  rowKey: (productId: string, siteId: string) => string;
}

function severityClass(disparity: DisparityInfo | null): string {
  if (!disparity || disparity.severity === "none") return "sev-none";
  return `sev-${disparity.severity} dir-${disparity.direction}`;
}

function formatMoney(value: number | null | undefined, currency: string): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

// A competitor's listing page was reached fine, it just doesn't carry this
// particular show — not a fetch/scrape failure, so it's not worth a row.
// See priceChecker.ts, which produces this exact message when a "listing"/
// "browser" site's page has no card matching a linked product by name.
function isNotInCatalog(error: string | null | undefined): boolean {
  return !!error && error.startsWith("No listing entry matched");
}

type SortKey = "product" | "ourPrice" | "site" | "theirPrice" | "delta" | "deltaPercent" | "lastChecked";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "product", label: "Product" },
  { key: "ourPrice", label: "Our Price" },
  { key: "site", label: "Competitor" },
  { key: "theirPrice", label: "Their Price" },
  { key: "delta", label: "Delta" },
  { key: "deltaPercent", label: "Delta %" },
  { key: "lastChecked", label: "Last Checked" },
];

/** Sort value for a row, per column. Strings sort locale-aware; numbers sort
 * with unknown (null) values always pushed to the bottom regardless of
 * direction, so an empty/unfetched cell never floats to the top of "desc". */
function sortValue(row: DashboardRow, key: SortKey): string | number | null {
  switch (key) {
    case "product":
      return row.product.name;
    case "ourPrice":
      return row.product.ourPrice;
    case "site":
      return row.site.name;
    case "theirPrice":
      return row.latest?.ok ? row.latest.price : null;
    case "delta":
      return row.disparity ? row.disparity.deltaAbsolute : null;
    case "deltaPercent":
      return row.disparity ? row.disparity.deltaPercent : null;
    case "lastChecked":
      return row.latest ? new Date(row.latest.fetchedAt).getTime() : null;
  }
}

function compareRows(a: DashboardRow, b: DashboardRow, key: SortKey, dir: SortDir): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb) : (va as number) - (vb as number);
  return dir === "asc" ? cmp : -cmp;
}

export function PriceTable({ rows, flashKeys, rowKey }: Props) {
  const [productFilter, setProductFilter] = useState<Set<string>>(new Set());
  const [siteFilter, setSiteFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("product");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const productNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.product.name))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );
  const siteNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.site.name))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const visible = rows
    .filter((row) => !isNotInCatalog(row.latest?.error))
    .filter((row) => productFilter.size === 0 || productFilter.has(row.product.name))
    .filter((row) => siteFilter.size === 0 || siteFilter.has(row.site.name))
    .sort((a, b) => {
      const primary = compareRows(a, b, sortKey, sortDir);
      if (primary !== 0) return primary;
      // Stable, predictable tie-break so rows with equal sort values don't
      // jump around between re-renders (e.g. two rows both "no delta yet").
      return compareRows(a, b, "product", "asc") || compareRows(a, b, "site", "asc");
    });

  return (
    <>
      <div className="table-filters">
        <div className="filter-field">
          <span className="filter-label">Shows</span>
          <MultiSelect label="shows" options={productNames} selected={productFilter} onChange={setProductFilter} />
        </div>
        <div className="filter-field">
          <span className="filter-label">Competitors</span>
          <MultiSelect label="competitors" options={siteNames} selected={siteFilter} onChange={setSiteFilter} />
        </div>
        {(productFilter.size > 0 || siteFilter.size > 0) && (
          <button
            type="button"
            className="clear-filters"
            onClick={() => {
              setProductFilter(new Set());
              setSiteFilter(new Set());
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <table className="price-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key}>
                <button type="button" className="sort-button" onClick={() => handleSort(col.key)}>
                  {col.label}
                  {sortKey === col.key && <span className="sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const key = rowKey(row.product.id, row.site.id);
            const isFlashing = flashKeys.has(key);
            const priceKnown = row.latest?.ok && row.latest.price != null;
            return (
              <tr
                key={key}
                className={`${severityClass(row.disparity)} ${isFlashing ? "flash" : ""} ${row.priceChanged ? "row-changed" : ""}`}
              >
                <td>
                  <div className="product-name">{row.product.name}</div>
                  <div className="product-sku">{row.product.sku}</div>
                </td>
                <td>{formatMoney(row.product.ourPrice, row.product.currency)}</td>
                <td>{row.site.name}</td>
                <td>
                  {priceKnown
                    ? formatMoney(row.latest!.price, row.latest!.currency)
                    : row.latest?.error
                      ? <span className="error" title={row.latest.error}>fetch failed</span>
                      : "—"}
                  {row.priceChanged && (
                    <span className="changed-badge" title="Price moved from what it was ~24h ago">
                      changed
                    </span>
                  )}
                </td>
                <td>{row.disparity ? formatMoney(row.disparity.deltaAbsolute, row.product.currency) : "—"}</td>
                <td>
                  {row.disparity ? (
                    <span className="badge">
                      {row.disparity.deltaPercent > 0 ? "+" : ""}
                      {row.disparity.deltaPercent.toFixed(1)}%
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="timestamp">
                  {row.latest ? new Date(row.latest.fetchedAt).toLocaleTimeString() : "—"}
                </td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                {rows.length === 0
                  ? "No tracked products yet. Run the seed script to load demo data."
                  : "No rows match the current filters."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
