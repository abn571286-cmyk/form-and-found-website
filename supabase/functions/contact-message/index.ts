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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "A valid JSON request is required." });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return respond(400, { error: "A valid message is required." });
  }

  const input = payload as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const subject = typeof input.subject === "string" ? input.subject.trim().replace(/[\r\n]+/g, " ") : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const honeypot = typeof input.company === "string" ? input.company.trim() : "";
  const submissionId = typeof input.submission_id === "string" ? input.submission_id : "";
  if (honeypot) return respond(400, { error: "Unable to accept this message." });
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId) ||
    name.length < 1 || name.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    subject.length < 1 || subject.length > 160 ||
    message.length < 1 || message.length > 5000
  ) {
    return respond(400, { error: "Check the name, email, subject, and message fields." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(503, { error: "Contact submissions are not configured on the server." });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existingSubmission, error: lookupError } = await admin
    .from("contact_messages")
    .select("id,name,email,subject,message,notification_status")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (lookupError) {
    console.error("Contact submission lookup failed:", lookupError.message);
    return respond(500, { error: "Your message could not be saved. Please try again." });
  }
  let saved = existingSubmission;
  if (saved && (saved.name !== name || saved.email !== email || saved.subject !== subject || saved.message !== message)) {
    return respond(409, { error: "This submission key was already used for different message details." });
  }

  if (!saved) {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent, error: rateError } = await admin
      .from("contact_messages")
      .select("id")
      .eq("email", email)
      .gte("created_at", cutoff)
      .limit(3);
    if (rateError) {
      console.error("Contact submission rate check failed:", rateError.message);
      return respond(500, { error: "Your message could not be saved. Please try again." });
    }
    if (recent.length >= 3) return respond(429, { error: "Too many messages were submitted for this email. Please try again later." });

    const { data: inserted, error: saveError } = await admin
      .from("contact_messages")
      .insert({
        submission_id: submissionId,
        name,
        email,
        subject,
        message,
        notification_status: "not_configured",
      })
      .select("id,name,email,subject,message,notification_status")
      .single();
    if (inserted) {
      saved = inserted;
    } else if (saveError?.code === "23505") {
      const { data: duplicate, error: duplicateError } = await admin
        .from("contact_messages")
        .select("id,name,email,subject,message,notification_status")
        .eq("submission_id", submissionId)
        .maybeSingle();
      if (duplicateError || !duplicate) {
        console.error("Duplicate contact submission could not be confirmed:", duplicateError?.message);
        return respond(500, { error: "Your message could not be saved. Please try again." });
      }
      if (duplicate.name !== name || duplicate.email !== email || duplicate.subject !== subject || duplicate.message !== message) {
        return respond(409, { error: "This submission key was already used for different message details." });
      }
      saved = duplicate;
    } else {
      console.error("Contact message storage failed:", saveError?.message);
      return respond(500, { error: "Your message could not be saved. Please try again." });
    }
  }

  if (saved.notification_status === "sent") {
    return respond(200, { saved: true, notificationSent: true, notificationConfigured: true });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("CONTACT_FROM_EMAIL");
  if (!apiKey || !from) {
    await admin.from("contact_messages")
      .update({ notification_status: "not_configured" })
      .eq("id", saved.id);
    return respond(200, { saved: true, notificationSent: false, notificationConfigured: false });
  }

  const to = Deno.env.get("CONTACT_TO_EMAIL") ?? "abhiyan080@gmail.com";
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br>");
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `contact-message-${saved.id}`,
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: email,
        subject: `FORM & FOUND contact: ${subject}`,
        html: `<h2>${safeSubject}</h2><p>From ${safeName} &lt;${safeEmail}&gt;</p><p>${safeMessage}</p>`,
      }),
    });
  } catch (cause) {
    const { error: updateError } = await admin.from("contact_messages")
      .update({ notification_status: "failed" })
      .eq("id", saved.id);
    if (updateError) console.error("Contact notification failure could not be recorded:", updateError.message);
    console.error("Contact notification provider request failed:", cause instanceof Error ? cause.message : "Network error");
    return respond(200, { saved: true, notificationSent: false, notificationConfigured: true });
  }

  if (!response.ok) {
    const { error: updateError } = await admin.from("contact_messages")
      .update({ notification_status: "failed" })
      .eq("id", saved.id);
    if (updateError) console.error("Contact notification failure could not be recorded:", updateError.message);
    console.error("Contact notification provider rejected a message:", response.status);
    return respond(200, { saved: true, notificationSent: false, notificationConfigured: true });
  }

  const { error: updateError } = await admin.from("contact_messages")
    .update({ notification_status: "sent" })
    .eq("id", saved.id);
  if (updateError) console.error("Contact notification success could not be recorded:", updateError.message);
  return respond(200, { saved: true, notificationSent: true, notificationConfigured: true });
});
