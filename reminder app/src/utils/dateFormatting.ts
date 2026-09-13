/**
 * Remy Reminders - Swiss Tabular Date & Time Formatting Utilities
 * Provides zero-dependency, deterministic date strings with monospaced alignment.
 */

export function padZero(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}

/**
 * Returns broadsheet masthead date: e.g. "THURSDAY, 10 SEP"
 */
export function formatMastheadDate(date: Date = new Date()): string {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const dayName = days[date.getDay()];
  const dayNum = padZero(date.getDate());
  const monthName = months[date.getMonth()];

  return `${dayName}, ${dayNum} ${monthName}`;
}

/**
 * Formats time in HH:MM tabular format
 */
export function formatTabularTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '--:--';
  const hours = padZero(d.getHours());
  const minutes = padZero(d.getMinutes());
  return `${hours}:${minutes}`;
}

/**
 * Formats reminder time into tabular format:
 * - Today: "14:30"
 * - Tomorrow: "TOMORROW 09:00"
 * - Future date: "12 SEP 18:00"
 */
export function formatTabularReminderTime(dueDate: string | Date, now: Date = new Date()): string {
  const target = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  if (isNaN(target.getTime())) return '--:--';

  const timeStr = formatTabularTime(target);

  const isToday =
    target.getDate() === now.getDate() &&
    target.getMonth() === now.getMonth() &&
    target.getFullYear() === now.getFullYear();

  if (isToday) {
    return timeStr;
  }

  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    target.getDate() === tomorrow.getDate() &&
    target.getMonth() === tomorrow.getMonth() &&
    target.getFullYear() === tomorrow.getFullYear();

  if (isTomorrow) {
    return `TOMORROW ${timeStr}`;
  }

  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthName = months[target.getMonth()];
  const dayNum = padZero(target.getDate());

  if (target.getFullYear() === now.getFullYear()) {
    return `${dayNum} ${monthName} ${timeStr}`;
  }

  return `${dayNum} ${monthName} ${target.getFullYear()} ${timeStr}`;
}

/**
 * Formats date for ledger view
 */
export function formatLedgerDate(date: Date | string, now: Date = new Date()): string {
  return formatTabularReminderTime(date, now);
}

export interface OverdueAnalysis {
  isOverdue: boolean;
  elapsedFormatted: string;
  elapsedMinutes: number;
}

/**
 * Determines whether a reminder is overdue and formats elapsed duration:
 * - < 60m: "+15m"
 * - < 24h: "+2h 10m"
 * - >= 24h: "+3d"
 */
export function getOverdueAnalysis(
  dueDate: string | Date,
  status: string,
  now: Date = new Date(),
  armed: boolean = true
): OverdueAnalysis {
  if (status === 'completed' || armed === false) {
    return { isOverdue: false, elapsedFormatted: '', elapsedMinutes: 0 };
  }

  const target = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  if (isNaN(target.getTime())) {
    return { isOverdue: false, elapsedFormatted: '', elapsedMinutes: 0 };
  }

  const diffMs = now.getTime() - target.getTime();
  if (diffMs <= 0) {
    return { isOverdue: false, elapsedFormatted: '', elapsedMinutes: 0 };
  }

  const elapsedMinutes = Math.floor(diffMs / (60 * 1000));
  let elapsedFormatted = '';

  if (elapsedMinutes < 60) {
    elapsedFormatted = `+${elapsedMinutes}m`;
  } else if (elapsedMinutes < 1440) {
    const hrs = Math.floor(elapsedMinutes / 60);
    const mins = elapsedMinutes % 60;
    elapsedFormatted = mins > 0 ? `+${hrs}h ${mins}m` : `+${hrs}h`;
  } else {
    const days = Math.floor(elapsedMinutes / 1440);
    elapsedFormatted = `+${days}d`;
  }

  return {
    isOverdue: true,
    elapsedFormatted,
    elapsedMinutes,
  };
}

export function formatRelativeOverdue(date: Date | string, now: Date = new Date()): string {
  const analysis = getOverdueAnalysis(date, 'pending', now);
  if (!analysis.isOverdue) return '';
  return `OVERDUE ${analysis.elapsedFormatted.toUpperCase()}`;
}
