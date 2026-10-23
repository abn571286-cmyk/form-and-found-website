import { Link, useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import { useProductCatalog } from "../ProductCatalogContext";
import { searchProducts } from "../lib/search-products";

export default function Search() {
  const { products, state } = useProductCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const value = query;

  function updateQuery(next: string) {
    if (next.trim()) setSearchParams({ q: next }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  const normalized = query.trim().toLowerCase();
  const results = searchProducts(products, query);

  return (
    <main className="page-shell search-page">
      <div className="page-heading"><p className="eyebrow">FIND YOUR FORM</p><h1>SEARCH<span>.</span></h1></div>
      <label className="search-field">
        <span className="visually-hidden">Search products</span>
        <input type="search" autoFocus value={value} onChange={(event) => updateQuery(event.target.value)} placeholder="Try a product, category, or colour" />
        {value && <button type="button" onClick={() => updateQuery("")} aria-label="Clear search">CLEAR ×</button>}
      </label>
      <div className="search-result-heading"><p>{normalized ? `${results.length} ${results.length === 1 ? "RESULT" : "RESULTS"} FOR “${query}”` : "SEARCH THE CURRENT COLLECTION"}</p></div>
      {state === "loading" ? <p className="catalog-loading" role="status">Searching the current collection…</p> :
      normalized && results.length ? <div className="product-grid">{results.map((product) => <ProductCard key={product.id} product={product} />)}</div> :
        normalized ? <section className="empty-state"><h2>No matching pieces.</h2><p>Try another name, category, colour, or <Link to="/shop">browse all products</Link>.</p></section> :
          <section className="empty-state"><h2>What are you looking for?</h2><p>Search product names, descriptions, categories, and available colours.</p><Link className="text-link" to="/shop">BROWSE THE COLLECTION ↗</Link></section>}
    </main>
  );
}
