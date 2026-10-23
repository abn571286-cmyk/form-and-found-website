import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import { useCart } from "../CartContext";
import { formatPrice, getVariantStock, isPurchasableVariant } from "../data/products";
import { store } from "../data/store";
import {
  DELIVERY_COVERAGE_SETTING_KEY,
  DELIVERY_FEE_NPR,
  DELIVERY_POSTAL_CODE_SETTING_KEY,
  isSupportedDeliveryAddress,
  isSupportedDeliveryPostalCode,
  parseDeliveryAddress,
  parseDeliveryDistricts,
  parseDeliveryPostalCodes,
  type DeliveryAddress,
} from "../lib/addresses";
import type { Database, Json } from "../lib/database.types";
import { createAuthenticatedOrder } from "../lib/orders";
import { initiatePayment, loadPaymentOptions, redirectToPayment, type PaymentOptions, type PaymentProvider } from "../lib/payments";
import { supabase } from "../lib/supabase";
import { useProductCatalog } from "../ProductCatalogContext";

type AddressRow = Database["public"]["Tables"]["delivery_addresses"]["Row"];
type CheckoutValues = DeliveryAddress;
type CheckoutResult = Awaited<ReturnType<typeof createAuthenticatedOrder>>;

const emptyAddress: CheckoutValues = {
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

const IDEMPOTENCY_STORAGE_KEY = "form-and-found-checkout-attempt";

function readFee(value: Json | undefined): number | null {
  const amount = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 100000 ? amount : null;
}

function getIdempotencyKey(cartSignature: string) {
  const saved = sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
  if (saved) {
    const attempt: unknown = JSON.parse(saved);
    if (
      typeof attempt === "object" && attempt !== null &&
      "signature" in attempt && attempt.signature === cartSignature &&
      "key" in attempt && typeof attempt.key === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.key)
    ) {
      return attempt.key;
    }
  }
  const key = crypto.randomUUID();
  sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, JSON.stringify({ signature: cartSignature, key }));
  return key;
}

function isValidPhone(value: string) {
  return /^[+()\-\d\s]{7,24}$/.test(value.trim()) && value.replace(/\D/g, "").length >= 7;
}

export default function Checkout() {
  const { items, clearCart } = useCart();
  const { products, state: catalogState } = useProductCatalog();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [delivery, setDelivery] = useState<CheckoutValues>(emptyAddress);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [supportedDistricts, setSupportedDistricts] = useState<string[] | null>(null);
  const [supportedPostalCodes, setSupportedPostalCodes] = useState<Record<string, string[]> | null>(null);
  const [loadingError, setLoadingError] = useState(
    supabase ? "" : "Checkout services are not configured for this deployment.",
  );
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<CheckoutResult | null>(null);
  const [emailStatus, setEmailStatus] = useState("");
  const [emailStatusError, setEmailStatusError] = useState(false);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions>({ esewa: false, khalti: false });
  const [paymentOptionsLoading, setPaymentOptionsLoading] = useState(true);
  const [paymentOptionsError, setPaymentOptionsError] = useState("");
  const [paymentChoice, setPaymentChoice] = useState<PaymentProvider | "none">("none");
  const [paymentStarting, setPaymentStarting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentNumberCopied, setPaymentNumberCopied] = useState(false);
  const [paymentNumberCopyError, setPaymentNumberCopyError] = useState("");

  const cartSignature = useMemo(() => JSON.stringify(items
    .map(({ id, size, color, quantity }) => ({ id, size, color, quantity }))
    .sort((first, second) => `${first.id}|${first.size}|${first.color}`.localeCompare(`${second.id}|${second.size}|${second.color}`))),
  [items]);
  async function copyPaymentContactNumber() {
    setPaymentNumberCopyError("");
    setPaymentNumberCopied(false);
    try {
      await navigator.clipboard.writeText(store.paymentContactNumber);
      setPaymentNumberCopied(true);
    } catch {
      setPaymentNumberCopyError("Could not copy automatically. Select and copy the number above.");
    }
  }

  const lines = items.flatMap((item) => {
    const product = products.find(({ id }) => id === item.id);
    return product ? [{ item, product }] : [];
  });
  const hasUnavailable = lines.length !== items.length || lines.some(({ item, product }) => {
    if (!isPurchasableVariant(product, item.size, item.color)) return true;
    const stock = getVariantStock(product, item.size, item.color);
    return stock !== undefined && item.quantity > stock;
  });
  const estimatedSubtotal = lines.reduce((total, { item, product }) => total + product.price * item.quantity, 0);
  const deliveryAvailable = supportedDistricts !== null &&
    isSupportedDeliveryAddress(delivery, supportedDistricts) &&
    isSupportedDeliveryPostalCode(delivery.postal_code, delivery.district, supportedPostalCodes);
  const applicableDeliveryFee = deliveryAvailable ? DELIVERY_FEE_NPR : 0;
  const estimatedTotal = estimatedSubtotal + applicableDeliveryFee;
  const requiredAddressFieldsComplete = [
    delivery.full_name,
    delivery.recipient_phone,
    delivery.province,
    delivery.district,
    delivery.municipality,
    delivery.ward,
    delivery.street,
  ].every((value) => value.trim().length > 0);
  const canPlaceOrder = Boolean(
    user &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    email.trim().length <= 254 &&
    isValidPhone(phone) &&
    requiredAddressFieldsComplete &&
    deliveryAvailable &&
    deliveryFee === DELIVERY_FEE_NPR &&
    supportedDistricts &&
    !submitting &&
    !hasUnavailable &&
    catalogState === "ready",
  );

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!active) return;
      setUser(userData.user);
      setEmail(userData.user?.email ?? "");
      if (userData.user) {
        const [addressResult, profileResult, feeResult] = await Promise.all([
          supabase.from("delivery_addresses").select("*")
            .eq("user_id", userData.user.id)
            .order("created_at", { ascending: false }),
          supabase.from("customer_profiles").select("phone")
            .eq("user_id", userData.user.id)
            .maybeSingle(),
          supabase.from("store_settings").select("key,value")
            .in("key", ["delivery_fee_npr", DELIVERY_COVERAGE_SETTING_KEY, DELIVERY_POSTAL_CODE_SETTING_KEY]),
        ]);
        if (addressResult.error) throw addressResult.error;
        if (profileResult.error) throw profileResult.error;
        if (feeResult.error) throw feeResult.error;
        if (!active) return;

        setAddresses(addressResult.data);
        setPhone(profileResult.data?.phone ?? "");
        const defaultAddress = addressResult.data.find(({ address }) => parseDeliveryAddress(address).is_default);
        if (defaultAddress) {
          setSelectedAddressId(defaultAddress.id);
          setDelivery(parseDeliveryAddress(defaultAddress.address));
        }
        const fee = readFee(feeResult.data.find(({ key }) => key === "delivery_fee_npr")?.value);
        const districts = parseDeliveryDistricts(
          feeResult.data.find(({ key }) => key === DELIVERY_COVERAGE_SETTING_KEY)?.value,
        );
        const postalCodes = parseDeliveryPostalCodes(
          feeResult.data.find(({ key }) => key === DELIVERY_POSTAL_CODE_SETTING_KEY)?.value,
        );
        setDeliveryFee(fee);
        setSupportedDistricts(districts);
        setSupportedPostalCodes(postalCodes);
        if (fee !== DELIVERY_FEE_NPR) {
          setLoadingError(`The delivery charge must be configured as NPR ${DELIVERY_FEE_NPR}. Checkout cannot create an order until the store setting is corrected.`);
        } else if (!districts) {
          setLoadingError("Delivery coverage is not configured. Checkout cannot create an order until supported districts are set.");
        }
      }
      setAuthLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setLoadingError(cause instanceof Error ? cause.message : "Unable to load checkout details.");
      setAuthLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadPaymentOptions()
      .then((options) => {
        if (!active) return;
        setPaymentOptions(options);
        setPaymentChoice(options.esewa ? "esewa" : options.khalti ? "khalti" : "none");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        console.error("Payment availability could not be checked:", cause instanceof Error ? cause.message : "Unknown payment service error");
        setPaymentOptionsError("Please try again later or contact support.");
      })
      .finally(() => {
        if (active) setPaymentOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function selectAddress(addressId: string) {
    setSelectedAddressId(addressId);
    if (!addressId) {
      setDelivery(emptyAddress);
      return;
    }
    const saved = addresses.find(({ id }) => id === addressId);
    if (saved) {
      const value = parseDeliveryAddress(saved.address);
      setDelivery(value);
      setPhone(value.recipient_phone);
    }
  }

  function updateDelivery<K extends keyof CheckoutValues>(key: K, value: CheckoutValues[K]) {
    setDelivery((current) => ({ ...current, [key]: value }));
    setSelectedAddressId("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!user || !supabase) {
      setFormError("Sign in to your customer account before placing an order.");
      return;
    }
    if (deliveryFee === null) {
      setFormError(`The store delivery charge must be configured as NPR ${DELIVERY_FEE_NPR}.`);
      return;
    }
    if (!supportedDistricts) {
      setFormError("Delivery coverage is not configured. Please contact customer support.");
      return;
    }
    if (deliveryFee !== DELIVERY_FEE_NPR) {
      setFormError("Delivery settings are not configured correctly. Please contact customer support.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
      setFormError("Enter a valid order email address.");
      return;
    }
    if (!isValidPhone(phone)) {
      setFormError("Enter a valid customer contact number.");
      return;
    }
    if (!delivery.full_name.trim() || !isValidPhone(delivery.recipient_phone) ||
      !delivery.province.trim() || !delivery.district.trim() || !delivery.municipality.trim() ||
      !delivery.ward.trim() || !delivery.street.trim()) {
      setFormError("Complete the recipient, contact number, province, district, municipality, ward, and street/locality.");
      return;
    }
    if (!isSupportedDeliveryAddress(delivery, supportedDistricts)) {
      setFormError("Delivery outside Kathmandu Valley is coming soon.");
      return;
    }
    if (!isSupportedDeliveryPostalCode(delivery.postal_code, delivery.district, supportedPostalCodes)) {
      setFormError("Delivery for this postal code has not been verified. Remove the postal code if it is not required, or contact customer support.");
      return;
    }
    if (delivery.postal_code.length > 20 || delivery.delivery_instructions.length > 500) {
      setFormError("Postal code or delivery instructions exceed the allowed length.");
      return;
    }
    if (!items.length || hasUnavailable) {
      setFormError("Your bag has unavailable items. Update it before placing an order.");
      return;
    }
    setSubmitting(true);
    setPaymentError("");
    let order: CheckoutResult;
    try {
      const idempotencyKey = getIdempotencyKey(cartSignature);
      order = await createAuthenticatedOrder({
        customerEmail: email.trim().toLowerCase(),
        customerPhone: phone.trim(),
        shippingAddress: {
          full_name: delivery.full_name.trim(),
          recipient_phone: delivery.recipient_phone.trim(),
          province: delivery.province.trim(),
          district: delivery.district.trim(),
          municipality: delivery.municipality.trim(),
          ward: delivery.ward.trim(),
          street: delivery.street.trim(),
          postal_code: delivery.postal_code.trim(),
          delivery_instructions: delivery.delivery_instructions.trim(),
        },
        items: lines.map(({ item, product }) => ({
          product,
          size: item.size,
          color: item.color,
          quantity: item.quantity,
        })),
      }, idempotencyKey);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Your order could not be confirmed. Your bag has been kept.");
      setSubmitting(false);
      return;
    }

    setConfirmation(order);
    clearCart();
    try {
      sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    } catch (storageError) {
      console.error("The confirmed checkout key could not be removed from this browser session.", storageError);
    }
    setEmailStatus("Sending your order confirmation…");
    try {
      const { data, error } = await supabase.functions.invoke("send-order-confirmation", {
        body: { order_id: order.id },
      });
      if (error) {
        setEmailStatusError(true);
        setEmailStatus(`Your order is confirmed, but the confirmation email could not be sent. Contact ${store.email} or ${store.emailAdditional} if needed.`);
      } else if (typeof data === "object" && data !== null && "sent" in data && data.sent === true) {
        setEmailStatusError(false);
        setEmailStatus(`The email provider accepted a confirmation email for delivery to ${order.customer_email}.`);
      } else if (typeof data === "object" && data !== null && "configured" in data && data.configured === false) {
        setEmailStatusError(false);
        setEmailStatus(`Your order is confirmed. Email notifications are not configured; contact ${store.email} or ${store.emailAdditional} for support.`);
      } else {
        setEmailStatusError(true);
        setEmailStatus(`Your order is confirmed, but we could not confirm email delivery. Contact ${store.email} or ${store.emailAdditional} if needed.`);
      }
    } catch {
      setEmailStatusError(true);
      setEmailStatus(`Your order is confirmed, but we could not confirm email delivery. Contact ${store.email} or ${store.emailAdditional} if needed.`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartPayment(orderId: string) {
    if (paymentChoice === "none") return;
    setPaymentStarting(true);
    setPaymentError("");
    try {
      const redirect = await initiatePayment(orderId, paymentChoice);
      redirectToPayment(redirect);
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Payment could not be started. The order remains unpaid.");
    } finally {
      setPaymentStarting(false);
    }
  }

  if (!items.length && !confirmation) {
    return (
      <main className="page-shell">
        <div className="page-heading"><p className="eyebrow">FORM & FOUND / CHECKOUT</p><h1>YOUR BAG IS EMPTY<span>.</span></h1></div>
        <section className="empty-state">
          <p>Add products to your bag before checking out.</p>
          <Link className="button button-lime" to="/shop">CONTINUE SHOPPING ↗</Link>
        </section>
      </main>
    );
  }

  if (confirmation) {
    return (
      <main className="page-shell checkout-page">
        <div className="page-heading">
          <p className="eyebrow">FORM & FOUND / ORDER CONFIRMED</p>
          <h1>THANK YOU<span>.</span></h1>
          <p>Your order was created successfully. Keep this order number for your records.</p>
        </div>
        <section className="checkout-confirmation">
          <div className="checkout-confirmation-heading">
            <div><p className="eyebrow">ORDER NUMBER</p><h2>{confirmation.order_number}</h2></div>
            <span className="account-status status-pending">{confirmation.order_status}</span>
          </div>
          <div className="account-order-list">
            {confirmation.items.map((item) => (
              <div className="summary-row" key={item.id}>
                <span>{item.product_name} / {item.variant_label} × {item.quantity}</span>
                <strong>{formatPrice(item.line_total_npr)}</strong>
              </div>
            ))}
          </div>
          <div className="summary-row"><span>Product subtotal</span><strong>{formatPrice(confirmation.subtotal_npr)}</strong></div>
          <div className="summary-row"><span>Delivery — Kathmandu Valley</span><strong>{formatPrice(confirmation.delivery_fee_npr)}</strong></div>
          <div className="summary-row"><span>Discount</span><strong>{formatPrice(0)}</strong></div>
          <div className="summary-row checkout-total-row"><strong>TOTAL PAYABLE</strong><strong>{formatPrice(confirmation.total_npr)}</strong></div>
          <p className="checkout-confirmation-payment">
            Payment status: <strong>{confirmation.payment_status}</strong>
            {paymentChoice !== "none" ? ` · Selected gateway: ${paymentChoice === "esewa" ? "eSewa" : "Khalti"}` : " · No online payment has been taken or verified."}
          </p>
          {paymentChoice !== "none" && (
            <div className="checkout-payment-action">
              <p>Verified order amount: <strong>{formatPrice(confirmation.total_npr)}</strong>. You will be redirected to the selected provider to pay.</p>
              {paymentError && <p className="account-error" role="alert">{paymentError}</p>}
              <button className="button button-lime" type="button" disabled={paymentStarting} onClick={() => void handleStartPayment(confirmation.id)}>
                {paymentStarting ? "PREPARING PAYMENT…" : `CONTINUE TO ${paymentChoice === "esewa" ? "ESEWA" : "KHALTI"} ↗`}
              </button>
            </div>
          )}
          {emailStatus && <p className={emailStatusError ? "account-error" : "account-message"} role={emailStatusError ? "alert" : "status"}>{emailStatus}</p>}
          <div className="account-delivery-details">
            <strong>Delivery for {delivery.full_name}</strong>
            <span>{delivery.street}, Ward {delivery.ward}, {delivery.municipality}, {delivery.district}, {delivery.province}</span>
            <span>{confirmation.customer_phone} · {confirmation.customer_email}</span>
            {delivery.delivery_instructions && <span>Instructions: {delivery.delivery_instructions}</span>}
          </div>
          {paymentChoice === "none" && <p className="checkout-payment-note">Online payments are not available in this environment. Your order remains unpaid; contact support for payment next steps.</p>}
          <div className="checkout-confirmation-actions">
            <Link className="button button-lime" to="/account">View your orders ↗</Link>
            <Link className="text-link" to="/shop">Continue shopping ↗</Link>
          </div>
          <div className="checkout-support">
            <span>Support:</span>
            <a href={`mailto:${store.email}`}>{store.email}</a>
            <a href={`mailto:${store.emailAdditional}`}>{store.emailAdditional}</a>
            <a href={`tel:${store.phoneLink}`}>{store.phone}</a>
            <a href={`tel:${store.phoneAdditionalLink}`}>{store.phoneAdditional}</a>
          </div>
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
          <p>Unavailable items must be removed before placing an order.</p>
        </div>
        <section className="empty-state">
          <p className="error-note" role="alert">Your bag includes a product or variant that is no longer available in the current catalogue.</p>
          <Link className="button button-lime" to="/cart">RETURN TO YOUR BAG ↗</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell checkout-page">
      <div className="page-heading">
        <p className="eyebrow">FORM & FOUND / SECURE ORDER</p>
        <h1>CHECKOUT<span>.</span></h1>
        <p>Your order total and inventory are verified securely by the store database.</p>
      </div>
      {loadingError && <p className="account-error" role="alert">{loadingError}</p>}
      {authLoading ? (
        <p className="catalog-loading" role="status">Loading checkout details…</p>
      ) : !user ? (
        <section className="checkout-signin">
          <h2>Sign in to place your order.</h2>
          <p>Orders are linked to a customer account to protect order history and delivery details. Your bag will remain saved while you sign in.</p>
          <Link className="button button-lime" to="/account?next=%2Fcheckout">SIGN IN / CREATE ACCOUNT ↗</Link>
        </section>
      ) : (
        <div className="checkout-layout">
          <form className="checkout-form" onSubmit={(event) => void handleSubmit(event)}>
            <fieldset>
              <legend>CONTACT DETAILS</legend>
              <label>Email for this order *<input name="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Customer contact number *<input name="phone" type="tel" autoComplete="tel" maxLength={24} required value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            </fieldset>
            <fieldset>
              <legend>DELIVERY ADDRESS</legend>
              {addresses.length > 0 && (
                <label>Use a saved address
                  <select value={selectedAddressId} onChange={(event) => selectAddress(event.target.value)}>
                    <option value="">Enter a new address</option>
                    {addresses.map((address) => (
                      <option key={address.id} value={address.id}>
                        {address.label}{parseDeliveryAddress(address.address).is_default ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>Recipient name *<input autoComplete="name" maxLength={100} required value={delivery.full_name} onChange={(event) => updateDelivery("full_name", event.target.value)} /></label>
              <label>Recipient contact number *<input autoComplete="tel" type="tel" maxLength={24} required value={delivery.recipient_phone} onChange={(event) => updateDelivery("recipient_phone", event.target.value)} /></label>
              <div className="form-row">
                <label>Province *<input maxLength={100} required value={delivery.province} onChange={(event) => updateDelivery("province", event.target.value)} /></label>
                <label>District *<input maxLength={100} required value={delivery.district} onChange={(event) => updateDelivery("district", event.target.value)} /></label>
              </div>
              <div className="form-row">
                <label>Municipality / city *<input maxLength={120} required value={delivery.municipality} onChange={(event) => updateDelivery("municipality", event.target.value)} /></label>
                <label>Ward *<input maxLength={20} required value={delivery.ward} onChange={(event) => updateDelivery("ward", event.target.value)} /></label>
              </div>
              <label>Street / locality *<input autoComplete="street-address" maxLength={240} required value={delivery.street} onChange={(event) => updateDelivery("street", event.target.value)} /></label>
              <label>Postal code (if applicable)<input autoComplete="postal-code" maxLength={20} value={delivery.postal_code} onChange={(event) => updateDelivery("postal_code", event.target.value)} /></label>
              <label>Delivery instructions<textarea rows={3} maxLength={500} value={delivery.delivery_instructions} onChange={(event) => updateDelivery("delivery_instructions", event.target.value)} /></label>
            </fieldset>
            <section className="checkout-delivery-availability" aria-live="polite">
              <p className="eyebrow">DELIVERY AVAILABILITY</p>
              <strong>Delivery is currently available within Kathmandu Valley.</strong>
              {!delivery.district.trim() ? (
                <p>Enter your province and district to check this address.</p>
              ) : deliveryAvailable ? (
                <p className="checkout-delivery-available">Delivery available in Kathmandu Valley.</p>
              ) : isSupportedDeliveryAddress(delivery, supportedDistricts ?? []) &&
                  !isSupportedDeliveryPostalCode(delivery.postal_code, delivery.district, supportedPostalCodes) ? (
                <p className="checkout-delivery-unavailable">Delivery for this postal code has not been verified. Remove it if optional, or contact support.</p>
              ) : (
                <p className="checkout-delivery-unavailable">Delivery outside Kathmandu Valley is coming soon.</p>
              )}
            </section>
            {paymentOptionsLoading ? <p className="form-note" role="status">Checking online payment availability…</p> : Object.values(paymentOptions).some(Boolean) ? (
              <fieldset className="checkout-payment-options">
                <legend>PAYMENT METHOD</legend>
                {paymentOptions.esewa && <label className="checkout-payment-choice"><input type="radio" name="payment-provider" checked={paymentChoice === "esewa"} onChange={() => setPaymentChoice("esewa")} /> <span><strong>eSewa</strong><small>Pay securely through the official eSewa checkout.</small></span></label>}
                {paymentOptions.khalti && <label className="checkout-payment-choice"><input type="radio" name="payment-provider" checked={paymentChoice === "khalti"} onChange={() => setPaymentChoice("khalti")} /> <span><strong>Khalti</strong><small>Pay securely through the official Khalti checkout.</small></span></label>}
                <p className="form-note">The payable amount is recalculated by the database. You will review that amount before leaving for the gateway.</p>
              </fieldset>
            ) : (
              <div className="checkout-callout checkout-payment-unavailable" role="status">
                <strong>Online payment is temporarily unavailable.</strong>
                <p>{paymentOptionsError || "Please try again later or contact support."} No payment will be taken or recorded as paid.</p>
              </div>
            )}
            <div className="checkout-callout checkout-payment-contact">
              <strong>Owner-provided contact / payment instruction</strong>
              <p>
                {store.manualPaymentReceivingDestinationVerified
                  ? "Contact the store to confirm the currently supported payment method before paying."
                  : "This contact number has not been verified as an eligible eSewa, Khalti, or other merchant receiving destination. Manual payment is not enabled or confirmed; do not treat a transfer, screenshot, or submitted reference as proof of payment."}
              </p>
              <div className="checkout-payment-contact-number">
                {store.phoneLink
                  ? <a href={`tel:${store.phoneLink}`}>{store.paymentContactNumber}</a>
                  : <span>{store.paymentContactNumber}</span>}
                <button className="text-link" type="button" onClick={() => void copyPaymentContactNumber()}>
                  {paymentNumberCopied ? "COPIED" : "COPY NUMBER"}
                </button>
              </div>
              {paymentNumberCopyError && <p className="account-error" role="alert">{paymentNumberCopyError}</p>}
              {paymentNumberCopied && <p className="account-message" role="status">Number copied.</p>}
            </div>
            {formError && <p className="account-error" role="alert">{formError}</p>}
            {!canPlaceOrder && user && !loadingError && !formError && (
              <p className="form-note" role="status">
                {!deliveryAvailable
                  ? "Enter a supported Kathmandu Valley delivery address to continue."
                  : !requiredAddressFieldsComplete || !email.trim() || !phone.trim()
                    ? "Complete all required contact and delivery fields to place your order."
                    : "Checkout is waiting for the live product catalogue or a configuration check."}
              </p>
            )}
            <button className="button button-lime checkout-place-order" type="submit" disabled={!canPlaceOrder}>
              {submitting ? "PLACING ORDER…" : paymentChoice !== "none" ? "REVIEW ORDER & PAYMENT ↗" : "PLACE ORDER ↗"}
            </button>
          </form>
          <aside className="order-summary">
            <p className="eyebrow">YOUR ORDER</p>
            {lines.map(({ item, product }) => (
              <div className="checkout-summary-item" key={`${item.id}-${item.size}-${item.color}`}>
                <img src={product.image} alt="" loading="lazy" />
                <div className="summary-row">
                  <span>{product.name} / {item.size} / {item.color} × {item.quantity}</span>
                  <strong>{formatPrice(product.price * item.quantity)}</strong>
                </div>
                <p>{formatPrice(product.price)} each × {item.quantity}</p>
              </div>
            ))}
            <div className="summary-row"><span>Product subtotal</span><strong>{formatPrice(estimatedSubtotal)}</strong></div>
            <div className="summary-row">
              <span>Delivery — Kathmandu Valley{delivery.district ? ` (${delivery.district})` : ""}</span>
              <strong>{formatPrice(applicableDeliveryFee)}</strong>
            </div>
            <div className="summary-row"><span>Discount</span><strong>{formatPrice(0)}</strong></div>
            <div className="summary-row checkout-total-row"><strong>TOTAL PAYABLE</strong><strong>{formatPrice(estimatedTotal)}</strong></div>
            <p className="form-note">
              {deliveryAvailable
                ? "The database rechecks current prices, stock, Kathmandu Valley delivery eligibility, and the NPR 120 fee before creating your order."
                : "Delivery is limited to Kathmandu Valley. No delivery fee is added for unsupported or unconfirmed locations."}
            </p>
            {catalogState === "demo" && <p className="error-note" role="alert">Development catalogue only. Real orders require the live Supabase catalogue.</p>}
            <Link className="text-link" to="/cart">← RETURN TO YOUR BAG</Link>
          </aside>
        </div>
      )}
    </main>
  );
}
