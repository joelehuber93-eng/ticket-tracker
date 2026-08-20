/**
 * Manual overrides for listing-entry matching (see matchListingEntry in
 * adapters/listingAdapter.ts), for the rare case where a competitor's name
 * for a show diverges enough from ours that even the fuzzy word-overlap
 * fallback can't safely bridge it — confirmed the same show by a human
 * rather than guessed, since a wrong automatic match would silently pair
 * the wrong price to a show.
 *
 * Keyed by our exact Product.name. Each alias is tried as a full name
 * (exact -> substring -> fuzzy) if the product's own name doesn't match.
 */
export const PRODUCT_NAME_ALIASES: Record<string, string[]> = {
  "Dolly Parton's Stampede Dinner Attraction": ["Dolly Parton's Stampede"],
};
