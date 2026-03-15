// === Import declarations ===
import { ItemView, WorkspaceLeaf, Notice, TFolder, TFile, TAbstractFile, setIcon } from 'obsidian';
import BookSmithPlugin from '../main';
import { Book, BookWritingPeriod } from '../types/book';
import { getLogicalDayISODate } from '../utils/logicalDay';
import { CreateBookModal } from '../modals/CreateBookModal';
import { ManageBooksModal } from '../modals/ManageBooksModal';
import { SwitchBookModal } from '../modals/SwitchBookModal';
import { ChapterTree } from '../components/ChapterTree';
import { FileEventManager } from '../services/FileEventManager';
import { ReferenceManager } from '../services/ReferenceManager';
import { i18n } from '../i18n/i18n';
import { formatWordCount } from '../utils/wordCount';
import { BookViewSettingsModal } from '../modals/BookViewSettingsModal';

type DailyProgressEntry = {
    positive_change: number;
    negative_change: number;
    net_change: number;
    words_added?: number;
    words_deleted?: number;
    iteration_deletions?: number;
    old_deletions?: number;
};

type WritingPeriodSettings = {
    id: string;
    name: string;
    startDate: string;
    endDate?: string;
    mode: 'specific-days' | 'days-per-week';
    selectedWeekdays: number[];
    daysPerWeek: number;
    averageMissedScheduledDays: boolean;
    averageWindowDays: number;
};

// === View class definition ===
export class BookSmithView extends ItemView {
    // === Property definitions ===
    private currentBook: Book | null = null;
    private fileEventManager: FileEventManager;
    private referenceManager: ReferenceManager;
    private isRenamingFile: boolean = false;

    constructor(
        leaf: WorkspaceLeaf,
        private plugin: BookSmithPlugin
    ) {
        super(leaf);
        this.fileEventManager = new FileEventManager(this.app, this.plugin);
        this.referenceManager = new ReferenceManager(
            this.app, 
            this.plugin, 
            () => this.currentBook
        );
        
        this.registerFileEvents();
        this.referenceManager.registerEditorMenu();  // Register editor context menu
        // Register stats change listener
        this.registerEvent(
            this.plugin.statsManager.onStatsChange(() => {
                this.renderStats(this.containerEl.children[1] as HTMLElement);
            })
        );
    }

    // === View state management ===
    private async refreshView() {
        await this.loadBook();
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('book-smith-view-content');
        this.renderToolbar(container as HTMLElement);
        this.renderContent(container as HTMLElement);
        this.renderStats(container as HTMLElement);
    }

    // === File event listeners ===
    private registerFileEvents() {        
        // Listen for file content modifications
        this.registerEvent(
            this.app.vault.on('modify', async (file: TAbstractFile) => {
                if (this.isRenamingFile) return; // Avoid triggering during rename
                if (file instanceof TFile && this.currentBook) {
                    // Skip listening to config files
                    if (file.path.endsWith('book-config.json')) return;
                    const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
                    if (file.path.startsWith(bookPath)) {
                        const result = await this.fileEventManager.handleBookModify(file, this.currentBook);
                        if (result) {
                            await this.refreshView();
                        }
                    }
                }
            })
        );

        // Listen for file/folder rename
        this.registerEvent(
            this.app.vault.on('rename', async (file: TAbstractFile, oldPath: string) => {
                this.isRenamingFile = true;
                if ((file instanceof TFile || file instanceof TFolder) && this.currentBook) {
                    const updatedBook = await this.fileEventManager.handleBookModify(file, this.currentBook, oldPath);
                    if (updatedBook) {
                        await this.refreshView();
                    }
                }
                this.isRenamingFile = false;
            })
        );

        // Listen for file/folder creation
        this.registerEvent(
            this.app.vault.on('create', async (file: TAbstractFile) => {
                if (!this.currentBook) return;
                const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
                if (!file.path.startsWith(bookPath) || file.path.endsWith('book-config.json')) return;

                await this.plugin.statsManager.updateStatsForFile();
                await this.refreshView();
            })
        );

        // Listen for file/folder deletion
        this.registerEvent(
            this.app.vault.on('delete', async (file: TAbstractFile) => {
                if (!this.currentBook) return;
                const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
                if (!file.path.startsWith(bookPath) || file.path.endsWith('book-config.json')) return;

                await this.plugin.statsManager.updateStatsForFile();
                await this.refreshView();
            })
        );
    }

    // === Data loading ===
    private async loadBook() {
        const bookId = this.plugin.settings.lastBookId;
        if (bookId) {
            this.currentBook = await this.plugin.bookManager.getBookById(bookId);
            this.plugin.statsManager.setCurrentBook(this.currentBook);
        } else {
            this.currentBook = null;
            this.plugin.statsManager.setCurrentBook(null);
        }
    }

    // === Basic view methods ===
    getViewType() {
        return 'book-smith-view';
    }

    getDisplayText() {
        return i18n.t('BOOK_MANAGER');
    }

    getIcon() {
        return 'book';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('book-smith-view-content');
        await this.loadBook();
        this.renderToolbar(container as HTMLElement);
        this.renderContent(container as HTMLElement);
        this.renderStats(container as HTMLElement);
    }

    // === UI rendering methods ===
    private renderToolbar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: 'book-smith-toolbar' });

        const newBookBtn = toolbar.createEl('button', { cls: 'book-smith-toolbar-btn' });
        setIcon(newBookBtn, 'create-new');
        newBookBtn.appendChild(createSpan({ text: ` ${i18n.t('NEW_BOOK')}` }));
        newBookBtn.addEventListener('click', () => {
            new CreateBookModal(this.app, this.plugin, async (newBook) => {
                if (newBook) {
                    this.plugin.settings.lastBookId = newBook.basic.uuid;
                    await this.plugin.saveSettings();
                    await this.refreshView();
                    new Notice(i18n.t('SWITCHED_TO_BOOK', { title: newBook.basic.title }));
                }
            }).open();
        });

        const switchBookBtn = toolbar.createEl('button', { cls: 'book-smith-toolbar-btn' });
        setIcon(switchBookBtn, 'switch');
        switchBookBtn.appendChild(createSpan({ text: ` ${i18n.t('SWITCH_BOOK')}` }));
        switchBookBtn.addEventListener('click', () => {
            this.switchBook();
        });

        const manageBookBtn = toolbar.createEl('button', { cls: 'book-smith-toolbar-btn' });
        setIcon(manageBookBtn, 'library');
        manageBookBtn.appendChild(createSpan({ text: ` ${i18n.t('MANAGE_BOOK')}` }));
        manageBookBtn.addEventListener('click', async () => {
            new ManageBooksModal(this.app, this.plugin, async (result) => {
                if (result.type === 'imported' && result.bookId) {
                    // 处理导入书籍的情况
                    this.plugin.settings.lastBookId = result.bookId;
                    await this.plugin.saveSettings();
                    await this.refreshView();
                    new Notice(i18n.t('IMPORTED_AND_SWITCHED'));
                } else if (result.bookId === this.currentBook?.basic.uuid) {
                    if (result.type === 'deleted') {
                        this.plugin.settings.lastBookId = undefined;
                        await this.plugin.saveSettings();
                        this.currentBook = null;
                        await this.refreshView();
                        new Notice(i18n.t('CURRENT_BOOK_DELETED'));
                    } else if (result.type === 'edited') {
                        await this.refreshView();
                    }
                }
            }).open();
        });

        // 添加帮助按钮和提示
        const helpBtnContainer = toolbar.createDiv({ cls: 'book-smith-help-container' });
        const helpBtn = helpBtnContainer.createEl('button', { cls: 'book-smith-toolbar-btn' });
        setIcon(helpBtn, 'help-circle');

        helpBtnContainer.createEl('div', {
            cls: 'book-smith-help-tooltip',
            text: i18n.t('HELP_TOOLTIP')
        });
    }

    private async renderContent(container: HTMLElement) {
        container.createDiv({ cls: 'book-smith-divider' });
        const bookContent = container.createDiv({ cls: 'book-smith-content' });

        // Get currently selected book
        const currentBookId = this.plugin.settings.lastBookId;
        if (!currentBookId || !this.currentBook) {
            this.renderEmptyState(bookContent);
            container.createDiv({ cls: 'book-smith-bottom-divider' });
            return;
        }

        // Render book title
        const titleSection = bookContent.createDiv({ cls: 'book-smith-book-header' });

        // Add cover
        const coverContainer = titleSection.createDiv({ cls: 'book-smith-header-cover' });
        const settingsButton = coverContainer.createEl('button', {
            cls: 'book-smith-book-header-settings-btn',
            attr: {
                type: 'button',
                'aria-label': 'View settings'
            }
        });
        settingsButton.createSpan({
            cls: 'book-smith-book-header-settings-glyph',
            text: '⚙︎'
        });
        settingsButton.addEventListener('click', () => {
            new BookViewSettingsModal(this.app, this.plugin, this.currentBook, () => {
                void this.refreshView();
            }).open();
        });

        if (this.currentBook.basic.cover) {
            coverContainer.createEl('img', {
                attr: {
                    src: this.app.vault.adapter.getResourcePath(this.currentBook.basic.cover)
                }
            });
        }

        const titleContent = titleSection.createDiv({ cls: 'book-smith-header-content' });
        titleContent.createEl('h2', {
            text: `${this.currentBook.basic.title}`,
            cls: 'book-smith-title'
        });
        if (this.currentBook.basic.subtitle) {
            titleContent.createEl('p', {
                text: this.currentBook.basic.subtitle,
                cls: 'book-smith-subtitle'
            });
        }

        // Render chapter tree
        const treeSection = bookContent.createDiv({ cls: 'book-smith-chapter-tree' });
        this.renderChapterTree(treeSection);

        container.createDiv({ cls: 'book-smith-bottom-divider' });
    }

    private renderChapterTree(container: HTMLElement) {
        if (!this.currentBook) return;

        const refreshTree = async () => {
            await this.loadBook();
            container.empty();
            if (!this.currentBook) return;

            const refreshedBookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
            new ChapterTree(
                container,
                this.app,
                refreshedBookPath,
                this.plugin.bookManager,
                refreshTree
            ).render(this.currentBook);

            const content = this.containerEl.children[1] as HTMLElement;
            content.querySelector('.book-smith-stats')?.remove();
            this.renderStats(content);
        };

        const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
        new ChapterTree(
            container,
            this.app,
            bookPath,
            this.plugin.bookManager,
            refreshTree
        ).render(this.currentBook);
    }

    private renderEmptyState(container: HTMLElement) {
        const emptyState = container.createDiv({ cls: 'book-smith-empty-state' });
        emptyState.createEl('p', {
            text: i18n.t('WELCOME_MESSAGE'),
            cls: 'book-smith-empty-title'
        });
        emptyState.createEl('p', {
            text: i18n.t('EMPTY_STATE_HINT'),
            cls: 'book-smith-empty-desc'
        });
    }

    private renderStats(container: HTMLElement) {
        container.querySelector('.book-smith-stats')?.remove();

        const visibility = this.plugin.settings.bookView?.leftPanelInfo;
        const metricMode = visibility?.metricMode === 'pages' ? 'pages' : 'words';
        const wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
        const settings = {
            enabled: visibility?.enabled ?? true,
            todayWords: visibility?.todayWords ?? true,
            totalWords: visibility?.totalWords ?? true,
            completion: visibility?.completion ?? true,
            writingDays: visibility?.writingDays ?? true,
            dailyAverage: visibility?.dailyAverage ?? true
        };

        const hasVisibleStats = settings.todayWords || settings.totalWords || settings.completion || settings.writingDays || settings.dailyAverage;
        if (!settings.enabled || !hasVisibleStats) {
            return;
        }

        const statsContainer = container.createDiv({ cls: 'book-smith-stats' });
        if (!this.currentBook) return;

        // Today's word count
        if (settings.todayWords) {
            const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
            const todayValue = this.getDisplayedTodayValue(today);
            const todayWords = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
            const todayWordsLabel = todayWords.createSpan();
            setIcon(todayWordsLabel, 'pencil');
            todayWordsLabel.appendChild(createSpan({ text: ` ${this.getMetricLabel('today', metricMode)}` }));
            todayWords.createEl('span', {
                cls: 'book-smith-stat-value',
                text: this.getTodayStatDisplayText(todayValue, metricMode, wordsPerPage)
            });
        }

        // Total word count
        if (settings.totalWords) {
            const wordCount = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
            const wordCountLabel = wordCount.createSpan();
            setIcon(wordCountLabel, 'document');
            wordCountLabel.appendChild(createSpan({ text: ` ${this.getMetricLabel('total', metricMode)}` }));
            const totalValue = this.getMetricValueText(this.currentBook.stats.total_words, metricMode, wordsPerPage);
            const targetValue = this.currentBook.stats.target_total_words
                ? this.getMetricValueText(this.currentBook.stats.target_total_words, metricMode, wordsPerPage)
                : '';
            const unitText = this.getMetricUnitText(metricMode);
            wordCount.createEl('span', {
                cls: 'book-smith-stat-value',
                text: `${totalValue}${unitText}${this.currentBook.stats.target_total_words
                    ? ` / ${targetValue}${unitText}`
                    : ''
                    }`
            });
        }

        // Writing progress
        if (settings.completion) {
            const progress = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
            const progressLabel = progress.createSpan();
            setIcon(progressLabel, 'target');
            progressLabel.appendChild(createSpan({ text: ` ${i18n.t('CHAPTER_COMPLETION')}` }));

            const targetWords = this.currentBook.stats.target_total_words || 0;
            const totalWords = this.currentBook.stats.total_words || 0;
            const completionPercent = targetWords > 0
                ? Math.round(Math.min(100, (totalWords / targetWords) * 100))
                : Math.round((this.currentBook.stats.progress_by_chapter || 0) * 100);

            progress.createEl('span', {
                cls: 'book-smith-stat-value',
                text: `${completionPercent}%`
            });
        }

        // Writing days
        if (settings.writingDays) {
            const writingDaysValue = this.getDisplayedWritingDays();
            const duration = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
            const durationLabel = duration.createSpan();
            setIcon(durationLabel, 'clock');
            durationLabel.appendChild(createSpan({ text: ` ${i18n.t('WRITING_DAYS')}` }));
            duration.createEl('span', {
                cls: 'book-smith-stat-value',
                text: `${writingDaysValue}${i18n.t('DAY_UNIT')}`
            });
        }

        // Average daily words
        if (settings.dailyAverage) {
            const averageValue = this.getDisplayedDailyAverage();
            const average = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
            const averageLabel = average.createSpan();
            setIcon(averageLabel, 'calendar-clock');
            averageLabel.appendChild(createSpan({ text: ` ${this.getMetricLabel('average', metricMode)}` }));
            average.createEl('span', {
                cls: 'book-smith-stat-value',
                text: this.getMetricDisplayText(averageValue, metricMode, wordsPerPage)
            });
        }
    }

    private getWritingDisplayMode(): 'new-material-net' | 'daily-output' | 'raw' {
        const mode = this.plugin.settings.stats?.leftPaneWritingDisplayMode;
        if (mode === 'new-material-net' || mode === 'daily-output' || mode === 'raw') {
            return mode;
        }
        return 'daily-output';
    }

    private getDailyProgressEntry(date: string): DailyProgressEntry | null {
        const entry = this.currentBook?.stats?.daily_progress?.[date];
        if (!entry) return null;
        const fallbackWordsDeleted = entry.words_deleted ?? Math.abs(entry.negative_change || 0);
        const fallbackIterationDeletions = entry.iteration_deletions || 0;
        const fallbackOldDeletions = Math.max(0, fallbackWordsDeleted - fallbackIterationDeletions);
        return {
            positive_change: entry.positive_change || 0,
            negative_change: entry.negative_change || 0,
            net_change: entry.net_change || 0,
            words_added: entry.words_added ?? entry.positive_change ?? 0,
            words_deleted: fallbackWordsDeleted,
            iteration_deletions: fallbackIterationDeletions,
            old_deletions: entry.old_deletions ?? fallbackOldDeletions
        };
    }

    private getRawWritingValue(entry: DailyProgressEntry): number {
        const mode = this.getWritingDisplayMode();
        if (mode === 'daily-output') {
            return (entry.words_added ?? entry.positive_change ?? 0) - (entry.iteration_deletions || 0);
        }
        if (mode === 'raw') {
            return (entry.words_added ?? entry.positive_change ?? 0) - (entry.words_deleted ?? Math.abs(entry.negative_change || 0));
        }
        return entry.net_change || 0;
    }

    private getDisplayedWritingValue(entry: DailyProgressEntry): number {
        return this.getRawWritingValue(entry);
    }

    private getDisplayedTodayValue(date: string): number {
        const activePeriod = this.getActivePeriodForDate(date);
        if (!activePeriod) {
            return 0;
        }

        const entry = this.getDailyProgressEntry(date);
        if (!entry) {
            return this.currentBook?.stats?.daily_words?.[date] || 0;
        }
        return this.getDisplayedWritingValue(entry);
    }

    private getDisplayedWritingDays(): number {
        const periods = this.getWritingPeriods();
        if (periods.length === 0) {
            return this.currentBook?.stats?.writing_days || 0;
        }

        const coveredDates = new Set<string>();
        periods.forEach((period) => {
            this.getPeriodRangeDates(period).forEach((date) => {
                const value = this.getWritingValueForDate(date);
                if (value !== 0) {
                    coveredDates.add(date);
                }
            });
        });

        return coveredDates.size;
    }

    private getDisplayedDailyAverage(): number {
        if (!this.currentBook) return 0;

        const periods = this.getWritingPeriods();
        if (periods.length === 0) {
            return Math.round(this.currentBook.stats?.average_daily_words || 0);
        }

        const currentPeriod = this.getCurrentOrMostRecentPeriod(periods);
        if (!currentPeriod) return 0;

        const datesInRange = this.getPeriodAverageRangeDates(currentPeriod);
        if (datesInRange.length === 0) return 0;

        let totalValue = 0;
        let denominator = 0;
        let nonZeroDays = 0;

        datesInRange.forEach((date) => {
            const value = this.getWritingValueForDate(date);
            totalValue += value;

            if (value !== 0) {
                nonZeroDays += 1;
            }

            const requiredWeight = this.getRequiredDayWeight(date, currentPeriod);
            if (currentPeriod.averageMissedScheduledDays) {
                denominator += requiredWeight;
            } else if (value !== 0 && requiredWeight > 0) {
                denominator += requiredWeight;
            }
        });

        if (denominator <= 0) {
            if (nonZeroDays <= 0) return 0;
            return Math.round(totalValue / nonZeroDays);
        }

        return Math.round(totalValue / denominator);
    }

    private getWritingPeriods(): WritingPeriodSettings[] {
        if (!this.currentBook) return [];

        const fromStats = this.currentBook.stats?.writing_periods || [];
        if (fromStats.length > 0) {
            return fromStats
                .map((period, index) => this.normalizeWritingPeriod(period, index))
                .sort((a, b) => a.startDate.localeCompare(b.startDate));
        }

        return [this.createDefaultPeriodFromBook()];
    }

    private normalizeWeekdays(days: number[]): number[] {
        const set = new Set<number>();
        days.forEach((day) => {
            if (Number.isInteger(day) && day >= 0 && day <= 6) {
                set.add(day);
            }
        });
        return Array.from(set).sort((a, b) => a - b);
    }

    private normalizeAverageWindowDays(value: number): number {
        const allowed = new Set([0, 7, 14, 30, 90]);
        const normalized = Math.round(value);
        return allowed.has(normalized) ? normalized : 0;
    }

    private normalizeWritingPeriod(period: BookWritingPeriod, index: number): WritingPeriodSettings {
        const fallbackStart = this.getProjectCreationLogicalISODate()
            || getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        const startDate = this.isISODate(period.start_date) ? period.start_date : fallbackStart;
        const endDate = this.isISODate(period.end_date || '') ? period.end_date : undefined;

        return {
            id: period.id || `period-${index + 1}`,
            name: period.name || `Period ${index + 1}`,
            startDate,
            endDate: endDate && endDate >= startDate ? endDate : undefined,
            mode: period.schedule?.mode === 'days-per-week' ? 'days-per-week' : 'specific-days',
            selectedWeekdays: this.normalizeWeekdays(period.schedule?.selected_weekdays || []),
            daysPerWeek: Math.max(0, Math.min(7, Math.round(period.schedule?.days_per_week ?? 7))),
            averageMissedScheduledDays: period.average_missed_scheduled_days ?? true,
            averageWindowDays: this.normalizeAverageWindowDays(period.average_window_days ?? 0)
        };
    }

    private createDefaultPeriodFromBook(): WritingPeriodSettings {
        const startDate = this.getProjectCreationLogicalISODate()
            || getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        return {
            id: 'default-period',
            name: 'First Draft',
            startDate,
            mode: 'specific-days',
            selectedWeekdays: [0, 1, 2, 3, 4, 5, 6],
            daysPerWeek: 7,
            averageMissedScheduledDays: true,
            averageWindowDays: 0
        };
    }

    private getProjectCreationLogicalISODate(): string | null {
        const createdAt = this.currentBook?.basic?.created_at;
        if (!createdAt) return null;
        const createdDate = new Date(createdAt);
        if (Number.isNaN(createdDate.getTime())) return null;
        return getLogicalDayISODate(createdDate, this.plugin.settings.focus.dailyRolloverMinutes);
    }

    private getCurrentOrMostRecentPeriod(periods: WritingPeriodSettings[]): WritingPeriodSettings | null {
        const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        const active = periods
            .filter((period) => this.isDateInPeriod(today, period))
            .sort((a, b) => a.startDate.localeCompare(b.startDate));
        if (active.length > 0) return active[active.length - 1];

        const started = periods
            .filter((period) => period.startDate <= today)
            .sort((a, b) => a.startDate.localeCompare(b.startDate));

        return started.length > 0 ? started[started.length - 1] : periods[0] || null;
    }

    private getActivePeriodForDate(date: string): WritingPeriodSettings | null {
        const periods = this.getWritingPeriods();
        const matches = periods
            .filter((period) => this.isDateInPeriod(date, period))
            .sort((a, b) => a.startDate.localeCompare(b.startDate));
        return matches.length > 0 ? matches[matches.length - 1] : null;
    }

    private isDateInPeriod(date: string, period: WritingPeriodSettings): boolean {
        if (date < period.startDate) return false;
        if (period.endDate && date > period.endDate) return false;
        return true;
    }

    private getPeriodRangeDates(period: WritingPeriodSettings): string[] {
        const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        const end = period.endDate && period.endDate < today ? period.endDate : today;
        if (period.startDate > end) return [];
        return this.enumerateISODateRange(period.startDate, end);
    }

    private getPeriodAverageRangeDates(period: WritingPeriodSettings): string[] {
        const periodDates = this.getPeriodRangeDates(period);
        if (periodDates.length === 0) return [];

        if (period.averageWindowDays <= 0) {
            return periodDates;
        }

        const end = periodDates[periodDates.length - 1];
        const rollingStart = this.shiftISODate(end, -(period.averageWindowDays - 1));
        const start = rollingStart > period.startDate ? rollingStart : period.startDate;
        return this.enumerateISODateRange(start, end);
    }

    private enumerateISODateRange(startIso: string, endIso: string): string[] {
        if (!this.isISODate(startIso) || !this.isISODate(endIso) || startIso > endIso) {
            return [];
        }

        const dates: string[] = [];
        let cursor = startIso;
        while (cursor <= endIso) {
            dates.push(cursor);
            cursor = this.shiftISODate(cursor, 1);
        }
        return dates;
    }

    private shiftISODate(dateIso: string, days: number): string {
        const date = this.parseISODateLocal(dateIso);
        date.setDate(date.getDate() + days);
        return this.toLocalISODate(date);
    }

    private parseISODateLocal(dateIso: string): Date {
        const [year, month, day] = dateIso.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    private isISODate(value: string): boolean {
        return /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    private getWritingValueForDate(date: string): number {
        const entry = this.getDailyProgressEntry(date);
        if (entry) {
            return this.getRawWritingValue(entry);
        }
        return this.currentBook?.stats?.daily_words?.[date] || 0;
    }

    private getRequiredDayWeight(date: string, period: WritingPeriodSettings): number {
        if (period.mode === 'days-per-week') {
            return Math.max(0, Math.min(7, period.daysPerWeek)) / 7;
        }

        const weekday = this.parseISODateLocal(date).getDay();
        return period.selectedWeekdays.includes(weekday) ? 1 : 0;
    }

    private getMetricDisplayText(valueInWords: number, mode: 'words' | 'pages', wordsPerPage: number): string {
        const unitText = this.getMetricUnitText(mode);
        return `${this.getMetricValueText(valueInWords, mode, wordsPerPage)}${unitText}`;
    }

    private getTodayStatDisplayText(valueInWords: number, mode: 'words' | 'pages', wordsPerPage: number): string {
        const showGoal = this.currentBook?.stats?.show_daily_goal_in_today_stat ?? false;
        const baseGoalInWords = this.currentBook?.stats?.daily_goal_words || 0;
        const currentBookId = this.currentBook?.basic?.uuid || '';
        const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        let goalInWords = baseGoalInWords;
        if (currentBookId && this.plugin.focusHeaderIndicator) {
            goalInWords = this.plugin.focusHeaderIndicator.getMotivatedGoalWords(baseGoalInWords, currentBookId, today);
        }

        if (!showGoal || goalInWords <= 0) {
            return this.getMetricDisplayText(valueInWords, mode, wordsPerPage);
        }

        const currentValue = this.getMetricValueText(valueInWords, mode, wordsPerPage);
        const goalValue = this.getMetricValueText(goalInWords, mode, wordsPerPage);
        return `${currentValue} / ${goalValue}${this.getMetricUnitText(mode)}`;
    }

    private getMetricLabel(labelType: 'today' | 'total' | 'average', mode: 'words' | 'pages'): string {
        const base = labelType === 'today'
            ? i18n.t('TODAY_WORDS')
            : labelType === 'total'
                ? i18n.t('TOTAL_WORDS')
                : i18n.t('AVERAGE_DAILY_WORDS');

        if (mode === 'pages' && labelType === 'total') {
            const englishAdjusted = base.replace(/words?/i, 'pages');
            if (englishAdjusted !== base) return englishAdjusted;
            return 'Total pages';
        }

        return base;
    }

    private getMetricUnitText(mode: 'words' | 'pages'): string {
        if (mode === 'words') {
            return i18n.t('WORD_UNIT');
        }

        // Keep full unit wording for left-pane pages mode in English.
        const pagesModeLabel = i18n.t('PAGES_MODE');
        if (pagesModeLabel.toLowerCase() === 'pages') {
            return ' pages';
        }

        return i18n.t('PAGE_UNIT_SHORT');
    }

    private getMetricValueText(valueInWords: number, mode: 'words' | 'pages', wordsPerPage: number): string {
        if (mode === 'pages') {
            const pages = valueInWords / wordsPerPage;
            return Number.isInteger(pages) ? String(pages) : pages.toFixed(1);
        }

        if (!Number.isFinite(valueInWords)) return '0';
        const rounded = Math.round(valueInWords);
        if (rounded === 0) return '0';
        return rounded.toLocaleString('en-US');
    }

    private toLocalISODate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // === Interaction handlers ===
    private async switchBook() {
        const books = await this.plugin.bookManager.getAllBooks();
        if (books.length === 0) {
            new Notice(i18n.t('NO_BOOKS_TO_SWITCH'));
            return;
        }

        new SwitchBookModal(this.app, this.plugin, books, async (selectedBook) => {
            this.plugin.settings.lastBookId = selectedBook.basic.uuid;
            await this.plugin.saveSettings();
            await this.refreshView();
            new Notice(i18n.t('SWITCHED_TO_BOOK', { title: selectedBook.basic.title }));
        }).open();
    }
}
