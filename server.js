import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory caches
let jpGamesCache = [];
let exchangeRateCache = {
  rate: 0.0054, // Fallback rate JPY -> EUR
  lastUpdated: 0
};
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

// Fetch real-time JPY to EUR exchange rate
async function getExchangeRate() {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  if (now - exchangeRateCache.lastUpdated < ONE_HOUR && exchangeRateCache.rate > 0) {
    return exchangeRateCache.rate;
  }
  
  try {
    console.log('Fetching live JPY to EUR exchange rate...');
    const res = await fetch('https://open.er-api.com/v6/latest/JPY');
    if (!res.ok) throw new Error('Failed to fetch exchange rate');
    const json = await res.json();
    if (json && json.rates && json.rates.EUR) {
      exchangeRateCache.rate = json.rates.EUR;
      exchangeRateCache.lastUpdated = now;
      console.log(`Updated exchange rate: 1 JPY = ${exchangeRateCache.rate} EUR`);
    }
  } catch (err) {
    console.error('Error updating exchange rate, using cached value:', err.message);
  }
  return exchangeRateCache.rate;
}

// Map EU code (e.g. HACPAR3NA) to JP Game info
function mapEuCodeToJpGame(euProductCode) {
  if (!euProductCode || jpGamesCache.length === 0) return null;
  
  // Clean product code
  const cleanCode = euProductCode.trim().toUpperCase();
  
  // Attempt 1: Standard layout mapping (drop prefix 'HACP' and prepend 'HAC')
  // EU: HACP-AR3NA (represented as HACPAR3NA) -> JP: HAC-AR3NA (represented as HACAR3NA)
  if (cleanCode.startsWith('HACP')) {
    const suffix = cleanCode.slice(4); // e.g. AR3NA or BDGEA
    const jpCandidate = 'HAC' + suffix;
    const found = jpGamesCache.find(g => g.initialCode === jpCandidate);
    if (found) return found;
  }
  
  // Attempt 2: Match by core 4-character ID (indices 4-7 for HACP, indices 3-6 for HAC)
  let coreCode = '';
  if (cleanCode.startsWith('HACP') && cleanCode.length >= 8) {
    coreCode = cleanCode.slice(4, 8);
  } else if (cleanCode.startsWith('HAC') && cleanCode.length >= 7) {
    coreCode = cleanCode.slice(3, 7);
  }
  
  if (coreCode && coreCode.length === 4) {
    // Find a JP game containing the core code in its InitialCode
    const found = jpGamesCache.find(g => g.initialCode.includes(coreCode));
    if (found) return found;
  }
  
  return null;
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
        const nsuidMatch = location.match(/\/titles\/(\d+)/);
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

// Scrape Instant Gaming for Switch games
async function scrapeInstantGaming(query) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const url = `https://www.instant-gaming.com/es/search/?q=${encodeURIComponent(query)}`;
  
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

    const eurRate = await getExchangeRate();

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
        } : null
      };
    });

    const resolvedGames = (await Promise.all(resolvedGamesPromises)).filter(Boolean);

    // 4. Fetch prices in parallel for all resolved games
    const pricePromises = resolvedGames.map(async (game) => {
      const esPricePromise = fetchNintendoPrice('ES', game.euNsuid);
      const jpPricePromise = game.jpGame ? fetchNintendoPrice('JP', game.jpGame.nsuid) : Promise.resolve(null);
      
      const [esPrice, jpPrice] = await Promise.all([esPricePromise, jpPricePromise]);
      
      // Format JP price in EUR
      let jpPriceInEur = null;
      let jpDiscountPriceInEur = null;
      
      if (jpPrice) {
        jpPriceInEur = parseFloat((jpPrice.regularPrice * eurRate).toFixed(2));
        if (jpPrice.discountPrice) {
          jpDiscountPriceInEur = parseFloat((jpPrice.discountPrice * eurRate).toFixed(2));
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
          } : null
        }
      };
    });

    const [gamesWithPrices, igGames] = await Promise.all([
      Promise.all(pricePromises),
      igPromise
    ]);

    // 5. Build final structured results
    // We will return the list of eShop games, each containing its compared prices
    // and also return a list of relevant Instant Gaming products found, 
    // or try to match them dynamically to the eShop games based on string similarity.
    
    const results = gamesWithPrices.map(game => {
      // Find matching Instant Gaming offer
      // Simple matcher: check if the Instant Gaming title contains significant words of the eShop title
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

      if (matchingIg && matchingIg.price) {
        const igPrice = matchingIg.price;
        if (igPrice < minPrice && matchingIg.inStock) {
          minPrice = igPrice;
          cheapest = 'Instant Gaming';
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
        } : null
      };
    });

    res.json({
      exchangeRate: eurRate,
      games: results,
      unmatchedIg: igGames.filter(ig => !results.some(r => r.prices.ig && r.prices.ig.url === ig.url))
    });

  } catch (error) {
    console.error('Search router error:', error);
    res.status(500).json({ error: error.message || 'An error occurred during search' });
  }
});

// XML status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    jpXmlLoaded: jpGamesCache.length > 0,
    jpXmlSize: jpGamesCache.length,
    isLoading: isXmlLoading,
    error: xmlLoadError,
    exchangeRate: exchangeRateCache.rate
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
