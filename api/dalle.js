export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  try {
    const { prompt } = req.body;

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENAI_KEY
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        quality: "medium"
      })
    });

    const data = await response.json();
    let url = null;
    if (data.data && data.data[0]) {
      if (data.data[0].url) {
        url = data.data[0].url;
      } else if (data.data[0].b64_json) {
        url = "data:image/png;base64," + data.data[0].b64_json;
      }
    }

    return res.status(200).json({ url, error: data.error ? data.error.message : null });
  } catch (err) {
    return res.status(500).json({ error: err.message, url: null });
  }
}
