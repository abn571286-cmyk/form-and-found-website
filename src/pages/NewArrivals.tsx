import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import { sortNewestFirst } from "../data/products";
import { useProductCatalog } from "../ProductCatalogContext";

export default function NewArrivals() {
  const { products, state } = useProductCatalog();
  const arrivals = sortNewestFirst(products.filter((product) => product.isNewArrival === true));

  return (
    <main className="new-arrivals-page">
      <section className="arrivals-hero">
        <div className="arrivals-hero-image" role="img" aria-label="FORM & FOUND editorial clothing collection" />
        <div className="arrivals-hero-copy">
          <p className="eyebrow">FORM & FOUND / THE LATEST PIECES</p>
          <h1>Just<br /><span>Dropped.</span></h1>
          <p>New additions to the collection, ready to find their place in your everyday.</p>
          <a className="text-link" href="#new-arrivals-grid">Explore the latest <span aria-hidden="true">↓</span></a>
        </div>
        <span className="arrivals-hero-caption">THE EVERYDAY EDIT</span>
      </section>

      <section className="page-shell arrivals-list" id="new-arrivals-grid" aria-labelledby="arrivals-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECENTLY ADDED TO THE LINEUP</p>
            <h2 id="arrivals-heading">New arrivals<span>.</span></h2>
          </div>
          <Link className="text-link" to="/shop">Browse the full collection ↗</Link>
        </div>
        {state === "loading" ? (
          <p className="catalog-loading" role="status">Loading the latest pieces…</p>
        ) : state === "error" ? (
          <p className="catalog-loading" role="alert">The latest pieces could not be loaded right now. Please try again in a little while.</p>
        ) : arrivals.length ? (
          <>
            <p className="arrivals-count">{arrivals.length} {arrivals.length === 1 ? "PIECE" : "PIECES"}</p>
            <div className="catalogue-grid arrivals-product-grid">
              {arrivals.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          </>
        ) : (
          <section className="empty-state arrivals-empty">
            <p className="eyebrow">A QUIET MOMENT BETWEEN DROPS</p>
            <h2>Nothing new just yet.</h2>
            <p>Take a look through the full collection while we prepare what comes next.</p>
            <Link className="button button-lime" to="/shop">Browse the collection ↗</Link>
          </section>
        )}
      </section>
    </main>
  );
}
