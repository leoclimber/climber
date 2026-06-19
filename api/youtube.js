export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  try {
    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

    if (isYouTube) {
      const videoId = extractYouTubeId(url);
      if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

      const transcript = await getYouTubeTranscript(videoId);
      return res.status(200).json({ content: transcript, type: "youtube" });
    } else {
      const articleText = await getArticleText(url);
      return res.status(200).json({ content: articleText, type: "article" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || "Failed to extract content" });
  }
}

function extractYouTubeId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function getYouTubeTranscript(videoId) {
  // Fetch the YouTube page to get captions
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const html = await pageRes.text();

  // Extract video title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(" - YouTube", "").trim() : "YouTube Video";

  // Find captions URL from page source
  const captionMatch = html.match(/"captionTracks":\s*\[{"baseUrl":"([^"]+)"/);

  if (!captionMatch) {
    // No captions available — return title and description only
    const descMatch = html.match(/"shortDescription":"([^"]{0,500})"/);
    const desc = descMatch ? descMatch[1].replace(/\\n/g, " ").replace(/\\"/g, '"') : "";
    return `Title: ${title}\n\nDescription: ${desc}\n\nNote: No captions available for this video.`;
  }

  const captionUrl = captionMatch[1].replace(/\\u0026/g, "&");
  const captionRes = await fetch(captionUrl);
  const captionXml = await captionRes.text();

  // Parse XML captions
  const texts = [];
  const regex = /<text[^>]*>([^<]+)<\/text>/g;
  let match;
  while ((match = regex.exec(captionXml)) !== null) {
    const text = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (text) texts.push(text);
  }

  const transcript = texts.join(" ").substring(0, 4000);
  return `Title: ${title}\n\nTranscript:\n${transcript}`;
}

async function getArticleText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
  });

  const html = await res.text();

  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : "Article";

  // Remove scripts, styles, nav, footer, header
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const text = cleaned.substring(0, 4000);
  return `Title: ${title}\n\nContent:\n${text}`;
}
