import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import type { Database } from "../lib/database.types";
import { parseDeliveryAddress, serializeDeliveryAddress, type DeliveryAddress } from "../lib/addresses";
import { store } from "../data/store";
import { formatPrice } from "../data/products";
import { initiatePayment, loadPaymentOptions, redirectToPayment, verifyPayment, type PaymentOptions } from "../lib/payments";
import { supabase } from "../lib/supabase";

type Section = "overview" | "profile" | "addresses" | "orders";
type Order = Database["public"]["Tables"]["orders"]["Row"];
type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];
type AddressRow = Database["public"]["Tables"]["delivery_addresses"]["Row"];
type PaymentAttempt = Database["public"]["Tables"]["payment_attempts"]["Row"];

type ProfileValues = {
  fullName: string;
  email: string;
  phone: string;
};

type AddressValues = DeliveryAddress & { label: string };

const emptyAddress: AddressValues = {
  label: "",
  full_name: "",
  recipient_phone: "",
  province: "",
  district: "",
  municipality: "",
  ward: "",
  street: "",
  postal_code: "",
  delivery_instructions: "",
  is_default: false,
};

const activeStatuses = new Set<Order["order_status"]>(["pending", "processing", "shipped"]);
const historyStatuses = new Set<Order["order_status"]>(["delivered", "cancelled"]);
const paymentStatusLabels: Record<string, string> = {
  pending: "Awaiting payment",
  paid: "Payment successful",
  failed: "Payment failed",
  cancelled: "Payment cancelled",
  processing: "Payment processing",
  review: "Payment requires review",
};
const attemptStatusLabels: Record<string, string> = {
  pending: "Payment verification pending",
  verification_unavailable: "Verification temporarily unavailable",
  initiating: "Payment processing",
  verified: "Payment successful",
  failed: "Payment failed",
  cancelled: "Payment cancelled",
  expired: "Payment expired",
  review: "Payment requires review",
};

function validPhone(value: string) {
  return /^[+()\-\d\s]{7,24}$/.test(value.trim()) && value.replace(/\D/g, "").length >= 7;
}

function orderAddress(order: Order) {
  return parseDeliveryAddress(order.shipping_address);
}

function OrderCard({
  order,
  items,
  attempts,
  paymentOptions,
  paymentOptionsError,
  checkingAttemptId,
  onCheckPayment,
  onRetryPayment,
}: {
  order: Order;
  items: OrderItem[];
  attempts: PaymentAttempt[];
  paymentOptions: PaymentOptions;
  paymentOptionsError: string;
  checkingAttemptId: string | null;
  onCheckPayment: (attemptId: string) => void;
  onRetryPayment: (orderId: string, provider: "esewa" | "khalti") => void;
}) {
  const address = orderAddress(order);
  const attempt = attempts.find(({ order_id }) => order_id === order.id);
  const awaitingPayment = order.payment_status === "pending" && order.order_status === "pending";
  const canCheck = attempt && ["pending", "verification_unavailable", "initiating", "review"].includes(attempt.status);
  const canResume = attempt?.status === "pending" && paymentOptions[attempt.provider];
  const canChooseProvider = awaitingPayment && (!attempt || ["failed", "cancelled", "expired"].includes(attempt.status));
  const availableProviders = (["esewa", "khalti"] as const).filter((provider) => paymentOptions[provider]);

  return (
    <article className="account-order-card">
      <div className="account-order-heading">
        <div>
          <p className="account-eyebrow">ORDER {order.order_number}</p>
          <p className="account-order-date">
            {new Date(order.created_at).toLocaleDateString("en-NP", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <span className={`account-status status-${order.order_status}`} aria-label={`Order status: ${order.order_status}`}>
          {order.order_status}
        </span>
      </div>
      <div className="account-order-summary">
        <span>{items.reduce((count, item) => count + item.quantity, 0)} items</span>
        <strong>{formatPrice(order.total_npr)}</strong>
      </div>
      <p className="account-payment-status">
        Payment: <strong>{paymentStatusLabels[order.payment_status] ?? order.payment_status}</strong>
        {order.payment_method && <> · Method: <strong>{order.payment_method}</strong></>}
        {attempt && <> · Attempt: <strong>{attemptStatusLabels[attempt.status] ?? attempt.status}</strong></>}
      </p>
      {attempt?.verified_amount_npr !== null && attempt?.verified_amount_npr !== undefined && (
        <p className="account-payment-status">Verified amount: <strong>{formatPrice(attempt.verified_amount_npr)}</strong></p>
      )}
      {attempt?.provider_transaction_id && (
        <p className="account-payment-status">Transaction reference: <strong>{attempt.provider_transaction_id}</strong></p>
      )}
      {attempt?.verified_at && (
        <p className="account-payment-status">Verified: <strong>{new Date(attempt.verified_at).toLocaleString("en-NP")}</strong></p>
      )}
      {(canCheck || canResume || (canChooseProvider && availableProviders.length > 0)) && (
        <div className="account-payment-actions">
          {canCheck && <button type="button" className="text-link" disabled={checkingAttemptId === attempt.id} onClick={() => onCheckPayment(attempt.id)}>
            {checkingAttemptId === attempt.id ? "Checking payment…" : "Check payment status"}
          </button>}
          {canResume && attempt && <button type="button" className="text-link" disabled={checkingAttemptId === attempt.id || checkingAttemptId === order.id} onClick={() => onRetryPayment(order.id, attempt.provider)}>
            Continue to {attempt.provider === "esewa" ? "eSewa" : "Khalti"}
          </button>}
          {canChooseProvider && availableProviders.map((provider) => <button type="button" className="text-link" key={provider} disabled={checkingAttemptId === order.id} onClick={() => onRetryPayment(order.id, provider)}>
            {attempt ? "Retry" : "Pay with"} {provider === "esewa" ? "eSewa" : "Khalti"}
          </button>)}
        </div>
      )}
      {awaitingPayment && !attempt && availableProviders.length === 0 && (
        <p className="account-payment-status">{paymentOptionsError || "Online payment is not currently available. Contact customer support for payment options."}</p>
      )}
      <details className="account-order-details">
        <summary>Order and delivery details</summary>
        <ul className="account-order-items">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.product_name} / {item.variant_label} × {item.quantity}</span>
              <strong>{formatPrice(item.line_total_npr)}</strong>
            </li>
          ))}
        </ul>
        <div className="account-order-totals">
          <p><span>Subtotal</span><span>{formatPrice(order.subtotal_npr)}</span></p>
          <p><span>Delivery</span><span>{formatPrice(order.delivery_fee_npr)}</span></p>
          <p><strong>Total</strong><strong>{formatPrice(order.total_npr)}</strong></p>
        </div>
        <div className="account-delivery-details">
          <strong>Delivering to {address.full_name || "recipient"}</strong>
          <span>{address.street}</span>
          <span>{[address.ward ? `Ward ${address.ward}` : "", address.municipality, address.district, address.province]
            .filter(Boolean).join(", ")}</span>
          <span>{order.customer_phone}</span>
          {address.delivery_instructions && <span>Instructions: {address.delivery_instructions}</span>}
        </div>
      </details>
    </article>
  );
}

export default function AccountDashboard({
  user,
  embedded,
  onLogout,
}: {
  user: User;
  embedded: boolean;
  onLogout: () => void;
}) {
  const metadataName = typeof user.user_metadata.full_name === "string" ? user.user_metadata.full_name : "";
  const [section, setSection] = useState<Section>("overview");
  const [orderTab, setOrderTab] = useState<"pending" | "history">("pending");
  const [profile, setProfile] = useState<ProfileValues>({
    fullName: metadataName,
    email: user.email ?? "",
    phone: "",
  });
  const [savedProfile, setSavedProfile] = useState<ProfileValues>({
    fullName: metadataName,
    email: user.email ?? "",
    phone: "",
  });
  const [profileEditing, setProfileEditing] = useState(false);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [paymentAttempts, setPaymentAttempts] = useState<PaymentAttempt[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions>({ esewa: false, khalti: false });
  const [paymentOptionsError, setPaymentOptionsError] = useState("");
  const [addressForm, setAddressForm] = useState<AddressValues | null>(null);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [checkingAttemptId, setCheckingAttemptId] = useState<string | null>(null);

  const refreshDashboard = useCallback(async () => {
    if (!supabase) {
      setError("Account services are not configured.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [profileResult, addressResult, orderResult] = await Promise.all([
        supabase.from("customer_profiles").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("delivery_addresses").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("orders").select("*").eq("customer_user_id", user.id).order("created_at", { ascending: false }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (addressResult.error) throw addressResult.error;
      if (orderResult.error) throw orderResult.error;

      const nextProfile = {
        fullName: profileResult.data?.full_name ??
          metadataName,
        email: user.email ?? "",
        phone: profileResult.data?.phone ?? "",
      };
      setProfile(nextProfile);
      setSavedProfile(nextProfile);
      setAddresses(addressResult.data);
      setOrders(orderResult.data);
      if (orderResult.data.length) {
        const orderIds = orderResult.data.map(({ id }) => id);
        const [itemsResult, attemptResult] = await Promise.all([
          supabase.from("order_items").select("*").in("order_id", orderIds).order("created_at", { ascending: true }),
          supabase.from("payment_attempts").select("*").eq("customer_user_id", user.id).in("order_id", orderIds).order("created_at", { ascending: false }),
        ]);
        const { data: items, error: itemError } = itemsResult;
        if (itemError) throw itemError;
        if (attemptResult.error) throw attemptResult.error;
        setOrderItems(items);
        setPaymentAttempts(attemptResult.data);
      } else {
        setOrderItems([]);
        setPaymentAttempts([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your account details.");
    } finally {
      setLoading(false);
    }
  }, [metadataName, user.email, user.id]);

  async function checkPayment(attemptId: string) {
    setCheckingAttemptId(attemptId);
    setError("");
    try {
      await verifyPayment(attemptId);
      await refreshDashboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment status could not be checked.");
    } finally {
      setCheckingAttemptId(null);
    }
  }

  async function retryPayment(orderId: string, provider: "esewa" | "khalti") {
    setCheckingAttemptId(orderId);
    setError("");
    try {
      const redirect = await initiatePayment(orderId, provider);
      redirectToPayment(redirect);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment could not be started.");
    } finally {
      setCheckingAttemptId(null);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(refreshDashboard);
  }, [refreshDashboard]);

  useEffect(() => {
    let active = true;
    void loadPaymentOptions()
      .then((options) => {
        if (active) setPaymentOptions(options);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        console.error("Online payment availability could not be checked:", cause instanceof Error ? cause.message : "Unknown error");
        setPaymentOptionsError("Online payment availability could not be checked. Contact customer support for payment options.");
      });
    return () => {
      active = false;
    };
  }, []);

  function openSection(next: Section) {
    setMessage("");
    setError("");
    setSection(next);
    if (next === "orders") {
      setOrderTab("pending");
      void refreshDashboard();
    }
  }

  function handleSectionTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, current: Section) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const sections: Section[] = ["overview", "profile", "addresses", "orders"];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = sections[(sections.indexOf(current) + direction + sections.length) % sections.length];
    openSection(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#account-tab-${next}`)?.focus();
  }

  function handleOrderTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, current: "pending" | "history") {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = current === "pending" ? "history" : "pending";
    setOrderTab(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#orders-tab-${next}`)?.focus();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const cleanName = profile.fullName.trim();
    const cleanEmail = profile.email.trim().toLowerCase();
    const cleanPhone = profile.phone.trim();
    if (!cleanName || cleanName.length > 100) {
      setError("Enter a full name between 1 and 100 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (cleanPhone && !validPhone(cleanPhone)) {
      setError("Enter a valid contact number or leave it blank.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");
    try {
      const { error: profileError } = await supabase.from("customer_profiles").upsert({
        user_id: user.id,
        full_name: cleanName,
        phone: cleanPhone || null,
      });
      if (profileError) throw profileError;
      const savedDetails = {
        fullName: cleanName,
        email: user.email ?? cleanEmail,
        phone: cleanPhone,
      };
      setSavedProfile(savedDetails);

      if (cleanEmail !== (user.email ?? "").toLowerCase()) {
        const { error: emailError } = await supabase.auth.updateUser({ email: cleanEmail });
        if (emailError) {
          setError(`Your name and phone were saved, but the email change could not be requested: ${emailError.message}`);
          return;
        }
        setProfile(savedDetails);
        setMessage("Profile saved. Supabase may require you to confirm the email change before it becomes your login email.");
      } else {
        setProfile(savedDetails);
        setSavedProfile(savedDetails);
        setMessage("Your personal information has been saved.");
      }
      setProfileEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save your personal information.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !addressForm) return;
    const values = {
      ...addressForm,
      label: addressForm.label.trim() || "Delivery address",
      full_name: addressForm.full_name.trim(),
      recipient_phone: addressForm.recipient_phone.trim(),
      province: addressForm.province.trim(),
      district: addressForm.district.trim(),
      municipality: addressForm.municipality.trim(),
      ward: addressForm.ward.trim(),
      street: addressForm.street.trim(),
      postal_code: addressForm.postal_code.trim(),
      delivery_instructions: addressForm.delivery_instructions.trim(),
    };
    if (!values.full_name || values.full_name.length > 100) {
      setError("Enter a recipient name between 1 and 100 characters.");
      return;
    }
    if (!validPhone(values.recipient_phone)) {
      setError("Enter a valid recipient contact number.");
      return;
    }
    if (!values.province || !values.district || !values.municipality || !values.ward || !values.street) {
      setError("Province, district, municipality, ward, and street/locality are required.");
      return;
    }
    if (values.postal_code.length > 20 || values.delivery_instructions.length > 500) {
      setError("Postal code or delivery instructions exceed the allowed length.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const previousAddress = editingAddressId
        ? addresses.find(({ id }) => id === editingAddressId)?.address
        : undefined;
      const address = serializeDeliveryAddress(values, previousAddress);
      let savedAddress: AddressRow;
      if (editingAddressId) {
        const { data, error: updateError } = await supabase
          .from("delivery_addresses")
          .update({ label: values.label, address })
          .eq("id", editingAddressId)
          .eq("user_id", user.id)
          .select("*")
          .single();
        if (updateError) throw updateError;
        savedAddress = data;
      } else {
        const { data, error: insertError } = await supabase
          .from("delivery_addresses")
          .insert({ user_id: user.id, label: values.label, address })
          .select("*")
          .single();
        if (insertError) throw insertError;
        savedAddress = data;
      }

      if (values.is_default) {
        const { error: defaultError } = await supabase.rpc("set_default_delivery_address", {
          p_address_id: savedAddress.id,
        });
        if (defaultError) throw defaultError;
      }
      await refreshDashboard();
      setAddressForm(null);
      setEditingAddressId(null);
      setMessage("Delivery address saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this delivery address.");
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(addressId: string) {
    if (!supabase) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { error: defaultError } = await supabase.rpc("set_default_delivery_address", {
        p_address_id: addressId,
      });
      if (defaultError) throw defaultError;
      await refreshDashboard();
      setMessage("Default delivery address updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the default address.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAddress(address: AddressRow) {
    if (!supabase || !window.confirm(`Delete the ${address.label} delivery address?`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { error: deleteError } = await supabase.from("delivery_addresses")
        .delete()
        .eq("id", address.id)
        .eq("user_id", user.id);
      if (deleteError) throw deleteError;
      await refreshDashboard();
      setMessage("Delivery address deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete this delivery address.");
    } finally {
      setSaving(false);
    }
  }

  function editAddress(address?: AddressRow) {
    setError("");
    setMessage("");
    if (!address) {
      setEditingAddressId(null);
      setAddressForm({
        ...emptyAddress,
        full_name: profile.fullName,
        recipient_phone: profile.phone,
        is_default: addresses.length === 0,
      });
      return;
    }
    setEditingAddressId(address.id);
    setAddressForm({ label: address.label, ...parseDeliveryAddress(address.address) });
  }

  const activeOrders = orders.filter(({ order_status }) => activeStatuses.has(order_status));
  const historyOrders = orders.filter(({ order_status }) => historyStatuses.has(order_status));
  const visibleOrders = orderTab === "pending" ? activeOrders : historyOrders;

  function itemsFor(orderId: string) {
    return orderItems.filter((item) => item.order_id === orderId);
  }

  return (
    <main className={`account-page account-dashboard${embedded ? " account-dashboard-embedded" : ""}`}>
      <div className="account-dashboard-heading">
        <div>
          <p className="account-eyebrow">FORM & FOUND / YOUR ACCOUNT</p>
          <h1>Hello{profile.fullName.trim() ? `, ${profile.fullName.trim().split(/\s+/)[0]}` : ""}<span>.</span></h1>
          <p className="account-intro">{user.email}</p>
        </div>
        <div className="account-header-actions">
          {!embedded && <Link className="account-button" to="/shop">Continue shopping ↗</Link>}
          <button className="account-button account-button-secondary" type="button" onClick={onLogout} disabled={saving}>
            Sign out
          </button>
        </div>
      </div>

      <nav className="account-section-tabs" role="tablist" aria-label="Account sections">
        {([
          ["overview", "Overview"],
          ["profile", "Personal information"],
          ["addresses", "Delivery addresses"],
          ["orders", "Orders"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            aria-controls={`account-panel-${value}`}
            id={`account-tab-${value}`}
            className={section === value ? "is-active" : ""}
            onClick={() => openSection(value)}
            onKeyDown={(event) => handleSectionTabKeyDown(event, value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {message && <p className="account-message" role="status">{message}</p>}
      {error && <p className="account-error" role="alert">{error}</p>}
      {loading ? (
        <p className="account-loading" role="status">Loading your account details…</p>
      ) : (
        <>
          {section === "overview" && (
            <section className="account-panel" id="account-panel-overview" role="tabpanel" aria-labelledby="account-tab-overview">
              <div className="account-overview-grid">
                <article className="account-stat-card">
                  <p className="account-eyebrow">ACTIVE ORDERS</p>
                  <strong>{activeOrders.length}</strong>
                  <button type="button" className="text-link" onClick={() => { setOrderTab("pending"); openSection("orders"); }}>
                    View pending orders ↗
                  </button>
                </article>
                <article className="account-summary-card">
                  <p className="account-eyebrow">ACCOUNT SUMMARY</p>
                  <p><strong>{profile.fullName || "Name not added"}</strong></p>
                  <p>{user.email}</p>
                  <p>{profile.phone || "Contact number not added"}</p>
                  <button type="button" className="text-link" onClick={() => openSection("profile")}>Edit personal information ↗</button>
                </article>
                <article className="account-summary-card">
                  <p className="account-eyebrow">DELIVERY</p>
                  <p>{addresses.length} saved {addresses.length === 1 ? "address" : "addresses"}</p>
                  <button type="button" className="text-link" onClick={() => openSection("addresses")}>Manage addresses ↗</button>
                </article>
              </div>
              <div className="account-section-heading">
                <div><p className="account-eyebrow">YOUR LATEST ACTIVITY</p><h2>Recent orders<span>.</span></h2></div>
                <button type="button" className="text-link" onClick={() => openSection("orders")}>Order history ↗</button>
              </div>
              {orders.slice(0, 3).length ? (
                <div className="account-order-list">
                  {orders.slice(0, 3).map((order) => <OrderCard
                    key={order.id}
                    order={order}
                    items={itemsFor(order.id)}
                    attempts={paymentAttempts}
                    paymentOptions={paymentOptions}
                    paymentOptionsError={paymentOptionsError}
                    checkingAttemptId={checkingAttemptId}
                    onCheckPayment={(attemptId) => void checkPayment(attemptId)}
                    onRetryPayment={(orderId, provider) => void retryPayment(orderId, provider)}
                  />)}
                </div>
              ) : (
                <div className="account-empty-state">
                  <p>No orders are associated with this account yet.</p>
                </div>
              )}
            </section>
          )}

          {section === "profile" && (
            <section className="account-panel" id="account-panel-profile" role="tabpanel" aria-labelledby="account-tab-profile">
              <div className="account-section-heading">
                <div><p className="account-eyebrow">YOUR DETAILS</p><h2>Personal information<span>.</span></h2></div>
                {!profileEditing && <button type="button" className="account-button" onClick={() => setProfileEditing(true)}>Edit details</button>}
              </div>
              {profileEditing ? (
                <form className="account-form account-profile-form" onSubmit={saveProfile}>
                  <label>Full name<input autoComplete="name" maxLength={100} required value={profile.fullName} onChange={(event) => setProfile((current) => ({ ...current, fullName: event.target.value }))} /></label>
                  <label>Email address<input autoComplete="email" type="email" maxLength={254} required value={profile.email} onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))} /></label>
                  <p className="account-form-hint">Supabase may ask you to verify a new login email before it takes effect.</p>
                  <label>Contact number<input autoComplete="tel" type="tel" maxLength={24} value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} /></label>
                  <div className="account-form-actions">
                    <button className="account-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                    <button className="account-button account-button-secondary" type="button" onClick={() => { setProfile(savedProfile); setProfileEditing(false); setError(""); }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <dl className="account-profile-details">
                  <div><dt>Full name</dt><dd>{profile.fullName || "Not provided"}</dd></div>
                  <div><dt>Email address</dt><dd>{user.email}</dd></div>
                  <div><dt>Contact number</dt><dd>{profile.phone || "Not provided"}</dd></div>
                </dl>
              )}
            </section>
          )}

          {section === "addresses" && (
            <section className="account-panel" id="account-panel-addresses" role="tabpanel" aria-labelledby="account-tab-addresses">
              <div className="account-section-heading">
                <div><p className="account-eyebrow">DELIVERY DETAILS</p><h2>Saved addresses<span>.</span></h2></div>
                {!addressForm && <button type="button" className="account-button" onClick={() => editAddress()}>Add an address</button>}
              </div>
              {addressForm && (
                <form className="account-form account-address-form" onSubmit={saveAddress}>
                  <label>Address label<input maxLength={60} value={addressForm.label} onChange={(event) => setAddressForm((current) => current && ({ ...current, label: event.target.value }))} placeholder="Home, work…" /></label>
                  <label>Recipient name<input autoComplete="name" maxLength={100} required value={addressForm.full_name} onChange={(event) => setAddressForm((current) => current && ({ ...current, full_name: event.target.value }))} /></label>
                  <label>Recipient contact number<input autoComplete="tel" type="tel" maxLength={24} required value={addressForm.recipient_phone} onChange={(event) => setAddressForm((current) => current && ({ ...current, recipient_phone: event.target.value }))} /></label>
                  <div className="account-address-fields">
                    <label>Province<input maxLength={100} required value={addressForm.province} onChange={(event) => setAddressForm((current) => current && ({ ...current, province: event.target.value }))} /></label>
                    <label>District<input maxLength={100} required value={addressForm.district} onChange={(event) => setAddressForm((current) => current && ({ ...current, district: event.target.value }))} /></label>
                    <label>Municipality / city<input maxLength={120} required value={addressForm.municipality} onChange={(event) => setAddressForm((current) => current && ({ ...current, municipality: event.target.value }))} /></label>
                    <label>Ward<input maxLength={20} required value={addressForm.ward} onChange={(event) => setAddressForm((current) => current && ({ ...current, ward: event.target.value }))} /></label>
                  </div>
                  <label>Street / locality<input autoComplete="street-address" maxLength={240} required value={addressForm.street} onChange={(event) => setAddressForm((current) => current && ({ ...current, street: event.target.value }))} /></label>
                  <label>Postal code (if applicable)<input autoComplete="postal-code" maxLength={20} value={addressForm.postal_code} onChange={(event) => setAddressForm((current) => current && ({ ...current, postal_code: event.target.value }))} /></label>
                  <label>Delivery instructions<textarea rows={3} maxLength={500} value={addressForm.delivery_instructions} onChange={(event) => setAddressForm((current) => current && ({ ...current, delivery_instructions: event.target.value }))} /></label>
                  <label className="account-checkbox"><input type="checkbox" checked={addressForm.is_default} onChange={(event) => setAddressForm((current) => current && ({ ...current, is_default: event.target.checked }))} />Make this my default address</label>
                  <div className="account-form-actions">
                    <button className="account-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save address"}</button>
                    <button className="account-button account-button-secondary" type="button" onClick={() => { setAddressForm(null); setEditingAddressId(null); }}>Cancel</button>
                  </div>
                </form>
              )}
              {addresses.length ? (
                <div className="account-address-list">
                  {addresses.map((address) => {
                    const value = parseDeliveryAddress(address.address);
                    return (
                      <article className="account-address-card" key={address.id}>
                        <div className="account-address-heading">
                          <div><h3>{address.label}</h3>{value.is_default && <span className="account-default-badge">DEFAULT</span>}</div>
                          <div className="account-address-actions">
                            {!value.is_default && <button type="button" className="text-link" disabled={saving} onClick={() => void makeDefault(address.id)}>Make default</button>}
                            <button type="button" className="text-link" disabled={saving} onClick={() => editAddress(address)}>Edit</button>
                            <button type="button" className="text-link account-delete-link" disabled={saving} onClick={() => void deleteAddress(address)}>Delete</button>
                          </div>
                        </div>
                        <p><strong>{value.full_name}</strong> · {value.recipient_phone}</p>
                        <p>{value.street}, Ward {value.ward}, {value.municipality}, {value.district}, {value.province}{value.postal_code ? ` ${value.postal_code}` : ""}</p>
                        {value.delivery_instructions && <p>{value.delivery_instructions}</p>}
                      </article>
                    );
                  })}
                </div>
              ) : !addressForm ? (
                <div className="account-empty-state"><p>No delivery addresses saved yet.</p></div>
              ) : null}
            </section>
          )}

          {section === "orders" && (
            <section className="account-panel" id="account-panel-orders" role="tabpanel" aria-labelledby="account-tab-orders">
              <div className="account-section-heading">
                <div><p className="account-eyebrow">YOUR PURCHASES</p><h2>Orders<span>.</span></h2></div>
                <button type="button" className="account-button account-button-secondary" disabled={loading} onClick={() => void refreshDashboard()}>Refresh orders</button>
              </div>
              <div className="account-order-tabs" role="tablist" aria-label="Order status">
                <button type="button" role="tab" id="orders-tab-pending" aria-controls="orders-panel" aria-selected={orderTab === "pending"} className={orderTab === "pending" ? "is-active" : ""} onClick={() => setOrderTab("pending")} onKeyDown={(event) => handleOrderTabKeyDown(event, "pending")}>
                  Pending orders <span>{activeOrders.length}</span>
                </button>
                <button type="button" role="tab" id="orders-tab-history" aria-controls="orders-panel" aria-selected={orderTab === "history"} className={orderTab === "history" ? "is-active" : ""} onClick={() => setOrderTab("history")} onKeyDown={(event) => handleOrderTabKeyDown(event, "history")}>
                  Order history <span>{historyOrders.length}</span>
                </button>
              </div>
              <div id="orders-panel" role="tabpanel" aria-labelledby={`orders-tab-${orderTab}`}>
                {visibleOrders.length ? (
                  <div className="account-order-list">
                    {visibleOrders.map((order) => <OrderCard
                      key={order.id}
                      order={order}
                      items={itemsFor(order.id)}
                      attempts={paymentAttempts}
                      paymentOptions={paymentOptions}
                      paymentOptionsError={paymentOptionsError}
                      checkingAttemptId={checkingAttemptId}
                      onCheckPayment={(attemptId) => void checkPayment(attemptId)}
                      onRetryPayment={(orderId, provider) => void retryPayment(orderId, provider)}
                    />)}
                  </div>
                ) : (
                  <div className="account-empty-state">
                    <p>{orderTab === "pending" ? "You have no pending, processing, or shipped orders." : "Delivered and cancelled orders will appear here."}</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <aside className="account-support">
        <p className="account-eyebrow">CUSTOMER SUPPORT</p>
        <div>
          <a href={`mailto:${store.email}`}>{store.email}</a>
          <a href={`mailto:${store.emailAdditional}`}>{store.emailAdditional}</a>
          <a href={`tel:${store.phoneLink}`}>{store.phone}</a>
          <a href={`tel:${store.phoneAdditionalLink}`}>{store.phoneAdditional}</a>
        </div>
      </aside>
    </main>
  );
}
