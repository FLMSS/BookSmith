import { MarkdownView, Notice } from 'obsidian';
import BookSmithPlugin from '../main';
import { i18n } from '../i18n/i18n';
import { getLogicalDayISODate } from '../utils/logicalDay';

export interface FocusStats {
    interruptions: number;     // 中断次数
    completedSessions: number; // 完成的专注次数
    totalWords: number;        // 总字数
    totalFocusMinutes: number; // 当日累计专注分钟数
}

export enum FocusState {
    IDLE = 'idle',
    WORKING = 'working',
    BREAK = 'break',
    PAUSED = 'paused'
}

export class FocusManager {
    private timer: number | null = null;
    private startTime: number = 0;
    private remainingTime: number = 0;
    private state: FocusState = FocusState.IDLE;
    private stats: FocusStats = {
        interruptions: 0,
        completedSessions: 0,
        totalWords: 0,
        totalFocusMinutes: 0
    };
    private updateListeners: Array<() => void> = [];

    // 字数统计相关
    private currentWords: number = 0;
    private lastContent: string = '';
    private activeLeafHandler: (() => void) | null = null;
    private modifyHandler: ((file: any) => void) | null = null;

    constructor(private plugin: BookSmithPlugin) {
        this.loadTodayStats();
    }

    // =============== 状态管理方法 ===============
    getState(): FocusState {
        return this.state;
    }

    getStats(): FocusStats {
        return { ...this.stats };
    }

    getCurrentWords(): number {
        return this.currentWords;
    }

    getCurrentTime(): { minutes: number; seconds: number; progress: number } {
        const minutes = Math.floor(this.remainingTime / 60);
        const seconds = this.remainingTime % 60;
        const totalTime = this.state === FocusState.BREAK 
            ? this.plugin.settings.focus.breakDuration * 60 
            : this.plugin.settings.focus.workDuration * 60;
        
        const progress = this.state === FocusState.PAUSED
            ? 1 - (this.remainingTime / totalTime)
            : Math.max(0, Math.min(1, 1 - (this.remainingTime / totalTime)));

        return { minutes, seconds, progress };
    }

    getAssignmentBookId(): string | null {
        const id = this.plugin.settings.focus.assignmentBookId?.trim();
        return id ? id : null;
    }

    async setAssignmentBookId(bookId: string | null): Promise<void> {
        this.plugin.settings.focus.assignmentBookId = bookId || '';
        await this.plugin.saveSettings();
        this.notifyUpdate();
    }

    // =============== 专注控制方法 ===============
    startFocus(): void {
        if (this.state !== FocusState.IDLE) return;

        this.setupWordCounter();
        this.state = FocusState.WORKING;
        this.startTime = Date.now();
        this.remainingTime = this.plugin.settings.focus.workDuration * 60;
        this.startTimer();
        this.notifyUpdate();
    }

    pauseFocus(): void {
        if (this.state !== FocusState.WORKING) return;
        this.state = FocusState.PAUSED;
        this.clearTimer();
        this.notifyUpdate();
    }

    resumeFocus(): void {
        if (this.state !== FocusState.PAUSED) return;
        this.state = FocusState.WORKING;
        this.startTimer();
        this.notifyUpdate();
    }

    resetCurrentTimer(): void {
        if (this.state !== FocusState.IDLE) {
            this.clearTimer();
            this.removeWordCounter();
            this.state = FocusState.IDLE;
        }
        this.remainingTime = this.plugin.settings.focus.workDuration * 60;
        this.notifyUpdate();
    }

    endFocus(): void {
        if (this.state === FocusState.IDLE) return;

        const focusedMinutes = this.getCurrentSessionFocusedMinutes();
    
        this.clearTimer();
        if (this.state !== FocusState.BREAK) {
            this.stats.interruptions++;
            this.addFocusMinutes(focusedMinutes);
            this.updateTotalWords();
        }
        
        this.removeWordCounter();
        this.state = FocusState.IDLE;
        this.saveStats();
        this.showSummary();
        this.notifyUpdate();
    }

    // =============== 统计管理方法 ===============
    private updateTotalWords(): void {
        if (this.currentWords > 0) {
            this.stats.totalWords += this.currentWords;
            this.saveStats();
        }
    }

    private addFocusMinutes(minutes: number): void {
        if (!Number.isFinite(minutes) || minutes <= 0) return;

        const assignmentBookId = this.getAssignmentBookId();
        if (!assignmentBookId) {
            return;
        }

        this.stats.totalFocusMinutes = Number((this.stats.totalFocusMinutes + minutes).toFixed(2));
        this.saveStats();
        void this.addFocusMinutesToAssignedBook(assignmentBookId, minutes);
    }

    private async addFocusMinutesToAssignedBook(bookId: string, minutes: number): Promise<void> {
        const book = await this.plugin.bookManager.getBookById(bookId);
        if (!book) return;

        const date = this.getCurrentLogicalDayKey();
        const dailyMinutes = { ...(book.focusStats?.dailyMinutes || {}) };
        dailyMinutes[date] = Number(((dailyMinutes[date] || 0) + minutes).toFixed(2));

        await this.plugin.bookManager.updateBook(book.basic.uuid, {
            focusStats: { dailyMinutes }
        });
    }

    private getCurrentSessionFocusedMinutes(): number {
        if (this.state === FocusState.BREAK) {
            return this.plugin.settings.focus.workDuration;
        }

        if (this.state === FocusState.WORKING || this.state === FocusState.PAUSED) {
            const totalSeconds = this.plugin.settings.focus.workDuration * 60;
            const elapsedSeconds = Math.max(0, Math.min(totalSeconds, totalSeconds - this.remainingTime));
            return elapsedSeconds / 60;
        }

        return 0;
    }

    reloadCurrentDayStats(): void {
        this.loadTodayStats();
        this.notifyUpdate();
    }

    private loadTodayStats(): void {
        const today = this.getCurrentLogicalDayKey();
        const dailyStats = this.plugin.settings.focus.stats?.dailyStats[today];
        
        this.stats = dailyStats ? { ...dailyStats } : {
            interruptions: 0,
            completedSessions: 0,
            totalWords: 0,
            totalFocusMinutes: 0
        };

        this.stats.totalFocusMinutes = this.stats.totalFocusMinutes || 0;
    }

    private saveStats(): void {
        const today = this.getCurrentLogicalDayKey();
        if (!this.plugin.settings.focus.stats) {
            this.plugin.settings.focus.stats = { dailyStats: {} };
        }
        this.plugin.settings.focus.stats.dailyStats[today] = { ...this.stats };
        this.plugin.saveSettings();
    }

    // =============== 字数统计方法 ===============
    private setupWordCounter(): void {
        this.lastContent = '';
        this.currentWords = 0;
        
        this.activeLeafHandler = () => {
            const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                this.lastContent = activeView.editor.getValue();
            }
        };

        this.modifyHandler = (file: any) => {
            const activeFile = this.plugin.app.workspace.getActiveFile();
            const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

            if (!activeFile || !activeView || file !== activeFile) return;
            
            const content = activeView.editor.getValue();
            const wordDiff = this.getWordDiff(this.lastContent, content);
            this.currentWords += wordDiff;
            this.lastContent = content;
            this.notifyUpdate();
        };

        this.plugin.app.workspace.on('active-leaf-change', this.activeLeafHandler);
        this.plugin.app.vault.on('modify', this.modifyHandler);
    }

    private removeWordCounter(): void {
        if (this.activeLeafHandler) {
            this.plugin.app.workspace.off('active-leaf-change', this.activeLeafHandler);
            this.activeLeafHandler = null;
        }
        if (this.modifyHandler) {
            this.plugin.app.vault.off('modify', this.modifyHandler);
            this.modifyHandler = null;
        }
        this.currentWords = 0;
        this.lastContent = '';
    }

    private getWordDiff(oldText: string, newText: string): number {
        const oldCount = this.countWords(oldText);
        const newCount = this.countWords(newText);
        return newCount - oldCount;
    }

    private countWords(text: string): number {
        // Remove frontmatter (YAML block at the start)
        const textWithoutFrontmatter = text.replace(/^---[\s\S]*?---\s*/, '');
        const cleanText = textWithoutFrontmatter.replace(
            /(```[\s\S]*?```)|(`.*?`)|(\[.*?\]\(.*?\))|(\*\*.*?\*\*)|(\*.*?\*)|(\n>)|(^\s*[-+*]\s)|(^\s*\d+\.\s)|(\!\[.*?\]\(.*?\))/gm,
            ''
        );

        let chineseCount = 0;
        for (let i = 0; i < cleanText.length; i++) {
            if (cleanText.charCodeAt(i) >= 0x4e00 && cleanText.charCodeAt(i) <= 0x9fa5) {
                chineseCount++;
            }
        }

        const words = cleanText
            .replace(/[\u4e00-\u9fa5]/g, '')
            .trim()
            .split(/\s+/);
        const englishCount = words[0] === '' ? 0 : words.length;

        return chineseCount + englishCount;
    }

    // =============== 定时器管理方法 ===============
    private startTimer(): void {
        this.clearTimer();
        this.timer = window.setInterval(() => {
            this.remainingTime--;
            this.notifyUpdate();

            if (this.remainingTime <= 0) {
                if (this.state === FocusState.WORKING) {
                    this.startBreak();
                } else if (this.state === FocusState.BREAK) {
                    this.endFocus();
                }
            }
        }, 1000);
    }

    private clearTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private startBreak(): void {
        this.stats.completedSessions++;
        this.addFocusMinutes(this.getCurrentSessionFocusedMinutes());
        this.updateTotalWords();
        this.saveStats();
        
        this.state = FocusState.BREAK;
        this.remainingTime = this.plugin.settings.focus.breakDuration * 60;
        this.startTimer();
        new Notice(i18n.t('BREAK_TIME_START'));
        this.notifyUpdate();
    }

    private showSummary(): void {
        new Notice(i18n.t('FOCUS_SUMMARY', {
            duration: this.plugin.settings.focus.workDuration,
            interruptions: this.stats.interruptions,
            words: this.currentWords
        }));
    }

    private getCurrentLogicalDayKey(): string {
        return getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
    }

    // =============== 事件监听方法 ===============
    onUpdate(callback: () => void): void {
        this.updateListeners.push(callback);
    }

    removeUpdateListener(callback: () => void): void {
        this.updateListeners = this.updateListeners.filter(fn => fn !== callback);
    }

    private notifyUpdate(): void {
        this.updateListeners.forEach(callback => callback());
    }

    // =============== 工具方法 ===============
    private debounce<T extends (...args: any[]) => any>(
        func: T,
        wait: number
    ): (...args: Parameters<T>) => void {
        let timeout: number | null = null;
        
        return (...args: Parameters<T>) => {
            if (timeout) {
                window.clearTimeout(timeout);
            }
            timeout = window.setTimeout(() => {
                func.apply(this, args);
                timeout = null;
            }, wait);
        };
    }
}