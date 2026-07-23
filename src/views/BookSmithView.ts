// === Import declarations ===
import { ItemView, WorkspaceLeaf, Notice, TFolder, TFile, TAbstractFile, setIcon, MarkdownView } from 'obsidian';
import BookSmithPlugin from '../main';
import { Book, BookWritingPeriod } from '../types/book';
import { getLogicalDayISODate } from '../utils/logicalDay';
import { CreateBookModal } from '../modals/CreateBookModal';
import { ManageBooksModal } from '../modals/ManageBooksModal';
import { ChapterTree } from '../components/ChapterTree';
import { FileEventManager } from '../services/FileEventManager';
import { ReferenceManager } from '../services/ReferenceManager';
import { i18n } from '../i18n/i18n';
import { formatWordCount } from '../utils/wordCount';
import { BookViewSettingsModal } from '../modals/BookViewSettingsModal';
import { LeftPaneStatKey, LEFT_PANE_STAT_VISIBILITY_FIELD, LEFT_PANE_STAT_DEFAULT_VISIBLE, sanitizeLeftPaneStatOrder } from '../settings/settings';
import { StreakInfo, computeStreakInfo } from '../utils/writingStreak';

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
    /** Min net words in a day for it to count as a writing day (streak). */
    thresholdWords: number;
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
    /**
     * Reference to the small "jump to active file's project" button in the
     * book-header cover. Ephemeral — re-created on each renderContent pass.
     * Stored on `this` so the file-open listener can flip its visibility
     * without a full re-render.
     */
    private jumpToProjectBtn: HTMLElement | null = null;

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
        // Re-check whether the active file belongs to a different project
        // whenever the user opens a file — that's the only moment the
        // "jump to active file's project" corner button's visibility can change.
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                void this.handleActiveFileProjectSync();
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
                    // In-place rename updates the matching node's path/title
                    // (preserving its metadata). Add/remove from moves is
                    // handled at render time by ChapterTree's disk
                    // reconciliation, so we just refresh when the book is
                    // touched on either side.
                    const updatedBook = await this.fileEventManager.handleBookModify(file, this.currentBook, oldPath);
                    const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
                    const touchedBook = updatedBook
                        || oldPath.startsWith(bookPath + '/')
                        || file.path.startsWith(bookPath + '/');
                    if (touchedBook) {
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
                if (!(file instanceof TFile || file instanceof TFolder)) return;
                const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
                if (!file.path.startsWith(bookPath) || file.path.endsWith('book-config.json')) return;

                // New entries appear in the pane via ChapterTree's render-time
                // disk reconciliation — just refresh (and update stats).
                await this.plugin.statsManager.updateStatsForFile();
                await this.refreshView();
            })
        );

        // Listen for file/folder deletion
        this.registerEvent(
            this.app.vault.on('delete', async (file: TAbstractFile) => {
                if (!this.currentBook) return;
                if (!(file instanceof TFile || file instanceof TFolder)) return;
                const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
                if (!file.path.startsWith(bookPath) || file.path.endsWith('book-config.json')) return;

                // Deleted entries drop out of the pane via ChapterTree's
                // render-time disk reconciliation — just refresh (and stats).
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

        const newBookBtn = toolbar.createEl('button', { cls: 'book-smith-toolbar-btn book-smith-toolbar-btn-new' });
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

        const manageBookBtn = toolbar.createEl('button', { cls: 'book-smith-toolbar-btn book-smith-toolbar-btn-manage' });
        setIcon(manageBookBtn, 'library');
        manageBookBtn.appendChild(createSpan({ text: ` ${i18n.t('MANAGE_BOOK')}` }));
        manageBookBtn.addEventListener('click', async () => {
            new ManageBooksModal(this.app, this.plugin, async (result) => {
                if (result.type === 'selected' && result.bookId) {
                    // Switch action moved from the old Switch Projects modal.
                    const target = await this.plugin.bookManager.getBookById(result.bookId);
                    this.plugin.settings.lastBookId = result.bookId;
                    await this.plugin.saveSettings();
                    await this.refreshView();
                    if (target) {
                        new Notice(i18n.t('SWITCHED_TO_BOOK', { title: target.basic.title }));
                    }
                } else if (result.type === 'imported' && result.bookId) {
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

        // The jump button lives in the book-header cover, so it only exists
        // while a project is loaded. Clear the stale reference before rendering
        // — if we drop back to the empty state, there's no button to toggle.
        this.jumpToProjectBtn = null;

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

        // "Jump to active file's project" button — top-right corner of the
        // cover, mirroring the settings gear at the bottom-right. Visible only
        // when the active file belongs to a DIFFERENT project than the one
        // currently shown; otherwise hidden (has `is-visible` class toggled).
        const jumpBtn = coverContainer.createEl('button', {
            cls: 'book-smith-book-header-jump-btn',
            attr: {
                type: 'button',
                'aria-label': 'Switch to active file\'s project'
            }
        });
        // Use a Unicode glyph (mirroring the settings gear approach) so the
        // icon's pixel size is governed by font-size and matches the gear.
        // The previous Lucide `switch` SVG path read tiny inside the 28px
        // button regardless of width overrides.
        jumpBtn.createSpan({
            cls: 'book-smith-book-header-jump-glyph',
            text: '⇄'
        });
        jumpBtn.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            void this.switchToActiveFileProject();
        });
        this.jumpToProjectBtn = jumpBtn;
        void this.updateJumpToProjectButtonVisibility();

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
                refreshTree,
                this.getTreePageNumbersProvider()
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
            refreshTree,
            this.getTreePageNumbersProvider()
        ).render(this.currentBook);
    }

    /** Provider for the optional per-file size labels in the chapter tree. */
    private getTreePageNumbersProvider() {
        return {
            mode: () => {
                const m = this.plugin.settings.treeFileMetric;
                return (m === 'pages' || m === 'words') ? m : 'off' as const;
            },
            wordsPerPage: () => this.plugin.settings.stats?.wordsPerPage || 250,
            countWords: (text: string) => this.plugin.statsManager.countWords(text)
        };
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
        const enabled = visibility?.enabled ?? true;
        const vis: Record<string, boolean> = {
            todayWords: visibility?.todayWords ?? LEFT_PANE_STAT_DEFAULT_VISIBLE.today,
            totalWords: visibility?.totalWords ?? LEFT_PANE_STAT_DEFAULT_VISIBLE.total,
            completion: visibility?.completion ?? LEFT_PANE_STAT_DEFAULT_VISIBLE.completion,
            writingDays: visibility?.writingDays ?? LEFT_PANE_STAT_DEFAULT_VISIBLE.writingDays,
            dailyAverage: visibility?.dailyAverage ?? LEFT_PANE_STAT_DEFAULT_VISIBLE.dailyAverage,
            currentFile: visibility?.currentFile ?? LEFT_PANE_STAT_DEFAULT_VISIBLE.currentFile,
            streak: visibility?.streak ?? LEFT_PANE_STAT_DEFAULT_VISIBLE.streak
        };

        const order = sanitizeLeftPaneStatOrder(visibility?.order);
        const isVisible = (key: LeftPaneStatKey) => vis[LEFT_PANE_STAT_VISIBILITY_FIELD[key]];
        if (!enabled || !order.some(isVisible)) {
            return;
        }
        if (!this.currentBook) return;
        const book = this.currentBook;

        const statsContainer = container.createDiv({ cls: 'book-smith-stats' });

        // One render closure per stat, dispatched in the user's chosen order.
        const renderers: Record<LeftPaneStatKey, () => void> = {
            today: () => {
                const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
                const todayValue = this.getDisplayedTodayValue(today);
                const item = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
                const label = item.createSpan();
                setIcon(label, 'pencil');
                label.appendChild(createSpan({ text: ` ${this.getMetricLabel('today', metricMode)}` }));
                item.createEl('span', {
                    cls: 'book-smith-stat-value',
                    text: this.getTodayStatDisplayText(todayValue, metricMode, wordsPerPage)
                });
            },
            currentFile: () => {
                // Word/page count of the active file only — and only when it
                // lives under the BookSmith book root; anything else stays 0.
                const item = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
                const label = item.createSpan();
                setIcon(label, 'file-text');
                label.appendChild(createSpan({ text: ' Current Scene' }));
                const valueEl = item.createEl('span', {
                    cls: 'book-smith-stat-value',
                    text: this.getMetricDisplayText(0, metricMode, wordsPerPage)
                });

                const activeFile = this.app.workspace.getActiveFile();
                const root = this.plugin.settings.defaultBookPath;
                const inBookFolder = !!(activeFile && root
                    && (activeFile.path === root || activeFile.path.startsWith(root + '/')));
                if (!activeFile || !inBookFolder) return;

                // Only trust the editor when it is verifiably showing the active
                // file: `workspace.activeEditor` lags on file switches/moves,
                // which showed 0 right after moving a file and the PREVIOUS
                // file's count after switching. On any mismatch, read the file
                // from the vault instead and patch the value in when resolved.
                const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (mdView?.file?.path === activeFile.path && mdView.editor) {
                    const words = this.plugin.statsManager.countWords(mdView.editor.getValue());
                    valueEl.setText(this.getMetricDisplayText(words, metricMode, wordsPerPage));
                    return;
                }
                void this.app.vault.cachedRead(activeFile)
                    .then((content) => {
                        if (!valueEl.isConnected) return; // stats re-rendered meanwhile
                        const words = this.plugin.statsManager.countWords(content);
                        valueEl.setText(this.getMetricDisplayText(words, metricMode, wordsPerPage));
                    })
                    .catch(() => { /* unreadable — leave 0 */ });
            },
            total: () => {
                const item = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
                const label = item.createSpan();
                setIcon(label, 'document');
                label.appendChild(createSpan({ text: ` ${this.getMetricLabel('total', metricMode)}` }));
                const totalValue = this.getMetricValueText(book.stats.total_words, metricMode, wordsPerPage);
                const targetValue = book.stats.target_total_words
                    ? this.getMetricValueText(book.stats.target_total_words, metricMode, wordsPerPage)
                    : '';
                const unitText = this.getMetricUnitText(metricMode);
                item.createEl('span', {
                    cls: 'book-smith-stat-value',
                    text: `${totalValue}${unitText}${book.stats.target_total_words ? ` / ${targetValue}${unitText}` : ''}`
                });
            },
            completion: () => {
                const item = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
                const label = item.createSpan();
                setIcon(label, 'target');
                label.appendChild(createSpan({ text: ` ${i18n.t('CHAPTER_COMPLETION')}` }));
                const targetWords = book.stats.target_total_words || 0;
                const totalWords = book.stats.total_words || 0;
                const completionPercent = targetWords > 0
                    ? Math.round(Math.min(100, (totalWords / targetWords) * 100))
                    : Math.round((book.stats.progress_by_chapter || 0) * 100);
                item.createEl('span', { cls: 'book-smith-stat-value', text: `${completionPercent}%` });
            },
            streak: () => {
                const streak = this.getWritingStreakInfo();
                const item = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
                const label = item.createSpan();
                setIcon(label, 'flame');
                label.appendChild(createSpan({ text: ' Streak' }));
                let text = '—';
                if (streak) {
                    const unit = visibility?.streakUnit === 'days' ? 'days' : 'weeks';
                    const count = unit === 'days' ? streak.daysWritten : streak.weeks;
                    const unitWord = unit === 'days'
                        ? (count === 1 ? 'day' : 'days')
                        : (count === 1 ? 'week' : 'weeks');
                    text = `${count} ${unitWord}`;
                    if (streak.required > 0) text += ` (${streak.met}/${streak.required})`;
                }
                item.createEl('span', { cls: 'book-smith-stat-value', text });
            },
            writingDays: () => {
                const writingDaysValue = this.getDisplayedWritingDays();
                const item = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
                const label = item.createSpan();
                setIcon(label, 'clock');
                label.appendChild(createSpan({ text: ` ${i18n.t('WRITING_DAYS')}` }));
                item.createEl('span', { cls: 'book-smith-stat-value', text: `${writingDaysValue}${i18n.t('DAY_UNIT')}` });
            },
            dailyAverage: () => {
                const averageValue = this.getDisplayedDailyAverage();
                const item = statsContainer.createDiv({ cls: 'book-smith-stat-item' });
                const label = item.createSpan();
                setIcon(label, 'calendar-clock');
                label.appendChild(createSpan({ text: ` ${this.getMetricLabel('average', metricMode)}` }));
                item.createEl('span', {
                    cls: 'book-smith-stat-value',
                    text: this.getMetricDisplayText(averageValue, metricMode, wordsPerPage)
                });
            }
        };

        for (const key of order) {
            if (isVisible(key)) renderers[key]();
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
        return {
            positive_change: entry.positive_change || 0,
            negative_change: entry.negative_change || 0,
            net_change: entry.net_change || 0,
            words_added: entry.words_added ?? entry.positive_change ?? 0,
            words_deleted: fallbackWordsDeleted
        };
    }

    private getRawWritingValue(entry: DailyProgressEntry): number {
        const mode = this.getWritingDisplayMode();
        if (mode === 'daily-output') {
            return Math.max(0, entry.net_change || 0);
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
        // No period gate here: today's writing always shows, even when no
        // writing period covers today (an ended/not-yet-started schedule
        // shouldn't make live typing read as 0 — that looks like a bug).
        // Periods still govern the streak, writing days, and averages.
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

    /**
     * Effective Daily Average display options. These are global display
     * settings now; the per-period stored values only serve as a legacy
     * fallback for configs saved before the move.
     */
    private getDailyAverageWindowDays(period: WritingPeriodSettings): number {
        const global = this.plugin.settings.stats?.dailyAverageWindowDays;
        return this.normalizeAverageWindowDays(global ?? period.averageWindowDays);
    }

    private getDailyAverageCountMissed(period: WritingPeriodSettings): boolean {
        return this.plugin.settings.stats?.dailyAverageCountMissedAsZero
            ?? period.averageMissedScheduledDays;
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

        const countMissedAsZero = this.getDailyAverageCountMissed(currentPeriod);
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
            if (countMissedAsZero) {
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
            thresholdWords: Math.max(1, Math.round(period.writing_day_threshold_words ?? 1)),
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
            thresholdWords: 1,
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

    // === Writing streak (semantics live in utils/writingStreak.ts) ===

    /** Net words written on a date (daily-output basis, mode-independent). */
    private getStreakDayValue(date: string): number {
        const entry = this.currentBook?.stats?.daily_progress?.[date];
        if (entry) return Math.max(0, entry.net_change || 0);
        return Math.max(0, this.currentBook?.stats?.daily_words?.[date] || 0);
    }

    private getWritingStreakInfo(): StreakInfo | null {
        const periods = this.getWritingPeriods();
        if (periods.length === 0) return null;
        const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        return computeStreakInfo(periods, (iso) => this.getStreakDayValue(iso), today);
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

        const windowDays = this.getDailyAverageWindowDays(period);
        if (windowDays <= 0) {
            return periodDates;
        }

        const end = periodDates[periodDates.length - 1];
        const rollingStart = this.shiftISODate(end, -(windowDays - 1));
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
            const englishAdjusted = base.replace(/words?/i, 'Pages');
            if (englishAdjusted !== base) return englishAdjusted;
            return 'Total Pages';
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

    /**
     * Jump the left pane to whatever project owns the currently open file.
     * Used by the corner button on the book-header cover. Resolves the owner
     * via SceneNotesManager's findBookForFile (walks upward from the file
     * looking for book-config.json).
     */
    /**
     * Called on every file-open. When the auto-switch setting is on and the
     * opened file belongs to a different project, switch the left pane to it.
     * Otherwise just refresh the corner "jump" button's visibility.
     */
    private async handleActiveFileProjectSync() {
        if (this.plugin.settings.autoSwitchProjectOnFileOpen !== false) {
            const switched = await this.maybeAutoSwitchToActiveFileProject();
            // A switch re-renders the whole view (which updates the jump button
            // and stats), so there's nothing left to do this pass.
            if (switched) return;
        }
        await this.updateJumpToProjectButtonVisibility();
        // Re-render the bottom-left stats so the "Current file" metric tracks
        // the newly active file (no project switch happened).
        this.renderStats(this.containerEl.children[1] as HTMLElement);
    }

    /**
     * Switch the left pane to the active file's owning project when it differs
     * from the current one. Returns true if a switch actually happened. Guarded
     * against rapid file changes so a slow owner-lookup can't switch us to a
     * book the user already navigated away from.
     */
    private async maybeAutoSwitchToActiveFileProject(): Promise<boolean> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;
        const startPath = activeFile.path;
        const owner = await this.plugin.sceneNotesManager.findBookForFile(activeFile.path);
        // Discard if the user moved to another file while we were resolving.
        if ((this.app.workspace.getActiveFile()?.path ?? null) !== startPath) return false;
        if (!owner || owner.uuid === this.currentBook?.basic.uuid) return false;
        this.plugin.settings.lastBookId = owner.uuid;
        await this.plugin.saveSettings();
        await this.refreshView();
        return true;
    }

    private async switchToActiveFileProject() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No file open — nothing to switch to');
            return;
        }
        const owner = await this.plugin.sceneNotesManager.findBookForFile(activeFile.path);
        if (!owner) {
            new Notice('Active file doesn\'t belong to any BookSmith project');
            return;
        }
        if (owner.uuid === this.currentBook?.basic.uuid) {
            new Notice('Already on this file\'s project');
            return;
        }
        this.plugin.settings.lastBookId = owner.uuid;
        await this.plugin.saveSettings();
        await this.refreshView();
        new Notice(i18n.t('SWITCHED_TO_BOOK', { title: owner.title }));
    }

    /**
     * Re-check whether the active file belongs to a different project than
     * the one currently shown, and toggle the corner "jump" button's visibility
     * accordingly. Called on first paint and on every file-open event.
     *
     * Guarded against rapid file switches: capture the path we started with
     * and discard the result if the active file changed (or the button was
     * torn down) while we were waiting on findBookForFile.
     */
    private async updateJumpToProjectButtonVisibility() {
        const btn = this.jumpToProjectBtn;
        if (!btn) return;
        const activeFile = this.app.workspace.getActiveFile();
        const startPath = activeFile?.path ?? null;
        let shouldShow = false;
        let ownerTitle: string | null = null;
        if (activeFile) {
            const owner = await this.plugin.sceneNotesManager.findBookForFile(activeFile.path);
            if (owner && owner.uuid !== this.currentBook?.basic.uuid) {
                shouldShow = true;
                ownerTitle = owner.title;
            }
        }
        // Discard stale resolutions: button gone, or active file changed.
        if (this.jumpToProjectBtn !== btn) return;
        if ((this.app.workspace.getActiveFile()?.path ?? null) !== startPath) return;
        if (shouldShow && ownerTitle) {
            btn.setAttribute('aria-label', `Switch to "${ownerTitle}" (owns the active file)`);
        }
        btn.toggleClass('is-visible', shouldShow);
    }
}
