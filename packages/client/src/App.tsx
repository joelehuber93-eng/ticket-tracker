import { useState } from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { CheckoutPricingPage } from "./pages/CheckoutPricingPage";

const TABS = [
  { key: "dashboard", label: "Price Dashboard" },
  { key: "checkout", label: "Checkout Pricing" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function App() {
  const [tab, setTab] = useState<TabKey>("dashboard");

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>iBranson Competitor Price Tracker</h1>
          <p className="subtitle">
            {tab === "dashboard"
              ? "ibranson.com show pricing vs. Branson-area & national competitors, updated automatically."
              : "All-in ticket totals (incl. taxes & fees) for ibranson.com, by number of tickets."}
          </p>
        </div>
      </header>

      <nav className="tab-nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-button ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "dashboard" ? <DashboardPage /> : <CheckoutPricingPage />}
    </div>
  );
}
