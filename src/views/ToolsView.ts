import { ToolsViewToolbox } from './ToolsViewToolbox';
import { DebugStatsModal } from '../modals/DebugStatsModal';
import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf, setIcon } from 'obsidian';
import { FocusToolView } from '../components/FocusToolView';
import BookSmithPlugin from '../main';
import { i18n } from '../i18n/i18n';
import { BookSelectionModal } from '../modals/BookSelectionModal';
import { Book, ChapterNode } from '../types/book';
import { BookOwner } from '../services/SceneNotesManager';
import { SceneNote } from '../types/sceneNote';
import { NavigatorFolderModal } from '../modals/NavigatorFolderModal';
import { getLogicalDayISODate } from '../utils/logicalDay';
import { ToolsViewStats } from './ToolsViewStats';
import { classifyStreakDays, StreakDayClass, normalizeStreakPeriods, getWeekQuotaDays, getWeekStartISO } from '../utils/writingStreak';

type DailyProgressEntry = {
    positive_change: number;
    negative_change: number;
    net_change: number;
    words_added?: number;
    words_deleted?: number;
    iteration_deletions?: number;
    old_deletions?: number;
};

export class ToolView extends ItemView {
            public toolbox: ToolsViewToolbox | undefined;
        // Opens the debug stats modal for a given date
        public openDebugStatsPopup(date: string) {
            const book = this.statsBooks.find(b => b.basic.uuid === this.statsSourceBookId);
            if (!book) return;
            new DebugStatsModal(document.body, book, date, () => {
                this.plugin.bookManager.updateBook(book.basic.uuid, book);
                this.refresh();
            }).open();
        }
    public normalView: HTMLElement | null = null;
    public focusView: FocusToolView | null = null;
    public isNavigatorMode = false;
    public navigatorBook: Book | null = null;
    public navigatorFolderPath: string | null = null;
    public navigatorFiles: TFile[] = [];
    public navigatorEventsBound = false;
    public navigatorHoverTriggeredPath: string | null = null;
    public statsViewMonth: Date = new Date();
    public selectedStatsDate: string = getLogicalDayISODate(new Date());
    public statsDailyWords: Record<string, number> = {};
    public statsDailyProgress: Record<string, DailyProgressEntry> = {};
    public statsDailyFocusMinutes: Record<string, number> = {};
    public statsDailyComments: Record<string, string> = {};
    public statsPeriodComments: Record<string, string> = {};
    public statsBooks: Book[] = [];
    public statsSourceBookId: string | 'global' = 'global';
    public statsDisplayMode: 'words' | 'pages' | 'pomodoros' | 'hours' = 'words';
    public statsWritingDisplayMode: 'new-material-net' | 'daily-output' | 'raw' = 'new-material-net';
    public statsPeriodMode: 'day' | 'week' | 'month' | 'year' = 'day';
    public wordsPerPage = 250;
    public statsSettingsOpen = false;
    public statsPeriodSettingsOpen = false;
    public statsSourceMenuOpen = false;
    public statsYearEditing = false;
    public statsRefreshTimer: number | null = null;
    private statsChangeUnsubscribe: (() => void) | null = null;
    public statsProgressMenuEl: HTMLElement | null = null;
    public statsProgressMenuOutsideHandler: ((e: MouseEvent) => void) | null = null;
    public statsRichTooltipEl: HTMLElement | null = null;
    public statsComponent: ToolsViewStats;

    constructor(leaf: WorkspaceLeaf, public plugin: BookSmithPlugin) {
        super(leaf);
        this.statsComponent = new ToolsViewStats(this);
    }

    // View basic configuration
    getViewType() { return 'book-smith-tool'; }
    getDisplayText() { return i18n.t('WRITING_TOOLBOX'); }
    getIcon() { return 'archive'; }

    // Lifecycle methods
    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('book-smith-tools-view');
        this.normalView = container as HTMLElement;
        this.bindNavigatorEvents();
        // Render header first
        this.createHeader(container as HTMLElement);
        // Create a separate actions container below the header
        const actionsContainer = container.createDiv({ cls: 'book-smith-toolbox-actions' });
        this.toolbox = new ToolsViewToolbox(this);
        this.toolbox.render(actionsContainer);
    }

    // View refresh method
    refresh() {
        if (this.normalView) {
            this.normalView.empty();
            this.createNormalView(this.normalView);
        }
    }

    onStatsPreferencesChanged() {
        const savedWritingDisplayMode = this.plugin.settings.stats?.writingDisplayMode;
        this.statsWritingDisplayMode = savedWritingDisplayMode === 'daily-output' || savedWritingDisplayMode === 'raw'
            ? savedWritingDisplayMode
            : 'new-material-net';
        this.wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;

        if (this.isStatsViewVisible()) {
            this.redrawStatisticsView();
        }
    }

    // Create main view
    public createNormalView(container: HTMLElement) {
        this.isNavigatorMode = false;
        // renderStatisticsView marks the container with this class; empty() only
        // clears children, not classes, so drop it here — otherwise
        // isStatsViewVisible() stays true in the toolbox and a pending stats
        // refresh timer redraws the stats view (toolbar → jumps back to stats).
        container.removeClass('book-smith-stats-view');
        if (this.statsRefreshTimer !== null) {
            window.clearTimeout(this.statsRefreshTimer);
            this.statsRefreshTimer = null;
        }
        this.createHeader(container as HTMLElement);
        const actionsContainer = container.createDiv({ cls: 'book-smith-toolbox-actions' });
        if (!this.toolbox) {
            this.toolbox = new ToolsViewToolbox(this);
        }
        this.toolbox.render(actionsContainer);
    }

    // Create header
    private createHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: 'book-smith-panel-header' });
        const titleContainer = header.createDiv({ cls: 'book-smith-panel-title' });
        
        // Keep the original icon and title
        const mainIconSpan = titleContainer.createSpan({ cls: 'book-smith-panel-icon' });
        setIcon(mainIconSpan, 'archive');
        titleContainer.createSpan({ text: i18n.t('WRITING_TOOLBOX') });
    }

    // Create minimal action list
    private createPrimaryActions(container: HTMLElement) {
        const actions = container.createDiv({ cls: 'book-smith-tool-group' });

        const focusItem = this.createToolItem(actions, 'target', i18n.t('FOCUS_MODE'));
        focusItem.addEventListener('click', () => this.enterFocusMode());

        const navigatorItem = this.createToolItem(actions, 'compass', i18n.t('NAVIGATOR'));
        navigatorItem.addEventListener('click', () => void this.enterNavigatorMode());

        const statsItem = this.createToolItem(actions, 'calendar-days', i18n.t('STATS'));
        statsItem.addEventListener('click', () => void this.enterStatisticsMode());

        const exportItem = this.createToolItem(actions, 'book', i18n.t('EXPORT'));
        exportItem.addEventListener('click', () => this.enterTypographyMode());
    }

    // Create a single tool item
    private createToolItem(container: HTMLElement, icon: string, text: string) {
        const item = container.createDiv({ cls: 'book-smith-tool-item' });
        const iconSpan = item.createSpan({ cls: 'book-smith-tool-icon' });
        setIcon(iconSpan, icon);
        item.createSpan({ text });
        return item;
    }

    // Focus mode related
    public enterFocusMode() {
        if (!this.normalView) return;
        this.isNavigatorMode = false;
        this.normalView.empty();
        
        this.focusView = new FocusToolView(
            this.app,
            this.plugin,
            this.normalView,
            () => {
                this.focusView?.remove();
                this.focusView = null;
                if (this.normalView) {
                    this.normalView.empty();
                    this.createNormalView(this.normalView);
                }
            }
        );
    }

    // Method to enter typography mode
    public enterTypographyMode() {
        this.isNavigatorMode = false;
        new BookSelectionModal(this.app, this.plugin).open();
    }

    public async enterStatisticsMode() {
        if (!this.normalView) return;

        this.isNavigatorMode = false;

        this.statsViewMonth = new Date();
        this.selectedStatsDate = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        const savedDisplayMode = this.plugin.settings.stats?.displayMode;
        this.statsDisplayMode = savedDisplayMode === 'pages' || savedDisplayMode === 'pomodoros' || savedDisplayMode === 'hours' ? savedDisplayMode : 'words';
        const savedWritingDisplayMode = this.plugin.settings.stats?.writingDisplayMode;
        this.statsWritingDisplayMode = savedWritingDisplayMode === 'daily-output' || savedWritingDisplayMode === 'raw'
            ? savedWritingDisplayMode
            : 'new-material-net';
        this.wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
        this.statsSourceBookId = this.plugin.settings.lastBookId || 'global';
        await this.refreshStatsSources();

        this.normalView.empty();
        this.statsComponent.renderStatisticsView(this.normalView);
    }

    private bindNavigatorEvents() {
        if (this.navigatorEventsBound) return;

        this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
            void this.refreshNavigatorIfVisible();
            this.scheduleStatsRefreshIfVisible();
        }));
        this.registerEvent(this.app.workspace.on('layout-change', () => {
            void this.refreshNavigatorIfVisible();
            this.scheduleStatsRefreshIfVisible();
        }));
        this.registerEvent(this.app.vault.on('create', (file) => {
            void this.refreshNavigatorIfVisible();
            this.scheduleStatsRefreshForPath(file.path);
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            void this.refreshNavigatorIfVisible();
            this.scheduleStatsRefreshForPath(file.path);
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            void this.refreshNavigatorIfVisible();
            this.scheduleStatsRefreshForPath(file.path);
            this.scheduleStatsRefreshForPath(oldPath);
        }));
        // Stats updates come from onStatsChange (fires after stats are persisted).
        // Uses fast in-memory path — no disk reads.
        if (!this.statsChangeUnsubscribe) {
            this.statsChangeUnsubscribe = this.plugin.statsManager.onStatsChange(() => {
                if (!this.isStatsViewVisible()) return;
                this.refreshStatsFromMemory();
                this.redrawStatisticsView();
            });
        }

        this.navigatorEventsBound = true;
    }

    private isStatsViewVisible(): boolean {
        return Boolean(this.normalView?.hasClass('book-smith-stats-view'));
    }

    private scheduleStatsRefreshForPath(path: string): void {
        if (!this.isStatsViewVisible()) return;
        if (!path) return;

        const rootPath = this.plugin.settings.defaultBookPath;
        if (!(path === rootPath || path.startsWith(`${rootPath}/`))) return;

        this.scheduleStatsRefreshIfVisible();
    }

    private scheduleStatsRefreshIfVisible(): void {
        if (!this.isStatsViewVisible()) return;

        if (this.statsRefreshTimer !== null) {
            window.clearTimeout(this.statsRefreshTimer);
        }

        this.statsRefreshTimer = window.setTimeout(() => {
            this.statsRefreshTimer = null;
            void this.refreshStatsIfVisible();
        }, 250);
    }

    private async refreshStatsIfVisible(): Promise<void> {
        if (!this.isStatsViewVisible()) return;
        await this.refreshStatsSources();
        this.redrawStatisticsView();
    }

    private async refreshNavigatorIfVisible() {
        if (!this.isNavigatorMode) return;
        const previousSignature = this.navigatorRenderSignature();
        await this.loadNavigatorData();
        // Only redraw when the rendered content would actually change.
        // This view refreshes on `layout-change`/`active-leaf-change`, and the
        // Hover Editor popover IS a workspace leaf — opening it fires those
        // events. Unconditionally redrawing destroyed the hovered row, which
        // killed the popover (its targetEl left the DOM), which changed the
        // layout again… an endless blink loop whenever Ctrl was held.
        if (this.navigatorRenderSignature() === previousSignature) return;
        this.redrawNavigatorView();
    }

    private navigatorRenderSignature(): string {
        return [
            this.navigatorBook?.basic?.uuid ?? '',
            this.navigatorFolderPath ?? '',
            this.navigatorFiles.map((f) => f.path).join('\n')
        ].join(' ');
    }

    public async enterNavigatorMode() {
        if (!this.normalView) return;

        this.isNavigatorMode = true;
        await this.loadNavigatorData();
        this.normalView.empty();
        this.renderNavigatorView(this.normalView);
    }

    private async loadNavigatorData() {
        const activeBookId = this.plugin.settings.lastBookId;
        this.navigatorBook = activeBookId
            ? await this.plugin.bookManager.getBookById(activeBookId)
            : null;

        const configuredPath = this.navigatorBook?.navigatorFolder?.trim();
        this.navigatorFolderPath = configuredPath ? configuredPath.replace(/^\/+|\/+$/g, '') : null;

        if (!this.navigatorFolderPath) {
            this.navigatorFiles = [];
            return;
        }

        const folder = this.app.vault.getAbstractFileByPath(this.navigatorFolderPath);
        if (!(folder instanceof TFolder)) {
            this.navigatorFiles = [];
            return;
        }

        const allowedExtensions = new Set(['md', 'pdf', 'txt', 'fountain']);
        this.navigatorFiles = this.app.vault.getFiles()
            .filter((file) => file.path.startsWith(`${this.navigatorFolderPath}/`))
            .filter((file) => !file.path.split('/').some((part) => part.startsWith('.')))
            .filter((file) => allowedExtensions.has(file.extension.toLowerCase()))
            .filter((file) => file.extension.toLowerCase() !== 'json')
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    private renderNavigatorView(container: HTMLElement) {
        const view = container.createDiv({ cls: 'book-smith-navigator-view' });

        const header = view.createDiv({ cls: 'book-smith-navigator-header' });
        const backButton = header.createEl('button', { cls: 'book-smith-navigator-back-btn' });
        setIcon(backButton, 'arrow-left');
        backButton.appendChild(createSpan({ text: ` ${i18n.t('BACK_TO_TOOLBOX')}` }));
        backButton.addEventListener('click', () => {
            if (!this.normalView) return;
            this.isNavigatorMode = false;
            this.normalView.empty();
            this.createNormalView(this.normalView);
        });

        // Top-right button changes the folder this project links to. The folder
        // is stored per book (book.navigatorFolder) and the navigator always
        // follows the plugin's current project (lastBookId), so the project name
        // and folder path don't need to take up space in the pane — the current
        // path lives in this button's tooltip instead.
        const folderButton = header.createEl('button', {
            cls: 'book-smith-navigator-folder-btn',
            attr: {
                'aria-label': this.navigatorFolderPath
                    ? `${i18n.t('SELECT_FOLDER')} — ${this.navigatorFolderPath}`
                    : i18n.t('SELECT_FOLDER')
            }
        });
        setIcon(folderButton, 'folder-cog');
        folderButton.addEventListener('click', () => this.openNavigatorFolderPicker());

        if (!this.navigatorBook) {
            folderButton.disabled = true;
            view.createEl('p', { cls: 'book-smith-navigator-empty', text: i18n.t('NO_ACTIVE_BOOK') });
            return;
        }

        if (!this.navigatorFolderPath) {
            this.renderNavigatorSetup(view);
            return;
        }

        const list = view.createDiv({ cls: 'book-smith-navigator-file-list' });
        if (this.navigatorFiles.length === 0) {
            list.createEl('p', { cls: 'book-smith-navigator-empty', text: i18n.t('NAVIGATOR_NO_FILES') });
            return;
        }

        this.navigatorFiles.forEach((file) => {
            const row = list.createEl('a', {
                cls: 'book-smith-navigator-file-row internal-link',
                attr: {
                    href: file.path,
                    'data-href': file.path
                }
            });
            const icon = row.createSpan({ cls: 'book-smith-navigator-file-icon' });
            setIcon(icon, file.extension.toLowerCase() === 'pdf' ? 'file' : 'file-text');
            row.createSpan({
                cls: 'book-smith-navigator-file-name',
                text: file.path.slice(this.navigatorFolderPath!.length + 1)
            });

            row.addEventListener('click', async (evt: MouseEvent) => {
                evt.preventDefault();
                const openInNewTab = evt.ctrlKey || evt.metaKey;
                await this.app.workspace.getLeaf(openInNewTab).openFile(file);
            });

            // Ctrl/Cmd + hover opens the Page Preview / Hover Editor popover.
            // This mirrors the left pane's ChapterTree pattern exactly, with two
            // proven-necessary differences:
            //  - hoverParent is a plain object, NOT this ItemView — Hover Editor
            //    rejects a sidebar-leaf view as parent and builds no popover.
            //  - The file list has no gap between rows (CSS), so the cursor can't
            //    dip into dead space mid-hover and fire spurious mouseleaves.
            const hoverParent = { hoverPopover: null } as Record<string, unknown>;
            let hoveredPath: string | null = null;
            const openPreview = (evt: MouseEvent) => {
                if (!(evt.ctrlKey || evt.metaKey)) {
                    hoveredPath = null;
                    return;
                }
                if (hoveredPath === file.path) return;
                (this.app.workspace as any).trigger('hover-link', {
                    event: evt,
                    source: 'book-smith-navigator',
                    hoverParent,
                    targetEl: row,
                    linktext: file.path,
                    sourcePath: this.app.workspace.getActiveFile()?.path || ''
                });
                hoveredPath = file.path;
            };
            row.addEventListener('mousemove', openPreview);
            row.addEventListener('mouseenter', openPreview);
            row.addEventListener('mouseleave', () => {
                hoveredPath = null;
            });
        });
    }

    public renderNavigatorSetup(container: HTMLElement) {
        const setup = container.createDiv({ cls: 'book-smith-navigator-setup' });
        setup.createEl('p', { text: i18n.t('NAVIGATOR_NOT_SET_TITLE') });
        setup.createEl('p', {
            cls: 'book-smith-navigator-empty',
            text: i18n.t('NAVIGATOR_NOT_SET_DESC')
        });

        const selectButton = setup.createEl('button', {
            cls: 'book-smith-navigator-select-btn',
            text: i18n.t('SELECT_FOLDER')
        });
        selectButton.addEventListener('click', () => this.openNavigatorFolderPicker());
    }

    private openNavigatorFolderPicker() {
        if (!this.navigatorBook) {
            new Notice(i18n.t('NO_ACTIVE_BOOK'));
            return;
        }

        new NavigatorFolderModal(this.app, async (selectedPath) => {
            if (!selectedPath) return;

            await this.plugin.bookManager.updateBook(this.navigatorBook!.basic.uuid, {
                navigatorFolder: selectedPath
            });
            new Notice(i18n.t('NAVIGATOR_FOLDER_SAVED'));

            await this.loadNavigatorData();
            this.redrawNavigatorView();
        }, this.navigatorFolderPath).open();
    }

    public redrawNavigatorView() {
        if (!this.normalView || !this.isNavigatorMode) return;
        this.normalView.empty();
        this.renderNavigatorView(this.normalView);
    }

    public async refreshStatsSources() {
        this.statsBooks = await this.plugin.bookManager.getAllBooks();

        if (this.statsSourceBookId !== 'global') {
            const exists = this.statsBooks.some(book => book.basic.uuid === this.statsSourceBookId);
            if (!exists) {
                this.statsSourceBookId = this.statsBooks[0]?.basic.uuid || 'global';
            }
        }

        const { dailyWords, dailyProgress, dailyComments } = await this.loadStatsData();
        this.statsDailyWords = dailyWords;
        this.statsDailyProgress = dailyProgress;
        this.statsDailyComments = dailyComments;
        this.statsPeriodComments = this.plugin.sharedDataManager.getPeriodComments();
        this.statsDailyFocusMinutes = this.loadDailyFocusMinutesData();
    }

    /**
     * Fast in-memory stats refresh for the current book.
     * Reads from statsManager's in-memory book object instead of disk.
     */
    private refreshStatsFromMemory(): void {
        const currentBook = this.plugin.statsManager.getCurrentBook();
        if (!currentBook) return;

        // Update the in-memory book in statsBooks array
        const idx = this.statsBooks.findIndex(b => b.basic.uuid === currentBook.basic.uuid);
        if (idx >= 0) {
            this.statsBooks[idx] = currentBook;
        }

        // Rebuild stats data for the view being shown
        if (this.statsSourceBookId === 'global') {
            // Re-merge all books (one is now updated in memory)
            const mergedWords: Record<string, number> = {};
            const mergedProgress: Record<string, DailyProgressEntry> = {};
            this.statsBooks.forEach(book => {
                const dailyProgress = this.getDailyProgressForBook(book);
                Object.entries(dailyProgress).forEach(([date, entry]) => {
                    const previous = mergedProgress[date] || {
                        positive_change: 0, negative_change: 0, net_change: 0,
                        words_added: 0, words_deleted: 0, iteration_deletions: 0, old_deletions: 0
                    };
                    mergedProgress[date] = {
                        positive_change: previous.positive_change + entry.positive_change,
                        negative_change: previous.negative_change + entry.negative_change,
                        net_change: previous.net_change + entry.net_change,
                        words_added: (previous.words_added || 0) + (entry.words_added || 0),
                        words_deleted: (previous.words_deleted || 0) + (entry.words_deleted || 0),
                        iteration_deletions: (previous.iteration_deletions || 0) + (entry.iteration_deletions || 0),
                        old_deletions: (previous.old_deletions || 0) + (entry.old_deletions || 0)
                    };
                    mergedWords[date] = mergedProgress[date].net_change;
                });
            });
            this.statsDailyWords = mergedWords;
            this.statsDailyProgress = mergedProgress;
        } else if (this.statsSourceBookId === currentBook.basic.uuid) {
            const dailyProgress = this.getDailyProgressForBook(currentBook);
            this.statsDailyWords = Object.fromEntries(
                Object.entries(dailyProgress).map(([date, entry]) => [date, entry.net_change])
            );
            this.statsDailyProgress = dailyProgress;
            this.statsDailyComments = { ...(currentBook.stats.daily_comments || {}) };
        }

        this.redrawStatisticsView();
    }

    private loadDailyFocusMinutesData(): Record<string, number> {
        const minutesByDay: Record<string, number> = {};

        if (this.statsSourceBookId === 'global') {
            this.statsBooks.forEach((book) => {
                const daily = book.focusStats?.dailyMinutes || {};
                Object.entries(daily).forEach(([date, minutes]) => {
                    minutesByDay[date] = Number(((minutesByDay[date] || 0) + (minutes || 0)).toFixed(2));
                });
            });
            return minutesByDay;
        }

        const book = this.statsBooks.find(item => item.basic.uuid === this.statsSourceBookId);
        return { ...(book?.focusStats?.dailyMinutes || {}) };
    }

    private getDailyProgressForBook(book: Book | null): Record<string, DailyProgressEntry> {
        if (!book) return {};

        const existing = book.stats.daily_progress || {};
        const merged: Record<string, DailyProgressEntry> = {};

        Object.entries(existing).forEach(([date, entry]) => {
            const fallbackWordsDeleted = entry?.words_deleted ?? Math.abs(entry?.negative_change || 0);
            merged[date] = {
                positive_change: entry?.positive_change || 0,
                negative_change: entry?.negative_change || 0,
                net_change: entry?.net_change || 0,
                words_added: entry?.words_added ?? entry?.positive_change ?? 0,
                words_deleted: fallbackWordsDeleted,
                iteration_deletions: entry?.iteration_deletions || 0,
                old_deletions: entry?.old_deletions || 0
            };
        });

        Object.entries(book.stats.daily_words || {}).forEach(([date, words]) => {
            if (merged[date]) return;
            merged[date] = {
                positive_change: words || 0,
                negative_change: 0,
                net_change: words || 0,
                words_added: words || 0,
                words_deleted: 0,
                iteration_deletions: 0,
                old_deletions: 0
            };
        });

        return merged;
    }

    private async loadStatsData(): Promise<{ dailyWords: Record<string, number>; dailyProgress: Record<string, DailyProgressEntry>; dailyComments: Record<string, string> }> {
        if (this.statsSourceBookId === 'global') {
            const mergedWords: Record<string, number> = {};
            const mergedProgress: Record<string, DailyProgressEntry> = {};
            this.statsBooks.forEach(book => {
                const dailyProgress = this.getDailyProgressForBook(book);
                Object.entries(dailyProgress).forEach(([date, entry]) => {
                    const previous = mergedProgress[date] || {
                        positive_change: 0,
                        negative_change: 0,
                        net_change: 0,
                        words_added: 0,
                        words_deleted: 0,
                        iteration_deletions: 0,
                        old_deletions: 0
                    };

                    mergedProgress[date] = {
                        positive_change: previous.positive_change + entry.positive_change,
                        negative_change: previous.negative_change + entry.negative_change,
                        net_change: previous.net_change + entry.net_change,
                        words_added: (previous.words_added || 0) + (entry.words_added || 0),
                        words_deleted: (previous.words_deleted || 0) + (entry.words_deleted || 0),
                        iteration_deletions: (previous.iteration_deletions || 0) + (entry.iteration_deletions || 0),
                        old_deletions: (previous.old_deletions || 0) + (entry.old_deletions || 0)
                    };
                    mergedWords[date] = mergedProgress[date].net_change;
                });
            });
            return {
                dailyWords: mergedWords,
                dailyProgress: mergedProgress,
                dailyComments: this.plugin.sharedDataManager.getComments()
            };
        }

        const book = this.statsBooks.find(item => item.basic.uuid === this.statsSourceBookId) || null;
        const dailyProgress = this.getDailyProgressForBook(book);
        const dailyWords = Object.fromEntries(
            Object.entries(dailyProgress).map(([date, entry]) => [date, entry.net_change])
        );

        return {
            dailyWords,
            dailyProgress,
            dailyComments: this.plugin.sharedDataManager.getComments()
        };
    }


    public renderStatsSourceRow(container: HTMLElement) {
        const row = container.createDiv({ cls: 'book-smith-stats-source-row' });

        row.createEl('div', {
            cls: 'book-smith-stats-source-title',
            text: this.getActiveStatsSourceTitle()
        });

        const selectorButton = row.createEl('button', {
            cls: 'book-smith-stats-source-button',
            text: i18n.t('SELECT_PROJECT')
        });
        selectorButton.addEventListener('click', () => {
            this.statsSourceMenuOpen = !this.statsSourceMenuOpen;
            this.redrawStatisticsView();
        });

        if (!this.statsSourceMenuOpen) return;

        const menu = container.createDiv({ cls: 'book-smith-stats-source-menu' });
        const globalOption = menu.createEl('button', {
            cls: `book-smith-stats-source-option${this.statsSourceBookId === 'global' ? ' is-active' : ''}`,
            text: i18n.t('GLOBAL_STATS')
        });
        globalOption.addEventListener('click', async () => {
            this.statsSourceBookId = 'global';
            this.statsSourceMenuOpen = false;
            await this.refreshStatsSources();
            this.redrawStatisticsView();
        });

        this.statsBooks.forEach(book => {
            const option = menu.createEl('button', {
                cls: `book-smith-stats-source-option${this.statsSourceBookId === book.basic.uuid ? ' is-active' : ''}`,
                text: book.basic.title
            });
            option.addEventListener('click', async () => {
                this.statsSourceBookId = book.basic.uuid;
                this.statsSourceMenuOpen = false;
                await this.refreshStatsSources();
                this.redrawStatisticsView();
            });
        });
    }

    public getActiveStatsSourceTitle(): string {
        if (this.statsSourceBookId === 'global') {
            return i18n.t('GLOBAL_STATS');
        }

        const book = this.statsBooks.find(item => item.basic.uuid === this.statsSourceBookId);
        return book?.basic.title || i18n.t('GLOBAL_STATS');
    }

    public renderStatsPeriodPanel(container: HTMLElement) {
        const panel = container.createDiv({ cls: 'book-smith-stats-settings-panel is-active-period' });
        const row = panel.createDiv({ cls: 'book-smith-stats-settings-row' });
        row.createEl('label', { text: i18n.t('STATS_PERIOD') });

        const select = row.createEl('select', { cls: 'book-smith-stats-select' });
        select.createEl('option', { value: 'day', text: i18n.t('PERIOD_DAY') });
        select.createEl('option', { value: 'week', text: i18n.t('PERIOD_WEEK') });
        select.createEl('option', { value: 'month', text: i18n.t('PERIOD_MONTH') });
        select.createEl('option', { value: 'year', text: i18n.t('PERIOD_YEAR') });
        select.value = this.statsPeriodMode;
        select.addEventListener('change', () => {
            this.statsPeriodMode = (select.value as 'day' | 'week' | 'month' | 'year');
            this.redrawStatisticsView();
        });

        // Day mode only: month grid vs a plain per-day list.
        if (this.statsPeriodMode === 'day') {
            const viewRow = panel.createDiv({ cls: 'book-smith-stats-settings-row' });
            viewRow.createEl('label', { text: 'View' });
            const viewSelect = viewRow.createEl('select', { cls: 'book-smith-stats-select' });
            viewSelect.createEl('option', { value: 'calendar', text: 'Calendar' });
            viewSelect.createEl('option', { value: 'list', text: 'List' });
            const savedView = this.plugin.settings.stats?.dailyView;
            const isListView = savedView === 'list' || savedView === 'quota' || savedView === 'timeline';
            viewSelect.value = isListView ? 'list' : 'calendar';
            viewSelect.addEventListener('change', async () => {
                this.plugin.settings.stats.dailyView = viewSelect.value === 'list' ? 'list' : 'calendar';
                this.timelineLoadedCount = 0;   // fresh scroll on mode switch
                this.timelineScrollTop = 0;
                await this.plugin.saveSettings();
                this.redrawStatisticsView();
            });
        }
    }

    public renderStatsSettingsPanel(container: HTMLElement) {
        const panel = container.createDiv({ cls: 'book-smith-stats-settings-panel is-active-display' });

        const modeRow = panel.createDiv({ cls: 'book-smith-stats-settings-row' });
        modeRow.createEl('label', { text: i18n.t('DISPLAY_MODE') });
        const modeSelect = modeRow.createEl('select', { cls: 'book-smith-stats-select' });
        modeSelect.createEl('option', { value: 'words', text: i18n.t('WORDS_MODE') });
        modeSelect.createEl('option', { value: 'pages', text: i18n.t('PAGES_MODE') });
        modeSelect.createEl('option', { value: 'pomodoros', text: i18n.t('POMODOROS_MODE') });
        modeSelect.createEl('option', { value: 'hours', text: i18n.t('HOURS_MODE') });
        modeSelect.value = this.statsDisplayMode;
        modeSelect.addEventListener('change', async () => {
            this.statsDisplayMode = modeSelect.value === 'pages'
                ? 'pages'
                : modeSelect.value === 'pomodoros'
                    ? 'pomodoros'
                    : modeSelect.value === 'hours'
                        ? 'hours'
                    : 'words';
            await this.persistStatsPreferences();
            this.redrawStatisticsView();
        });

        const progressRow = panel.createDiv({ cls: 'book-smith-stats-settings-row' });
        progressRow.createEl('label', { text: i18n.t('PROGRESS_DISPLAY') });

        const progressControl = progressRow.createDiv({ cls: 'book-smith-progress-mode-control' });
        const progressSelectorBtn = progressControl.createEl('button', {
            cls: 'book-smith-progress-mode-selector',
            attr: { type: 'button' }
        });
        const progressSelectorLabel = progressSelectorBtn.createSpan({
            text: this.getStatsProgressModeLabel(this.statsWritingDisplayMode)
        });
        progressSelectorBtn.createSpan({ cls: 'book-smith-progress-mode-selector-caret', text: '▾' });

        progressSelectorBtn.addEventListener('click', () => {
            if (this.statsProgressMenuEl) {
                this.closeStatsProgressMenu();
                return;
            }
            this.openStatsProgressMenu(progressControl, this.statsWritingDisplayMode, async (mode) => {
                this.statsWritingDisplayMode = mode;
                progressSelectorLabel.textContent = this.getStatsProgressModeLabel(mode);
                await this.persistStatsPreferences();
                this.redrawStatisticsView();
            });
        });

        // Day-mode sub-options: calendar coloring, or list layout modifiers.
        if (this.statsPeriodMode === 'day') {
            const raw = this.plugin.settings.stats?.dailyView;
            const isList = raw === 'list' || raw === 'quota' || raw === 'timeline';

            if (!isList) {
                // Calendar coloring: standard (word-count purple) or streak chain.
                const calendarRow = panel.createDiv({ cls: 'book-smith-stats-settings-row' });
                calendarRow.createEl('label', { text: 'Calendar style' });
                const calendarSelect = calendarRow.createEl('select', { cls: 'book-smith-stats-select' });
                calendarSelect.createEl('option', { value: 'standard', text: 'Standard' });
                calendarSelect.createEl('option', { value: 'streak', text: 'Streak view' });
                calendarSelect.value = this.plugin.settings.stats?.calendarView === 'streak' ? 'streak' : 'standard';
                calendarSelect.addEventListener('change', async () => {
                    this.plugin.settings.stats.calendarView = calendarSelect.value === 'streak' ? 'streak' : 'standard';
                    await this.plugin.saveSettings();
                    this.redrawStatisticsView();
                });
            } else {
                const infinite = this.plugin.settings.stats?.listInfinite ?? (raw === 'timeline');
                const writingOnly = this.plugin.settings.stats?.listWritingDaysOnly ?? (raw === 'quota');

                const infRow = panel.createDiv({ cls: 'book-smith-stats-settings-row' });
                infRow.createEl('label', { text: 'Infinite scroll' });
                const infToggle = infRow.createEl('input', {
                    cls: 'book-smith-stats-settings-toggle',
                    attr: { type: 'checkbox' }
                });
                infToggle.checked = infinite;
                infToggle.addEventListener('change', async () => {
                    this.plugin.settings.stats.listInfinite = infToggle.checked;
                    this.timelineLoadedCount = 0;
                    this.timelineScrollTop = 0;
                    await this.plugin.saveSettings();
                    this.redrawStatisticsView();
                });

                const wdRow = panel.createDiv({ cls: 'book-smith-stats-settings-row' });
                wdRow.createEl('label', { text: 'Writing days only' });
                const wdToggle = wdRow.createEl('input', {
                    cls: 'book-smith-stats-settings-toggle',
                    attr: { type: 'checkbox' }
                });
                wdToggle.checked = writingOnly;
                wdToggle.addEventListener('change', async () => {
                    this.plugin.settings.stats.listWritingDaysOnly = wdToggle.checked;
                    await this.plugin.saveSettings();
                    this.redrawStatisticsView();
                });
            }
        }
    }

    public getStatsProgressModeLabel(mode: 'new-material-net' | 'daily-output' | 'raw'): string {
        if (mode === 'daily-output') return i18n.t('NEW_MATERIAL_DAILY_OUTPUT_MODE');
        if (mode === 'raw') return i18n.t('RAW_DATA_MODE');
        return i18n.t('NEW_MATERIAL_NET_MODE');
    }

    public openStatsProgressMenu(
        anchor: HTMLElement,
        currentMode: 'new-material-net' | 'daily-output' | 'raw',
        onSelect: (mode: 'new-material-net' | 'daily-output' | 'raw') => Promise<void>
    ): void {
        const menu = anchor.createDiv({ cls: 'book-smith-progress-mode-menu' });
        this.statsProgressMenuEl = menu;

        const addOption = (mode: 'new-material-net' | 'daily-output' | 'raw', label: string) => {
            const option = menu.createEl('button', {
                cls: `book-smith-progress-mode-option${currentMode === mode ? ' is-active' : ''}`,
                text: label,
                attr: { type: 'button' }
            });
            this.attachStatsRichTooltip(option, () => this.getStatsProgressModeTooltipHtml(mode));
            option.addEventListener('click', async () => {
                this.closeStatsProgressMenu();
                await onSelect(mode);
            });
        };

        addOption('new-material-net', i18n.t('NEW_MATERIAL_NET_MODE'));
        addOption('daily-output', i18n.t('NEW_MATERIAL_DAILY_OUTPUT_MODE'));
        addOption('raw', i18n.t('RAW_DATA_MODE'));

        this.statsProgressMenuOutsideHandler = (event: MouseEvent) => {
            if (!anchor.contains(event.target as Node)) {
                this.closeStatsProgressMenu();
            }
        };
        document.addEventListener('mousedown', this.statsProgressMenuOutsideHandler, true);
    }

    public closeStatsProgressMenu(): void {
        this.statsProgressMenuEl?.remove();
        this.statsProgressMenuEl = null;
        if (this.statsProgressMenuOutsideHandler) {
            document.removeEventListener('mousedown', this.statsProgressMenuOutsideHandler, true);
            this.statsProgressMenuOutsideHandler = null;
        }
        this.statsRichTooltipEl?.remove();
        this.statsRichTooltipEl = null;
    }

    private getStatsProgressModeTooltipHtml(mode: 'new-material-net' | 'daily-output' | 'raw'): string {
        if (mode === 'daily-output') {
            return `
                <div class="book-smith-rich-tooltip-content">
                    <p><strong>New Material (Daily Output)</strong></p>
                    <p>Shows new material written today as the main number.</p>
                    <p>Net manuscript change is still shown, but as secondary context.</p>
                </div>
            `;
        }
        if (mode === 'raw') {
            return `
                <div class="book-smith-rich-tooltip-content">
                    <p><strong>Raw Data</strong></p>
                    <p>Shows all writing and deletions exactly as they occurred, counting daily iteration as full writing activity.</p>
                </div>
            `;
        }
        return `
            <div class="book-smith-rich-tooltip-content">
                <p><strong>New Material (Net)</strong></p>
                <p>Shows net manuscript progress as the main number, with a breakdown of new material written and old material removed.</p>
                <p>This is the recommended view for the stats screen.</p>
            </div>
        `;
    }

    private attachStatsRichTooltip(target: HTMLElement, getHtml: () => string): void {
        const showTooltip = (event: MouseEvent) => {
            this.statsRichTooltipEl?.remove();
            const tooltip = document.body.createDiv({ cls: 'book-smith-rich-tooltip' });
            tooltip.innerHTML = getHtml();
            this.statsRichTooltipEl = tooltip;
            this.positionStatsRichTooltip(event);
        };

        const moveTooltip = (event: MouseEvent) => {
            this.positionStatsRichTooltip(event);
        };

        const hideTooltip = () => {
            this.statsRichTooltipEl?.remove();
            this.statsRichTooltipEl = null;
        };

        target.addEventListener('mouseenter', showTooltip);
        target.addEventListener('mousemove', moveTooltip);
        target.addEventListener('mouseleave', hideTooltip);
    }

    private positionStatsRichTooltip(event: MouseEvent): void {
        if (!this.statsRichTooltipEl) return;

        const tooltip = this.statsRichTooltipEl;
        const offset = 14;
        const viewportPadding = 16;
        const maxX = window.innerWidth - tooltip.offsetWidth - viewportPadding;
        const maxY = window.innerHeight - tooltip.offsetHeight - viewportPadding;

        const x = Math.min(maxX, event.clientX + offset);
        const y = Math.min(maxY, event.clientY + offset);

        tooltip.style.left = `${Math.max(viewportPadding, x)}px`;
        tooltip.style.top = `${Math.max(viewportPadding, y)}px`;
    }

    public async persistStatsPreferences() {
        // Spread the existing object: rebuilding it from scratch silently
        // dropped any stats field not listed here (e.g. calendarView).
        this.plugin.settings.stats = {
            ...this.plugin.settings.stats,
            displayMode: this.statsDisplayMode,
            writingDisplayMode: this.statsWritingDisplayMode,
            leftPaneWritingDisplayMode: this.plugin.settings.stats?.leftPaneWritingDisplayMode || 'daily-output',
            wordsPerPage: this.wordsPerPage
        };
        await this.plugin.saveSettings();
    }


    /** True when the day period is showing the all-history infinite-scroll
     *  list, for which the month/year nav has nothing to drive. */
    public isInfiniteDailyList(): boolean {
        if (this.statsPeriodMode !== 'day') return false;
        const raw = this.plugin.settings.stats?.dailyView;
        const isList = raw === 'list' || raw === 'quota' || raw === 'timeline';
        if (!isList) return false;
        return this.plugin.settings.stats?.listInfinite ?? (raw === 'timeline');
    }

    public renderCalendarBody(calendar: HTMLElement) {
        if (this.statsPeriodMode === 'day') {
            const raw = this.plugin.settings.stats?.dailyView;
            const isList = raw === 'list' || raw === 'quota' || raw === 'timeline';
            if (isList) {
                const infinite = this.plugin.settings.stats?.listInfinite ?? (raw === 'timeline');
                const writingDaysOnly = this.plugin.settings.stats?.listWritingDaysOnly ?? (raw === 'quota');
                const list = calendar.createDiv({
                    cls: `book-smith-stats-day-list${infinite ? ' is-timeline' : ''}`
                });
                this.renderDayList(list, { infinite, writingDaysOnly });
                return;
            }

            const weekdays = calendar.createDiv({ cls: 'book-smith-stats-weekdays' });
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
                weekdays.createEl('span', { text: day });
            });

            const grid = calendar.createDiv({ cls: 'book-smith-stats-grid' });
            this.renderCalendarDays(grid);
            return;
        }

        if (this.statsPeriodMode === 'week') {
            const grid = calendar.createDiv({ cls: 'book-smith-stats-period-grid is-week' });
            this.renderWeekBoxes(grid);
            return;
        }

        if (this.statsPeriodMode === 'month') {
            const grid = calendar.createDiv({ cls: 'book-smith-stats-period-grid is-month' });
            this.renderMonthBoxes(grid);
            return;
        }

        const grid = calendar.createDiv({ cls: 'book-smith-stats-period-grid is-year' });
        this.renderYearBoxes(grid);
    }

    public renderMonthYearPicker(nav: HTMLElement) {
        const picker = nav.createDiv({ cls: 'book-smith-stats-month-picker' });

        if (this.statsPeriodMode === 'year') {
            if (this.statsYearEditing) {
                const yearInput = picker.createEl('input', {
                    cls: 'book-smith-stats-year-input',
                    attr: {
                        type: 'number',
                        step: '1',
                        value: String(this.statsViewMonth.getFullYear())
                    }
                });
                yearInput.focus();
                yearInput.select();

                const commitYear = () => {
                    this.statsYearEditing = false;
                    const yearValue = Number(yearInput.value);
                    if (!Number.isFinite(yearValue)) {
                        new Notice(i18n.t('INVALID_YEAR'));
                        this.redrawStatisticsView();
                        return;
                    }
                    this.statsViewMonth = new Date(yearValue, 0, 1);
                    this.redrawStatisticsView();
                };

                yearInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        commitYear();
                    }
                    if (event.key === 'Escape') {
                        this.statsYearEditing = false;
                        this.redrawStatisticsView();
                    }
                });
                yearInput.addEventListener('blur', commitYear);
                return;
            }

            const decadeStart = Math.floor(this.statsViewMonth.getFullYear() / 10) * 10;
            const decadeTrigger = picker.createEl('span', {
                cls: 'book-smith-stats-decade-label',
                text: `${decadeStart} - ${decadeStart + 9}`
            });
            decadeTrigger.setAttribute('role', 'button');
            decadeTrigger.setAttribute('tabindex', '0');
            decadeTrigger.addEventListener('click', () => {
                this.statsYearEditing = true;
                this.redrawStatisticsView();
            });
            decadeTrigger.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.statsYearEditing = true;
                    this.redrawStatisticsView();
                }
            });
            return;
        }

        const commitYearValue = (yearValue: number) => {
            if (!Number.isFinite(yearValue)) {
                new Notice(i18n.t('INVALID_YEAR'));
                return;
            }

            if (this.statsPeriodMode === 'month') {
                this.statsViewMonth = new Date(yearValue, 0, 1);
            } else {
                this.statsViewMonth = new Date(yearValue, this.statsViewMonth.getMonth(), 1);
            }
            this.redrawStatisticsView();
        };

        if (this.statsPeriodMode === 'month') {
            this.renderYearOnlyControl(picker, commitYearValue);
            return;
        }

        const monthSelect = picker.createEl('select', { cls: 'book-smith-stats-select' });
        for (let month = 0; month < 12; month++) {
            const option = monthSelect.createEl('option', {
                value: String(month),
                text: new Date(2000, month, 1).toLocaleString(undefined, { month: 'short' })
            });
            option.selected = month === this.statsViewMonth.getMonth();
        }

        const applyMonthAndYear = (yearValue: number) => {
            const selectedMonth = Number(monthSelect.value);
            if (!Number.isFinite(yearValue)) {
                new Notice(i18n.t('INVALID_YEAR'));
                return;
            }
            this.statsViewMonth = new Date(yearValue, selectedMonth, 1);
            this.redrawStatisticsView();
        };

        monthSelect.addEventListener('change', () => {
            applyMonthAndYear(this.statsViewMonth.getFullYear());
        });

        if (this.statsYearEditing) {
            const yearInput = picker.createEl('input', {
                cls: 'book-smith-stats-year-input',
                attr: {
                    type: 'number',
                    step: '1',
                    value: String(this.statsViewMonth.getFullYear())
                }
            });
            yearInput.focus();
            yearInput.select();

            const commitYear = () => {
                this.statsYearEditing = false;
                applyMonthAndYear(Number(yearInput.value));
            };

            yearInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    commitYear();
                }
                if (event.key === 'Escape') {
                    this.statsYearEditing = false;
                    this.redrawStatisticsView();
                }
            });
            yearInput.addEventListener('blur', commitYear);
        } else {
            const yearTrigger = picker.createEl('button', {
                cls: 'book-smith-stats-year-trigger',
                text: String(this.statsViewMonth.getFullYear())
            });
            yearTrigger.addEventListener('click', () => {
                this.statsYearEditing = true;
                this.redrawStatisticsView();
            });
        }
    }

    private renderYearOnlyControl(picker: HTMLElement, onCommit: (year: number) => void) {
        if (this.statsYearEditing) {
            const yearInput = picker.createEl('input', {
                cls: 'book-smith-stats-year-input',
                attr: {
                    type: 'number',
                    step: '1',
                    value: String(this.statsViewMonth.getFullYear())
                }
            });
            yearInput.focus();
            yearInput.select();

            const commitYear = () => {
                this.statsYearEditing = false;
                onCommit(Number(yearInput.value));
            };

            yearInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    commitYear();
                }
                if (event.key === 'Escape') {
                    this.statsYearEditing = false;
                    this.redrawStatisticsView();
                }
            });
            yearInput.addEventListener('blur', commitYear);
            return;
        }

        const yearTrigger = picker.createEl('button', {
            cls: 'book-smith-stats-year-trigger',
            text: String(this.statsViewMonth.getFullYear())
        });
        yearTrigger.addEventListener('click', () => {
            this.statsYearEditing = true;
            this.redrawStatisticsView();
        });
    }

    /**
     * Streak-view support: per-day chain classification for the selected stats
     * book over the visible month, or null when streak view is off / source is
     * Global (a streak needs one project's schedule to judge against).
     */
    private getStreakClassesForCalendar(): Map<string, StreakDayClass> | null {
        if (this.plugin.settings.stats?.calendarView !== 'streak') return null;
        if (this.statsSourceBookId === 'global') return null;
        const book = this.statsBooks.find((b) => b.basic.uuid === this.statsSourceBookId);
        if (!book) return null;

        const rollover = this.plugin.settings.focus.dailyRolloverMinutes;
        const created = book.basic?.created_at ? new Date(book.basic.created_at) : new Date();
        const fallbackStart = getLogicalDayISODate(
            Number.isNaN(created.getTime()) ? new Date() : created,
            rollover
        );
        const periods = normalizeStreakPeriods(book.stats?.writing_periods, fallbackStart);
        const getDayValue = (iso: string): number => {
            const entry = book.stats?.daily_progress?.[iso];
            if (entry) return Math.max(0, entry.net_change || 0);
            return Math.max(0, book.stats?.daily_words?.[iso] || 0);
        };
        const today = getLogicalDayISODate(new Date(), rollover);
        const year = this.statsViewMonth.getFullYear();
        const month = this.statsViewMonth.getMonth();
        const rangeStart = this.toLocalISODate(new Date(year, month, 1));
        const rangeEnd = this.toLocalISODate(new Date(year, month + 1, 0));
        return classifyStreakDays(periods, getDayValue, today, rangeStart, rangeEnd);
    }

    private renderCalendarDays(grid: HTMLElement) {
        const year = this.statsViewMonth.getFullYear();
        const month = this.statsViewMonth.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const streakClasses = this.getStreakClassesForCalendar();
        if (streakClasses !== null) grid.addClass('is-streak-view');

        for (let i = 0; i < firstDay; i++) {
            grid.createDiv({ cls: 'book-smith-stats-day is-empty' });
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const iso = this.toLocalISODate(date);
            const metricValue = this.getMetricForPeriod(date);
            const metricText = this.getDayMetricShortText(metricValue);
            const dayEl = grid.createDiv({ cls: 'book-smith-stats-day' });

            if (iso === this.selectedStatsDate) {
                dayEl.addClass('is-selected');
            }

            dayEl.createEl('span', { cls: 'book-smith-stats-day-number', text: String(day) });
            const hasDayActivity = this.hasDayProgressActivity(iso);
            const shouldShowMetric = this.statsPeriodMode !== 'day'
                ? metricValue !== 0
                : (this.statsDisplayMode === 'words' || this.statsDisplayMode === 'pages')
                    ? hasDayActivity
                    : metricValue > 0;

            if (shouldShowMetric) {
                const metricEl = dayEl.createEl('span', { cls: 'book-smith-stats-day-words', text: metricText });
                const isDisplayedZero = metricText === '0' || metricText === '0.0' || metricText === '-0' || metricText === '-0.0';
                if (metricValue < 0 && !isDisplayedZero) {
                    metricEl.addClass('progress-negative');
                } else if (metricValue > 0 && !isDisplayedZero && (this.statsDisplayMode === 'words' || this.statsDisplayMode === 'pages')) {
                    metricEl.addClass('progress-purple');
                } else if (this.statsPeriodMode === 'day' && hasDayActivity && isDisplayedZero) {
                    metricEl.addClass('progress-zero');
                }
                const shouldHighlightWritingDay = this.statsPeriodMode === 'day'
                    ? hasDayActivity && (this.statsDisplayMode === 'words' || this.statsDisplayMode === 'pages')
                    : metricValue > 0;
                if (shouldHighlightWritingDay) {
                    dayEl.addClass('has-words');
                }
            }

            if (streakClasses !== null) {
                const cls = streakClasses.get(iso);
                if (cls === 'full') dayEl.addClass('is-streak-day');
                else if (cls === 'light') dayEl.addClass('is-streak-fill');
                else if (cls === 'red') dayEl.addClass('is-streak-broken');
            }

            if (this.statsDailyComments[iso]?.trim()) {
                dayEl.addClass('has-comment');
            }

            dayEl.addEventListener('click', () => {
                this.selectedStatsDate = iso;
                this.redrawStatisticsView();
            });
        }
    }

    /** Timeline view state: rows loaded + scroll offset, kept across redraws
     *  so selecting a day doesn't bounce you back to the top. */
    private timelineLoadedCount = 0;
    private timelineScrollTop = 0;

    /** Marks a list row's comment dot and (if enabled) a one-line preview. */
    private addDayCommentPreview(row: HTMLElement, iso: string): void {
        const comment = this.statsDailyComments[iso]?.trim();
        if (!comment) return;
        row.addClass('has-comment');
        if (this.plugin.settings.stats?.listCommentPreview !== false) {
            row.createDiv({ cls: 'book-smith-stats-day-list-comment', text: comment });
        }
    }

    /**
     * Infinite-scroll timeline: every writing-period day from today back to
     * the earliest period start (for Global: days with recorded activity),
     * newest first, loaded in chunks as you scroll. Month headers separate
     * the months; the month picker doesn't apply here.
     */
    /**
     * Unified day list. `infinite`: false = the visible month (month picker
     * applies), true = all history as an infinite scroll (ordered by the
     * Timeline order setting). `writingDaysOnly`: false = every writing-period
     * day, true = only quota days (written days + one zero row per missed
     * slot). Writing-days-only needs a project (Global has no schedule).
     */
    private renderDayList(container: HTMLElement, opts: { infinite: boolean; writingDaysOnly: boolean }) {
        const { infinite, writingDaysOnly } = opts;
        const CHUNK = 60;
        const rollover = this.plugin.settings.focus.dailyRolloverMinutes;
        const today = getLogicalDayISODate(new Date(), rollover);

        const book = this.statsSourceBookId === 'global'
            ? null
            : this.statsBooks.find((b) => b.basic.uuid === this.statsSourceBookId) || null;

        const getDayValue = (iso: string): number => {
            const entry = book?.stats?.daily_progress?.[iso];
            if (entry) return Math.max(0, entry.net_change || 0);
            return Math.max(0, book?.stats?.daily_words?.[iso] || 0);
        };

        // Period coverage + how far back "all history" reaches.
        let periods: ReturnType<typeof normalizeStreakPeriods> | null = null;
        let coveredBy: (iso: string) => boolean;
        let earliest: string;
        if (book) {
            const created = book.basic?.created_at ? new Date(book.basic.created_at) : new Date();
            const fallbackStart = getLogicalDayISODate(
                Number.isNaN(created.getTime()) ? new Date() : created,
                rollover
            );
            periods = normalizeStreakPeriods(book.stats?.writing_periods, fallbackStart);
            const ps = periods;
            coveredBy = (iso) => ps.some((p) => iso >= p.startDate && (!p.endDate || iso <= p.endDate));
            earliest = periods.reduce((min, p) => (p.startDate < min ? p.startDate : min), periods[0].startDate);
        } else {
            coveredBy = (iso) => this.hasDayProgressActivity(iso);
            const activity = [
                ...Object.keys(this.statsDailyWords || {}),
                ...Object.keys(this.statsDailyProgress || {})
            ].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
            earliest = activity[0] || today;
        }

        if (writingDaysOnly && !periods) {
            container.createEl('p', {
                cls: 'book-smith-stats-day-list-empty',
                text: 'Writing days view needs a project (not Global).'
            });
            return;
        }

        // Range: whole history (infinite) or the visible month, clamped to today.
        const monthStart = this.toLocalISODate(new Date(this.statsViewMonth.getFullYear(), this.statsViewMonth.getMonth(), 1));
        const monthEnd = this.toLocalISODate(new Date(this.statsViewMonth.getFullYear(), this.statsViewMonth.getMonth() + 1, 0));
        const rangeStart = infinite ? earliest : monthStart;
        const rangeEndRaw = infinite ? today : monthEnd;
        const rangeEnd = rangeEndRaw < today ? rangeEndRaw : today;

        // Build entries { iso, missed } within range.
        const entries: Array<{ iso: string; missed: boolean }> = [];
        if (writingDaysOnly && periods) {
            let week = getWeekStartISO(rangeStart);
            const lastWeek = getWeekStartISO(rangeEnd);
            for (let guard = 0; guard < 600 && week <= lastWeek; guard++) {
                const { written, missed } = getWeekQuotaDays(periods, getDayValue, week, today);
                written.forEach((d) => { if (d >= rangeStart && d <= rangeEnd) entries.push({ iso: d, missed: false }); });
                missed.forEach((d) => { if (d >= rangeStart && d <= rangeEnd) entries.push({ iso: d, missed: true }); });
                const next = new Date(`${week}T12:00:00`);
                next.setDate(next.getDate() + 7);
                week = this.toLocalISODate(next);
            }
        } else {
            const cursor = new Date(`${rangeStart}T12:00:00`);
            const end = new Date(`${rangeEnd}T12:00:00`);
            for (let guard = 0; guard < 20000 && cursor <= end; guard++) {
                const iso = this.toLocalISODate(cursor);
                if (coveredBy(iso)) entries.push({ iso, missed: false });
                cursor.setDate(cursor.getDate() + 1);
            }
        }

        if (entries.length === 0) {
            container.createEl('p', {
                cls: 'book-smith-stats-day-list-empty',
                text: writingDaysOnly
                    ? (infinite ? 'No quota days yet.' : 'No quota days this month.')
                    : (infinite ? 'No recorded writing days yet.' : 'No writing-period days this month.')
            });
            return;
        }

        // Order: month view reads top-down ascending; infinite uses the setting.
        const order = infinite ? this.plugin.settings.stats?.timelineOrder : 'oldest';
        entries.sort((a, b) => {
            if (order === 'oldest') return a.iso.localeCompare(b.iso);
            if (order === 'month-desc') {
                const ma = a.iso.slice(0, 7);
                const mb = b.iso.slice(0, 7);
                return ma === mb ? a.iso.localeCompare(b.iso) : mb.localeCompare(ma);
            }
            return b.iso.localeCompare(a.iso); // newest
        });

        let lastMonthKey = '';
        let rendered = 0;
        const renderRow = (entry: { iso: string; missed: boolean }) => {
            const iso = entry.iso;
            if (infinite) {
                const monthKey = iso.slice(0, 7);
                if (monthKey !== lastMonthKey) {
                    lastMonthKey = monthKey;
                    const md = new Date(`${iso}T12:00:00`);
                    container.createEl('div', {
                        cls: 'book-smith-stats-timeline-month',
                        text: md.toLocaleString('en-US', { month: 'long', year: 'numeric' })
                    });
                }
            }
            const d = new Date(`${iso}T12:00:00`);
            const metricValue = this.getMetricForPeriod(d);
            const metricText = this.getDayMetricShortText(metricValue);
            const row = container.createDiv({ cls: 'book-smith-stats-day-list-row' });
            if (iso === this.selectedStatsDate) row.addClass('is-selected');
            if (entry.missed) row.addClass('is-missed');
            row.createEl('span', {
                cls: 'book-smith-stats-day-list-date',
                text: d.toLocaleString('en-US', { month: 'long', day: 'numeric' })
            });
            const valueEl = row.createEl('span', { cls: 'book-smith-stats-day-list-value', text: metricText });
            if (entry.missed || metricValue < 0) valueEl.addClass('progress-negative');
            else if (metricValue > 0) valueEl.addClass('progress-purple');
            this.addDayCommentPreview(row, iso);
            row.addEventListener('click', () => {
                this.timelineScrollTop = container.scrollTop;
                this.selectedStatsDate = iso;
                this.redrawStatisticsView();
            });
            rendered++;
        };

        if (!infinite) {
            entries.forEach(renderRow);
            return;
        }

        // Infinite scroll: chunked render, remembers how much was open + scroll.
        const loadMore = () => {
            const target = Math.min(entries.length, Math.max(rendered + CHUNK, this.timelineLoadedCount));
            while (rendered < target) renderRow(entries[rendered]);
            this.timelineLoadedCount = rendered;
        };
        loadMore();
        container.addEventListener('scroll', () => {
            this.timelineScrollTop = container.scrollTop;
            if (rendered >= entries.length) return;
            if (container.scrollTop + container.clientHeight >= container.scrollHeight - 60) loadMore();
        });
        if (this.timelineScrollTop > 0) {
            requestAnimationFrame(() => { container.scrollTop = this.timelineScrollTop; });
        }
    }

    private renderWeekBoxes(container: HTMLElement) {
        const year = this.statsViewMonth.getFullYear();
        const month = this.statsViewMonth.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        const ranges: Array<[number, number]> = [
            [1, Math.min(7, lastDay)],
            [8, Math.min(14, lastDay)],
            [15, Math.min(21, lastDay)],
            [22, lastDay]
        ];

        ranges.forEach((range, index) => {
            const [startDay, endDay] = range;
            if (startDay > lastDay) return;

            const startDate = new Date(year, month, startDay);
            const endDate = new Date(year, month, endDay);
            const metricValue = this.sumMetricInRange(startDate, endDate);
            this.createPeriodBox(
                container,
                `${i18n.t('PERIOD_WEEK')} ${index + 1}`,
                `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
                metricValue,
                this.toLocalISODate(startDate)
            );
        });
    }

    private renderMonthBoxes(container: HTMLElement) {
        const year = this.statsViewMonth.getFullYear();
        for (let month = 0; month < 12; month++) {
            const date = new Date(year, month, 1);
            const metricValue = this.getMetricForPeriod(date);
            this.createPeriodBox(
                container,
                date.toLocaleDateString(undefined, { month: 'long' }),
                String(year),
                metricValue,
                this.toLocalISODate(date)
            );
        }
    }

    private renderYearBoxes(container: HTMLElement) {
        const decadeStart = Math.floor(this.statsViewMonth.getFullYear() / 10) * 10;
        for (let year = decadeStart; year < decadeStart + 10; year++) {
            const date = new Date(year, 0, 1);
            const metricValue = this.getMetricForPeriod(date);
            this.createPeriodBox(
                container,
                String(year),
                i18n.t('PERIOD_YEAR'),
                metricValue,
                this.toLocalISODate(date)
            );
        }
    }

    private createPeriodBox(
        container: HTMLElement,
        title: string,
        subtitle: string,
        words: number,
        anchorIso: string
    ) {
        const box = container.createDiv({ cls: 'book-smith-stats-period-box' });
        const periodCommentKey = this.getCommentStorageKey(anchorIso);
        if ((this.statsPeriodComments[periodCommentKey] || '').trim()) {
            box.addClass('has-comment');
        }
        if (this.isSelectedPeriod(anchorIso)) {
            box.addClass('is-selected');
        }

        box.createEl('div', { cls: 'book-smith-stats-period-title', text: title });
        box.createEl('div', { cls: 'book-smith-stats-period-subtitle', text: subtitle });
        const valueEl = box.createEl('div', { cls: 'book-smith-stats-period-value', text: this.getDayMetricShortText(words) });
        if (words < 0) {
            valueEl.addClass('progress-negative');
        } else if (words > 0 && (this.statsDisplayMode === 'words' || this.statsDisplayMode === 'pages')) {
            valueEl.addClass('progress-purple');
        }

        box.addEventListener('click', () => {
            this.selectedStatsDate = anchorIso;
            this.redrawStatisticsView();
        });
    }

    private isSelectedPeriod(anchorIso: string): boolean {
        const selected = this.parseLocalISODate(this.selectedStatsDate);
        const anchor = this.parseLocalISODate(anchorIso);

        if (this.statsPeriodMode === 'week') {
            return selected.getFullYear() === anchor.getFullYear() &&
                selected.getMonth() === anchor.getMonth() &&
                selected.getDate() >= anchor.getDate() &&
                selected.getDate() < anchor.getDate() + 7;
        }

        if (this.statsPeriodMode === 'month') {
            return selected.getFullYear() === anchor.getFullYear() &&
                selected.getMonth() === anchor.getMonth();
        }

        if (this.statsPeriodMode === 'year') {
            return selected.getFullYear() === anchor.getFullYear();
        }

        return this.selectedStatsDate === anchorIso;
    }


    public async saveSelectedPeriodComment(comment: string, anchorIso: string) {
        const trimmedComment = comment.trim();
        if (this.statsPeriodMode === 'day') {
            this.plugin.sharedDataManager.setComment(this.selectedStatsDate, trimmedComment);
            await this.plugin.sharedDataManager.save();
            await this.plugin.persistSharedCommentBackups();
            this.statsDailyComments = this.plugin.sharedDataManager.getComments();
            new Notice(i18n.t('DAY_COMMENT_SAVED'));
            this.redrawStatisticsView();
            return;
        }

        const key = this.getCommentStorageKey(anchorIso);
        this.plugin.sharedDataManager.setPeriodComment(key, trimmedComment);
        await this.plugin.sharedDataManager.save();
        await this.plugin.persistSharedCommentBackups();
        this.statsPeriodComments = this.plugin.sharedDataManager.getPeriodComments();
        new Notice(i18n.t('DAY_COMMENT_SAVED'));
        this.redrawStatisticsView();
    }

    public redrawStatisticsView() {
        if (!this.normalView) return;
        this.closeStatsProgressMenu();
        this.normalView.empty();
        this.statsComponent.renderStatisticsView(this.normalView);
    }

    private toISODate(date: Date): string {
        return this.toLocalISODate(date);
    }

    private getDayMetricShortText(value: number): string {
        if (this.statsDisplayMode === 'pomodoros') {
            return `${this.formatPomodoros(value)}`;
        }

        if (this.statsDisplayMode === 'hours') {
            return `${this.formatHoursFromPomodoros(value)}`;
        }

        if (this.statsDisplayMode === 'pages') {
            return `${this.formatPages(value)}`;
        }

        if (Math.abs(value) >= 10000) {
            return `${value < 0 ? '-' : ''}${(Math.abs(value) / 1000).toFixed(1).replace(/\.0$/, '')}k`;
        }

        return `${value}`;
    }

    public getSelectedDayMetricText(value: number): string {
        if (this.statsDisplayMode === 'pomodoros') {
            return `${this.formatPomodoros(value)}`;
        }

        if (this.statsDisplayMode === 'hours') {
            return `${this.formatHoursFromPomodoros(value)}`;
        }

        if (this.statsDisplayMode === 'pages') {
            return `${this.formatPages(value)}`;
        }

        return `${value}`;
    }

    private formatPages(words: number): string {
        const pages = words / this.wordsPerPage;
        return Number.isInteger(pages) ? String(pages) : pages.toFixed(1);
    }

    private formatPomodoros(value: number): string {
        return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
    }

    private getNewMaterialWritten(entry: DailyProgressEntry): number {
        // Removed: no longer needed
        return 0;
    }

    private getRawWritingMetric(entry: DailyProgressEntry): number {
        if (this.statsWritingDisplayMode === 'daily-output') {
            return Math.max(0, entry.net_change || 0);
        }
        return entry.net_change || 0;
    }

    private getDisplayedWritingMetric(entry: DailyProgressEntry): number {
        return this.getRawWritingMetric(entry);
    }

    public getDisplayedBreakdown(entry: DailyProgressEntry): { positive: number; negative: number } {
        if (this.statsWritingDisplayMode === 'raw') {
            return {
                positive: entry.words_added ?? entry.positive_change ?? 0,
                negative: entry.words_deleted ?? Math.abs(entry.negative_change || 0)
            };
        }

        // Both daily-output and new-material-net use the same formula:
        // new_material = net_change + old_deletions
        const netChange = entry.net_change || 0;
        const oldDeletions = entry.old_deletions || 0;
        const newMaterial = netChange + oldDeletions;
        return {
            positive: newMaterial,
            negative: -oldDeletions
        };
    }

    public getMainMetricForDetails(currentMetric: number, progress: DailyProgressEntry | null): number {
        if (this.statsDisplayMode !== 'words' && this.statsDisplayMode !== 'pages') {
            return currentMetric;
        }
        if (!progress) {
            return currentMetric;
        }
        if (this.statsWritingDisplayMode === 'daily-output') {
            // new_material = net_change + old_deletions
            const newMaterial = (progress.net_change || 0) + (progress.old_deletions || 0);
            return Math.max(0, newMaterial);
        }
        if (this.statsWritingDisplayMode === 'raw') {
            return (progress.words_added ?? progress.positive_change ?? 0) - (progress.words_deleted ?? Math.abs(progress.negative_change || 0));
        }
        return progress.net_change || 0;
    }

    public getMainMetricHoverLabel(): string {
        if (this.statsWritingDisplayMode === 'daily-output') {
            return 'New material added';
        }
        return 'Net material';
    }

    public getBreakdownHoverLabels(): { positive: string; negative: string } {
        if (this.statsWritingDisplayMode === 'raw') {
            const unit = this.statsDisplayMode === 'pages' ? 'pages' : 'words';
            return {
                positive: `Raw ${unit} added`,
                negative: `Raw ${unit} removed`
            };
        }

        return {
            positive: 'New material added',
            negative: 'Old material removed'
        };
    }

    private hasDayProgressActivity(dateKey: string): boolean {
        return Boolean(this.statsDailyProgress[dateKey]);
    }

    public hasProgressActivity(entry: DailyProgressEntry): boolean {
        return entry.positive_change !== 0 || entry.negative_change !== 0 || entry.net_change !== 0;
    }

    public getPeriodAnchorDate(anchorDate: Date): Date {
        if (this.statsPeriodMode === 'week') {
            const day = anchorDate.getDate();
            const startDay = day <= 7 ? 1 : day <= 14 ? 8 : day <= 21 ? 15 : 22;
            return new Date(anchorDate.getFullYear(), anchorDate.getMonth(), startDay);
        }

        if (this.statsPeriodMode === 'month') {
            return new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
        }

        if (this.statsPeriodMode === 'year') {
            return new Date(anchorDate.getFullYear(), 0, 1);
        }

        return new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    }

    public getProgressForSelectedPeriod(anchorDate: Date): DailyProgressEntry | null {
        if (this.statsPeriodMode === 'day') {
            return this.statsDailyProgress[this.toLocalISODate(anchorDate)] || null;
        }

        if (this.statsPeriodMode === 'week') {
            const start = this.getPeriodAnchorDate(anchorDate);
            const endDay = Math.min(start.getDate() + 6, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate());
            const end = new Date(start.getFullYear(), start.getMonth(), endDay);
            return this.sumProgressInRange(start, end);
        }

        if (this.statsPeriodMode === 'month') {
            const start = this.getPeriodAnchorDate(anchorDate);
            const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
            return this.sumProgressInRange(start, end);
        }

        const start = this.getPeriodAnchorDate(anchorDate);
        const end = new Date(start.getFullYear(), 11, 31);
        return this.sumProgressInRange(start, end);
    }

    private sumProgressInRange(start: Date, end: Date): DailyProgressEntry {
        const total: DailyProgressEntry = {
            positive_change: 0,
            negative_change: 0,
            net_change: 0,
            words_added: 0,
            words_deleted: 0,
            iteration_deletions: 0,
            old_deletions: 0
        };

        const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        while (cursor <= last) {
            const key = this.toLocalISODate(cursor);
            const entry = this.statsDailyProgress[key];
            if (entry) {
                total.positive_change += entry.positive_change || 0;
                total.negative_change += entry.negative_change || 0;
                total.net_change += entry.net_change || 0;
                total.words_added = (total.words_added || 0) + (entry.words_added || 0);
                total.words_deleted = (total.words_deleted || 0) + (entry.words_deleted || 0);
                total.iteration_deletions = (total.iteration_deletions || 0) + (entry.iteration_deletions || 0);
                total.old_deletions = (total.old_deletions || 0) + (entry.old_deletions || 0);
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        return total;
    }

    public getCommentStorageKey(anchorIso: string): string {
        return `${this.statsPeriodMode}|${anchorIso}`;
    }

    public getBreakdownValueText(value: number, forcePlus = false, forceMinus = false): string {
        const numeric = this.statsDisplayMode === 'pages' ? value / this.wordsPerPage : value;
        const absValue = Math.abs(numeric);
        const formatted = Number.isInteger(absValue)
            ? String(absValue)
            : absValue.toFixed(1).replace(/\.0$/, '');

        if (forcePlus && numeric >= 0) {
            return `+${formatted}`;
        }

        if (forceMinus) {
            return `-${formatted}`;
        }

        if (numeric < 0) {
            return `-${formatted}`;
        }

        return formatted;
    }

    private formatHoursFromPomodoros(pomodoros: number): string {
        const totalMinutes = Math.max(0, Math.round(pomodoros * 30));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}:${String(minutes).padStart(2, '0')}`;
    }

    public toLocalISODate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    public parseLocalISODate(dateStr: string): Date {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, (month || 1) - 1, day || 1);
    }

    public shiftViewPeriod(direction: number) {
        if (this.statsPeriodMode === 'year') {
            this.statsViewMonth = new Date(this.statsViewMonth.getFullYear() + (direction * 10), 0, 1);
            return;
        }

        if (this.statsPeriodMode === 'month') {
            this.statsViewMonth = new Date(this.statsViewMonth.getFullYear() + direction, this.statsViewMonth.getMonth(), 1);
            return;
        }

        this.statsViewMonth = new Date(this.statsViewMonth.getFullYear(), this.statsViewMonth.getMonth() + direction, 1);
    }

    public getMetricForPeriod(anchorDate: Date): number {
        if (this.statsDisplayMode === 'pomodoros' || this.statsDisplayMode === 'hours') {
            return this.getPomodorosForPeriod(anchorDate);
        }

        return this.getWordsForPeriod(anchorDate);
    }

    private getWordsForPeriod(anchorDate: Date): number {
        if (this.statsPeriodMode === 'day') {
            const key = this.toLocalISODate(anchorDate);
            const entry = this.statsDailyProgress[key];
            return entry ? this.getDisplayedWritingMetric(entry) : (this.statsDailyWords[key] || 0);
        }

        if (this.statsPeriodMode === 'week') {
            const start = this.getPeriodAnchorDate(anchorDate);
            const endDay = Math.min(start.getDate() + 6, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate());
            const end = new Date(start.getFullYear(), start.getMonth(), endDay);
            return this.sumWordsInRange(start, end);
        }

        if (this.statsPeriodMode === 'month') {
            const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
            const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
            return this.sumWordsInRange(start, end);
        }

        const start = new Date(anchorDate.getFullYear(), 0, 1);
        const end = new Date(anchorDate.getFullYear(), 11, 31);
        return this.sumWordsInRange(start, end);
    }

    private getPomodorosForPeriod(anchorDate: Date): number {
        if (this.statsPeriodMode === 'day') {
            const key = this.toLocalISODate(anchorDate);
            return this.statsDailyFocusMinutes[key] ? this.statsDailyFocusMinutes[key] / 25 : 0;
        }

        if (this.statsPeriodMode === 'week') {
            const start = this.getPeriodAnchorDate(anchorDate);
            const endDay = Math.min(start.getDate() + 6, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate());
            const end = new Date(start.getFullYear(), start.getMonth(), endDay);
            return this.sumFocusMinutesInRange(start, end) / 25;
        }

        if (this.statsPeriodMode === 'month') {
            const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
            const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
            return this.sumFocusMinutesInRange(start, end) / 25;
        }

        const start = new Date(anchorDate.getFullYear(), 0, 1);
        const end = new Date(anchorDate.getFullYear(), 11, 31);
        return this.sumFocusMinutesInRange(start, end) / 25;
    }

    private sumMetricInRange(start: Date, end: Date): number {
        if (this.statsDisplayMode === 'pomodoros' || this.statsDisplayMode === 'hours') {
            return this.sumFocusMinutesInRange(start, end) / 25;
        }

        return this.sumWordsInRange(start, end);
    }

    private sumWordsInRange(start: Date, end: Date): number {
        let total = 0;
        const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        while (cursor <= last) {
            const key = this.toLocalISODate(cursor);
            const entry = this.statsDailyProgress[key];
            total += entry ? this.getRawWritingMetric(entry) : (this.statsDailyWords[key] || 0);
            cursor.setDate(cursor.getDate() + 1);
        }

        return total;
    }

    private sumFocusMinutesInRange(start: Date, end: Date): number {
        let total = 0;
        const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        while (cursor <= last) {
            const key = this.toLocalISODate(cursor);
            total += this.statsDailyFocusMinutes[key] || 0;
            cursor.setDate(cursor.getDate() + 1);
        }

        return total;
    }

    public getSelectedPeriodLabel(anchorDate: Date): string {
        if (this.statsPeriodMode === 'day') {
            return anchorDate.toLocaleDateString();
        }

        if (this.statsPeriodMode === 'week') {
            const start = this.getPeriodAnchorDate(anchorDate);
            const endDay = Math.min(start.getDate() + 6, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate());
            const end = new Date(start.getFullYear(), start.getMonth(), endDay);
            return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
        }

        if (this.statsPeriodMode === 'month') {
            return anchorDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
        }

        return String(anchorDate.getFullYear());
    }

    // --- Scene Notes panel ---

    /** Controls whether the notes list is currently mounted. */
    private sceneNotesContainer: HTMLElement | null = null;
    private sceneNotesViewEl: HTMLElement | null = null;
    private sceneNotesEditorNoteId: string | null = null;
    private sceneNotesUnsubscribe: (() => void) | null = null;
    private sceneNotesAutosaveTimer: number | null = null;
    private sceneNotesTitleAutosaveTimer: number | null = null;
    private sceneNotesFileOpenRef: any = null;
    private sceneNotesCompact = false;
    /**
     * Cache of each book's canonical file order (read from book-config.json).
     * Keyed by book folder path. Keeps list re-renders synchronous after the
     * first load — critical for eliminating the empty-gap flash that causes
     * the editor panel to shift up/down between list rebuilds.
     */
    private bookFileOrderCache = new Map<string, string[]>();
    /** Set once the vault-modify listener is installed for cache invalidation. */
    private bookFileOrderCacheRegistered = false;
    /**
     * Timestamp-based dblclick tracking for scene-note rows. We can't rely on
     * the browser's native dblclick event because row DOM is replaced when
     * notifyChange fires between the two clicks, which invalidates the
     * browser's same-target check. Tracking by note id + timestamp works
     * regardless of DOM replacement.
     */
    private sceneNotesLastClickTime = 0;
    private sceneNotesLastClickId = '';

    /**
     * User-chosen textarea height for the Scene Notes editor, set by dragging
     * the resize handle between the list and the editor. Persists for the
     * lifetime of the view (reset on teardown) so switching notes preserves
     * the size the user picked.
     */
    private sceneNotesTextareaHeight: number | null = null;

    public async enterSceneNotesMode(openNoteId?: string): Promise<void> {
        if (!this.normalView) return;
        this.isNavigatorMode = false;
        // Clear the stats-view marker so `isStatsViewVisible()` doesn't
        // mistakenly return true — otherwise the 250ms stats-refresh timer
        // (scheduled by revealLeaf → layout-change) would overwrite this view
        // with the statistics panel a moment after it renders.
        this.normalView.removeClass('book-smith-stats-view');
        if (this.statsRefreshTimer !== null) {
            window.clearTimeout(this.statsRefreshTimer);
            this.statsRefreshTimer = null;
        }
        this.normalView.empty();
        this.renderSceneNotesView(this.normalView, openNoteId);

        // Subscribe to updates while this view is mounted.
        if (!this.sceneNotesUnsubscribe) {
            this.sceneNotesUnsubscribe = this.plugin.sceneNotesManager.onNotesChange(() => {
                if (!this.sceneNotesContainer) return;
                this.renderSceneNotesList(this.sceneNotesContainer);
            });
        }
        // Also refresh when the active file changes (to reorder by the now-current book).
        if (!this.sceneNotesFileOpenRef) {
            this.sceneNotesFileOpenRef = this.app.workspace.on('file-open', () => {
                if (!this.sceneNotesContainer) return;
                this.renderSceneNotesList(this.sceneNotesContainer);
            });
            this.registerEvent(this.sceneNotesFileOpenRef);
        }
    }

    /** Public entry point for focusing a specific note (e.g. from a gutter click). */
    public openSceneNoteEditor(noteId: string): void {
        void this.enterSceneNotesMode(noteId);
    }

    private renderSceneNotesView(container: HTMLElement, openNoteId?: string): void {
        const view = container.createDiv({ cls: 'book-smith-scene-notes-view' });
        this.sceneNotesViewEl = view;
        if (this.sceneNotesCompact) view.addClass('is-compact');

        // Header: back button + compact toggle on the right. No title row —
        // the pane needs every bit of vertical space for notes.
        const header = view.createDiv({ cls: 'book-smith-navigator-header' });
        const backButton = header.createEl('button', { cls: 'book-smith-navigator-back-btn' });
        setIcon(backButton, 'arrow-left');
        backButton.appendChild(createSpan({ text: ' Back to Toolbox' }));
        backButton.addEventListener('click', () => {
            if (!this.normalView) return;
            this.teardownSceneNotes();
            this.normalView.empty();
            this.createNormalView(this.normalView);
        });

        // Compact toggle — square action button at the far right of the header.
        const compactBtn = header.createEl('button', {
            cls: 'book-smith-scene-notes-compact-btn',
            attr: { 'aria-label': 'Toggle compact view', title: 'Toggle compact view' }
        });
        setIcon(compactBtn, this.sceneNotesCompact ? 'list' : 'align-justify');
        if (this.sceneNotesCompact) compactBtn.addClass('is-active');
        compactBtn.addEventListener('click', () => {
            this.sceneNotesCompact = !this.sceneNotesCompact;
            view.toggleClass('is-compact', this.sceneNotesCompact);
            setIcon(compactBtn, this.sceneNotesCompact ? 'list' : 'align-justify');
            compactBtn.toggleClass('is-active', this.sceneNotesCompact);
        });

        // List section.
        const listWrapper = view.createDiv({ cls: 'book-smith-scene-notes-list-wrapper' });
        this.sceneNotesContainer = listWrapper;
        // Attach a single click delegate on the container — survives row
        // rebuilds. Per-row listeners would be lost every time notifyChange
        // fires (color save, title autosave, line-tracker update) because
        // rows get replaced, which also kills the browser's native dblclick
        // detection. Timestamp-based detection below is immune to that.
        this.attachSceneNotesClickDelegate(listWrapper);
        this.renderSceneNotesList(listWrapper);

        // Resize handle — drag up/down to grow/shrink the editor textarea.
        // Sits between the list and the editor; CSS hides it when no note is
        // selected (the editor itself is display:none in that state).
        const resizeHandle = view.createDiv({ cls: 'book-smith-scene-notes-resize-handle' });
        resizeHandle.setAttribute('role', 'separator');
        resizeHandle.setAttribute('aria-orientation', 'horizontal');
        resizeHandle.setAttribute('aria-label', 'Resize note editor');
        this.attachSceneNotesResizeHandle(resizeHandle, view);

        // Editor section — only populated when a note is selected.
        view.createDiv({ cls: 'book-smith-scene-notes-editor', attr: { 'data-empty': 'true' } });

        if (openNoteId) {
            this.selectSceneNote(openNoteId);
        }
    }

    /**
     * Resolve notes + book file order asynchronously, THEN do a single sync
     * empty+fill of the list container. The atomic DOM swap prevents the list
     * from flashing empty, which in turn prevents the editor panel below from
     * shifting up/down between rebuilds — the "color panel flash" the user
     * reported.
     */
    private renderSceneNotesList(container: HTMLElement): void {
        const activeFile = this.app.workspace.getActiveFile();
        void (async () => {
            if (activeFile?.extension === 'md') {
                await this.plugin.sceneNotesManager.ensureLoadedForFile(activeFile.path);
            }
            if (this.sceneNotesContainer !== container) return;

            const activeFilePath = activeFile?.extension === 'md' ? activeFile.path : null;
            const allEntries = this.plugin.sceneNotesManager.getAllLoadedNotes();

            // Resolve the book that owns the active file.
            let activeBookId: string | null = null;
            if (activeFilePath) {
                const entry = allEntries.find(e =>
                    activeFilePath === e.owner.folderPath || activeFilePath.startsWith(e.owner.folderPath + '/')
                );
                activeBookId = entry?.owner.uuid || null;
            }

            const projectEntries = activeBookId
                ? allEntries.filter(e => e.owner.uuid === activeBookId)
                : [];

            // Pre-load ordered-file list before touching the DOM.
            let orderedFiles: string[] = [];
            if (projectEntries.length > 0) {
                orderedFiles = await this.getBookFileOrderCached(projectEntries[0].owner.folderPath);
            }
            if (this.sceneNotesContainer !== container) return;

            // Now do a sync rebuild — atomic empty+fill, no visible gap.
            this.renderSceneNotesListSync(container, projectEntries, orderedFiles, activeBookId);
        })();
    }

    /**
     * Read the book's chapter tree and return a flat ordered list of relative
     * file paths (e.g. ["Title Page.md", "Epigraph.md", "ACT I/Scene 1.md"]).
     * Groups (folders) are traversed depth-first in their declared order.
     * Falls back to an empty array if the config cannot be read.
     */
    private async getBookFileOrder(bookFolderPath: string): Promise<string[]> {
        try {
            const configPath = `${bookFolderPath}/book-config.json`;
            const configFile = this.app.vault.getAbstractFileByPath(configPath);
            if (!(configFile instanceof TFile)) return [];
            const raw = await this.app.vault.read(configFile);
            const book = JSON.parse(raw) as Book;
            const result: string[] = [];
            const flatten = (nodes: ChapterNode[], prefix = '') => {
                const sorted = [...nodes].sort((a, b) => a.order - b.order);
                for (const node of sorted) {
                    if (node.type === 'file') {
                        // path in book-config is relative to the book folder
                        result.push(prefix ? `${prefix}/${node.path}` : node.path);
                    } else if (node.children?.length) {
                        flatten(node.children, prefix ? `${prefix}/${node.path}` : node.path);
                    }
                }
            };
            if (book.structure?.tree) flatten(book.structure.tree);
            return result;
        } catch {
            return [];
        }
    }

    /**
     * Cached wrapper around getBookFileOrder. First call per book reads and
     * caches; subsequent calls return the cached order synchronously (they
     * still await at the call site but resolve immediately). Also lazy-installs
     * a vault 'modify' listener that invalidates the cache when any
     * book-config.json changes — so reordering the tree via drag-and-drop is
     * reflected on the next render.
     */
    private async getBookFileOrderCached(bookFolderPath: string): Promise<string[]> {
        const cached = this.bookFileOrderCache.get(bookFolderPath);
        if (cached) return cached;
        const fresh = await this.getBookFileOrder(bookFolderPath);
        this.bookFileOrderCache.set(bookFolderPath, fresh);
        if (!this.bookFileOrderCacheRegistered) {
            this.bookFileOrderCacheRegistered = true;
            this.registerEvent(this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.name === 'book-config.json') {
                    this.bookFileOrderCache.clear();
                    if (this.sceneNotesContainer) {
                        this.renderSceneNotesList(this.sceneNotesContainer);
                    }
                }
            }));
        }
        return fresh;
    }

    /**
     * Sync render of the notes list given pre-resolved data. Called by
     * renderSceneNotesList after all async deps are satisfied. Does a single
     * empty+fill so the list never flashes empty.
     */
    private renderSceneNotesListSync(
        container: HTMLElement,
        projectEntries: Array<{ owner: BookOwner; note: SceneNote }>,
        orderedFiles: string[],
        activeBookId: string | null
    ): void {
        container.empty();

        if (projectEntries.length === 0) {
            container.createEl('p', {
                cls: 'book-smith-navigator-empty',
                text: activeBookId
                    ? 'No scene notes yet. Press Ctrl+J in a paragraph to add one.'
                    : 'Open a file in your book to see its scene notes.'
            });
            return;
        }

        const owner = projectEntries[0].owner;

        {
            const notes = projectEntries.map(e => e.note);

            // Sub-group by relative file path within this book.
            const groups = new Map<string, typeof notes>();
            for (const note of notes) {
                const rel = note.filePath.startsWith(owner.folderPath + '/')
                    ? note.filePath.slice(owner.folderPath.length + 1)
                    : note.filePath;
                const arr = groups.get(rel) || [];
                arr.push(note);
                groups.set(rel, arr);
            }

            // Sort file groups by their position in the book's chapter tree,
            // falling back to alphabetical for files not found in the tree.
            const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => {
                const ai = orderedFiles.indexOf(a);
                const bi = orderedFiles.indexOf(b);
                if (ai === -1 && bi === -1) return a.localeCompare(b);
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
            });

            sortedGroupKeys.forEach(key => {
                const section = container.createDiv({ cls: 'book-smith-scene-notes-group' });
                section.createEl('h4', { cls: 'book-smith-scene-notes-group-title', text: key });

                const notesInGroup = (groups.get(key) || []).slice().sort((a, b) => a.fromLine - b.fromLine);
                notesInGroup.forEach(note => {
                    const row = section.createDiv({ cls: 'book-smith-scene-notes-row' });
                    if (note.id === this.sceneNotesEditorNoteId) row.addClass('is-active');

                    const flag = row.createSpan({ cls: 'book-smith-scene-notes-row-flag' });
                    setIcon(flag, 'flag');
                    if (note.color) flag.style.setProperty('--scene-note-color', note.color);

                    const body = row.createDiv({ cls: 'book-smith-scene-notes-row-body' });

                    // Title row: real title or greyed-out content fallback.
                    const noteTitle = note.title?.trim();
                    const hasTitle = !!noteTitle;
                    const titleEl = body.createDiv({ cls: 'book-smith-scene-notes-row-title' });
                    if (hasTitle) {
                        titleEl.setText(noteTitle!);
                    } else {
                        const fallback = (note.content || '').trim().split('\n')[0] || '(empty note)';
                        titleEl.setText(fallback.length > 80 ? fallback.slice(0, 80) + '…' : fallback);
                        titleEl.addClass('is-placeholder');
                    }

                    // Meta: created date + anchor line.
                    const createdDate = note.createdAt ? new Date(note.createdAt) : null;
                    const dateStr = createdDate
                        ? createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                        : '';
                    body.createDiv({
                        cls: 'book-smith-scene-notes-row-meta',
                        text: [dateStr, `Line ${note.fromLine + 1}`].filter(Boolean).join(' · ')
                    });

                    row.dataset.noteId = note.id;
                    // Click handling is done by the container-level delegate
                    // in attachSceneNotesClickDelegate — no per-row listeners.
                });
            });
        }
    }

    /**
     * Wire up vertical drag on the resize handle between the list and the
     * editor. Drag up → textarea grows (list shrinks); drag down → textarea
     * shrinks (list grows). The chosen height is persisted in
     * `sceneNotesTextareaHeight` so switching notes keeps the size.
     *
     * Bounds: textarea can't shrink below the CSS `min-height: 120px`, and
     * can't grow past 75% of the view's height (so the list never disappears
     * entirely). Mousemove/up are attached lazily on mousedown and removed
     * on release, so no persistent global listeners.
     */
    private attachSceneNotesResizeHandle(handle: HTMLElement, view: HTMLElement): void {
        handle.addEventListener('mousedown', (e) => {
            const textareaEl = view.querySelector<HTMLTextAreaElement>('.book-smith-scene-notes-editor-textarea');
            const editorEl = view.querySelector<HTMLElement>('.book-smith-scene-notes-editor');
            if (!textareaEl || !editorEl) return;
            if (editorEl.getAttribute('data-empty') === 'true') return;

            e.preventDefault();
            const startY = e.clientY;
            const startHeight = textareaEl.offsetHeight;
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            handle.addClass('is-dragging');

            const onMove = (ev: MouseEvent) => {
                const delta = startY - ev.clientY; // drag UP → positive → grow
                const viewHeight = view.getBoundingClientRect().height;
                const maxHeight = Math.max(120, viewHeight * 0.75);
                const newHeight = Math.max(60, Math.min(maxHeight, startHeight + delta));
                textareaEl.style.height = `${newHeight}px`;
                this.sceneNotesTextareaHeight = newHeight;
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                handle.removeClass('is-dragging');
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    }

    /**
     * Install a single mousedown delegate on the list container. We use
     * `mousedown` rather than `click` because:
     *   - `click` requires mousedown+mouseup to land on the SAME DOM node.
     *     When notifyChange rebuilds the rows between press and release, the
     *     browser silently drops the `click` event, so single-clicks were
     *     intermittent.
     *   - `mousedown` fires the instant the button goes down, before any
     *     async rebuild can race with it. Every press reaches this handler.
     *
     * The delegate is attached once to the container (which is never
     * replaced), so it survives all row rebuilds. Double-click is detected
     * by timestamp + note id — immune to DOM replacement between presses,
     * unlike the browser's native dblclick (which also requires same-target).
     */
    private attachSceneNotesClickDelegate(container: HTMLElement): void {
        container.addEventListener('mousedown', (evt) => {
            if (evt.button !== 0) return; // left-click only
            const target = evt.target as HTMLElement | null;
            if (!target) return;
            const row = target.closest('.book-smith-scene-notes-row') as HTMLElement | null;
            if (!row) return;
            const noteId = row.dataset.noteId;
            if (!noteId) return;

            const now = Date.now();
            const isDouble = (now - this.sceneNotesLastClickTime < 500)
                && (this.sceneNotesLastClickId === noteId);
            this.sceneNotesLastClickTime = now;
            this.sceneNotesLastClickId = noteId;

            // First press selects — idempotent if already selected, so the
            // second press of a double-click just re-selects with no ill effect.
            // `true` → glow the paragraph in the editor: this is a panel click,
            // so the cue helps locate the scene. (Selections originating from
            // the editor gutter flag pass false — you're already there.)
            this.selectSceneNote(noteId, true);

            // Second press on the SAME note within 500ms → navigate the
            // main editor to that scene.
            if (isDouble) {
                const located = this.plugin.sceneNotesManager.getNoteById(noteId);
                if (located) void this.plugin.focusEditorOnNote(located.note);
            }
        });
    }

    private selectSceneNote(noteId: string, triggerGlow = false): void {
        this.sceneNotesEditorNoteId = noteId;
        // Preserve the note list's scroll position across this selection — the
        // editor below repopulates and the textarea autofocuses, either of
        // which can otherwise nudge the list. Restore on the next frame.
        const listEl = this.sceneNotesContainer;
        const prevScroll = listEl?.scrollTop ?? 0;
        if (listEl) {
            requestAnimationFrame(() => { listEl.scrollTop = prevScroll; });
        }
        // Update active highlight directly in the DOM — no full re-render so there's no blink.
        if (this.sceneNotesContainer) {
            this.sceneNotesContainer.querySelectorAll<HTMLElement>('.book-smith-scene-notes-row').forEach(el => {
                el.toggleClass('is-active', el.dataset.noteId === noteId);
            });
        }

        const editor = this.normalView?.querySelector('.book-smith-scene-notes-editor') as HTMLElement | null;
        if (!editor) return;
        editor.empty();
        editor.removeAttribute('data-empty');

        const located = this.plugin.sceneNotesManager.getNoteById(noteId);
        if (!located) {
            editor.setAttribute('data-empty', 'true');
            return;
        }
        const note = located.note;

        // Subtle cue: glow the note's paragraph in any editor where it's
        // currently visible (no scrolling). Only when the selection came from
        // a panel click — clicking the editor's own gutter flag shouldn't
        // glow (you're already looking right at it). No-op if the setting is
        // off or the paragraph isn't on screen.
        if (triggerGlow) {
            this.plugin.glowSceneNoteInEditor(note);
        }

        const headerRow = editor.createDiv({ cls: 'book-smith-scene-notes-editor-header' });

        // Left side: anchor line + created date.
        const headerLeft = headerRow.createDiv({ cls: 'book-smith-scene-notes-editor-header-left' });
        headerLeft.createEl('span', {
            cls: 'book-smith-scene-notes-editor-title',
            text: `Line ${note.fromLine + 1}${note.toLine !== note.fromLine ? `–${note.toLine + 1}` : ''}`
        });
        if (note.createdAt) {
            const createdFull = new Date(note.createdAt).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric'
            });
            headerLeft.createEl('span', {
                cls: 'book-smith-scene-notes-editor-created',
                text: `Created ${createdFull}`
            });
        }

        const deleteBtn = headerRow.createEl('button', {
            cls: 'book-smith-scene-notes-delete-btn',
            attr: { 'aria-label': 'Delete note' }
        });
        setIcon(deleteBtn, 'trash');
        deleteBtn.addEventListener('click', async () => {
            await this.plugin.sceneNotesManager.deleteNote(note.id);
            this.sceneNotesEditorNoteId = null;
            const ed = this.normalView?.querySelector('.book-smith-scene-notes-editor') as HTMLElement | null;
            if (ed) { ed.empty(); ed.setAttribute('data-empty', 'true'); }
            new Notice('Scene note deleted');
        });

        // Color swatch row — Final Draft-style palette.
        const SCENE_NOTE_COLORS: Array<{ name: string; value: string | null }> = [
            { name: 'None', value: null },
            { name: 'Red', value: '#d94a4a' },
            { name: 'Orange', value: '#e88a3a' },
            { name: 'Yellow', value: '#e8c93a' },
            { name: 'Green', value: '#4aa84a' },
            { name: 'Blue', value: '#4a8ae8' },
            { name: 'Purple', value: '#8a4ad9' },
            { name: 'Grey', value: '#8a8a8a' }
        ];

        const colorRow = editor.createDiv({ cls: 'book-smith-scene-notes-color-row' });
        colorRow.createEl('span', {
            cls: 'book-smith-scene-notes-color-label',
            text: 'Color:'
        });
        const swatches = colorRow.createDiv({ cls: 'book-smith-scene-notes-color-swatches' });

        SCENE_NOTE_COLORS.forEach(({ name, value }) => {
            const swatch = swatches.createDiv({
                cls: 'book-smith-scene-notes-color-swatch',
                attr: { 'aria-label': name, title: name }
            });
            if (value === null) {
                swatch.addClass('is-none');
            } else {
                swatch.style.backgroundColor = value;
            }
            const isActive = (note.color || null) === value;
            if (isActive) swatch.addClass('is-active');

            swatch.addEventListener('click', async () => {
                await this.plugin.sceneNotesManager.updateNote(note.id, {
                    color: value === null ? undefined : value
                });
                // Refresh swatch selection state without rebuilding the whole editor.
                swatches.querySelectorAll('.is-active').forEach(el => el.removeClass('is-active'));
                swatch.addClass('is-active');
            });
        });

        // Title input — optional, autosaves.
        const titleInput = editor.createEl('input', {
            cls: 'book-smith-scene-notes-title-input',
            attr: { type: 'text', placeholder: 'Title (optional)…' }
        }) as HTMLInputElement;
        titleInput.value = note.title || '';

        const scheduleTitleSave = () => {
            if (this.sceneNotesTitleAutosaveTimer !== null) {
                window.clearTimeout(this.sceneNotesTitleAutosaveTimer);
            }
            this.sceneNotesTitleAutosaveTimer = window.setTimeout(async () => {
                this.sceneNotesTitleAutosaveTimer = null;
                const val = titleInput.value.trim();
                await this.plugin.sceneNotesManager.updateNote(note.id, { title: val || undefined });
            }, 400);
        };
        titleInput.addEventListener('input', scheduleTitleSave);
        titleInput.addEventListener('blur', async () => {
            if (this.sceneNotesTitleAutosaveTimer !== null) {
                window.clearTimeout(this.sceneNotesTitleAutosaveTimer);
                this.sceneNotesTitleAutosaveTimer = null;
            }
            const val = titleInput.value.trim();
            await this.plugin.sceneNotesManager.updateNote(note.id, { title: val || undefined });
        });

        editor.createEl('div', { cls: 'book-smith-scene-notes-note-label', text: 'Note' });

        // The textarea is rendered with transparent text — the *visible* text
        // comes from the `mirror` div sitting in front of it (pointer-events
        // none, so clicks/keys still hit the textarea). The mirror renders the
        // same content with `<mark class="book-smith-tag-hl">` for `#tags` and
        // `<span class="book-smith-wikilink-hl">[[file]]</span>` for wikilinks,
        // both styled in purple. Identical font/padding/wrap rules between the
        // two layers keep the cursor and selection aligned with what the user
        // sees.
        const textareaWrap = editor.createDiv({ cls: 'book-smith-scene-notes-textarea-wrap' });
        const textarea = textareaWrap.createEl('textarea', {
            cls: 'book-smith-scene-notes-editor-textarea',
            attr: { placeholder: 'Write your note…', spellcheck: 'true' }
        }) as HTMLTextAreaElement;
        textarea.value = note.content || '';
        // Apply any user-chosen height from the divider drag so switching notes
        // preserves the size; otherwise the CSS min-height (120px) defaults in.
        if (this.sceneNotesTextareaHeight !== null) {
            textarea.style.height = `${this.sceneNotesTextareaHeight}px`;
        }
        const mirror = textareaWrap.createDiv({
            cls: 'book-smith-scene-notes-textarea-mirror',
            attr: { 'aria-hidden': 'true' }
        });

        const escapeHtml = (s: string) =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const renderMirror = () => {
            const text = textarea.value;
            // Process wikilinks first; then tags. We do them on the already-
            // escaped text and only insert HTML for matched spans, so the rest
            // remains plain text. Tag regex uses a leading-boundary capture to
            // avoid matching inside words (so `c#` in "C#" wouldn't match).
            let html = escapeHtml(text);
            html = html.replace(
                /\[\[([^\]\r\n]+?)\]\]/g,
                (_m, inner) => `<span class="book-smith-wikilink-hl">[[${inner}]]</span>`
            );
            html = html.replace(
                /(^|[\s(])(#[\w/\-]+)/g,
                (_m, lead, tag) => `${lead}<mark class="book-smith-tag-hl">${tag}</mark>`
            );
            // Trailing newline keeps the mirror's last-line height in sync
            // with the textarea when the content ends in a newline.
            mirror.innerHTML = html + '\n';
        };
        renderMirror();

        textarea.addEventListener('input', () => {
            renderMirror();
            renderLinkSuggest();
        });
        textarea.addEventListener('scroll', () => {
            mirror.scrollTop = textarea.scrollTop;
            mirror.scrollLeft = textarea.scrollLeft;
        });

        // --- Wikilink autocomplete popup ---
        //
        // Triggered while the cursor sits inside an unclosed `[[…` on a single
        // line. Filters vault markdown files by basename/path against the
        // partial query and lets the user commit with Enter / Tab / click.

        const suggestPopup = textareaWrap.createDiv({
            cls: 'book-smith-scene-notes-link-suggest'
        });
        suggestPopup.style.display = 'none';

        let suggestItems: TFile[] = [];
        let suggestActiveIndex = 0;

        const closeSuggest = () => {
            suggestPopup.style.display = 'none';
            suggestPopup.empty();
            suggestItems = [];
            suggestActiveIndex = 0;
        };

        /** If the caret sits inside `[[…` with no closing `]]` on the same line,
         *  return the position right after `[[` and the query so far. */
        const findOpenLinkContext = (): { start: number; query: string } | null => {
            if (textarea.selectionStart !== textarea.selectionEnd) return null;
            const cursor = textarea.selectionStart;
            const value = textarea.value;
            const lastOpen = value.lastIndexOf('[[', cursor);
            if (lastOpen < 0) return null;
            const between = value.slice(lastOpen + 2, cursor);
            if (between.includes(']]') || between.includes('\n')) return null;
            return { start: lastOpen + 2, query: between };
        };

        const renderLinkSuggest = () => {
            const ctx = findOpenLinkContext();
            if (!ctx) { closeSuggest(); return; }

            const all = this.app.vault.getMarkdownFiles();
            const q = ctx.query.toLowerCase();
            const matches = (q
                ? all.filter(f =>
                    f.basename.toLowerCase().includes(q) ||
                    f.path.toLowerCase().includes(q))
                : all
            ).slice(0, 10);

            if (matches.length === 0) { closeSuggest(); return; }

            suggestItems = matches;
            if (suggestActiveIndex >= matches.length) suggestActiveIndex = 0;

            suggestPopup.empty();
            suggestPopup.style.display = '';
            matches.forEach((file, i) => {
                const item = suggestPopup.createDiv({
                    cls: 'book-smith-scene-notes-link-suggest-item'
                        + (i === suggestActiveIndex ? ' is-active' : '')
                });
                item.createSpan({
                    cls: 'book-smith-scene-notes-link-suggest-name',
                    text: file.basename
                });
                const parentPath = file.parent?.path && file.parent.path !== '/' ? file.parent.path : '';
                if (parentPath) {
                    item.createSpan({
                        cls: 'book-smith-scene-notes-link-suggest-path',
                        text: parentPath
                    });
                }
                // mousedown (not click) so the textarea doesn't blur first.
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    commitLinkSuggest(i);
                });
            });
        };

        const commitLinkSuggest = (idx: number) => {
            const ctx = findOpenLinkContext();
            if (!ctx) { closeSuggest(); return; }
            const file = suggestItems[idx];
            if (!file) { closeSuggest(); return; }

            const value = textarea.value;
            const cursor = textarea.selectionStart;
            const before = value.slice(0, ctx.start);
            const after = value.slice(cursor);
            // Append `]]` only if the user hasn't typed it themselves.
            const postfix = after.startsWith(']]') ? '' : ']]';
            const inserted = file.basename;
            const newValue = before + inserted + postfix + after;
            const newCursor = before.length + inserted.length + postfix.length;
            textarea.value = newValue;
            textarea.setSelectionRange(newCursor, newCursor);
            // Trigger save + mirror refresh.
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            closeSuggest();
        };

        textarea.addEventListener('keydown', (e) => {
            if (suggestPopup.style.display === 'none') return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                suggestActiveIndex = (suggestActiveIndex + 1) % suggestItems.length;
                renderLinkSuggest();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                suggestActiveIndex = (suggestActiveIndex - 1 + suggestItems.length) % suggestItems.length;
                renderLinkSuggest();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                commitLinkSuggest(suggestActiveIndex);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSuggest();
            }
        });
        /** If `pos` falls inside a `[[…]]` token, return the inner text. */
        const findWikilinkAt = (text: string, pos: number): string | null => {
            const re = /\[\[([^\]\r\n]+?)\]\]/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const start = m.index;
                const end = m.index + m[0].length;
                if (pos >= start && pos <= end) return m[1];
            }
            return null;
        };

        // Ctrl/Cmd+click on a [[wikilink]] opens the linked file — same
        // chord Obsidian's edit mode uses. Plain clicks still position the
        // cursor for editing. Click handler runs after the browser's
        // mousedown moves the caret, so `selectionStart` is the click target.
        textarea.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                const cursor = textarea.selectionStart;
                const linkText = findWikilinkAt(textarea.value, cursor);
                if (linkText) {
                    e.preventDefault();
                    // Strip pipe alias (Obsidian's openLinkText takes just
                    // file[#section], not the alias half).
                    const target = linkText.split('|')[0].trim();
                    if (target) {
                        // Open in a new pane on middle-button-equivalent
                        // (Cmd+Shift+click). Otherwise reuse the active leaf.
                        const newLeaf = e.shiftKey;
                        this.app.workspace.openLinkText(target, note.filePath, newLeaf);
                    }
                    return;
                }
            }
            renderLinkSuggest();
        });
        textarea.addEventListener('keyup', (e) => {
            // Caret-moving keys; refresh suggestions for the new context.
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'
                || e.key === 'Home' || e.key === 'End') {
                renderLinkSuggest();
            }
        });
        textarea.addEventListener('blur', () => {
            // Defer so a popup mousedown can fire its handler before we hide.
            window.setTimeout(() => {
                if (document.activeElement !== textarea) closeSuggest();
            }, 100);
        });

        const scheduleSave = () => {
            if (this.sceneNotesAutosaveTimer !== null) {
                window.clearTimeout(this.sceneNotesAutosaveTimer);
            }
            this.sceneNotesAutosaveTimer = window.setTimeout(async () => {
                this.sceneNotesAutosaveTimer = null;
                await this.plugin.sceneNotesManager.updateNote(note.id, { content: textarea.value });
            }, 400);
        };
        textarea.addEventListener('input', scheduleSave);
        textarea.addEventListener('blur', async () => {
            if (this.sceneNotesAutosaveTimer !== null) {
                window.clearTimeout(this.sceneNotesAutosaveTimer);
                this.sceneNotesAutosaveTimer = null;
            }
            await this.plugin.sceneNotesManager.updateNote(note.id, { content: textarea.value });
        });

        // Auto-focus the textarea when the editor opens so Ctrl+J flow is
        // seamless. `preventScroll` stops the browser from scrolling an
        // ancestor (the note list) to bring the textarea into view, which
        // otherwise jumps the list back to the top.
        window.setTimeout(() => textarea.focus({ preventScroll: true }), 0);
    }

    private teardownSceneNotes(): void {
        if (this.sceneNotesUnsubscribe) {
            this.sceneNotesUnsubscribe();
            this.sceneNotesUnsubscribe = null;
        }
        if (this.sceneNotesFileOpenRef) {
            this.app.workspace.offref(this.sceneNotesFileOpenRef);
            this.sceneNotesFileOpenRef = null;
        }
        if (this.sceneNotesAutosaveTimer !== null) {
            window.clearTimeout(this.sceneNotesAutosaveTimer);
            this.sceneNotesAutosaveTimer = null;
        }
        if (this.sceneNotesTitleAutosaveTimer !== null) {
            window.clearTimeout(this.sceneNotesTitleAutosaveTimer);
            this.sceneNotesTitleAutosaveTimer = null;
        }
        this.sceneNotesContainer = null;
        this.sceneNotesViewEl = null;
        this.sceneNotesEditorNoteId = null;
        this.sceneNotesTextareaHeight = null;
    }

    // Override onClose to ensure all views are properly closed
    async onClose() {
        if (this.statsChangeUnsubscribe) {
            this.statsChangeUnsubscribe();
            this.statsChangeUnsubscribe = null;
        }
        this.teardownSceneNotes();
        if (this.focusView) {
            this.focusView.remove();
            this.focusView = null;
        }
    }
}
