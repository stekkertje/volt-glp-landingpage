# VOLT project instructions

## Product price changes

Treat these rules as a required checklist whenever a product price or discount
changes. Do not consider a price change complete until every applicable item
below is verified.

- `src/lib/product.ts` is the single source of truth for catalogue prices.
  Store all money values as integer euro cents (`8500` means EUR 85.00).
- A product can have both a top-level `priceCents` and one or more
  `options[].priceCents` values. The top-level value is used on catalogue and
  promotional cards, while the selected option price is used on the product
  page, in the cart, and by server-side checkout pricing. Update every affected
  value deliberately so customers cannot see one price and be charged another.
  If the requested change does not make clear which variants are affected, ask
  before editing.
- Review the matching `compareAtCents`, `badges`, and `weekdeal` values whenever
  a selling price changes. Recalculate any displayed discount percentage from
  the actual selling and comparison prices; never leave misleading discount
  copy behind.
- Do not hardcode a product price in a React component, cart, checkout request,
  or server handler. UI prices must continue to derive from
  `src/lib/product.ts`.
- `src/lib/server/pricing.ts` remains authoritative at checkout. Never trust or
  persist a price supplied by the browser; the server must look up the current
  catalogue price from the product slug and option ID.
- Existing carts contain product identifiers and quantities and are repriced
  against the current catalogue. Existing orders are different: their
  `order_lines.unit_price_cents` and `line_total_cents` are immutable historical
  snapshots. Never rewrite old orders when a catalogue price changes.
- After a price change, verify the product card/promotion, product page and all
  options, cart, checkout preview, and the server-created order total. Also run
  the relevant pricing/order tests, `npm run typecheck`, `npm run lint`, and a
  production build. Fix inconsistencies before marking the work ready.

