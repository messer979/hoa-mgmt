// Cheap HTML→text fallback for emails that arrive HTML-only (e.g. Gmail's
// default). Not a full HTML renderer — just enough to keep the conversation
// readable. Strips scripts/styles, converts block tags + <br> to newlines,
// and decodes a handful of common entities.
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type QuotedSegment = {
  author_name: string | null;
  author_email: string | null;
  body: string;
  date: string | null; // ISO timestamp if we could parse one
};

type Marker = {
  index: number;
  length: number;
  author_name: string | null;
  author_email: string | null;
  date: string | null;
};

// Apple Mail / iOS / Gmail "On <date>, <name> wrote:" attribution lines.
// Optionally followed by `<email>` and accepting weird whitespace / newlines.
const ON_WROTE_RE =
  /^[ \t>]*On\s+([^\n]{4,160}?)(?:\s*[,\n])\s*([^<\n]+?)?\s*(?:<([^>\n]+)>)?\s+wrote\s*:\s*$/gim;

// Outlook block:
//   From: Name <addr>
//   Sent: <date>
//   To: ...
//   Subject: ...
const OUTLOOK_RE =
  /^[ \t>]*From:\s*([^<\n]+?)\s*(?:<([^>\n]+)>)?\s*\r?\n[ \t>]*Sent:\s*([^\n]+)\r?\n(?:[ \t>]*To:[^\n]*\r?\n)?(?:[ \t>]*Cc:[^\n]*\r?\n)?[ \t>]*Subject:\s*[^\n]*\r?\n+/gim;

function parseDateLoose(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, " ").trim();
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

function dequote(s: string): string {
  return s
    .split("\n")
    .map((line) => line.replace(/^\s*>+\s?/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split a body into the new content + an oldest-first list of historical
// segments parsed from the quoted-reply markers. Best-effort — falls through
// to "no history" if the body doesn't contain recognizable markers.
export function parseQuotedHistory(
  text: string | null | undefined,
): { newContent: string; history: QuotedSegment[] } {
  if (!text) return { newContent: "", history: [] };

  const markers: Marker[] = [];

  for (const m of text.matchAll(ON_WROTE_RE)) {
    if (m.index === undefined) continue;
    markers.push({
      index: m.index,
      length: m[0].length,
      author_name: (m[2] ?? "").trim() || null,
      author_email: (m[3] ?? "").trim().toLowerCase() || null,
      date: parseDateLoose(m[1]),
    });
  }
  for (const m of text.matchAll(OUTLOOK_RE)) {
    if (m.index === undefined) continue;
    markers.push({
      index: m.index,
      length: m[0].length,
      author_name: (m[1] ?? "").trim() || null,
      author_email: (m[2] ?? "").trim().toLowerCase() || null,
      date: parseDateLoose(m[3]),
    });
  }

  if (markers.length === 0) {
    return { newContent: stripQuotedReply(text), history: [] };
  }

  markers.sort((a, b) => a.index - b.index);
  const newContent = stripQuotedReply(text.slice(0, markers[0].index));

  const segments: QuotedSegment[] = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const start = m.index + m.length;
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    const body = dequote(text.slice(start, end));
    if (!body) continue;
    segments.push({
      author_name: m.author_name,
      author_email: m.author_email,
      body,
      date: m.date,
    });
  }

  // Quoted bodies stack newest-on-top; flip so callers can write
  // oldest-first conversation rows.
  segments.reverse();

  return { newContent, history: segments };
}

// Strip the "On X wrote:" / "-----Original Message-----" tail and quoted (>)
// lines from a reply so the conversation view shows only the new content.
export function stripQuotedReply(text: string | null | undefined): string {
  if (!text) return "";

  const markers: RegExp[] = [
    /\n\s*on .+ wrote:/i,
    /\n\s*-----original message-----/i,
    /\n\s*from:\s.+\n\s*sent:\s/i,
    /\n\s*________________________________/, // outlook divider
    /\n--\s*\n/, // sig delimiter
  ];

  let cutoff = text.length;
  for (const m of markers) {
    const match = text.match(m);
    if (match && match.index !== undefined && match.index < cutoff) {
      cutoff = match.index;
    }
  }

  const head = text.slice(0, cutoff);
  const cleaned = head
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}
