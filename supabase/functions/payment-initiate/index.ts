import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Gateway = "esewa" | "khalti";
type Attempt = {
  attempt_id: string;
  order_number: string;
  amount_npr: number;
  customer_email: string;
  customer_phone: string;
  attempt_status: string;
  provider_reference: string | null;
  payment_url: string | null;
  new_attempt: boolean;
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function isGateway(value: unknown): value is Gateway {
  return value === "esewa" || value === "khalti";
}

function publicSiteUrl() {
  const configured = Deno.env.get("PUBLIC_SITE_URL");
  if (!configured) throw new Error("Payment return URL is not configured.");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Payment return URL must use HTTPS.");
  }
  return url.origin;
}

async function signEsewaMessage(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function esewaMode() {
  const mode = Deno.env.get("ESEWA_MODE");
  if (mode !== "sandbox" && mode !== "production") return null;
  if (!Deno.env.get("ESEWA_PRODUCT_CODE") || !Deno.env.get("ESEWA_SECRET_KEY")) return null;
  if (mode === "production" && (
    Deno.env.get("ESEWA_LIVE_ENABLED") !== "true" ||
    Deno.env.get("ESEWA_SETTLEMENT_VERIFIED") !== "true"
  )) return null;
  return mode;
}

function khaltiMode() {
  const mode = Deno.env.get("KHALTI_MODE");
  if (mode !== "sandbox" && mode !== "production") return null;
  if (!Deno.env.get("KHALTI_SECRET_KEY")) return null;
  if (mode === "production" && (
    Deno.env.get("KHALTI_LIVE_ENABLED") !== "true" ||
    Deno.env.get("KHALTI_SETTLEMENT_VERIFIED") !== "true"
  )) return null;
  return mode;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(401, { error: "An authenticated session is required." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "A valid JSON request is required." });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return respond(400, { error: "A valid payment request is required." });
  }
  const input = body as Record<string, unknown>;
  if (
    typeof input.order_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.order_id) ||
    !isGateway(input.provider)
  ) return respond(400, { error: "An order ID and supported gateway are required." });

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return respond(401, { error: "An authenticated session is required." });

  const provider = input.provider;
  const mode = provider === "esewa" ? esewaMode() : khaltiMode();
  if (!mode) return respond(503, { error: `${provider === "esewa" ? "eSewa" : "Khalti"} payments are not configured for this environment.` });

  let returnUrl: string;
  try {
    returnUrl = `${publicSiteUrl()}/payment/result`;
  } catch (cause) {
    return respond(503, { error: cause instanceof Error ? cause.message : "Payment return URL is not configured." });
  }

  const { data: attemptRows, error: attemptError } = await authClient.rpc("create_payment_attempt", {
    p_order_id: input.order_id,
    p_provider: provider,
  });
  if (attemptError) return respond(400, { error: attemptError.message });
  const attempt = (attemptRows as Attempt[] | null)?.[0];
  if (!attempt) return respond(500, { error: "Payment attempt could not be prepared." });
  if (!attempt.new_attempt && attempt.attempt_status === "initiating") {
    return respond(409, { error: "Payment setup is already in progress. Refresh the order before retrying." });
  }
  if (!attempt.new_attempt && attempt.attempt_status === "review") {
    return respond(409, { error: "This payment attempt requires support review before another payment can be started." });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (provider === "esewa") {
    const productCode = Deno.env.get("ESEWA_PRODUCT_CODE");
    const secret = Deno.env.get("ESEWA_SECRET_KEY");
    if (!productCode || !secret) return respond(503, { error: "eSewa payment credentials are not configured." });
    const total = String(attempt.amount_npr);
    const paymentReturnUrl = `${returnUrl}/${encodeURIComponent(attempt.attempt_id)}`;
    const transactionUuid = attempt.attempt_id;
    const signedFieldNames = "total_amount,transaction_uuid,product_code";
    const signature = await signEsewaMessage(
      `total_amount=${total},transaction_uuid=${transactionUuid},product_code=${productCode}`,
      secret,
    );
    const { error: updateError } = await admin.from("payment_attempts")
      .update({ status: "pending", provider_reference: transactionUuid, payment_url: null, last_error: null })
      .eq("id", attempt.attempt_id);
    if (updateError) {
      console.error("eSewa payment attempt update failed:", updateError.message);
      return respond(500, { error: "eSewa payment could not be prepared." });
    }

    return respond(200, {
      provider,
      attempt_id: attempt.attempt_id,
      action: mode === "sandbox"
        ? "https://rc-epay.esewa.com.np/api/epay/main/v2/form"
        : "https://epay.esewa.com.np/api/epay/main/v2/form",
      fields: {
        amount: total,
        tax_amount: "0",
        total_amount: total,
        transaction_uuid: transactionUuid,
        product_code: productCode,
        product_service_charge: "0",
        product_delivery_charge: "0",
        success_url: paymentReturnUrl,
        failure_url: paymentReturnUrl,
        signed_field_names: signedFieldNames,
        signature,
      },
    });
  }

  const secretKey = Deno.env.get("KHALTI_SECRET_KEY");
  if (!secretKey) return respond(503, { error: "Khalti payment credentials are not configured." });
  if (!attempt.new_attempt && attempt.payment_url && attempt.provider_reference) {
    return respond(200, {
      provider,
      attempt_id: attempt.attempt_id,
      payment_url: attempt.payment_url,
    });
  }
  if (!attempt.new_attempt) {
    return respond(409, { error: "The existing Khalti attempt has no confirmed checkout reference. Contact support before retrying to avoid a duplicate charge." });
  }

  const apiRoot = mode === "sandbox"
    ? "https://dev.khalti.com/api/v2"
    : "https://khalti.com/api/v2";
  let providerResponse: Response;
  try {
    providerResponse = await fetch(`${apiRoot}/epayment/initiate/`, {
      method: "POST",
      headers: {
        Authorization: `Key ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        return_url: `${returnUrl}/${encodeURIComponent(attempt.attempt_id)}`,
        website_url: publicSiteUrl(),
        amount: attempt.amount_npr * 100,
        purchase_order_id: attempt.attempt_id,
        purchase_order_name: attempt.order_number,
        customer_info: {
          email: attempt.customer_email,
          phone: attempt.customer_phone,
        },
      }),
    });
  } catch (cause) {
    const { error: updateError } = await admin.from("payment_attempts")
      .update({ status: "verification_unavailable", last_error: "Provider initiation could not be confirmed." })
      .eq("id", attempt.attempt_id);
    if (updateError) console.error("Khalti uncertain attempt state could not be saved:", updateError.message);
    console.error("Khalti initiation request failed:", cause instanceof Error ? cause.message : "network error");
    return respond(503, { error: "Khalti initiation could not be confirmed. Do not retry payment; check the order status or contact support." });
  }

  if (!providerResponse.ok) {
    const { error: updateError } = await admin.from("payment_attempts")
      .update({ status: "failed", last_error: "Provider rejected the initiation request." })
      .eq("id", attempt.attempt_id);
    if (updateError) console.error("Khalti failed attempt state could not be saved:", updateError.message);
    return respond(502, { error: "Khalti could not initiate this payment. The order remains unpaid." });
  }

  let providerData: unknown;
  try {
    providerData = await providerResponse.json();
  } catch {
    providerData = null;
  }
  if (
    typeof providerData !== "object" || providerData === null ||
    !("pidx" in providerData) || typeof providerData.pidx !== "string" ||
    !("payment_url" in providerData) || typeof providerData.payment_url !== "string"
  ) {
    const { error: updateError } = await admin.from("payment_attempts")
      .update({ status: "verification_unavailable", last_error: "Provider returned an incomplete initiation response." })
      .eq("id", attempt.attempt_id);
    if (updateError) console.error("Khalti incomplete attempt state could not be saved:", updateError.message);
    return respond(502, { error: "Khalti returned an incomplete response. The order remains unpaid pending verification." });
  }

  let paymentUrl: URL;
  try {
    paymentUrl = new URL(providerData.payment_url);
  } catch {
    paymentUrl = new URL("https://invalid.local");
  }
  const approvedHosts = mode === "sandbox"
    ? ["test-pay.khalti.com", "pay.khalti.com"]
    : ["pay.khalti.com"];
  if (paymentUrl.protocol !== "https:" || !approvedHosts.includes(paymentUrl.hostname)) {
    const { error: updateError } = await admin.from("payment_attempts")
      .update({ status: "review", last_error: "Provider returned an unapproved checkout URL." })
      .eq("id", attempt.attempt_id);
    if (updateError) console.error("Khalti URL review state could not be saved:", updateError.message);
    return respond(502, { error: "Khalti returned an unexpected checkout destination. The order remains unpaid." });
  }

  const { error: updateError } = await admin.from("payment_attempts")
    .update({
      status: "pending",
      provider_reference: providerData.pidx,
      payment_url: paymentUrl.toString(),
      last_error: null,
    })
    .eq("id", attempt.attempt_id);
  if (updateError) {
    console.error("Khalti payment attempt update failed:", updateError.message);
    return respond(500, { error: "Khalti payment could not be prepared." });
  }

  return respond(200, {
    provider,
    attempt_id: attempt.attempt_id,
    payment_url: paymentUrl.toString(),
  });
});
