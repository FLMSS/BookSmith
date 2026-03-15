import { Plugin, Notice } from 'obsidian';
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
        this.focusManager = new FocusManager(this);
        this.focusHeaderIndicator = new FocusHeaderIndicator(this);
        this.focusHeaderIndicator.initialize();

        // 注册视图
        this.registerView(
            'book-smith-view',
            (leaf) => new BookSmithView(leaf, this)
        );
        this.registerView('book-smith-tool', (leaf) => new ToolView(leaf, this));

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
}