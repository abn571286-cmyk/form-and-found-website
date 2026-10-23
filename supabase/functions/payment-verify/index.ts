import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

type Gateway = "esewa" | "khalti";
type Attempt = {
  id: string;
  order_id: string;
  customer_user_id: string;
  provider: Gateway;
  provider_reference: string | null;
  amount_npr: number;
  status: string;
  verified_amount_npr: number | null;
  verified_at: string | null;
  provider_transaction_id: string | null;
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function configuredMode(provider: Gateway) {
  const prefix = provider === "esewa" ? "ESEWA" : "KHALTI";
  const mode = Deno.env.get(`${prefix}_MODE`);
  if (mode !== "sandbox" && mode !== "production") return null;
  const hasCredentials = provider === "esewa"
    ? Boolean(Deno.env.get("ESEWA_PRODUCT_CODE") && Deno.env.get("ESEWA_SECRET_KEY"))
    : Boolean(Deno.env.get("KHALTI_SECRET_KEY"));
  if (!hasCredentials) return null;
  if (mode === "production" && (
    Deno.env.get(`${prefix}_LIVE_ENABLED`) !== "true" ||
    Deno.env.get(`${prefix}_SETTLEMENT_VERIFIED`) !== "true"
  )) return null;
  return mode;
}

function responseFor(attempt: Attempt, order: {
  order_number: string;
  total_npr: number;
  payment_status: string;
  order_status: string;
}) {
  return {
    attempt_id: attempt.id,
    provider: attempt.provider,
    status: attempt.status,
    order_number: order.order_number,
    expected_amount_npr: order.total_npr,
    verified_amount_npr: attempt.verified_amount_npr,
    transaction_reference: attempt.provider_transaction_id ?? attempt.provider_reference,
    verified_at: attempt.verified_at,
    payment_status: order.payment_status,
    order_status: order.order_status,
  };
}

function parseNprAmount(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const normalized = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(normalized)) return null;
  const amount = Number(normalized.replaceAll(",", ""));
  return Number.isSafeInteger(amount) ? amount : null;
}

async function validateEsewaCallback(
  callbackData: string,
  attempt: Attempt,
  productCode: string,
  secret: string,
) {
  if (callbackData.length > 8192) return "eSewa callback exceeded the allowed size.";

  let callback: unknown;
  try {
    const base64 = callbackData.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    callback = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return "eSewa callback data could not be decoded.";
  }
  if (typeof callback !== "object" || callback === null || Array.isArray(callback)) {
    return "eSewa callback data has an invalid shape.";
  }
  const response = callback as Record<string, unknown>;
  const signedFieldNames = response.signed_field_names;
  const signature = response.signature;
  const allowedFields = new Set([
    "transaction_code",
    "status",
    "total_amount",
    "transaction_uuid",
    "product_code",
    "signed_field_names",
  ]);
  if (
    typeof signedFieldNames !== "string" ||
    typeof signature !== "string" ||
    signature.length > 512
  ) return "eSewa callback is missing its signature.";

  const fields = signedFieldNames.split(",");
  if (
    new Set(fields).size !== fields.length ||
    fields.length !== allowedFields.size ||
    fields.some((field) => !allowedFields.has(field)) ||
    [...allowedFields].some((field) => !fields.includes(field))
  ) return "eSewa callback has an unsupported signed-field list.";

  const amount = parseNprAmount(response.total_amount);
  const knownStatuses = new Set(["COMPLETE", "PENDING", "NOT_FOUND", "CANCELED", "FULL_REFUND", "PARTIAL_REFUND", "AMBIGUOUS"]);
  if (
    response.product_code !== productCode ||
    response.transaction_uuid !== attempt.provider_reference ||
    amount !== attempt.amount_npr ||
    typeof response.transaction_code !== "string" ||
    response.transaction_code.length === 0 ||
    typeof response.status !== "string" ||
    !knownStatuses.has(response.status)
  ) return "eSewa callback does not match the stored payment attempt.";

  const message = fields.map((field) => `${field}=${String(response[field])}`).join(",");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let signatureBytes: Uint8Array;
  try {
    const normalizedSignature = signature.replace(/-/g, "+").replace(/_/g, "/");
    const paddedSignature = normalizedSignature.padEnd(Math.ceil(normalizedSignature.length / 4) * 4, "=");
    signatureBytes = Uint8Array.from(atob(paddedSignature), (character) => character.charCodeAt(0));
  } catch {
    return "eSewa callback signature is malformed.";
  }
  const signatureValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(message),
  );
  return signatureValid ? null : "eSewa callback signature is invalid.";
}

async function requestPaymentConfirmation(
  supabaseUrl: string,
  anonKey: string,
  authorization: string,
  orderId: string,
) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-order-confirmation`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: orderId, notification_type: "payment_confirmation" }),
    });
    if (!response.ok) {
      console.error("Payment confirmation notification request failed:", response.status);
    }
  } catch (cause) {
    console.error("Payment confirmation notification request failed:", cause instanceof Error ? cause.message : "Network error");
  }
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
  if (
    typeof body !== "object" || body === null || Array.isArray(body) ||
    typeof (body as Record<string, unknown>).attempt_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((body as Record<string, string>).attempt_id)
  ) return respond(400, { error: "A valid payment attempt ID is required." });
  const attemptId = (body as { attempt_id: string }).attempt_id;

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return respond(401, { error: "An authenticated session is required." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: attempt, error: attemptError } = await admin
    .from("payment_attempts")
    .select("id,order_id,customer_user_id,provider,provider_reference,amount_npr,status,verified_amount_npr,verified_at,provider_transaction_id")
    .eq("id", attemptId)
    .maybeSingle();
  if (attemptError) {
    console.error("Payment attempt lookup failed:", attemptError.message);
    return respond(500, { error: "Payment status could not be loaded." });
  }
  if (!attempt || attempt.customer_user_id !== user.id) return respond(404, { error: "Payment attempt was not found." });

  const { data: order, error: orderError } = await admin.from("orders")
    .select("id,order_number,total_npr,payment_status,payment_method,order_status")
    .eq("id", attempt.order_id)
    .maybeSingle();
  if (orderError) {
    console.error("Payment order lookup failed:", orderError.message);
    return respond(500, { error: "Payment status could not be loaded." });
  }
  if (!order) return respond(404, { error: "Payment order was not found." });

  if (attempt.status === "verified" || ["failed", "cancelled", "expired"].includes(attempt.status)) {
    if (attempt.status === "verified") {
      await requestPaymentConfirmation(supabaseUrl, anonKey, authorization, order.id);
    }
    return respond(200, responseFor(attempt, order));
  }
  if (attempt.amount_npr !== order.total_npr || order.payment_method !== attempt.provider) {
    const { error: updateError } = await admin.from("payment_attempts")
      .update({ status: "review", last_error: "Order amount or selected provider did not match the stored attempt." })
      .eq("id", attempt.id)
      .neq("status", "verified");
    if (updateError) console.error("Payment mismatch review status could not be saved:", updateError.message);
    return respond(200, {
      ...responseFor({ ...attempt, status: "review" }, order),
      message: "Payment details require review. No payment was recorded.",
    });
  }
  if (order.payment_status === "paid") {
    const { data: currentAttempt, error: currentAttemptError } = await admin.from("payment_attempts")
      .select("id,order_id,customer_user_id,provider,provider_reference,amount_npr,status,verified_amount_npr,verified_at,provider_transaction_id")
      .eq("id", attempt.id)
      .single();
    if (currentAttemptError) {
      console.error("Payment attempt refresh failed:", currentAttemptError.message);
      return respond(500, { error: "Payment status could not be refreshed." });
    }
    if (currentAttempt.status === "verified") {
      await requestPaymentConfirmation(supabaseUrl, anonKey, authorization, order.id);
      return respond(200, responseFor(currentAttempt, order));
    }
    return respond(200, {
      ...responseFor({ ...attempt, status: "review" }, order),
      message: "This order is already paid. This separate attempt was not recorded.",
    });
  }

  const mode = configuredMode(attempt.provider);
  if (!mode) {
    const { error: updateError } = await admin.from("payment_attempts")
      .update({ status: "verification_unavailable", last_error: "Provider verification is not configured." })
      .eq("id", attempt.id)
      .neq("status", "verified");
    if (updateError) console.error("Unavailable verification status could not be saved:", updateError.message);
    return respond(200, {
      ...responseFor({ ...attempt, status: "verification_unavailable" }, order),
      message: "Provider verification is currently unavailable.",
    });
  }

  let verifiedReference = "";
  let providerTransactionId: string | null = null;
  let verifiedAmount = 0;
  let nextStatus: string;
  let integrityError = "";

  if (attempt.provider === "esewa") {
    const productCode = Deno.env.get("ESEWA_PRODUCT_CODE");
    const secret = Deno.env.get("ESEWA_SECRET_KEY");
    const callbackData = (body as Record<string, unknown>).esewa_callback_data;
    if (callbackData !== undefined && typeof callbackData !== "string") {
      return respond(400, { error: "The eSewa callback data is invalid." });
    }
    if (callbackData && productCode && secret) {
      const callbackError = await validateEsewaCallback(callbackData, attempt, productCode, secret);
      if (callbackError) {
        console.warn("Rejected eSewa callback:", callbackError);
        return respond(200, {
          ...responseFor({ ...attempt, status: "review" }, order),
          message: `${callbackError} No payment was recorded. Use the status check below to query eSewa directly.`,
        });
      }
    }
    if (!productCode || !secret || !attempt.provider_reference) {
      nextStatus = "review";
      integrityError = "The eSewa reference or merchant code is missing.";
    } else {
      const root = mode === "sandbox" ? "https://rc.esewa.com.np" : "https://esewa.com.np";
      const statusUrl = new URL(`${root}/api/epay/transaction/status/`);
      statusUrl.searchParams.set("product_code", productCode);
      statusUrl.searchParams.set("total_amount", String(attempt.amount_npr));
      statusUrl.searchParams.set("transaction_uuid", attempt.provider_reference);
      let statusResponse: Response;
      try {
        statusResponse = await fetch(statusUrl);
      } catch {
        statusResponse = new Response(null, { status: 503 });
      }
      if (!statusResponse.ok) {
        nextStatus = "verification_unavailable";
        integrityError = "eSewa status verification could not be reached.";
      } else {
        let data: unknown;
        try {
          data = await statusResponse.json();
        } catch {
          data = null;
        }
        if (typeof data !== "object" || data === null) {
          nextStatus = "verification_unavailable";
          integrityError = "eSewa returned an unreadable status response.";
        } else {
          const result = data as Record<string, unknown>;
          const amount = parseNprAmount(result.total_amount);
          if (
            result.product_code !== productCode ||
            result.transaction_uuid !== attempt.provider_reference ||
            amount === null || amount !== attempt.amount_npr
          ) {
            nextStatus = "review";
            integrityError = "The eSewa status response did not match the stored order.";
          } else {
            verifiedAmount = amount;
            if (result.status === "COMPLETE" && typeof result.ref_id === "string" && result.ref_id) {
              nextStatus = "verified";
              verifiedReference = result.ref_id;
              providerTransactionId = result.ref_id;
            } else if (result.status === "NOT_FOUND") {
              nextStatus = "expired";
            } else if (result.status === "CANCELED") {
              nextStatus = "cancelled";
            } else if (result.status === "FULL_REFUND" || result.status === "PARTIAL_REFUND") {
              nextStatus = "review";
              integrityError = "eSewa reports a refund state requiring administrator review.";
            } else if (result.status === "AMBIGUOUS") {
              nextStatus = "review";
              integrityError = "eSewa reports an ambiguous transaction requiring review.";
            } else if (result.status === "PENDING") {
              nextStatus = "pending";
            } else {
              nextStatus = "review";
              integrityError = "eSewa returned an unrecognized transaction status.";
            }
          }
        }
      }
    }
  } else {
    const secretKey = Deno.env.get("KHALTI_SECRET_KEY");
    if (!secretKey || !attempt.provider_reference) {
      nextStatus = "review";
      integrityError = "The Khalti payment reference or merchant key is missing.";
    } else {
      const root = mode === "sandbox" ? "https://dev.khalti.com/api/v2" : "https://khalti.com/api/v2";
      let lookupResponse: Response;
      try {
        lookupResponse = await fetch(`${root}/epayment/lookup/`, {
          method: "POST",
          headers: { Authorization: `Key ${secretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ pidx: attempt.provider_reference }),
        });
      } catch {
        lookupResponse = new Response(null, { status: 503 });
      }
      if (!lookupResponse.ok) {
        nextStatus = "verification_unavailable";
        integrityError = "Khalti status verification could not be reached.";
      } else {
        let data: unknown;
        try {
          data = await lookupResponse.json();
        } catch {
          data = null;
        }
        if (typeof data !== "object" || data === null) {
          nextStatus = "verification_unavailable";
          integrityError = "Khalti returned an unreadable status response.";
        } else {
          const result = data as Record<string, unknown>;
          const totalAmount = typeof result.total_amount === "number" || typeof result.total_amount === "string"
            ? Number(result.total_amount)
            : Number.NaN;
          const expectedPaisa = attempt.amount_npr * 100;
          if (
            result.pidx !== attempt.provider_reference ||
            !Number.isSafeInteger(expectedPaisa) ||
            !Number.isFinite(totalAmount) || totalAmount !== expectedPaisa ||
            ("purchase_order_id" in result && result.purchase_order_id !== attempt.id)
          ) {
            nextStatus = "review";
            integrityError = "The Khalti lookup response did not match the stored order.";
          } else {
            verifiedAmount = attempt.amount_npr;
            if (result.refunded === true) {
              nextStatus = "review";
              integrityError = "Khalti reports the transaction refunded. Administrator review is required.";
            } else if (result.status === "Completed" && typeof result.transaction_id === "string" && result.transaction_id) {
              nextStatus = "verified";
              verifiedReference = result.transaction_id;
              providerTransactionId = result.transaction_id;
            } else if (result.status === "User canceled") {
              nextStatus = "cancelled";
            } else if (result.status === "Expired") {
              nextStatus = "expired";
            } else if (result.status === "Pending" || result.status === "Initiated") {
              nextStatus = "pending";
            } else if (result.status === "Refunded") {
              nextStatus = "review";
              integrityError = "Khalti reports a refund state requiring administrator review.";
            } else {
              nextStatus = "failed";
            }
          }
        }
      }
    }
  }

  if (nextStatus === "verified") {
    const { error: recordError } = await admin.rpc("record_verified_payment_attempt", {
      p_attempt_id: attempt.id,
      p_provider_reference: verifiedReference,
      p_provider_transaction_id: providerTransactionId ?? verifiedReference,
      p_verified_amount_npr: verifiedAmount,
    });
    if (recordError) {
      console.error("Verified payment could not be recorded:", recordError.message);
      nextStatus = "verification_unavailable";
      integrityError = "Provider confirmed payment, but secure payment recording could not be completed.";
    }
  }

  const { error: updateError } = nextStatus === "verified" ? { error: null } : await admin.from("payment_attempts")
    .update({
      status: nextStatus,
      provider_transaction_id: providerTransactionId,
      verified_amount_npr: nextStatus === "verified" ? verifiedAmount : null,
      verified_at: nextStatus === "verified" ? new Date().toISOString() : null,
      last_error: integrityError || null,
    })
    .eq("id", attempt.id)
    .neq("status", "verified");
  if (updateError) {
    console.error("Payment attempt verification state could not be saved:", updateError.message);
    return respond(500, { error: "Provider status was checked but the result could not be saved. Please check again." });
  }

  const { data: updatedOrder } = await admin.from("orders")
    .select("id,order_number,total_npr,payment_status,payment_method,order_status")
    .eq("id", order.id)
    .single();
  const { data: updatedAttempt } = await admin.from("payment_attempts")
    .select("id,order_id,customer_user_id,provider,provider_reference,amount_npr,status,verified_amount_npr,verified_at,provider_transaction_id")
    .eq("id", attempt.id)
    .single();
  if (!updatedOrder || !updatedAttempt) return respond(500, { error: "Updated payment status could not be loaded." });
  if (updatedAttempt.status === "verified") {
    await requestPaymentConfirmation(supabaseUrl, anonKey, authorization, updatedOrder.id);
  }
  return respond(200, {
    ...responseFor(updatedAttempt, updatedOrder),
    ...(integrityError ? { message: integrityError } : {}),
  });
});
