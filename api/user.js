const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

// Free plan: separate one-time trial allowances per feature.
const FREE_LIMITS = { create: 3, calendar: 1, promo: 1 };

// Paid plan monthly limits. Only "create" applies to Starter — Starter has
// no access to calendar/promo at all (see PRO_ONLY_FEATURES below).
const PLAN_LIMITS = {
  starter: { create: 50 },
  pro: { create: 100, calendar: 15, promo: 60, inspiration: 40 }
};

// Features that Starter cannot access under any circumstance (Free can
// still demo them once each; Pro has full access).
const PRO_ONLY_FEATURES = ["calendar", "promo", "inspiration"];

// Maps a feature name to the DB column that tracks its usage count.
const FEATURE_COLUMNS = { create: "posts_used", calendar: "calendar_used", promo: "promo_used", inspiration: "inspiration_used" };

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
    body: JSON.stringify({ email, posts_used: 0, calendar_used: 0, promo_used: 0, inspiration_used: 0, plan: "free" })
  });
  if (created.ok && created.data && created.data.length > 0) {
    return created.data[0];
  }
  throw new Error("Could not create or fetch user");
}

// For paid plans, resets all usage counters back to 0 every 30 days from
// cycle_start. Free plan never resets (each trial allowance is one-time).
async function applyMonthlyResetIfNeeded(user) {
  const isPaid = user.plan === "starter" || user.plan === "pro";
  if (!isPaid) return user;

  const now = new Date();
  const cycleStart = user.cycle_start ? new Date(user.cycle_start) : null;

  if (!cycleStart || (now.getTime() - cycleStart.getTime()) >= MS_30_DAYS) {
    const updated = await sb("users?email=eq." + encodeURIComponent(user.email), {
      method: "PATCH",
      body: JSON.stringify({ posts_used: 0, calendar_used: 0, promo_used: 0, inspiration_used: 0, cycle_start: now.toISOString() })
    });
    if (updated.ok && updated.data && updated.data.length > 0) {
      return updated.data[0];
    }
  }
  return user;
}

function getUsedCount(user, feature) {
  const col = FEATURE_COLUMNS[feature] || "posts_used";
  return user[col] || 0;
}

function getLimitForFeature(user, feature) {
  const isFree = user.plan !== "starter" && user.plan !== "pro";
  if (isFree) {
    return FREE_LIMITS[feature] !== undefined ? FREE_LIMITS[feature] : 0;
  }
  const planLimits = PLAN_LIMITS[user.plan] || {};
  return planLimits[feature] !== undefined ? planLimits[feature] : 0;
}

// Decide whether a given feature is allowed for this user.
// Returns { allowed, reason } where reason is
// "blocked" | "free_limit" | "pro_required" | "plan_limit" | null.
function checkFeatureAccess(user, feature) {
  if (user.blocked) {
    return { allowed: false, reason: "blocked" };
  }

  const isFree = user.plan !== "starter" && user.plan !== "pro";
  const isStarter = user.plan === "starter";
  const isProOnlyFeature = PRO_ONLY_FEATURES.includes(feature);

  if (isFree) {
    // Free plan: each feature has its own one-time trial allowance.
    const used = getUsedCount(user, feature);
    const limit = getLimitForFeature(user, feature);
    if (used >= limit) {
      return { allowed: false, reason: "free_limit" };
    }
    return { allowed: true, reason: null };
  }

  if (isStarter && isProOnlyFeature) {
    // Starter never gets calendar/promo/inspiration, regardless of usage count.
    return { allowed: false, reason: "pro_required" };
  }

  // Starter using "create", or Pro using anything: governed by plan limit.
  const used = getUsedCount(user, feature);
  const limit = getLimitForFeature(user, feature);
  if (used >= limit) {
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
      // ?feature= lets the frontend ask "can I use this specific tab?" (defaults to "create")
      const email = (req.query && req.query.email || "").toLowerCase().trim();
      const feature = (req.query && req.query.feature || "create").toLowerCase().trim();
      if (!email) return res.status(400).json({ error: "Missing email" });

      const user = await applyMonthlyResetIfNeeded(await getOrCreateUser(email));
      const access = checkFeatureAccess(user, feature);
      const limit = getLimitForFeature(user, feature);

      return res.status(200).json({
        email: user.email,
        postsUsed: user.posts_used,
        calendarUsed: user.calendar_used,
        promoUsed: user.promo_used,
        inspirationUsed: user.inspiration_used,
        plan: user.plan,
        featureLimit: limit,
        blocked: !!user.blocked,
        allowed: access.allowed,
        reason: access.reason
      });
    }

    if (req.method === "POST") {
      // Increment usage for an email on a specific feature, but only if still allowed
      const { email, feature: rawFeature } = req.body || {};
      const normalizedEmail = (email || "").toLowerCase().trim();
      const feature = (rawFeature || "create").toLowerCase().trim();
      if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });

      const user = await applyMonthlyResetIfNeeded(await getOrCreateUser(normalizedEmail));
      const access = checkFeatureAccess(user, feature);

      if (!access.allowed) {
        const errorMessages = {
          blocked: "Access blocked",
          free_limit: "Free trial limit reached for this feature",
          pro_required: "This feature requires the Pro plan",
          plan_limit: "Plan limit reached"
        };
        return res.status(403).json({
          error: errorMessages[access.reason] || "Not allowed",
          allowed: false,
          blocked: access.reason === "blocked",
          reason: access.reason,
          postsUsed: user.posts_used,
          calendarUsed: user.calendar_used,
          promoUsed: user.promo_used,
          inspirationUsed: user.inspiration_used,
          plan: user.plan
        });
      }

      const column = FEATURE_COLUMNS[feature] || "posts_used";
      const newCount = getUsedCount(user, feature) + 1;
      const updated = await sb("users?email=eq." + encodeURIComponent(normalizedEmail), {
        method: "PATCH",
        body: JSON.stringify({ [column]: newCount })
      });

      if (!updated.ok) {
        return res.status(500).json({ error: "Could not update usage" });
      }

      const updatedUser = updated.data[0];

      return res.status(200).json({
        email: normalizedEmail,
        postsUsed: updatedUser.posts_used,
        calendarUsed: updatedUser.calendar_used,
        promoUsed: updatedUser.promo_used,
        inspirationUsed: updatedUser.inspiration_used,
        plan: user.plan,
        featureLimit: getLimitForFeature(user, feature),
        blocked: false,
        allowed: true
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
