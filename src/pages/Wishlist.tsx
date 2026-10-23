import { Link } from "react-router-dom";
import ProductCard from "../components/ProductCard";
import { useWishlist } from "../WishlistContext";
import { useProductCatalog } from "../ProductCatalogContext";

export default function Wishlist() {
  const { ids } = useWishlist();
  const { products } = useProductCatalog();
  const savedProducts = products.filter((product) => ids.includes(product.id));
  return (
    <main className="page-shell">
      <div className="page-heading"><p className="eyebrow">SAVED IN THIS BROWSER</p><h1>YOUR WISHLIST<span>.</span></h1><p>Wishlist items are stored locally on this device for this demo.</p></div>
      {savedProducts.length ? <div className="product-grid">{savedProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div> :
        <section className="empty-state"><p className="eyebrow">NOTHING SAVED YET</p><h2>Keep the pieces you like close.</h2><p>Tap the heart on a product to save it to this browser.</p><Link className="button button-lime" to="/shop">EXPLORE THE COLLECTION ↗</Link></section>}
    </main>
  );
}
