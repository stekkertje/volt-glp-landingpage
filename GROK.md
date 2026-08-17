# VOLT Pre-workout — briefing voor Grok Build CLI

Lees dit bestand **eerst**. Dit is de volledige context van het project.
Werk verder op de bestaande code. **Niet opnieuw scaffolden.**

---

## STARTPROMPT (plak dit als eerste bericht)

```
Je werkt in de VOLT Pre-workout landingspagina. Lees GROK.md volledig.

Dit is een bestaande, bijna-af conversie-landingspagina (Nederlands) voor een
premium pre-workout in capsules. Niet opnieuw bouwen.

Regels:
- Volledig Nederlands in UI en copy.
- Geen em-dashes (—). Gebruik punt, komma, of "·".
- Lichte, koele, premium look. Inter / system-ui. Geen beige, geen donker theme.
- Lettertype strak en duidelijk, geen sierletters.
- Preview/dev: 0.0.0.0:8080. Niet vragen om lokaal te runnen.
- Single-product e-commerce LP: doel = directe aankoop.
- Cart, contactformulier en checkout zijn DEMO (geen echte betaling/mail).
- Wijzig alleen wat gevraagd wordt. Geen extra features zonder opdracht.

Bevestig kort dat je GROK.md hebt gelezen en wacht op de volgende opdracht.
```

---

## Wat is dit

Single-product e-commerce **landingspagina** voor **VOLT Pre-workout capsules**.
Positionering: krachtig, premium, modern. Inname overdag of vóór training.
Geen poeder, geen shaker: 3 capsules.

Merk: **VOLT**  
Tagline: *Pure energie. Geen poeder. Geen excuses.*  
Taal: **volledig Nederlands**

Primair doel: de bezoeker overtuigen om direct te kopen.

---

## Product & prijzen

| | |
|---|---|
| Vorm | Capsules |
| Per dosering | 3 capsules, 200 mg cafeïne |
| Per verpakking | 90 capsules = 30 doseringen |
| Standaardprijs | €39,95 |
| 2 packs | €69,95 (was €79,90) — Bespaar €9,95 |
| 3 packs (beste deal) | €94,95 (was €119,85) — Bespaar €24,90 · €1,06/dosering |
| Verzending | Gratis vanaf €50 |
| Levering | NL & BE, 1–2 werkdagen, discreet, track & trace |
| Social proof | 4.9 / 1.284 beoordelingen |
| Nep-schaarste | Nog 47 stuks van deze batch |

Default geselecteerde pack: **trio** (beste deal).

---

## Stack

React 19, TypeScript, Vite 8, TanStack Start/Router, Tailwind v4, Zustand, Lucide, Radix accordion.

- Dev: `npm run dev` → `0.0.0.0:8080`
- Build: `npm run build` (Nitro preset **vercel**, alleen bij `command === "build"`)
- Typecheck: `npm run typecheck`

**Niet** drop-in Hostinger shared hosting. Output is Vercel SSR (`.vercel/output`).

---

## Belangrijkste bestanden

| Bestand | Rol |
|---|---|
| `src/components/landing-page.tsx` | Hele landingspagina + footer |
| `src/lib/product.ts` | Productdata, packs, FAQ, formule, copy |
| `src/lib/cart-store.ts` | Winkelwagen (client-only, demo) |
| `src/lib/contact-store.ts` | Contactmodal open/dicht |
| `src/components/pack-selector.tsx` | Packkeuze, aantal, CTA |
| `src/components/site-header.tsx` | Sticky header + marquee + hide-on-scroll + mobiel menu |
| `src/components/announce-bar.tsx` | Altijd zichtbare marquee (niet sluitbaar) |
| `src/components/cart-drawer.tsx` | Winkelwagen-drawer |
| `src/components/contact-dialog.tsx` | Contactformulier (alleen na klik, demo-submit) |
| `src/components/delivery-promise.tsx` | Countdown tot 23:00 |
| `src/components/product-gallery.tsx` | Hero / capsules / 3-pack foto |
| `src/components/mobile-sticky-bar.tsx` | Mobiele sticky koopbalk |
| `src/styles.css` | Design tokens, licht thema |
| `public/images/` | product-hero, product-capsules, product-trio, product-lifestyle |
| `vite.config.ts` | Host 8080, nitro alleen bij build |

---

## Design (niet terugdraaien)

- **Licht** theme: wit / cool gray, oranje `primary` (buttons)
- **Inter / system-ui** — strak, geen serifs of “rare boogjes”
- Geen donker theme, geen beige/oudbollig
- Nummers 01 02 03 in **primary oranje** (zelfde als knoppen)
- Marquee altijd zichtbaar, **geen kruisje**
- Header: hide bij omlaag scrollen, show bij omhoog / stilstand
- Mobiel menu: overlay (geen layout-shift), sluit bij tik buiten / echte scroll / link
- Geen Klarna
- Geen “incl. btw” bij prijs
- Geen em-dash `—` ergens in copy

---

## Pagina-opbouw (volgorde)

1. Marquee: Gratis verzending vanaf €50 · Voor 23:00 besteld, morgen verzonden · Discreet verpakt
2. Header: logo, ankers, winkelwagen, Nu kopen
3. Hero: productfoto, waardepropositie, prijs €39,95 + klikbare 3-pack deal, CTA’s
4. Benefits (4 kaarten) — icons op mobiel altijd oranje (niet alleen hover)
5. Capsules vs poeder (pluspunten Volt eerst, daarna minpunten poeder)
6. Kies jouw voordeel: 1/2 packs compact + oranje 3-pack card met trio-foto
7. Zo gebruik je VOLT (01 02 03)
8. Formule + supplement facts
9. Reviews
10. Bestellen: gallery + pack selector (`#prijzen` = packprijzen, **niet** de foto)
11. FAQ (alinea’s of bullets, geen muur van 1 regel)
12. Klaar om harder te trainen? (raket-icoon) + contact-link
13. Footer: Product → Levering → Service (onder elkaar, links), e-mail op 1 regel

Ankers `#bestellen` / “Bestellen” / “Nu kopen” / “Beste deal” / “Bekijk jouw voordeel” → **`#prijzen`**.

---

## UX-regels die de eigenaar al afdwong

- Hero-USP’s op 1 regel mobiel: `1–2 werkdagen · Discreet verzonden · Batch-getest`
- Samenstelling / dosering / aanbevolen gebruik: **onder elkaar** op mobiel
- Prijs per dosering op **eigen regel**, nooit een `·` vooraan na wrap
- “In winkelwagen” **direct onder Aantal**
- Pack-optie “In winkelwagen” vs “Nu kopen”: winkelwagen-CTA in hero wijst naar 3-pack
- Footer Levering:
  - Nederland & België
  - 1–2 werkdagen
  - Gratis levering vanaf €50 (1 regel)
  - Geen “Discreet verpakt” in footer
- Copyright past op 1 regel op 360–390px
- Cart: geen “Incl. btw · NL & BE”, geen Apple Pay / PayPal / iDEAL-knoppen in drawer
- Contact: alleen via klik (menu, footer, FAQ). Modal, geen altijd-zichtbaar formulier
- Lifestyle-sectie “potje op tafel” is **verwijderd**

---

## Demo vs live (niet “fixen” tenzij gevraagd)

- Cart: Zustand, geen backend
- Contact: timeout + toast, geen echte mail
- Checkout in drawer: nep-success
- Auth/login, PGLite, `/__grok` PWA: template-restanten, niet nodig voor de LP
- Hostinger shared: niet compatible zonder static export

---

## Commando’s

```bash
npm install
npm run dev          # 0.0.0.0:8080
npm run build
npm run typecheck
```

`startup.sh` moet blijven bestaan en de preview op 8080 starten.

---

## Hoe verder werken

1. Kleine copy/layout: edit in place, HMR, server laten draaien.
2. Alleen herstarten bij `vite.config` / deps.
3. Geen nieuwe app, geen extra pages, geen dark mode, geen Engels.
4. Screenshots voor QA: `/workspace/screenshots/`.
5. Mobiel checken op ~390px en ~402px (iPhone 17 Pro CSS-breedte).
