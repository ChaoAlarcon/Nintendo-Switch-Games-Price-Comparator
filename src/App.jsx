import React, { useState, useEffect } from 'react';

// Quick suggestions for games
const SUGGESTIONS = [
  { name: 'Zelda', label: '🛡️ Zelda' },
  { name: 'Mario Odyssey', label: '🍄 Mario Odyssey' },
  { name: 'Metroid Dread', label: '🚀 Metroid' },
  { name: 'Animal Crossing', label: '🏝️ Animal Crossing' },
  { name: 'Smash Bros', label: '🥊 Smash Bros' }
];

function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [backendStatus, setBackendStatus] = useState(null);

  // Check backend XML status on load
  useEffect(() => {
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        setBackendStatus(data);
      })
      .catch(err => console.error('Error fetching status:', err));
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

  // Helper to format currency
  const formatEUR = (value) => {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
  };

  // Helper to format JPY
  const formatJPY = (value) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
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
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
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
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '2.5rem' }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s.name}
              onClick={() => handleSuggestionClick(s.name)}
              disabled={loading}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '20px',
                padding: '0.4rem 1rem',
                color: 'var(--text-main)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontWeight: '500',
                fontSize: '0.9rem',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Status indicator (if XML is still caching in backend) */}
        {backendStatus && backendStatus.isLoading && (
          <div style={{
            background: 'rgba(0, 160, 233, 0.1)',
            border: '1px solid rgba(0, 160, 233, 0.2)',
            borderRadius: '12px',
            padding: '0.8rem 1.2rem',
            marginBottom: '2rem',
            textAlign: 'center',
            fontSize: '0.9rem',
            color: 'var(--switch-blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6rem'
          }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'var(--switch-blue)', borderRadius: '50%', animation: 'pulse 1s infinite' }}></span>
            El servidor está descargando la base de datos de la eShop de Japón para comparaciones rápidas. Búsquedas disponibles, el mapeo de Japón se activará al completarse.
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{
            background: 'rgba(230, 0, 18, 0.1)',
            border: '1px solid rgba(230, 0, 18, 0.2)',
            borderRadius: '12px',
            padding: '1rem 1.5rem',
            marginBottom: '2rem',
            color: '#ff4d4d',
            textAlign: 'center'
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="loading-container">
            <div className="switch-loader">
              <span className="joycon-l"></span>
              <span className="joycon-r"></span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '1.1rem' }}>
              Buscando mejores precios y convirtiendo yenes...
            </p>
          </div>
        )}

        {/* Search Results */}
        {!loading && results && (
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
            ) : (
              results.games.map((game, idx) => {
                const esPrice = game.prices.es;
                const jpPrice = game.prices.jp;
                const igPrice = game.prices.ig;
                
                // Cover image fallback
                const coverSrc = game.imageUrl 
                  ? game.imageUrl 
                  : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="140" height="196" viewBox="0 0 140 196" fill="%2312141D"%3E%3Crect width="100%" height="100%"/%3E%3Cpath d="M70 75a15 15 0 1 0 0 30 15 15 0 0 0 0-30zm-20-40h40v15H50z" fill="%232D3043"/%3E%3C/svg%3E';

                return (
                  <div key={game.euNsuid} className="game-card glass-panel" style={{ padding: 0, border: '1px solid var(--card-border)' }}>
                    {/* Game header details */}
                    <div className="game-card-header">
                      <img src={coverSrc} alt={`Portada de ${game.title}`} className="game-cover" onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="140" height="196" viewBox="0 0 140 196" fill="%2312141D"%3E%3Crect width="100%" height="100%"/%3E%3Cpath d="M70 75a15 15 0 1 0 0 30 15 15 0 0 0 0-30zm-20-40h40v15H50z" fill="%232D3043"/%3E%3C/svg%3E';
                      }} />
                      <div className="game-info">
                        <div>
                          <h2 className="game-title">{game.title}</h2>
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
                            background: 'rgba(46, 204, 113, 0.1)',
                            border: '1px solid rgba(46, 204, 113, 0.3)',
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            width: 'fit-content',
                            marginTop: '0.5rem'
                          }}>
                            <span style={{ width: '8px', height: '8px', background: 'var(--success)', borderRadius: '50%' }}></span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                              Mejor opción: <span style={{ color: 'var(--success)' }}>{formatEUR(game.cheapest.price)}</span> en {game.cheapest.platform}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Pricing grid */}
                    <div className="comparison-grid">
                      {/* Nintendo eShop España */}
                      <div className={`price-card ${game.cheapest && game.cheapest.platform === 'eShop ES' ? 'cheapest' : ''}`}>
                        <div className="shop-name">
                          <span style={{ color: 'var(--switch-red)' }}>🔴</span>
                          Nintendo eShop (ES)
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
                          Ir a la eShop ES
                        </a>
                      </div>

                      {/* Nintendo eShop Japón */}
                      <div className={`price-card ${game.cheapest && game.cheapest.platform === 'eShop JP' ? 'cheapest' : ''}`}>
                        <div className="shop-name">
                          <span style={{ color: 'var(--switch-blue)' }}>🔵</span>
                          Nintendo eShop (JP)
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
                            {game.jpGame ? 'No disponible en API' : 'No mapeado en JP'}
                          </div>
                        )}
                        <a 
                          href={game.jpGame ? `https://store-jp.nintendo.com/item/software/${game.jpGame.nsuid}` : '#'} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="shop-link-btn"
                          style={!game.jpGame ? { opacity: 0.5, pointerEvents: 'none' } : {}}
                        >
                          Ir a la eShop JP
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
                              <div style={{ color: '#ff4d4d', fontWeight: 600, fontSize: '1.2rem' }}>Agotado</div>
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
              })
            )}
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="footer">
        {results && results.exchangeRate && (
          <div className="fx-info" style={{ marginBottom: '1.5rem' }}>
            <span className="fx-dot"></span>
            <span>Tipo de cambio actual: 1 JPY = {results.exchangeRate} EUR (Conversión automática de la eShop de Japón)</span>
          </div>
        )}
        <p>Nintendo Switch Price Comparator &copy; 2026. Esta aplicación es independiente y no está afiliada con Nintendo.</p>
        <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          * Las compras en la eShop de Japón requieren una cuenta Nintendo de esa región. La Switch es 100% libre de región.
        </p>
      </footer>
    </div>
  );
}

export default App;
