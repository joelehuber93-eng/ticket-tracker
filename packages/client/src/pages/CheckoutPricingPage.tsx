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

function targetKey(competitorSiteId: string | null): string {
  return competitorSiteId ?? "self";
}

export function CheckoutPricingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [targets, setTargets] = useState<CheckoutTarget[]>([]);
  const [quantity, setQuantity] = useState(2);
  // "" means "earliest available" (the original behavior) — otherwise a
  // specific "YYYY-MM-DD" to pin every site to the same showtime date, since
  // that's what actually makes the comparison apples-to-apples (prices can
  // vary a lot by date — weekday vs. weekend, matinee vs. evening, etc.).
  const [date, setDate] = useState("");
  const [quotes, setQuotes] = useState<CheckoutQuote[]>([]);
  // Which row is currently running a check — null when idle. Only one at a
  // time: each run is a real headless-browser launch, so running every site
  // concurrently would pile up several at once for no good reason.
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Only products with our own checkoutUrl are listable for now — a product
  // that's ONLY configured for a competitor (no ibranson.com checkoutUrl of
  // its own) isn't a real case yet.
  const eligibleProducts = useMemo(() => products.filter((p) => p.checkoutUrl), [products]);
  const selectedProduct = eligibleProducts.find((p) => p.id === selectedProductId) ?? null;

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
      return;
    }
    api.getCheckoutTargets(selectedProductId).then(setTargets);
    api.getCheckoutQuotes(selectedProductId).then(setQuotes);
  }, [selectedProductId]);

  // The latest quote for a given site AT THE CURRENTLY SELECTED quantity (and
  // date, when one is pinned) — scoping every row to the same criteria is
  // what makes the comparison column meaningful. With no date pinned, any
  // quote at this quantity counts (original behavior, since different sites
  // may have auto-picked different "earliest available" dates); with a date
  // pinned, only quotes actually run for that exact date count.
  const quoteFor = (competitorSiteId: string | null): CheckoutQuote | undefined =>
    quotes.find(
      (q) => q.competitorSiteId === competitorSiteId && q.quantity === quantity && (!date || q.date === date)
    );

  const selfQuote = quoteFor(null);
  const selfPerTicket = selfQuote ? perTicket(selfQuote) : null;

  const handleRun = async (target: CheckoutTarget) => {
    if (!selectedProductId) return;
    const key = targetKey(target.competitorSiteId);
    setRunningKey(key);
    setRunError(null);
    try {
      const quote = await api.runCheckoutQuote(selectedProductId, target.competitorSiteId, quantity, date);
      setQuotes((prev) => [quote, ...prev.filter((q) => q.id !== quote.id)]);
      if (!quote.ok) setRunError(`${target.name}: ${quote.error ?? "Checkout run failed"}`);
    } catch (err) {
      setRunError(`${target.name}: ${err instanceof Error ? err.message : "Checkout run failed"}`);
    } finally {
      setRunningKey(null);
    }
  };

  const handleRunAll = async () => {
    for (const target of targets) {
      // eslint-disable-next-line no-await-in-loop
      await handleRun(target);
    }
  };

  return (
    <>
      <p className="note checkout-intro">
        Drives a real add-to-cart → cart checkout to discover the all-in total (including taxes &amp;
        fees) for a given number of tickets — the "starting at" rate on the dashboard doesn't include
        those. Leave the date blank to use each site's earliest available showtime, or pin a specific
        date so every site is compared for the same performance (prices can vary a lot by date). Every
        site below is checked at the same ticket count, so the "+/- ibranson.com" column is a fair
        comparison. Each run launches a real headless browser, so this is manual, not on the auto-refresh
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
            <div className="filter-field">
              <label className="filter-label" htmlFor="checkout-date">
                Date
              </label>
              <input
                id="checkout-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            {date && (
              <button className="clear-filters" onClick={() => setDate("")}>
                Use earliest available
              </button>
            )}
            <button onClick={handleRunAll} disabled={runningKey !== null || targets.length === 0}>
              {runningKey ? "Checking out…" : `Check all ${targets.length} sites`}
            </button>
          </div>

          {runError && <p className="error checkout-error">{runError}</p>}

          <table className="price-table">
            <thead>
              <tr>
                <th className="static-th">Site</th>
                <th className="static-th">Date</th>
                <th className="static-th">Subtotal</th>
                <th className="static-th">Taxes &amp; fees</th>
                <th className="static-th">All-in total</th>
                <th className="static-th">Per ticket (all-in)</th>
                <th className="static-th">+/- ibranson.com</th>
                <th className="static-th">Checked</th>
                <th className="static-th"></th>
              </tr>
            </thead>
            <tbody>
              {targets.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    No checkout sites configured yet for {selectedProduct?.name ?? "this show"}.
                  </td>
                </tr>
              )}
              {targets.map((target) => {
                const key = targetKey(target.competitorSiteId);
                const isSelf = target.competitorSiteId === null;
                const quote = quoteFor(target.competitorSiteId);
                const displayedPerTicket = quote ? perTicket(quote) : null;
                // "+/- ibranson.com": positive = this site costs more than
                // ibranson.com (good for us, we're cheaper) — same red/green
                // convention as the dashboard's we_pricier/we_cheaper coloring.
                const delta =
                  !isSelf && displayedPerTicket != null && selfPerTicket != null
                    ? displayedPerTicket - selfPerTicket
                    : null;
                const isRunning = runningKey === key;
                return (
                  <tr key={key}>
                    <td>{target.name}</td>
                    <td>{quote?.date ?? "—"}</td>
                    <td>{quote?.ok ? formatMoney(quote.subtotal, quote.currency) : "—"}</td>
                    <td>{quote?.ok ? formatMoney(quote.taxesFees, quote.currency) : "—"}</td>
                    <td>
                      <strong>{quote?.ok ? formatMoney(quote.total, quote.currency) : "—"}</strong>
                    </td>
                    <td>{displayedPerTicket != null ? formatMoney(displayedPerTicket, quote!.currency) : "—"}</td>
                    <td>
                      {isSelf ? (
                        "—"
                      ) : delta != null ? (
                        <span className={delta > 0 ? "tone-good-text" : "tone-bad-text"}>
                          {delta > 0 ? "+" : ""}
                          {formatMoney(delta, quote!.currency)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="timestamp">
                      {quote ? new Date(quote.fetchedAt).toLocaleString() : "Not checked yet"}
                      {quote && !quote.ok && <div className="error">{quote.error}</div>}
                    </td>
                    <td>
                      <button onClick={() => handleRun(target)} disabled={runningKey !== null}>
                        {isRunning ? "…" : quote ? "Refresh" : "Get price"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
