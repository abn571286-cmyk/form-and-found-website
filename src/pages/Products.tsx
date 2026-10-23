import { useSearchParams } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import { useProductCatalog } from "../ProductCatalogContext";
import { sortNewestFirst } from "../data/products";

type SortOption = "featured" | "newest" | "price-asc" | "price-desc";

function categoryName(category: string) {
  return category.split("/")[0].trim();
}

export default function Products() {
  const { products, state } = useProductCatalog();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";
  const size = searchParams.get("size") ?? "";
  const color = searchParams.get("color") ?? "";
  const requestedSort = searchParams.get("sort");
  const sort: SortOption = requestedSort === "newest" || requestedSort === "price-asc" || requestedSort === "price-desc"
    ? requestedSort
    : "featured";
  const inStockOnly = searchParams.get("availability") === "in-stock";
  const compact = searchParams.get("density") === "compact";

  const categories = [...new Set(products.map((product) => categoryName(product.category)))];
  const sizes = [...new Set(products.flatMap((product) => product.sizes))];
  const colors = [...new Set(products.flatMap((product) => product.colors))];
  const normalizedQuery = query.trim().toLowerCase();

  const filteredProducts = products.filter((product) => {
    const matchesQuery = !normalizedQuery || [
      product.name,
      product.description,
      product.category,
      ...product.colors,
    ].join(" ").toLowerCase().includes(normalizedQuery);

    return matchesQuery &&
      (!category || categoryName(product.category) === category) &&
      (!size || product.sizes.includes(size)) &&
      (!color || product.colors.includes(color)) &&
      (!inStockOnly || product.status === "In stock" || product.status === "Low stock");
  });

  const sortedProducts = sort === "newest"
    ? sortNewestFirst(filteredProducts)
    : [...filteredProducts].sort((first, second) => {
    if (sort === "price-asc") return first.price - second.price;
    if (sort === "price-desc") return second.price - first.price;
    return Number(Boolean(second.featured)) - Number(Boolean(first.featured));
  });

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setSearchParams({}, { replace: true });
  }

  return (
    <main className="page-shell catalogue">
      <header className="page-heading">
        <p className="eyebrow">FORM & FOUND / THE CURRENT LINEUP</p>
        <h1>The Collection<span>.</span></h1>
        <p>Everyday essentials. Uncommon perspective.</p>
      </header>

      <div className="catalogue-toolbar">
        <span>{sortedProducts.length} {sortedProducts.length === 1 ? "PRODUCT" : "PRODUCTS"}</span>
        <button className="inline-button" type="button" onClick={clearFilters}>CLEAR FILTERS</button>
      </div>

      <section className="catalogue-controls" aria-label="Product filters and sorting">
        <div className="filter-fields">
          <label>
            SEARCH
            <input
              type="search"
              value={query}
              onChange={(event) => updateFilter("q", event.target.value)}
              placeholder="Name or description"
            />
          </label>
          <label>
            CATEGORY
            <select value={category} onChange={(event) => updateFilter("category", event.target.value)}>
              <option value="">All categories</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {sizes.length > 0 && (
            <label>
              SIZE
              <select value={size} onChange={(event) => updateFilter("size", event.target.value)}>
                <option value="">All sizes</option>
                {sizes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          )}
          {colors.length > 0 && (
            <label>
              COLOUR
              <select value={color} onChange={(event) => updateFilter("color", event.target.value)}>
                <option value="">All colours</option>
                {colors.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          )}
          <label className="filter-check">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(event) => updateFilter("availability", event.target.checked ? "in-stock" : "")}
            />
            AVAILABLE
          </label>
        </div>
        <div className="filter-fields catalogue-sort-controls">
          <label>
            SORT BY
            <select value={sort} onChange={(event) => updateFilter("sort", event.target.value)}>
              <option value="featured">Featured</option>
              <option value="newest">New arrivals</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
            </select>
          </label>
          <label>
            GRID
            <select
              value={compact ? "compact" : "standard"}
              onChange={(event) => updateFilter("density", event.target.value === "compact" ? "compact" : "")}
            >
              <option value="standard">Standard</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
      </section>

      {state === "loading" ? (
        <p className="catalog-loading" role="status">Loading the current collection…</p>
      ) : sortedProducts.length ? (
        <div className={`catalogue-grid${compact ? " is-compact" : ""}`}>
          {sortedProducts.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      ) : (
        <section className="empty-state">
          <p className="eyebrow">NO MATCHES IN THE CURRENT LINEUP</p>
          <h2>Nothing found this time.</h2>
          <p>Adjust your search or filters to see more pieces.</p>
          <button className="button button-lime" type="button" onClick={clearFilters}>CLEAR FILTERS ↗</button>
        </section>
      )}
    </main>
  );
}
