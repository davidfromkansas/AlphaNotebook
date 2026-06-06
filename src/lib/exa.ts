import Exa from "exa-js";
import { WasmPdfDocument } from "pdf-oxide-wasm/nodejs";

export interface ExaContent {
  title: string | null;
  author: string | null;
  text: string | null;
  url: string;
}

function getExaClient() {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY environment variable is not set");
  }
  return new Exa(apiKey);
}

function getGoogleDriveFileId(url: string): string | null {
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  return match ? match[1] : null;
}

function isTwitterUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname === "x.com" || hostname === "twitter.com";
  } catch {
    return false;
  }
}

function parseTweetUrl(
  url: string
): { username: string; tweetId: string } | null {
  const match = url.match(/(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/);
  return match ? { username: match[1], tweetId: match[2] } : null;
}

interface FxTweetAuthor {
  name: string;
  screen_name: string;
}

interface FxArticleBlock {
  text: string;
  type: string;
}

interface FxTweetArticle {
  title?: string;
  content?: { blocks: FxArticleBlock[] };
}

interface FxTweetData {
  text: string;
  author: FxTweetAuthor;
  created_at: string;
  article?: FxTweetArticle;
}

interface FxTweetResponse {
  code: number;
  tweet?: FxTweetData;
}

function extractArticleText(article: FxTweetArticle): string {
  if (!article.content?.blocks) return "";
  return article.content.blocks
    .map((block) => block.text)
    .filter((text) => text.length > 0)
    .join("\n\n");
}

async function extractTweetViaFxTwitter(url: string): Promise<ExaContent> {
  const parsed = parseTweetUrl(url);
  if (!parsed) throw new Error("Invalid X/Twitter URL format");

  const response = await fetch(
    `https://api.fxtwitter.com/${parsed.username}/status/${parsed.tweetId}`
  );

  if (!response.ok) {
    throw new Error(`FxTwitter API returned ${response.status}`);
  }

  const data = (await response.json()) as FxTweetResponse;
  const tweet = data.tweet;

  if (!tweet) {
    throw new Error("Could not extract post — it may be deleted or private");
  }

  let text = tweet.text || "";
  let title = `Post by @${tweet.author.screen_name}`;

  if (tweet.article) {
    const articleText = extractArticleText(tweet.article);
    if (articleText.length > 0) {
      text = articleText;
      title = tweet.article.title || `Article by @${tweet.author.screen_name}`;
    }
  }

  if (!text || text.length < 5) {
    throw new Error("Could not extract post — it may be deleted or private");
  }

  return {
    url,
    title,
    author: tweet.author.name || tweet.author.screen_name || null,
    text,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "\u2014")
    .trim();
}

async function extractTweetViaOembed(url: string): Promise<ExaContent> {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
  const response = await fetch(oembedUrl);

  if (!response.ok) {
    throw new Error("Could not extract post — it may be deleted or private");
  }

  const data = (await response.json()) as {
    url: string;
    author_name: string;
    html: string;
  };
  const text = stripHtml(data.html);

  if (!text || text.length < 10) {
    throw new Error("Could not extract post — it may be deleted or private");
  }

  return {
    url: data.url || url,
    title: `Post by @${data.author_name}`,
    author: data.author_name || null,
    text,
  };
}

async function extractTweetContent(url: string): Promise<ExaContent> {
  try {
    return await extractTweetViaFxTwitter(url);
  } catch {
    return extractTweetViaOembed(url);
  }
}

export function parsePdfBuffer(buffer: Buffer): string {
  const doc = new WasmPdfDocument(new Uint8Array(buffer));
  const markdown = doc.toMarkdownAll();
  doc.free();
  return markdown;
}

async function extractPdfFromUrl(downloadUrl: string): Promise<string> {
  const res = await fetch(downloadUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download PDF: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return parsePdfBuffer(buffer);
}

export async function extractContent(url: string): Promise<ExaContent> {
  // Handle Google Drive PDF links directly
  const driveFileId = getGoogleDriveFileId(url);
  if (driveFileId) {
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
    const text = await extractPdfFromUrl(downloadUrl);
    return {
      title: null,
      author: null,
      text,
      url,
    };
  }

  // Handle X/Twitter URLs via FxTwitter + oEmbed fallback
  if (isTwitterUrl(url)) {
    return extractTweetContent(url);
  }

  // Default: use Exa for regular web URLs
  const exa = getExaClient();
  const result = await exa.getContents([url], {
    text: true,
  });

  const page = result.results[0];
  if (!page) {
    throw new Error("No content returned from Exa");
  }

  return {
    title: page.title || null,
    author: page.author || null,
    text: page.text || null,
    url: page.url,
  };
}
