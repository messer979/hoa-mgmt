// OpenRouter wrapper for analyzing inbound emails. Uses tool calling with a
// strict JSON schema so the model's output shape is enforced rather than
// hoped-for. Default model is Anthropic Claude Haiku 4.5.
//
// Schema (function "analyze_email" arguments):
//   topic_id    : string | null   — uuid of the topic the email belongs to
//   vote        : "affirm" | "reject" | "abstain" | "none"
//   confidence  : number 0..1
//   summary     : string          — one sentence
//   reasoning   : string          — short paragraph explaining the choices

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

const SYSTEM_PROMPT = `You analyze inbound emails for a small HOA board management app.

You'll receive a JSON payload with:
- new_email: the incoming email (from, subject, body)
- current_thread_topic: the topic the email was auto-threaded to (or null)
- current_thread_messages: oldest→newest conversation history for that topic
- other_open_topics: every other open topic the email could plausibly belong to

Decide:
1. Which topic does the new email belong to? Use current_thread_topic.id
   when the email genuinely continues that conversation. Use a different
   topic.id from other_open_topics when the email better fits there.
   Use null when none fit (the email starts a new topic).
2. Is the sender casting a vote: "affirm", "reject", "abstain", or "none"?
3. Confidence (0..1).
4. One-sentence summary.
5. Brief reasoning.

Vote guidance:
- "affirm" = supports the proposal (yes / approve / agree / in favor / aye)
- "reject" = opposes (no / disapprove / against / nay)
- "abstain" = explicitly abstains
- "none" = just discussing, asking, providing context — no vote

Be conservative. confidence >= 0.9 ONLY when the vote is unambiguous AND the
topic match is obvious. If the email is a question, request for info, or
general comment, return vote="none". If the email is the start of a brand
new discussion not covered by any open topic, return topic_id=null.

Call the analyze_email tool with your decision. Do not return any prose.`;

const ANALYZE_TOOL = {
  type: "function" as const,
  function: {
    name: "analyze_email",
    description: "Record the structured analysis of one inbound email.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["topic_id", "vote", "confidence", "summary", "reasoning"],
      properties: {
        topic_id: {
          type: ["string", "null"],
          description:
            "uuid of the topic this email belongs to, or null if it starts a new topic",
        },
        vote: {
          type: "string",
          enum: ["affirm", "reject", "abstain", "none"],
          description: "the sender's vote intent on the topic, or 'none'",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "your confidence (0..1) in the topic + vote decisions",
        },
        summary: {
          type: "string",
          description: "one-sentence summary of what the sender is communicating",
        },
        reasoning: {
          type: "string",
          description: "brief explanation of why you chose this topic and vote",
        },
      },
    },
  },
};

export async function analyzeInboundEmail(
  input: AnalysisInput,
): Promise<{ analysis: AIAnalysis | null; payload: AnalysisInput }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  // Always return the payload we built so the caller can persist it for
  // /inbox/[id] transparency, even when the call is skipped or fails.
  if (!apiKey) {
    console.warn("ai: OPENROUTER_API_KEY not set; skipping analysis");
    return { analysis: null, payload: input };
  }
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  // Trim each body to keep token use predictable; cap thread at 100 to bound
  // worst-case context size (HOA threads are small in practice).
  const trimBody = (s: string) =>
    s.length > 8000 ? s.slice(0, 8000) + "\n\n[truncated]" : s;
  const trimmedInput: AnalysisInput = {
    ...input,
    email: { ...input.email, body: trimBody(input.email.body) },
    thread: input.thread.slice(-100).map((m) => ({ ...m, body: trimBody(m.body) })),
  };
  const userContent = JSON.stringify(trimmedInput, null, 2);

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
        tools: [ANALYZE_TOOL],
        tool_choice: {
          type: "function",
          function: { name: "analyze_email" },
        },
        temperature: 0.1,
        max_tokens: 600,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("ai: openrouter error", res.status, t.slice(0, 500));
      return { analysis: null, payload: trimmedInput };
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function?: { name?: string; arguments?: string };
          }>;
          content?: string;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    let raw = toolCall?.function?.arguments;
    if (!raw && json.choices?.[0]?.message?.content) {
      // Some models drop tool_calls and reply with plain JSON; tolerate that.
      raw = json.choices[0].message.content;
    }
    if (!raw) {
      console.error("ai: no tool_call or content in response");
      return { analysis: null, payload: trimmedInput };
    }

    const parsed = JSON.parse(raw) as Partial<AIAnalysis>;
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
    return { analysis, payload: trimmedInput };
  } catch (e) {
    console.error("ai: threw", e);
    return { analysis: null, payload: trimmedInput };
  }
}

export function aiModelInUse(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}
