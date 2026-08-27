import { useState } from "react";
import { usePriceFeed } from "../hooks/usePriceFeed";
import { PriceTable } from "../components/PriceTable";
import { SourcesPanel } from "../components/SourcesPanel";
import { SummaryStats } from "../components/SummaryStats";
import { api } from "../api";

export function DashboardPage() {
  const { rows, connected, lastRun, flashKeys, rowKey } = usePriceFeed();
  const [running, setRunning] = useState(false);

  const handleRunNow = async () => {
    setRunning(true);
    try {
      await api.runCheckNow();
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="header-right dashboard-actions">
        <span className={`status-dot ${connected ? "online" : "offline"}`} />
        <span>{connected ? "Live" : "Disconnected"}</span>
        <button onClick={handleRunNow} disabled={running}>
          {running ? "Checking…" : "Run check now"}
        </button>
      </div>

      {lastRun && (
        <p className="last-run">
          Last run: {new Date(lastRun.finishedAt).toLocaleTimeString()} — {lastRun.checked} checked
          {lastRun.failed > 0 ? `, ${lastRun.failed} failed` : ""}
        </p>
      )}

      <SummaryStats rows={rows} />

      <div className="legend">
        <span className="legend-item sev-high dir-we_pricier">We're pricier (high)</span>
        <span className="legend-item sev-medium dir-we_pricier">We're pricier (med)</span>
        <span className="legend-item sev-none">Roughly matched</span>
        <span className="legend-item sev-medium dir-we_cheaper">We're cheaper (med)</span>
        <span className="legend-item sev-high dir-we_cheaper">We're cheaper (high)</span>
      </div>

      <p className="note">
        "Our Price" reflects ibranson.com's "tickets starting at" rate per show; actual price may vary by
        date and seating. "Real Price (1 ticket)" is a real add-to-cart total (taxes &amp; fees included)
        from the last time someone ran a checkout check on the "Checkout Pricing" tab — it doesn't
        auto-refresh, since each check launches a real headless browser.
      </p>

      <PriceTable rows={rows} flashKeys={flashKeys} rowKey={rowKey} />

      <SourcesPanel />
    </>
  );
}
