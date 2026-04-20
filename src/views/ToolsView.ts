import { ToolsViewToolbox } from './ToolsViewToolbox';
import { DebugStatsModal } from '../modals/DebugStatsModal';
import { ItemView, Notice, TFile, TFolder, WorkspaceLeaf, setIcon } from 'obsidian';
import { FocusToolView } from '../components/FocusToolView';
import BookSmithPlugin from '../main';
import { i18n } from '../i18n/i18n';
import { BookSelectionModal } from '../modals/BookSelectionModal';
import { Book } from '../types/book';
import { NavigatorFolderModal } from '../modals/NavigatorFolderModal';
import { getLogicalDayISODate } from '../utils/logicalDay';
import { ToolsViewStats } from './ToolsViewStats';

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
        await this.loadNavigatorData();
        this.redrawNavigatorView();
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

        const refreshButton = header.createEl('button', {
            cls: 'book-smith-navigator-refresh-btn',
            attr: { 'aria-label': i18n.t('NAVIGATOR_REFRESH') }
        });
        setIcon(refreshButton, 'refresh-cw');
        refreshButton.addEventListener('click', async () => {
            await this.loadNavigatorData();
            this.redrawNavigatorView();
        });

        const titleRow = view.createDiv({ cls: 'book-smith-navigator-title-row' });
        const titleIcon = titleRow.createSpan({ cls: 'book-smith-navigator-title-icon' });
        setIcon(titleIcon, 'compass');
        titleRow.createSpan({ cls: 'book-smith-navigator-title', text: i18n.t('NAVIGATOR') });

        if (!this.navigatorBook) {
            view.createEl('p', { cls: 'book-smith-navigator-empty', text: i18n.t('NO_ACTIVE_BOOK') });
            return;
        }

        view.createEl('p', {
            cls: 'book-smith-navigator-project-label',
            text: `${i18n.t('SELECT_PROJECT')}: ${this.navigatorBook.basic.title}`
        });

        if (!this.navigatorFolderPath) {
            this.renderNavigatorSetup(view);
            return;
        }

        const folderRow = view.createDiv({ cls: 'book-smith-navigator-folder-row' });
        folderRow.createEl('span', {
            cls: 'book-smith-navigator-folder-path',
            text: this.navigatorFolderPath
        });
        const changeButton = folderRow.createEl('button', {
            cls: 'book-smith-navigator-change-folder-btn',
            text: i18n.t('SELECT_FOLDER')
        });
        changeButton.addEventListener('click', () => this.openNavigatorFolderPicker());

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

            const triggerHoverPreview = (evt: MouseEvent) => {
                const isMod = evt.ctrlKey || evt.metaKey;
                if (!isMod) {
                    this.navigatorHoverTriggeredPath = null;
                    return;
                }
                if (this.navigatorHoverTriggeredPath === file.path) return;

                const sourcePath = this.app.workspace.getActiveFile()?.path || '';
                (this.app.workspace as any).trigger('hover-link', {
                    event: evt,
                    source: 'book-smith-navigator',
                    hoverParent: this,
                    targetEl: row,
                    linktext: file.path,
                    sourcePath
                });
                this.navigatorHoverTriggeredPath = file.path;
            };

            row.addEventListener('mousemove', triggerHoverPreview);
            row.addEventListener('mouseenter', triggerHoverPreview);
            row.addEventListener('mouseleave', () => {
                this.navigatorHoverTriggeredPath = null;
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
        }).open();
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
        this.plugin.settings.stats = {
            displayMode: this.statsDisplayMode,
            writingDisplayMode: this.statsWritingDisplayMode,
            leftPaneWritingDisplayMode: this.plugin.settings.stats?.leftPaneWritingDisplayMode || 'daily-output',
            wordsPerPage: this.wordsPerPage
        };
        await this.plugin.saveSettings();
    }


    public renderCalendarBody(calendar: HTMLElement) {
        if (this.statsPeriodMode === 'day') {
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

    private renderCalendarDays(grid: HTMLElement) {
        const year = this.statsViewMonth.getFullYear();
        const month = this.statsViewMonth.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

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

            if (this.statsDailyComments[iso]?.trim()) {
                dayEl.addClass('has-comment');
            }

            dayEl.addEventListener('click', () => {
                this.selectedStatsDate = iso;
                this.redrawStatisticsView();
            });
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
    private sceneNotesEditorNoteId: string | null = null;
    private sceneNotesUnsubscribe: (() => void) | null = null;
    private sceneNotesAutosaveTimer: number | null = null;

    public async enterSceneNotesMode(openNoteId?: string): Promise<void> {
        if (!this.normalView) return;
        this.isNavigatorMode = false;
        this.normalView.empty();
        this.renderSceneNotesView(this.normalView, openNoteId);

        // Subscribe to updates while this view is mounted.
        if (!this.sceneNotesUnsubscribe) {
            this.sceneNotesUnsubscribe = this.plugin.sceneNotesManager.onNotesChange(() => {
                if (!this.sceneNotesContainer) return;
                this.renderSceneNotesList(this.sceneNotesContainer);
            });
        }
    }

    /** Public entry point for focusing a specific note (e.g. from a gutter click). */
    public openSceneNoteEditor(noteId: string): void {
        void this.enterSceneNotesMode(noteId);
    }

    private renderSceneNotesView(container: HTMLElement, openNoteId?: string): void {
        const view = container.createDiv({ cls: 'book-smith-scene-notes-view' });

        // Header with "back" — matches navigator header styling to stay consistent.
        const header = view.createDiv({ cls: 'book-smith-navigator-header' });
        const backButton = header.createEl('button', { cls: 'book-smith-navigator-back-btn' });
        setIcon(backButton, 'arrow-left');
        backButton.appendChild(createSpan({ text: ' Back to toolbox' }));
        backButton.addEventListener('click', () => {
            if (!this.normalView) return;
            this.teardownSceneNotes();
            this.normalView.empty();
            this.createNormalView(this.normalView);
        });

        const titleRow = view.createDiv({ cls: 'book-smith-navigator-title-row' });
        const titleIcon = titleRow.createSpan({ cls: 'book-smith-navigator-title-icon' });
        setIcon(titleIcon, 'flag');
        titleRow.createSpan({ cls: 'book-smith-navigator-title', text: 'Scene notes' });

        // List section.
        const listWrapper = view.createDiv({ cls: 'book-smith-scene-notes-list-wrapper' });
        this.sceneNotesContainer = listWrapper;
        this.renderSceneNotesList(listWrapper);

        // Editor section — only populated when a note is selected.
        view.createDiv({ cls: 'book-smith-scene-notes-editor', attr: { 'data-empty': 'true' } });

        if (openNoteId) {
            this.selectSceneNote(openNoteId);
        }
    }

    private renderSceneNotesList(container: HTMLElement): void {
        container.empty();

        const book = this.plugin.sceneNotesManager.getCurrentBook();
        if (!book) {
            container.createEl('p', {
                cls: 'book-smith-navigator-empty',
                text: 'Open a book to see its scene notes.'
            });
            return;
        }

        const allNotes = this.plugin.sceneNotesManager.getAllNotes();
        if (allNotes.length === 0) {
            container.createEl('p', {
                cls: 'book-smith-navigator-empty',
                text: 'No scene notes yet. Press Ctrl+J in a paragraph to add one.'
            });
            return;
        }

        // Group by chapter (file path relative to book folder).
        const bookRoot = `${this.plugin.settings.defaultBookPath}/${book.basic.title}`;
        const groups = new Map<string, typeof allNotes>();
        for (const note of allNotes) {
            const rel = note.filePath.startsWith(bookRoot + '/')
                ? note.filePath.slice(bookRoot.length + 1)
                : note.filePath;
            const arr = groups.get(rel) || [];
            arr.push(note);
            groups.set(rel, arr);
        }
        const sortedGroupKeys = Array.from(groups.keys()).sort();

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
                const preview = (note.content || '').trim().split('\n')[0] || '(empty note)';
                body.createDiv({
                    cls: 'book-smith-scene-notes-row-preview',
                    text: preview.length > 80 ? preview.slice(0, 80) + '…' : preview
                });
                body.createDiv({
                    cls: 'book-smith-scene-notes-row-meta',
                    text: `Line ${note.fromLine + 1}`
                });

                row.addEventListener('click', () => {
                    this.selectSceneNote(note.id);
                    void this.plugin.focusEditorOnNote(note);
                });
            });
        });
    }

    private selectSceneNote(noteId: string): void {
        this.sceneNotesEditorNoteId = noteId;
        if (this.sceneNotesContainer) this.renderSceneNotesList(this.sceneNotesContainer);

        const editor = this.normalView?.querySelector('.book-smith-scene-notes-editor') as HTMLElement | null;
        if (!editor) return;
        editor.empty();
        editor.removeAttribute('data-empty');

        const note = this.plugin.sceneNotesManager.getNoteById(noteId);
        if (!note) {
            editor.setAttribute('data-empty', 'true');
            return;
        }

        const headerRow = editor.createDiv({ cls: 'book-smith-scene-notes-editor-header' });
        headerRow.createEl('span', {
            cls: 'book-smith-scene-notes-editor-title',
            text: `Line ${note.fromLine + 1}${note.toLine !== note.fromLine ? `–${note.toLine + 1}` : ''}`
        });

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

        const textarea = editor.createEl('textarea', {
            cls: 'book-smith-scene-notes-editor-textarea',
            attr: { placeholder: 'Write your note…' }
        }) as HTMLTextAreaElement;
        textarea.value = note.content || '';

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

        // Auto-focus the textarea when the editor opens so Ctrl+J flow is seamless.
        window.setTimeout(() => textarea.focus(), 0);
    }

    private teardownSceneNotes(): void {
        if (this.sceneNotesUnsubscribe) {
            this.sceneNotesUnsubscribe();
            this.sceneNotesUnsubscribe = null;
        }
        if (this.sceneNotesAutosaveTimer !== null) {
            window.clearTimeout(this.sceneNotesAutosaveTimer);
            this.sceneNotesAutosaveTimer = null;
        }
        this.sceneNotesContainer = null;
        this.sceneNotesEditorNoteId = null;
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
