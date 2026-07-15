import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
dotenv.config();


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory caches
let jpGamesCache = [];
let exchangeRatesCache = {
  rates: {
    JPY: 0.0054, // Fallback rate JPY -> EUR
    USD: 0.92,   // Fallback rate USD -> EUR
  },
  lastUpdated: 0
};

// In-memory cache for physical offers (30 min TTL)
const physicalCache = new Map();

let isXmlLoading = false;
let xmlLoadError = null;

// Download and parse JP XML Switch software list
async function loadJpGamesXml() {
  if (isXmlLoading) return;
  isXmlLoading = true;
  xmlLoadError = null;
  console.log('Starting download of Japanese Switch games XML (5MB)...');
  
  try {
    const url = 'https://www.nintendo.co.jp/data/software/xml/switch.xml';
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error downloading XML! status: ${res.status}`);
    }
    const xml = await res.text();
    console.log('Successfully downloaded Japanese XML. Parsing...');
    
    const parsedGames = [];
    const regex = /<TitleInfo>([\s\S]*?)<\/TitleInfo>/g;
    let match;
    
    while ((match = regex.exec(xml)) !== null) {
      const content = match[1];
      const initialCode = (content.match(/<InitialCode>(.*?)<\/InitialCode>/) || [])[1] || '';
      const titleName = (content.match(/<TitleName>(.*?)<\/TitleName>/) || [])[1] || '';
      const linkURL = (content.match(/<LinkURL>(.*?)<\/LinkURL>/) || [])[1] || '';
      const screenshot = (content.match(/<ScreenshotImgURL>(.*?)<\/ScreenshotImgURL>/) || [])[1] || '';
      
      // Extract NSUID from linkURL (e.g. "/titles/70010000081985" -> "70010000081985")
      let nsuid = '';
      const nsuidMatch = linkURL.match(/\/titles\/(\d+)/);
      if (nsuidMatch) {
        nsuid = nsuidMatch[1];
      }
      
      if (initialCode && nsuid) {
        parsedGames.push({
          initialCode: initialCode.trim(),
          titleName: titleName.trim(),
          nsuid: nsuid.trim(),
          screenshot: screenshot.trim()
        });
      }
    }
    
    jpGamesCache = parsedGames;
    console.log(`Successfully parsed ${jpGamesCache.length} Japanese Switch games.`);
  } catch (error) {
    console.error('Failed to load Japanese Switch games XML:', error);
    xmlLoadError = error.message;
  } finally {
    isXmlLoading = false;
  }
}

// Fetch real-time exchange rates (base EUR)
async function getExchangeRates() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  if (now - exchangeRatesCache.lastUpdated < ONE_HOUR) {
    return exchangeRatesCache.rates;
  }
  
  try {
    console.log('Fetching live exchange rates from EUR base...');
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error('Failed to fetch exchange rates');
    const json = await res.json();
    if (json && json.rates) {
      if (json.rates.JPY) {
        exchangeRatesCache.rates.JPY = parseFloat((1 / json.rates.JPY).toFixed(6));
      }
      if (json.rates.USD) {
        exchangeRatesCache.rates.USD = parseFloat((1 / json.rates.USD).toFixed(6));
      }
      exchangeRatesCache.lastUpdated = now;
      console.log(`Updated exchange rates: JPY->EUR = ${exchangeRatesCache.rates.JPY}, USD->EUR = ${exchangeRatesCache.rates.USD}`);
    }
  } catch (err) {
    console.error('Error updating exchange rates, using cached values:', err.message);
  }
  return exchangeRatesCache.rates;
}

// Global browser instance for Puppeteer scrapers
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    console.log('Launching Puppeteer browser...');
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
  }
  return browserPromise;
}

/** Wraps a promise with a timeout. Returns null if the timeout fires first. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => {
      console.warn(`Timeout (${ms}ms) reached for scraper: ${label}`);
      resolve(null);
    }, ms))
  ]);
}

/** Simple concurrency limiter: runs at most `limit` async tasks at a time. */
function createConcurrencyLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0 || active >= limit) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve).catch(reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}
const physicalLimiter = createConcurrencyLimiter(2); // max 2 games scraped in parallel


// --- Physical price scrapers ---
const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** Extract first numeric price (€) from an HTML string. */
function extractPrice(html, pattern) {
  const m = html.match(pattern);
  if (!m) return null;
  const raw = m[1].replace(/\./g, '').replace(',', '.');
  const val = parseFloat(raw);
  return isNaN(val) ? null : val;
}

async function scrapeAmazonEs(title) {
  try {
    const searchQ = encodeURIComponent(`Nintendo Switch ${title} juego fisico`);
    const url = `https://www.amazon.es/s?k=${searchQ}&rh=n%3A599385031`; // node 599385031 = Nintendo Switch juegos
    const browser = await getBrowser();
    const page = await browser.newPage();
    // Use random user agent to avoid basic blocks
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    const result = await page.evaluate(() => {
      const el = document.querySelector('.s-result-item[data-component-type="s-search-result"]');
      if (!el) return null;
      const priceEl = el.querySelector('.a-price .a-offscreen');
      const linkEl = el.querySelector('a.a-link-normal');
      if (!priceEl) return null;
      
      return {
        priceStr: priceEl.innerText,
        url: linkEl ? linkEl.href : null
      };
    });
    await page.close();

    if (!result) return null;

    // Parse price like "67,90 €" or "67.90" -> 67.90
    const raw = result.priceStr.replace(/[^\d,.]/g, '').replace(',', '.');
    const price = parseFloat(raw);
    if (isNaN(price) || price <= 0) return null;

    return { seller: 'Amazon.es', price, url: result.url || url, inStock: true, format: 'Físico', category: 'new' };
  } catch (err) {
    console.warn('Amazon.es scrape failed:', err.message);
    return null;
  }
}

async function scrapeFnacEs(title) {
  try {
    const searchQ = encodeURIComponent(`${title} Nintendo Switch`);
    const url = `https://www.fnac.es/SearchResult/ResultList.aspx?Search=${searchQ}&stype=0&SCat=7!1`;
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const result = await page.evaluate(() => {
      const el = document.querySelector('.Article-item');
      if (!el) return null;
      const priceEl = el.querySelector('.userPrice');
      const linkEl = el.querySelector('.Article-title a');
      if (!priceEl) return null;
      return {
        priceStr: priceEl.innerText,
        url: linkEl ? linkEl.href : null
      };
    });
    await page.close();

    if (!result) return null;
    const raw = result.priceStr.replace(/[^\d,.]/g, '').replace(',', '.');
    const price = parseFloat(raw);
    if (isNaN(price) || price <= 0) return null;

    return { seller: 'Fnac.es', price, url: result.url || url, inStock: true, format: 'Físico', category: 'new' };
  } catch (err) {
    console.warn('Fnac.es scrape failed:', err.message);
    return null;
  }
}

async function scrapeMediaMarktEs(title) {
  try {
    const searchQ = encodeURIComponent(`${title} Nintendo Switch`);
    const url = `https://www.mediamarkt.es/es/search.html?query=${searchQ}`;
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const result = await page.evaluate(() => {
      const el = document.querySelector('div[data-test="mms-search-srp-productlist"] div[data-test="mms-product-card"]');
      if (!el) return null;
      const priceEl = el.querySelector('span[data-test="product-price"]');
      const linkEl = el.querySelector('a[data-test="mms-product-list-item-link"]');
      if (!priceEl) return null;
      return {
        priceStr: priceEl.innerText,
        url: linkEl ? linkEl.href : null
      };
    });
    await page.close();

    if (!result) return null;
    const raw = result.priceStr.replace(/[^\d,.-]/g, '').replace(',', '.');
    const price = parseFloat(raw);
    if (isNaN(price) || price <= 0) return null;

    return { seller: 'MediaMarkt.es', price, url: result.url || url, inStock: true, format: 'Físico', category: 'new' };
  } catch (err) {
    console.warn('MediaMarkt.es scrape failed:', err.message);
    return null;
  }
}

// --- Second-hand store scrapers ---

/** CEX: public JSON search API */
async function scrapeCex(title) {
  try {
    const searchQ = encodeURIComponent(`${title} Switch`);
    const url = `https://wss2.cex.uk.webuy.io/v3/boxes?q=${searchQ}&firstRecord=1&count=3&sortOrder=1`;
    console.log(`Querying CEX: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://es.cex.es/'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const boxes = data?.response?.data?.boxes;
    if (!boxes || boxes.length === 0) return null;

    // Filter to Switch category (categoryName includes 'Switch')
    const switchBoxes = boxes.filter(b =>
      (b.categoryName || '').toLowerCase().includes('switch') ||
      (b.boxName || '').toLowerCase().includes('switch')
    );
    const box = switchBoxes[0] || boxes[0];
    if (!box) return null;

    const price = parseFloat(box.cashPrice || box.exchangePrice || 0);
    if (isNaN(price) || price <= 0) return null;

    const boxId = box.boxId || '';
    const productUrl = `https://es.cex.es/tienda/juegos-nintendo/nintendo-switch/${boxId}`;

    return {
      seller: 'CEX',
      price,
      url: productUrl,
      inStock: (box.canBuy === 1),
      format: 'Segunda Mano',
      category: 'second-hand'
    };
  } catch (err) {
    console.warn('CEX scrape failed:', err.message);
    return null;
  }
}

/** eBay.es: search via fetch (public HTML) */
async function scrapeEbayEs(title) {
  try {
    const searchQ = encodeURIComponent(`${title} Nintendo Switch`);
    const url = `https://www.ebay.es/sch/i.html?_nkw=${searchQ}&_sacat=0&LH_BIN=1&_sop=15`; // BIN = Buy It Now, sort by price+shipping asc
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const result = await page.evaluate(() => {
      const items = document.querySelectorAll('.s-item');
      for (const item of items) {
        const priceEl = item.querySelector('.s-item__price');
        const linkEl = item.querySelector('.s-item__link');
        const titleEl = item.querySelector('.s-item__title');
        if (!priceEl || !linkEl) continue;
        // Skip "Shop on eBay" placeholder
        if (titleEl && titleEl.textContent.toLowerCase().includes('shop on ebay')) continue;
        return { priceStr: priceEl.textContent, url: linkEl.href };
      }
      return null;
    });
    await page.close();

    if (!result) return null;
    // eBay price can be "14,99 EUR" or "14,99 EUR a 29,99 EUR" — take first price
    const match = result.priceStr.match(/([\d.,]+)/);
    if (!match) return null;
    const raw = match[1].replace(/\./g, '').replace(',', '.');
    const price = parseFloat(raw);
    if (isNaN(price) || price <= 0) return null;

    return {
      seller: 'eBay.es',
      price,
      url: result.url,
      inStock: true,
      format: 'Segunda Mano',
      category: 'second-hand'
    };
  } catch (err) {
    console.warn('eBay.es scrape failed:', err.message);
    return null;
  }
}

/** Wallapop: public search API */
async function scrapeWallapop(title) {
  try {
    const searchQ = encodeURIComponent(`${title} Nintendo Switch`);
    const url = `https://api.wallapop.com/api/v3/general/search?keywords=${searchQ}&filters_source=search_box&latitude=40.4168&longitude=-3.7038&order_by=price_low_to_high`;
    console.log(`Querying Wallapop: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'DeviceOS': 'web',
        'Referer': 'https://es.wallapop.com/'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.search_objects;
    if (!items || items.length === 0) return null;

    // Find first item (already sorted by price asc)
    const item = items[0];
    const price = parseFloat(item.price);
    if (isNaN(price) || price <= 0) return null;

    const webSlug = item.web_slug || item.id;
    const productUrl = `https://es.wallapop.com/item/${webSlug}`;

    return {
      seller: 'Wallapop',
      price,
      url: productUrl,
      inStock: true,
      format: 'Segunda Mano',
      category: 'second-hand'
    };
  } catch (err) {
    console.warn('Wallapop scrape failed:', err.message);
    return null;
  }
}

/** Vinted: public search via fetch */
async function scrapeVinted(title) {
  try {
    const searchQ = encodeURIComponent(`${title} Nintendo Switch`);
    const url = `https://www.vinted.es/api/v2/catalog/items?search_text=${searchQ}&order=price_low_to_high&per_page=5`;
    console.log(`Querying Vinted: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer': 'https://www.vinted.es/'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.items;
    if (!items || items.length === 0) return null;

    const item = items[0];
    const price = parseFloat(item.price?.amount || item.price || 0);
    if (isNaN(price) || price <= 0) return null;

    const productUrl = item.url || `https://www.vinted.es/items/${item.id}`;

    return {
      seller: 'Vinted',
      price,
      url: productUrl,
      inStock: true,
      format: 'Segunda Mano',
      category: 'second-hand'
    };
  } catch (err) {
    console.warn('Vinted scrape failed:', err.message);
    return null;
  }
}

/** Cash Converters: scraping HTML via Puppeteer */
async function scrapeCashConverters(title) {
  try {
    const searchQ = encodeURIComponent(`${title} Nintendo Switch`);
    const url = `https://www.cashconverters.es/es/search/?query=${searchQ}`;
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const result = await page.evaluate(() => {
      // Try common product card selectors
      const selectors = [
        '.product-item',
        '.cc-product-card',
        '[class*="product-card"]',
        '[class*="ProductCard"]',
        '.article-card'
      ];
      let el = null;
      for (const sel of selectors) {
        el = document.querySelector(sel);
        if (el) break;
      }
      if (!el) return null;

      const priceEl = el.querySelector('[class*="price"], [class*="Price"], .price, .product-price');
      const linkEl = el.querySelector('a');
      if (!priceEl) return null;
      return { priceStr: priceEl.textContent, url: linkEl ? linkEl.href : null };
    });
    await page.close();

    if (!result) return null;
    const match = result.priceStr.replace(/\./g, '').replace(',', '.').match(/([\d.]+)/);
    if (!match) return null;
    const price = parseFloat(match[1]);
    if (isNaN(price) || price <= 0) return null;

    return {
      seller: 'Cash Converters',
      price,
      url: result.url || url,
      inStock: true,
      format: 'Segunda Mano',
      category: 'second-hand'
    };
  } catch (err) {
    console.warn('Cash Converters scrape failed:', err.message);
    return null;
  }
}

/**
 * Fetch all physical and second-hand game offers in parallel.
 * New stores: Amazon.es, Fnac.es, MediaMarkt.es
 * Second-hand stores: CEX, eBay.es, Wallapop, Vinted, Cash Converters
 * Results are cached 30 minutes per game title.
 * Concurrency is limited to avoid saturating Puppeteer.
 */
async function fetchPhysicalOffers(title) {
  const cacheKey = title.toLowerCase().trim();
  const cached = physicalCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiry > now) return cached.data;

  return physicalLimiter(async () => {
    // Re-check cache in case another request already filled it while we waited
    const cachedNow = physicalCache.get(cacheKey);
    if (cachedNow && cachedNow.expiry > Date.now()) return cachedNow.data;

    console.log(`Fetching physical + second-hand prices for: "${title}"`);
    const SCRAPER_TIMEOUT = 12000; // 12 seconds max per scraper

    const [
      amazon, fnac, mediaMarkt,
      cex, ebay, wallapop, vinted, cashConverters
    ] = await Promise.all([
      withTimeout(scrapeAmazonEs(title), SCRAPER_TIMEOUT, 'Amazon'),
      withTimeout(scrapeFnacEs(title), SCRAPER_TIMEOUT, 'Fnac'),
      withTimeout(scrapeMediaMarktEs(title), SCRAPER_TIMEOUT, 'MediaMarkt'),
      withTimeout(scrapeCex(title), SCRAPER_TIMEOUT, 'CEX'),
      withTimeout(scrapeEbayEs(title), SCRAPER_TIMEOUT, 'eBay'),
      withTimeout(scrapeWallapop(title), SCRAPER_TIMEOUT, 'Wallapop'),
      withTimeout(scrapeVinted(title), SCRAPER_TIMEOUT, 'Vinted'),
      withTimeout(scrapeCashConverters(title), SCRAPER_TIMEOUT, 'CashConverters'),
    ]);

    const offers = [amazon, fnac, mediaMarkt, cex, ebay, wallapop, vinted, cashConverters].filter(Boolean);
    console.log(`All offers found for "${title}": ${offers.length} (${offers.map(o => `${o.seller}[${o.category}]`).join(', ')})`);

    physicalCache.set(cacheKey, { data: offers, expiry: Date.now() + 30 * 60 * 1000 });
    return offers;
  });
}

// Extract the core 4-character code of a Switch game (e.g. HACPAXEAB -> AXEA, HACAXEAA -> AXEA)
function extractCoreCode(productCode) {
  if (!productCode) return null;
  const clean = productCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean.startsWith('HAC')) return null;
  
  if (clean.length === 9) {
    return clean.slice(4, 8);
  } else if (clean.length === 8) {
    return clean.slice(3, 7);
  }
  
  if (clean.length > 8) {
    return clean.slice(4, 8);
  } else if (clean.length >= 7) {
    return clean.slice(3, 7);
  }
  return null;
}

// Map EU code (e.g. HACPAR3NA) to JP Game info
function mapEuCodeToJpGame(euProductCode) {
  if (!euProductCode || jpGamesCache.length === 0) return null;
  
  const euCore = extractCoreCode(euProductCode);
  if (!euCore) return null;
  
  const found = jpGamesCache.find(g => {
    const jpCore = extractCoreCode(g.initialCode);
    return jpCore === euCore;
  });
  
  return found || null;
}

// In-memory cache for mapping Title ID -> JP NSUID
const titleIdToJpNsuidCache = {};

// Resolve JP Game info, falling back to Title ID redirect if product code mapping fails
async function resolveJpGameInfo(applicationId, euProductCode) {
  // 1. Try mapping via product code (fast, local)
  if (euProductCode) {
    const jpGame = mapEuCodeToJpGame(euProductCode);
    if (jpGame) return jpGame;
  }

  // 2. If product code mapping failed but we have applicationId (Title ID)
  if (applicationId) {
    const cachedNsuid = titleIdToJpNsuidCache[applicationId];
    if (cachedNsuid) {
      const jpGame = jpGamesCache.find(g => g.nsuid === cachedNsuid);
      if (jpGame) return jpGame;
      return {
        titleName: null,
        nsuid: cachedNsuid,
        initialCode: null,
        screenshot: null
      };
    }

    try {
      const url = `https://ec.nintendo.com/apps/${applicationId}/JP`;
      console.log(`Resolving JP NSUID for Title ID ${applicationId} via: ${url}`);
      const res = await fetch(url, { redirect: 'manual' });
      const location = res.headers.get('location');
      if (location) {
        const nsuidMatch = location.match(/(700\d{11})/);
        if (nsuidMatch) {
          const jpNsuid = nsuidMatch[1];
          titleIdToJpNsuidCache[applicationId] = jpNsuid;
          console.log(`Resolved Title ID ${applicationId} -> JP NSUID ${jpNsuid}`);
          const jpGame = jpGamesCache.find(g => g.nsuid === jpNsuid);
          if (jpGame) return jpGame;
          return {
            titleName: null,
            nsuid: jpNsuid,
            initialCode: null,
            screenshot: null
          };
        }
      }
    } catch (err) {
      console.error(`Failed to resolve JP NSUID for Title ID ${applicationId}:`, err.message);
    }
  }

  return null;
}

// In-memory cache for mapping Title ID -> US NSUID
const titleIdToUsNsuidCache = {};

// Resolve US NSUID, falling back to Title ID redirect
async function resolveUsNsuid(applicationId) {
  if (!applicationId) return null;
  
  const cachedNsuid = titleIdToUsNsuidCache[applicationId];
  if (cachedNsuid) return cachedNsuid;
  
  try {
    const url = `https://ec.nintendo.com/apps/${applicationId}/US`;
    console.log(`Resolving US NSUID for Title ID ${applicationId} via: ${url}`);
    const res = await fetch(url, { redirect: 'manual' });
    const location = res.headers.get('location');
    if (location) {
      const nsuidMatch = location.match(/(700\d{11})/);
      if (nsuidMatch) {
        const usNsuid = nsuidMatch[1];
        titleIdToUsNsuidCache[applicationId] = usNsuid;
        console.log(`Resolved Title ID ${applicationId} -> US NSUID ${usNsuid}`);
        return usNsuid;
      }
    }
  } catch (err) {
    console.error(`Failed to resolve US NSUID for Title ID ${applicationId}:`, err.message);
  }
  return null;
}

// Scrape Instant Gaming for Switch games
async function scrapeInstantGaming(query) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const url = `https://www.instant-gaming.com/es/busquedas/?q=${encodeURIComponent(query)}`;
  
  try {
    console.log(`Querying Instant Gaming: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });
    
    if (!res.ok) {
      console.log(`Instant Gaming returned status ${res.status}`);
      return [];
    }
    
    const html = await res.text();
    
    // Extract the searchResults script JSON
    const match = html.match(/window\.searchResults\s*=\s*(\{[\s\S]*?\});\s*\n/);
    if (!match) {
      console.log('No window.searchResults found in Instant Gaming response HTML');
      return [];
    }
    
    const data = JSON.parse(match[1]);
    if (!data || !data.hits) return [];
    
    // Filter and map Instant Gaming results
    // We only want products on the Switch platform
    const switchGames = data.hits
      .filter(hit => {
        const platform = (hit.platform || '').toLowerCase();
        const type = (hit.type || '').toLowerCase();
        return platform.includes('switch') || type.includes('switch') || (hit.platforms && hit.platforms.includes('5'));
      })
      .map(hit => {
        const prodId = hit.prod_id || hit.objectID;
        const seoName = hit.seo_name || '';
        return {
          id: prodId,
          name: hit.name || hit.fullname,
          price: parseFloat(hit.price),
          retailPrice: hit.retail ? parseFloat(hit.retail) : null,
          discount: hit.discount || 0,
          url: `https://www.instant-gaming.com/es/${prodId}-comprar-${seoName}/`,
          imageUrl: `https://gaming-cdn.com/images/products/${prodId}/380x218/${seoName}-cover.jpg`,
          inStock: hit.has_stock === 1
        };
      });
      
    return switchGames;
  } catch (error) {
    console.error('Error scraping Instant Gaming:', error.message);
    return [];
  }
}

// Fetch price details from Nintendo API
async function fetchNintendoPrice(country, nsuid) {
  try {
    const url = `https://api.ec.nintendo.com/v1/price?country=${country}&ids=${nsuid}&lang=${country === 'JP' ? 'ja' : 'es'}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    
    if (data && data.prices && data.prices.length > 0) {
      const priceObj = data.prices[0];
      const regular = priceObj.regular_price;
      const discount = priceObj.discount_price;
      
      const regularValue = parseFloat(regular.raw_value);
      const discountValue = discount ? parseFloat(discount.raw_value) : null;
      
      return {
        nsuid: nsuid,
        salesStatus: priceObj.sales_status, // "onsale" or others
        regularPrice: regularValue,
        regularPriceFormatted: regular.amount,
        discountPrice: discountValue,
        discountPriceFormatted: discount ? discount.amount : null,
        discountPercent: discountValue ? Math.round((1 - (discountValue / regularValue)) * 100) : 0,
        currency: regular.currency
      };
    }
  } catch (error) {
    console.error(`Error fetching Nintendo price for ${country} / ${nsuid}:`, error.message);
  }
  return null;
}

// Route to search games across all engines
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters long.' });
  }

  console.log(`\n========================================`);
  console.log(`Processing search query: "${query}"`);
  console.log(`========================================`);

  try {
    // If the JP cache is empty and not loading, trigger a load (lazy loading if startup failed)
    if (jpGamesCache.length === 0 && !isXmlLoading) {
      loadJpGamesXml();
    }

    const fxRates = await getExchangeRates();

    // 1. Search Nintendo of Europe (returns matching titles, ES NSUIDs, and product codes)
    const euSearchUrl = `https://search.nintendo-europe.com/en/select?q=${encodeURIComponent(query)}&fq=type:GAME%20AND%20system_type:nintendoswitch*&wt=json&rows=10`;
    console.log(`Querying EU eShop Search: ${euSearchUrl}`);
    
    const euRes = await fetch(euSearchUrl);
    if (!euRes.ok) throw new Error('Nintendo Europe search API failed');
    const euJson = await euRes.json();
    
    const docs = (euJson.response && euJson.response.docs) || [];
    console.log(`Found ${docs.length} candidate games in EU eShop.`);

    // 2. Query Instant Gaming in parallel
    const igPromise = scrapeInstantGaming(query);

    // 3. Process matches from EU Search
    const resolvedGamesPromises = docs.map(async (doc) => {
      const title = doc.title;
      const euNsuid = doc.nsuid_txt ? doc.nsuid_txt[0] : null;
      const productCode = doc.product_code_txt ? doc.product_code_txt[0] : null;
      const applicationId = doc.application_id_s || null;
      const publisher = doc.publisher || doc.maker || 'Nintendo';
      const releaseDate = doc.release_date_on_retail || doc.dates_released_dts?.[0] || null;
      
      // Skip if no EU NSUID
      if (!euNsuid) return null;

      // Find JP equivalent (fast local mapping first, then Title ID redirect fallback)
      const jpGameInfo = await resolveJpGameInfo(applicationId, productCode);

      // Find US equivalent (Title ID redirect)
      const usNsuid = await resolveUsNsuid(applicationId);
      
      return {
        title,
        euNsuid,
        productCode,
        applicationId,
        publisher,
        releaseDate,
        imageUrl: doc.image_url_h2x1_s || doc.image_url || null,
        jpGame: jpGameInfo ? {
          title: jpGameInfo.titleName || title,
          nsuid: jpGameInfo.nsuid,
          initialCode: jpGameInfo.initialCode,
          screenshot: jpGameInfo.screenshot
        } : null,
        usNsuid: usNsuid
      };
    });

    const resolvedGames = (await Promise.all(resolvedGamesPromises)).filter(Boolean);

    // 4. Fetch prices in parallel for all resolved games
    const pricePromises = resolvedGames.map(async (game) => {
      const esPricePromise = fetchNintendoPrice('ES', game.euNsuid);
      const jpPricePromise = game.jpGame ? fetchNintendoPrice('JP', game.jpGame.nsuid) : Promise.resolve(null);
      const usPricePromise = game.usNsuid ? fetchNintendoPrice('US', game.usNsuid) : Promise.resolve(null);
      
      const [esPrice, jpPrice, usPrice] = await Promise.all([esPricePromise, jpPricePromise, usPricePromise]);
      
      // Format JP price in EUR
      let jpPriceInEur = null;
      let jpDiscountPriceInEur = null;
      
      if (jpPrice) {
        jpPriceInEur = parseFloat((jpPrice.regularPrice * fxRates.JPY).toFixed(2));
        if (jpPrice.discountPrice) {
          jpDiscountPriceInEur = parseFloat((jpPrice.discountPrice * fxRates.JPY).toFixed(2));
        }
      }

      // Format US price in EUR
      let usPriceInEur = null;
      let usDiscountPriceInEur = null;
      
      if (usPrice) {
        usPriceInEur = parseFloat((usPrice.regularPrice * fxRates.USD).toFixed(2));
        if (usPrice.discountPrice) {
          usDiscountPriceInEur = parseFloat((usPrice.discountPrice * fxRates.USD).toFixed(2));
        }
      }

      return {
        ...game,
        prices: {
          es: esPrice ? {
            ...esPrice,
            finalPrice: esPrice.discountPrice !== null ? esPrice.discountPrice : esPrice.regularPrice
          } : null,
          jp: jpPrice ? {
            ...jpPrice,
            finalPrice: jpPrice.discountPrice !== null ? jpPrice.discountPrice : jpPrice.regularPrice,
            priceInEur: jpPriceInEur,
            finalPriceInEur: jpDiscountPriceInEur !== null ? jpDiscountPriceInEur : jpPriceInEur
          } : null,
          us: usPrice ? {
            ...usPrice,
            finalPrice: usPrice.discountPrice !== null ? usPrice.discountPrice : usPrice.regularPrice,
            priceInEur: usPriceInEur,
            finalPriceInEur: usDiscountPriceInEur !== null ? usDiscountPriceInEur : usPriceInEur
          } : null
        }
      };
    });

    const [gamesWithPrices, igGames, physicalOffersArray] = await Promise.all([
      Promise.all(pricePromises),
      igPromise,
      Promise.all(resolvedGames.map(game => fetchPhysicalOffers(game.title)))
    ]);

    // 5. Build final structured results
    const results = gamesWithPrices.map((game, index) => {
      // Find matching Instant Gaming offer
      const cleanTitle = game.title.toLowerCase().replace(/[^a-z0-9]/g, ' ');
      const words = cleanTitle.split(' ').filter(w => w.length > 3);
      
      let matchingIg = null;
      if (words.length > 0) {
        matchingIg = igGames.find(ig => {
          const igTitle = ig.name.toLowerCase();
          // Title must match at least 60% of significant words
          const matchedWords = words.filter(word => igTitle.includes(word));
          return (matchedWords.length / words.length) >= 0.6;
        });
      }

      // Determine cheapest
      let cheapest = null;
      let minPrice = Infinity;

      if (game.prices.es) {
        const esPrice = game.prices.es.finalPrice;
        if (esPrice < minPrice) {
          minPrice = esPrice;
          cheapest = 'eShop ES';
        }
      }

      if (game.prices.jp && game.prices.jp.finalPriceInEur) {
        const jpPrice = game.prices.jp.finalPriceInEur;
        if (jpPrice < minPrice) {
          minPrice = jpPrice;
          cheapest = 'eShop JP';
        }
      }

      if (game.prices.us && game.prices.us.finalPriceInEur) {
        const usPrice = game.prices.us.finalPriceInEur;
        if (usPrice < minPrice) {
          minPrice = usPrice;
          cheapest = 'eShop US';
        }
      }

      if (matchingIg && matchingIg.price) {
        const igPrice = matchingIg.price;
        if (igPrice < minPrice && matchingIg.inStock) {
          minPrice = igPrice;
          cheapest = 'Instant Gaming';
        }
      }

      // Check physical offers
      const physicalOffers = physicalOffersArray[index] || [];
      if (physicalOffers.length > 0) {
        const cheapestPhysical = physicalOffers.reduce((best, o) =>
          o.inStock && o.price < (best ? best.price : Infinity) ? o : best, null);
        if (cheapestPhysical && cheapestPhysical.price < minPrice) {
          minPrice = cheapestPhysical.price;
          cheapest = cheapestPhysical.seller;
        }
      }

      return {
        ...game,
        prices: {
          ...game.prices,
          ig: matchingIg ? {
            price: matchingIg.price,
            discountPercent: matchingIg.discount,
            url: matchingIg.url,
            inStock: matchingIg.inStock
          } : null
        },
        cheapest: minPrice !== Infinity ? {
          platform: cheapest,
          price: minPrice
        } : null,
        physicalOffers
      };
    });

    res.json({
      exchangeRates: fxRates,
      games: results,
      unmatchedIg: igGames.filter(ig => !results.some(r => r.prices.ig && r.prices.ig.url === ig.url))
    });

  } catch (error) {
    console.error('Search router error:', error);
    res.status(500).json({ error: error.message || 'An error occurred during search' });
  }
});

// Route to get current prices for watchlisted games
app.get('/api/watchlist', async (req, res) => {
  const idsParam = req.query.ids;
  if (!idsParam) {
    return res.json({ games: [] });
  }

  const nsuids = idsParam.split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id));
  if (nsuids.length === 0) {
    return res.json({ games: [] });
  }

  try {
    const fxRates = await getExchangeRates();

    // Query Nintendo Europe by NSUIDs
    const idQuery = nsuids.join(' OR ');
    const euSearchUrl = `https://search.nintendo-europe.com/en/select?q=*&fq=type:GAME%20AND%20nsuid_txt:(${encodeURIComponent(idQuery)})&wt=json&rows=50`;
    console.log(`Querying EU eShop Watchlist: ${euSearchUrl}`);

    const euRes = await fetch(euSearchUrl);
    if (!euRes.ok) throw new Error('Nintendo Europe search API failed for watchlist');
    const euJson = await euRes.json();

    const docs = (euJson.response && euJson.response.docs) || [];
    console.log(`Found ${docs.length} watchlisted games in EU eShop.`);

    // Match them to Instant Gaming using their titles in parallel
    const igPromises = docs.map(doc => scrapeInstantGaming(doc.title));
    const igResultsArray = await Promise.all(igPromises);

    // Process each game
    const resolvedGamesPromises = docs.map(async (doc, index) => {
      const title = doc.title;
      const euNsuid = doc.nsuid_txt ? doc.nsuid_txt[0] : null;
      const productCode = doc.product_code_txt ? doc.product_code_txt[0] : null;
      const applicationId = doc.application_id_s || null;
      const publisher = doc.publisher || doc.maker || 'Nintendo';
      const releaseDate = doc.release_date_on_retail || doc.dates_released_dts?.[0] || null;

      if (!euNsuid) return null;

      const jpGameInfo = await resolveJpGameInfo(applicationId, productCode);
      const usNsuid = await resolveUsNsuid(applicationId);

      const esPricePromise = fetchNintendoPrice('ES', euNsuid);
      const jpPricePromise = jpGameInfo ? fetchNintendoPrice('JP', jpGameInfo.nsuid) : Promise.resolve(null);
      const usPricePromise = usNsuid ? fetchNintendoPrice('US', usNsuid) : Promise.resolve(null);

      const [esPrice, jpPrice, usPrice] = await Promise.all([esPricePromise, jpPricePromise, usPricePromise]);

      let jpPriceInEur = null;
      let jpDiscountPriceInEur = null;
      if (jpPrice) {
        jpPriceInEur = parseFloat((jpPrice.regularPrice * fxRates.JPY).toFixed(2));
        if (jpPrice.discountPrice) {
          jpDiscountPriceInEur = parseFloat((jpPrice.discountPrice * fxRates.JPY).toFixed(2));
        }
      }

      let usPriceInEur = null;
      let usDiscountPriceInEur = null;
      if (usPrice) {
        usPriceInEur = parseFloat((usPrice.regularPrice * fxRates.USD).toFixed(2));
        if (usPrice.discountPrice) {
          usDiscountPriceInEur = parseFloat((usPrice.discountPrice * fxRates.USD).toFixed(2));
        }
      }

      const igGames = igResultsArray[index] || [];
      const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, ' ');
      const words = cleanTitle.split(' ').filter(w => w.length > 3);
      
      let matchingIg = null;
      if (words.length > 0) {
        matchingIg = igGames.find(ig => {
          const igTitle = ig.name.toLowerCase();
          const matchedWords = words.filter(word => igTitle.includes(word));
          return (matchedWords.length / words.length) >= 0.6;
        });
      }

      // Determine cheapest
      let cheapest = null;
      let minPrice = Infinity;

      if (esPrice) {
        const esVal = esPrice.discountPrice !== null ? esPrice.discountPrice : esPrice.regularPrice;
        if (esVal < minPrice) {
          minPrice = esVal;
          cheapest = 'eShop ES';
        }
      }

      if (jpPrice && (jpDiscountPriceInEur !== null ? jpDiscountPriceInEur : jpPriceInEur) !== null) {
        const jpVal = jpDiscountPriceInEur !== null ? jpDiscountPriceInEur : jpPriceInEur;
        if (jpVal < minPrice) {
          minPrice = jpVal;
          cheapest = 'eShop JP';
        }
      }

      if (usPrice && (usDiscountPriceInEur !== null ? usDiscountPriceInEur : usPriceInEur) !== null) {
        const usVal = usDiscountPriceInEur !== null ? usDiscountPriceInEur : usPriceInEur;
        if (usVal < minPrice) {
          minPrice = usVal;
          cheapest = 'eShop US';
        }
      }

      if (matchingIg && matchingIg.price) {
        if (matchingIg.price < minPrice && matchingIg.inStock) {
          minPrice = matchingIg.price;
          cheapest = 'Instant Gaming';
        }
      }

      return {
        title,
        euNsuid,
        productCode,
        applicationId,
        publisher,
        releaseDate,
        imageUrl: doc.image_url_h2x1_s || doc.image_url || null,
        jpGame: jpGameInfo ? {
          title: jpGameInfo.titleName || title,
          nsuid: jpGameInfo.nsuid,
          initialCode: jpGameInfo.initialCode,
          screenshot: jpGameInfo.screenshot
        } : null,
        usNsuid: usNsuid,
        prices: {
          es: esPrice ? {
            ...esPrice,
            finalPrice: esPrice.discountPrice !== null ? esPrice.discountPrice : esPrice.regularPrice
          } : null,
          jp: jpPrice ? {
            ...jpPrice,
            finalPrice: jpPrice.discountPrice !== null ? jpPrice.discountPrice : jpPrice.regularPrice,
            priceInEur: jpPriceInEur,
            finalPriceInEur: jpDiscountPriceInEur !== null ? jpDiscountPriceInEur : jpPriceInEur
          } : null,
          us: usPrice ? {
            ...usPrice,
            finalPrice: usPrice.discountPrice !== null ? usPrice.discountPrice : usPrice.regularPrice,
            priceInEur: usPriceInEur,
            finalPriceInEur: usDiscountPriceInEur !== null ? usDiscountPriceInEur : usPriceInEur
          } : null,
          ig: matchingIg ? {
            price: matchingIg.price,
            discountPercent: matchingIg.discount,
            url: matchingIg.url,
            inStock: matchingIg.inStock
          } : null
        },
        cheapest: minPrice !== Infinity ? {
          platform: cheapest,
          price: minPrice
        } : null,
        physicalOffers: await fetchPhysicalOffers(title)
      };
    });

    const results = (await Promise.all(resolvedGamesPromises)).filter(Boolean);

    res.json({
      exchangeRates: fxRates,
      games: results
    });
  } catch (error) {
    console.error('Watchlist router error:', error);
    res.status(500).json({ error: error.message || 'An error occurred fetching watchlist prices' });
  }
});

// XML status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    jpXmlLoaded: jpGamesCache.length > 0,
    jpXmlSize: jpGamesCache.length,
    isLoading: isXmlLoading,
    error: xmlLoadError,
    exchangeRates: exchangeRatesCache.rates
  });
});

// Trigger XML load on startup
loadJpGamesXml();

// Serve production assets if built
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
