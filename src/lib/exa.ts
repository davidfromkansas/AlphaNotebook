import Exa from "exa-js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require("pdf-parse/lib/pdf-parse");

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

async function extractPdfFromUrl(downloadUrl: string): Promise<string> {
  const res = await fetch(downloadUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download PDF: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const data = await pdf(buffer);
  return data.text;
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
