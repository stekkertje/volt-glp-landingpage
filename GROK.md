# VOLT GLP-1 webshop · projectbriefing

Lees dit bestand **eerst**. Dit is de volledige context van het project.
Werk verder op de bestaande code. **Niet opnieuw scaffolden.**

---

## STARTPROMPT (plak dit als eerste bericht)

```
Je werkt in de VOLT GLP-1 webshop. Lees GROK.md volledig.

Dit is een bestaande, bijna-af Nederlandse webshop met zes GLP-1 producten.
Niet opnieuw bouwen.

Regels:
- Volledig Nederlands in UI en copy.
- Geen em-dashes (—). Gebruik punt, komma, of "·".
- Lichte, koele, premium look. Inter / system-ui. Geen beige, geen donker theme.
- Lettertype strak en duidelijk, geen sierletters.
- Preview/dev: 0.0.0.0:8080. Niet vragen om lokaal te runnen.
- Catalogus met zes producten en afzonderlijke productpagina's.
- Primair doel: een passende vorm kiezen en direct toevoegen.
- Cart is clientstate. Checkout plaatst echte gastorders en contact wordt opgeslagen. Betaling en mail blijven handmatig.
- Wijzig alleen wat gevraagd wordt. Geen extra features zonder opdracht.

Bevestig kort dat je GROK.md hebt gelezen en wacht op de volgende opdracht.
```

---

## Wat is dit

Nederlandse **GLP-1 webshop** voor Semaglutide, Tirzepatide en Retatrutide.
Elke stof is beschikbaar als vial of kant-en-klare pen.

Merk: **VOLT**  
Categorie: **GLP-1 Afvallen**
Taal: **volledig Nederlands**

Primair doel: bezoekers helder laten vergelijken en zonder twijfel laten kopen.

---

## Producten & prijzen

| Product           | Vorm |             Prijs |
| ----------------- | ---- | ----------------: |
| Semaglutide 2 mg  | vial |            €85,00 |
| Semaglutide 4 mg  | pen  |           €169,00 |
| Tirzepatide 10 mg | vial |            €94,00 |
| Tirzepatide 20 mg | pen  |           €190,00 |
| Retatrutide 10 mg | vial | €77,60 (weekdeal) |
| Retatrutide 20 mg | pen  |           €199,00 |

- Gratis verzending vanaf €100, anders €4,95.
- Levering in Nederland en België, 1–2 werkdagen, discreet en met track & trace.
- Vials bevatten bac water. Insulinespuiten zijn een expliciete extra-keuze.
- Stapelkorting: 5+ stuks 10%, 10+ stuks 20%.
- Kortingscode `VOLT10`: 10% extra na stapelkorting.
- Default uitgelicht product: **Semaglutide 4 mg pen**.

---

## Stack

React 19, TypeScript, Vite 8, TanStack Start/Router, Tailwind v4, Zustand, Lucide, Radix accordion.

- Dev: `npm run dev` → `0.0.0.0:8080`
- Build: `npm run build` (Nitro preset **vercel**, alleen bij `command === "build"`)
- Typecheck: `npm run typecheck`

**Niet** drop-in Hostinger shared hosting. Output is Vercel SSR (`.vercel/output`).

---

## Belangrijkste bestanden

| Bestand                                | Rol                                                    |
| -------------------------------------- | ------------------------------------------------------ |
| `src/components/landing-page.tsx`      | Homepage en productcatalogus                           |
| `src/components/product-page.tsx`      | Productdetailpagina                                    |
| `src/lib/product.ts`                   | Productdata, opties, FAQ, reviews en copy              |
| `src/lib/cart-store.ts`                | Persistente winkelwagenstate in de browser             |
| `src/lib/contact-store.ts`             | Contactmodal open/dicht                                |
| `src/components/pack-selector.tsx`     | Extra-keuze, aantal, korting en CTA                    |
| `src/components/site-header.tsx`       | Sticky header + marquee + hide-on-scroll + mobiel menu |
| `src/components/announce-bar.tsx`      | Altijd zichtbare marquee (niet sluitbaar)              |
| `src/components/cart-drawer.tsx`       | Winkelwagen-drawer                                     |
| `src/components/contact-dialog.tsx`    | Contactformulier dat berichten in de backend opslaat   |
| `src/components/delivery-promise.tsx`  | Countdown tot 23:00                                    |
| `src/components/product-gallery.tsx`   | Productafbeeldingen en thumbnails                      |
| `src/components/mobile-sticky-bar.tsx` | Mobiele sticky koopbalk                                |
| `src/styles.css`                       | Design tokens, licht thema                             |
| `public/images/producten/`             | Productafbeeldingen                                    |
| `scripts/storefront.test.mjs`          | Browserregressies voor de winkelstromen                |
| `vite.config.ts`                       | Host 8080, nitro alleen bij build                      |

---

## Design (niet terugdraaien)

- **Licht** theme: wit / cool gray, oranje `primary` (buttons)
- **Inter / system-ui** — strak, geen serifs of “rare boogjes”
- Geen donker theme, geen beige/oudbollig
- Nummers 01 02 03 in **primary oranje** (zelfde als knoppen)
- Marquee altijd zichtbaar, **geen kruisje**
- Header: hide bij omlaag scrollen, show bij omhoog / stilstand
- Mobiel menu: overlay (geen layout-shift), sluit bij tik buiten / echte scroll / link
- Geen Klarna of betaalproviderlogo's
- Geen “incl. btw” bij prijs
- Geen em-dash `—` ergens in copy

---

## Pagina-opbouw

Homepage:

1. Marquee: gratis verzending, volgende werkdag, discreet verpakt
2. Header: logo, stoffen, FAQ, winkelwagen en Nu kopen
3. Hero: waardepropositie, weekdeal en bestseller
4. Filterbare productcatalogus
5. Voordelen en vergelijking vial versus pen
6. Gebruik in drie stappen
7. Stoffenoverzicht
8. Reviews
9. FAQ en contact
10. Footer

Productpagina:

1. Broodkruimel en productgalerij
2. Prijs, weken bij startdosis, verzendkosten en reviews
3. Extra-keuze, aantal, voorraad, levering en stapelkorting
4. Vertrouwenselementen en samenstelling
5. Alternatieve vorm en vergelijkbare producten

---

## UX-regels

- Homefilters wijzigen de catalogus en de mobiele sticky productkeuze.
- Andere hashes, zoals FAQ en beoordelingen, wissen het actieve filter niet.
- Vial-kaarten sturen eerst naar de extra-keuze en voegen niet stil “Geen extra's” toe.
- “In winkelwagen” staat direct onder Aantal.
- Mobiele sticky “Kopen” gebruikt hetzelfde aantal en dezelfde optie als de productselector.
- Cookiebanner en sticky koopbalk mogen elkaar nooit overlappen.
- Footer Levering: Nederland & België, 1–2 werkdagen, gratis vanaf €100.
- Cart bevat geen betaalproviderknoppen; checkout slaat een echte gastorder op en vermeldt dat betaling later volgt.
- Contact opent alleen na een bewuste klik en gebruikt een modal.
- Producttitels blijven productspecifiek, ook met een winkelwagenaantal in de browsertab.

---

## Live status

- Cart: Zustand-state in de browser; prijzen worden bij checkout opnieuw op de server berekend
- Contact: gevalideerde berichten worden opgeslagen; er wordt nog geen e-mail verstuurd
- Checkout: `/checkout` slaat echte gastorders op; betaling blijft een handmatig betaalverzoek
- Auth/login: gekoppeld aan accountbestellingen en optionele admin-allowlist
- PGLite: alleen lokale preview/testfallback; productie vereist Postgres via `DATABASE_URL`
- `/__grok` PWA: platforminfrastructuur voor installatie
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
3. Geen nieuwe app, geen extra pagina's, geen dark mode, geen Engels.
4. Screenshots voor QA: `/workspace/screenshots/`.
5. Mobiel checken op ~390px en ~402px (iPhone 17 Pro CSS-breedte).
6. Voeg voor geldstromen en navigatie een browserregressie toe in `scripts/storefront.test.mjs`.

## Echte shopbackend

- `/checkout` plaatst echte gastorders en contactberichten worden opgeslagen.
- Betaling en e-mailafhandeling blijven handmatig.
- `/admin` beheert bestellingen, statussen en contactberichten.
- Admin gebruikt zelfstandig `ADMIN_EMAILS` of het paar `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET`.
- Productie en deployments vereisen `DATABASE_URL`; PGLite is alleen voor dev/test.
- Gasttoegang werkt met een cookie of herstelcode die na 72 uur verloopt.
- Nog niet aanwezig: betaalprovider, echte e-mail, voorraad, refunds en verzendkoppeling.
