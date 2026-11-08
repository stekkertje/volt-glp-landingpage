# Definitief plan van aanpak: OpenCart multistore weg bij Hostinger

Status: plan. Er is niets uitgevoerd en er wordt niets uitgevoerd zonder
expliciet `ja` van de eigenaar per fase met klantimpact.
Versie: 8 november 2026, op basis van geverifieerde inventaris (zie paragraaf 2).
Onbekende punten staan in dit plan als controlepunt, nooit als aanname.

## 1. Doel

De complete OpenCart-omgeving verhuist van Hostinger naar een eigen VPS
buiten de EU, met Cloudflare ervoor en een technisch afgeschermde origin.
Zonder onderhoudspagina, zonder orderverlies, zonder kapotte koppelingen,
en met een terugvaloptie tot alles aantoonbaar een volledige dagcyclus
heeft gedraaid.

## 2. Geverifieerde uitgangssituatie (geen aannames)

1. Eén OpenCart 3.x multistore-installatie met één gedeelde MySQL/MariaDB
   database (prefix `oc_`, MariaDB 11.8.9 in de export van oktober 2026).
   Primaire webroot staat onder steroiden.com op Hostinger.
2. Stores: 0 = steroiden.com, 1 = anabolenkopen.nl,
   2 = afslank-injecties.nl, 3 = www.stacker-pro.com. Store-id's 4 tot en
   met 7 routeren in de scripts technisch naar steroiden.com
   (landingspagina's). Alle gecontroleerde domeinen draaien live op
   PHP 8.3.36 bij Hostinger en zetten een `OCSESSID`-cookie.
3. Maatwerk in de installatie: eigen mailsysteem
   (`catalog/model/account/shopmail.inc.php` en `shopmail.php`),
   trackingkolommen op `oc_order` en `oc_order_history`, aangepaste admin
   (onder andere Track & Trace-invoer) en 3 actieve OCMods: multistore/
   canonical routing, thema-assets en een non-www 301-redirect. Per store
   een eigen thema en eigen logo/huisstijl.
4. Winkelmail (bestelbevestiging, betaald, verzonden, annulering, refund,
   contact) verstuurt OpenCart zelf. Instelling: `config_mail_engine = mail`,
   via Hostinger-sendmail (`/usr/sbin/hsendmail`). Er is geen n8n of Gmail
   in deze keten.
5. n8n draait op n8n Cloud. Drie workflows zijn actief: contactformulier,
   directe mail na betaling en de dripcampagne. De eerste twee werken op de
   Wix-gegevens van Stacker Pro. De actieve dripcampagne leest daarnaast
   wél OpenCart store 3: hij POST naar
   `https://www.stacker-pro.com/index.php?route=extension/total/spcoupon/drip`
   met de acties `orders` en `coupons` en een eigen tokenheader. De extensie
   `spcoupon` is daarmee een productiekoppeling. De workflows met OpenCart
   in de naam staan uit. De lokale n8n op de Mac is alleen een
   testinstantie. Stand van deze exports: oktober 2026; de actuele stand
   in n8n Cloud moet voor uitvoering opnieuw read-only worden opgehaald.
6. De ochtendketen draait op de Mac van de eigenaar: launchd-agent
   `com.stackerpro.ochtendketen`, doordeweeks vanaf 10:15 uur met
   herhaalpogingen. Keten: `ochtendketen.py` stuurt `daily_pro.py` aan;
   die matcht bankbetalingen over de OpenCart-stores en Wix, maakt exports
   en zet orders op Paid. Daarnaast draait dagelijks om 11:00 uur de
   launchd-job `com.mpp.weekly-funnel` met directe databasequeries.
   `myparcel_afronding.py` draait NIET automatisch mee: de keten gebruikt
   alleen de MyParcel-ophaal functie als duplicaatfilter in de export.
   De stap Paid naar Shipped plus verzendmail gebeurt door
   `run_shipping_sync` handmatig te starten (eigen `main`, verder alleen
   tests). Labels ontstaan via een werkblad en het MyParcel-portaal;
   die menselijke stap hoort expliciet in de dagprocedure na de switch.
7. De scripts werken op twee manieren tegen de shops:
   a. Rechtstreeks op de database, vanaf de Mac, via PyMySQL met de
      `OPENCART_DB_HOST/PORT/NAME/USER`-instellingen uit een `.env`
      buiten de scriptsmap.
   b. Via HTTPS per storedomein naar
      `index.php?route=api/order/history`, met een zelf aangemaakte
      `oc_api_session`. OpenCart controleert daarbij het bron-IP; het
      script schrijft het database-bron-IP vooraf in `oc_api_ip`.
8. Betalingen zijn uitsluitend handmatige bankoverschrijvingen
   (bevestigd door de eigenaar op 8 november 2026). Er is geen
   betaalprovider, geen PSP-koppeling en dus ook geen betaalwebhook,
   callback of terugboekingssignaal dat tijdens de verhuizing gemist
   kan worden. De keten matcht de binnengekomen overboekingen achteraf
   (PayTail-matching) en zet orders dan pas op Paid of Partial Paid.
9. Live baseline van afslank-injecties.nl (gemeten 8 november 2026):
   homepage 200, SEO-URL's werken, www geeft 301 naar apex, http geeft 301
   naar https, `/sitemap.xml` is dynamisch met image-sitemap,
   `/system/storage/` geeft 404, nameservers en MX staan bij Hostinger,
   SPF verwijst naar Hostinger, DMARC staat op `p=none`.
10. Wat nog niet is vastgesteld omdat het alleen op de server zichtbaar is
    (Fase 0 maakt dit compleet): de echte paden uit `config.php` en
    `admin/config.php` (waaronder `DIR_STORAGE`), de exacte OpenCart
    puntversie in de admin, hPanel-cronjobs, PHP-extensies en instellingen
    in detail, databasegrootte, en de DKIM-selector per domein.

## 3. Doelarchitectuur

1. Domeinen en DNS: per domein een eigen Cloudflare-zone. Registrar
   wijzigen is een apart traject en gebeurt niet in dezelfde periode als
   deze verhuizing.
2. Cloudflare (proxied) per zone: SSL uiteindelijk op Full (Strict),
   zone-level Authenticated Origin Pulls met eigen clientcertificaat,
   canonical-redirect per store exact zoals live gemeten (die is niet
   overal gelijk: afslank-injecties.nl stuurt www naar apex, maar
   stacker-pro.com stuurt apex naar www en heeft ook www in de
   store-instellingen), geen caching op checkout, winkelwagen, account,
   admin en API-paden.
3. VPS buiten de EU (keuze in Fase 1) met Ubuntu 24.04 LTS en CloudPanel
   (Nginx, PHP-FPM 8.3, MariaDB). Eén site voor de multistore-installatie
   met alle storedomeinen erop, één database, één site user.
4. Origin-afscherming in lagen: Cloudflare Origin CA-certificaat,
   mTLS-verificatie op de origin, handshake-afwijzing voor onbekende SNI,
   Nginx-laag "alleen Cloudflare" plus UFW-regels met actuele
   Cloudflare-ranges voor poort 80 en 443 (IPv4 en IPv6), SSH en
   CloudPanel-interface alleen vanaf het eigen IP.
5. Mail: winkelmails blijven uit OpenCart komen, maar niet meer via
   Hostinger-sendmail. Besluit in Fase 0 uit twee opties:
   A. OpenCart per store op SMTP zetten via de bestaande mailboxen
      (zolang de mailboxen bij Hostinger of elders bestaan). De VPS
      verstuurt dan zelf geen mail en het verzend-IP blijft dat van de
      mailboxprovider.
   B. De VPS verstuurt zelf (postfix/sendmail). Dan per shopdomein SPF,
      DKIM en DMARC volledig inrichten en deliverability testen. Nadeel:
      het VPS-IP staat in mailheaders en de verzendreputatie begint op nul.
   Voorkeur: optie A, vanwege herkenbaarheid voor klanten en omdat het
   VPS-IP dan niet via mail lekt.
6. Mac-keten blijft op de Mac draaien. Databasebereikbaarheid vanaf het
   thuis-IP wordt beperkt ingericht (alleen dat IP, eigen
   databasegebruiker). Poort 3306 gaat nooit publiek open. Een SSH-tunnel
   als eindvorm is afgevallen: de scripts bepalen het API-bron-IP uit de
   databaseverbinding en slaan de sessie-insert over zodra dat localhost
   is, terwijl het HTTPS-verzoek het publieke IP houdt. Een tunnel breekt
   daarmee juist de Paid- en Shipped-notificaties, tenzij dat mechanisme
   eerst apart wordt aangepast en getest. Hetzelfde geldt voor een
   overlaynetwerk zoals Tailscale (staat al op de Mac): prima voor SSH-
   en paneeltoegang in plaats van een thuis-IP in de firewall, maar voor
   het scriptpad verandert het database-bron-IP naar het overlay-adres
   terwijl de API-call het publieke IP houdt. Tailscale voor de scripts
   kan dus pas na een aparte, geslaagde test met een testorder, en hoort
   niet als vanzelfsprekende oplossing in de switch.
7. Backups: dagelijks bestanden plus database naar externe opslag, buiten
   Hostinger en buiten de VPS zelf, met een geteste terugzetting.

## 4. Harde randvoorwaarden

1. Geen onderhoudspagina en geen checkoutstop. De switch gebeurt in een
   rustig nachtvenster. Bezoekers met een actieve sessie kunnen hooguit
   hun winkelwagen kwijtraken; dat risico wordt vooraf benoemd en is bij
   dit ordervolume acceptabel, maar wordt niet weggemoffeld.
2. Geen enkele store mag eruit. De switch is één moment voor alle stores;
   de testmatrix in paragraaf 8 geldt per store.
3. Hostinger wordt pas opgezegd als de mailboxbeslissing is uitgevoerd,
   DNS stabiel is en de keten een volledige week groen heeft gedraaid.
   Tot die tijd blijft Hostinger als terugval bestaan en wordt er niet
   meer in gewerkt.
4. Secrets, wachtwoorden en API-keys komen nooit in dit plan, in Git of
   in een chat. Nieuwe inloggegevens gaan direct in de wachtwoordmanager.
5. Elke fase eindigt met een meetbaar resultaat. Een fase zonder groene
   controle wordt niet "waarschijnlijk goed" genoemd.

## 5. Fase 0: Serverinventaris compleet maken (alleen kijken)

Doel: de open punten uit paragraaf 2.10 sluiten. Geen wijzigingen.

1. In de OpenCart-admin: exacte versie, PHP-info (versie, extensies,
   memory_limit, max_execution_time, uploadlimieten, tijdzone) en de
   mailinstellingen per store exporteren of fotograferen. Een eerdere
   serveraudit van 2 oktober 2026 noemt versie 3.0.5.1; dat is een
   aanwijzing, geen bewijs, en de admin blijft de bron.
1b. Bestanden buiten `public_html` inventariseren: één map boven de
   webroot en in de storage-map zelf. Er kunnen daar losse eindpunten
   en geheime bestanden staan (een lokale review van 28 september
   2026 beschrijft een chat-eindpunt met een sleutel in platte tekst).
   Alles wat daar staat gaat op de overzetlijst of expliciet niet,
   en de sleutels erin worden bij de rotatiestap meegenomen. Ook
   vaststellen welke andere websites op hetzelfde Hostinger-account
   draaien (er zijn lokaal in elk geval mappen voor janoshik.co en
   purity-pharmaceuticals.nl): Hostinger opzeggen kan pas als voor
   elk van die sites een onderkomen is besloten.
2. `config.php` en `admin/config.php` uitlezen: alle `DIR_`-paden
   (vooral `DIR_STORAGE`, cache, download, sessie), databasehost en
   poort, en of de database lokaal op de Hostinger-account draait.
3. In hPanel: volledige bestands- en databasebackup downloaden naar de
   Mac en de download controleren op volledigheid (aantal bestanden,
   databasegrootte, uitleesbare dump). Cronjoblijst exporteren.
   Domeinenlijst met alle aliassen en subdomeinen vastleggen.
4. Per domein de volledige DNS-zone exporteren, inclusief MX, SPF,
   DMARC, DKIM-selector (via hPanel of via de header van een echte
   verzonden winkelmail), verificatie-records en autodiscovery. Ook de
   bestaande subdomeinen vastleggen (live bestaan in elk geval
   stacker.steroiden.com en stacker-preview.steroiden.com; welke
   preview- en testsubdomeinen er verder zijn, komt uit de zone-export,
   niet uit een veronderstelde lijst) en per subdomein beslissen of het
   meeverhuist of bewust buiten scope blijft.
- De werkelijke `.htaccess` per webroot downloaden en er een
   redirecttabel per host van maken: per regel de bron-URL, het doel en
   de statuscode zoals live gemeten. Er draaien hosts met eigen regels
   (live bevestigd op stacker-pro.com: `/betaalgegevens` geeft 301 naar
   `/betaalmethode` en `/shop` geeft 200, terwijl dezelfde paden op
   steroiden.com 404 geven). Die tabel wordt in Fase 3 regel voor regel
   naar Nginx vertaald en na de switch per regel getest. Alleen de
   SEO-rewrite overnemen is dus niet genoeg.
- DNSSEC controleren: staan er DS-records bij de registrar, dan gaan
   die er vóór de nameserverwijziging af en pas erna bij Cloudflare
   weer op. Live stonden er op 8 november 2026 geen DS-records op de
   gecontroleerde domeinen, dus dit is vermoedelijk een controle van
   een minuut, maar hij hoort erbij omdat een vergeten DS-record de
   hele zone onbereikbaar maakt.
5. Baseline per store vastleggen voor latere vergelijking: statuscodes
   en redirects van homepage, een categorie, een product, winkelwagen,
   checkout, admin-login, `robots.txt` en `sitemap.xml`; inhoud van
   `robots.txt` bewaren; responstijden noteren; screenshot van de
   homepage per store.
6. Databasefeiten: grootte, aantal orders/klanten/producten, hoogste
   `order_id`, en de tabellen die rond orders muteren (`oc_order`,
   `oc_order_product`, `oc_order_option`, `oc_order_total`,
   `oc_order_history`, `oc_customer`, `oc_address`, `oc_return`,
   `oc_cart`, de sessietabel, `oc_api_ip`, `oc_api_session`,
   coupon- en voucherhistorie en de voorraadkolom op `oc_product`).
   Neem ook de deelbetalingstatus Partial Paid (17) mee: die zit in de
   verwerkingsstatussen en kent in de keten een eigen marge en
   markering, en moet na de switch aantoonbaar blijven werken.
7. Mailbesluit nemen (optie A of B uit paragraaf 3.5) en, bij optie A,
   per store de SMTP-gegevens van de mailbox klaarleggen in de
   wachtwoordmanager. Bij optie B horen als expliciete stappen in
   Fase 2 en 3, dus vóór de eerste testmail: het VPS-adres aan de SPF
   van ieder shopdomein toevoegen en DKIM publiceren, en daarna de
   aflevering per store testen.
8. Extensie-inventaris per store afmaken in de admin zelf, omdat de
   export van oktober 2026 geen feed-extensies en alleen de settings
   van store 0 en 3 bevatte: welke verzendextensies aanstaan en welke
   maatwerkextensies er draaien, waaronder `spcoupon`. Voor betalen
   geldt het bevestigde uitgangspunt uit paragraaf 2 punt 8: alleen
   handmatige overboeking. Er hoeft dus geen betaalextensie te worden
   uitgezocht of getest; de enige betaalcontrole is dat de checkout na
   de verhuizing dezelfde overboekingsinstructies toont als ervoor
   (opgenomen in de testmatrix).
9. Credentialrotatie als eigen stap opnemen: in bestaande lokale
   bestanden staan inloggegevens en sleutels in platte tekst (waarden
   hier bewust niet herhaald). Admin-, API- en tokengeheimen worden
   rond de verhuizing geroteerd en alleen nog in de wachtwoordmanager
   bewaard.
10. Vastleggen wie de rollbackbeslissing mag nemen en bij welke fouten
   (paragraaf 9).

Uitkomst van Fase 0: een ingevulde inventarislijst. Pas dan is dit plan
zonder aannames uitvoerbaar.

## 6. Fase 1: Aanbieder kiezen en VPS klaarzetten

1. Aanbieders vergelijken op gemeten feiten, niet op overgenomen
   getallen: latency vanaf Amsterdam zelf meten via de looking glass
   van de aanbieder, bandbreedte van het pakket controleren
   (bijvoorbeeld Private Layer Q16, 2 dedicated cores, 8 GB, 100 GB
   NVMe, tegenover AlexHost Moldavië U4, 4 vCore, 8 GB, 80 GB NVMe op
   een gedeelde 100 Mbps-poort), en het backup-aanbod per pakket.
2. VPS bestellen met Ubuntu 24.04 LTS. Hostname en PTR-record neutraal
   kiezen, zonder shopdomein erin.
3. CloudPanel installeren met de officiële installatieopdracht
   inclusief de door CloudPanel gepubliceerde sha256-controle van het
   installatiescript, met MariaDB uit dezelfde serie als de huidige
   database (11.8; de patchversie op de VPS kan iets afwijken van
   11.8.9 en dat is prima). Direct daarna: admingebruiker
   aanmaken, 2FA aanzetten, poort 8443 en 22 in de firewall beperken
   tot het eigen IP. De noodtoegang van de aanbieder (console) testen
   voordat hij nodig is.
4. Externe backups koppelen en één testterugzetting uitvoeren op een
   lege testsite. Een backup die nooit is teruggezet telt niet.
   Aanvullend feit voor de planning: CloudPanel maakt zelf al elke
   nacht om 03:15 uur een lokale databasedump met 7 dagen retentie.
   Dat is een vangnet op dezelfde schijf, geen vervanging van de
   externe backups.
5. Volledige poortinventaris op de kale VPS (`ss -tulpn` en
   `ufw status verbose`): iedere luisterende dienst expliciet
   toestaan voor de juiste bron of dichtzetten, inclusief IPv6-besluit
   (geen AAAA naar de origin, v6-firewall gelijk aan v4).
6. Site aanmaken in CloudPanel voor de multistore-installatie: alle
   storedomeinen in één keer, PHP 8.3 met dezelfde extensies en limieten
   als de Hostinger-baseline uit Fase 0, eigen site user, document root
   noteren.

## 7. Fase 2: Cloudflare voorschakelen terwijl Hostinger nog draait

Per domein/zone, shop blijft volledig op Hostinger:

1. Domein toevoegen aan Cloudflare. De geïmporteerde DNS-zone
   record-voor-record vergelijken met de export uit Fase 0. Mailrecords
   blijven DNS-only; er mag geen enkel TXT-, MX- of subdomeinrecord
   ontbreken.
2. A-records voor apex en www proxied naar de echte origin van de
   Hostinger-account. Let op: de huidige DNS-antwoorden zijn
   CDN-edgeadressen van Hostinger zelf (per domein wisselend hCDN of
   LiteSpeed, meerdere A- en AAAA-antwoorden). Cloudflare naar een
   andere CDN-edge laten wijzen geeft lus- en cacherisico; het echte
   server-IP wordt uit hPanel gehaald en per domein bevestigd voordat
   er iets proxied wordt gezet. De stacker-pro.com-zone wijkt extra af
   (apex verwijst voor mail naar Google), dus die zone gaat record voor
   record handmatig over. SSL-modus op Full. Nog niet op Full (Strict)
   en nog geen HSTS;
   HSTS komt pas na bewezen stabiliteit omdat het niet terug te draaien
   is voor bezoekers die het hebben ontvangen.
3. Redirects per store exact zoals live gemeten (Fase 0-baseline),
   dus niet generiek www naar apex: voor stacker-pro.com is de
   canonical juist www. Bot- en beveiligingsregels zo instellen dat
   twee soorten productieverkeer nooit een challenge krijgen:
   scriptverkeer naar `index.php?route=api/` vanaf het eigen thuis-IP,
   en het n8n-dripverkeer naar
   `index.php?route=extension/total/spcoupon/drip` op store 3 vanuit
   n8n Cloud. Bot Fight Mode gaat op het gratis Cloudflare-plan
   volledig UIT: die stand kan met skip-regels niet per pad worden
   uitgezonderd, dus "uitzonderen of uit" is geen keuze, alleen uit
   werkt.
4. Cache-uitsluitingen: URL's met checkout, cart, account, admin en api
   in pad of querystring altijd bypass.
5. Nameservers omzetten naar Cloudflare en wachten tot de zone actief
   is. Daarna per store de baseline uit Fase 0 opnieuw meten en gelijk
   trekken: alles moet identiek werken aan vóór Cloudflare.
6. Registrarverhuizing, als die gewenst is, pas na deze hele
   migratie en als apart traject.

## 8. Fase 3: Shop kopiëren en op de VPS bewijzen

1. Bestanden overzetten als site user, niet als root: de volledige
   webroot plus de echte storage-map op het pad dat `config.php`
   aanwijst. Daarna rechten controleren als site user: mappen 755,
   bestanden 644, alleen storage, cache en uploadmappen schrijfbaar
   voor de PHP-FPM-gebruiker.
2. Database importeren in de nieuwe MariaDB, via de commandline en
   niet via phpMyAdmin (CloudPanel waarschuwt zelf dat phpMyAdmin een
   database kan beschadigen bij import/export): als site user met
   `clpctl db:import --databaseName=... --file=dump.sql.gz`, en de
   exitstatus controleren. `config.php` en `admin/config.php`
   aanpassen: databasegegevens en alle paden. Mailinstelling per store
   direct op de in Fase 0 gekozen optie zetten. Ook de rest van de
   maatwerklijst uit de handover hoort op de overzetchecklist, niet
   alleen de twee shopmail-bestanden: `catalog/controller/mail/order.php`,
   `catalog/controller/api/order.php`,
   `catalog/model/checkout/order.php` en de aangepaste adminbestanden.
   Daarna de redirecttabel uit Fase 0 punt 11 regel voor regel in
   dezelfde Vhost vertalen en de vertaling bewaren voor de test in
   Fase 5.
3. Nginx-configuratie uitsluitend via de CloudPanel Vhost Editor (een
   handmatig gewijzigd bestand wordt door CloudPanel overschreven).
   De bestaande `location /` wordt vervangen, nooit aangevuld met een
   tweede. Kern van de configuratie:

```
location / {
    try_files $uri $uri/ @opencart;
}

location @opencart {
    rewrite ^/(.+)$ /index.php?_route_=$1 last;
}

location = /sitemap.xml {
    rewrite ^(.*)$ /index.php?route=extension/feed/google_sitemap last;
}

location ^~ /system/storage/ {
    return 404;
}

location ~* \.(tpl|twig|ini|log)$ {
    return 404;
}

location ~ /\.(?!well-known) {
    return 404;
}
```

   De sitemap-route hierboven is de OpenCart 3-route uit de
   geïnstalleerde feed-extensie; bij afwijking geldt de route uit de
   eigen admin, niet dit voorbeeld.
4. Echt bron-IP herstellen in dezelfde Vhost, zodat OpenCart en de API
   het echte afzender-IP zien in plaats van een Cloudflare-IP. Let op
   de wisselwerking met Fase 4: zodra real-IP het bezoekersadres
   herschrijft, toetsen allow/deny-regels dat bezoekersadres in plaats
   van het Cloudflare-peeradres (gedocumenteerd gedrag in Nginx en
   gemeld in de CloudPanel-community). Na het aanzetten van real-IP
   moet de "alleen Cloudflare"-controle dus opnieuw worden getest,
   zowel via het domein als met een directe IP-poging; als ze elkaar
   bijten, wordt de controle op het peer-adres ingericht in plaats van
   de site-toggle en de toggle alleen te gebruiken:

```
set_real_ip_from <alle actuele Cloudflare-ranges, IPv4 en IPv6>;
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

5. Testen vanaf de eigen machine via een tijdelijke hosts-verwijzing,
   per store: homepage, categorie en product met SEO-URL, zoeken,
   winkelwagen, complete testbestelling met een gemarkeerd testadres,
   klantmail uit de nieuwe server ontvangen, admin inclusief Track &
   Trace-veld, afbeelding uploaden, sitemap-XML met producten, en
   controleren dat `/system/storage/` 404 geeft en een `.twig`-pad niet
   downloadbaar is. OCMod-cache vernieuwen en controleren dat de drie
   OCMods actief zijn en het maatwerk (shopmail, trackingbadge,
   non-www redirect) werkt.
6. Scripttests tegen de testomgeving: het bestaande testscript van de
   MyParcel-afronding draaien (`myparcel_afronding.py --dry-run` en
   `opencart_client.test_connection()` bestaan daarvoor), plus één
   handmatige test van de API-notificatie (order op Paid zetten voor
   de testorder) om te bewijzen dat databasepad, APIpad en
   bron-IP-controle werken. Hosts-verwijzing daarna direct weer
   verwijderen.
7. OCMod-waarschuwing: klik tijdens en na de overzet niet op Refresh
   bij Modifications voordat is vastgesteld hoe de inhoud van
   `storage/modification/` tot stand kwam. Die map kan met de hand
   aangepaste bestanden bevatten die in geen enkele geregistreerde
   modificatie terug te vinden zijn; een refresh bouwt de map opnieuw
   op uit de geregistreerde modificaties en kan zulke patches
   ongedaan maken. De inhoud gaat dus één op één mee en wordt vooraf
   en achteraf vergeleken (verschilrapport bewaren).

## 9. Fase 4: Afschermen (volgorde is onderdeel van de beveiliging)

1. Certificaatstrategie eerst uitwerken, want er zit een constructie
   in die niet kan: één Cloudflare Origin CA-certificaat voor namen
   uit meerdere zones bestaat niet, een Origin CA-certificaat hoort
   bij één zone. Tegelijk kan één CloudPanel-site maar één
   certificaat laden terwijl de multistore-domeinen in meerdere
   zones staan. Keuze vóór Fase 4, met test: of per zone een eigen
   site in CloudPanel op dezelfde document root en database, of één
   openbaar vertrouwd certificaat met alle namen erop via een
   DNS-challenge. Origin CA-certificaat daarna per zone aanmaken
   voor apex en wildcard en installeren in CloudPanel.
2. Zone-level Authenticated Origin Pulls per Cloudflare-zone: eigen
   clientcertificaat uploaden, CA-bestand op de VPS plaatsen en in de
   Vhost eerst instellen op `ssl_verify_client optional;`. Via het
   echte domein over Cloudflare testen. Pas als dat groen is:
   `ssl_verify_client on;` en opnieuw testen.
3. Catch-all voor onbekende SNI op poort 443 (handshake afwijzen) en
   poort 80 (direct sluiten), zo ingericht dat het een
   CloudPanel-regeneratie overleeft; na iedere panelwijziging opnieuw
   controleren. Nginx-versie moet 1.19.4 of hoger zijn.
4. Tweede firewalllaag: de site-instelling "Allow traffic from
   Cloudflare only" aanzetten (Nginx-laag, CloudPanel houdt de lijst
   bij) én UFW-regels met de actuele Cloudflare-CIDR's voor poort 80
   en 443, IPv4 en IPv6, plus een vaste procedure om die lijst
   periodiek bij te werken.
5. Cloudflare SSL-modus nu pas op Full (Strict) zetten.
6. Vanaf een extern netwerk (niet het thuisnetwerk) testen: kaal VPS-IP
   op 443 zonder SNI geeft geen certificaat, poort 80 geeft niets,
   8443 is onbereikbaar, en alle shops werken normaal via Cloudflare.
   Verwachting expliciet: rechtstreeks testen op het IP hoort nu te
   falen; wie dat als storing behandelt, sloopt de afscherming.

## 10. Fase 5: Omschakeling (nachtvenster)

1. Venster kiezen: nacht, doordeweeks, zodat de ochtendketen van 10:15
   uur als natuurlijke eindtest dient. Starttijd en hoogste `order_id`
   noteren vóór de export.
2. Voorafgaand aan de nacht: de ochtendketen stilzetten zodat er geen
   bekende schrijver actief is tijdens het venster
   (`launchctl unload` van de launchd-agent), en geen handmatige
   adminwijzigingen meer doen. De keten wordt pas weer geladen na de
   groene controles in stap 6.
3. Laatste bestandssynchronisatie (alleen gewijzigde bestanden) en een
   verse database-export van Hostinger; importeren op de VPS met
   dezelfde `clpctl db:import`-route als in Fase 3, daarna de
   SMTP-instellingen per store opnieuw controleren omdat de import de
   database-instellingen van de proefomgeving terugzet. Steekproef:
   aantallen orders, klanten en producten oud tegen nieuw gelijk.
4. In Cloudflare per zone de A-records omzetten naar het VPS-IP.
   Omdat al het verkeer al via Cloudflare loopt, is dit aan de edge
   vrijwel direct actief; er is geen DNS-propagatie naar bezoekers.
5. Directe acceptatietest vanaf een ander netwerk dan thuis, per
   store: homepage, product, testbestelling, order zichtbaar in de
   nieuwe admin met echt klant-IP, klantmail ontvangen, sitemap laadt,
   www-redirect klopt, geen 5xx in de Nginx- en PHP-logs.
6. Ketenacceptatie nog dezelfde nacht, maar NOOIT door de echte
   ochtendketen of `daily_pro.py` te draaien: een handmatige run zet
   dagstempels en afsluitvlaggen en blokkeert daarmee de echte run van
   die dag, en verwerkt bovendien een halve nachtbatch definitief.
   In plaats daarvan: de bestaande testscripts draaien, plus per store
   de Paid-notificatie uitsluitend op de eigen testorder aanroepen via
   de losse scriptfunctie, inclusief een handmatige
   `myparcel_afronding.py`-run zonder echte labelaanmaak. De eerste
   echte ketenbewijsrun is de normale 10:15-run op de eerstvolgende
   werkdag; bij een switch in het weekend schuift dat bewijs dus naar
   maandag en blijft Hostinger tot dan onaangeroerd als terugval.
7. Nacontrole na 10 minuten en de volgende ochtend vóór 10:15 uur:
   op de oude database vergelijken wat er vanaf de genoteerde
   starttijd is veranderd in de tabellen uit Fase 0.6. Ontbrekende
   rijen worden als SQL overgezet met behoud van het oorspronkelijke
   `order_id` en alle gekoppelde tabellen; daarna de auto-increment
   van `oc_order` boven het hoogste overgezette nummer zetten. Nooit
   een order met de hand overtypen in de nieuwe admin (dat geeft een
   nieuw nummer en breekt de bankreferentie). Per overgezette order
   vastleggen of de klantmail al door de oude shop was verstuurd.
8. Rollback: zolang er op de nieuwe database geen echte orders staan,
   is terugzetten de A-records terugwijzigen én de scriptkant
   terugzetten. De gedeelde `.env` (telegram-bot, weekly funnel en de
   scripts lezen hetzelfde bestand en procesvariabelen gaan vóór op
   het bestand) wordt tijdens de switch pas op het allerlaatste
   moment omgezet, met de oude waarden bewaard, zodat terugdraaien
   één handeling is. Zodra er echte nieuwe orders zijn, is rollback
   een databasesamenvoeging en beslist uitsluitend de in Fase 0
   benoemde persoon, op basis van vooraf benoemde fouten (shop
   onbereikbaar, checkout stuk, mail stuk, keten stuk).

## 11. Fase 6: Eerste week en definitieve afronding

1. Hostinger minimaal 7 dagen onaangeroerd laten staan als terugval;
   er wordt niet meer in gewerkt.
2. Iedere ochtend vóór 10:15 uur controleren dat de keten van die dag
   nog op de nieuwe inrichting uitkomt; na de eerste echte
   ketenrun de logs van die run volledig nalezen.
3. Dag 2 tot en met 7: Nginx- en PHP-foutlogs, OpenCart-foutlog,
   mailaflevering (steekproef per store), responstijden tegen de
   baseline, en een externe scantest op het kale IP herhalen.
   Bij de mailsteekproef hoort ook de headercontrole: in de ontvangen
   testmail (origineel weergeven) mag het fysieke VPS-IP niet in de
   `Received:`-regels staan. SMTP-inlog vanaf de VPS kan dat IP
   namelijk alsnog in de header zetten, ook als de verzendende
   mailserver een andere is; dit is dus een meting, geen aanname.
4. Pas daarna, en pas als de mailboxbeslissing is uitgevoerd en DNS
   stabiel is: Hostinger-webhosting opzeggen. Het mailproduct alleen
   opzeggen als de mailboxen aantoonbaar elders draaien.
5. Een week na de switch dit plan bijwerken met de werkelijke
   uitkomsten en de inventaris uit Fase 0 als nieuwe bron van waarheid
   bewaren.

## 12. Testmatrix per store (elke rij groen, anders geen livegang)

Voor steroiden.com, anabolenkopen.nl, afslank-injecties.nl en
www.stacker-pro.com (store 3 is verplicht in scope, want de actieve
dripcampagne leest daar orders en coupons via de `spcoupon`-extensie):

1. Homepage, categorie en product via SEO-URL geven 200; onbekende URL
   geeft 404; www en http redirecten exact zoals in de baseline.
2. `robots.txt` is identiek aan de baseline en `sitemap.xml` geeft de
   dynamische XML met producten.
3. Winkelwagen vullen, checkout openen en een gemarkeerde
   testbestelling plaatsen. De checkout toont daarbij alleen de
   overboekingsinstructies, zoals vóór de verhuizing; er hoort geen
   betaalprovider-stap of externe betaalpagina te verschijnen.
4. Testorder verschijnt in de admin met het echte klant-IP, de
   juiste store en het juiste ordernummer.
5. Klant ontvangt de bestelbevestiging van de nieuwe server, met de
   juiste huisstijl van die store.
6. Testorder via de losse scriptfunctie op Paid zetten geeft de
   betaald-mail; daarna handmatig `myparcel_afronding.py` draaien zet
   hem op Shipped en geeft de verzendmail met Track & Trace-opmaak.
   Een deelbetaalde testorder (status 17) doorloopt dezelfde controle.
7. Dripcampagne op store 3: het `spcoupon/drip`-endpoint antwoordt de
   n8n-aanroep correct (orders en coupons), zonder Cloudflare-challenge.
8. Admin: inloggen, orderhistorie met trackingbadge, afbeelding
   uploaden, OCMods actief.
9. `/system/storage/` geeft 404 en templatebestanden zijn niet te
   downloaden.

## 13. Bewust niet doen

1. Geen registrarverhuizing tegelijk met deze migratie.
2. Geen HSTS aanzetten tot de nieuwe inrichting bewezen stabiel is.
3. Geen poort 3306 publiek openzetten voor de Mac-scripts.
4. Geen bestanden uploaden als root en geen rechten repareren over de
   hele homedir; alleen als site user werken en gericht herstellen.
5. Geen tweede `location /` in de Vhost plakken en geen
   Nginx-bestanden buiten de Vhost Editor om bewerken.
6. Geen echte MyParcel-labels aanmaken tijdens tests.
7. Geen nieuwe OpenCart-statussen, geen wijzigingen aan de
   mailtemplates en geen andere "verbeteringen" meenemen in deze
   verhuizing. Verhuizen is het enige doel; verbeteren komt daarna.
