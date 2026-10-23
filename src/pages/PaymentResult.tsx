import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { formatPrice } from "../data/products";
import { store } from "../data/store";
import { verifyPayment } from "../lib/payments";
import "./PaymentResult.css";

type PaymentStatus = {
  attempt_id: string;
  provider: "esewa" | "khalti";
  status: string;
  order_number: string;
  expected_amount_npr: number;
  verified_amount_npr: number | null;
  transaction_reference: string | null;
  verified_at: string | null;
  payment_status: string;
  order_status: string;
  message?: string;
};

function parsePaymentStatus(value: unknown): PaymentStatus | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.attempt_id !== "string" ||
    (data.provider !== "esewa" && data.provider !== "khalti") ||
    typeof data.status !== "string" ||
    typeof data.order_number !== "string" ||
    typeof data.expected_amount_npr !== "number" ||
    typeof data.payment_status !== "string" ||
    typeof data.order_status !== "string"
  ) return null;
  return {
    attempt_id: data.attempt_id,
    provider: data.provider,
    status: data.status,
    order_number: data.order_number,
    expected_amount_npr: data.expected_amount_npr,
    verified_amount_npr: typeof data.verified_amount_npr === "number" ? data.verified_amount_npr : null,
    transaction_reference: typeof data.transaction_reference === "string" ? data.transaction_reference : null,
    verified_at: typeof data.verified_at === "string" ? data.verified_at : null,
    payment_status: data.payment_status,
    order_status: data.order_status,
    message: typeof data.message === "string" ? data.message : undefined,
  };
}

const statusCopy: Record<string, string> = {
  verified: "Payment successful",
  pending: "Payment verification pending",
  failed: "Payment failed",
  cancelled: "Payment cancelled",
  expired: "Payment expired",
  verification_unavailable: "Payment verification temporarily unavailable",
  review: "Payment requires review",
  initiating: "Payment processing",
};

const paymentStateCopy: Record<string, string> = {
  pending: "Awaiting payment",
  paid: "Payment successful",
  failed: "Payment failed",
  cancelled: "Payment cancelled",
  processing: "Payment processing",
  review: "Payment requires review",
};

export default function PaymentResult() {
  const { attempt_id: pathAttemptId } = useParams();
  const [searchParams] = useSearchParams();
  const attemptId = pathAttemptId ?? searchParams.get("attempt_id") ?? "";
  const callbackData = searchParams.get("data");
  const validAttemptId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId);
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const checkStatus = useCallback(async (includeCallback = true) => {
    if (!validAttemptId) {
      setError("A valid payment attempt could not be identified. Open your account orders to check status.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = parsePaymentStatus(await verifyPayment(attemptId, includeCallback ? callbackData : null));
      if (!result) throw new Error("The payment service returned an invalid status.");
      setStatus(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment verification is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [attemptId, callbackData, validAttemptId]);

  useEffect(() => {
    void Promise.resolve().then(() => checkStatus());
  }, [checkStatus]);

  const isVerified = status?.status === "verified" && status.payment_status === "paid";
  const currentStatus = status ? statusCopy[status.status] ?? "Payment status updated" : "";
  const canCheckAgain = validAttemptId && (!status || ["pending", "verification_unavailable", "initiating", "review"].includes(status.status));

  return (
    <main className="page-shell payment-result-page">
      <div className="page-heading">
        <p className="eyebrow">FORM &amp; FOUND / PAYMENT STATUS</p>
        <h1>{loading ? <>VERIFYING<span>.</span></> : isVerified ? <>PAYMENT<br />CONFIRMED<span>.</span></> : <>PAYMENT<br />UPDATE<span>.</span></>}</h1>
        <p>{loading ? "Checking the provider directly. Please keep this page open." : isVerified ? "The provider confirmed this payment and it has been recorded against your order." : "Browser redirects are not proof of payment. The order remains unpaid unless the provider confirms it."}</p>
      </div>

      <section className="payment-result-card" aria-live="polite">
        {loading ? <p className="payment-result-loading" role="status">Verifying with the payment provider…</p> : error ? (
          <p className="account-error" role="alert">{error}</p>
        ) : status ? (
          <>
            <div className="payment-result-status">
              <span className={`account-status status-${status.status}`}>{currentStatus}</span>
              <strong>{paymentStateCopy[status.payment_status] ?? status.payment_status}</strong>
            </div>
            <dl>
              <div><dt>Order</dt><dd>{status.order_number}</dd></div>
              <div><dt>Gateway</dt><dd>{status.provider === "esewa" ? "eSewa" : "Khalti"}</dd></div>
              <div><dt>Expected amount</dt><dd>{formatPrice(status.expected_amount_npr)}</dd></div>
              {status.verified_amount_npr !== null && <div><dt>Verified amount</dt><dd>{formatPrice(status.verified_amount_npr)}</dd></div>}
              {status.transaction_reference && <div><dt>Transaction reference</dt><dd>{status.transaction_reference}</dd></div>}
              {status.verified_at && <div><dt>Verified at</dt><dd>{new Date(status.verified_at).toLocaleString("en-NP")}</dd></div>}
              <div><dt>Order status</dt><dd>{status.order_status}</dd></div>
            </dl>
            {status.message && <p className="form-note">{status.message}</p>}
          </>
        ) : null}

        {error && <Link className="button button-outline" to="/account?next=%2Faccount">SIGN IN / OPEN ACCOUNT ↗</Link>}
        {!loading && canCheckAgain && (
          <button className="button button-lime" type="button" disabled={loading} onClick={() => void checkStatus(false)}>
            CHECK PAYMENT STATUS
          </button>
        )}
        <Link className="text-link" to="/account">View your orders ↗</Link>
        <div className="checkout-support">
          <span>Need help?</span>
          <a href={`mailto:${store.email}`}>{store.email}</a>
          <a href={`mailto:${store.emailAdditional}`}>{store.emailAdditional}</a>
          <a href={`tel:${store.phoneLink}`}>{store.phone}</a>
        </div>
      </section>
    </main>
  );
}
