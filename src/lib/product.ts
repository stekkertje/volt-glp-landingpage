export type ProductSlug =
  | "retatrutide-10mg"
  | "retatrutide-20mg-pen"
  | "semaglutide-2mg"
  | "semaglutide-4mg-pen"
  | "tirzepatide-10mg"
  | "tirzepatide-20mg-pen";

export type Subcat = "Semaglutide" | "Tirzepatide" | "Retatrutide";

export type ProductOption = {
  id: string;
  label: string;
  priceCents: number;
  compareAtCents?: number;
};

export type Product = {
  id: number;
  slug: ProductSlug;
  name: string;
  listing: string;
  brand: string;
  subcat: Subcat;
  form: "vial" | "pen";
  unit: string;
  priceCents: number;
  compareAtCents?: number;
  rating: number;
  reviewCount: number;
  badges: string[];
  weekdeal?: boolean;
  bestseller?: boolean;
  isNew?: boolean;
  images: { src: string; alt: string }[];
  shortPitch: string;
  highlights: string[];
  composition: { label: string; value: string }[];
  usageNote: string;
  doseBeginner: string;
  doseAdvanced: string;
  frequency: string;
  weeksAtStart: number;
  options: ProductOption[];
};

export const SYRINGE_PACK_COUNT = 10;

export const SITE = {
  brand: "Afslank-injecties.nl",
  category: "Afvallen met medicatie",
  tagline: "Semaglutide · Tirzepatide · Retatrutide",
  headline: "Afslanken met injecties.",
  shortPitch:
    "Keuze uit de drie sterkste en meest populaire producten. Veilige en discrete verzending naar NL en BE.",
  rating: 4.8,
  reviewCount: 1024,
  shippingCents: 495,
  freeShippingCents: 10000,
  maxLineQuantity: 10,
  maxOrderQuantity: 90,
  cutoffHour: 23,
} as const;

export const SUBCATS: { id: Subcat | "all"; label: string; hash: string }[] = [
  { id: "all", label: "Alles", hash: "producten" },
  { id: "Semaglutide", label: "Semaglutide", hash: "semaglutide" },
  { id: "Tirzepatide", label: "Tirzepatide", hash: "tirzepatide" },
  { id: "Retatrutide", label: "Retatrutide", hash: "retatrutide" },
];

function imgs(slug: string, files: string[], alts: string[]) {
  return files.map((file, i) => ({
    src: `/images/producten/${file}`,
    alt: alts[i] ?? `${slug} foto ${i + 1}`,
  }));
}

const PRODUCT_LIST: Product[] = [
  {
    id: 46,
    slug: "retatrutide-10mg",
    name: "Retatrutide 10mg",
    listing: "Retatrutide 10mg · Bio Amino Labs",
    brand: "Bio Amino Labs",
    subcat: "Retatrutide",
    form: "vial",
    unit: "10 mg",
    priceCents: 9700,
    rating: 4.9,
    reviewCount: 211,
    badges: [],
    images: imgs(
      "retatrutide-10mg",
      ["retatrutide-10mg__01__800.webp", "retatrutide-10mg__02__800.webp"],
      ["Retatrutide 10mg vial voorkant", "Retatrutide 10mg vial detail"],
    ),
    shortPitch:
      "Nieuwste GLP-1 in vialvorm. Triple agonist voor wie een sterkere opvolger van Semaglutide of Tirzepatide zoekt.\n\nJe mengt zelf met het bijgeleverde bac water en zet één keer per week. Extra grip op eetlust, stofwisseling en vetverbranding, zonder kant-en-klare pen.",
    highlights: [
      "Sneller metabolisme en minder eetlust",
      "Voor gebruikers die sterk willen afvallen",
      "Ondersteunt bloedsuiker en stoelgang",
      "Tot 40% krachtiger dan Semaglutide en Tirzepatide",
    ],
    composition: [
      { label: "Merk", value: "Bio Amino Labs" },
      { label: "Inhoud", value: "10mg vial - 2ml water" },
      { label: "Sterkte", value: "Retatrutide 10 mg" },
      { label: "Toediening", value: "Subcutane injectie" },
    ],
    usageNote: "Bouw de dosering rustig op om bijwerkingen te beperken.",
    doseBeginner: "2,5 mg per week",
    doseAdvanced: "5 mg per week",
    frequency: "1 injectie per week",
    weeksAtStart: 4,
    options: [
      {
        id: "none",
        label: "Geen extra's",
        priceCents: 9700,
      },
      {
        id: "syringes",
        label: "10 insulinespuiten",
        priceCents: 9900,
      },
    ],
  },
  {
    id: 47,
    slug: "retatrutide-20mg-pen",
    name: "Retatrutide 20mg - Pen",
    listing: "Retatrutide 20mg · kant-en-klare pen",
    brand: "Bio Amino Labs",
    subcat: "Retatrutide",
    form: "pen",
    unit: "20 mg",
    priceCents: 17600,
    compareAtCents: 22000,
    rating: 4.8,
    reviewCount: 59,
    badges: ["Weekdeal −20%", "Nieuw"],
    weekdeal: true,
    isNew: true,
    images: imgs(
      "retatrutide-20mg-pen",
      [
        "retatrutide-20mg-pen__01__800.webp",
        "retatrutide-20mg-pen__02__800.webp",
        "retatrutide-20mg-pen__03__800.webp",
        "retatrutide-20mg-pen__04__800.webp",
        "retatrutide-20mg-pen__05__800.webp",
      ],
      [
        "Retatrutide 20mg pen verpakking",
        "Retatrutide 20mg pen inhoud",
        "Retatrutide 20mg pen detail",
        "Retatrutide 20mg pen naalden",
        "Retatrutide 20mg pen gebruiksklaar",
      ],
    ),
    shortPitch:
      "Kant-en-klare pen. Triple agonist (GLP-1, GIP en glucagon) zonder vials mengen.\n\nDe pen is vooraf gevuld: geen afmeten, geen mengfout. Eén wekelijkse injectie, met naalden en handleiding in de doos.",
    highlights: [
      "Doorbreekt plateaus als andere middelen minder doen",
      "Drie hormoonpaden: GLP-1, GIP en glucagon",
      "Ondersteunt vetverbranding naast eetlustremming",
      "Pen, geen foutmarge bij mengen",
    ],
    composition: [
      { label: "Retatrutide pen", value: "20 mg" },
      { label: "Pennaalden", value: "4 stuks" },
      { label: "Handleiding", value: "Inbegrepen" },
    ],
    usageNote: "Aanbevolen dosering: 2,5 tot 5 mg per week.",
    doseBeginner: "2,5 mg per week",
    doseAdvanced: "5 mg per week",
    frequency: "1 injectie per week",
    weeksAtStart: 8,
    options: [],
  },
  {
    id: 48,
    slug: "semaglutide-2mg",
    name: "Semaglutide 2mg",
    listing: "Semaglutide 2 mg · Bio Amino Labs",
    brand: "Bio Amino Labs",
    subcat: "Semaglutide",
    form: "vial",
    unit: "2 mg",
    priceCents: 8500,
    rating: 4.5,
    reviewCount: 33,
    badges: [],
    images: imgs(
      "semaglutide-2mg",
      [
        "semaglutide-2mg__01__800.jpg",
        "semaglutide-2mg__02__800.webp",
        "semaglutide-2mg__03__800.jpeg",
        "semaglutide-2mg__04__800.jpeg",
        "semaglutide-2mg__05__800.jpeg",
      ],
      [
        "Semaglutide 2mg vial voorkant",
        "Semaglutide 2mg doos",
        "Semaglutide 2mg label",
        "Semaglutide 2mg detail",
        "Semaglutide 2mg inhoud",
      ],
    ),
    shortPitch:
      "Instap-vial voor langdurig vetverlies, minder honger en een rustiger eetpatroon.\n\nJe start laag en bouwt op in een wekelijks ritme. Bac water zit bij de vial; extra insulinespuiten kies je erbij als je die nodig hebt.",
    highlights: [
      "Ondersteunt gewichtsverlies",
      "Minder hongergevoel",
      "Helpt de stofwisseling",
      "Eén wekelijkse injectie",
    ],
    composition: [
      { label: "Merk", value: "Bio Amino Labs" },
      { label: "Inhoud", value: "2mg vial - 2ml water" },
      { label: "Sterkte", value: "Semaglutide 2 mg" },
      { label: "Toediening", value: "Subcutane injectie" },
    ],
    usageNote: "Aanbevolen dosering: 0,25 tot 0,75 mg per week.",
    doseBeginner: "0,25 mg per week",
    doseAdvanced: "0,75 mg per week",
    frequency: "1 injectie per week",
    weeksAtStart: 8,
    options: [
      { id: "none", label: "Geen extra's", priceCents: 8500 },
      { id: "syringes", label: "10 insulinespuiten", priceCents: 8750 },
    ],
  },
  {
    id: 49,
    slug: "semaglutide-4mg-pen",
    name: "Semaglutide 4mg - Pen",
    listing: "Semaglutide 4 mg · kant-en-klare pen",
    brand: "Bio Amino Labs",
    subcat: "Semaglutide",
    form: "pen",
    unit: "4 mg",
    priceCents: 16900,
    rating: 4.9,
    reviewCount: 287,
    badges: ["Bestseller"],
    bestseller: true,
    images: imgs(
      "semaglutide-4mg-pen",
      [
        "semaglutide-4mg-pen__01__800.webp",
        "semaglutide-4mg-pen__02__800.webp",
        "semaglutide-4mg-pen__03__800.webp",
      ],
      [
        "Semaglutide 4mg pen voorkant",
        "Semaglutide 4mg pen inhoud",
        "Semaglutide 4mg pen naalden",
      ],
    ),
    shortPitch:
      "Meest gekozen pen. Vooraf gevuld, geen vials, één wekelijkse klik.\n\nHandig als je net begint: vaste dosering, 4 pennaalden en een handleiding in de doos. Geen mengen of zelf afmeten.",
    highlights: [
      "Gewicht en eetlust in één ritme",
      "Geen mengen of afmeten uit een vial",
      "4 mg pen plus 4 pennaalden",
      "Handleiding in de doos",
    ],
    composition: [
      { label: "Semaglutide pen", value: "4 mg" },
      { label: "Pennaalden", value: "4 stuks" },
      { label: "Handleiding", value: "Inbegrepen" },
    ],
    usageNote: "Aanbevolen dosering: 0,25 tot 1 mg per week.",
    doseBeginner: "0,25 mg per week",
    doseAdvanced: "1 mg per week",
    frequency: "1 injectie per week",
    weeksAtStart: 16,
    options: [],
  },
  {
    id: 76,
    slug: "tirzepatide-10mg",
    name: "Tirzepatide 10mg",
    listing: "Tirzepatide 10mg · Bio Amino Labs",
    brand: "Bio Amino Labs",
    subcat: "Tirzepatide",
    form: "vial",
    unit: "10 mg",
    priceCents: 9400,
    compareAtCents: 12000,
    rating: 4.3,
    reviewCount: 152,
    badges: ["Korting −22%"],
    images: imgs(
      "tirzepatide-10mg",
      ["tirzepatide-10mg__01__800.webp", "tirzepatide-10mg__02__800.webp"],
      ["Tirzepatide 10mg vial voorkant", "Tirzepatide 10mg vial detail"],
    ),
    shortPitch:
      "Dubbele werking (GLP-1 en GIP). Minder cravings, meer controle, vial van 10 mg.\n\nJe doseert zelf uit de vial. Extra grip op eetlust en bloedsuiker, met bac water in de verpakking.",
    highlights: [
      "Effectief en duurzaam gewichtsverlies",
      "Minder eetlust en cravings",
      "Stabielere bloedsuikerspiegel",
      "Vial plus 2 ml bac water",
    ],
    composition: [
      { label: "Merk", value: "Bio Amino Labs" },
      { label: "Inhoud", value: "10mg vial - 2ml water" },
      { label: "Sterkte", value: "Tirzepatide 10 mg" },
      { label: "Toediening", value: "Subcutane injectie" },
    ],
    usageNote: "Bouw de dosering rustig op om bijwerkingen te beperken.",
    doseBeginner: "2,5 mg per week",
    doseAdvanced: "5 mg per week",
    frequency: "1 injectie per week",
    weeksAtStart: 4,
    options: [
      {
        id: "none",
        label: "Geen extra's",
        priceCents: 9400,
        compareAtCents: 12000,
      },
      { id: "syringes", label: "10 insulinespuiten", priceCents: 9650 },
    ],
  },
  {
    id: 77,
    slug: "tirzepatide-20mg-pen",
    name: "Tirzepatide 20mg - Pen",
    listing: "Tirzepatide 20mg · kant-en-klare pen",
    brand: "Bio Amino Labs",
    subcat: "Tirzepatide",
    form: "pen",
    unit: "20 mg",
    priceCents: 19000,
    compareAtCents: 20000,
    rating: 4.9,
    reviewCount: 282,
    badges: ["Korting −5%", "Bestseller"],
    bestseller: true,
    images: imgs(
      "tirzepatide-20mg-pen",
      [
        "tirzepatide-20mg-pen__01__800.webp",
        "tirzepatide-20mg-pen__02__800.webp",
      ],
      ["Tirzepatide 20mg pen voorkant", "Tirzepatide 20mg pen inhoud"],
    ),
    shortPitch:
      "Hoogste dosering in penvorm. Dubbele agonist, vooraf gevuld, klaar voor gebruik.\n\nVoor wie verder wil dan Semaglutide: één wekelijkse injectie, 4 naalden en handleiding bij de pen. Geen vials of mengwerk.",
    highlights: [
      "Hoogste dosering in deze lijn",
      "Krachtig gewichtsverlies in een vast ritme",
      "Stabiele bloedsuikerspiegel",
      "Pen, 4 naalden en handleiding",
    ],
    composition: [
      { label: "Tirzepatide pen", value: "20 mg" },
      { label: "Pennaalden", value: "4 stuks" },
      { label: "Handleiding", value: "Inbegrepen" },
    ],
    usageNote: "Aanbevolen dosering: 2,5 tot 10 mg per week.",
    doseBeginner: "2,5 mg per week",
    doseAdvanced: "5 mg per week",
    frequency: "1 injectie per week",
    weeksAtStart: 8,
    options: [],
  },
];

const CATALOG_ORDER: ProductSlug[] = [
  "semaglutide-4mg-pen",
  "semaglutide-2mg",
  "tirzepatide-20mg-pen",
  "tirzepatide-10mg",
  "retatrutide-20mg-pen",
  "retatrutide-10mg",
];

export const PRODUCTS: Product[] = CATALOG_ORDER.map((slug) =>
  PRODUCT_LIST.find((p) => p.slug === slug)!,
);

export const DEFAULT_PRODUCT_SLUG: ProductSlug = "semaglutide-4mg-pen";

export function getProduct(
  slug: string | undefined | null,
): Product | undefined {
  if (!slug) return undefined;
  return PRODUCTS.find((p) => p.slug === slug);
}

export function getDefaultOptionId(product: Product): string {
  return product.options[0]?.id ?? "default";
}

export function getOption(
  product: Product,
  optionId?: string | null,
): ProductOption | undefined {
  if (!product.options.length) return undefined;
  return product.options.find((o) => o.id === optionId) ?? product.options[0];
}

export function unitPriceCents(
  product: Product,
  optionId?: string | null,
): number {
  const opt = getOption(product, optionId);
  return opt?.priceCents ?? product.priceCents;
}

export function compareAtCents(
  product: Product,
  optionId?: string | null,
): number | undefined {
  const opt = getOption(product, optionId);
  return opt?.compareAtCents ?? product.compareAtCents;
}

export function pricePerWeekCents(
  product: Product,
  optionId?: string | null,
): number {
  return Math.round(unitPriceCents(product, optionId) / product.weeksAtStart);
}

export function productsBySubcat(subcat: Subcat | "all"): Product[] {
  if (subcat === "all") return PRODUCTS;
  return PRODUCTS.filter((p) => p.subcat === subcat);
}

export function relatedProducts(slug: ProductSlug, limit = 3): Product[] {
  const current = getProduct(slug);
  if (!current) return [];
  return PRODUCTS.filter(
    (p) => p.slug !== slug && p.subcat === current.subcat,
  ).slice(0, limit);
}

export const COMPOUNDS = [
  {
    name: "Semaglutide",
    role: "GLP-1",
    detail:
      "De bekendste GLP-1. Minder honger, één keer per week, als vial of als pen.",
    count: 2,
  },
  {
    name: "Tirzepatide",
    role: "GLP-1 + GIP",
    detail:
      "Twee paden tegelijk. Extra grip op cravings, in vial of in de 20 mg pen.",
    count: 2,
  },
  {
    name: "Retatrutide",
    role: "GLP-1 + GIP + glucagon",
    detail:
      "De sterkste in deze lijn. Voor wie verder wil dan Semaglutide of Tirzepatide.",
    count: 2,
  },
] as const;

export const BENEFITS = [
  {
    title: "Keuze in sterkte",
    description: "Drie verschillende stoffen met elk hun eigen kracht.",
    icon: "gauge",
  },
  {
    title: "Wekelijks ritme",
    description:
      "Eén toediening per week. Geen dagelijkse capsules of poeder.",
    icon: "clock",
  },
  {
    title: "Kant-en-klare pen",
    description:
      "Vooraf gevuld, eenvoudig in gebruik en geen voorbereiding of mengwerk nodig.",
    icon: "capsule",
  },
  {
    title: "Flexibel met een vial",
    description:
      "Een veelzijdige variant voor wie meer controle en flexibiliteit wil.",
    icon: "flask",
  },
] as const;

export const USAGE_STEPS = [
  {
    n: "01",
    title: "Kies je vorm",
    detail:
      "Vial plus bac water, of een gevulde pen. Extra insulinespuiten alleen bij vials.",
  },
  {
    n: "02",
    title: "Start laag",
    detail:
      "Eén keer per week. Begin met de laagste dosering en bouw rustig op.",
  },
  {
    n: "03",
    title: "Houd het vol",
    detail:
      "Vaste dag, vaste dosis. Resultaat zit in herhaling, niet in een eenmalige piek.",
  },
] as const;

export const FORM_COMPARE = {
  pen: [
    "Kant-en-klaar, geen mengen",
    "Vaste klik, minder meetfout",
    "Naalden en handleiding bij de pen",
    "Handig als je net start",
  ],
  vial: [
    "Scherpe prijs per milligram",
    "Zelf doseren uit de vial",
    "Bac water zit bij de vial",
    "Optioneel: insulinespuiten erbij",
  ],
} as const;

export type Review = {
  name: string;
  role: string;
  rating: number;
  title: string;
  text: string;
  verified: boolean;
};

export const REVIEWS: Review[] = [
  {
    name: "Lisa H.",
    role: "Semaglutide 4mg pen · Utrecht",
    rating: 5,
    title: "Eindelijk een vast ritme",
    text: "Pen is duidelijk, één keer per week. Honger is stiller. Geen gedoe met vials.",
    verified: true,
  },
  {
    name: "Thomas B.",
    role: "Tirzepatide 20mg pen · Antwerpen",
    rating: 5,
    title: "Cravings zijn een stuk stiller",
    text: "Na twee weken merk ik het vooral 's avonds. Porties kleiner, geen late snacks meer.",
    verified: true,
  },
  {
    name: "Nora K.",
    role: "Retatrutide 10mg · Rotterdam",
    rating: 4,
    title: "Sterk, dus rustig opbouwen",
    text: "Weekdeal gepakt met extra spuiten. Eerste dagen wat misselijk. Daarna stabieler.",
    verified: true,
  },
  {
    name: "Mark V.",
    role: "Semaglutide 2mg · Amsterdam",
    rating: 5,
    title: "Goede instap",
    text: "Begonnen met de vial om te kijken of het bevalt. Duidelijke inhoud, netjes verpakt.",
    verified: true,
  },
];

export const RATING_BREAKDOWN = [
  { stars: 5, pct: 78 },
  { stars: 4, pct: 16 },
  { stars: 3, pct: 4 },
  { stars: 2, pct: 2 },
  { stars: 1, pct: 0 },
] as const;

export type FaqBlock =
  { type: "p"; text: string } | { type: "ul"; items: string[] };

export const FAQS: { q: string; body: FaqBlock[] }[] = [
  {
    q: "Wat is het verschil tussen vial en pen?",
    body: [
      {
        type: "p",
        text: "Een vial leveren we met bac water. Je mengt zelf en doseert met een spuit.",
      },
      {
        type: "p",
        text: "Een pen is vooraf gevuld. Geen mengen. Naalden en handleiding zitten bij de pen.",
      },
    ],
  },
  {
    q: "Welke extra's kan ik kiezen?",
    body: [
      {
        type: "ul",
        items: [
          "Alleen bij vials: Geen extra's, of een set van 10 insulinespuiten",
          "Retatrutide 10mg: extra's + €2,00",
          "Semaglutide 2mg en Tirzepatide 10mg: extra's + €2,50",
          "Pennen hebben geen extra-optie",
        ],
      },
    ],
  },
  {
    q: "Hoe vaak gebruik je het?",
    body: [
      {
        type: "p",
        text: "In deze lijn is het ritme één keer per week. Start laag en bouw op.",
      },
      {
        type: "p",
        text: "De exacte startdosis staat per product op de productpagina.",
      },
    ],
  },
  {
    q: "Wat is stapelkorting?",
    body: [
      {
        type: "ul",
        items: [
          "5 stuks of meer in je winkelwagen: 10% extra",
          "10 stuks of meer: 20% extra",
          "Gerekend over het aantal stuks, niet over het aantal productlijnen",
        ],
      },
    ],
  },
  {
    q: "Hoe wordt het verzonden?",
    body: [
      {
        type: "ul",
        items: [
          "Bestellingen vóór 23:00: volgende werkdag verzonden",
          "Levering: 1 – 2 werkdagen in NL en BE",
          "Discreet verpakt, volgnummer standaard",
          "Gratis verzending vanaf €100",
        ],
      },
    ],
  },
  {
    q: "Wat is het retourbeleid?",
    body: [
      {
        type: "p",
        text: "Niet tevreden? Binnen 30 dagen na ontvangst kun je ongeopende verpakkingen kosteloos retourneren.",
      },
      {
        type: "p",
        text: "Hulp nodig? Mail info@afslank-injecties.nl.",
      },
    ],
  },
];

export const STACK_TIERS = [
  { minQty: 5, pct: 10, label: "5+ stuks · 10%" },
  { minQty: 10, pct: 20, label: "10+ stuks · 20%" },
] as const;
