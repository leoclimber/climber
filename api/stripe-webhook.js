const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Map Stripe price IDs to internal plan names (must match user.js PLAN_LIMITS keys)
const PRICE_TO_PLAN = {
  "price_1TiFvLFgrt1x0HdKqNwknfjK": "starter",
  "price_1TiG1ZFgrt1x0HdKpdXIAmqy": "pro"
};

// Vercel needs the raw request body to verify the Stripe signature,
// so we disable the default JSON body parser for this route.
export const config = {
  api: {
    bodyParser: false
  }
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Minimal Stripe signature verification using Node's built-in crypto,
// avoiding the need to install the official stripe npm package.
async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const crypto = await import("crypto");

  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    acc[key] = value;
    return acc;
  }, {});

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  // Constant-time comparison
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function sb(path, options = {}) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function setUserPlanByEmail(email, plan) {
  const normalizedEmail = (email || "").toLowerCase().trim();
  if (!normalizedEmail) return { ok: false, error: "Missing email" };

  const existing = await sb("users?email=eq." + encodeURIComponent(normalizedEmail) + "&select=*");

  if (existing.ok && existing.data && existing.data.length > 0) {
    // Update existing user: set plan, reset usage, start a fresh billing cycle
    const updated = await sb("users?email=eq." + encodeURIComponent(normalizedEmail), {
      method: "PATCH",
      body: JSON.stringify({
        plan,
        posts_used: 0,
        calendar_used: 0,
        promo_used: 0,
        inspiration_used: 0,
        cycle_start: new Date().toISOString()
      })
    });
    return { ok: updated.ok, data: updated.data };
  }

  // User doesn't exist yet (e.g. paid before ever using the app) — create them
  const created = await sb("users", {
    method: "POST",
    body: JSON.stringify({
      email: normalizedEmail,
      posts_used: 0,
      calendar_used: 0,
      promo_used: 0,
      inspiration_used: 0,
      plan,
      cycle_start: new Date().toISOString()
    })
  });
  return { ok: created.ok, data: created.data };
}

async function downgradeUserToFreeByEmail(email) {
  const normalizedEmail = (email || "").toLowerCase().trim();
  if (!normalizedEmail) return { ok: false, error: "Missing email" };

  // Reset usage counters on downgrade so the returning free user can still
  // use their free trial allowances (otherwise leftover high counts would
  // lock them out of the 3 free posts).
  const updated = await sb("users?email=eq." + encodeURIComponent(normalizedEmail), {
    method: "PATCH",
    body: JSON.stringify({
      plan: "free",
      posts_used: 0,
      calendar_used: 0,
      promo_used: 0,
      inspiration_used: 0
    })
  });
  return { ok: updated.ok, data: updated.data };
}

// Stripe Checkout/Payment Link sessions don't always include the email in the
// top-level object depending on flow, so we check a few likely places.
function extractEmailFromSession(session) {
  return (
    session.customer_details?.email ||
    session.customer_email ||
    null
  );
}

async function getCustomerEmail(customerId) {
  if (!customerId || !STRIPE_SECRET_KEY) return null;
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

async function getPlanFromSubscription(subscriptionId) {
  if (!subscriptionId || !STRIPE_SECRET_KEY) return null;
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const priceId = data.items?.data?.[0]?.price?.id;
  return PRICE_TO_PLAN[priceId] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: "Server is missing required configuration" });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: "Could not read request body" });
  }

  const signatureHeader = req.headers["stripe-signature"];
  const isValid = await verifyStripeSignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);

  if (!isValid) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const email = extractEmailFromSession(session) || (await getCustomerEmail(session.customer));
        const plan = await getPlanFromSubscription(session.subscription);

        if (email && plan) {
          await setUserPlanByEmail(email, plan);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId];
        const email = await getCustomerEmail(subscription.customer);

        if (email && plan && subscription.status === "active") {
          await setUserPlanByEmail(email, plan);
        }
        if (email && (subscription.status === "canceled" || subscription.status === "unpaid")) {
          await downgradeUserToFreeByEmail(email);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const email = await getCustomerEmail(subscription.customer);
        if (email) {
          await downgradeUserToFreeByEmail(email);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const email = invoice.customer_email || (await getCustomerEmail(invoice.customer));
        if (email) {
          await downgradeUserToFreeByEmail(email);
        }
        break;
      }

      default:
        // Unhandled event types are fine to ignore — Stripe sends many we don't need.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
