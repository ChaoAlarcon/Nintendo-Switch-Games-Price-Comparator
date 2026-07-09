import React, { useState, useEffect } from 'react';

//Games 
import zeldaLogo from './games_logos/zelda.png';
import marioLogo from './games_logos/super-mario-seeklogo.png';
import pokemonLogo from './games_logos/Pokemon-Logo.png';
import metroidLogo from './games_logos/Metroid.png';
import personaLogo from './games_logos/Persona-5-Emblem.png';
import splatoonLogo from './games_logos/Splatoon-Logo.png';
import bayonettaLogo from './games_logos/Bayonetta.png';
import minecraftLogo from './games_logos/Minecraft-Logo.png';

//Shops logos
import spainShop from "./images/SpainShop.png";
import usaShop from "./images/UsaShop.png";
import japanShop from "./images/JapanShop.png";
import amazon from "./images/Amazon.png";
import lupaIcon from "./images/lupa2.png";




const SUGGESTIONS = [
  { name: 'Zelda', image: zeldaLogo },
  { name: 'Mario', image: marioLogo },
  { name: 'Pokemon', image: pokemonLogo },
  { name: 'Metroid', image: metroidLogo },
  { name: 'Persona', image: personaLogo },
  { name: 'Splatoon', image: splatoonLogo },
  { name: 'Bayonetta', image: bayonettaLogo },
  { name: 'Minecraft', image: minecraftLogo },


];

function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [backendStatus, setBackendStatus] = useState(null);

  // Watchlist states
  const [watchlistIds, setWatchlistIds] = useState(() => {
    const saved = localStorage.getItem('switch_watchlist');
    return saved ? JSON.parse(saved) : [];
  });
  const [watchlistData, setWatchlistData] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  // Sorting & Filtering states
  const [sortBy, setSortBy] = useState('relevance'); // 'relevance' | 'price_asc' | 'price_desc' | 'discount_desc' | 'release_date'
  const [filterOnSale, setFilterOnSale] = useState(false);
  const [filterInStock, setFilterInStock] = useState(false);

  // Check backend XML status on load
  useEffect(() => {
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        setBackendStatus(data);
      })
      .catch(err => console.error('Error fetching status:', err));
  }, []);

  // Load watchlist prices on startup or when IDs change
  const loadWatchlist = async (ids = watchlistIds) => {
    if (ids.length === 0) {
      setWatchlistData([]);
      return;
    }
    setWatchlistLoading(true);
    try {
      const res = await fetch(`/api/watchlist?ids=${ids.join(',')}`);
      if (!res.ok) throw new Error('Fallo al cargar la lista de favoritos.');
      const data = await res.json();
      setWatchlistData(data.games || []);
    } catch (err) {
      console.error('Error loading watchlist details:', err);
    } finally {
      setWatchlistLoading(false);
    }
  };

  useEffect(() => {
    loadWatchlist();
  }, []);

  const handleSearch = async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 2) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Fallo en la búsqueda.');
      }
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Error al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    handleSearch(query);
  };

  const handleSuggestionClick = (name) => {
    setQuery(name);
    handleSearch(name);
  };

  const clearSearch = () => {
    setQuery('');
    setResults(null);
    setError(null);
  };

  const toggleWatchlist = (euNsuid) => {
    let next;
    if (watchlistIds.includes(euNsuid)) {
      next = watchlistIds.filter(id => id !== euNsuid);
    } else {
      next = [...watchlistIds, euNsuid];
    }
    setWatchlistIds(next);
    localStorage.setItem('switch_watchlist', JSON.stringify(next));
    loadWatchlist(next);
  };

  // Helper to format currency
  const formatEUR = (value) => {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
  };

  // Helper to format JPY
  const formatJPY = (value) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
  };

  // Helper to format USD
  const formatUSD = (value) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  // Helper to format date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Filter and sort items locally
  const getProcessedGames = (gamesList) => {
    if (!gamesList) return [];

    let filtered = [...gamesList];

    // Filter by sale
    if (filterOnSale) {
      filtered = filtered.filter(game => {
        const hasEsSale = game.prices.es && game.prices.es.discountPrice !== null;
        const hasJpSale = game.prices.jp && game.prices.jp.discountPrice !== null;
        const hasUsSale = game.prices.us && game.prices.us.discountPrice !== null;
        const hasIgSale = game.prices.ig && game.prices.ig.discountPercent > 0;
        return hasEsSale || hasJpSale || hasUsSale || hasIgSale;
      });
    }

    // Filter by stock
    if (filterInStock) {
      filtered = filtered.filter(game => {
        return game.prices.ig && game.prices.ig.inStock;
      });
    }

    // Sort items
    if (sortBy === 'price_asc') {
      filtered.sort((a, b) => {
        const priceA = a.cheapest ? a.cheapest.price : Infinity;
        const priceB = b.cheapest ? b.cheapest.price : Infinity;
        return priceA - priceB;
      });
    } else if (sortBy === 'price_desc') {
      filtered.sort((a, b) => {
        const priceA = a.cheapest ? a.cheapest.price : -Infinity;
        const priceB = b.cheapest ? b.cheapest.price : -Infinity;
        return priceB - priceA;
      });
    } else if (sortBy === 'discount_desc') {
      filtered.sort((a, b) => {
        const maxDiscount = (game) => {
          let max = 0;
          if (game.prices.es && game.prices.es.discountPercent) max = Math.max(max, game.prices.es.discountPercent);
          if (game.prices.jp && game.prices.jp.discountPercent) max = Math.max(max, game.prices.jp.discountPercent);
          if (game.prices.us && game.prices.us.discountPercent) max = Math.max(max, game.prices.us.discountPercent);
          if (game.prices.ig && game.prices.ig.discountPercent) max = Math.max(max, game.prices.ig.discountPercent);
          return max;
        };
        return maxDiscount(b) - maxDiscount(a);
      });
    } else if (sortBy === 'release_date') {
      filtered.sort((a, b) => {
        const dateA = a.releaseDate ? new Date(a.releaseDate) : new Date(0);
        const dateB = b.releaseDate ? new Date(b.releaseDate) : new Date(0);
        return dateB - dateA;
      });
    }

    return filtered;
  };

  const renderGameCard = (game) => {
    const esPrice = game.prices.es;
    const jpPrice = game.prices.jp;
    const usPrice = game.prices.us;
    const igPrice = game.prices.ig;
    const physicalOffers = game.physicalOffers || [];
    const cheapestPhysical = physicalOffers.length > 0
      ? physicalOffers.reduce((best, o) => o.inStock && o.price < (best ? best.price : Infinity) ? o : best, null)
      : null;
    const isPhysicalCheapest = game.cheapest && physicalOffers.some(o => o.seller === game.cheapest.platform);

    const coverSrc = game.imageUrl
      ? game.imageUrl
      : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="140" height="196" viewBox="0 0 140 196" fill="%2312141D"%3E%3Crect width="100%" height="100%"/%3E%3Cpath d="M70 75a15 15 0 1 0 0 30 15 15 0 0 0 0-30zm-20-40h40v15H50z" fill="%232D3043"/%3E%3C/svg%3E';

    const isFav = watchlistIds.includes(game.euNsuid);

    return (
      <div key={game.euNsuid} className="game-card glass-panel" style={{ padding: 0, border: '3px solid #000' }}>
        {/* Game header details */}
        <div className="game-card-header">
          <img src={coverSrc} alt={`Portada de ${game.title}`} className="game-cover" onError={(e) => {
            e.target.onerror = null;
            e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="140" height="196" viewBox="0 0 140 196" fill="%2312141D"%3E%3Crect width="100%" height="100%"/%3E%3Cpath d="M70 75a15 15 0 1 0 0 30 15 15 0 0 0 0-30zm-20-40h40v15H50z" fill="%232D3043"/%3E%3C/svg%3E';
          }} />
          <div className="game-info">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <h2 className="game-title">{game.title}</h2>
                <button
                  type="button"
                  onClick={() => toggleWatchlist(game.euNsuid)}
                  className={`watchlist-btn ${isFav ? 'active' : ''}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0.3rem',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(214, 0, 111, 0.1)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill={isFav ? "var(--switch-red)" : "none"} stroke={isFav ? "var(--switch-red)" : "var(--text-secondary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.15)'} onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                  </svg>
                </button>
              </div>

              {game.jpGame && game.jpGame.title && game.jpGame.title !== game.title && (
                <p style={{ fontSize: '0.85rem', color: 'var(--switch-blue)', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                  Título JP: {game.jpGame.title}
                </p>
              )}
              <div className="game-meta">
                <span className="game-meta-item">
                  <span className="badge-platform">Switch</span>
                </span>
                <span className="game-meta-item">
                  <strong>Distribuidor:</strong> {game.publisher}
                </span>
                <span className="game-meta-item">
                  <strong>Lanzamiento:</strong> {formatDate(game.releaseDate)}
                </span>
              </div>
            </div>

            {game.cheapest && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '2px solid #000',
                boxShadow: '2px 2px 0 #171717',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                width: 'fit-content',
                marginTop: '0.5rem'
              }}>
                <span style={{ width: '8px', height: '8px', background: 'var(--success)', border: '1px solid #000', borderRadius: '50%' }}></span>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  Mejor opción: <span style={{ color: 'var(--success)' }}>{formatEUR(game.cheapest.price)}</span> en {game.cheapest.platform}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Pricing grid */}
        <div className="comparison-grid">

          {/* Precios Físicos */}
          <div className={`price-card ${isPhysicalCheapest ? 'cheapest' : ''}`} style={{ gridColumn: physicalOffers.length === 0 ? undefined : undefined }}>
            <div className="shop-name">
              <img src={amazon} style={{ width: '145px', height: 'auto', marginLeft: '-50px', marginRight: '-45px' }} />
              <h4 style={{ fontSize: '1rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>Físico (Cartucho)</h4>
            </div>
            {cheapestPhysical ? (
              <div className="price-wrapper">
                <div className="current-price">{formatEUR(cheapestPhysical.price)}</div>
                <div className="jp-price-sub" style={{ color: 'var(--success)' }}>Mejor precio</div>
                <div style={{ width: '100%', marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {physicalOffers.map((offer, i) => (
                    <a
                      key={i}
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.35rem 0.6rem',
                        borderRadius: '6px',
                        background: offer.seller === cheapestPhysical.seller
                          ? 'rgba(214, 0, 111, 0.1)'
                          : 'rgba(0, 0, 0, 0.03)',
                        border: offer.seller === cheapestPhysical.seller
                          ? '2px solid var(--switch-red)'
                          : '1px solid rgba(0, 0, 0, 0.15)',
                        textDecoration: 'none',
                        color: 'var(--text-main)',
                        fontSize: '0.82rem',
                        transition: 'background 0.2s',
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{offer.seller}</span>
                      <span style={{ fontWeight: 700, color: offer.seller === cheapestPhysical.seller ? 'var(--switch-red)' : 'var(--text-main)' }}>
                        {formatEUR(offer.price)}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', margin: 'auto 0', textAlign: 'center', fontSize: '0.9rem' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>🔍</div>
                No encontrado
              </div>
            )}
            {cheapestPhysical && (
              <a
                href={cheapestPhysical.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shop-link-btn"
                style={{ background: 'linear-gradient(135deg, var(--switch-blue), var(--switch-red))', color: '#fff' }}
              >
                Ver mejor precio
              </a>
            )}
            {!cheapestPhysical && (
              <a
                href={`https://www.amazon.es/s?k=Nintendo+Switch+${encodeURIComponent(game.title)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shop-link-btn"
                style={{ opacity: 0.6 }}
              >
                Buscar en Amazon
              </a>
            )}
          </div>

          {/* Nintendo eShop España */}
          <div className={`price-card ${game.cheapest && game.cheapest.platform === 'eShop ES' ? 'cheapest' : ''}`}>
            <div className="shop-name">
              <img src={spainShop} style={{ width: '145px', height: 'auto', marginLeft: '-50px', marginRight: '-45px' }} />
              <h4 style={{ fontSize: '1rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>eShop (ES)</h4>
            </div>
            {esPrice ? (
              <div className="price-wrapper">
                {esPrice.discountPrice !== null ? (
                  <>
                    <div className="original-price">{esPrice.regularPriceFormatted}</div>
                    <div className="current-price">
                      {formatEUR(esPrice.discountPrice)}
                      <span className="discount-badge">-{esPrice.discountPercent}%</span>
                    </div>
                  </>
                ) : (
                  <div className="current-price">{formatEUR(esPrice.regularPrice)}</div>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', margin: 'auto 0' }}>No disponible</div>
            )}
            <a
              href={esPrice ? `https://www.nintendo.es/Buscar/Buscar-299117.html?q=${encodeURIComponent(game.title)}` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="shop-link-btn"
              style={!esPrice ? { opacity: 0.5, pointerEvents: 'none' } : {}}
            >
              Ver en eShop ES
            </a>
          </div>

          {/* Nintendo eShop Japón */}
          <div className={`price-card ${game.cheapest && game.cheapest.platform === 'eShop JP' ? 'cheapest' : ''}`}>
            <div className="shop-name">
              <img src={japanShop} style={{ width: '145px', height: 'auto', marginLeft: '-50px', marginRight: '-45px' }} />
              <h4 style={{ fontSize: '1rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>eShop (JP)</h4>
            </div>
            {jpPrice ? (
              <div className="price-wrapper">
                {jpPrice.discountPrice !== null ? (
                  <>
                    <div className="original-price">{formatJPY(jpPrice.regularPrice)}</div>
                    <div className="current-price">
                      {formatEUR(jpPrice.finalPriceInEur)}
                      <span className="discount-badge">-{jpPrice.discountPercent}%</span>
                    </div>
                    <div className="jp-price-sub">{formatJPY(jpPrice.discountPrice)}</div>
                  </>
                ) : (
                  <>
                    <div className="current-price">{formatEUR(jpPrice.priceInEur)}</div>
                    <div className="jp-price-sub">{formatJPY(jpPrice.regularPrice)}</div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', margin: 'auto 0' }}>
                {game.jpGame ? 'No disponible' : 'No mapeado en JP'}
              </div>
            )}
            <a
              href={game.jpGame ? `https://store-jp.nintendo.com/item/software/${game.jpGame.nsuid}` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="shop-link-btn"
              style={!game.jpGame ? { opacity: 0.5, pointerEvents: 'none' } : {}}
            >
              Ver en eShop JP
            </a>
          </div>

          {/* Nintendo eShop EE.UU. */}
          <div className={`price-card ${game.cheapest && game.cheapest.platform === 'eShop US' ? 'cheapest' : ''}`}>
            <div className="shop-name">
              <img src={usaShop} style={{ width: '145px', height: 'auto', marginLeft: '-50px', marginRight: '-45px' }} />
              <h4 style={{ fontSize: '1rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>eShop (US)</h4>
            </div>
            {usPrice ? (
              <div className="price-wrapper">
                {usPrice.discountPrice !== null ? (
                  <>
                    <div className="original-price">{formatUSD(usPrice.regularPrice)}</div>
                    <div className="current-price">
                      {formatEUR(usPrice.finalPriceInEur)}
                      <span className="discount-badge">-{usPrice.discountPercent}%</span>
                    </div>
                    <div className="jp-price-sub">{formatUSD(usPrice.discountPrice)}</div>
                  </>
                ) : (
                  <>
                    <div className="current-price">{formatEUR(usPrice.priceInEur)}</div>
                    <div className="jp-price-sub">{formatUSD(usPrice.regularPrice)}</div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', margin: 'auto 0' }}>No disponible</div>
            )}
            <a
              href={usPrice ? `https://www.nintendo.com/us/search/#q=${encodeURIComponent(game.title)}` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="shop-link-btn"
              style={!usPrice ? { opacity: 0.5, pointerEvents: 'none' } : {}}
            >
              Ver en eShop US
            </a>
          </div>

          {/* Instant Gaming */}
          <div className={`price-card ${game.cheapest && game.cheapest.platform === 'Instant Gaming' ? 'cheapest' : ''}`}>
            <div className="shop-name">
              <span style={{ color: 'var(--warning)' }}>⚡</span>
              Instant Gaming
            </div>
            {igPrice ? (
              <div className="price-wrapper">
                {igPrice.inStock ? (
                  <>
                    <div className="current-price">
                      {formatEUR(igPrice.price)}
                      {igPrice.discountPercent > 0 && (
                        <span className="discount-badge">-{igPrice.discountPercent}%</span>
                      )}
                    </div>
                    <div className="jp-price-sub" style={{ color: 'var(--success)' }}>En Stock</div>
                  </>
                ) : (
                  <div style={{ color: '#c0392b', fontWeight: 600, fontSize: '1.2rem' }}>Agotado</div>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', margin: 'auto 0' }}>No disponible</div>
            )}
            <a
              href={igPrice ? igPrice.url : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="shop-link-btn"
              style={!igPrice ? { opacity: 0.5, pointerEvents: 'none' } : {}}
            >
              Comprar Clave
            </a>
          </div>


        </div>
      </div>
    );
  };


  const processedSearchResults = results ? getProcessedGames(results.games) : [];
  const processedWatchlistResults = getProcessedGames(watchlistData);

  return (
    <div className="container">
      {/* Header */}
      <header className="switch-header">
        <div className="switch-logo-anim">
          <span className="dot-l"></span>
          <span className="dot-r"></span>
        </div>
        <h1 className="title-glow">Nintendo Switch Price Comparator</h1>
      </header>

      {/* Main Panel */}
      <main className="glass-panel">
        {/* Search form */}
        <form onSubmit={onSubmit} className="search-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="Escribe el nombre de un juego (ej: Zelda)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
          />
          <span className="search-icon">
            <img src={lupaIcon} alt="Buscar" />
          </span>
          {query && !loading && (
            <button type="button" onClick={clearSearch} className="search-clear" aria-label="Limpiar búsqueda">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
        </form>

        {/* Quick suggestions */}
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '2rem' }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s.name}
              onClick={() => handleSuggestionClick(s.name)}
              disabled={loading}
              style={{
                display: 'flex', // Añadido para alinear imagen y texto
                alignItems: 'center',
                gap: '8px',
                background: '#fff',
                border: '2px solid #000',
                borderRadius: '20px',
                padding: '0.4rem 1rem',
                color: 'var(--text-main)',
                cursor: "url('black-12/14 cursor.cur') 5 5, pointer",
                fontFamily: 'var(--font-sans)',
                fontWeight: '500',
                fontSize: '0.9rem',
                boxShadow: '2px 2px 0 #171717',
                transition: 'all 0.15s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'var(--bg-darker)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {/* Añadimos la imagen dentro del botón */}
              <img src={s.image} alt={s.name} style={{ width: '100px', height: 'auto' }} />

            </button>
          ))}
        </div>


        {/* Controls: Sorting and Filtering */}
        {((results && results.games && results.games.length > 0) || (query === '' && watchlistData && watchlistData.length > 0)) && (
          <div style={{

            background: '#fff',
            border: '2px solid #000',
            boxShadow: '3px 3px 0 #171717',
            borderRadius: '12px',
            padding: '0.4rem 1rem',
            marginBottom: '15px',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-sans)',
            fontWeight: '500',
            fontSize: '0.9rem',
          }}>

            <label htmlFor="sort-select">Ordenar por:</label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="control-select" style={{
                marginTop: '15px',
                marginBottom: '15px',
                marginLeft: '15px',
                gap: '8px',
                background: '#fff',
                border: '2px solid #000',
                boxShadow: '2px 2px 0 #171717',
                borderRadius: '8px',
                padding: '0.4rem 1rem',
                color: 'var(--text-main)',
                cursor: "url('black-12/14 cursor.cur') 5 5, pointer",
                fontFamily: 'var(--font-sans)',
                fontWeight: '500',
                fontSize: '0.9rem',


              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'var(--bg-darker)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = '#fff';
              }}
            >

              <option value="relevance">Relevancia</option>
              <option value="price_asc">Precio: Menor a Mayor</option>
              <option value="price_desc">Precio: Mayor a Menor</option>
              <option value="discount_desc">Descuento %: Mayor a Menor</option>
              <option value="release_date">Fecha de Lanzamiento</option>
            </select>



            <label className="control-checkbox-label">
              <input
                type="checkbox"
                checked={filterOnSale}
                onChange={(e) => setFilterOnSale(e.target.checked)}
                className={filterOnSale ? 'check checked' : 'check'}
              />
              <span className="checkbox-custom" style={{
                marginLeft: '15px',
              }} ></span>
              Solo en Oferta
            </label>


            <label className="control-checkbox-label" style={{
              marginLeft: '15px',
            }}>
              <input
                type="checkbox"
                checked={filterInStock}
                onChange={(e) => setFilterInStock(e.target.checked)}
                className={filterInStock ? 'check checked' : 'check'}
              />
              <span className="checkbox-custom" style={{
                marginLeft: '15px',
              }}></span>
              Solo en Stock (Instant Gaming)
            </label>


          </div>
        )
        }


        {/* Status indicator (if XML is still caching in backend) */}
        {
          backendStatus && backendStatus.isLoading && (
            <div style={{
              background: 'rgba(250, 167, 0, 0.15)',
              border: '2px solid #000',
              boxShadow: '2px 2px 0 #171717',
              borderRadius: '12px',
              padding: '0.8rem 1.2rem',
              marginBottom: '2rem',
              textAlign: 'center',
              fontSize: '0.9rem',
              color: 'var(--text-main)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.6rem'
            }}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'var(--switch-blue)', border: '1px solid #000', borderRadius: '50%', animation: 'pulse 1s infinite' }}></span>
              El servidor está descargando la base de datos de la eShop de Japón para comparaciones rápidas. Búsquedas disponibles, el mapeo de Japón se activará al completarse.
            </div>
          )
        }

        {/* Error message */}
        {
          error && (
            <div style={{
              background: 'rgba(214, 0, 111, 0.08)',
              border: '2px solid #000',
              boxShadow: '2px 2px 0 #171717',
              borderRadius: '12px',
              padding: '1rem 1.5rem',
              marginBottom: '2rem',
              color: 'var(--switch-red)',
              textAlign: 'center'
            }}>
              <strong>Error:</strong> {error}
            </div>
          )
        }

        {/* Loading Spinner */}
        {
          loading && (
            <div className="loading-container">
              <div className="switch-loader">
                <span className="joycon-l"></span>
                <span className="joycon-r"></span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '1.1rem' }}>
                Buscando mejores precios y convirtiendo divisas...
              </p>
            </div>
          )
        }

        {/* Search Results */}
        {
          !loading && results && (
            <div>
              {results.games.length === 0 ? (
                <div className="no-results">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem' }}>
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                  </svg>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>No se encontraron juegos</p>
                  <p style={{ fontSize: '0.95rem', marginTop: '0.3rem' }}>Intenta buscar con palabras clave más cortas como "Zelda", "Mario" o "Metroid".</p>
                </div>
              ) : processedSearchResults.length === 0 ? (
                <div className="no-results">
                  <p style={{ fontSize: '1.1rem' }}>Ningún juego coincide con los filtros aplicados.</p>
                </div>
              ) : (
                processedSearchResults.map(game => renderGameCard(game))
              )}
            </div>
          )
        }

        {/* Watchlist Section */}
        {
          query === '' && !loading && (
            <div className="watchlist-section" style={{ marginTop: '1rem' }}>
              <h2 className="section-title" style={{
                fontSize: '1.4rem',
                fontFamily: 'var(--font-display)',
                textTransform: 'uppercase',
                fontWeight: '700',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                color: 'var(--text-main)'
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="var(--switch-red)" stroke="var(--switch-red)" strokeWidth="2" style={{ marginRight: '0.6rem' }}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
                Tus Favoritos (Watchlist)
              </h2>

              {watchlistLoading ? (
                <div className="loading-container" style={{ padding: '2rem' }}>
                  <div className="switch-loader">
                    <span className="joycon-l"></span>
                    <span className="joycon-r"></span>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>Actualizando precios favoritos...</p>
                </div>
              ) : watchlistData.length === 0 ? (
                <div className="empty-watchlist" style={{
                  textAlign: 'center',
                  padding: '3rem 2rem',
                  border: '2px dashed #000',
                  borderRadius: '16px',
                  background: 'rgba(0, 0, 0, 0.02)'
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                  </svg>
                  <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Tu lista de favoritos está vacía</p>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.4rem', maxWidth: '450px', margin: '0.4rem auto 0 auto', lineHeight: '1.4' }}>
                    Busca tus juegos favoritos y pulsa el icono del corazón para guardarlos aquí. Se actualizarán automáticamente con los precios reales.
                  </p>
                </div>
              ) : processedWatchlistResults.length === 0 ? (
                <div className="no-results" style={{ padding: '2rem' }}>
                  <p>Ningún favorito coincide con los filtros aplicados.</p>
                </div>
              ) : (
                processedWatchlistResults.map(game => renderGameCard(game))
              )}
            </div>
          )
        }
      </main >

      {/* Footer Info */}
      < footer className="footer" >
        {backendStatus && backendStatus.exchangeRates && (
          <div className="fx-info" style={{ marginBottom: '1.5rem', display: 'inline-flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="fx-dot"></span>
              <span>1 JPY = {backendStatus.exchangeRates.JPY} EUR</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="fx-dot" style={{ background: 'var(--switch-blue)', border: '1px solid #000', boxShadow: 'none' }}></span>
              <span>1 USD = {backendStatus.exchangeRates.USD} EUR</span>
            </div>
          </div>
        )}
        <p>Nintendo Switch Price Comparator &copy; 2026. Esta aplicación es independiente y no está afiliada con Nintendo.</p>
        <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          * Las compras en la eShop de Japón o EE. UU. requieren una cuenta Nintendo de esa región. La Nintendo Switch es 100% libre de región.
        </p>
      </footer >
    </div >
  );
}

export default App;