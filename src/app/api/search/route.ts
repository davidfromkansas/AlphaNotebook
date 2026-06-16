import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchLinks, type ExaSearchResult } from "@/lib/exa";
import { completeChat } from "@/lib/llm";

interface SuggestedMeta {
  title: string;
  description: string;
}

/**
 * Ask the LLM for a concise collection title + description based on the user's
 * query and the discovered results. Falls back to the raw query on any error.
 */
async function suggestMeta(
  query: string,
  results: ExaSearchResult[]
): Promise<SuggestedMeta> {
  const fallback: SuggestedMeta = {
    title: query.trim().slice(0, 80),
    description: `Sources related to “${query.trim()}”.`.slice(0, 160),
  };

  try {
    const resultLines = results
      .slice(0, 10)
      .map((r) => `- ${r.title ?? r.url}${r.summary ? `: ${r.summary}` : ""}`)
      .join("\n");

    const raw = await completeChat({
      temperature: 0.3,
      // Gemini charges its (fixed 1024-token) thinking budget against the
      // output budget, so a small cap would starve the actual JSON and return
      // empty text. Give plenty of headroom for the short title + description.
      maxOutputTokens: 2048,
      messages: [
        {
          role: "system",
          content:
            "You name research collections. Given a user's learning goal and a list of web sources, respond with STRICT JSON only (no markdown, no code fences) of the form {\"title\": string, \"description\": string}. The title is a short, specific label (max 6 words). The description is one sentence (max 160 chars) summarizing what the collection covers.",
        },
        {
          role: "user",
          content: `Learning goal: "${query}"\n\nSources:\n${resultLines}`,
        },
      ],
    });

    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<SuggestedMeta>;
    return {
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim().slice(0, 80)
          : fallback.title,
      description:
        typeof parsed.description === "string" && parsed.description.trim()
          ? parsed.description.trim().slice(0, 160)
          : fallback.description,
    };
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { query?: unknown; numResults?: unknown; skipMeta?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  const numResults =
    typeof body.numResults === "number" &&
    body.numResults >= 1 &&
    body.numResults <= 30
      ? body.numResults
      : 15;
  const skipMeta = body.skipMeta === true;

  let results: ExaSearchResult[];
  try {
    results = await searchLinks(query, numResults);
  } catch (err) {
    console.error("[search] Exa search failed:", err);
    return NextResponse.json(
      { error: "Search failed. Please try again." },
      { status: 502 }
    );
  }

  if (skipMeta) {
    return NextResponse.json({
      query,
      suggestedTitle: "",
      suggestedDescription: "",
      results,
    });
  }

  const meta = await suggestMeta(query, results);

  return NextResponse.json({
    query,
    suggestedTitle: meta.title,
    suggestedDescription: meta.description,
    results,
  });
}
