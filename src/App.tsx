import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import "./App.css";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { store } from "./data/store";
import { formatPrice, sortNewestFirst } from "./data/products";
import { useProductCatalog } from "./ProductCatalogContext";
import { useCart } from "./CartContext";
import { useWishlist } from "./WishlistContext";
import { searchProducts } from "./lib/search-products";
import ProductCard from "./components/ProductCard";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Wishlist from "./pages/Wishlist";
import Search from "./pages/Search";
import Contact from "./pages/Contact";
import NewArrivals from "./pages/NewArrivals";
import Admin from "./pages/Admin";

function Header() {
  const { itemCount, subtotal } = useCart();
  const { count: wishlistCount } = useWishlist();
  const { products, state: catalogState } = useProductCatalog();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchClosing, setSearchClosing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeResult, setActiveResult] = useState(-1);
  const [scrolled, setScrolled] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasSearchOpen = useRef(false);
  const closeSearchTimer = useRef<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const searchResults = searchProducts(products, searchQuery).slice(0, 6);

  function closeMenu() {
    setMenuOpen(false);
  }

  function openSearch() {
    if (closeSearchTimer.current !== null) window.clearTimeout(closeSearchTimer.current);
    setSearchQuery(new URLSearchParams(location.search).get("q") ?? "");
    setActiveResult(-1);
    setSearchClosing(false);
    setSearchOpen(true);
    closeMenu();
  }

  function closeSearch() {
    if (searchClosing) return;
    setSearchClosing(true);
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
    closeSearchTimer.current = window.setTimeout(() => {
      setSearchOpen(false);
      setSearchClosing(false);
      setActiveResult(-1);
      closeSearchTimer.current = null;
    }, closeDelay);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = searchResults[activeResult];
    closeSearch();
    if (selected) navigate(`/product/${selected.slug}`);
    else navigate(`/search${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ""}`);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href]',
    )];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function handleSearchInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && searchResults.length) {
      event.preventDefault();
      setActiveResult((current) => (current + 1) % searchResults.length);
    } else if (event.key === "ArrowUp" && searchResults.length) {
      event.preventDefault();
      setActiveResult((current) => current <= 0 ? searchResults.length - 1 : current - 1);
    }
  }

  useEffect(() => {
    if (searchOpen) {
      wasSearchOpen.current = true;
      searchInputRef.current?.focus();
    } else if (wasSearchOpen.current) {
      wasSearchOpen.current = false;
      searchButtonRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => () => {
    if (closeSearchTimer.current !== null) window.clearTimeout(closeSearchTimer.current);
  }, []);

  useEffect(() => {
    function updateScrollState() {
      setScrolled(window.scrollY > 8);
    }
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  return (
    <>
      <div className="announcement">BUILT FOR YOUR OWN FORM.</div>
      <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
        <Link className="wordmark" to="/" onClick={closeMenu} aria-label={`${store.name} home`}>
          FORM <span className="wordmark-amp">&amp;</span> FOUND<span className="wordmark-period">.</span>
        </Link>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={menuOpen ? "m6 6 12 12M18 6 6 18" : "M3 7h18M3 12h18M3 17h18"} /></svg>
        </button>
        <nav
          className={`primary-navigation${menuOpen ? " is-open" : ""}`}
          id="primary-navigation"
          aria-label="Main navigation"
        >
          <NavLink to="/" onClick={closeMenu} end>Home</NavLink>
          <NavLink to="/shop" onClick={closeMenu} end>Shop</NavLink>
          <NavLink to="/new-arrivals" onClick={closeMenu} end>New Arrivals</NavLink>
          <NavLink to="/contact" onClick={closeMenu}>Contact</NavLink>
        </nav>
        <div className="header-actions">
          <button ref={searchButtonRef} type="button" className="header-icon-button" aria-label="Search products" onClick={openSearch}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
          </button>
          <Link className="header-icon-button" aria-label={`Wishlist, ${wishlistCount} saved items`} to="/wishlist">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.3 8.7c0 5.2-8.3 10-8.3 10s-8.3-4.8-8.3-10a4.5 4.5 0 0 1 8.3-2.4 4.5 4.5 0 0 1 8.3 2.4Z" /></svg>
            <span className="header-count">{wishlistCount}</span>
          </Link>
          <Link className="header-icon-button cart-header-link" aria-label={`Shopping bag, ${itemCount} items, subtotal ${formatPrice(subtotal)}`} to="/cart">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16l-1.2 12H5.2L4 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>
            <span className="header-count" key={itemCount}>{itemCount}</span>
            <span className="header-subtotal">{formatPrice(subtotal)}</span>
          </Link>
        </div>
      </header>
      {searchOpen && (
        <div className={`search-overlay${searchClosing ? " is-closing" : ""}`} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSearch();
        }}>
          <div
            className="search-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="header-search-title"
            ref={dialogRef}
            onKeyDown={handleDialogKeyDown}
          >
            <div className="search-dialog-heading">
              <p id="header-search-title">Find your next piece</p>
              <button type="button" className="search-close-button" aria-label="Close search" onClick={closeSearch}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <form className="header-search-form" role="search" onSubmit={submitSearch}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setActiveResult(-1);
                }}
                onKeyDown={handleSearchInputKeyDown}
                placeholder="Search clothing, collections, styles…"
                aria-label="Search clothing, collections, and styles"
                aria-controls="header-search-results"
                aria-activedescendant={activeResult >= 0 ? `header-search-result-${activeResult}` : undefined}
                autoComplete="off"
              />
              {searchQuery && (
                <button type="button" className="search-clear-button" aria-label="Clear search" onClick={() => {
                  setSearchQuery("");
                  setActiveResult(-1);
                  searchInputRef.current?.focus();
                }}>Clear</button>
              )}
            </form>
            <div className="header-search-results" id="header-search-results" aria-live="polite">
              {!searchQuery.trim() ? (
                <p className="header-search-hint">Search product names, descriptions, categories, or colours.</p>
              ) : catalogState === "loading" ? (
                <p className="header-search-hint" role="status">Loading the current collection…</p>
              ) : searchResults.length ? (
                <>
                  <p className="header-search-label">{searchResults.length} {searchResults.length === 1 ? "MATCH" : "MATCHES"}</p>
                  {searchResults.map((product, index) => (
                    <Link
                      className={`header-search-result${activeResult === index ? " is-active" : ""}`}
                      id={`header-search-result-${index}`}
                      key={product.id}
                      to={`/product/${product.slug}`}
                      onMouseEnter={() => setActiveResult(index)}
                      onClick={closeSearch}
                    >
                      <img
                        src={product.image}
                        alt=""
                        width="56"
                        height="70"
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = "/product-placeholder.svg";
                        }}
                      />
                      <span className="header-search-product-copy">
                        <span>{product.name}</span>
                        <small>{product.category.split("/")[0].trim()}</small>
                      </span>
                      <span className="header-search-price">{formatPrice(product.price)}</span>
                    </Link>
                  ))}
                </>
              ) : catalogState === "error" ? (
                <p className="header-search-hint" role="alert">The current collection could not be loaded. Please try again later.</p>
              ) : (
                <p className="header-search-hint">No pieces matched “{searchQuery.trim()}”. Try another name, style, or colour.</p>
              )}
            </div>
            {searchQuery.trim() && searchResults.length > 0 && (
              <button type="button" className="header-search-submit" onClick={() => {
                closeSearch();
                navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
              }}>View all results <span aria-hidden="true">↗</span></button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Footer() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleNewsletter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-brand">
          <Link className="wordmark" to="/">{store.name}<span className="wordmark-period">.</span></Link>
          <p>Everyday pieces. Room to make them your own.</p>
        </div>
        <div className="footer-links">
          <div><p className="footer-label">EXPLORE</p><Link to="/shop">The collection</Link><Link to="/new-arrivals">New arrivals</Link><Link to="/#collections">Collections</Link><Link to="/#story">Our story</Link></div>
          <div><p className="footer-label">YOUR SELECTION</p><Link to="/cart">Your bag</Link><Link to="/wishlist">Wishlist</Link></div>
        </div>
        <div className="footer-contact">
          <p className="footer-label">CONTACT</p>
          <Link to="/contact">Contact us</Link>
          <a href={`tel:${store.phoneLink}`}>{store.phone}</a>
          <a href={`mailto:${store.email}`}>{store.email}</a>
        </div>
        <form className="newsletter" onSubmit={handleNewsletter}>
          <label htmlFor="newsletter-email">NOTES FROM FORM & FOUND</label>
          <p>Occasional updates from the collection.</p>
          <div className="newsletter-control">
            <input
              id="newsletter-email"
              type="email"
              autoComplete="email"
              placeholder="Email address"
              required
              value={email}
              onChange={(event) => { setEmail(event.target.value); setSubmitted(false); }}
            />
            <button type="submit" aria-label="Preview newsletter signup">JOIN ↗</button>
          </div>
          <p className="form-note" role="status">
            {submitted ? "Demo only — newsletter signup is not connected." : "Demo form — no email will be sent or stored."}
          </p>
        </form>
      </div>
      <div className="footer-bottom">
        <span>© 2026 {store.name}</span>
        <span>NEPAL / NPR</span>
        <span>LOCAL STOREFRONT DEMO</span>
      </div>
    </footer>
  );
}

function Home() {
  const { products, state } = useProductCatalog();
  const categories = [...new Set(products.map((product) => product.category.split("/")[0].trim()))]
    .map((category) => ({
      name: category,
      image: products.find((product) => product.category.split("/")[0].trim() === category)?.image,
    }));
  const arrivals = sortNewestFirst(products.filter((product) => product.isNewArrival === true)).slice(0, 3);

  return (
    <main>
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="lime-mark" /> FORM & FOUND / EVERYDAY WEAR</p>
          <h1>Find your<br /><span>own form.</span></h1>
          <p className="hero-description">Everyday clothing, open to your point of view. Find the pieces that feel like you.</p>
          <div className="hero-links">
            <Link className="button button-lime" to="/shop">Shop the collection <span aria-hidden="true">↗</span></Link>
            <a className="text-link" href="#story">Our story</a>
          </div>
        </div>
        <div className="hero-visual" role="img" aria-label="Streetwear editorial featuring a layered outfit">
          <div className="hero-image"></div>
          <span className="image-caption">FORM & FOUND — THE EVERYDAY EDIT</span>
        </div>
      </section>

      <section className="section-wrap collection-section" id="collections">
        <div className="section-heading">
          <div><p className="eyebrow">EXPLORE THE LINEUP</p><h2>Collections<span>.</span></h2></div>
          <Link className="text-link" to="/shop">Browse the collection ↗</Link>
        </div>
        <div className="category-grid">
          {state === "loading" && <p className="catalog-loading" role="status">Loading the current collection…</p>}
          {categories.map(({ name, image }) => (
            <Link
              className="category-tile"
              key={name}
              to={`/shop?category=${encodeURIComponent(name)}`}
              style={image ? { backgroundImage: `linear-gradient(180deg, #29262112, #2926219c), url("${image}")` } : undefined}
            >
              <span>{name}</span>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
          {state === "ready" && categories.length === 0 && <p className="catalog-loading">The next collection is on its way.</p>}
        </div>
      </section>

      {arrivals.length > 0 && (
        <section className="section-wrap arrivals-section">
          <div className="section-heading">
            <div><p className="eyebrow">JUST ADDED</p><h2>New arrivals<span>.</span></h2></div>
              <Link className="text-link" to="/new-arrivals">View new arrivals ↗</Link>
          </div>
          <div className="product-grid">
            {arrivals.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
        </section>
      )}

      <section className="story-section" id="story">
        <p className="eyebrow">A LITTLE ABOUT US</p>
        <h2>Wear it<br /><span>your way.</span></h2>
        <p>FORM & FOUND is a place for everyday clothes and personal style. Choose the pieces you like, then make them your own.</p>
        <Link className="button button-outline" to="/shop">Shop the collection ↗</Link>
      </section>
      <section className="closing-section">
        <p className="eyebrow">FIND SOMETHING THAT FEELS LIKE YOU</p>
        <h2>Start with a piece.<br />Make it your own.</h2>
        <Link className="button button-lime" to="/shop">Shop the collection <span aria-hidden="true">↗</span></Link>
      </section>
      <section className="service-note">
        <p className="eyebrow">A NOTE BEFORE YOU SHOP</p>
        <p>Availability shown is demo catalogue data. Delivery, returns, customer support, live inventory, and payment are not configured.</p>
      </section>
    </main>
  );
}

function NotFound() {
  return <main className="state-page"><p className="eyebrow">FORM & FOUND / 404</p><h1>THIS PAGE<br />ISN&apos;T HERE<span>.</span></h1><p>The page may have moved. Let&apos;s find another way.</p><Link className="button button-lime" to="/">BACK TO HOME ↗</Link></main>;
}

function PageFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { state: catalogState, refresh } = useProductCatalog();

  useEffect(() => {
    const pageName = location.pathname === "/"
      ? "Home"
      : location.pathname.startsWith("/product/")
        ? "Product"
        : location.pathname.slice(1).replaceAll("-", " ");
    document.title = `${pageName.charAt(0).toUpperCase()}${pageName.slice(1)} | ${store.name}`;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) {
      description.content = location.pathname === "/"
        ? `${store.name} — everyday streetwear essentials. Find your own form.`
        : `Explore ${pageName} at ${store.name}. Everyday essentials, uncommon perspective.`;
    }
  }, [location.pathname]);

  return <>
    <Header />
    {catalogState === "error" && (
      <div className="catalog-alert" role="alert">
        The live catalog could not be loaded. <button type="button" onClick={() => void refresh()}>TRY AGAIN</button>
      </div>
    )}
    {children}
    <Footer />
  </>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PageFrame><Home /></PageFrame>} />
      <Route path="/shop" element={<PageFrame><Products /></PageFrame>} />
      <Route path="/new-arrivals" element={<PageFrame><NewArrivals /></PageFrame>} />
      <Route path="/product/:id" element={<PageFrame><ProductDetail /></PageFrame>} />
      <Route path="/cart" element={<PageFrame><Cart /></PageFrame>} />
      <Route path="/checkout" element={<PageFrame><Checkout /></PageFrame>} />
      <Route path="/wishlist" element={<PageFrame><Wishlist /></PageFrame>} />
      <Route path="/search" element={<PageFrame><Search /></PageFrame>} />
      <Route path="/contact" element={<PageFrame><Contact /></PageFrame>} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<PageFrame><NotFound /></PageFrame>} />
    </Routes>
  );
}
