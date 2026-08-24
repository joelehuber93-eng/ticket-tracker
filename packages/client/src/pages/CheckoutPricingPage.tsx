import { useEffect, useMemo, useState } from "react";
import type { CheckoutQuote, Product } from "@price-tracker/shared";
import { api } from "../api";

function formatMoney(value: number | null, currency: string): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export function CheckoutPricingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [quantity, setQuantity] = useState(2);
  const [quotes, setQuotes] = useState<CheckoutQuote[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

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
      setQuotes([]);
      return;
    }
    api.getCheckoutQuotes(selectedProductId).then(setQuotes);
  }, [selectedProductId]);

  const handleRun = async () => {
    if (!selectedProductId) return;
    setRunning(true);
    setRunError(null);
    try {
      const quote = await api.runCheckoutQuote(selectedProductId, quantity);
      setQuotes((prev) => [quote, ...prev]);
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
        Drives a real add-to-cart → cart checkout on ibranson.com to discover the all-in total (including
        taxes &amp; fees) for a given number of tickets — the "starting at" rate on the dashboard doesn't
        include those. Each run launches a real headless browser, so this is manual, not on the
        auto-refresh cycle.
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
            <button onClick={handleRun} disabled={running || !selectedProductId}>
              {running ? "Checking out…" : "Get all-in price"}
            </button>
          </div>

          {runError && <p className="error checkout-error">{runError}</p>}

          <table className="price-table">
            <thead>
              <tr>
                <th className="static-th">Tickets</th>
                <th className="static-th">Subtotal</th>
                <th className="static-th">Taxes &amp; fees</th>
                <th className="static-th">All-in total</th>
                <th className="static-th">Per ticket (all-in)</th>
                <th className="static-th">vs. "starting at"</th>
                <th className="static-th">Checked</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    No checkout runs yet for {selectedProduct?.name ?? "this show"} — click "Get all-in
                    price" above.
                  </td>
                </tr>
              )}
              {quotes.map((q) => {
                const perTicket = q.ok && q.total != null ? q.total / q.quantity : null;
                const listedPerTicket = selectedProduct?.ourPrice ?? null;
                const deltaPct =
                  perTicket != null && listedPerTicket
                    ? ((perTicket - listedPerTicket) / listedPerTicket) * 100
                    : null;
                return (
                  <tr key={q.id}>
                    <td>{q.quantity}</td>
                    <td>{q.ok ? formatMoney(q.subtotal, q.currency) : "—"}</td>
                    <td>{q.ok ? formatMoney(q.taxesFees, q.currency) : "—"}</td>
                    <td>
                      <strong>{q.ok ? formatMoney(q.total, q.currency) : "—"}</strong>
                    </td>
                    <td>{perTicket != null ? formatMoney(perTicket, q.currency) : "—"}</td>
                    <td>
                      {deltaPct != null ? (
                        <span className={deltaPct > 0 ? "tone-bad-text" : "tone-good-text"}>
                          {deltaPct > 0 ? "+" : ""}
                          {deltaPct.toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="timestamp">
                      {new Date(q.fetchedAt).toLocaleString()}
                      {!q.ok && <div className="error">{q.error}</div>}
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
