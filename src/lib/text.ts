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

// Long attribution lines often wrap before "wrote:". Pre-join them so the
// single-line regex below can find every attribution. Also normalizes weird
// whitespace from HTML-derived text.
function unwrapAttributions(text: string): string {
  return text
    .replace(/(<[^>\n]+>|[A-Za-z][^\n<]*)\s*\r?\n[ \t>]*wrote\s*:/gi, "$1 wrote:")
    .replace(/[ \t]+\n/g, "\n");
}

// "On <date>, <name> [<email>] wrote:" attribution. Two patterns: with-email
// (anchored on <addr> so date can't bleed into the name capture) and
// without-email (name is one or more capitalized words right before "wrote:").
const ON_WROTE_WITH_EMAIL_RE =
  /^[ \t>]*On\s+(.+?)[,\s]\s*([^<\n]*?)\s*<([^>\n]+)>\s+wrote\s*:\s*$/gim;
const ON_WROTE_NO_EMAIL_RE =
  /^[ \t>]*On\s+(.+?)[,\s]\s*([A-Z][\w'.\-]*(?:\s+[A-Z][\w'.\-]*){0,5})\s+wrote\s*:\s*$/gim;

// "From: ... Sent|Date: ... [To: ...] [Cc: ...] [Subject: ...]" header block.
// Outlook uses Sent; Apple/Gmail use Date. Subject/To/Cc are all optional —
// some clients omit them when forwarding.
const OUTLOOK_RE =
  /^[ \t>]*From:\s*([^<\n]+?)\s*(?:<([^>\n]+)>)?\s*\r?\n[ \t>]*(?:Sent|Date):\s*([^\n]+)\r?\n(?:[ \t>]*(?:To|Cc|Reply-To|Subject):[^\n]*\r?\n){0,4}/gim;

// Gmail's "---------- Forwarded message ---------" wrapper. We treat the
// block as a segment break and pull From/Date out of its header.
const FORWARDED_RE =
  /^[ \t>]*-{2,}\s*(?:Forwarded message|Original Message)\s*-{2,}\s*\r?\n((?:[ \t>]*[A-Za-z][A-Za-z-]+:\s*[^\n]+\r?\n){1,6})/gim;

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

function readHeaders(block: string): {
  from_name: string | null;
  from_email: string | null;
  date: string | null;
} {
  const headers: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^[ \t>]*([A-Za-z][A-Za-z-]+):\s*(.+?)\s*$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  let name: string | null = null;
  let email: string | null = null;
  if (headers.from) {
    const f = headers.from.match(/^(.*?)\s*<([^>]+)>/);
    if (f) {
      name = (f[1] || "").trim() || null;
      email = f[2].trim().toLowerCase();
    } else {
      const e = headers.from.match(/[^\s<>"']+@[^\s<>"']+/);
      email = e ? e[0].trim().toLowerCase() : null;
      name = headers.from.replace(/[<>]/g, "").trim() || null;
    }
  }
  return { from_name: name, from_email: email, date: parseDateLoose(headers.date ?? headers.sent ?? null) };
}

// Split a body into the new content + an oldest-first list of historical
// segments parsed from the quoted-reply markers. Best-effort — falls through
// to "no history" if the body doesn't contain recognizable markers.
export function parseQuotedHistory(
  text: string | null | undefined,
): { newContent: string; history: QuotedSegment[] } {
  if (!text) return { newContent: "", history: [] };
  const src = unwrapAttributions(text);

  const markers: Marker[] = [];

  for (const m of src.matchAll(ON_WROTE_WITH_EMAIL_RE)) {
    if (m.index === undefined) continue;
    markers.push({
      index: m.index,
      length: m[0].length,
      author_name: (m[2] ?? "").trim() || null,
      author_email: (m[3] ?? "").trim().toLowerCase() || null,
      date: parseDateLoose(m[1]),
    });
  }
  for (const m of src.matchAll(ON_WROTE_NO_EMAIL_RE)) {
    if (m.index === undefined) continue;
    // Skip if a with-email match already covers this region.
    if (markers.some((mk) => Math.abs(mk.index - m.index!) < 20)) continue;
    markers.push({
      index: m.index,
      length: m[0].length,
      author_name: (m[2] ?? "").trim() || null,
      author_email: null,
      date: parseDateLoose(m[1]),
    });
  }
  for (const m of src.matchAll(OUTLOOK_RE)) {
    if (m.index === undefined) continue;
    markers.push({
      index: m.index,
      length: m[0].length,
      author_name: (m[1] ?? "").trim() || null,
      author_email: (m[2] ?? "").trim().toLowerCase() || null,
      date: parseDateLoose(m[3]),
    });
  }
  for (const m of src.matchAll(FORWARDED_RE)) {
    if (m.index === undefined) continue;
    const headers = readHeaders(m[1] ?? "");
    markers.push({
      index: m.index,
      length: m[0].length,
      author_name: headers.from_name,
      author_email: headers.from_email,
      date: headers.date,
    });
  }

  if (markers.length === 0) {
    return { newContent: stripQuotedReply(src), history: [] };
  }

  // De-duplicate: when "Forwarded message" header sits right next to a
  // matching "On X wrote:" line, both regexes match and we'd double-count.
  markers.sort((a, b) => a.index - b.index);
  const deduped: Marker[] = [];
  for (const m of markers) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.index - m.index) < 200) continue;
    deduped.push(m);
  }

  let newContent = stripQuotedReply(src.slice(0, deduped[0].index));

  const segments: QuotedSegment[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const m = deduped[i];
    const start = m.index + m.length;
    const end = i + 1 < deduped.length ? deduped[i + 1].index : src.length;
    const body = dequote(src.slice(start, end));
    if (!body) continue;
    segments.push({
      author_name: m.author_name,
      author_email: m.author_email,
      body,
      date: m.date,
    });
  }

  // Forward case: when the body opens with the wrapping marker (e.g. Gmail's
  // "---------- Forwarded message ---------" header), there's nothing
  // before it and segments[0] IS the forwarder's content. Promote it to
  // newContent so the inbound webhook doesn't fall back to dumping the raw
  // header block as the new message AND list the same author twice in the
  // history (as both a segment and the forwarder).
  if (!newContent.trim() && deduped[0].index < 50 && segments.length > 0) {
    newContent = segments[0].body;
    segments.shift();
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
