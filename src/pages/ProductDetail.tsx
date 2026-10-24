import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getVariantStock, isPurchasableVariant, formatPrice } from "../data/products";
import { useCart } from "../CartContext";
import { useWishlist } from "../WishlistContext";
import ProductCard from "../components/ProductCard";
import { useProductCatalog } from "../ProductCatalogContext";

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const { has, toggle } = useWishlist();
  const { products, state } = useProductCatalog();
  const product = products.find((item) => item.id === id || item.slug === id);
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState("");

  if (!product) {
    return state === "loading"
      ? <main className="state-page"><p className="catalog-loading" role="status">Loading product…</p></main>
      : <main className="state-page"><p className="eyebrow">FORM & FOUND / 404</p><h1>PRODUCT<br />NOT FOUND<span>.</span></h1><Link className="button button-lime" to="/shop">BACK TO SHOP ↗</Link></main>;
  }

  const related = products.filter((item) => item.id !== product.id && item.category.split("/")[0] === product.category.split("/")[0]).slice(0, 2);
  const images = [...new Set([product.image, ...(product.images ?? [])].filter(Boolean))];
  const activeImage = images.includes(selectedImage) ? selectedImage : images[0] ?? "/product-placeholder.svg";
  const variantStock = size && color ? getVariantStock(product, size, color) : undefined;
  const unavailable = product.status === "Sold out" || product.status === "Coming soon" || variantStock === 0;
  const canAdd = isPurchasableVariant(product, size, color) &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    quantity <= 99 &&
    (variantStock === undefined || quantity <= variantStock);

  function handleAddToBag() {
    if (!product) return;
    if (!canAdd) {
      setMessage(variantStock !== undefined && quantity > variantStock
        ? `Only ${variantStock} available for this size and colour.`
        : "Select an available size and colour, and choose a valid quantity.");
      return;
    }
    if (addToCart(product.id, size, color, quantity)) setMessage("Added to your bag.");
    else setMessage("This product is currently unavailable. No items were added.");
  }

  return (
    <main className="page-shell detail-page">
      <p className="detail-breadcrumb"><Link to="/">HOME</Link><span>/</span><Link to="/shop">SHOP</Link><span>/</span>{product.name}</p>
      <div className="detail-layout">
        <div className="detail-gallery">
          <div className="detail-image">
            <img
              src={activeImage}
              alt={product.name}
              width="1000"
              height="1250"
              fetchPriority="high"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = "/product-placeholder.svg";
              }}
            />
          </div>
          {images.length > 1 && (
            <div className="detail-thumbnails" role="group" aria-label={`${product.name} product images`}>
              {images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  className={image === activeImage ? "is-selected" : ""}
                  onClick={() => setSelectedImage(image)}
                  aria-label={`View product image ${index + 1}`}
                  aria-pressed={image === activeImage}
                >
                  <img
                    src={image}
                    alt=""
                    width="100"
                    height="125"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = "/product-placeholder.svg";
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        <section className="detail-info">
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}<span>.</span></h1>
          <p className="detail-price">{formatPrice(product.price)}</p>
          {product.compareAtPrice !== undefined && <p className="compare-at-price">Compare at {formatPrice(product.compareAtPrice)}</p>}
          <p className={`detail-status ${unavailable ? "unavailable-text" : "available-text"}`}>{product.status}</p>
          <p className="detail-description">{product.description}</p>
          <fieldset className="selection-group"><legend>SIZE <button type="button" className="inline-button size-guide-trigger" onClick={() => setSizeGuideOpen(true)}>SIZE GUIDE</button></legend>
            <div className="detail-options">{product.sizes.map((item) => <button key={item} type="button" className={size === item ? "selected" : ""} onClick={() => { setSize(item); setMessage(""); }} aria-pressed={size === item}>{item}</button>)}</div>
          </fieldset>
          <fieldset className="selection-group"><legend>COLOUR</legend><div className="detail-options">{product.colors.map((item) => <button key={item} type="button" className={color === item ? "selected" : ""} onClick={() => { setColor(item); setMessage(""); }} aria-pressed={color === item}>{item}</button>)}</div></fieldset>
          <label className="quantity-control detail-quantity" htmlFor="detail-quantity">QUANTITY
            <input id="detail-quantity" type="number" min="1" max={variantStock ?? 99} value={quantity} onChange={(event) => { setQuantity(Number(event.target.value)); setMessage(""); }} />
          </label>
          {variantStock !== undefined && variantStock > 0 && <p className="form-note">{variantStock} available for this selected size and colour.</p>}
          <div className="detail-actions">
            <button type="button" className="button button-lime button-full" disabled={unavailable} onClick={handleAddToBag}>{unavailable ? (variantStock === 0 ? "SOLD OUT" : product.status.toUpperCase()) : "ADD TO BAG ↗"}</button>
            <button className={`wishlist-detail${has(product.id) ? " is-saved" : ""}`} type="button" aria-pressed={has(product.id)} onClick={() => toggle(product.id)}>{has(product.id) ? "♥ SAVED" : "♡ SAVE"}</button>
          </div>
          {message && <p role="status" aria-live="polite" className={message.startsWith("Added") ? "success-note" : "error-note"}>{message}</p>}
          {message.startsWith("Added") && <button type="button" className="text-link view-bag-link" onClick={() => navigate("/cart")}>VIEW YOUR BAG ↗</button>}
          {product.materials && <details className="product-accordion"><summary>MATERIALS</summary><p>{product.materials}</p></details>}
          {product.care && <details className="product-accordion"><summary>CARE</summary><p>{product.care}</p></details>}
          {state === "demo" && <p className="form-note">Development catalogue preview only. Product availability is not live inventory.</p>}
        </section>
      </div>
      {sizeGuideOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSizeGuideOpen(false); }}><section className="size-dialog" role="dialog" aria-modal="true" aria-labelledby="size-guide-title"><button type="button" className="dialog-close" onClick={() => setSizeGuideOpen(false)} aria-label="Close size guide">×</button><p className="eyebrow">FORM & FOUND / SIZING</p><h2 id="size-guide-title">SIZE GUIDE</h2><p>Use the size options shown for this product. Detailed garment measurements have not been configured yet.</p><p>Available: {product.sizes.join(" · ") || "No sizes configured"}</p></section></div>}
      {!!related.length && <section className="section-wrap related-products"><div className="section-heading"><div><p className="eyebrow">KEEP EXPLORING</p><h2>RELATED PIECES<span>.</span></h2></div></div><div className="product-grid">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
    </main>
  );
}
