import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCart } from "../CartContext";
import { formatPrice, getVariantStock, isPurchasableVariant } from "../data/products";
import { useProductCatalog } from "../ProductCatalogContext";

export default function Checkout() {
  const { items, subtotal } = useCart();
  const { products } = useProductCatalog();
  const [previewed, setPreviewed] = useState(false);
  const lines = items.flatMap((item) => {
    const product = products.find(({ id }) => id === item.id);
    return product ? [{ item, product }] : [];
  });
  const hasUnavailable = lines.length !== items.length || lines.some(({ item, product }) => {
    if (!isPurchasableVariant(product, item.size, item.color)) return true;
    const stock = getVariantStock(product, item.size, item.color);
    return stock !== undefined && item.quantity > stock;
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreviewed(true);
  }

  if (!items.length) {
    return (
      <main className="page-shell">
        <div className="page-heading">
          <p className="eyebrow">DEMO CHECKOUT</p>
          <h1>YOUR BAG IS EMPTY<span>.</span></h1>
        </div>
        <section className="empty-state">
          <p>Add products to your bag before reviewing checkout.</p>
          <Link className="button button-lime" to="/shop">CONTINUE SHOPPING ↗</Link>
        </section>
      </main>
    );
  }

  if (hasUnavailable) {
    return (
      <main className="page-shell">
        <div className="page-heading">
          <p className="eyebrow">BAG NEEDS ATTENTION</p>
          <h1>CHECK AVAILABILITY<span>.</span></h1>
          <p>Unavailable items must be removed before you can review checkout.</p>
        </div>
        <section className="empty-state">
          <p className="error-note" role="alert">Your bag includes a sold-out or coming-soon product.</p>
          <Link className="button button-lime" to="/cart">RETURN TO YOUR BAG ↗</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell checkout-page">
      <div className="page-heading">
        <p className="eyebrow">DEMO ONLY / NO ORDER WILL BE PLACED</p>
        <h1>CHECKOUT PREVIEW<span>.</span></h1>
        <p>Review contact and delivery details alongside your current bag.</p>
      </div>
      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={handleSubmit}>
          <fieldset>
            <legend>CONTACT DETAILS</legend>
            <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
            <label>Phone number<input name="phone" type="tel" autoComplete="tel" required /></label>
          </fieldset>
          <fieldset>
            <legend>DELIVERY ADDRESS</legend>
            <label>Full name<input name="name" autoComplete="name" required /></label>
            <label>Address<input name="address" autoComplete="street-address" required /></label>
            <div className="form-row">
              <label>City<input name="city" autoComplete="address-level2" required /></label>
              <label>Postal code<input name="postal" autoComplete="postal-code" required /></label>
            </div>
            <label>Country<input name="country" autoComplete="country-name" value="Nepal" readOnly /></label>
          </fieldset>
          <div className="checkout-callout">
            <strong>Payment is not configured.</strong>
            <p>This demo does not collect payment details, submit orders, send emails, or reserve inventory.</p>
          </div>
          <button className="button button-lime" type="submit">REVIEW DEMO DETAILS ↗</button>
          {previewed && (
            <p role="status" className="checkout-status">
              Demo only — no order was placed, no payment was taken, and your bag has not been cleared.
            </p>
          )}
        </form>
        <aside className="order-summary">
          <p className="eyebrow">YOUR ORDER PREVIEW</p>
          {lines.map(({ item, product }) => (
            <div className="summary-row" key={`${item.id}-${item.size}-${item.color}`}>
              <span>{item.quantity} × {product.name} / {item.size} / {item.color}</span>
              <strong>{formatPrice(product.price * item.quantity)}</strong>
            </div>
          ))}
          <div className="summary-row"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
          <div className="summary-row"><span>Delivery charge</span><span>Not configured</span></div>
          <div className="summary-row"><span>Final total</span><span>Not calculated</span></div>
          <p className="form-note">Subtotal is a browser-side preview only. Delivery fees, taxes, stock, and final payable amount require server-side configuration.</p>
          <Link className="text-link" to="/cart">← RETURN TO YOUR BAG</Link>
        </aside>
      </div>
    </main>
  );
}
