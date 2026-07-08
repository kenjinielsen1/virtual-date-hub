// Answer-streak rule (documented per spec): a day "counts" when BOTH people
// answered that day's question. Days are the app's shared UTC calendar days
// (the same day_key that unlocks the daily question), so you're both always
// counting the same day regardless of the 9h gap — kinder than local
// midnights. The current streak does NOT break just because today isn't
// answered yet; it only breaks once a full day passes unanswered.

const DAY = 86_400_000

function addDays(key: string, n: number): string {
  return new Date(Date.parse(key) + n * DAY).toISOString().slice(0, 10)
}

export function computeStreaks(
  qualifyingDays: Iterable<string>, // YYYY-MM-DD keys where BOTH answered
  todayKey: string,
): { current: number; longest: number } {
  const days = new Set(qualifyingDays)

  // Current: count back from today; if today isn't complete yet, start from
  // yesterday without breaking.
  let cursor = days.has(todayKey) ? todayKey : addDays(todayKey, -1)
  let current = 0
  while (days.has(cursor)) {
    current++
    cursor = addDays(cursor, -1)
  }

  // Longest: best consecutive run anywhere.
  let longest = 0
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue // not a run start
    let len = 0
    let c = d
    while (days.has(c)) {
      len++
      c = addDays(c, 1)
    }
    if (len > longest) longest = len
  }

  return { current, longest }
}
