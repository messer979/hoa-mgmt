// Small pure helpers for the calendar grid. Kept UTC-free — the caller
// works in the viewer's local timezone.

export type MonthKey = `${number}-${string}`; // "2026-07"

export function monthKey(d: Date): MonthKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}` as MonthKey;
}

export function parseMonthKey(key: string | null | undefined): Date {
  if (key && /^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function monthLabel(d: Date): string {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

// Return a 6-row × 7-col grid of dates covering the visible month, padded
// with days from the previous and following months so the grid is always
// rectangular. Sunday is column 0 by default.
export function buildMonthGrid(monthStart: Date): Date[][] {
  const y = monthStart.getFullYear();
  const m = monthStart.getMonth();
  const first = new Date(y, m, 1);
  const startCol = first.getDay(); // 0=Sun
  const gridStart = new Date(y, m, 1 - startCol);

  const grid: Date[][] = [];
  for (let row = 0; row < 6; row++) {
    const week: Date[] = [];
    for (let col = 0; col < 7; col++) {
      const idx = row * 7 + col;
      week.push(new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + idx,
      ));
    }
    grid.push(week);
  }
  return grid;
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
