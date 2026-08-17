# VOLT GLP-1 shop review

Live HTML fetch of `http://127.0.0.1:8080` was blocked from this environment. Findings are from source. Demo checkout / no real payment is out of scope.

## Summary

This is a usable, buy-focused Dutch catalog: six products, clear euro prices with compare-at, add-from-card, a complete PDP buy box, and a cart that opens on add with stack discount, code, and a free-shipping meter. The conversion skeleton is there. The main risk is not “can I pay” but “can I choose and reach the grid”: category links look dead, mobile first screen and first-visit chrome hide the next step, and at the decision point the shopper still does not know how many weeks a pack lasts or whether a vial needs extra syringes.

## Conversion score

- **Home: 7/10** — Weekdeal, bestseller, ratings, and a grid with dual CTAs work; category nav does not land on the products and the default grid leads with advanced Retatrutide.
- **PDP: 7/10** — Buy box, extras, stock, cutoff, and related products are solid; duration, shipping cost, reviews, and extra-syringe help are missing at the decision point.
- **Cart: 8/10** — Opens on add, line qty, totals, stack + code, free-ship bar; memory-only cart and a success-styled invalid-code toast undermine it.
- **Mobile: 6/10** — PDP sticky “Kopen” is the right pattern, but first-visit cookie covers it, hero CTAs sit below a tall image, and sticky add ignores the qty stepper.
- **Trust: 7/10** — 4.8 / 1.024, four review cards, labgetest / discreet / 23:00 on the home hero; PDP only has a non-clickable rating and no retour promise next to buy.

## Issues

### Issue 1 -- Severity: bug
- File: /Users/mpp/Desktop/VOLT landing page/src/components/site-header.tsx:11
- Description: Header, footer, PDP breadcrumb, and the “Stoffen” cards all point at `/#semaglutide`, `/#tirzepatide`, and `/#retatrutide`. Those hashes only drive `hashToFilter` in `landing-page.tsx`. There is no `id="semaglutide"` (or tirzepatide / retatrutide) in the DOM. The only product-grid anchor is `#producten`. From the hero, a header tap changes the filter invisibly and does not scroll. From `#formule`, “2 producten →” looks dead: the grid above filters to two items while the viewport stays put. `hashToFilter` also treats any other hash (including `#faq`) as `"all"`, so a filtered view is wiped when the shopper opens FAQ.
- Suggestion: When the hash is a compound, set the filter and `scrollIntoView` on `#producten`. Give the product section (or inner markers) matching ids, and do not reset the filter on `#faq` / `#beoordelingen`.
- Status: **resolved** — `hashToFilter` returns `null` for non-product hashes; compound ids + `scrollIntoView` on `#producten`; “Alles” filter tab added.

### Issue 2 -- Severity: bug
- File: /Users/mpp/Desktop/VOLT landing page/src/components/cookie-banner.tsx:29
- Description: First-visit cookie bar is `fixed` `bottom-0` `z-[65]`. The mobile buy bar is `z-50` (`mobile-sticky-bar.tsx:47`). On ~390px the consent strip covers the sticky “Kopen” / “Bekijk” control entirely until the shopper accepts. That is the first session, which is the one that matters.
- Suggestion: Raise the sticky bar above the cookie bar, or stack the cookie above it with extra `padding-bottom` on `SiteShell` so “Kopen” stays tappable.
- Status: **resolved** — sticky bar `z-[66]` + `bottom: var(--volt-cookie-h)`; cookie sets `--volt-cookie-h`.

### Issue 3 -- Severity: bug
- File: /Users/mpp/Desktop/VOLT landing page/src/components/cookie-banner.tsx:32
- Description: Copy says functional cookies remember the winkelwagen. `useCartStore` is a plain Zustand store with no `persist` (`cart-store.ts:55`). Refresh, tab close, or preview reload empties the cart. The shopper was told the opposite.
- Suggestion: Persist `lines`, `discountCode`, and `discountApplied` to `localStorage`, or drop the “winkelwagen onthouden” claim.
- Status: **resolved** — Zustand `persist` on `volt-cart` key.

### Issue 4 -- Severity: bug
- File: /Users/mpp/Desktop/VOLT landing page/src/components/mobile-sticky-bar.tsx:64
- Description: PDP sticky “Kopen” calls `addToCart(product.slug, selectedOptionId)` and therefore always adds qty 1. Quantity lives only in `PackSelector` local state (`pack-selector.tsx:27`). A shopper who sets 5, scrolls to highlights, and taps “Kopen” gets one unit while the stepper still shows 5.
- Suggestion: Put qty in the cart store next to `selectedOptionId`, or scroll to `#prijzen` and submit the same qty the stepper shows.
- Status: **resolved** — `selectedQty` in cart store; sticky passes qty to `addToCart`.

### Issue 5 -- Severity: bug
- File: /Users/mpp/Desktop/VOLT landing page/src/components/product-page.tsx:54
- Description: `ProductGallery` and `PackSelector` are not keyed on `product.slug`. React reuses them on `/product/$slug` changes. Gallery `active` index (`product-gallery.tsx:11`) stays put, so a 5-image pen opened on photo 5 then a 2-image vial can show a non-hero frame with no selected thumb. Pack `qty` (`pack-selector.tsx:27`) also carries over, so “Vaak samen gekocht” can add 8 of the next product after the shopper configured 8 of the previous one.
- Suggestion: `key={product.slug}` on both, or reset `active` / `qty` in an effect when `product.slug` changes.
- Status: **resolved** — `key` on gallery + pack selector; qty resets via cart store on slug change.

### Issue 6 -- Severity: bug
- File: /Users/mpp/Desktop/VOLT landing page/src/lib/cart-store.ts:126
- Description: A wrong or empty code sets `discountApplied: false`, which silently removes a working VOLT10. The failure toast still uses a green check (`toasts.tsx:23`), so “Code niet geldig” reads as success if the shopper only glances at the icon.
- Suggestion: Leave an already-applied code in place on failure, and give error toasts a distinct icon / color.
- Status: **resolved** — invalid code no longer clears applied discount; error toasts use `CircleAlert` + danger border.

### Issue 7 -- Severity: bug
- File: /Users/mpp/Desktop/VOLT landing page/src/components/delivery-promise.tsx:7
- Description: After 23:00 the countdown jumps to the next day’s 23:00 (~24h) while the line “Voor 23:00 besteld = morgen verzonden” stays. “Bestel binnen 23:xx:xx” then implies the shopper still has almost a day to get tomorrow’s shipment, but today’s cutoff is gone. FAQ already says volgende werkdag; this widget does not.
- Suggestion: After cutoff, say today’s window is closed and the next ship date is the following workday. Keep the countdown only before 23:00.
- Status: **resolved** — closed-state copy after 23:00; countdown hidden when closed.

### Issue 8 -- Severity: suggestion
- File: /Users/mpp/Desktop/VOLT landing page/src/components/landing-page.tsx:161
- Description: On ~390px the hero is `order-1` image, `order-2` copy. Announce + header + a square product photo fill the first screen. Weekdeal, “Bekijk 6 producten”, and the bestseller button sit below the fold. The photo is a PDP link, but the overlay is not labeled as a step (no “Bekijk” / “Kopen”). A conversion home page should show price + primary CTA without a scroll.
- Suggestion: On small screens put H1 + primary CTA above the fold (image second, or a compact overlay button on the photo). Keep the current two-column desktop layout.
- Status: **resolved** — copy first on mobile (`order-1`); extra mobile-only CTA directly under pitch.

### Issue 9 -- Severity: suggestion
- File: /Users/mpp/Desktop/VOLT landing page/src/components/product-page.tsx:96
- Description: The buy box has price, unit, and pitch, then extras. How long the pack lasts is only in dim text under Samenstelling (`doseBeginner` / `doseAdvanced` / `frequency` at lines 151-155). A 2 mg Semaglutide vial at 0,25 mg/week is weeks of use; a 4 mg pen is a different runway; Retatrutide 10 mg at 2,5 mg/week is about four weeks. Without weeks (or €/week) next to the price, the €85 vs €169 vs €199 spread looks arbitrary. Card “In wagen” also adds the vial default “Geen extra's” with no hint that syringes exist.
- Suggestion: In the buy box, show “ongeveer X weken bij startdosis” and €/week. On vial options, explain that bac water is included and that insulinespuiten are needed to inject; say how many syringes the +€2 / +€2,50 add-on is.
- Status: **resolved** — weeks + €/week in buy box; vial syringe copy in pack selector + product cards; labeled syringe add-ons.

### Issue 10 -- Severity: suggestion
- File: /Users/mpp/Desktop/VOLT landing page/src/components/mobile-sticky-bar.tsx:70
- Description: Off the PDP, sticky CTA is “Bekijk” → `/#producten`. That hash maps to filter `"all"` (`landing-page.tsx:45`), so a shopper who filtered to Retatrutide and scrolled past the grid gets bounced back to all six. The bar also shows `selectedSlug` (default Semaglutide pen, or whatever was last added), which may not match the filter. After the catalog, “Bekijk” is a loop, not a buy.
- Suggestion: Sticky on home should add the shown product or go to its PDP. Do not point it at `#producten` if that resets the active stof-filter.
- Status: **resolved** — home sticky links to PDP of featured/last-selected product.

### Issue 11 -- Severity: suggestion
- File: /Users/mpp/Desktop/VOLT landing page/src/components/product-page.tsx:164
- Description: “Vaak samen gekocht” is `relatedProducts()`: the other form of the same stof, then the next catalog rows. Those are substitutes (vial vs pen, or another GLP-1), not complements. The heading pushes a shopper to stack Semaglutide + Retatrutide. Trust cost on this category is high.
- Suggestion: Rename to “Andere sterkte / vorm” or “Vergelijk”, and link the sibling vial/pen in the buy box as an explicit alternative.
- Status: **resolved** — section renamed; sibling link in buy box.

### Issue 12 -- Severity: suggestion
- File: /Users/mpp/Desktop/VOLT landing page/src/components/product-page.tsx:104
- Description: Trust chips are speed, track & trace, discreet, and help. Shipping price (€4,95 under €100, `cart-store.ts:169`) is not on the PDP. Vials are €77–€94, so shipping appears only in the drawer. 30-dagen retour and labgetest live in FAQ / home, not next to “In winkelwagen”. The rating is not a link to reviews (and the PDP has no reviews).
- Suggestion: For sub-€100 products, show “+ €4,95 verzending · gratis vanaf €100” in the buy box. Add one trust line for labgetest + 30 dagen ongeopend retour, and link the rating to `#beoordelingen` or a short PDP review block.
- Status: **resolved** — shipping line under price; trust chips include lab + retour; rating links to reviews.

### Issue 13 -- Severity: suggestion
- File: /Users/mpp/Desktop/VOLT landing page/src/lib/product.ts:72
- Description: Unfiltered grid order is the `PRODUCTS` array: Retatrutide first (newest, strongest, weekdeal), Semaglutide third. Hero and default sticky/featured product are the Semaglutide 4 mg pen. A first-time shopper who ignores filters lands on the most aggressive compound. Compound cards later tell a beginner-to-advanced story the grid does not.
- Suggestion: Default order Semaglutide → Tirzepatide → Retatrutide (vial then pen), or featured/bestseller first. Keep the weekdeal card in the hero for the 20% vial.
- Status: **resolved** — `CATALOG_ORDER` starts with Semaglutide; weekdeal stays in hero.

### Issue 14 -- Severity: suggestion
- File: /Users/mpp/Desktop/VOLT landing page/src/components/pack-selector.tsx:130
- Description: The primary button shows `price * qty` with no stack. Qty 5 on Retatrutide 10 mg reads as €388,00; the cart then applies 10% stapelkorting. The buy box already advertises 5+ / 10+ in a separate callout, so the CTA and the callout disagree.
- Suggestion: If `qty` (plus current cart count) hits a tier, show the discounted total on the button, or “vanaf 5 stuks −10% in de winkelwagen”.
- Status: **resolved** — CTA shows stack-adjusted total when tier applies.

### Issue 15 -- Severity: nit
- File: /Users/mpp/Desktop/VOLT landing page/src/lib/product.ts:137
- Description: Shopper-facing badges use English “Sale” (`Sale −10%`, `Sale −22%`, `Sale −5%`). The rest of the UI is Dutch (`Weekdeal`, `Nieuw`, `Bestseller` as a loanword).
- Suggestion: Use “Korting −10%” or “Aanbieding −10%”.
- Status: **resolved** — badges use “Korting”.

### Issue 16 -- Severity: nit
- File: /Users/mpp/Desktop/VOLT landing page/src/components/site-header.tsx:177
- Description: Hide-on-scroll is an existing product rule, but the sticky bar has no cart control. After the drawer closes, a downward scroll removes the bag icon. Checkout then requires a scroll-up. Combined with Issue 2 this is a lot of missing chrome on a phone.
- Suggestion: Put a small cart badge on the sticky bar (especially on the PDP) so afrekenen stays one tap away.
- Status: **resolved** — cart icon with badge on mobile sticky bar.
