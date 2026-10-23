import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import type { ProductStatus } from "../data/products";
import { formatPrice } from "../data/products";
import { useProductCatalog } from "../ProductCatalogContext";
import {
  loadAdminProducts,
  saveAdminProduct,
  uploadProductImage,
  loadAdminOrders,
  setAdminOrderStatus,
  type AdminProduct,
  type AdminOrder,
  type AdminOrderItem,
  type AdminVariant,
  type AdminVariantInput,
} from "../lib/admin-products";
import { supabase } from "../lib/supabase";
import "./Admin.css";

type Visibility = "draft" | "published" | "archived";

type EditorValues = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  collection: string;
  price: string;
  compareAtPrice: string;
  image: string;
  gallery: string;
  sizes: string;
  colors: string;
  stockRows: string;
  status: ProductStatus;
  visibility: Visibility;
  sku: string;
  materials: string;
  care: string;
  featured: boolean;
  newArrival: boolean;
};

const blankEditor: EditorValues = {
  name: "",
  slug: "",
  description: "",
  category: "",
  collection: "",
  price: "",
  compareAtPrice: "",
  image: "",
  gallery: "",
  sizes: "",
  colors: "",
  stockRows: "",
  status: "Coming soon",
  visibility: "draft",
  sku: "",
  materials: "",
  care: "",
  featured: false,
  newArrival: false,
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function splitList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function editorFromProduct(product: AdminProduct, variants: AdminVariant[]): EditorValues {
  const productVariants = variants.filter((variant) => variant.product_id === product.id);
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    category: product.category,
    collection: product.collection ?? "",
    price: String(product.price_npr),
    compareAtPrice: product.compare_at_price_npr === null ? "" : String(product.compare_at_price_npr),
    image: product.image_url,
    gallery: Array.isArray(product.gallery) ? product.gallery.filter((image): image is string => typeof image === "string").join("\n") : "",
    sizes: [...new Set(productVariants.map(({ size }) => size))].join(", "),
    colors: [...new Set(productVariants.map(({ color }) => color))].join(", "),
    stockRows: productVariants.map((variant) => `${variant.size} | ${variant.color} | ${variant.stock} | ${variant.sku ?? ""}`).join("\n"),
    status: product.status,
    visibility: product.publication_status,
    sku: product.sku ?? "",
    materials: product.materials ?? "",
    care: product.care ?? "",
    featured: product.featured,
    newArrival: product.is_new_arrival,
  };
}

function variantsFromEditor(form: EditorValues): AdminVariantInput[] {
  const sizes = splitList(form.sizes);
  const colors = splitList(form.colors);
  const entries = form.stockRows.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = entries.map((line, index) => {
    const [rawSize = "", rawColor = "", rawStock = "", rawSku = ""] = line.split("|").map((part) => part.trim());
    const size = rawSize;
    const color = rawColor;
    const stock = Number(rawStock);
    if (!sizes.includes(size) || !colors.includes(color) || !Number.isInteger(stock) || stock < 0) {
      throw new Error(`Variant line ${index + 1}: use a configured size, colour, and non-negative whole-number stock.`);
    }
    return { size, color, stock, sku: rawSku || null };
  });

  const variantKeys = variants.map(({ size, color }) => `${size}|${color}`);
  if (new Set(variantKeys).size !== variantKeys.length) {
    throw new Error("Each size and colour combination can only be listed once.");
  }
  if (!sizes.length || !colors.length || !variants.length) {
    throw new Error("Add at least one size, one colour, and one stock row.");
  }
  return variants;
}

export default function Admin() {
  const { refresh: refreshStorefront } = useProductCatalog();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [authorized, setAuthorized] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [variants, setVariants] = useState<AdminVariant[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [orderItems, setOrderItems] = useState<AdminOrderItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [section, setSection] = useState<"products" | "inventory" | "orders">("products");
  const [query, setQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | Visibility>("all");
  const [editor, setEditor] = useState<EditorValues | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [imagePreview, setImagePreview] = useState("");

  useEffect(() => {
    document.title = `Store admin | FORM & FOUND`;
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthorized(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;
    let active = true;
    void (async () => {
      const { data: isAdmin, error: roleError } = await supabase.rpc("is_store_admin");
      if (roleError) throw roleError;
      if (!isAdmin) throw new Error("This account does not have store administrator access.");
      const [result, orderResult] = await Promise.all([loadAdminProducts(), loadAdminOrders()]);
      if (!active) return;
      setAuthorized(true);
      setProducts(result.products);
      setVariants(result.variants);
      setOrders(orderResult.orders);
      setOrderItems(orderResult.items);
    })().catch(async (cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Unable to verify administrator access.");
      if (supabase) await supabase.auth.signOut();
      setSession(null);
    });
    return () => {
      active = false;
    };
  }, [session]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesQuery = `${product.name} ${product.slug} ${product.sku ?? ""} ${product.category}`
      .toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (visibilityFilter === "all" || product.publication_status === visibilityFilter);
  }), [products, query, visibilityFilter]);

  const totalUnits = variants.reduce((total, variant) => total + variant.stock, 0);
  const liveCount = products.filter((product) => product.publication_status === "published").length;
  const draftCount = products.filter((product) => product.publication_status === "draft").length;

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) setError(loginError.message);
    setBusy(false);
  }

  async function reloadProducts() {
    const result = await loadAdminProducts();
    setProducts(result.products);
    setVariants(result.variants);
  }

  async function reloadOrders() {
    const result = await loadAdminOrders();
    setOrders(result.orders);
    setOrderItems(result.items);
  }

  function openNewProduct() {
    setMessage("");
    setError("");
    setImagePreview("");
    setEditor({ ...blankEditor });
  }

  function openEdit(product: AdminProduct) {
    setMessage("");
    setError("");
    setImagePreview(product.image_url);
    setEditor(editorFromProduct(product, variants));
  }

  function updateEditor<K extends keyof EditorValues>(key: K, value: EditorValues[K]) {
    setEditor((current) => current ? { ...current, [key]: value } : current);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const slug = slugify(editor.slug || editor.name);
      const existingSlug = products.find((product) => product.slug === slug && product.id !== editor.id);
      if (existingSlug) throw new Error(`The slug "${slug}" is already used by ${existingSlug.name}.`);
      const price = Number(editor.price);
      const compareAtPrice = editor.compareAtPrice ? Number(editor.compareAtPrice) : null;
      if (!Number.isSafeInteger(price) || price <= 0 || price > 1_000_000) throw new Error("Enter a whole-number price in NPR from 1 to 1,000,000.");
      if (compareAtPrice !== null && (!Number.isSafeInteger(compareAtPrice) || compareAtPrice <= price)) {
        throw new Error("Compare-at price must be a whole-number NPR amount higher than the selling price.");
      }
      const productVariants = variantsFromEditor(editor);
      const totalStock = productVariants.reduce((total, variant) => total + variant.stock, 0);
      if ((editor.status === "In stock" || editor.status === "Low stock") && totalStock < 1) {
        throw new Error("In-stock products require at least one recorded unit in their variants.");
      }
      if ((editor.status === "Sold out" || editor.status === "Coming soon") && totalStock !== 0) {
        throw new Error("Sold-out and coming-soon products must have zero stock across all variants.");
      }
      const gallery = editor.gallery.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
      const savedId = await saveAdminProduct({
        ...(editor.id ? { id: editor.id } : {}),
        slug,
        name: editor.name.trim(),
        description: editor.description.trim(),
        category: editor.category.trim(),
        collection: editor.collection.trim() || null,
        price_npr: price,
        compare_at_price_npr: compareAtPrice,
        image_url: editor.image.trim(),
        gallery,
        status: editor.status,
        publication_status: editor.visibility,
        sku: editor.sku.trim() || null,
        materials: editor.materials.trim() || null,
        care: editor.care.trim() || null,
        featured: editor.featured,
        is_new_arrival: editor.newArrival,
      }, productVariants);
      await reloadProducts();
      await refreshStorefront();
      setEditor(null);
      setMessage(`Product saved (${String(savedId).slice(0, 8)}).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this product.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImage(file: File | undefined) {
    if (!file || !editor) return;
    setBusy(true);
    setError("");
    try {
      const uploadedUrl = await uploadProductImage(file);
      updateEditor("image", uploadedUrl);
      setImagePreview(uploadedUrl);
      setMessage("Image uploaded. Save the product to keep this change.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeVisibility(product: AdminProduct, nextVisibility: Visibility) {
    const productVariants = variants.filter((variant) => variant.product_id === product.id);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await saveAdminProduct({
        ...product,
        gallery: Array.isArray(product.gallery) ? product.gallery.filter((image): image is string => typeof image === "string") : [],
        publication_status: nextVisibility,
      }, productVariants.map(({ size, color, sku, stock }) => ({ size, color, sku, stock })));
      await reloadProducts();
      await refreshStorefront();
      setMessage(nextVisibility === "archived" ? "Product archived." : `Product ${nextVisibility}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to change product status.");
    } finally {
      setBusy(false);
    }
  }

  async function changeOrderStatus(order: AdminOrder, status: AdminOrder["order_status"]) {
    if (status === "cancelled" && !window.confirm(`Cancel order ${order.order_number}? Reserved stock will be restored if the order is unpaid.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await setAdminOrderStatus(order.id, status);
      await reloadOrders();
      setMessage(`Order ${order.order_number} updated to ${status}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the order.");
    } finally {
      setBusy(false);
    }
  }

  function openDuplicate(product: AdminProduct) {
    const duplicate = editorFromProduct(product, variants);
    duplicate.id = undefined;
    duplicate.name = `${product.name} COPY`;
    const baseSlug = `${product.slug}-copy`;
    let uniqueSlug = baseSlug;
    let suffix = 2;
    while (products.some((item) => item.slug === uniqueSlug)) {
      uniqueSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    duplicate.slug = uniqueSlug;
    duplicate.visibility = "draft";
    duplicate.featured = false;
    setImagePreview(duplicate.image);
    setEditor(duplicate);
    setMessage("A draft copy is ready. Choose a unique product name and slug before saving.");
    setError("");
  }

  async function handleLogout() {
    if (!supabase) return;
    const { error: logoutError } = await supabase.auth.signOut();
    if (logoutError) setError(logoutError.message);
    else setAuthorized(false);
  }

  if (!supabase) {
    return (
      <main className="admin-page">
        <header className="admin-topbar"><Link to="/" className="wordmark">FORM & FOUND<span className="wordmark-period">.</span></Link><span>STORE ADMIN</span></header>
        <section className="admin-setup">
          <p className="eyebrow">BACKEND CONFIGURATION REQUIRED</p>
          <h1>YOUR STORE.<br />YOUR CONTROL.</h1>
          <p>The dashboard is connected to real Supabase Auth, database policies, and image storage when configured. No administrator login or product changes are simulated in this demo.</p>
          <ol>
            <li>Create a Supabase project and add the public project URL and anon key to <code>.env.local</code>.</li>
            <li>Apply the SQL migration in <code>supabase/migrations</code>.</li>
            <li>Create an Auth user and grant its user ID administrator access from the Supabase SQL editor.</li>
          </ol>
          <Link className="button button-outline" to="/">RETURN TO STOREFRONT ↗</Link>
        </section>
      </main>
    );
  }

  if (authLoading || (session && !authorized && !error)) {
    return <main className="admin-page"><p className="admin-loading" role="status">Verifying secure administrator access…</p></main>;
  }

  if (!session || !authorized) {
    return (
      <main className="admin-page">
        <header className="admin-topbar"><Link to="/" className="wordmark">FORM & FOUND<span className="wordmark-period">.</span></Link><span>SECURE STORE ADMIN</span></header>
        <section className="admin-login">
          <p className="eyebrow">FORM & FOUND / ADMIN</p>
          <h1>OWNER<br />SIGN IN<span>.</span></h1>
          <p>Sign in with an administrator account authorized in the Supabase database.</p>
          <form className="admin-form" onSubmit={handleLogin}>
            <label>Email address<input autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button className="button button-lime" type="submit" disabled={busy}>{busy ? "SIGNING IN…" : "SIGN IN ↗"}</button>
          </form>
          <Link className="admin-back" to="/">← BACK TO STOREFRONT</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <Link to="/" className="wordmark">FORM & FOUND<span className="wordmark-period">.</span></Link>
        <span>PRODUCT MANAGEMENT</span>
        <div className="admin-top-actions"><Link to="/">VIEW STOREFRONT ↗</Link><button type="button" onClick={handleLogout}>SIGN OUT</button></div>
      </header>
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <p className="eyebrow">OWNER WORKSPACE</p>
          <p className="admin-sidebar-title">COLLECTION<br />CONTROL<span>.</span></p>
          <button type="button" className={`admin-nav-item${section === "products" ? " is-current" : ""}`} onClick={() => setSection("products")}>Products <span>{products.length}</span></button>
          <button type="button" className={`admin-nav-item${section === "inventory" ? " is-current" : ""}`} onClick={() => setSection("inventory")}>Inventory <span>{totalUnits} units</span></button>
          <button type="button" className={`admin-nav-item${section === "orders" ? " is-current" : ""}`} onClick={() => setSection("orders")}>Orders <span>{orders.length}</span></button>
          <p className="admin-sidebar-note">Orders and payments stay disabled in the storefront until their server-side flow and provider setup are completed.</p>
        </aside>

        <section className="admin-content">
          {section === "products" ? <>
          <div className="admin-heading">
            <div><p className="eyebrow">YOUR CATALOGUE / LIVE DATA</p><h1>PRODUCTS<span>.</span></h1><p>Manage product details, variants, visibility, and verified stock.</p></div>
            <button className="button button-lime" type="button" onClick={openNewProduct}>ADD A PRODUCT <span>＋</span></button>
          </div>

          <div className="admin-stat-grid">
            <div><span>ALL PRODUCTS</span><strong>{products.length}</strong></div>
            <div><span>PUBLISHED</span><strong>{liveCount}</strong></div>
            <div><span>DRAFTS</span><strong>{draftCount}</strong></div>
            <div><span>RECORDED UNITS</span><strong>{totalUnits}</strong></div>
          </div>

          {(message || error) && <p className={error ? "admin-error admin-banner" : "admin-success admin-banner"} role={error ? "alert" : "status"}>{error || message}</p>}

          <div className="admin-toolbar">
            <label className="admin-search">SEARCH CATALOGUE<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, SKU, slug…" /></label>
            <label>VISIBILITY<select value={visibilityFilter} onChange={(event) => setVisibilityFilter(event.target.value as "all" | Visibility)}><option value="all">All products</option><option value="published">Published</option><option value="draft">Drafts</option><option value="archived">Archived</option></select></label>
          </div>

          <div className="admin-product-list">
            {filteredProducts.length === 0
              ? <div className="admin-empty"><h2>No products found.</h2><p>Add your first product or change the search and filters.</p><button className="button button-outline" type="button" onClick={openNewProduct}>CREATE PRODUCT ↗</button></div>
              : filteredProducts.map((product) => {
                const productVariants = variants.filter((variant) => variant.product_id === product.id);
                const stockCount = productVariants.reduce((total, variant) => total + variant.stock, 0);
                return (
                  <article className="admin-product-row" key={product.id}>
                    <img src={product.image_url} alt="" width="88" height="108" />
                    <div className="admin-product-main">
                      <span className={`admin-status status-${product.publication_status}`}>{product.publication_status}</span>
                      <h2>{product.name}</h2>
                      <p>{product.category}{product.collection ? ` / ${product.collection}` : ""} · SKU {product.sku ?? "—"}</p>
                      <span>{product.price_npr.toLocaleString("en-NP")} NPR · {productVariants.length} variants · {stockCount} units</span>
                    </div>
                    <div className="admin-row-actions">
                      <button type="button" onClick={() => openEdit(product)}>EDIT</button>
                      <button type="button" onClick={() => openDuplicate(product)}>DUPLICATE</button>
                      {product.publication_status === "published"
                        ? <button type="button" disabled={busy} onClick={() => void changeVisibility(product, "draft")}>UNPUBLISH</button>
                        : product.publication_status === "archived"
                          ? <button type="button" disabled={busy} onClick={() => void changeVisibility(product, "draft")}>RESTORE AS DRAFT</button>
                          : <button type="button" disabled={busy} onClick={() => void changeVisibility(product, "published")}>PUBLISH</button>}
                      {product.publication_status !== "archived" && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Archive ${product.name}? It will no longer appear in the storefront.`)) void changeVisibility(product, "archived"); }}>ARCHIVE</button>}
                    </div>
                  </article>
                );
              })}
          </div>
          </> : section === "inventory" ? <>
            <div className="admin-heading"><div><p className="eyebrow">VARIANT STOCK / DATABASE VALUES</p><h1>INVENTORY<span>.</span></h1><p>Stock totals are based on explicitly recorded variant quantities.</p></div><button className="button button-outline" type="button" onClick={() => setSection("products")}>MANAGE PRODUCTS</button></div>
            <div className="admin-stat-grid"><div><span>TRACKED VARIANTS</span><strong>{variants.length}</strong></div><div><span>RECORDED UNITS</span><strong>{totalUnits}</strong></div><div><span>OUT OF STOCK</span><strong>{variants.filter(({ stock }) => stock === 0).length}</strong></div><div><span>LOW QUANTITY (≤ 3)</span><strong>{variants.filter(({ stock }) => stock > 0 && stock <= 3).length}</strong></div></div>
            <div className="admin-inventory-list">
              {variants.map((variant) => {
                const product = products.find(({ id }) => id === variant.product_id);
                return <div className="admin-inventory-row" key={variant.id}><span>{product?.name ?? "Archived product"}</span><span>{variant.size} / {variant.color}</span><span>{variant.sku ?? "No variant SKU"}</span><strong className={variant.stock === 0 ? "inventory-empty" : ""}>{variant.stock}</strong><button type="button" onClick={() => { if (product) openEdit(product); setSection("products"); }}>EDIT PRODUCT</button></div>;
              })}
              {variants.length === 0 && <div className="admin-empty"><h2>No variant stock recorded.</h2><p>Add a product with verified sizes, colours, and stock quantities to start an inventory overview.</p><button className="button button-lime" type="button" onClick={openNewProduct}>ADD A PRODUCT ↗</button></div>}
            </div>
          </> : <>
            <div className="admin-heading"><div><p className="eyebrow">ORDER OPERATIONS / SERVER DATA</p><h1>ORDERS<span>.</span></h1><p>Payment status is separate. Only verified provider callbacks may mark an order paid.</p></div></div>
            <div className="admin-orders-list">
              {orders.map((order) => (
                <article className="admin-order-row" key={order.id}>
                  <button className="admin-order-open" type="button" onClick={() => setSelectedOrderId(order.id)}><span>{order.order_number}</span><span>{new Date(order.created_at).toLocaleString()}</span><span>{order.customer_email}</span><strong>{formatPrice(order.total_npr)}</strong></button>
                  <span className={`admin-status status-${order.order_status}`}>{order.order_status}</span>
                  <span className={`admin-status payment-${order.payment_status}`}>PAYMENT: {order.payment_status}</span>
                  <label>ORDER STATUS<select aria-label={`Order status for ${order.order_number}`} disabled={busy} value={order.order_status} onChange={(event) => void changeOrderStatus(order, event.target.value as AdminOrder["order_status"])}>{["pending", "processing", "shipped", "delivered", "cancelled"].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                </article>
              ))}
              {orders.length === 0 && <div className="admin-empty"><h2>No orders yet.</h2><p>Orders are only created by the authenticated, server-validated order procedure after delivery fees are configured.</p></div>}
            </div>
          </>}
        </section>
      </div>

      {editor && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditor(null); }}>
          <section className="admin-editor" role="dialog" aria-modal="true" aria-labelledby="admin-editor-title">
            <header className="admin-editor-header">
              <div><p className="eyebrow">{editor.id ? "EDIT PRODUCT" : "NEW CATALOGUE ENTRY"}</p><h2 id="admin-editor-title">{editor.id ? editor.name : "ADD A PRODUCT"}</h2></div>
              <button type="button" className="dialog-close" aria-label="Close product editor" disabled={busy} onClick={() => setEditor(null)}>×</button>
            </header>
            <form className="admin-editor-form" onSubmit={handleSave}>
              <fieldset><legend>PRODUCT DETAILS</legend>
                <label>Product name<input required value={editor.name} onChange={(event) => {
                  const name = event.target.value;
                  setEditor((current) => current ? { ...current, name, slug: current.id ? current.slug : slugify(name) } : current);
                }} /></label>
                <label>URL slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={editor.slug} onChange={(event) => updateEditor("slug", slugify(event.target.value))} /><small>Generated from the product name; must be unique.</small></label>
                <label>Description<textarea required rows={3} value={editor.description} onChange={(event) => updateEditor("description", event.target.value)} /></label>
                <div className="admin-form-grid">
                  <label>Category<input required value={editor.category} onChange={(event) => updateEditor("category", event.target.value)} placeholder="e.g. TOPS" /></label>
                  <label>Collection<input value={editor.collection} onChange={(event) => updateEditor("collection", event.target.value)} placeholder="Optional" /></label>
                  <label>Selling price (NPR)<input type="number" min="1" max="1000000" step="1" required value={editor.price} onChange={(event) => updateEditor("price", event.target.value)} /></label>
                  <label>Compare-at price (optional)<input type="number" min="1" step="1" value={editor.compareAtPrice} onChange={(event) => updateEditor("compareAtPrice", event.target.value)} /></label>
                  <label>SKU<input value={editor.sku} onChange={(event) => updateEditor("sku", event.target.value)} /></label>
                  <label>Availability<select value={editor.status} onChange={(event) => updateEditor("status", event.target.value as ProductStatus)}><option>In stock</option><option>Low stock</option><option>Sold out</option><option>Coming soon</option></select></label>
                  <label>Publication<select value={editor.visibility} onChange={(event) => updateEditor("visibility", event.target.value as Visibility)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
                </div>
              </fieldset>

              <fieldset><legend>PRODUCT PHOTOGRAPHY</legend>
                <label>Primary image URL<input required type="url" value={editor.image} onChange={(event) => { updateEditor("image", event.target.value); setImagePreview(event.target.value); }} placeholder="Upload a photo or paste an image URL" /></label>
                <label className="admin-upload">Upload image<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={(event) => void handleImage(event.target.files?.[0])} /><small>JPG, PNG, WebP, or AVIF · max 8 MB.</small></label>
                {imagePreview && <img className="admin-image-preview" src={imagePreview} alt={`Preview of ${editor.name || "product image"}`} />}
                <label>Gallery image URLs<textarea rows={3} value={editor.gallery} onChange={(event) => updateEditor("gallery", event.target.value)} placeholder="One image URL per line (optional)" /></label>
              </fieldset>

              <fieldset><legend>SIZES, COLOURS & INVENTORY</legend>
                <div className="admin-form-grid">
                  <label>Sizes<input required value={editor.sizes} onChange={(event) => updateEditor("sizes", event.target.value)} placeholder="S, M, L, XL" /></label>
                  <label>Colours<input required value={editor.colors} onChange={(event) => updateEditor("colors", event.target.value)} placeholder="Black, White" /></label>
                </div>
                <label>Variant inventory<textarea required rows={5} value={editor.stockRows} onChange={(event) => updateEditor("stockRows", event.target.value)} placeholder={"S | Black | 0 | SKU-S-BLK\nM | Black | 0 | SKU-M-BLK"} /><small>One variant per line: <code>Size | Colour | stock quantity | optional variant SKU</code>. Use only verified stock quantities.</small></label>
              </fieldset>

              <fieldset><legend>OPTIONAL PRODUCT INFORMATION</legend>
                <label>Materials<textarea rows={2} value={editor.materials} onChange={(event) => updateEditor("materials", event.target.value)} /></label>
                <label>Care instructions<textarea rows={2} value={editor.care} onChange={(event) => updateEditor("care", event.target.value)} /></label>
                <div className="admin-toggles">
                  <label><input type="checkbox" checked={editor.featured} onChange={(event) => updateEditor("featured", event.target.checked)} /> Featured on storefront</label>
                  <label><input type="checkbox" checked={editor.newArrival} onChange={(event) => updateEditor("newArrival", event.target.checked)} /> Mark as new arrival</label>
                </div>
              </fieldset>
              {error && <p className="admin-error" role="alert">{error}</p>}
              {message && <p className="admin-success" role="status">{message}</p>}
              <div className="admin-editor-actions">
                <button className="button button-outline" type="button" disabled={busy} onClick={() => setEditor(null)}>CANCEL</button>
                <button className="button button-lime" type="submit" disabled={busy}>{busy ? "SAVING…" : editor.visibility === "published" ? "SAVE & PUBLISH ↗" : "SAVE PRODUCT ↗"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {selectedOrderId && (() => {
        const order = orders.find(({ id }) => id === selectedOrderId);
        if (!order) return null;
        const address = typeof order.shipping_address === "object" && order.shipping_address !== null && !Array.isArray(order.shipping_address)
          ? Object.entries(order.shipping_address).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")
          : "Address details unavailable";
        return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrderId(null); }}><section className="admin-order-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-order-title"><header className="admin-editor-header"><div><p className="eyebrow">ORDER DETAIL / {order.order_number}</p><h2 id="admin-order-title">{order.customer_email}</h2></div><button type="button" className="dialog-close" aria-label="Close order details" onClick={() => setSelectedOrderId(null)}>×</button></header><p><strong>Contact</strong><br /><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a></p><p><strong>Delivery address</strong><br />{address}</p><div className="admin-order-detail-lines">{orderItems.filter((item) => item.order_id === order.id).map((item) => <div className="summary-row" key={item.id}><span>{item.product_name} / {item.variant_label} × {item.quantity}</span><strong>{formatPrice(item.line_total_npr)}</strong></div>)}</div><div className="summary-row"><span>Subtotal</span><strong>{formatPrice(order.subtotal_npr)}</strong></div><div className="summary-row"><span>Delivery</span><strong>{formatPrice(order.delivery_fee_npr)}</strong></div><div className="summary-row"><span>Order status</span><strong>{order.order_status}</strong></div><div className="summary-row"><span>Payment status</span><strong>{order.payment_status}</strong></div><p className="form-note">Customer data is private. Refunds and payment status updates require a verified provider integration; this dashboard cannot manually mark an order paid.</p></section></div>;
      })()}
    </main>
  );
}
