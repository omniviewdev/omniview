import {
  differenceInSeconds,
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
} from 'date-fns';

/**
 * Formats the time difference between the given date and the current date.
 * @param date The date to calculate the difference from
 */
export function formatTimeDifference(date: Date): string {
  const now = new Date();
  const sec = differenceInSeconds(now, date);
  const min = differenceInMinutes(now, date);
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date);

  if (days > 0) {
    return `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = min - hours * 60;
    return `${hours}h${remainingMinutes > 0 ? `${remainingMinutes}m` : ''}`;
  }

  if (min > 0) {
    const remainingSeconds = sec - min * 60;
    return `${min}m${remainingSeconds > 0 ? `${remainingSeconds}s` : ''}`;
  }

  return `${sec}s`;
}
