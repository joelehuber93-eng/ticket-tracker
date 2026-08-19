import type { DashboardRow } from "../api";
import type { DisparityInfo } from "@price-tracker/shared";

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

export function PriceTable({ rows, flashKeys, rowKey }: Props) {
  const sorted = [...rows].sort((a, b) => {
    if (a.product.name !== b.product.name) return a.product.name.localeCompare(b.product.name);
    return a.site.name.localeCompare(b.site.name);
  });

  return (
    <table className="price-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>Our Price</th>
          <th>Competitor</th>
          <th>Their Price</th>
          <th>Delta</th>
          <th>Delta %</th>
          <th>Last Checked</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          const key = rowKey(row.product.id, row.site.id);
          const isFlashing = flashKeys.has(key);
          const priceKnown = row.latest?.ok && row.latest.price != null;
          return (
            <tr key={key} className={`${severityClass(row.disparity)} ${isFlashing ? "flash" : ""}`}>
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
        {sorted.length === 0 && (
          <tr>
            <td colSpan={7} className="empty">
              No tracked products yet. Run the seed script to load demo data.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
