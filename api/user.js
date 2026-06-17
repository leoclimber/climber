const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FREE_LIMIT = 3;
const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;
const PLAN_LIMITS = { starter: 50, pro: 300 };

// Features that require a Pro plan — Starter users can only use "create".
const PRO_ONLY_FEATURES = ["calendar", "promo"];

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

async function getOrCreateUser(email) {
  const existing = await sb("users?email=eq." + encodeURIComponent(email) + "&select=*");
  if (existing.ok && existing.data && existing.data.length > 0) {
    return existing.data[0];
  }
  const created = await sb("users", {
    method: "POST",
    body: JSON.stringify({ email, posts_used: 0, plan: "free" })
  });
  if (created.ok && created.data && created.data.length > 0) {
    return created.data[0];
  }
  throw new Error("Could not create or fetch user");
}

// For paid plans, resets posts_used back to 0 every 30 days from cycle_start.
// Free plan never resets (3 posts is a one-time trial).
async function applyMonthlyResetIfNeeded(user) {
  const isPaid = user.plan === "starter" || user.plan === "pro";
  if (!isPaid) return user;

  const now = new Date();
  const cycleStart = user.cycle_start ? new Date(user.cycle_start) : null;

  if (!cycleStart || (now.getTime() - cycleStart.getTime()) >= MS_30_DAYS) {
    const updated = await sb("users?email=eq." + encodeURIComponent(user.email), {
      method: "PATCH",
      body: JSON.stringify({ posts_used: 0, cycle_start: now.toISOString() })
    });
    if (updated.ok && updated.data && updated.data.length > 0) {
      return updated.data[0];
    }
  }
  return user;
}

// Decide whether a given feature is allowed for this user, independent of
// the free-trial post counter. Returns { allowed, reason } where reason is
// "blocked" | "free_limit" | "pro_required" | null.
function checkFeatureAccess(user, feature, limit) {
  if (user.blocked) {
    return { allowed: false, reason: "blocked" };
  }

  const isFree = user.plan !== "starter" && user.plan !== "pro";
  const isStarter = user.plan === "starter";
  const isProOnlyFeature = PRO_ONLY_FEATURES.includes(feature);

  if (isFree) {
    // Free plan: every feature shares the same 3-use trial bucket.
    if (user.posts_used >= FREE_LIMIT) {
      return { allowed: false, reason: "free_limit" };
    }
    return { allowed: true, reason: null };
  }

  if (isStarter && isProOnlyFeature) {
    // Starter can't use Calendar/Promo at all, regardless of usage count.
    return { allowed: false, reason: "pro_required" };
  }

  // Starter using "create", or Pro using anything: governed by plan limit.
  if (user.posts_used >= limit) {
    return { allowed: false, reason: "plan_limit" };
  }
  return { allowed: true, reason: null };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Server is missing Supabase configuration" });
  }

  try {
    if (req.method === "GET") {
      // Check current usage/status for an email, creating the user row if needed.
      // Optional ?feature= lets the frontend ask "can I use this specific tab?"
      const email = (req.query && req.query.email || "").toLowerCase().trim();
      const feature = (req.query && req.query.feature || "create").toLowerCase().trim();
      if (!email) return res.status(400).json({ error: "Missing email" });

      const user = await applyMonthlyResetIfNeeded(await getOrCreateUser(email));
      const isPaid = user.plan === "starter" || user.plan === "pro";
      const limit = isPaid ? PLAN_LIMITS[user.plan] : FREE_LIMIT;
      const access = checkFeatureAccess(user, feature, limit);

      return res.status(200).json({
        email: user.email,
        postsUsed: user.posts_used,
        plan: user.plan,
        freeLimit: FREE_LIMIT,
        planLimit: limit === Infinity ? null : limit,
        blocked: !!user.blocked,
        allowed: access.allowed,
        reason: access.reason
      });
    }

    if (req.method === "POST") {
      // Increment post usage for an email, but only if still allowed for this feature
      const { email, feature: rawFeature } = req.body || {};
      const normalizedEmail = (email || "").toLowerCase().trim();
      const feature = (rawFeature || "create").toLowerCase().trim();
      if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });

      const user = await applyMonthlyResetIfNeeded(await getOrCreateUser(normalizedEmail));
      const isPaid = user.plan === "starter" || user.plan === "pro";
      const limit = isPaid ? PLAN_LIMITS[user.plan] : FREE_LIMIT;
      const access = checkFeatureAccess(user, feature, limit);

      if (!access.allowed) {
        const errorMessages = {
          blocked: "Access blocked",
          free_limit: "Free limit reached",
          pro_required: "This feature requires the Pro plan",
          plan_limit: "Plan limit reached"
        };
        return res.status(403).json({
          error: errorMessages[access.reason] || "Not allowed",
          allowed: false,
          blocked: access.reason === "blocked",
          reason: access.reason,
          postsUsed: user.posts_used,
          plan: user.plan
        });
      }

      const newCount = user.posts_used + 1;
      const updated = await sb("users?email=eq." + encodeURIComponent(normalizedEmail), {
        method: "PATCH",
        body: JSON.stringify({ posts_used: newCount })
      });

      if (!updated.ok) {
        return res.status(500).json({ error: "Could not update usage" });
      }

      return res.status(200).json({
        email: normalizedEmail,
        postsUsed: newCount,
        plan: user.plan,
        freeLimit: FREE_LIMIT,
        planLimit: limit === Infinity ? null : limit,
        blocked: false,
        allowed: true
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
