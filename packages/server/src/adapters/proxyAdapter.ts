import { parseListingEntries, type ListingConfig, type ListingResult } from "./listingAdapter";

const FETCH_TIMEOUT_MS = 30000;

/**
 * Fetches a listing page through a third-party scraping API (ScraperAPI:
 * https://www.scraperapi.com/) instead of a plain fetch() or our own
 * headless browser — for sites whose bot detection beats both of those.
 * Confirmed necessary for TripAdvisor: it blocks our own headless Chromium
 * (see adapters/browserAdapter.ts) with an empty rendered page, so getting
 * past it needs a service that specializes in exactly this (rotating
 * residential proxies, browser fingerprint management, CAPTCHA handling).
 *
 * Requires SCRAPER_API_KEY to be set — see README "Third-party scraping
 * service" for how to get one and where to set it. Without a key configured,
 * this fails cleanly with an explanatory error rather than making a request
 * that would just fail anyway (no charge, no attempt).
 *
 * `render=true` asks ScraperAPI to render the page with a real browser on
 * their end (needed here, same reason our own browser adapter exists) —
 * this costs more per request than a plain fetch-through-proxy would. If
 * TripAdvisor still blocks this, ScraperAPI's premium/ultra_premium proxy
 * pools are the next escalation (see their docs), at higher cost per call.
 */
export async function fetchListingViaProxy(url: string, config: ListingConfig): Promise<ListingResult> {
  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      entries: [],
      error: "SCRAPER_API_KEY not configured — see README for how to set one up",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const proxyUrl = `https://api.scraperapi.com/?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(
      url
    )}&render=true`;
    const res = await fetch(proxyUrl, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, entries: [], error: `ScraperAPI HTTP ${res.status}` };
    }
    const html = await res.text();
    const entries = parseListingEntries(html, config);

    if (entries.length === 0) {
      return { ok: false, entries: [], error: "No cards matched after proxy render — check card/name/price selectors" };
    }
    return { ok: true, entries, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, entries: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}
