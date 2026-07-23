import { BookWritingPeriod } from '../types/book';

/** Minimal period shape the streak logic needs (both panes can supply it). */
export interface StreakPeriod {
    startDate: string;
    endDate?: string;
    mode: 'specific-days' | 'days-per-week';
    selectedWeekdays: number[];
    daysPerWeek: number;
    /** Min net words in a day for it to count as a writing day. */
    thresholdWords: number;
}

export interface StreakInfo {
    /** Consecutive kept weeks (includes the current week once its quota is met). */
    weeks: number;
    /** Threshold-met days inside the live chain (for the "N days" display). */
    daysWritten: number;
    /** Current week progress toward its quota. */
    met: number;
    /** Current week quota (0 = neutral week, no schedule coverage). */
    required: number;
    /** Monday of the earliest week in the live chain; null when the chain is empty. */
    chainStartIso: string | null;
}

// --- date helpers (ISO yyyy-mm-dd, local time) ---

function parseISO(dateIso: string): Date {
    return new Date(`${dateIso}T12:00:00`);
}

function toISO(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftISO(dateIso: string, days: number): string {
    const date = parseISO(dateIso);
    date.setDate(date.getDate() + days);
    return toISO(date);
}

/** Monday of the week containing the given date. */
function weekStartISO(dateIso: string): string {
    const day = parseISO(dateIso).getDay(); // 0=Sun
    return shiftISO(dateIso, -((day + 6) % 7));
}

/** Normalize raw book periods into the streak shape (mirrors the views' rules). */
export function normalizeStreakPeriods(
    raw: BookWritingPeriod[] | undefined,
    fallbackStartIso: string
): StreakPeriod[] {
    const isISO = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const source: BookWritingPeriod[] = raw && raw.length > 0
        ? raw
        : [{
            id: 'default-period',
            name: 'First Draft',
            start_date: fallbackStartIso,
            schedule: { mode: 'specific-days', selected_weekdays: [0, 1, 2, 3, 4, 5, 6], days_per_week: 7 },
            average_missed_scheduled_days: true,
            average_window_days: 0,
            created_at: '',
            updated_at: ''
        }];

    return source.map((p) => {
        const startDate = isISO(p.start_date) ? p.start_date : fallbackStartIso;
        const endDate = isISO(p.end_date) && p.end_date! >= startDate ? p.end_date : undefined;
        const weekdays = Array.from(new Set(
            (p.schedule?.selected_weekdays || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        )).sort((a, b) => a - b);
        return {
            startDate,
            endDate,
            mode: p.schedule?.mode === 'days-per-week' ? 'days-per-week' : 'specific-days',
            selectedWeekdays: weekdays,
            daysPerWeek: Math.max(0, Math.min(7, Math.round(p.schedule?.days_per_week ?? 7))),
            thresholdWords: Math.max(1, Math.round(p.writing_day_threshold_words ?? 1))
        };
    });
}

function activePeriodFor(date: string, periods: StreakPeriod[]): StreakPeriod | null {
    const matches = periods
        .filter((p) => date >= p.startDate && (!p.endDate || date <= p.endDate))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Evaluate one week's quota. `upTo` limits which days count as "met" (today,
 * for the current week); the requirement always reflects the full week so
 * current-week progress reads e.g. 2/3. required=0 means a neutral week.
 */
function evaluateWeek(
    weekStartIso: string,
    upTo: string | null,
    periods: StreakPeriod[],
    getDayValue: (iso: string) => number
): { met: number; required: number } {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) days.push(shiftISO(weekStartIso, i));

    const covered = days.filter((d) => activePeriodFor(d, periods) !== null);
    if (covered.length === 0) return { met: 0, required: 0 };

    // The period governing this week = the one active on its last covered day
    // (the most recent regime; multi-period weeks are a rare edge).
    const period = activePeriodFor(covered[covered.length - 1], periods)!;

    let required: number;
    if (period.mode === 'days-per-week') {
        required = Math.min(period.daysPerWeek, covered.length);
    } else {
        required = covered.filter((d) =>
            period.selectedWeekdays.includes(parseISO(d).getDay())
        ).length;
    }

    const met = days.filter((d) =>
        (!upTo || d <= upTo) && getDayValue(d) >= period.thresholdWords
    ).length;

    return { met, required };
}

/**
 * Streak = consecutive "kept" calendar weeks (Monday-start). A week is kept
 * when you wrote at least the governing period's threshold on enough days.
 * Weeks without schedule coverage are NEUTRAL (neither break nor extend).
 * The current week never breaks the streak mid-week; it extends it once met.
 */
export function computeStreakInfo(
    periods: StreakPeriod[],
    getDayValue: (iso: string) => number,
    todayIso: string
): StreakInfo | null {
    if (periods.length === 0) return null;

    const currentWeekStart = weekStartISO(todayIso);
    const current = evaluateWeek(currentWeekStart, todayIso, periods, getDayValue);

    let weeks = 0;
    let chainStartIso: string | null = null;
    let cursor = shiftISO(currentWeekStart, -7);
    for (let i = 0; i < 520; i++) { // 10-year lookback cap
        const week = evaluateWeek(cursor, null, periods, getDayValue);
        const thisWeek = cursor;
        cursor = shiftISO(cursor, -7);
        if (week.required === 0) continue;          // neutral gap week
        if (week.met >= week.required) {
            weeks++;
            chainStartIso = thisWeek;
            continue;
        }
        break;
    }

    // Current week extends the streak once already met; it never breaks it.
    if (current.required > 0 && current.met >= current.required) weeks++;
    // Any progress this week is part of the live chain even before the quota.
    if (chainStartIso === null && current.met > 0) chainStartIso = currentWeekStart;

    // Count threshold-met days across the chain (neutral days use threshold 1).
    let daysWritten = 0;
    if (chainStartIso !== null) {
        let day = chainStartIso;
        while (day <= todayIso) {
            const period = activePeriodFor(day, periods);
            const threshold = period ? period.thresholdWords : 1;
            if (getDayValue(day) >= threshold) daysWritten++;
            day = shiftISO(day, 1);
        }
    }

    return { weeks, daysWritten, met: current.met, required: current.required, chainStartIso };
}

/** Monday of the week containing the given ISO date (exported for views). */
export function getWeekStartISO(dateIso: string): string {
    return weekStartISO(dateIso);
}

/**
 * One week's quota days, for the "writing days only" list: the days you
 * actually wrote, plus one concrete date per missed quota slot. A 3-day week
 * where you wrote 2 yields two written days and ONE missed day — not every
 * blank day. The current (in-progress) week never reports missed slots.
 * Missed dates: scheduled weekdays you skipped (specific-days mode), or the
 * trailing unwritten covered days (days-per-week mode, which has no fixed
 * dates). Both lists are chronological.
 */
export function getWeekQuotaDays(
    periods: StreakPeriod[],
    getDayValue: (iso: string) => number,
    weekStartIso: string,
    todayIso: string
): { written: string[]; missed: string[] } {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) days.push(shiftISO(weekStartIso, i));

    const covered = days.filter((d) => activePeriodFor(d, periods) !== null);
    if (covered.length === 0) return { written: [], missed: [] };

    const period = activePeriodFor(covered[covered.length - 1], periods)!;
    const { met, required } = evaluateWeek(weekStartIso, todayIso, periods, getDayValue);

    const written = days.filter((d) => d <= todayIso && getDayValue(d) >= period.thresholdWords);

    const isCurrentWeek = weekStartIso === weekStartISO(todayIso);
    if (isCurrentWeek || met >= required) return { written, missed: [] };

    const missing = required - met;
    let candidates: string[];
    if (period.mode === 'specific-days') {
        candidates = covered.filter((d) =>
            period.selectedWeekdays.includes(parseISO(d).getDay()) && !written.includes(d)
        );
    } else {
        candidates = covered.filter((d) => !written.includes(d));
    }
    // Trailing slots read most naturally as "the days you ran out of".
    const missed = candidates.slice(-missing);

    return { written, missed };
}

/**
 * Day value for streak purposes, from a daily_progress entry.
 * countEditing=false: only net new words count (a heavy-deletion day is 0).
 * countEditing=true : words ADDED also count even when deletions cancelled
 * them out — editing days keep the streak, aligned with Writing Days.
 */
export function streakDayValue(
    entry: { net_change?: number; words_added?: number; positive_change?: number } | undefined,
    fallbackWords: number,
    countEditing: boolean
): number {
    if (!entry) return Math.max(0, fallbackWords || 0);
    const net = Math.max(0, entry.net_change || 0);
    if (!countEditing) return net;
    const added = Math.max(0, entry.words_added ?? entry.positive_change ?? 0);
    return Math.max(net, added);
}

/** One historical streak: a maximal run of kept weeks (neutral gaps allowed). */
export interface StreakSegment {
    /** Monday of the first kept week. */
    startWeekIso: string;
    /** Monday of the last kept week. */
    endWeekIso: string;
    /** Kept weeks in the run (neutral gap weeks don't count or break). */
    weeks: number;
    /** Threshold-met days across the run's span. */
    daysWritten: number;
    /** Still alive today (no break since). */
    ongoing: boolean;
}

/**
 * Every streak the project has ever had, oldest first. Same week semantics as
 * the live streak: kept weeks extend, neutral weeks pause, a failed past week
 * breaks; the current in-progress week never breaks (and counts once met).
 */
export function computeStreakHistory(
    periods: StreakPeriod[],
    getDayValue: (iso: string) => number,
    todayIso: string
): StreakSegment[] {
    const segments: StreakSegment[] = [];
    if (periods.length === 0) return segments;

    const earliestStart = periods.reduce(
        (min, p) => (p.startDate < min ? p.startDate : min),
        periods[0].startDate
    );
    const currentWeek = weekStartISO(todayIso);

    let open: { start: string; end: string; weeks: number } | null = null;
    const close = (ongoing: boolean) => {
        if (!open) return;
        segments.push({
            startWeekIso: open.start,
            endWeekIso: open.end,
            weeks: open.weeks,
            daysWritten: 0,
            ongoing
        });
        open = null;
    };

    let week = weekStartISO(earliestStart);
    for (let guard = 0; guard < 700 && week <= currentWeek; guard++, week = shiftISO(week, 7)) {
        const isCurrent = week === currentWeek;
        const { met, required } = evaluateWeek(week, isCurrent ? todayIso : null, periods, getDayValue);
        if (required === 0) continue;               // neutral: pause, keep open
        if (met >= required) {
            if (!open) open = { start: week, end: week, weeks: 0 };
            open.end = week;
            open.weeks++;
            continue;
        }
        if (isCurrent) break;                       // pending week can't break
        close(false);
    }
    close(true); // anything still open reached today unbroken

    // Count threshold-met days inside each segment's span.
    for (const seg of segments) {
        const spanEnd0 = shiftISO(seg.endWeekIso, 6);
        const spanEnd = spanEnd0 < todayIso ? spanEnd0 : todayIso;
        let day = seg.startWeekIso;
        let count = 0;
        while (day <= spanEnd) {
            const period = activePeriodFor(day, periods);
            if (period && getDayValue(day) >= period.thresholdWords) count++;
            day = shiftISO(day, 1);
        }
        seg.daysWritten = count;
    }

    return segments;
}

export type StreakDayClass = 'full' | 'light' | 'red';

/**
 * Classify every day in [rangeStart, rangeEnd] for the calendar Streak View.
 * The classification is driven by each day's Monday-start week outcome, so
 * consecutive kept weeks paint a continuous chain:
 *   - full  : you wrote that day (met threshold) — always, any week.
 *   - light : you didn't write, but the week was KEPT (quota met) or is the
 *             current in-progress week with the chain alive. Fills the gaps.
 *   - red   : you didn't write, in the single week that BROKE an active chain.
 *   - (absent = neutral): failed weeks once the chain is already dead, weeks
 *             with no schedule coverage, and days before any chain / in future.
 * Walking starts from the earliest period so chain state (in/out) is exact.
 */
export function classifyStreakDays(
    periods: StreakPeriod[],
    getDayValue: (iso: string) => number,
    todayIso: string,
    rangeStartIso: string,
    rangeEndIso: string
): Map<string, StreakDayClass> {
    const result = new Map<string, StreakDayClass>();
    if (periods.length === 0) return result;

    const earliestStart = periods.reduce(
        (min, p) => (p.startDate < min ? p.startDate : min),
        periods[0].startDate
    );
    const currentWeek = weekStartISO(todayIso);
    const lastWeek = weekStartISO(rangeEndIso);

    let week = weekStartISO(earliestStart);
    let inChain = false;

    for (let guard = 0; guard < 700 && week <= lastWeek; guard++, week = shiftISO(week, 7)) {
        const isCurrent = week === currentWeek;
        const { met, required } = evaluateWeek(week, isCurrent ? todayIso : null, periods, getDayValue);

        let status: 'kept' | 'pending' | 'broken' | 'dead' | 'neutral';
        if (required === 0) status = 'neutral';
        else if (met >= required) status = 'kept';
        else if (isCurrent) status = 'pending';       // never breaks mid-week
        else status = inChain ? 'broken' : 'dead';

        // Chain state transitions (pending/neutral/dead leave it unchanged;
        // a neutral gap keeps the chain "alive" so a later miss still reds).
        if (status === 'kept') inChain = true;
        else if (status === 'broken') inChain = false;

        // A pending (current) week fills only if a chain is alive going in or
        // you've already written this week; otherwise it stays neutral.
        const pendingActive = status === 'pending' && (inChain || met > 0);

        for (let i = 0; i < 7; i++) {
            const d = shiftISO(week, i);
            if (d < rangeStartIso || d > rangeEndIso || d > todayIso) continue;

            const period = activePeriodFor(d, periods);
            const wrote = period !== null && getDayValue(d) >= period.thresholdWords;
            if (wrote) { result.set(d, 'full'); continue; }

            if (status === 'kept' || pendingActive) result.set(d, 'light');
            else if (status === 'broken') result.set(d, 'red');
            // dead / neutral / inactive-pending -> neutral (absent)
        }
    }

    return result;
}
