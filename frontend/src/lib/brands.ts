/** Shops with a logo in public/brands. Sources and licences: public/brands/SOURCES.json. */

type Brand = { slug: string; label: string; names: string[]; strict?: boolean };

// `strict` marks ordinary words: those match only when nothing but a store number or
// store word follows, so "Delta Dental" and "Target Range" keep their category icon.
const BRANDS: Brand[] = [
  { slug: "adidas", label: "Adidas", names: ["adidas"] },
  { slug: "airbnb", label: "Airbnb", names: ["airbnb"] },
  { slug: "albertsons", label: "Albertsons", names: ["albertsons"] },
  { slug: "aldi", label: "Aldi", names: ["aldi"] },
  { slug: "american", label: "American Airlines", names: ["american airlines", "american air"] },
  { slug: "apple", label: "Apple", names: ["apple store", "apple com", "apple"], strict: true },
  { slug: "att", label: "AT&T", names: ["att", "at t"], strict: true },
  { slug: "best-buy", label: "Best Buy", names: ["best buy", "bestbuy"] },
  { slug: "burger-king", label: "Burger King", names: ["burger king"] },
  { slug: "chevron", label: "Chevron", names: ["chevron"] },
  { slug: "costco", label: "Costco", names: ["costco"] },
  { slug: "cvs", label: "CVS", names: ["cvs"] },
  {
    slug: "delta",
    label: "Delta Air Lines",
    names: ["delta air lines", "delta airlines", "delta air"],
  },
  { slug: "dominos", label: "Domino's", names: ["dominos"] },
  { slug: "doordash", label: "DoorDash", names: ["doordash", "door dash"] },
  { slug: "dunkin", label: "Dunkin'", names: ["dunkin"] },
  { slug: "ebay", label: "eBay", names: ["ebay"] },
  { slug: "etsy", label: "Etsy", names: ["etsy"] },
  { slug: "hm", label: "H&M", names: ["hm"], strict: true },
  { slug: "ikea", label: "IKEA", names: ["ikea"] },
  { slug: "instacart", label: "Instacart", names: ["instacart"] },
  { slug: "kfc", label: "KFC", names: ["kfc"] },
  { slug: "kroger", label: "Kroger", names: ["kroger"] },
  { slug: "lidl", label: "Lidl", names: ["lidl"] },
  { slug: "lyft", label: "Lyft", names: ["lyft"] },
  { slug: "macys", label: "Macy's", names: ["macys"] },
  { slug: "mcdonalds", label: "McDonald's", names: ["mcdonalds", "mcdonald s"] },
  { slug: "netflix", label: "Netflix", names: ["netflix"] },
  { slug: "nike", label: "Nike", names: ["nike"] },
  { slug: "nordstrom", label: "Nordstrom Rack", names: ["nordstrom rack"] },
  { slug: "nordstrom", label: "Nordstrom", names: ["nordstrom"] },
  { slug: "old-navy", label: "Old Navy", names: ["old navy"] },
  { slug: "petco", label: "Petco", names: ["petco"] },
  { slug: "pizza-hut", label: "Pizza Hut", names: ["pizza hut"] },
  { slug: "publix", label: "Publix", names: ["publix"] },
  { slug: "safeway", label: "Safeway", names: ["safeway"] },
  { slug: "sams-club", label: "Sam's Club", names: ["sams club", "samsclub"] },
  { slug: "sephora", label: "Sephora", names: ["sephora"] },
  { slug: "seven-eleven", label: "7-Eleven", names: ["7 eleven", "7eleven", "seven eleven"] },
  { slug: "shake-shack", label: "Shake Shack", names: ["shake shack"] },
  { slug: "shell", label: "Shell", names: ["shell oil", "shell"], strict: true },
  {
    slug: "southwest",
    label: "Southwest Airlines",
    names: ["southwest airlines", "southwest air"],
  },
  { slug: "spotify", label: "Spotify", names: ["spotify"] },
  { slug: "starbucks", label: "Starbucks", names: ["starbucks"] },
  { slug: "taco-bell", label: "Taco Bell", names: ["taco bell"] },
  { slug: "target", label: "Target", names: ["target"], strict: true },
  { slug: "trader-joes", label: "Trader Joe's", names: ["trader joes", "trader joe"] },
  { slug: "uber", label: "Uber Eats", names: ["uber eats"] },
  { slug: "uber", label: "Uber", names: ["uber trip", "uber"], strict: true },
  { slug: "uniqlo", label: "Uniqlo", names: ["uniqlo"] },
  { slug: "united", label: "United Airlines", names: ["united airlines", "united air"] },
  { slug: "verizon", label: "Verizon", names: ["verizon"] },
  { slug: "walmart", label: "Walmart", names: ["walmart", "wal mart", "wm supercenter"] },
  { slug: "wendys", label: "Wendy's", names: ["wendys"] },
  { slug: "whole-foods", label: "Whole Foods", names: ["whole foods", "wholefoods"] },
  { slug: "xfinity", label: "Xfinity", names: ["xfinity"] },
  { slug: "zara", label: "Zara", names: ["zara"], strict: true },
];

const STORE_WORD = /^(\d+|t|store|stores|shop|inc|llc|corp|co|the|usa|us|com|online)$/;

function normalize(name: string) {
  return name
    .toLowerCase()
    .replace(/['’&]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findBrand(merchant: string | null | undefined): Brand | null {
  const name = normalize(merchant ?? "");
  if (!name) return null;
  const padded = ` ${name} `;
  for (const brand of BRANDS) {
    for (const known of brand.names) {
      if (brand.strict) {
        if (name !== known && !name.startsWith(`${known} `)) continue;
        const rest = name.slice(known.length).trim();
        if (rest && !rest.split(" ").every((word) => STORE_WORD.test(word))) continue;
      } else if (!padded.includes(` ${known} `)) continue;
      return brand;
    }
  }
  return null;
}

/** The logo for a merchant name as scanned, or null to keep the category icon. */
export function brandLogo(merchant: string | null | undefined): string | null {
  const brand = findBrand(merchant);
  return brand && `/brands/${brand.slug}.svg`;
}

// Card and receipt shorthand, read on unknown shops. Ambiguous ones ("REST", "ST") stay as printed.
const SHORTHAND: Record<string, string> = {
  amzn: "Amazon",
  ctr: "Center",
  intl: "International",
  mkt: "Market",
  mktp: "Marketplace",
  mktplace: "Marketplace",
  pharm: "Pharmacy",
  rstrnt: "Restaurant",
  superctr: "Supercenter",
  svc: "Service",
  whse: "Warehouse",
  whsl: "Wholesale",
};
const INITIALS = new Set(["AMC", "BBQ", "DMV", "IHOP", "NYC", "UPS", "USA", "USPS", "YMCA"]);
const SMALL_WORDS = new Set(["a", "and", "at", "by", "for", "in", "of", "on", "the"]);

function titleWord(word: string, first: boolean) {
  const known = SHORTHAND[word.toLowerCase()];
  if (known) return known;
  if (INITIALS.has(word.toUpperCase())) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (!first && SMALL_WORDS.has(lower)) return lower;
  // Capitalise each part of "o'brien" and "coca-cola", but not the s in "joe's".
  return lower.replace(/(^|-|['’](?=[a-z]{2}))([a-z])/g, (_, mark, letter) => {
    return mark + letter.toUpperCase();
  });
}

/** A merchant name to show people. Display only: the receipt keeps what was scanned or typed. */
export function shopName(merchant: string | null | undefined): string {
  const raw = (merchant ?? "").trim();
  if (!raw) return "";
  // Someone typed this: leave their spelling alone.
  if (/[a-z]/.test(raw) && /[A-Z]/.test(raw) && !/[\d#*]/.test(raw)) return raw;
  const unprefixed = raw.replace(/^(sq|tst|sp|dd|paypal)\s*\*\s*/i, "");
  const brand = findBrand(unprefixed);
  if (brand) return brand.label;
  const words = unprefixed
    .replace(/[#*]\s*\w*\d\w*/g, " ")
    .replace(/\b(store|no\.?)\s+\d+\b/gi, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[,.]?\s+(inc|llc|ltd|corp)\.?\s*$/i, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return raw;
  const shouted = !/[a-z]/.test(unprefixed) || !/[A-Z]/.test(unprefixed);
  return words.map((word, i) => (shouted ? titleWord(word, i === 0) : word)).join(" ");
}
