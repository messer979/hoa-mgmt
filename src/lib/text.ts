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
