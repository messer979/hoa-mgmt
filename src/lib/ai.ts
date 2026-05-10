// OpenRouter wrapper for analyzing inbound emails. Returns a small,
// structured JSON blob the webhook stores on the emails row + the inbox
// page surfaces. Default model is Anthropic Claude Haiku 4.5 — fast, cheap,
// strong at structured output. Override with OPENROUTER_MODEL env.

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";

export type AIAnalysis = {
  topic_id: string | null;
  vote: "affirm" | "reject" | "abstain" | "none";
  confidence: number;
  summary: string;
  reasoning: string;
};

export type AnalysisInput = {
  email: { from: string; subject: string | null; body: string };
  currentTopic: { id: string; title: string; description: string | null } | null;
  thread: Array<{ author: string; body: string; date?: string }>;
  openTopics: Array<{ id: string; title: string; description: string | null }>;
};

const SYSTEM_PROMPT = `You analyze inbound emails for a small HOA board management app. You'll be given:
- The new inbound email (from, subject, body)
- The current topic the email was auto-threaded to (if any) and its conversation history
- All other open topics

Decide:
1. Which topic does this email belong to (or null if none fits / it's starting a new topic)
2. Is the sender casting a vote: "affirm", "reject", "abstain", or "none" (just discussing)
3. Confidence (0 to 1)
4. One-sentence summary
5. Brief reasoning

Return STRICT JSON with this exact schema and nothing else:
{
  "topic_id": "<uuid>" | null,
  "vote": "affirm" | "reject" | "abstain" | "none",
  "confidence": <number 0..1>,
  "summary": "<one short sentence>",
  "reasoning": "<one short paragraph>"
}

Vote guidance:
- "affirm" = supports the proposal (yes / approve / agree / in favor / aye)
- "reject" = opposes (no / disapprove / against / nay)
- "abstain" = explicitly abstains
- "none" = just discussing, asking, providing context — no vote

Be conservative. Use confidence >= 0.9 ONLY when the vote is unambiguous and the topic match is obvious. If the email is a question, request for info, or general comment, return vote="none".`;

export async function analyzeInboundEmail(
  input: AnalysisInput,
): Promise<AIAnalysis | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn("ai: OPENROUTER_API_KEY not set; skipping analysis");
    return null;
  }
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  // Trim body to keep token use sane. 8K chars covers a long email plus some
  // quoted history; the parser already extracted the structured pieces.
  const trimmedBody = input.email.body.length > 8000
    ? input.email.body.slice(0, 8000) + "\n\n[truncated]"
    : input.email.body;

  const userContent = JSON.stringify(
    {
      new_email: { ...input.email, body: trimmedBody },
      current_thread_topic: input.currentTopic,
      current_thread_messages: input.thread.slice(-30), // cap at 30 most recent
      other_open_topics: input.openTopics,
    },
    null,
    2,
  );

  const start = Date.now();
  try {
    const res = await fetch(OPENROUTER_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://hoa-mgmt",
        "X-Title": "HOA Board App",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_tokens: 600,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("ai: openrouter error", res.status, t.slice(0, 500));
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      console.error("ai: no content in response");
      return null;
    }

    const parsed = JSON.parse(content) as Partial<AIAnalysis>;
    const analysis: AIAnalysis = {
      topic_id:
        typeof parsed.topic_id === "string" && parsed.topic_id !== "null"
          ? parsed.topic_id
          : null,
      vote: (["affirm", "reject", "abstain", "none"] as const).includes(
        (parsed.vote ?? "none") as AIAnalysis["vote"],
      )
        ? (parsed.vote as AIAnalysis["vote"])
        : "none",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };

    console.log("ai: analyzed", {
      ms: Date.now() - start,
      model,
      vote: analysis.vote,
      confidence: analysis.confidence,
      tokens: json.usage,
    });
    return analysis;
  } catch (e) {
    console.error("ai: threw", e);
    return null;
  }
}

export function aiModelInUse(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}
