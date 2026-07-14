import { defaultTemplate } from '../templates/prose';
import { screenplayTemplate } from '../templates/screenplay';
import { ChapterTree } from '../types/book';

export interface LeftPaneWritingScheduleSnapshot {
    effectiveFrom: string;
    mode: 'specific-days' | 'days-per-week';
    selectedWeekdays: number[];
    daysPerWeek: number;
}

export interface LeftPaneWritingScheduleSettings {
    mode: 'specific-days' | 'days-per-week';
    selectedWeekdays: number[];
    daysPerWeek: number;
    averageMissedScheduledDays: boolean;
    averageWindowDays: number;
    scheduleHistory: LeftPaneWritingScheduleSnapshot[];
}
export interface BookSmithSettings {
    // 基础配置
    defaultAuthor: string;
    defaultBookPath: string;
    lastBookId?: string;
    /**
     * Whether the Manage Projects modal renders in compact (switcher-style)
     * rows. When true: covers & descriptions hidden, tighter spacing — the
     * former Switch Projects layout. When false (default): full rich rows
     * with cover art and metadata.
     */
    manageBooksCompact?: boolean;

    /**
     * When you open a file that belongs to a different BookSmith project, auto-
     * switch the left pane to that project (instead of only showing the manual
     * "switch" button). Default on.
     */
    autoSwitchProjectOnFileOpen?: boolean;

    /**
     * When a scene note is clicked in the panel, briefly glow its anchored
     * paragraph purple in any editor where it's currently visible (no
     * scrolling/moving). Default on.
     */
    sceneNoteGlowOnClick?: boolean;

    /**
     * Glow shape: when true (default), the highlight spans the full row/column
     * width. When false, it hugs the actual text extent (stops where the text
     * ends on each row). Only relevant when `sceneNoteGlowOnClick` is on.
     */
    sceneNoteGlowFullRow?: boolean;

    /**
     * When true, the click glow takes the note's flag colour instead of the
     * default purple (a yellow flag glows yellow, etc.). Rendered at low
     * opacity so every colour stays light and pleasant. Default off.
     * Notes with no flag colour fall back to purple.
     */
    sceneNoteGlowMatchColor?: boolean;

    // 模板配置
    templates: {
        default: string;
        custom: {
            [name: string]: {
                name: string;
                description: string;
                structure: ChapterTree;
                isBuiltin?: boolean;
            }
        }
    };

    // 工具显示配置
    tools: {
        assistant: boolean;      // 写作助手
        export: boolean;         // 导出发布
        community: boolean;      // 写作圈子
    };

    // 专注模式配置
    focus: {
        workDuration: number;      
        breakDuration: number;     
        wordGoal: number;
        dailyRolloverMinutes: number;
        assignmentBookId?: string;
        miniWidgetMode?: 'focus' | 'goal';
        stats: {
            dailyStats: {
                [date: string]: {
                    interruptions: number;     
                    completedSessions: number; 
                    totalWords: number;
                    totalFocusMinutes: number;
                }
            }
        }
    };

    // Statistics view preferences
    stats: {
        displayMode: 'words' | 'pages' | 'pomodoros' | 'hours';
        writingDisplayMode: 'new-material-net' | 'daily-output' | 'raw';
        leftPaneWritingDisplayMode?: 'new-material-net' | 'daily-output' | 'raw';
        wordsPerPage: number;
    };

    // Book view display preferences
    bookView: {
        leftPanelInfo: {
            enabled: boolean;
            metricMode: 'words' | 'pages';
            todayWords: boolean;
            totalWords: boolean;
            completion: boolean;
            writingDays: boolean;
            dailyAverage: boolean;
            /** Word/page count of the currently active file only. */
            currentFile: boolean;
            /** Display order of the stat rows (keys from LEFT_PANE_STAT_KEYS). */
            order: string[];
            writingSchedule: LeftPaneWritingScheduleSettings;
        };
    };
}

/** Stat rows shown in the bottom-left info block, in default order. */
export const LEFT_PANE_STAT_KEYS = ['today', 'currentFile', 'total', 'completion', 'writingDays', 'dailyAverage'] as const;
export type LeftPaneStatKey = (typeof LEFT_PANE_STAT_KEYS)[number];

/** Maps each stat key to its visibility flag on `bookView.leftPanelInfo`. */
export const LEFT_PANE_STAT_VISIBILITY_FIELD: Record<LeftPaneStatKey, 'todayWords' | 'currentFile' | 'totalWords' | 'completion' | 'writingDays' | 'dailyAverage'> = {
    today: 'todayWords',
    currentFile: 'currentFile',
    total: 'totalWords',
    completion: 'completion',
    writingDays: 'writingDays',
    dailyAverage: 'dailyAverage'
};

/** Short labels for the settings list / reorder UI. */
export const LEFT_PANE_STAT_LABEL: Record<LeftPaneStatKey, string> = {
    today: 'Today value',
    currentFile: 'Current file value',
    total: 'Total value',
    completion: 'Completion',
    writingDays: 'Writing days',
    dailyAverage: 'Daily average value'
};

/**
 * Normalize a saved order: drop unknown/duplicate keys, then append any known
 * keys missing from the saved list (in their default position) — so adding a
 * new stat later slots in without breaking existing saved orders.
 */
export function sanitizeLeftPaneStatOrder(saved?: string[]): LeftPaneStatKey[] {
    const known = new Set<string>(LEFT_PANE_STAT_KEYS);
    const seen = new Set<string>();
    const result: LeftPaneStatKey[] = [];
    for (const k of saved ?? []) {
        if (known.has(k) && !seen.has(k)) {
            result.push(k as LeftPaneStatKey);
            seen.add(k);
        }
    }
    for (const k of LEFT_PANE_STAT_KEYS) {
        if (!seen.has(k)) result.push(k);
    }
    return result;
}

export const DEFAULT_SETTINGS: BookSmithSettings = {
    defaultAuthor: 'FelMNZ',
    defaultBookPath: 'books',
    lastBookId: '',
    manageBooksCompact: false,
    autoSwitchProjectOnFileOpen: true,
    sceneNoteGlowOnClick: true,
    sceneNoteGlowFullRow: true,
    sceneNoteGlowMatchColor: false,
    templates: {
        default: 'prose',
        custom: {
            'prose': {
                name: 'Prose',
                description: 'Standard structure with a preface, outline, main chapters, and an epilogue',
                structure: defaultTemplate,
                isBuiltin: true
            },
            'screenplay': {
                name: 'Screenplay (Fountain)',
                description: 'Screenplay writing template with Fountain frontmatter added automatically',
                structure: screenplayTemplate,
                isBuiltin: true
            }
        }
    },
    tools: {
        assistant: true,
        export: true,
        community: true
    },
    focus: {
        workDuration: 25,
        breakDuration: 5,
        wordGoal: 500,
        dailyRolloverMinutes: 210,
        assignmentBookId: '',
        miniWidgetMode: 'focus',
        stats: { dailyStats: {} }
    },
    stats: {
        displayMode: 'words',
        writingDisplayMode: 'new-material-net',
        leftPaneWritingDisplayMode: 'daily-output',
        wordsPerPage: 250
    },
    bookView: {
        leftPanelInfo: {
            enabled: true,
            metricMode: 'words',
            todayWords: true,
            totalWords: true,
            completion: true,
            writingDays: true,
            dailyAverage: true,
            currentFile: true,
            order: ['today', 'currentFile', 'total', 'completion', 'writingDays', 'dailyAverage'],
            writingSchedule: {
                mode: 'specific-days',
                selectedWeekdays: [1, 2, 3, 4, 5, 6, 0],
                daysPerWeek: 7,
                averageMissedScheduledDays: true,
                averageWindowDays: 0,
                scheduleHistory: [
                    {
                        effectiveFrom: '1970-01-01',
                        mode: 'specific-days',
                        selectedWeekdays: [1, 2, 3, 4, 5, 6, 0],
                        daysPerWeek: 7
                    }
                ]
            }
        }
    }
};