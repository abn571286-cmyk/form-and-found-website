import { Link } from "react-router-dom";
import type { Product } from "../data/products";
import { formatPrice } from "../data/products";
import { useWishlist } from "../WishlistContext";
import { scrollToTop } from "../lib/scroll-to-top";

export default function ProductCard({ product }: { product: Product }) {
  const { has, toggle } = useWishlist();

  return (
    <article className="product-card">
      <div className="product-card-image">
        <Link to={`/product/${product.slug}`} aria-label={`View ${product.name}`} onClick={scrollToTop}>
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            width="800"
            height="1000"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = "/product-placeholder.svg";
            }}
          />
        </Link>
        <span className={`product-status status-${product.status.toLowerCase().replaceAll(" ", "-")}`} aria-label={`Availability: ${product.status}`}>{product.status}</span>
        <button
          className={`wishlist-toggle${has(product.id) ? " is-saved" : ""}`}
          type="button"
          onClick={() => toggle(product.id)}
          aria-label={has(product.id) ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          aria-pressed={has(product.id)}
        >{has(product.id) ? "♥" : "♡"}</button>
      </div>
      <p className="product-category">{product.category.split("/")[0].trim()}</p>
      <div className="product-card-info">
        <h3><Link to={`/product/${product.slug}`} onClick={scrollToTop}>{product.name}</Link></h3>
        <p>
          {formatPrice(product.price)}
          {product.compareAtPrice !== undefined && <> <del className="compare-at-price">{formatPrice(product.compareAtPrice)}</del></>}
        </p>
      </div>
      <div className="product-card-meta">
        <Link className="product-details-link" to={`/product/${product.slug}`} onClick={scrollToTop}>View details <span aria-hidden="true">↗</span></Link>
      </div>
      {product.colors.length > 0 && <div className="product-swatches" role="img" aria-label={`Available colours: ${product.colors.join(", ")}`}>
        {product.colors.map((color) => <span key={color} title={color} className={`swatch swatch-${color.toLowerCase().replaceAll(" ", "-")}`} />)}
      </div>}
    </article>
  );
}
