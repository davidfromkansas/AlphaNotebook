import Exa from "exa-js";

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

export async function extractContent(url: string): Promise<ExaContent> {
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
