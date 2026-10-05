export interface IUtcWeekRange {
  start: Date;
  end: Date;
}

export function getUtcWeekRange(date: Date): IUtcWeekRange {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

export function getMostRecentCompletedUtcWeekStart(date: Date): Date {
  const { start } = getUtcWeekRange(date);
  start.setUTCDate(start.getUTCDate() - 7);
  return start;
}
