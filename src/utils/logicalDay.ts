export const DEFAULT_DAILY_ROLLOVER_MINUTES = 210;

const MINUTES_PER_DAY = 24 * 60;

export function normalizeDailyRolloverMinutes(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_DAILY_ROLLOVER_MINUTES;
    }

    const roundedToHalfHour = Math.round(parsed / 30) * 30;
    return ((roundedToHalfHour % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function toLocalISODate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getLogicalDayDate(date: Date, rolloverMinutes: number = DEFAULT_DAILY_ROLLOVER_MINUTES): Date {
    const logicalDate = new Date(date.getTime());
    const minutesSinceMidnight = logicalDate.getHours() * 60 + logicalDate.getMinutes();

    if (minutesSinceMidnight < normalizeDailyRolloverMinutes(rolloverMinutes)) {
        logicalDate.setDate(logicalDate.getDate() - 1);
    }

    return logicalDate;
}

export function getLogicalDayISODate(date: Date, rolloverMinutes: number = DEFAULT_DAILY_ROLLOVER_MINUTES): string {
    return toLocalISODate(getLogicalDayDate(date, rolloverMinutes));
}

export function formatDailyRolloverLabel(minutes: number): string {
    const normalizedMinutes = normalizeDailyRolloverMinutes(minutes);
    const hour24 = Math.floor(normalizedMinutes / 60);
    const minute = normalizedMinutes % 60;
    const suffix = hour24 < 12 ? 'AM' : 'PM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function getDailyRolloverOptions(): Array<{ value: string; label: string }> {
    const options: Array<{ value: string; label: string }> = [];
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += 30) {
        options.push({
            value: String(minutes),
            label: formatDailyRolloverLabel(minutes)
        });
    }
    return options;
}