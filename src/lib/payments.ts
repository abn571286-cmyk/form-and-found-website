import { supabase } from "./supabase";

export type PaymentProvider = "esewa" | "khalti";
export type PaymentOptions = Record<PaymentProvider, boolean>;
export type PaymentRedirect =
  | { provider: "esewa"; action: string; fields: Record<string, string> }
  | { provider: "khalti"; payment_url: string };

const esewaActions = new Set([
  "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
  "https://epay.esewa.com.np/api/epay/main/v2/form",
]);
const khaltiHosts = new Set(["pay.khalti.com", "test-pay.khalti.com"]);

export async function loadPaymentOptions(): Promise<PaymentOptions> {
  if (!supabase) return { esewa: false, khalti: false };
  const { data, error } = await supabase.functions.invoke("payment-options", { method: "GET" });
  if (error) throw new Error(error.message || "Payment options could not be loaded.");
  if (
    typeof data !== "object" || data === null ||
    !("esewa" in data) || typeof data.esewa !== "boolean" ||
    !("khalti" in data) || typeof data.khalti !== "boolean"
  ) throw new Error("Payment options returned an invalid response.");
  return { esewa: data.esewa, khalti: data.khalti };
}

export async function initiatePayment(orderId: string, provider: PaymentProvider): Promise<PaymentRedirect> {
  if (!supabase) throw new Error("Payment services are not configured.");
  const { data, error } = await supabase.functions.invoke("payment-initiate", {
    body: { order_id: orderId, provider },
  });
  if (error) throw new Error(error.message || "Payment initiation failed.");
  if (typeof data !== "object" || data === null || !("provider" in data) || data.provider !== provider) {
    throw new Error("Payment initiation returned an invalid response.");
  }

  if (provider === "esewa") {
    if (
      !("action" in data) || typeof data.action !== "string" || !esewaActions.has(data.action) ||
      !("fields" in data) || typeof data.fields !== "object" || data.fields === null ||
      !Object.values(data.fields).every((value) => typeof value === "string")
    ) throw new Error("eSewa returned an invalid checkout request.");
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(data.fields)) {
      if (typeof value !== "string") throw new Error("eSewa returned an invalid checkout request.");
      fields[name] = value;
    }
    return { provider, action: data.action, fields };
  }

  if (!("payment_url" in data) || typeof data.payment_url !== "string") {
    throw new Error("Khalti returned an invalid checkout URL.");
  }
  let paymentUrl: URL;
  try {
    paymentUrl = new URL(data.payment_url);
  } catch {
    throw new Error("Khalti returned an invalid checkout URL.");
  }
  if (paymentUrl.protocol !== "https:" || !khaltiHosts.has(paymentUrl.hostname)) {
    throw new Error("Khalti returned an unapproved checkout destination.");
  }
  return { provider, payment_url: paymentUrl.toString() };
}

export function redirectToPayment(payment: PaymentRedirect) {
  if (payment.provider === "khalti") {
    window.location.assign(payment.payment_url);
    return;
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = payment.action;
  form.style.display = "none";
  for (const [name, value] of Object.entries(payment.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

export async function verifyPayment(attemptId: string, esewaCallbackData?: string | null) {
  if (!supabase) throw new Error("Payment services are not configured.");
  const { data, error } = await supabase.functions.invoke("payment-verify", {
    body: {
      attempt_id: attemptId,
      ...(esewaCallbackData ? { esewa_callback_data: esewaCallbackData } : {}),
    },
  });
  if (error) throw new Error(error.message || "Payment verification is unavailable.");
  if (typeof data !== "object" || data === null || !("status" in data) || typeof data.status !== "string") {
    throw new Error("Payment verification returned an invalid response.");
  }
  return data;
}
