import { Link } from "react-router-dom";
import { getVariantStock, isPurchasableVariant, formatPrice } from "../data/products";
import { useCart } from "../CartContext";
import { useProductCatalog } from "../ProductCatalogContext";

export default function Cart() {
  const { products } = useProductCatalog();
  const { items, itemCount, subtotal, updateQuantity, removeFromCart, clearCart } = useCart();
  const hasUnavailable = items.some((item) => {
    const product = products.find(({ id }) => id === item.id);
    if (!product || !isPurchasableVariant(product, item.size, item.color)) return true;
    const stock = getVariantStock(product, item.size, item.color);
    return stock !== undefined && item.quantity > stock;
  });

  return (
    <main className="page-shell cart-page">
      <div className="page-heading"><p className="eyebrow">FORM & FOUND / YOUR SELECTION</p><h1>YOUR BAG<span>.</span></h1></div>
      {!items.length ? (
        <section className="empty-state"><p className="eyebrow">NOTHING HERE YET</p><h2>Your bag is waiting.</h2><p>Explore the current collection and find your form.</p><Link className="button button-lime" to="/shop">CONTINUE SHOPPING ↗</Link></section>
      ) : (
        <div className="cart-layout">
          <section className="cart-items" aria-label="Shopping bag items">
            <div className="cart-tools"><span>{itemCount} {itemCount === 1 ? "ITEM" : "ITEMS"}</span><button className="inline-button" type="button" onClick={() => { if (window.confirm("Clear all items from your bag?")) clearCart(); }}>CLEAR BAG</button></div>
            {items.map((item) => {
              const product = products.find(({ id }) => id === item.id);
              if (!product) {
                return <article className="cart-row cart-row-unavailable" key={`${item.id}-${item.size}-${item.color}`}><div className="cart-item-copy"><p className="error-note">This product is no longer available in the current catalogue.</p><p>Size: {item.size} / Colour: {item.color}</p><button className="inline-button remove-button" type="button" onClick={() => removeFromCart(item.id, item.size, item.color)}>REMOVE FROM BAG</button></div><p className="cart-line-price">Price unavailable</p></article>;
              }
              const variantStock = getVariantStock(product, item.size, item.color);
              const unavailable = !isPurchasableVariant(product, item.size, item.color) ||
                (variantStock !== undefined && item.quantity > variantStock);
              return (
                <article className="cart-row" key={`${item.id}-${item.size}-${item.color}`}>
                  <Link className="cart-image" to={`/product/${product.slug}`}><img src={product.image} alt={product.name} width="160" height="200" onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = "/product-placeholder.svg";
                  }} /></Link>
                  <div className="cart-item-copy">
                    <p className="eyebrow">{product.category.split("/")[0].trim()}</p>
                    <h2><Link to={`/product/${product.slug}`}>{product.name}</Link></h2>
                    <p>Size: {item.size} <span aria-hidden="true">/</span> Colour: {item.color}</p>
                    <p className={unavailable ? "unavailable-text" : "available-text"}>
                      {unavailable
                        ? variantStock === 0
                          ? "This size and colour are sold out"
                          : variantStock !== undefined && item.quantity > variantStock
                            ? `Only ${variantStock} available for this variant`
                            : `${product.status} — not purchasable`
                        : product.status}
                    </p>
                    <div className="quantity-control">
                      <label htmlFor={`quantity-${item.id}-${item.size}-${item.color}`}>Quantity</label>
                      <input id={`quantity-${item.id}-${item.size}-${item.color}`} type="number" min="1" max={variantStock ?? 99} value={item.quantity} disabled={variantStock === 0 || product.status === "Sold out" || product.status === "Coming soon"} onChange={(event) => updateQuantity(item.id, item.size, item.color, Number(event.target.value))} />
                    </div>
                    <button className="inline-button remove-button" type="button" onClick={() => removeFromCart(item.id, item.size, item.color)}>REMOVE</button>
                  </div>
                  <p className="cart-line-price">{formatPrice(product.price * item.quantity)}</p>
                </article>
              );
            })}
          </section>
          <aside className="order-summary">
            <p className="eyebrow">ORDER SUMMARY</p>
            <div className="summary-row"><span>Subtotal ({itemCount} items)</span><strong>{formatPrice(subtotal)}</strong></div>
            <p className="form-note">Delivery is calculated from the current store settings during checkout.</p>
            {hasUnavailable && <p className="error-note" role="alert">Remove unavailable items before continuing to checkout.</p>}
            <Link className={`button button-lime button-full${hasUnavailable ? " button-disabled" : ""}`} aria-disabled={hasUnavailable} onClick={(event) => { if (hasUnavailable) event.preventDefault(); }} to="/checkout">CONTINUE TO CHECKOUT ↗</Link>
            <Link className="text-link" to="/shop">CONTINUE SHOPPING</Link>
          </aside>
        </div>
      )}
    </main>
  );
}
