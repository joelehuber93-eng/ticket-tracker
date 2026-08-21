import { useMemo } from "react";
import type { DashboardRow } from "../api";

interface Props {
  rows: DashboardRow[];
}

interface Stat {
  key: string;
  label: string;
  value: string;
  caption?: string;
  tone?: "good" | "bad" | "neutral";
}

function formatMoney(value: number, currency: string): string {
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(value));
  return value < 0 ? `-${formatted}` : `+${formatted}`;
}

// Unsigned — used for magnitudes (an average doesn't have one direction).
function formatMoneyMagnitude(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(value));
}

export function SummaryStats({ rows }: Props) {
  const stats = useMemo<Stat[]>(() => {
    // Only rows where we actually have both prices to compare — a fetch
    // failure or a show a competitor doesn't carry has nothing to compute.
    const comparable = rows.filter((r) => r.disparity != null);
    const total = comparable.length;

    if (total === 0) {
      return [
        { key: "total", label: "Total line items", value: "0" },
        { key: "beaten", label: "Beaten by rivals", value: "—" },
        { key: "winning", label: "We beat rivals", value: "—" },
        { key: "avg", label: "Average gap", value: "—" },
        { key: "biggest", label: "Biggest single gap", value: "—" },
      ];
    }

    const beatenByRivals = comparable.filter((r) => r.disparity!.direction === "we_pricier").length;
    const weBeatRivals = comparable.filter((r) => r.disparity!.direction === "we_cheaper").length;

    const avgGapDollars =
      comparable.reduce((sum, r) => sum + Math.abs(r.disparity!.deltaAbsolute), 0) / total;
    const avgCurrency = comparable[0].product.currency;

    const biggest = comparable.reduce((max, r) =>
      Math.abs(r.disparity!.deltaAbsolute) > Math.abs(max.disparity!.deltaAbsolute) ? r : max
    );

    return [
      { key: "total", label: "Total line items", value: total.toLocaleString("en-US") },
      {
        key: "beaten",
        label: "Beaten by rivals",
        value: beatenByRivals.toLocaleString("en-US"),
        caption: `${((beatenByRivals / total) * 100).toFixed(0)}% of comparisons`,
        tone: "bad",
      },
      {
        key: "winning",
        label: "We beat rivals",
        value: weBeatRivals.toLocaleString("en-US"),
        caption: `${((weBeatRivals / total) * 100).toFixed(0)}% of comparisons`,
        tone: "good",
      },
      {
        key: "avg",
        label: "Average gap",
        value: formatMoneyMagnitude(avgGapDollars, avgCurrency),
        caption: "across all comparisons",
      },
      {
        key: "biggest",
        label: "Biggest single gap",
        value: formatMoney(biggest.disparity!.deltaAbsolute, biggest.product.currency),
        caption: `${biggest.product.name} vs ${biggest.site.name}`,
        tone: biggest.disparity!.direction === "we_pricier" ? "bad" : "good",
      },
    ];
  }, [rows]);

  return (
    <div className="summary-stats">
      {stats.map((stat) => (
        <div key={stat.key} className={`stat-tile ${stat.tone ? `tone-${stat.tone}` : ""}`}>
          <div className="stat-label">{stat.label}</div>
          <div className="stat-value">{stat.value}</div>
          {stat.caption && <div className="stat-caption">{stat.caption}</div>}
        </div>
      ))}
    </div>
  );
}
