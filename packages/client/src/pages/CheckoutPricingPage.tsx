import { useEffect, useMemo, useState } from "react";
import type { CheckoutQuote, CheckoutTarget, Product } from "@price-tracker/shared";
import { api } from "../api";

function formatMoney(value: number | null, currency: string): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

function perTicket(q: CheckoutQuote): number | null {
  return q.ok && q.total != null ? q.total / q.quantity : null;
}

export function CheckoutPricingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [targets, setTargets] = useState<CheckoutTarget[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(2);
  const [quotes, setQuotes] = useState<CheckoutQuote[]>([]);
  const [currentQuote, setCurrentQuote] = useState<CheckoutQuote | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Only products with our own checkoutUrl are listable for now — a product
  // that's ONLY configured for a competitor (no ibranson.com checkoutUrl of
  // its own) isn't a real case yet, since no competitor is wired up.
  const eligibleProducts = useMemo(() => products.filter((p) => p.checkoutUrl), [products]);
  const selectedProduct = eligibleProducts.find((p) => p.id === selectedProductId) ?? null;
  const selectedTarget = targets.find((t) => t.competitorSiteId === selectedSiteId) ?? null;

  useEffect(() => {
    api.getProducts().then((all) => {
      setProducts(all);
      setProductsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!selectedProductId && eligibleProducts.length > 0) {
      setSelectedProductId(eligibleProducts[0].id);
    }
  }, [eligibleProducts, selectedProductId]);

  useEffect(() => {
    if (!selectedProductId) {
      setTargets([]);
      setQuotes([]);
      setCurrentQuote(null);
      return;
    }
    api.getCheckoutTargets(selectedProductId).then((t) => {
      setTargets(t);
      // competitorSiteId is null for "ourselves" — matches by identity fine
      // here since it's always literally null, not a fresh object.
      if (!t.some((target) => target.competitorSiteId === selectedSiteId)) {
        setSelectedSiteId(t[0]?.competitorSiteId ?? null);
      }
    });
    api.getCheckoutQuotes(selectedProductId).then(setQuotes);
    setCurrentQuote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductId]);

  // Whatever the latest stored quote is for the selected site — so picking
  // a site you've already run something for shows that result without
  // needing to run it again. Only ever one attempt shown, never a history.
  useEffect(() => {
    const latest = quotes.find((q) => q.competitorSiteId === selectedSiteId) ?? null;
    setCurrentQuote(latest);
  }, [quotes, selectedSiteId]);

  // The most recent successful ibranson.com quote at the SAME quantity as
  // the currently displayed attempt — the baseline "+/- ibranson.com" is
  // measured against. Only meaningful when viewing a competitor's row.
  const comparisonQuote = useMemo(() => {
    if (!currentQuote || currentQuote.competitorSiteId === null) return null;
    return (
      quotes.find((q) => q.competitorSiteId === null && q.quantity === currentQuote.quantity && q.ok) ?? null
    );
  }, [quotes, currentQuote]);

  const handleRun = async () => {
    if (!selectedProductId) return;
    setRunning(true);
    setRunError(null);
    try {
      const quote = await api.runCheckoutQuote(selectedProductId, selectedSiteId, quantity);
      setCurrentQuote(quote);
      setQuotes((prev) => [quote, ...prev.filter((q) => q.id !== quote.id)]);
      if (!quote.ok) setRunError(quote.error ?? "Checkout run failed");
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Checkout run failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <p className="note checkout-intro">
        Drives a real add-to-cart → cart checkout to discover the all-in total (including taxes &amp;
        fees) for a given number of tickets — the "starting at" rate on the dashboard doesn't include
        those. Each run launches a real headless browser, so this is manual, not on the auto-refresh
        cycle.
      </p>

      {!productsLoaded ? (
        <p className="empty">Loading products…</p>
      ) : eligibleProducts.length === 0 ? (
        <p className="empty">
          No products have a checkoutUrl configured yet — set one on a Product to pilot this.
        </p>
      ) : (
        <>
          <div className="table-filters checkout-controls">
            <div className="filter-field">
              <label className="filter-label" htmlFor="checkout-product">
                Show
              </label>
              <select
                id="checkout-product"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
              >
                {eligibleProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label className="filter-label" htmlFor="checkout-site">
                Site
              </label>
              <select
                id="checkout-site"
                value={selectedSiteId ?? ""}
                onChange={(e) => setSelectedSiteId(e.target.value || null)}
              >
                {targets.map((t) => (
                  <option key={t.competitorSiteId ?? "self"} value={t.competitorSiteId ?? ""}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label className="filter-label" htmlFor="checkout-quantity">
                Tickets
              </label>
              <input
                id="checkout-quantity"
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
            </div>
            <button onClick={handleRun} disabled={running || !selectedProductId || !selectedTarget}>
              {running ? "Checking out…" : "Get all-in price"}
            </button>
          </div>

          {runError && <p className="error checkout-error">{runError}</p>}

          <table className="price-table">
            <thead>
              <tr>
                <th className="static-th">Site</th>
                <th className="static-th">Tickets</th>
                <th className="static-th">Subtotal</th>
                <th className="static-th">Taxes &amp; fees</th>
                <th className="static-th">All-in total</th>
                <th className="static-th">Per ticket (all-in)</th>
                <th className="static-th">+/- ibranson.com</th>
                <th className="static-th">Checked</th>
              </tr>
            </thead>
            <tbody>
              {!currentQuote && (
                <tr>
                  <td colSpan={8} className="empty">
                    No checkout run yet for {selectedProduct?.name ?? "this show"} on{" "}
                    {selectedTarget?.name ?? "this site"} — click "Get all-in price" above.
                  </td>
                </tr>
              )}
              {currentQuote &&
                (() => {
                  const isSelf = currentQuote.competitorSiteId === null;
                  const displayedPerTicket = perTicket(currentQuote);
                  const ibransonPerTicket = comparisonQuote ? perTicket(comparisonQuote) : null;
                  // "+/- ibranson.com": positive = this site costs more than
                  // ibranson.com (good for us, we're cheaper) — same
                  // red/green convention as the dashboard's we_pricier/
                  // we_cheaper coloring.
                  const delta =
                    !isSelf && displayedPerTicket != null && ibransonPerTicket != null
                      ? displayedPerTicket - ibransonPerTicket
                      : null;
                  const siteName =
                    targets.find((t) => t.competitorSiteId === currentQuote.competitorSiteId)?.name ??
                    (isSelf ? "iBranson (ourselves)" : "Unknown site");
                  return (
                    <tr key={currentQuote.id}>
                      <td>{siteName}</td>
                      <td>{currentQuote.quantity}</td>
                      <td>{currentQuote.ok ? formatMoney(currentQuote.subtotal, currentQuote.currency) : "—"}</td>
                      <td>{currentQuote.ok ? formatMoney(currentQuote.taxesFees, currentQuote.currency) : "—"}</td>
                      <td>
                        <strong>{currentQuote.ok ? formatMoney(currentQuote.total, currentQuote.currency) : "—"}</strong>
                      </td>
                      <td>{displayedPerTicket != null ? formatMoney(displayedPerTicket, currentQuote.currency) : "—"}</td>
                      <td>
                        {isSelf ? (
                          "—"
                        ) : delta != null ? (
                          <span className={delta > 0 ? "tone-good-text" : "tone-bad-text"}>
                            {delta > 0 ? "+" : ""}
                            {formatMoney(delta, currentQuote.currency)}
                          </span>
                        ) : (
                          <span className="checkout-no-comparison">no ibranson.com quote at this quantity yet</span>
                        )}
                      </td>
                      <td className="timestamp">
                        {new Date(currentQuote.fetchedAt).toLocaleString()}
                        {!currentQuote.ok && <div className="error">{currentQuote.error}</div>}
                      </td>
                    </tr>
                  );
                })()}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
