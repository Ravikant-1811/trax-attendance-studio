const appTimeZone = process.env.TIME_ZONE ?? "Asia/Kolkata";

export function nowIso(): string {
  return new Date().toISOString();
}

export function getDateKey(iso: string, timeZone = appTimeZone): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(iso));

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to generate date key");
  }

  return `${year}-${month}-${day}`;
}

export function minuteDiff(laterIso: string, earlierIso: string): number {
  const later = new Date(laterIso).getTime();
  const earlier = new Date(earlierIso).getTime();
  return Math.floor((later - earlier) / (1000 * 60));
}

export function getTimeZone(): string {
  return appTimeZone;
}
