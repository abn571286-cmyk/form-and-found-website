import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function formatNpr(amount: number) {
  return `NPR ${amount.toLocaleString("en-NP")}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(401, { error: "An authenticated session is required." });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "A valid JSON request is required." });
  }
  if (
    typeof payload !== "object" || payload === null || Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).order_id !== "string"
  ) {
    return respond(400, { error: "An order ID is required." });
  }
  const orderId = (payload as { order_id: string }).order_id;
  const requestedType = (payload as Record<string, unknown>).notification_type;
  const notificationType = requestedType ?? "order_confirmation";
  if (notificationType !== "order_confirmation" && notificationType !== "payment_confirmation") {
    return respond(400, { error: "Unsupported order notification type." });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return respond(400, { error: "A valid order ID is required." });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return respond(401, { error: "An authenticated session is required." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,customer_user_id,order_number,customer_email,customer_phone,shipping_address,subtotal_npr,delivery_fee_npr,total_npr,order_status,payment_status,payment_method,created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) {
    console.error("Order confirmation lookup failed:", orderError.message);
    return respond(500, { error: "Order confirmation could not be prepared." });
  }
  if (!order || order.customer_user_id !== user.id) {
    return respond(404, { error: "Order was not found." });
  }
  let verifiedTransaction: {
    provider: string;
    provider_reference: string | null;
    amount_npr: number;
    created_at: string;
  } | null = null;
  if (notificationType === "payment_confirmation") {
    if (order.payment_status !== "paid") return respond(409, { error: "Payment has not been verified." });
    const { data, error: transactionError } = await admin
      .from("payment_transactions")
      .select("provider,provider_reference,amount_npr,created_at")
      .eq("order_id", order.id)
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (transactionError) {
      console.error("Verified payment notification lookup failed:", transactionError.message);
      return respond(500, { error: "Payment confirmation could not be prepared." });
    }
    if (!data || data.amount_npr !== order.total_npr) {
      return respond(409, { error: "No matching verified payment is available." });
    }
    verifiedTransaction = data;
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  if (!apiKey || !from) {
    return respond(200, { sent: false, configured: false });
  }

  let attemptId: string;
  const { data: inserted, error: insertError } = await admin
    .from("order_notification_attempts")
    .insert({ order_id: order.id, notification_type: notificationType, status: "sending" })
    .select("id")
    .single();
  if (inserted) {
    attemptId = inserted.id;
  } else if (insertError?.code === "23505") {
    const { data: existing, error: existingError } = await admin
      .from("order_notification_attempts")
      .select("id,status,attempt_count,updated_at")
      .eq("order_id", order.id)
      .eq("notification_type", notificationType)
      .single();
    if (existingError) {
      console.error("Order confirmation attempt lookup failed:", existingError.message);
      return respond(500, { error: "Order confirmation could not be prepared." });
    }
    if (existing.status === "sent") return respond(200, { sent: true, alreadySent: true, configured: true });
    const staleSending = existing.status === "sending";
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    if (staleSending && existing.updated_at >= staleCutoff) {
      return respond(200, { sent: false, inProgress: true, configured: true });
    }

    let claimQuery = admin
      .from("order_notification_attempts")
      .update({
        status: "sending",
        attempt_count: existing.attempt_count + 1,
        last_error: null,
      })
      .eq("id", existing.id)
      .eq("status", existing.status);
    if (staleSending) claimQuery = claimQuery.lt("updated_at", staleCutoff);
    const { data: claimed, error: claimError } = await claimQuery.select("id").maybeSingle();
    if (claimError) {
      console.error("Order confirmation retry claim failed:", claimError.message);
      return respond(500, { error: "Order confirmation could not be prepared." });
    }
    if (!claimed) return respond(200, { sent: false, inProgress: true, configured: true });
    attemptId = claimed.id;
  } else {
    console.error("Order confirmation attempt could not be recorded:", insertError?.message);
    return respond(500, { error: "Order confirmation could not be prepared." });
  }

  const { data: items, error: itemsError } = await admin
    .from("order_items")
    .select("product_name,variant_label,quantity,unit_price_npr,line_total_npr")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });
  if (itemsError) {
    await admin.from("order_notification_attempts")
      .update({ status: "failed", last_error: "Could not load order items." })
      .eq("id", attemptId);
    console.error("Order confirmation item lookup failed:", itemsError.message);
    return respond(200, { sent: false, configured: true });
  }

  const address = typeof order.shipping_address === "object" && order.shipping_address !== null
    ? order.shipping_address as Record<string, unknown>
    : {};
  const addressLines = [
    address.full_name,
    address.recipient_phone,
    address.street,
    [address.ward ? `Ward ${address.ward}` : "", address.municipality, address.district, address.province]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(", "),
    address.postal_code,
    address.delivery_instructions ? `Delivery instructions: ${address.delivery_instructions}` : "",
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  const itemHtml = items.map((item) =>
    `<li>${escapeHtml(item.product_name)} — ${escapeHtml(item.variant_label)} × ${item.quantity} (${formatNpr(item.line_total_npr)})</li>`
  ).join("");
  const itemText = items.map((item) =>
    `${item.product_name} — ${item.variant_label} × ${item.quantity} (${formatNpr(item.line_total_npr)})`
  ).join("\n");
  const addressText = addressLines.join("\n");
  const addressHtml = addressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  const support = '<a href="mailto:abhiyan080@gmail.com">abhiyan080@gmail.com</a> · <a href="mailto:pranax909@gmail.com">pranax909@gmail.com</a> · <a href="tel:+9779840180193">9840180193</a> · <a href="tel:+9779745233604">9745233604</a>';
  const paymentDetails = notificationType === "payment_confirmation" && verifiedTransaction
    ? `<p>Payment of <strong>${formatNpr(verifiedTransaction.amount_npr)}</strong> was verified through ${escapeHtml(verifiedTransaction.provider)}.<br>
      Transaction reference: ${escapeHtml(verifiedTransaction.provider_reference ?? "Not provided")}<br>
      Verified: ${escapeHtml(new Date(verifiedTransaction.created_at).toLocaleString("en-NP"))}</p>`
    : `<p>Payment status: ${escapeHtml(order.payment_status)}<br>
      Order status: ${escapeHtml(order.order_status)}</p>`;
  const heading = notificationType === "payment_confirmation"
    ? `Payment confirmed for order ${escapeHtml(order.order_number)}`
    : `Order ${escapeHtml(order.order_number)} confirmed`;
  const html = `
    <h1>${heading}</h1>
    <p>${notificationType === "payment_confirmation" ? "The payment provider confirmed your payment." : "Thank you for your order. The details and current payment state are below."}</p>
    <ul>${itemHtml}</ul>
    <p>Subtotal: ${formatNpr(order.subtotal_npr)}<br>
    Delivery: ${formatNpr(order.delivery_fee_npr)}<br>
    Total: <strong>${formatNpr(order.total_npr)}</strong></p>
    ${paymentDetails}
    <p>Order status: ${escapeHtml(order.order_status)}</p>
    <h2>Delivery information</h2>${addressHtml}
    <p>Customer support: ${support}</p>`;
  const paymentText = notificationType === "payment_confirmation" && verifiedTransaction
    ? `Payment of ${formatNpr(verifiedTransaction.amount_npr)} was verified through ${verifiedTransaction.provider}.\nTransaction reference: ${verifiedTransaction.provider_reference ?? "Not provided"}\nVerified: ${new Date(verifiedTransaction.created_at).toLocaleString("en-NP")}`
    : `Payment status: ${order.payment_status}`;
  const textSupport = "abhiyan080@gmail.com · pranax909@gmail.com · 9840180193 · 9745233604";
  const text = `${notificationType === "payment_confirmation" ? "Payment confirmed" : "Order confirmed"}: ${order.order_number}\n\n${itemText}\n\nSubtotal: ${formatNpr(order.subtotal_npr)}\nDelivery: ${formatNpr(order.delivery_fee_npr)}\nTotal: ${formatNpr(order.total_npr)}\n${paymentText}\nOrder status: ${order.order_status}\n\nDelivery:\n${addressText}\n\nCustomer support: ${textSupport}`;
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${notificationType}-${order.id}`,
      },
      body: JSON.stringify({
        from,
        to: order.customer_email,
        subject: notificationType === "payment_confirmation"
          ? `FORM & FOUND payment confirmed for ${order.order_number}`
          : `FORM & FOUND order ${order.order_number}`,
        html,
        text,
      }),
    });
  } catch (cause) {
    const { error: updateError } = await admin.from("order_notification_attempts")
      .update({ status: "failed", last_error: "Email provider request failed." })
      .eq("id", attemptId);
    if (updateError) console.error("Order confirmation failure could not be recorded:", updateError.message);
    console.error("Order confirmation provider request failed:", cause instanceof Error ? cause.message : "Network error");
    return respond(200, { sent: false, configured: true });
  }
  if (!response.ok) {
    await admin.from("order_notification_attempts")
      .update({ status: "failed", last_error: `Email provider returned HTTP ${response.status}.` })
      .eq("id", attemptId);
    console.error("Order confirmation provider rejected a message:", response.status);
    return respond(200, { sent: false, configured: true });
  }

  const { error: sentUpdateError } = await admin
    .from("order_notification_attempts")
    .update({ status: "sent", last_error: null, sent_at: new Date().toISOString() })
    .eq("id", attemptId);
  if (sentUpdateError) {
    console.error("Order confirmation delivery could not be recorded:", sentUpdateError.message);
    return respond(200, { sent: true, recorded: false, configured: true });
  }
  return respond(200, { sent: true, configured: true });
});
