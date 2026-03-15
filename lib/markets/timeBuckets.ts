export type TimeBucket = "same_day" | "short" | "medium" | "long" | "extended";

export function getTimeBucket(now: Date, resolutionDate: Date | null): {
  daysToResolution: number | null;
  timeBucket: TimeBucket;
} {
  if (!resolutionDate) {
    return { daysToResolution: null, timeBucket: "extended" };
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.round(
    (resolutionDate.getTime() - now.getTime()) / msPerDay
  );

  if (diffDays <= 0) {
    return { daysToResolution: diffDays, timeBucket: "same_day" };
  }
  if (diffDays === 1) {
    return { daysToResolution: diffDays, timeBucket: "same_day" };
  }
  if (diffDays >= 2 && diffDays <= 7) {
    return { daysToResolution: diffDays, timeBucket: "short" };
  }
  if (diffDays >= 8 && diffDays <= 30) {
    return { daysToResolution: diffDays, timeBucket: "medium" };
  }
  if (diffDays >= 31 && diffDays <= 90) {
    return { daysToResolution: diffDays, timeBucket: "long" };
  }
  return { daysToResolution: diffDays, timeBucket: "extended" };
}

