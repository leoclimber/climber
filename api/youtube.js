export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  try {
    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

    if (isYouTube) {
      const videoId = extractYouTubeId(url);
      if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

      const content = await getYouTubeContent(videoId);
      return res.status(200).json({ content, type: "youtube" });
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

async function getYouTubeContent(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YouTube API key not configured");

  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`;
  const res = await fetch(apiUrl);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.message || "YouTube API error");
  }

  if (!data.items || data.items.length === 0) {
    throw new Error("Video not found or unavailable");
  }

  const video = data.items[0];
  const snippet = video.snippet;

  const title = snippet.title || "";
  const description = snippet.description || "";
  const channelTitle = snippet.channelTitle || "";
  const tags = snippet.tags ? snippet.tags.join(", ") : "";

  if (!title && !description) {
    throw new Error("No content available for this video");
  }

  let content = `Video Title: ${title}\n\nChannel: ${channelTitle}\n\n`;
  if (description) {
    content += `Description: ${description.substring(0, 2000)}\n\n`;
  }
  if (tags) {
    content += `Tags: ${tags}\n\n`;
  }

  return content;
}

async function getArticleText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
  });

  const html = await res.text();

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : "Article";

  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 50) {
    throw new Error("Could not extract readable content from this page");
  }

  const text = cleaned.substring(0, 4000);
  return `Title: ${title}\n\nContent:\n${text}`;
}
