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
5. n8n draait op n8n Cloud. De actieve workflows bedienen de Wix-kant van
   Stacker Pro (dripcampagne en directe mail na betaling, contactformulier).
   Alle OpenCart-varianten van die workflows staan uit. De lokale n8n op de
   Mac is alleen een testinstantie.
6. De ochtendketen draait op de Mac van de eigenaar: launchd-agent
   `com.stackerpro.ochtendketen`, doordeweeks vanaf 10:15 uur met
   herhaalpogingen. Keten: `ochtendketen.py` stuurt `daily_pro.py` aan;
   die matcht bankbetalingen over de OpenCart-stores en Wix, maakt exports
   en zet orders op Paid. `myparcel_afronding.py` draait daarbinnen mee:
   haalt MyParcel-zendingen op, zet betaalde orders op Shipped en triggert
   de verzendmail.
7. De scripts werken op twee manieren tegen de shops:
   a. Rechtstreeks op de database, vanaf de Mac, via PyMySQL met de
      `OPENCART_DB_HOST/PORT/NAME/USER`-instellingen uit een `.env`
      buiten de scriptsmap.
   b. Via HTTPS per storedomein naar
      `index.php?route=api/order/history`, met een zelf aangemaakte
      `oc_api_session`. OpenCart controleert daarbij het bron-IP; het
      script schrijft het database-bron-IP vooraf in `oc_api_ip`.
8. Betalingen zijn handmatige bankoverschrijvingen (PayTail-matching in de
   keten). Er zijn geen betaalprovider-webhooks.
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
   www-naar-apex redirect behouden zoals live gemeten, geen caching op
   checkout, winkelwagen, account, admin en API-paden.
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
   databasegebruiker; een SSH-tunnel is de nette eindvorm). Poort 3306
   gaat nooit publiek open.
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
   mailinstellingen per store exporteren of fotograferen.
2. `config.php` en `admin/config.php` uitlezen: alle `DIR_`-paden
   (vooral `DIR_STORAGE`, cache, download, sessie), databasehost en
   poort, en of de database lokaal op de Hostinger-account draait.
3. In hPanel: volledige bestands- en databasebackup downloaden naar de
   Mac en de download controleren op volledigheid (aantal bestanden,
   databasegrootte, uitleesbare dump). Cronjoblijst exporteren.
   Domeinenlijst met alle aliassen en subdomeinen vastleggen.
4. Per domein de volledige DNS-zone exporteren, inclusief MX, SPF,
   DMARC, DKIM-selector (via hPanel of via de header van een echte
   verzonden winkelmail), verificatie-records en autodiscovery.
5. Baseline per store vastleggen voor latere vergelijking: statuscodes
   en redirects van homepage, een categorie, een product, winkelwagen,
   checkout, admin-login, `robots.txt` en `sitemap.xml`; inhoud van
   `robots.txt` bewaren; responstijden noteren; screenshot van de
   homepage per store.
6. Databasefeiten: grootte, aantal orders/klanten/producten, hoogste
   `order_id`, en de tabellen die rond orders muteren (`oc_order`,
   `oc_order_product`, `oc_order_total`, `oc_order_history`,
   `oc_customer`, `oc_address`, `oc_return`, voorraad).
7. Mailbesluit nemen (optie A of B uit paragraaf 3.5) en, bij optie A,
   per store de SMTP-gegevens van de mailbox klaarleggen in de
   wachtwoordmanager.
8. Vastleggen wie de rollbackbeslissing mag nemen en bij welke fouten
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
   installatiescript, met MariaDB. Direct daarna: admingebruiker
   aanmaken, 2FA aanzetten, poort 8443 en 22 in de firewall beperken
   tot het eigen IP. De noodtoegang van de aanbieder (console) testen
   voordat hij nodig is.
4. Externe backups koppelen en één testterugzetting uitvoeren op een
   lege testsite. Een backup die nooit is teruggezet telt niet.
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
2. A-records voor apex en www proxied naar het huidige Hostinger-IP.
   SSL-modus op Full. Nog niet op Full (Strict) en nog geen HSTS;
   HSTS komt pas na bewezen stabiliteit omdat het niet terug te draaien
   is voor bezoekers die het hebben ontvangen.
3. Redirects exact zoals live gemeten: www naar apex (301) en http naar
   https. Bot- en beveiligingsregels zo instellen dat scriptverkeer
   naar `index.php?route=api/` vanaf het eigen thuis-IP nooit een
   challenge krijgt; Bot Fight Mode op die paden uitzonderen of uit.
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
2. Database importeren in de nieuwe MariaDB. `config.php` en
   `admin/config.php` aanpassen: databasegegevens en alle paden.
   Mailinstelling per store direct op de in Fase 0 gekozen optie zetten.
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
   het echte afzender-IP zien in plaats van een Cloudflare-IP:

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
   MyParcel-afronding draaien en één handmatige test van de
   API-notificatie (order op Paid zetten voor de testorder) om te
   bewijzen dat databasepad, APIpad en bron-IP-controle werken.
   Hosts-verwijzing daarna direct weer verwijderen.

## 9. Fase 4: Afschermen (volgorde is onderdeel van de beveiliging)

1. Origin CA-certificaat aanmaken voor apex en wildcard en installeren
   in CloudPanel.
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
2. Laatste bestandssynchronisatie (alleen gewijzigde bestanden) en een
   verse database-export van Hostinger; importeren op de VPS.
   Steekproef: aantallen orders, klanten en producten oud tegen nieuw
   gelijk.
3. In Cloudflare per zone de A-records omzetten naar het VPS-IP.
   Omdat al het verkeer al via Cloudflare loopt, is dit aan de edge
   vrijwel direct actief; er is geen DNS-propagatie naar bezoekers.
4. Directe acceptatietest vanaf een ander netwerk dan thuis, per
   store: homepage, product, testbestelling, order zichtbaar in de
   nieuwe admin met echt klant-IP, klantmail ontvangen, sitemap laadt,
   www-redirect klopt, geen 5xx in de Nginx- en PHP-logs.
5. Ketenacceptatie nog dezelfde nacht, handmatig gestart: één
   ochtendketen-testcyclus met de testorders, inclusief Paid-zetten
   via de API en een MyParcel-controle zonder echte labelaanmaak.
   Pas daarna geldt de switch als technisch geslaagd.
6. Nacontrole na 10 minuten en de volgende ochtend vóór 10:15 uur:
   op de oude database vergelijken wat er vanaf de genoteerde
   starttijd is veranderd in de tabellen uit Fase 0.6. Ontbrekende
   rijen worden als SQL overgezet met behoud van het oorspronkelijke
   `order_id` en alle gekoppelde tabellen; daarna de auto-increment
   van `oc_order` boven het hoogste overgezette nummer zetten. Nooit
   een order met de hand overtypen in de nieuwe admin (dat geeft een
   nieuw nummer en breekt de bankreferentie). Per overgezette order
   vastleggen of de klantmail al door de oude shop was verstuurd.
7. Rollback: zolang er op de nieuwe database geen echte orders staan,
   is terugzetten alleen de A-records terugwijzigen. Zodra er echte
   nieuwe orders zijn, is rollback een databasesamenvoeging en beslist
   uitsluitend de in Fase 0 benoemde persoon, op basis van vooraf
   benoemde fouten (shop onbereikbaar, checkout stuk, mail stuk,
   keten stuk).

## 11. Fase 6: Eerste week en definitieve afronding

1. Hostinger minimaal 7 dagen onaangeroerd laten staan als terugval;
   er wordt niet meer in gewerkt.
2. Iedere ochtend vóór 10:15 uur controleren dat de keten van die dag
   nog op de nieuwe inrichting uitkomt; na de eerste echte
   ketenrun de logs van die run volledig nalezen.
3. Dag 2 tot en met 7: Nginx- en PHP-foutlogs, OpenCart-foutlog,
   mailaflevering (steekproef per store), responstijden tegen de
   baseline, en een externe scantest op het kale IP herhalen.
4. Pas daarna, en pas als de mailboxbeslissing is uitgevoerd en DNS
   stabiel is: Hostinger-webhosting opzeggen. Het mailproduct alleen
   opzeggen als de mailboxen aantoonbaar elders draaien.
5. Een week na de switch dit plan bijwerken met de werkelijke
   uitkomsten en de inventaris uit Fase 0 als nieuwe bron van waarheid
   bewaren.

## 12. Testmatrix per store (elke rij groen, anders geen livegang)

Voor steroiden.com, anabolenkopen.nl, afslank-injecties.nl en, als
store 3 actief meedraait, www.stacker-pro.com:

1. Homepage, categorie en product via SEO-URL geven 200; onbekende URL
   geeft 404; www en http redirecten exact zoals in de baseline.
2. `robots.txt` is identiek aan de baseline en `sitemap.xml` geeft de
   dynamische XML met producten.
3. Winkelwagen vullen, checkout openen en een gemarkeerde
   testbestelling plaatsen.
4. Testorder verschijnt in de admin met het echte klant-IP, de
   juiste store en het juiste ordernummer.
5. Klant ontvangt de bestelbevestiging van de nieuwe server, met de
   juiste huisstijl van die store.
6. Testorder via de keten op Paid zetten geeft de betaald-mail; via de
   MyParcel-afronding op Shipped zetten geeft de verzendmail met
   Track & Trace-opmaak.
7. Admin: inloggen, orderhistorie met trackingbadge, afbeelding
   uploaden, OCMods actief.
8. `/system/storage/` geeft 404 en templatebestanden zijn niet te
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
