import { Plugin, Notice, Editor, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { BookSmithView } from './views/BookSmithView';
import { ToolView } from './views/ToolsView';
import { BookSmithSettingTab } from './settings/SettingTab';
import { BookSmithSettings, DEFAULT_SETTINGS } from './settings/settings';
import { screenplayTemplate } from './templates/screenplay';
import { activateView } from './utils/viewUtils';
import { BookManager } from './services/BookManager';
import { TemplateManager } from './services/TemplateManager';
import { BookStatsManager } from './services/BookStatsManager';
import { FocusManager } from './services/FocusManager';
import { i18n } from './i18n/i18n';
import { ImgTemplateManager } from './services/ImgTemplateManager';
import { ThemeManager } from './services/ThemeManager';
import { SharedDataManager } from './services/SharedDataManager';
import { FocusHeaderIndicator } from './components/FocusHeaderIndicator';
import { DEFAULT_DAILY_ROLLOVER_MINUTES, normalizeDailyRolloverMinutes } from './utils/logicalDay';
import { EditorView } from '@codemirror/view';
import { SceneNotesManager } from './services/SceneNotesManager';
import { buildSceneNotesGutter, requestGutterRepaint } from './services/SceneNotesGutter';
import { SceneNote } from './types/sceneNote';
import { fountainCommentExtension } from './extensions/FountainComments';

export default class BookSmithPlugin extends Plugin {
    settings: BookSmithSettings;
    bookManager: BookManager;
    templateManager: TemplateManager;
    imgTemplateManager: ImgTemplateManager;
    themeManager: ThemeManager;
    statsManager: BookStatsManager;
    sharedDataManager: SharedDataManager;
    focusManager: FocusManager;
    focusHeaderIndicator: FocusHeaderIndicator;
    sceneNotesManager: SceneNotesManager;

    async onload() {
        await this.loadSettings();        
        this.sharedDataManager = new SharedDataManager(
            this.app,
            this.settings.defaultBookPath,
            ['', this.app.vault.configDir, this.settings.defaultBookPath],
            '_booksmith-data.json'
        );
        await this.sharedDataManager.load();

        const settingsDailyComments = this.getSettingsDailyCommentsBackup();
        const settingsPeriodComments = this.getSettingsPeriodCommentsBackup();
        if (Object.keys(settingsDailyComments).length > 0 || Object.keys(settingsPeriodComments).length > 0) {
            if (Object.keys(settingsDailyComments).length > 0) {
                this.sharedDataManager.mergeComments(settingsDailyComments);
            }
            if (Object.keys(settingsPeriodComments).length > 0) {
                this.sharedDataManager.mergePeriodComments(settingsPeriodComments);
            }
            await this.sharedDataManager.save();
        }

        const legacyData = (await this.loadData()) as any;
        const legacyComments = legacyData?.sharedDailyComments as Record<string, string> | undefined;
        const legacyPeriodComments = legacyData?.sharedPeriodComments as Record<string, string> | undefined;
        if ((legacyComments && Object.keys(legacyComments).length > 0) || (legacyPeriodComments && Object.keys(legacyPeriodComments).length > 0)) {
            if (legacyComments && Object.keys(legacyComments).length > 0) {
                this.sharedDataManager.mergeComments(legacyComments);
            }
            if (legacyPeriodComments && Object.keys(legacyPeriodComments).length > 0) {
                this.sharedDataManager.mergePeriodComments(legacyPeriodComments);
            }
            await this.sharedDataManager.save();
        }

        await this.persistSharedCommentBackups();

        // 初始化所有管理器
        this.bookManager = new BookManager(this.app, this.settings);
        const legacyProjectFolderMap = this.sharedDataManager.getProjectFolderMap();
        if (Object.keys(legacyProjectFolderMap).length > 0) {
            await this.bookManager.migrateProjectFoldersFromMap(legacyProjectFolderMap);
        }
        this.statsManager = new BookStatsManager(this.app, this, this.bookManager);
        this.sceneNotesManager = new SceneNotesManager(this.app, this);
        this.focusManager = new FocusManager(this);
        this.focusHeaderIndicator = new FocusHeaderIndicator(this);
        this.focusHeaderIndicator.initialize();

        // Fountain /* ... */ block-comment highlighting.
        this.registerEditorExtension(fountainCommentExtension);

        // Register the Scene Notes gutter extension (per-editor).
        // getBookRoot is passed so the gutter only activates for BookSmith files.
        this.registerEditorExtension(
            buildSceneNotesGutter(
                this.sceneNotesManager,
                () => this.settings.defaultBookPath,
                (note) => { this.openSceneNoteInPanel(note.id); }
            )
        );

        // Repaint gutters when notes change.
        this.register(this.sceneNotesManager.onNotesChange(() => {
            requestGutterRepaint(this.app);
        }));

        // When any book file opens, eagerly load its book's notes so the gutter
        // and Ctrl+J work instantly without requiring the book to be "active".
        this.registerEvent(this.app.workspace.on('file-open', async (file) => {
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            await this.sceneNotesManager.ensureLoadedForFile(file.path);
            requestGutterRepaint(this.app);
        }));
        // Also resolve for any file already open at plugin-load time.
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile?.extension === 'md') {
            void this.sceneNotesManager.ensureLoadedForFile(activeFile.path)
                .then(() => requestGutterRepaint(this.app));
        }

        // Debounced auto-prune: remove notes whose anchor paragraph was deleted.
        const pruneTimers = new Map<string, number>();
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            const bookRoot = this.settings.defaultBookPath;
            if (!bookRoot || !file.path.startsWith(bookRoot + '/')) return;
            const prev = pruneTimers.get(file.path);
            if (prev) window.clearTimeout(prev);
            const timer = window.setTimeout(async () => {
                pruneTimers.delete(file.path);
                try {
                    // Ensure the file's book is known before pruning.
                    await this.sceneNotesManager.ensureLoadedForFile(file.path);
                    const content = await this.app.vault.cachedRead(file);
                    const lastLine = Math.max(0, content.split('\n').length - 1);
                    await this.sceneNotesManager.pruneNotesPastEnd(file.path, lastLine);
                } catch (err) {
                    console.warn('Scene notes prune failed:', err);
                }
            }, 800);
            pruneTimers.set(file.path, timer);
        }));

        // 注册视图
        this.registerView(
            'book-smith-view',
            (leaf) => new BookSmithView(leaf, this)
        );
        this.registerView('book-smith-tool', (leaf) => new ToolView(leaf, this));

        // Register our custom link sources with the core Page Preview plugin so
        // Ctrl/Cmd+hover over links in our panels opens the hover editor.
        // defaultMod: true = require the modifier key (matches the left panel).
        (this as any).registerHoverLinkSource?.('book-smith-navigator', {
            display: 'Book Smith Navigator',
            defaultMod: true
        });
        (this as any).registerHoverLinkSource?.('book-smith-chapter-tree', {
            display: 'Book Smith Chapters',
            defaultMod: true
        });

        // 添加设置选项卡
        this.addSettingTab(new BookSmithSettingTab(this.app, this));

        // 添加命令
        this.addCommand({
            id: 'open-book-view',
            name: i18n.t('OPEN_BOOK_PANEL'),
            callback: () => {
                activateView(this.app, 'book-smith-view', 'left');
            }
        });
        this.addCommand({
            id: 'open-tool-view',
            name: i18n.t('OPEN_TOOL_PANEL'),
            callback: () => {
                activateView(this.app, 'book-smith-tool', 'right');
            }
        });

        // 添加一个命令用于同时打开两个视图
        this.addCommand({
            id: 'open-all-views',
            name: i18n.t('OPEN_ALL_PANELS'),
            callback: () => {
                activateView(this.app, 'book-smith-view', 'left');
                activateView(this.app, 'book-smith-tool', 'right');
            }
        });

        // Old deletion commands (explicit user-triggered only)
        this.addCommand({
            id: 'delete-old-content-backward',
            name: 'Delete as old content (backward)',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.executeOldDeletion(editor, 'backward');
            },
            hotkeys: [{ modifiers: ['Alt'], key: 'Backspace' }]
        });
        this.addCommand({
            id: 'delete-old-content-forward',
            name: 'Delete as old content (forward)',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.executeOldDeletion(editor, 'forward');
            },
            hotkeys: [{ modifiers: ['Alt'], key: 'Delete' }]
        });

        // Scene Notes — add a note on the paragraph under the cursor (Ctrl+J).
        this.addCommand({
            id: 'add-scene-note',
            name: 'Add scene note to current paragraph',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                void this.addSceneNoteAtCursor(editor, view);
            },
            hotkeys: [{ modifiers: ['Mod'], key: 'j' }]
        });

        // 添加一个功能按钮用于打开所有面板
        this.addRibbonIcon('book-open', i18n.t('OPEN_BOOK_PANEL'), () => {
            activateView(this.app, 'book-smith-view', 'left');
            activateView(this.app, 'book-smith-tool', 'right');
        });
    }

    onunload() {
        // 卸载插件时的清理工作
        this.focusHeaderIndicator?.destroy();
    }

    private executeOldDeletion(editor: Editor, direction: 'backward' | 'forward'): void {
        // Determine the deletion range first, then count words and record BEFORE editing.
        let from: { line: number; ch: number };
        let to: { line: number; ch: number };

        if (editor.somethingSelected()) {
            from = editor.getCursor('from');
            to = editor.getCursor('to');
        } else {
            const cursor = editor.getCursor();
            const line = editor.getLine(cursor.line);

            if (direction === 'backward') {
                to = cursor;
                if (cursor.ch === 0) {
                    if (cursor.line === 0) return;
                    const prevLine = editor.getLine(cursor.line - 1);
                    from = { line: cursor.line - 1, ch: prevLine.length };
                } else {
                    const textBefore = line.slice(0, cursor.ch);
                    const match = textBefore.match(/\S+\s*$/);
                    const deleteFrom = match ? cursor.ch - match[0].length : cursor.ch - 1;
                    from = { line: cursor.line, ch: deleteFrom };
                }
            } else {
                from = cursor;
                if (cursor.ch >= line.length) {
                    if (cursor.line >= editor.lineCount() - 1) return;
                    to = { line: cursor.line + 1, ch: 0 };
                } else {
                    const textAfter = line.slice(cursor.ch);
                    const match = textAfter.match(/^\s*\S+/);
                    const deleteLen = match ? match[0].length : 1;
                    to = { line: cursor.line, ch: cursor.ch + deleteLen };
                }
            }
        }

        // Count words in the text about to be deleted and record old deletion
        // BEFORE the editor operation — no timing dependency on handleEditorUpdate.
        const textToDelete = editor.getRange(from, to);
        const wordCount = this.statsManager.countWords(textToDelete);
        const { oldWords, normalWords } = this.statsManager.recordExplicitOldDeletion(wordCount);

        // Now perform the actual deletion
        editor.replaceRange('', from, to);

        if (oldWords > 0 && normalWords === 0) {
            new Notice(`Removed ${oldWords} word${oldWords !== 1 ? 's' : ''} as old material`, 2000);
        } else if (oldWords > 0 && normalWords > 0) {
            new Notice(`Removed ${oldWords} old + ${normalWords} new word${normalWords !== 1 ? 's' : ''} (no old material budget left for ${normalWords})`, 3000);
        } else if (normalWords > 0) {
            new Notice(`No old material left to remove — ${normalWords} word${normalWords !== 1 ? 's' : ''} deleted as normal`, 3000);
        }
    }

    async loadSettings() {
        const savedSettings = await this.loadData();
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            templates: {
                ...DEFAULT_SETTINGS.templates,
                ...(savedSettings?.templates || {}),
                custom: {
                    ...DEFAULT_SETTINGS.templates.custom,
                    ...(savedSettings?.templates?.custom || {})
                }
            },
            tools: {
                ...DEFAULT_SETTINGS.tools,
                ...(savedSettings?.tools || {})
            },
            focus: {
                ...DEFAULT_SETTINGS.focus,
                ...(savedSettings?.focus || {}),
                dailyRolloverMinutes: normalizeDailyRolloverMinutes(
                    savedSettings?.focus?.dailyRolloverMinutes ?? DEFAULT_DAILY_ROLLOVER_MINUTES
                ),
                stats: {
                    ...DEFAULT_SETTINGS.focus.stats,
                    ...(savedSettings?.focus?.stats || {}),
                    dailyStats: {
                        ...DEFAULT_SETTINGS.focus.stats.dailyStats,
                        ...(savedSettings?.focus?.stats?.dailyStats || {})
                    }
                }
            },
            stats: {
                ...DEFAULT_SETTINGS.stats,
                ...(savedSettings?.stats || {})
            },
            bookView: {
                ...DEFAULT_SETTINGS.bookView,
                ...(savedSettings?.bookView || {}),
                leftPanelInfo: {
                    ...DEFAULT_SETTINGS.bookView.leftPanelInfo,
                    ...(savedSettings?.bookView?.leftPanelInfo || {}),
                    writingSchedule: {
                        ...DEFAULT_SETTINGS.bookView.leftPanelInfo.writingSchedule,
                        ...(savedSettings?.bookView?.leftPanelInfo?.writingSchedule || {}),
                        scheduleHistory: (
                            savedSettings?.bookView?.leftPanelInfo?.writingSchedule?.scheduleHistory &&
                            savedSettings.bookView.leftPanelInfo.writingSchedule.scheduleHistory.length > 0
                        )
                            ? savedSettings.bookView.leftPanelInfo.writingSchedule.scheduleHistory
                            : DEFAULT_SETTINGS.bookView.leftPanelInfo.writingSchedule.scheduleHistory
                    }
                }
            }
        };

        // Migration: rename legacy default author value.
        if ((this.settings.defaultAuthor || '').trim().toLowerCase() === 'yeban') {
            this.settings.defaultAuthor = 'FelMNZ';
        }

        // Ensure templates.custom includes all default templates and remove old 'default' key
        if (savedSettings?.templates?.custom) {
            const cleaned = { ...DEFAULT_SETTINGS.templates.custom, ...savedSettings.templates.custom };
            delete cleaned['default']; // Remove old default template if it exists
            this.settings.templates.custom = cleaned;
        }

        // If the user has not customized the built-in screenplay template, ensure it uses the latest structure.
        const screenplay = this.settings.templates.custom?.['screenplay'];
        if (screenplay?.isBuiltin) {
            const firstNodeId = screenplay.structure?.tree?.[0]?.id;
            const hasTitlePage = screenplay.structure?.tree?.some((node) => node.id === 'title-page');

            this.settings.templates.custom['screenplay'].name = DEFAULT_SETTINGS.templates.custom['screenplay'].name;
            this.settings.templates.custom['screenplay'].description = DEFAULT_SETTINGS.templates.custom['screenplay'].description;

            if (firstNodeId === 'preface' || (firstNodeId === 'epigraph' && !hasTitlePage)) {
                // Old built-in structure detected (legacy or epigraph-first), update to the latest screenplay structure
                this.settings.templates.custom['screenplay'].structure = screenplayTemplate;
            }
        }

        const prose = this.settings.templates.custom?.['prose'];
        if (prose?.isBuiltin) {
            this.settings.templates.custom['prose'].name = DEFAULT_SETTINGS.templates.custom['prose'].name;
            this.settings.templates.custom['prose'].description = DEFAULT_SETTINGS.templates.custom['prose'].description;
        }

        this.bookManager = new BookManager(this.app, this.settings);
        this.templateManager = new TemplateManager(this.settings);
        this.themeManager = new ThemeManager(this.app, this.settings);
        this.imgTemplateManager = new ImgTemplateManager(this.app, this.themeManager);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async persistSharedCommentBackups() {
        (this.settings as any).sharedDailyComments = this.sharedDataManager.getComments();
        (this.settings as any).sharedPeriodComments = this.sharedDataManager.getPeriodComments();
        await this.saveSettings();
    }

    private getSettingsDailyCommentsBackup(): Record<string, string> {
        const comments = (this.settings as any)?.sharedDailyComments;
        if (!comments || typeof comments !== 'object') return {};
        return comments as Record<string, string>;
    }

    private getSettingsPeriodCommentsBackup(): Record<string, string> {
        const comments = (this.settings as any)?.sharedPeriodComments;
        if (!comments || typeof comments !== 'object') return {};
        return comments as Record<string, string>;
    }

    // --- Scene Notes integration ---

    private async addSceneNoteAtCursor(editor: Editor, view: MarkdownView): Promise<void> {
        const file = view.file;
        if (!file) {
            new Notice('No file is open');
            return;
        }

        // Auto-detect which book this file belongs to by walking up the path.
        const owner = await this.sceneNotesManager.ensureLoadedForFile(file.path);
        if (!owner) {
            new Notice('Scene notes only work inside a Book Smith book folder');
            return;
        }

        const cursor = editor.getCursor();
        const docText = editor.getValue();
        const { fromLine, toLine } = SceneNotesManager.detectParagraphRange(docText, cursor.line);

        // One note per paragraph — reject if an existing note overlaps.
        const existing = this.sceneNotesManager.paragraphHasNote(file.path, fromLine, toLine);
        if (existing) {
            new Notice('This paragraph already has a scene note');
            this.openSceneNoteInPanel(existing.id);
            return;
        }

        const created = await this.sceneNotesManager.createNote({
            filePath: file.path,
            fromLine,
            toLine,
            content: ''
        });
        if (!created) {
            new Notice('Failed to create scene note');
            return;
        }
        new Notice(`Scene note added to "${created.owner.title}"`);
        this.openSceneNoteInPanel(created.note.id);
    }

    /**
     * Switch the ToolsView right pane to the Scene Notes editor for the given note id.
     * Creates the tool panel if it isn't open.
     */
    public openSceneNoteInPanel(noteId: string): void {
        const showNote = (tool: ToolView) => {
            tool.openSceneNoteEditor?.(noteId);
        };
        const leaves = this.app.workspace.getLeavesOfType('book-smith-tool');
        if (leaves.length === 0) {
            void (async () => {
                await activateView(this.app, 'book-smith-tool', 'right');
                // Defer a tick so the view finishes its onOpen render pass.
                window.setTimeout(() => {
                    const afterLeaves = this.app.workspace.getLeavesOfType('book-smith-tool');
                    const leaf = afterLeaves[0];
                    if (!leaf) return;
                    // Pull the panel forward even if the sidebar is collapsed or
                    // another tab is active.
                    this.app.workspace.revealLeaf(leaf);
                    if (leaf.view instanceof ToolView) showNote(leaf.view);
                }, 50);
            })();
            return;
        }
        const leaf = leaves[0];
        // Surface the panel: switches sidebar tabs and expands if collapsed.
        this.app.workspace.revealLeaf(leaf);
        if (leaf.view instanceof ToolView) showNote(leaf.view);
    }

    /**
     * Focus an editor on a note's paragraph: open the file if needed, scroll to
     * the from-line, center it, and briefly highlight.
     */
    public async focusEditorOnNote(note: SceneNote): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(note.filePath);
        if (!(file instanceof TFile)) {
            new Notice('File for this scene note is missing');
            return;
        }

        // Target a markdown leaf in the main area — NOT `getLeaf(false)`,
        // which returns the currently active leaf (often the Scene Notes
        // tool panel itself when the user clicks there, so the .md would
        // open inside the sidebar instead of the main editor).
        // Prefer a leaf already showing this file; otherwise any markdown
        // leaf in the main area; otherwise open a new tab.
        let targetLeaf: WorkspaceLeaf | null = null;
        this.app.workspace.iterateRootLeaves((leaf: WorkspaceLeaf) => {
            if (targetLeaf) return;
            if (leaf.view instanceof MarkdownView && leaf.view.file?.path === note.filePath) {
                targetLeaf = leaf;
            }
        });
        if (!targetLeaf) {
            this.app.workspace.iterateRootLeaves((leaf: WorkspaceLeaf) => {
                if (targetLeaf) return;
                if (leaf.view instanceof MarkdownView) {
                    targetLeaf = leaf;
                }
            });
        }
        if (!targetLeaf) {
            targetLeaf = this.app.workspace.getLeaf('tab');
        }

        await targetLeaf.openFile(file, { active: true });
        this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

        const view = targetLeaf.view as MarkdownView;
        const cm = (view as any)?.editor?.cm as EditorView | undefined;
        if (!cm) return;

        const startLineNum = Math.min(Math.max(note.fromLine + 1, 1), cm.state.doc.lines);
        const endLineNum = Math.min(Math.max(note.toLine + 1, 1), cm.state.doc.lines);
        const startBlock = cm.state.doc.line(startLineNum);
        const endBlock = cm.state.doc.line(endLineNum);

        cm.dispatch({
            selection: { anchor: startBlock.from },
            effects: EditorView.scrollIntoView(startBlock.from, { y: 'center' })
        });

        // Flash a highlight on the paragraph briefly.
        try {
            const fromCoords = cm.coordsAtPos(startBlock.from);
            const toCoords = cm.coordsAtPos(endBlock.to);
            if (fromCoords) {
                const flash = document.createElement('div');
                flash.addClass('book-smith-scene-note-flash');
                const scroller = cm.scrollDOM;
                const scrollerRect = scroller.getBoundingClientRect();
                const top = fromCoords.top - scrollerRect.top + scroller.scrollTop;
                const height = toCoords
                    ? Math.max(24, toCoords.bottom - fromCoords.top + 2)
                    : 24;
                flash.style.top = `${top}px`;
                flash.style.height = `${height}px`;
                scroller.appendChild(flash);
                window.setTimeout(() => flash.remove(), 1500);
            }
        } catch (err) {
            // Best-effort highlight — never fail the navigation.
            console.warn('Scene note highlight failed:', err);
        }
    }

    /**
     * Subtle "where is this?" cue: when a scene note is clicked in the panel,
     * briefly glow its anchored paragraph purple in any already-open editor
     * where the range is currently visible. Does NOT open the file, scroll,
     * or change focus — if the paragraph isn't on screen, nothing happens.
     * Gated by the `sceneNoteGlowOnClick` setting.
     */
    public glowSceneNoteInEditor(note: SceneNote): void {
        if (this.settings.sceneNoteGlowOnClick === false) return;

        this.app.workspace.iterateRootLeaves((leaf: WorkspaceLeaf) => {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) return;
            if (view.file?.path !== note.filePath) return;

            const cm = (view as any)?.editor?.cm as EditorView | undefined;
            if (!cm) return;

            try {
                const startLineNum = Math.min(Math.max(note.fromLine + 1, 1), cm.state.doc.lines);
                const endLineNum = Math.min(Math.max(note.toLine + 1, 1), cm.state.doc.lines);
                const startBlock = cm.state.doc.line(startLineNum);
                const endBlock = cm.state.doc.line(endLineNum);

                const fromCoords = cm.coordsAtPos(startBlock.from);
                const toCoords = cm.coordsAtPos(endBlock.to);
                // coordsAtPos returns null when the position isn't in the
                // rendered viewport — our "is it visible?" test. Skip if the
                // paragraph isn't on screen (we never scroll to it).
                if (!fromCoords) return;

                const scroller = cm.scrollDOM;
                const scrollerRect = scroller.getBoundingClientRect();
                // Bail if the line sits outside the visible band of the scroller.
                if (fromCoords.bottom < scrollerRect.top || fromCoords.top > scrollerRect.bottom) return;

                const glow = document.createElement('div');
                glow.addClass('book-smith-scene-note-glow');
                // Optionally tint the glow to the note's flag colour (kept
                // light via the low-opacity color-mix in CSS). Falls back to
                // the default purple when off or when the note has no colour.
                if (this.settings.sceneNoteGlowMatchColor && note.color) {
                    glow.style.setProperty('--glow-color', note.color);
                }

                // Two shapes, per the `sceneNoteGlowFullRow` setting:
                //  - full row (default): union each `.cm-line` element box, so
                //    the glow spans the whole row/column width.
                //  - tight to text: a DOM Range over each line's contents yields
                //    one client rect per wrapped row, each tight to the glyphs,
                //    so the right edge sits at the real end of the widest line.
                // Both handle wrapped lines (one doc line, several rows).
                const fullRow = this.settings.sceneNoteGlowFullRow !== false;
                let uTop = Infinity, uBottom = -Infinity, uLeft = Infinity, uRight = -Infinity;
                const absorb = (r: DOMRect | DOMRectReadOnly) => {
                    if (r.width === 0 && r.height === 0) return;
                    uTop = Math.min(uTop, r.top);
                    uBottom = Math.max(uBottom, r.bottom);
                    uLeft = Math.min(uLeft, r.left);
                    uRight = Math.max(uRight, r.right);
                };
                for (let ln = startLineNum; ln <= endLineNum; ln++) {
                    const pos = cm.state.doc.line(ln).from;
                    const domNode = cm.domAtPos(pos).node;
                    const host = (domNode.nodeType === Node.TEXT_NODE ? domNode.parentElement : domNode as HTMLElement);
                    const lineEl = host?.closest('.cm-line') as HTMLElement | null;
                    if (!lineEl) continue;

                    if (fullRow) {
                        absorb(lineEl.getBoundingClientRect());
                        continue;
                    }
                    const range = lineEl.ownerDocument.createRange();
                    range.selectNodeContents(lineEl);
                    const rects = range.getClientRects();
                    if (rects.length === 0) {
                        absorb(lineEl.getBoundingClientRect());
                    } else {
                        for (let i = 0; i < rects.length; i++) absorb(rects[i]);
                    }
                }

                if (Number.isFinite(uTop) && uRight > uLeft) {
                    const padX = 6;
                    const padY = 1;
                    glow.style.top = `${uTop - scrollerRect.top + scroller.scrollTop - padY}px`;
                    glow.style.height = `${(uBottom - uTop) + padY * 2}px`;
                    glow.style.left = `${uLeft - scrollerRect.left + scroller.scrollLeft - padX}px`;
                    glow.style.width = `${(uRight - uLeft) + padX * 2}px`;
                    glow.style.right = 'auto';
                } else {
                    // Fallback to coord-based vertical extent; CSS keeps it
                    // full-width (left:0/right:0).
                    const top = fromCoords.top - scrollerRect.top + scroller.scrollTop;
                    glow.style.top = `${top}px`;
                    glow.style.height = `${toCoords ? Math.max(22, toCoords.bottom - fromCoords.top + 2) : 22}px`;
                }

                scroller.appendChild(glow);
                window.setTimeout(() => glow.remove(), 1800);
            } catch (err) {
                // Best-effort — a glow never matters enough to throw.
                console.warn('Scene note glow failed:', err);
            }
        });
    }
}