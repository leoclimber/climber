const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_SECRET) {
    return res.status(500).json({ error: "Server is missing required configuration" });
  }

  // Auth: require the admin secret via header or query param
  const provided = req.headers["x-admin-secret"] || (req.query && req.query.secret);
  if (provided !== ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Pull all users
    const usersRes = await sb("users?select=*&order=cycle_start.desc.nullslast");
    const users = (usersRes.ok && usersRes.data) ? usersRes.data : [];

    // Pull total history count per user is expensive; instead get overall counts
    const historyRes = await sb("content_history?select=email,feature,created_at&order=created_at.desc&limit=500");
    const history = (historyRes.ok && historyRes.data) ? historyRes.data : [];

    // Aggregate stats
    const paidUsers = users.filter(u => u.plan === "starter" || u.plan === "pro");
    const stats = {
      totalUsers: users.length,
      freeUsers: users.filter(u => u.plan !== "starter" && u.plan !== "pro").length,
      starterUsers: users.filter(u => u.plan === "starter").length,
      proUsers: users.filter(u => u.plan === "pro").length,
      blockedUsers: users.filter(u => u.blocked).length,
      // Rough monthly revenue estimate in EUR
      estimatedMrr: users.filter(u => u.plan === "starter").length * 19 + users.filter(u => u.plan === "pro").length * 39
    };

    // Count generations per email from recent history sample
    const genCounts = {};
    for (const h of history) {
      genCounts[h.email] = (genCounts[h.email] || 0) + 1;
    }

    const enrichedUsers = users.map(u => ({
      email: u.email,
      plan: u.plan || "free",
      postsUsed: u.posts_used || 0,
      calendarUsed: u.calendar_used || 0,
      promoUsed: u.promo_used || 0,
      inspirationUsed: u.inspiration_used || 0,
      blocked: !!u.blocked,
      cycleStart: u.cycle_start || null,
      recentGenerations: genCounts[u.email] || 0
    }));

    return res.status(200).json({ stats, users: enrichedUsers });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
