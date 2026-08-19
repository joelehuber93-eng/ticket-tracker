import { useEffect, useState } from "react";
import type { CompetitorSite, SourceCategory } from "@price-tracker/shared";
import { api } from "../api";

const CATEGORY_LABELS: Record<SourceCategory, string> = {
  direct: "Direct Branson competitors",
  ota: "National / international OTAs",
  info: "Branson info & tourism sites",
  demo: "Demo sources (simulated)",
  other: "Other",
};

const CATEGORY_ORDER: SourceCategory[] = ["direct", "ota", "info", "demo", "other"];

function status(site: CompetitorSite): { label: string; className: string } {
  if (site.kind === "mock") return { label: "Simulated", className: "status-live" };
  if (!site.selector) {
    return site.kind === "api"
      ? { label: "Needs API integration", className: "status-pending" }
      : { label: "Needs selector", className: "status-pending" };
  }
  return { label: "Configured", className: "status-live" };
}

export function SourcesPanel() {
  const [sites, setSites] = useState<CompetitorSite[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.getSites().then(setSites).catch(console.error);
  }, []);

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    sites: sites.filter((s) => s.category === category),
  })).filter((g) => g.sites.length > 0);

  return (
    <details className="sources-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Competitor sources ({sites.length}) — {sites.filter((s) => !s.selector && s.kind !== "mock").length} need
        configuration
      </summary>
      {grouped.map(({ category, sites: group }) => (
        <div key={category} className="sources-group">
          <h3>{CATEGORY_LABELS[category]}</h3>
          <table className="sources-table">
            <tbody>
              {group.map((site) => {
                const st = status(site);
                return (
                  <tr key={site.id}>
                    <td className="sources-name">{site.name}</td>
                    <td>
                      <a href={site.targetUrl} target="_blank" rel="noreferrer">
                        {site.targetUrl.replace(/^https?:\/\//, "")}
                      </a>
                    </td>
                    <td>
                      <span className={`status-badge ${st.className}`}>{st.label}</span>
                    </td>
                    <td className="sources-notes">{site.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}
