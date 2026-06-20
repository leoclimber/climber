const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Server is missing Supabase configuration" });
  }

  try {
    if (req.method === "POST") {
      // Save a generated piece of content to history
      const { email, feature, title, content } = req.body || {};
      const normalizedEmail = (email || "").toLowerCase().trim();
      if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });
      if (!feature) return res.status(400).json({ error: "Missing feature" });
      if (!content) return res.status(400).json({ error: "Missing content" });

      const saved = await sb("content_history", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          feature,
          title: title || null,
          content
        })
      });

      if (!saved.ok) {
        return res.status(500).json({ error: "Could not save to history" });
      }

      return res.status(200).json({ success: true, item: saved.data[0] });
    }

    if (req.method === "GET") {
      // Fetch history for an email, optionally filtered by feature
      const email = (req.query && req.query.email || "").toLowerCase().trim();
      const feature = req.query && req.query.feature;
      const limit = (req.query && req.query.limit) || 50;
      if (!email) return res.status(400).json({ error: "Missing email" });

      let path = "content_history?email=eq." + encodeURIComponent(email) +
        "&select=*&order=created_at.desc&limit=" + encodeURIComponent(limit);
      if (feature) {
        path += "&feature=eq." + encodeURIComponent(feature);
      }

      const result = await sb(path);
      if (!result.ok) {
        return res.status(500).json({ error: "Could not fetch history" });
      }

      return res.status(200).json({ items: result.data || [] });
    }

    if (req.method === "DELETE") {
      // Delete a single history item by id (must belong to the given email)
      const { id, email } = req.body || {};
      const normalizedEmail = (email || "").toLowerCase().trim();
      if (!id) return res.status(400).json({ error: "Missing id" });
      if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });

      const result = await sb(
        "content_history?id=eq." + encodeURIComponent(id) + "&email=eq." + encodeURIComponent(normalizedEmail),
        { method: "DELETE" }
      );

      if (!result.ok) {
        return res.status(500).json({ error: "Could not delete item" });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
