const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function configured(provider: "esewa" | "khalti") {
  const prefix = provider === "esewa" ? "ESEWA" : "KHALTI";
  const mode = Deno.env.get(`${prefix}_MODE`);
  const hasCredentials = provider === "esewa"
    ? Boolean(Deno.env.get("ESEWA_PRODUCT_CODE") && Deno.env.get("ESEWA_SECRET_KEY"))
    : Boolean(Deno.env.get("KHALTI_SECRET_KEY"));
  if (!hasCredentials || (mode !== "sandbox" && mode !== "production")) return false;

  if (mode === "production") {
    return Deno.env.get(`${prefix}_LIVE_ENABLED`) === "true" &&
      Deno.env.get(`${prefix}_SETTLEMENT_VERIFIED`) === "true";
  }

  return true;
}

function returnSiteConfigured() {
  const value = Deno.env.get("PUBLIC_SITE_URL");
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (
      url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
  }

  return new Response(JSON.stringify({
    esewa: returnSiteConfigured() && configured("esewa"),
    khalti: returnSiteConfigured() && configured("khalti"),
  }), { status: 200, headers });
});
