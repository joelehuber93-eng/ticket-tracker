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

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
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

    const avgGapPercent =
      comparable.reduce((sum, r) => sum + Math.abs(r.disparity!.deltaPercent), 0) / total;

    const biggest = comparable.reduce((max, r) =>
      Math.abs(r.disparity!.deltaPercent) > Math.abs(max.disparity!.deltaPercent) ? r : max
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
        value: `${avgGapPercent.toFixed(1)}%`,
        caption: "across all comparisons",
      },
      {
        key: "biggest",
        label: "Biggest single gap",
        value: formatPercent(biggest.disparity!.deltaPercent),
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
