const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FREE_LIMIT = 3;

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
      // Check current usage/status for an email, creating the user row if needed
      const email = (req.query && req.query.email || "").toLowerCase().trim();
      if (!email) return res.status(400).json({ error: "Missing email" });

      const user = await getOrCreateUser(email);
      const isPaid = user.plan === "starter" || user.plan === "pro";
      const allowed = isPaid || user.posts_used < FREE_LIMIT;

      return res.status(200).json({
        email: user.email,
        postsUsed: user.posts_used,
        plan: user.plan,
        freeLimit: FREE_LIMIT,
        allowed
      });
    }

    if (req.method === "POST") {
      // Increment post usage for an email, but only if still allowed
      const { email } = req.body || {};
      const normalizedEmail = (email || "").toLowerCase().trim();
      if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });

      const user = await getOrCreateUser(normalizedEmail);
      const isPaid = user.plan === "starter" || user.plan === "pro";

      if (!isPaid && user.posts_used >= FREE_LIMIT) {
        return res.status(403).json({ error: "Free limit reached", allowed: false, postsUsed: user.posts_used, plan: user.plan });
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
        allowed: true
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
