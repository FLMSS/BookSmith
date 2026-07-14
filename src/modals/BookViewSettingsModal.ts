import { App, Modal, Notice, Setting, setIcon } from 'obsidian';
import BookSmithPlugin from '../main';
import { i18n } from '../i18n/i18n';
import { Book, BookWritingPeriod } from '../types/book';
import { NamePromptModal } from './NamePromptModal';
import { getDailyRolloverOptions, getLogicalDayISODate, normalizeDailyRolloverMinutes } from '../utils/logicalDay';
import { LeftPaneStatKey, LEFT_PANE_STAT_KEYS, LEFT_PANE_STAT_LABEL, LEFT_PANE_STAT_VISIBILITY_FIELD, sanitizeLeftPaneStatOrder } from '../settings/settings';

export class BookViewSettingsModal extends Modal {
    private statsSectionExpanded = false;
    private sceneNotesSectionExpanded = false;
    private projectManagementSectionExpanded = false;
    private coverSectionExpanded = false;
    private goalSectionExpanded = false;
    private goalInputMode: 'words' | 'pages' = 'words';
    private dailyGoalInputMode: 'words' | 'pages' = 'words';
    private modeDefaultsInitialized = false;
    private richTooltipEl: HTMLElement | null = null;
    private progressModeMenuEl: HTMLElement | null = null;
    private progressModeOutsideHandler: ((event: MouseEvent) => void) | null = null;
    private collapsedPeriodIds: Set<string> = new Set();

    constructor(
        app: App,
        private plugin: BookSmithPlugin,
        private currentBook: Book | null,
        private onSettingsChanged: () => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        if (!this.modeDefaultsInitialized) {
            const defaultMode: 'words' | 'pages' = this.getInfoSettings().metricMode === 'pages' ? 'pages' : 'words';
            this.goalInputMode = defaultMode;
            this.dailyGoalInputMode = defaultMode;
            this.modeDefaultsInitialized = true;
        }
        // Clean up any lingering tooltip before re-rendering
        this.richTooltipEl?.remove();
        this.richTooltipEl = null;
        contentEl.empty();
        contentEl.addClass('book-smith-book-view-settings-modal');

        contentEl.createEl('h2', { text: 'Project Settings' });
        contentEl.createEl('p', {
            cls: 'book-smith-book-view-settings-desc',
            text: 'Expand a section to configure view options for this project.'
        });

        this.renderSectionList(contentEl);
    }

    onClose() {
        this.closeProgressModeMenu();
        this.richTooltipEl?.remove();
        this.richTooltipEl = null;
        this.modeDefaultsInitialized = false;
        this.contentEl.empty();
    }

    private renderSectionList(container: HTMLElement): void {
        const sectionList = container.createDiv({ cls: 'book-smith-book-view-settings-list' });

        this.renderStatsSection(sectionList);
        this.renderSceneNotesSection(sectionList);
        this.renderProjectManagementSection(sectionList);
        this.renderCoverSection(sectionList);
        this.renderGoalSection(sectionList);
    }

    private renderStatsSection(sectionList: HTMLElement): void {
        const statsSection = sectionList.createDiv({ cls: 'book-smith-book-view-settings-section' });
        const sectionHeader = statsSection.createEl('button', {
            cls: 'book-smith-book-view-settings-section-header',
            attr: { type: 'button' }
        });

        const left = sectionHeader.createDiv({ cls: 'book-smith-book-view-settings-section-left' });
        const chevron = left.createSpan({ cls: 'book-smith-book-view-settings-chevron' });
        setIcon(chevron, this.statsSectionExpanded ? 'chevron-down' : 'chevron-right');
        left.createEl('span', { text: 'Left Pane Stats' });

        const infoSettings = this.getInfoSettings();
        const enabled = infoSettings.enabled;
        sectionHeader.createEl('span', {
            cls: `book-smith-book-view-settings-badge${enabled ? ' is-on' : ' is-off'}`,
            text: enabled ? 'Enabled' : 'Disabled'
        });

        sectionHeader.addEventListener('click', () => {
            this.statsSectionExpanded = !this.statsSectionExpanded;
            this.onOpen();
        });

        if (!this.statsSectionExpanded) {
            return;
        }

        const detail = statsSection.createDiv({ cls: 'book-smith-book-view-settings-detail' });

        new Setting(detail)
            .setName('Show left pane stats')
            .setDesc('Master toggle for the bottom-left statistics block.')
            .addToggle((toggle) => {
                toggle
                    .setValue(enabled)
                    .onChange(async (value) => {
                        this.plugin.settings.bookView.leftPanelInfo.enabled = value;
                        await this.plugin.saveSettings();
                        this.onSettingsChanged();
                        this.onOpen();
                    });
            });

        if (!enabled) {
            return;
        }

        // Per-row visibility + reorder (▲▼). The order drives the bottom-left
        // stat block; toggles hide individual rows.
        const order = sanitizeLeftPaneStatOrder(this.plugin.settings.bookView?.leftPanelInfo?.order);
        order.forEach((key, idx) => {
            const field = LEFT_PANE_STAT_VISIBILITY_FIELD[key];
            new Setting(detail)
                .setName(LEFT_PANE_STAT_LABEL[key])
                .addExtraButton(btn => btn
                    .setIcon('chevron-up')
                    .setTooltip('Move up')
                    .setDisabled(idx === 0)
                    .onClick(() => { void this.moveStat(order, idx, -1); }))
                .addExtraButton(btn => btn
                    .setIcon('chevron-down')
                    .setTooltip('Move down')
                    .setDisabled(idx === order.length - 1)
                    .onClick(() => { void this.moveStat(order, idx, 1); }))
                .addToggle(toggle => toggle
                    .setValue(this.getInfoSettings()[field])
                    .onChange(async (value) => {
                        this.plugin.settings.bookView.leftPanelInfo[field] = value;
                        await this.plugin.saveSettings();
                        this.onSettingsChanged();
                    }));
        });

        new Setting(detail)
            .addButton(btn => btn
                .setButtonText('Reset to default order')
                .setTooltip('Restore the original order and show all rows')
                .onClick(async () => {
                    const info = this.plugin.settings.bookView.leftPanelInfo;
                    info.order = [...LEFT_PANE_STAT_KEYS];
                    info.todayWords = true;
                    info.currentFile = true;
                    info.totalWords = true;
                    info.completion = true;
                    info.writingDays = true;
                    info.dailyAverage = true;
                    await this.plugin.saveSettings();
                    this.onSettingsChanged();
                    this.onOpen();
                }));
    }

    private renderSceneNotesSection(sectionList: HTMLElement): void {
        const section = sectionList.createDiv({ cls: 'book-smith-book-view-settings-section' });
        const sectionHeader = section.createEl('button', {
            cls: 'book-smith-book-view-settings-section-header',
            attr: { type: 'button' }
        });

        const left = sectionHeader.createDiv({ cls: 'book-smith-book-view-settings-section-left' });
        const chevron = left.createSpan({ cls: 'book-smith-book-view-settings-chevron' });
        setIcon(chevron, this.sceneNotesSectionExpanded ? 'chevron-down' : 'chevron-right');
        left.createEl('span', { text: 'Scene Notes' });

        const glowOn = this.plugin.settings.sceneNoteGlowOnClick !== false;
        sectionHeader.createEl('span', {
            cls: `book-smith-book-view-settings-badge${glowOn ? ' is-on' : ' is-off'}`,
            text: glowOn ? 'Glow on' : 'Glow off'
        });

        sectionHeader.addEventListener('click', () => {
            this.sceneNotesSectionExpanded = !this.sceneNotesSectionExpanded;
            this.onOpen();
        });

        if (!this.sceneNotesSectionExpanded) {
            return;
        }

        const detail = section.createDiv({ cls: 'book-smith-book-view-settings-detail' });

        new Setting(detail)
            .setName('Glow note in editor on click')
            .setDesc('When you click a scene note, briefly glow its paragraph in any open editor where it is visible. Does not scroll or move anything.')
            .addToggle((toggle) => {
                toggle
                    .setValue(glowOn)
                    .onChange(async (value) => {
                        this.plugin.settings.sceneNoteGlowOnClick = value;
                        await this.plugin.saveSettings();
                        this.onSettingsChanged();
                        this.onOpen();
                    });
            });

        if (!glowOn) {
            return;
        }

        const fullRow = this.plugin.settings.sceneNoteGlowFullRow !== false;
        new Setting(detail)
            .setName('Highlight full row width')
            .setDesc('On: glow spans the whole row width. Off: glow hugs the actual text, stopping where each line ends.')
            .addToggle((toggle) => {
                toggle
                    .setValue(fullRow)
                    .onChange(async (value) => {
                        this.plugin.settings.sceneNoteGlowFullRow = value;
                        await this.plugin.saveSettings();
                        this.onSettingsChanged();
                    });
            });

        const matchColor = this.plugin.settings.sceneNoteGlowMatchColor === true;
        new Setting(detail)
            .setName('Match flag color')
            .setDesc('On: the glow takes the note\'s flag color (a yellow flag glows yellow), kept light. Off: always purple.')
            .addToggle((toggle) => {
                toggle
                    .setValue(matchColor)
                    .onChange(async (value) => {
                        this.plugin.settings.sceneNoteGlowMatchColor = value;
                        await this.plugin.saveSettings();
                        this.onSettingsChanged();
                    });
            });
    }

    private renderProjectManagementSection(sectionList: HTMLElement): void {
        const managementSection = sectionList.createDiv({ cls: 'book-smith-book-view-settings-section' });
        const sectionHeader = managementSection.createEl('button', {
            cls: 'book-smith-book-view-settings-section-header',
            attr: { type: 'button' }
        });

        const left = sectionHeader.createDiv({ cls: 'book-smith-book-view-settings-section-left' });
        const chevron = left.createSpan({ cls: 'book-smith-book-view-settings-chevron' });
        setIcon(chevron, this.projectManagementSectionExpanded ? 'chevron-down' : 'chevron-right');
        left.createEl('span', { text: 'Project Management' });

        const periodCount = this.currentBook?.stats?.writing_periods?.length || 0;
        sectionHeader.createEl('span', {
            cls: 'book-smith-book-view-settings-badge',
            text: `${periodCount} period${periodCount === 1 ? '' : 's'}`
        });

        sectionHeader.addEventListener('click', () => {
            this.projectManagementSectionExpanded = !this.projectManagementSectionExpanded;
            this.onOpen();
        });

        if (!this.projectManagementSectionExpanded) return;

        const detail = managementSection.createDiv({ cls: 'book-smith-book-view-settings-detail' });
        if (!this.currentBook) {
            detail.createEl('p', {
                cls: 'book-smith-book-view-settings-desc',
                text: 'Select a project first to manage writing periods.'
            });
            return;
        }

        detail.createEl('p', {
            cls: 'book-smith-book-view-settings-desc',
            text: 'Define named writing periods (draft, rewrite, etc.) with their own schedule and date boundaries.'
        });

        this.addGoalTargetSetting(detail);
        this.addShowDailyGoalInTodayToggle(detail);

        const periods = this.getProjectWritingPeriods();
        periods.forEach((period, index) => {
            this.renderWritingPeriodEditor(detail, period, index, periods.length);
        });

        new Setting(detail)
            .addButton((button) => {
                button
                    .setButtonText('Add Period')
                    .setCta()
                    .onClick(async () => {
                        await this.addWritingPeriod();
                    });
            });
    }

    private renderCoverSection(sectionList: HTMLElement): void {
        const coverSection = sectionList.createDiv({ cls: 'book-smith-book-view-settings-section' });
        const sectionHeader = coverSection.createEl('button', {
            cls: 'book-smith-book-view-settings-section-header',
            attr: { type: 'button' }
        });

        const left = sectionHeader.createDiv({ cls: 'book-smith-book-view-settings-section-left' });
        const chevron = left.createSpan({ cls: 'book-smith-book-view-settings-chevron' });
        setIcon(chevron, this.coverSectionExpanded ? 'chevron-down' : 'chevron-right');
        left.createEl('span', { text: 'Project Cover' });

        const hasCover = Boolean(this.currentBook?.basic.cover);
        sectionHeader.createEl('span', {
            cls: `book-smith-book-view-settings-badge${hasCover ? ' is-on' : ' is-off'}`,
            text: hasCover ? 'Set' : 'None'
        });

        sectionHeader.addEventListener('click', () => {
            this.coverSectionExpanded = !this.coverSectionExpanded;
            this.onOpen();
        });

        if (!this.coverSectionExpanded) return;

        const detail = coverSection.createDiv({ cls: 'book-smith-book-view-settings-detail' });
        if (!this.currentBook) {
            detail.createEl('p', {
                cls: 'book-smith-book-view-settings-desc',
                text: 'Select a project first to edit its cover.'
            });
            return;
        }

        new Setting(detail)
            .setName(i18n.t('COVER'))
            .setDesc(i18n.t('COVER_DESC'))
            .addButton((button) => {
                button
                    .setButtonText(hasCover ? i18n.t('CHANGE_COVER') : i18n.t('SELECT_COVER'))
                    .setCta()
                    .onClick(() => {
                        void this.selectAndApplyCover();
                    });
            });
    }

    private renderGoalSection(sectionList: HTMLElement): void {
        const goalSection = sectionList.createDiv({ cls: 'book-smith-book-view-settings-section' });
        const sectionHeader = goalSection.createEl('button', {
            cls: 'book-smith-book-view-settings-section-header',
            attr: { type: 'button' }
        });

        const left = sectionHeader.createDiv({ cls: 'book-smith-book-view-settings-section-left' });
        const chevron = left.createSpan({ cls: 'book-smith-book-view-settings-chevron' });
        setIcon(chevron, this.goalSectionExpanded ? 'chevron-down' : 'chevron-right');
        left.createEl('span', { text: 'Word Count Goal' });

        const hasGoal = Boolean((this.currentBook?.stats?.target_total_words || 0) > 0);
        sectionHeader.createEl('span', {
            cls: `book-smith-book-view-settings-badge${hasGoal ? ' is-on' : ' is-off'}`,
            text: hasGoal ? 'Set' : 'None'
        });

        sectionHeader.addEventListener('click', () => {
            this.goalSectionExpanded = !this.goalSectionExpanded;
            this.onOpen();
        });

        if (!this.goalSectionExpanded) return;

        const detail = goalSection.createDiv({ cls: 'book-smith-book-view-settings-detail' });
        if (!this.currentBook) {
            detail.createEl('p', {
                cls: 'book-smith-book-view-settings-desc',
                text: 'Select a project first to edit its goal.'
            });
            return;
        }

        this.addWritingStatsModeSetting(detail);
        this.addMetricModeSetting(detail);
        this.addGoalTargetSetting(detail);

        // Add Count Comments on Word Count toggle
        new Setting(detail)
            .setName('Count Comments on Word Count')
            .setDesc('If off, comments/annotations (%%, <!-- -->, /* */, blockquotes) are not counted in word count. Default is off.')
            .addToggle((toggle) => {
                const current = this.currentBook?.stats?.countCommentsInWordCount ?? false;
                toggle.setValue(current)
                    .onChange(async (value) => {
                        if (!this.currentBook) return;
                        await this.plugin.bookManager.updateBook(this.currentBook.basic.uuid, {
                            stats: {
                                ...this.currentBook.stats,
                                countCommentsInWordCount: value
                            }
                        });
                        this.currentBook.stats.countCommentsInWordCount = value;
                        this.onSettingsChanged();
                    });
            });

        this.addWordsPerPageSetting(detail);
        this.addDailyRolloverSetting(detail);
    }

    private addDailyRolloverSetting(container: HTMLElement): void {
        const current = String(normalizeDailyRolloverMinutes(this.plugin.settings.focus.dailyRolloverMinutes));

        new Setting(container)
            .setName(i18n.t('WRITING_DAY_ENDS_AT'))
            .setDesc(i18n.t('WRITING_DAY_ENDS_AT_DESC'))
            .addDropdown((dropdown) => {
                getDailyRolloverOptions().forEach((option) => {
                    dropdown.addOption(option.value, option.label);
                });

                dropdown.setValue(current).onChange(async (value) => {
                    this.plugin.settings.focus.dailyRolloverMinutes = normalizeDailyRolloverMinutes(Number(value));
                    await this.plugin.saveSettings();
                    this.plugin.focusManager?.reloadCurrentDayStats();
                    this.notifyStatsPreferenceChange();
                    this.onSettingsChanged();
                });
            });
    }

    private addWritingStatsModeSetting(container: HTMLElement): void {
        const currentMode = this.plugin.settings.stats?.leftPaneWritingDisplayMode || 'daily-output';

        const setting = new Setting(container)
            .setName(i18n.t('PROGRESS_DISPLAY_TYPE'))
            .setDesc(i18n.t('PROGRESS_DISPLAY_TYPE_DESC'));

        const controlEl = setting.controlEl;
        controlEl.empty();
        const row = controlEl.createDiv({ cls: 'book-smith-progress-mode-control' });

        const selectorButton = row.createEl('button', {
            cls: 'book-smith-progress-mode-selector',
            attr: { type: 'button' }
        });
        const selectorLabel = selectorButton.createSpan({ text: this.getProgressModeLabel(currentMode) });
        selectorButton.createSpan({ cls: 'book-smith-progress-mode-selector-caret', text: '▾' });

        selectorButton.addEventListener('click', () => {
            if (this.progressModeMenuEl) {
                this.closeProgressModeMenu();
                return;
            }

            const activeMode = (this.plugin.settings.stats?.leftPaneWritingDisplayMode || currentMode) as 'new-material-net' | 'daily-output' | 'raw';
            this.openProgressModeMenu(row, activeMode, async (mode) => {
                selectorLabel.textContent = this.getProgressModeLabel(mode);
                await this.updateWritingDisplayMode(mode);
            });
        });

        const infoButton = row.createEl('button', {
            cls: 'book-smith-progress-mode-info-btn',
            attr: { type: 'button', 'aria-label': 'Progress display information' }
        });
        infoButton.setText('i');
        this.attachRichTooltip(infoButton, () => this.getProgressInfoTooltipHtml());
    }

    private getProgressModeLabel(mode: 'new-material-net' | 'daily-output' | 'raw'): string {
        if (mode === 'daily-output') {
            return i18n.t('NEW_MATERIAL_DAILY_OUTPUT_MODE');
        }
        if (mode === 'raw') {
            return i18n.t('RAW_DATA_MODE');
        }
        return i18n.t('NEW_MATERIAL_NET_MODE');
    }

    private openProgressModeMenu(
        anchor: HTMLElement,
        currentMode: 'new-material-net' | 'daily-output' | 'raw',
        onSelect: (mode: 'new-material-net' | 'daily-output' | 'raw') => Promise<void>
    ): void {
        const menu = anchor.createDiv({ cls: 'book-smith-progress-mode-menu' });
        this.progressModeMenuEl = menu;

        const addOption = (
            mode: 'new-material-net' | 'daily-output' | 'raw',
            label: string
        ) => {
            const option = menu.createEl('button', {
                cls: `book-smith-progress-mode-option${currentMode === mode ? ' is-active' : ''}`,
                text: label,
                attr: { type: 'button' }
            });
            this.attachRichTooltip(option, () => this.getProgressModeTooltipHtml(mode));
            option.addEventListener('click', async () => {
                this.closeProgressModeMenu();
                await onSelect(mode);
            });
        };

        addOption('daily-output', i18n.t('NEW_MATERIAL_DAILY_OUTPUT_MODE'));
        addOption('new-material-net', i18n.t('NEW_MATERIAL_NET_MODE'));
        addOption('raw', i18n.t('RAW_DATA_MODE'));

        this.progressModeOutsideHandler = (event: MouseEvent) => {
            if (!anchor.contains(event.target as Node)) {
                this.closeProgressModeMenu();
            }
        };
        document.addEventListener('mousedown', this.progressModeOutsideHandler, true);
    }

    private closeProgressModeMenu(): void {
        this.progressModeMenuEl?.remove();
        this.progressModeMenuEl = null;
        if (this.progressModeOutsideHandler) {
            document.removeEventListener('mousedown', this.progressModeOutsideHandler, true);
            this.progressModeOutsideHandler = null;
        }
        // Remove any tooltip that was on a menu option (mouseleave won't fire on removed elements)
        this.richTooltipEl?.remove();
        this.richTooltipEl = null;
    }

    private async updateWritingDisplayMode(mode: 'new-material-net' | 'daily-output' | 'raw'): Promise<void> {
        this.plugin.settings.stats = {
            displayMode: this.plugin.settings.stats?.displayMode || 'words',
            writingDisplayMode: this.plugin.settings.stats?.writingDisplayMode || 'new-material-net',
            leftPaneWritingDisplayMode: mode,
            wordsPerPage: this.plugin.settings.stats?.wordsPerPage || 250
        };
        await this.plugin.saveSettings();
        this.notifyStatsPreferenceChange();
        this.onSettingsChanged();
    }

    private getProgressInfoTooltipHtml(): string {
        return `
            <div class="book-smith-rich-tooltip-content">
                <p>Most writing software only shows net word count change.</p>
                <p>If you start the day with 10,000 words and end with 10,000 words, the tracker simply shows: <strong>0</strong></p>
                <p>That number alone does not tell you what actually happened during the day.</p>
                <p>The New Material metric shows your net progress plus useful context about how the manuscript changed.</p>
                <p>The net is still 0, but the additional data reveals that you replaced an entire 10,000-word scene.</p>
                <p><span class="is-purple">Purple: new material written that day</span><br><span class="is-red">Red: older material removed from the manuscript</span></p>
            </div>
        `;
    }

    private getProgressModeTooltipHtml(mode: 'new-material-net' | 'daily-output' | 'raw'): string {
        if (mode === 'daily-output') {
            return `
                <div class="book-smith-rich-tooltip-content">
                    <p><strong>New Material (Daily Output)</strong></p>
                    <p>Shows new material written today as the main number.</p>
                    <p>Net manuscript change is still shown, but as secondary context.</p>
                    <p>This is the recommended view for the left pane and daily goals.</p>
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
            </div>
        `;
    }

    private attachRichTooltip(target: HTMLElement, getHtml: () => string): void {
        const showTooltip = (event: MouseEvent) => {
            if (this.richTooltipEl) {
                this.richTooltipEl.remove();
            }

            const tooltip = document.body.createDiv({ cls: 'book-smith-rich-tooltip' });
            tooltip.innerHTML = getHtml();
            this.richTooltipEl = tooltip;
            this.positionRichTooltip(event);
        };

        const moveTooltip = (event: MouseEvent) => {
            this.positionRichTooltip(event);
        };

        const hideTooltip = () => {
            this.richTooltipEl?.remove();
            this.richTooltipEl = null;
        };

        target.addEventListener('mouseenter', showTooltip);
        target.addEventListener('mousemove', moveTooltip);
        target.addEventListener('mouseleave', hideTooltip);
    }

    private positionRichTooltip(event: MouseEvent): void {
        if (!this.richTooltipEl) return;

        const tooltip = this.richTooltipEl;
        const offset = 14;
        const viewportPadding = 16;
        const maxX = window.innerWidth - tooltip.offsetWidth - viewportPadding;
        const maxY = window.innerHeight - tooltip.offsetHeight - viewportPadding;

        const x = Math.min(maxX, event.clientX + offset);
        const y = Math.min(maxY, event.clientY + offset);

        tooltip.style.left = `${Math.max(viewportPadding, x)}px`;
        tooltip.style.top = `${Math.max(viewportPadding, y)}px`;
    }

    private addMetricModeSetting(container: HTMLElement): void {
        const settings = this.getInfoSettings();
        new Setting(container)
            .setName('Metric Unit')
            .setDesc('Default unit for left pane stats and settings menus.')
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('words', i18n.t('WORDS_MODE'))
                    .addOption('pages', i18n.t('PAGES_MODE'))
                    .setValue(settings.metricMode)
                    .onChange(async (value) => {
                        const nextMode = value === 'pages' ? 'pages' : 'words';
                        this.plugin.settings.bookView.leftPanelInfo.metricMode = nextMode;
                        // Keep all goal unit selectors aligned with this default selector.
                        this.goalInputMode = nextMode;
                        this.dailyGoalInputMode = nextMode;
                        await this.plugin.saveSettings();
                        this.onSettingsChanged();
                        this.onOpen();
                    });
            });
    }

    private renderWritingPeriodEditor(
        container: HTMLElement,
        period: BookWritingPeriod,
        index: number,
        total: number
    ): void {
        const card = container.createDiv({ cls: 'book-smith-period-card' });
        const header = card.createDiv({ cls: 'book-smith-period-card-header' });
        header.createEl('h4', { text: period.name || `Period ${index + 1}` });

        const headerActions = header.createDiv({ cls: 'book-smith-period-card-actions' });
        const canCollapse = total > 1;
        const isCollapsed = canCollapse && this.collapsedPeriodIds.has(period.id);

        if (canCollapse) {
            const collapseBtn = headerActions.createEl('button', {
                cls: 'book-smith-period-collapse-btn',
                attr: {
                    type: 'button',
                    'aria-label': isCollapsed ? 'Expand period' : 'Collapse period'
                }
            });
            setIcon(collapseBtn, isCollapsed ? 'chevron-right' : 'chevron-down');
            collapseBtn.addEventListener('click', () => {
                if (this.collapsedPeriodIds.has(period.id)) {
                    this.collapsedPeriodIds.delete(period.id);
                } else {
                    this.collapsedPeriodIds.add(period.id);
                }
                this.onOpen();
            });
        }

        if (total > 1) {
            const removeBtn = headerActions.createEl('button', {
                cls: 'mod-warning book-smith-period-remove-btn',
                text: 'Remove',
                attr: { type: 'button' }
            });
            removeBtn.addEventListener('click', async () => {
                await this.removeWritingPeriod(period.id);
            });
        }

        if (isCollapsed) {
            card.createEl('p', {
                cls: 'book-smith-period-collapsed-summary',
                text: this.getPeriodCollapsedSummary(period)
            });
            return;
        }

        new Setting(card)
            .setName('Period name')
            .addText((text) => {
                text
                    .setPlaceholder(`Period ${index + 1}`)
                    .setValue(period.name)
                    .onChange(async (value) => {
                        await this.updateWritingPeriod(period.id, {
                            name: value.trim() || `Period ${index + 1}`
                        });
                    });
            });

        new Setting(card)
            .setName('Start date')
            .setDesc('Default is project creation day.')
            .addText((text) => {
                text.inputEl.type = 'date';
                text.setValue(period.start_date)
                    .onChange(async (value) => {
                        const normalized = this.normalizeDateInput(value) || period.start_date;
                        await this.updateWritingPeriod(period.id, { start_date: normalized });
                        this.onOpen();
                    });
            });

        new Setting(card)
            .setName('End date')
            .setDesc('Leave blank for an ongoing period.')
            .addText((text) => {
                text.inputEl.type = 'date';
                text.setPlaceholder('Ongoing')
                    .setValue(period.end_date || '')
                    .onChange(async (value) => {
                        const normalized = this.normalizeDateInput(value);
                        if (normalized && normalized < period.start_date) {
                            new Notice('End date cannot be earlier than start date.');
                            this.onOpen();
                            return;
                        }
                        await this.updateWritingPeriod(period.id, { end_date: normalized || undefined });
                    });
            });

        new Setting(card)
            .setName('Schedule mode')
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('specific-days', 'Specific weekdays')
                    .addOption('days-per-week', 'Days per week')
                    .setValue(period.schedule.mode)
                    .onChange(async (value) => {
                        await this.updateWritingPeriod(period.id, {
                            schedule: {
                                ...period.schedule,
                                mode: value === 'days-per-week' ? 'days-per-week' : 'specific-days'
                            }
                        });
                        this.onOpen();
                    });
            });

        if (period.schedule.mode === 'days-per-week') {
            new Setting(card)
                .setName('Expected writing days per week')
                .addSlider((slider) => {
                    slider
                        .setLimits(0, 7, 1)
                        .setValue(period.schedule.days_per_week)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            await this.updateWritingPeriod(period.id, {
                                schedule: {
                                    ...period.schedule,
                                    days_per_week: Math.max(0, Math.min(7, Math.round(value)))
                                }
                            });
                        });
                });
        } else {
            const daysContainer = card.createDiv({ cls: 'book-smith-weekday-selector' });
            daysContainer.createEl('div', {
                cls: 'setting-item-name',
                text: 'Expected weekdays'
            });
            const dayButtons = daysContainer.createDiv({ cls: 'book-smith-weekday-selector-buttons' });
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            dayNames.forEach((label, dayIndex) => {
                const isSelected = period.schedule.selected_weekdays.includes(dayIndex);
                const button = dayButtons.createEl('button', {
                    cls: `book-smith-weekday-chip${isSelected ? ' is-selected' : ''}`,
                    text: label,
                    attr: { type: 'button' }
                });
                button.addEventListener('click', async () => {
                    const currentSet = new Set(period.schedule.selected_weekdays);
                    if (currentSet.has(dayIndex)) currentSet.delete(dayIndex);
                    else currentSet.add(dayIndex);
                    await this.updateWritingPeriod(period.id, {
                        schedule: {
                            ...period.schedule,
                            selected_weekdays: this.normalizeWeekdays(Array.from(currentSet))
                        }
                    });
                    this.onOpen();
                });
            });
        }

        new Setting(card)
            .setName('Count missed scheduled days as zero')
            .addToggle((toggle) => {
                toggle
                    .setValue(period.average_missed_scheduled_days)
                    .onChange(async (value) => {
                        await this.updateWritingPeriod(period.id, {
                            average_missed_scheduled_days: value
                        });
                    });
            });

        new Setting(card)
            .setName('Average window')
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('0', 'All time')
                    .addOption('7', 'Rolling 7 days')
                    .addOption('14', 'Rolling 14 days')
                    .addOption('30', 'Rolling 30 days')
                    .addOption('90', 'Rolling 90 days')
                    .setValue(String(period.average_window_days))
                    .onChange(async (value) => {
                        await this.updateWritingPeriod(period.id, {
                            average_window_days: this.normalizeAverageWindowDays(Number(value))
                        });
                    });
            });
    }

    private async addWritingPeriod(): Promise<void> {
        if (!this.currentBook) return;
        const periods = this.getProjectWritingPeriods();
        const newPeriod = this.createDefaultPeriod(periods.length + 1);
        periods.push(newPeriod);
        await this.saveWritingPeriods(periods);
        this.onOpen();
    }

    private async removeWritingPeriod(periodId: string): Promise<void> {
        if (!this.currentBook) return;
        const periods = this.getProjectWritingPeriods().filter((period) => period.id !== periodId);
        await this.saveWritingPeriods(periods.length > 0 ? periods : [this.createDefaultPeriod(1)]);
        this.onOpen();
    }

    private async updateWritingPeriod(periodId: string, updates: Partial<BookWritingPeriod>): Promise<void> {
        if (!this.currentBook) return;
        const periods: BookWritingPeriod[] = this.getProjectWritingPeriods().map((period): BookWritingPeriod => {
            if (period.id !== periodId) return period;

            const nextSchedule: BookWritingPeriod['schedule'] = updates.schedule
                ? {
                    mode: updates.schedule.mode === 'days-per-week' ? 'days-per-week' : 'specific-days',
                    selected_weekdays: this.normalizeWeekdays(updates.schedule.selected_weekdays || period.schedule.selected_weekdays),
                    days_per_week: Math.max(0, Math.min(7, Math.round(updates.schedule.days_per_week ?? period.schedule.days_per_week)))
                }
                : period.schedule;

            return {
                ...period,
                ...updates,
                start_date: this.normalizeDateInput(updates.start_date) || period.start_date,
                end_date: updates.end_date === undefined ? period.end_date : this.normalizeDateInput(updates.end_date || '') || undefined,
                schedule: nextSchedule,
                average_window_days: this.normalizeAverageWindowDays(updates.average_window_days ?? period.average_window_days),
                updated_at: new Date().toISOString()
            };
        });

        await this.saveWritingPeriods(periods);
    }

    private async saveWritingPeriods(periods: BookWritingPeriod[]): Promise<void> {
        if (!this.currentBook) return;

        const normalized = periods
            .map((period) => this.normalizeWritingPeriod(period))
            .sort((a, b) => a.start_date.localeCompare(b.start_date));

        await this.plugin.bookManager.updateBook(this.currentBook.basic.uuid, {
            stats: {
                ...this.currentBook.stats,
                writing_periods: normalized
            }
        });

        this.currentBook.stats.writing_periods = normalized;
        this.onSettingsChanged();
    }

    private getProjectWritingPeriods(): BookWritingPeriod[] {
        const existing = this.currentBook?.stats?.writing_periods || [];
        if (existing.length > 0) {
            return existing.map((period) => this.normalizeWritingPeriod(period));
        }
        return [this.createDefaultPeriod(1)];
    }

    private createDefaultPeriod(index: number): BookWritingPeriod {
        const now = new Date().toISOString();
        const createdAt = this.currentBook?.basic?.created_at;
        const createdDate = createdAt ? new Date(createdAt) : new Date();
        const startDate = Number.isNaN(createdDate.getTime())
            ? getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes)
            : getLogicalDayISODate(createdDate, this.plugin.settings.focus.dailyRolloverMinutes);

        return {
            id: `period-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            name: index === 1 ? 'First Draft' : `Period ${index}`,
            start_date: startDate,
            schedule: {
                mode: 'specific-days',
                selected_weekdays: [0, 1, 2, 3, 4, 5, 6],
                days_per_week: 7
            },
            average_missed_scheduled_days: true,
            average_window_days: 0,
            created_at: now,
            updated_at: now
        };
    }

    private normalizeWritingPeriod(period: BookWritingPeriod): BookWritingPeriod {
        const now = new Date().toISOString();
        const start = this.normalizeDateInput(period.start_date)
            || getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        const end = this.normalizeDateInput(period.end_date || '');

        return {
            id: period.id || `period-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            name: period.name || 'Writing Period',
            start_date: start,
            end_date: end && end >= start ? end : undefined,
            schedule: {
                mode: period.schedule?.mode === 'days-per-week' ? 'days-per-week' : 'specific-days',
                selected_weekdays: this.normalizeWeekdays(period.schedule?.selected_weekdays || []),
                days_per_week: Math.max(0, Math.min(7, Math.round(period.schedule?.days_per_week ?? 7)))
            },
            average_missed_scheduled_days: period.average_missed_scheduled_days ?? true,
            average_window_days: this.normalizeAverageWindowDays(period.average_window_days ?? 0),
            created_at: period.created_at || now,
            updated_at: now
        };
    }

    private normalizeDateInput(value?: string): string | null {
        if (!value) return null;
        return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    }

    private getPeriodCollapsedSummary(period: BookWritingPeriod): string {
        const range = period.end_date
            ? `${period.start_date} to ${period.end_date}`
            : `${period.start_date} to Ongoing`;
        const schedule = period.schedule.mode === 'days-per-week'
            ? `${period.schedule.days_per_week}/7 days`
            : `${period.schedule.selected_weekdays.length}/7 weekdays`;
        return `${range} | ${schedule}`;
    }

    private normalizeWeekdays(days: number[]): number[] {
        const valid = new Set<number>();
        days.forEach((day) => {
            if (Number.isInteger(day) && day >= 0 && day <= 6) {
                valid.add(day);
            }
        });
        return Array.from(valid).sort((a, b) => a - b);
    }

    private normalizeAverageWindowDays(value: number): number {
        const allowed = new Set([0, 7, 14, 30, 90]);
        const normalized = Math.round(value);
        return allowed.has(normalized) ? normalized : 0;
    }

    private addWordsPerPageSetting(container: HTMLElement): void {
        const currentWordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
        new Setting(container)
            .setName(i18n.t('WORDS_PER_PAGE'))
            .setDesc('Shared across all statistics displays and used for conversions if using page goals.')
            .addText((text) => {
                text
                    .setPlaceholder('250')
                    .setValue(String(currentWordsPerPage));

                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.inputEl.step = '1';
            })
            .addButton((button) => {
                button
                    .setButtonText(i18n.t('APPLY_STATS_SETTINGS'))
                    .onClick(async () => {
                        const input = (button.buttonEl.closest('.setting-item')?.querySelector('input') as HTMLInputElement | null);
                        const parsed = Number(input?.value || currentWordsPerPage);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            new Notice(i18n.t('INVALID_WORDS_PER_PAGE'));
                            return;
                        }

                        this.plugin.settings.stats = {
                            displayMode: this.plugin.settings.stats?.displayMode || 'words',
                            writingDisplayMode: this.plugin.settings.stats?.writingDisplayMode || 'new-material-net',
                            leftPaneWritingDisplayMode: this.plugin.settings.stats?.leftPaneWritingDisplayMode || 'daily-output',
                            wordsPerPage: parsed
                        };
                        await this.plugin.saveSettings();
                        this.notifyStatsPreferenceChange();
                        this.onSettingsChanged();
                    });
            });
    }


    // Preview the selected goal sound
    private async previewGoalSound(sound: string) {
        if (sound === 'none') return;
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const t0 = audioContext.currentTime;
            const gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
            gainNode.gain.setValueAtTime(0.0001, t0);
            if (sound === 'ping1') {
                const toneA = audioContext.createOscillator();
                toneA.type = 'sine';
                toneA.frequency.setValueAtTime(880, t0);
                toneA.connect(gainNode);
                const toneB = audioContext.createOscillator();
                toneB.type = 'sine';
                toneB.frequency.setValueAtTime(1175, t0 + 0.075);
                toneB.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.04, t0 + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
                toneA.start(t0);
                toneA.stop(t0 + 0.1);
                toneB.start(t0 + 0.075);
                toneB.stop(t0 + 0.22);
                window.setTimeout(() => {
                    toneA.disconnect();
                    toneB.disconnect();
                    gainNode.disconnect();
                    audioContext.close();
                }, 320);
            } else if (sound === 'ping2') {
                const toneA = audioContext.createOscillator();
                toneA.type = 'triangle';
                toneA.frequency.setValueAtTime(1047, t0);
                toneA.connect(gainNode);
                const toneB = audioContext.createOscillator();
                toneB.type = 'triangle';
                toneB.frequency.setValueAtTime(1319, t0 + 0.08);
                toneB.connect(gainNode);
                const toneC = audioContext.createOscillator();
                toneC.type = 'triangle';
                toneC.frequency.setValueAtTime(1568, t0 + 0.16);
                toneC.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.045, t0 + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
                toneA.start(t0);
                toneA.stop(t0 + 0.12);
                toneB.start(t0 + 0.08);
                toneB.stop(t0 + 0.22);
                toneC.start(t0 + 0.16);
                toneC.stop(t0 + 0.32);
                window.setTimeout(() => {
                    toneA.disconnect();
                    toneB.disconnect();
                    toneC.disconnect();
                    gainNode.disconnect();
                    audioContext.close();
                }, 400);
            } else if (sound === 'ping3') {
                const toneA = audioContext.createOscillator();
                toneA.type = 'square';
                toneA.frequency.setValueAtTime(784, t0);
                toneA.connect(gainNode);
                const toneB = audioContext.createOscillator();
                toneB.type = 'square';
                toneB.frequency.setValueAtTime(988, t0 + 0.09);
                toneB.connect(gainNode);
                const toneC = audioContext.createOscillator();
                toneC.type = 'square';
                toneC.frequency.setValueAtTime(1175, t0 + 0.18);
                toneC.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.06, t0 + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
                toneA.start(t0);
                toneA.stop(t0 + 0.13);
                toneB.start(t0 + 0.09);
                toneB.stop(t0 + 0.25);
                toneC.start(t0 + 0.18);
                toneC.stop(t0 + 0.38);
                window.setTimeout(() => {
                    toneA.disconnect();
                    toneB.disconnect();
                    toneC.disconnect();
                    gainNode.disconnect();
                    audioContext.close();
                }, 480);
            } else if (sound === 'ping4') {
                const toneA = audioContext.createOscillator();
                toneA.type = 'sine';
                toneA.frequency.setValueAtTime(1760, t0);
                toneA.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.055, t0 + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
                toneA.start(t0);
                toneA.stop(t0 + 0.22);
                window.setTimeout(() => {
                    toneA.disconnect();
                    gainNode.disconnect();
                    audioContext.close();
                }, 300);
            }
        } catch {}
    }

    private addShowDailyGoalInTodayToggle(container: HTMLElement): void {
        if (!this.currentBook) return;

        const showGoal = this.currentBook.stats?.show_daily_goal_in_today_stat ?? false;
        new Setting(container)
            .setName('Show goal in Today stat')
            .setDesc('Displays Today as current/goal in the left pane when a daily goal is set.')
            .addToggle((toggle) => {
                toggle
                    .setValue(showGoal)
                    .onChange(async (value) => {
                        if (!this.currentBook) return;

                        await this.plugin.bookManager.updateBook(this.currentBook.basic.uuid, {
                            stats: {
                                ...this.currentBook.stats,
                                show_daily_goal_in_today_stat: value
                            }
                        });

                        this.currentBook.stats.show_daily_goal_in_today_stat = value;
                        this.onSettingsChanged();
                    });
            });
    }

    private addGoalTargetSetting(container: HTMLElement): void {
        if (!this.currentBook) return;

        const mode = this.goalInputMode;
        const wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
        const targetWords = this.currentBook.stats?.target_total_words || 0;
        const targetDisplay = mode === 'pages'
            ? this.formatPages(targetWords, wordsPerPage)
            : String(targetWords);
        const unitLabel = mode === 'pages' ? i18n.t('PAGES_MODE') : i18n.t('WORDS_MODE');
        const targetLabel = mode === 'pages' ? i18n.t('TARGET_PAGE_COUNT') : i18n.t('TARGET_WORD_COUNT');

        // --- Goal input (words/pages) ---
        new Setting(container)
            .setName(targetLabel)
            .setDesc(`Current project goal (${unitLabel}).`)
            .addText((text) => {
                text
                    .setPlaceholder(mode === 'pages' ? '300' : '80000')
                    .setValue(targetDisplay);

                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.inputEl.step = mode === 'pages' ? '0.1' : '1';
            })
            .addExtraButton((btn) => {
                btn
                    .setTooltip(mode === 'pages' ? 'Switch to Words' : 'Switch to Pages')
                    .setIcon(mode === 'pages' ? 'file-text' : 'case-sensitive')
                    .onClick(async () => {
                        if (this.goalInputMode === 'words') {
                            const ensured = await this.ensureWordsPerPage();
                            if (!ensured) return;
                            this.goalInputMode = 'pages';
                        } else {
                            this.goalInputMode = 'words';
                        }
                        this.onOpen();
                    });
            })
            .addButton((button) => {
                button
                    .setButtonText(i18n.t('APPLY_STATS_SETTINGS'))
                    .onClick(async () => {
                        if (!this.currentBook) return;

                        const activeMode = this.goalInputMode;
                        const activeWordsPerPage = activeMode === 'pages'
                            ? await this.ensureWordsPerPage()
                            : (this.plugin.settings.stats?.wordsPerPage || 250);
                        if (!activeWordsPerPage) return;

                        const input = button.buttonEl.closest('.setting-item')?.querySelector('input') as HTMLInputElement | null;
                        const parsed = Number(input?.value);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            new Notice(activeMode === 'pages'
                                ? 'Please enter a valid page target (0 or greater).'
                                : 'Please enter a valid word target (0 or greater).');
                            return;
                        }

                        const normalizedTargetWords = activeMode === 'pages'
                            ? Math.round(parsed * activeWordsPerPage)
                            : Math.round(parsed);

                        await this.plugin.bookManager.updateBook(this.currentBook.basic.uuid, {
                            stats: {
                                ...this.currentBook.stats,
                                target_total_words: normalizedTargetWords
                            }
                        });

                        this.currentBook.stats.target_total_words = normalizedTargetWords;
                        this.onSettingsChanged();
                        new Notice(i18n.t('SAVE_SUCCESS'));
                    });
            });

        // --- Daily Word Goal (added above sound) ---
        // --- Daily Word/Page Goal (dynamic label and value) ---
        const dailyGoalMode = this.goalInputMode;
        const dailyGoalLabel = dailyGoalMode === 'pages' ? 'Daily Page Goal' : 'Daily Word Goal';
        const dailyGoalDesc = dailyGoalMode === 'pages'
            ? 'Set a daily page goal for this project. Used for Today stats and goal tracking.'
            : 'Set a daily word goal for this project. Used for Today stats and goal tracking.';
        let dailyGoalValue = this.currentBook?.stats?.daily_goal_words ?? '';
        if (dailyGoalMode === 'pages') {
            const wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
            dailyGoalValue = dailyGoalValue ? (Number(dailyGoalValue) / wordsPerPage).toFixed(1).replace(/\.0$/, '') : '';
        }
        new Setting(container)
            .setName(dailyGoalLabel)
            .setDesc(dailyGoalDesc)
            .addText((text) => {
                text.setPlaceholder(dailyGoalMode === 'pages' ? 'e.g. 8' : 'e.g. 2000').setValue(String(dailyGoalValue));
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.inputEl.step = dailyGoalMode === 'pages' ? '0.1' : '1';
            })
            .addExtraButton((btn) => {
                btn
                    .setTooltip(dailyGoalMode === 'pages' ? 'Switch to Words' : 'Switch to Pages')
                    .setIcon(dailyGoalMode === 'pages' ? 'file-text' : 'case-sensitive')
                    .onClick(async () => {
                        if (this.goalInputMode === 'words') {
                            const ensured = await this.ensureWordsPerPage();
                            if (!ensured) return;
                            this.goalInputMode = 'pages';
                        } else {
                            this.goalInputMode = 'words';
                        }
                        this.onOpen();
                    });
            })
            .addButton((button) => {
                button
                    .setButtonText(i18n.t('APPLY_STATS_SETTINGS'))
                    .onClick(async () => {
                        if (!this.currentBook) return;
                        const input = button.buttonEl.closest('.setting-item')?.querySelector('input') as HTMLInputElement | null;
                        let parsed = Number(input?.value);
                        if (!Number.isFinite(parsed) || parsed < 0) return;
                        if (dailyGoalMode === 'pages') {
                            const wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
                            parsed = Math.round(parsed * wordsPerPage);
                        }
                        await this.plugin.bookManager.updateBook(this.currentBook.basic.uuid, {
                            stats: {
                                ...this.currentBook.stats,
                                daily_goal_words: parsed
                            }
                        });
                        this.currentBook.stats.daily_goal_words = parsed;
                        this.onSettingsChanged();
                    });
            });

        // --- Sound dropdown for goal completion ---
        const soundOptions = [
            { value: 'ping1', label: 'Ping 1 (default)' },
            { value: 'none', label: 'None' },
            { value: 'ping2', label: 'Ping 2 (cheery)' },
            { value: 'ping3', label: 'Ping 3 (victorious trumpet)' },
            { value: 'ping4', label: 'Ping 4 (bright bell)' }
        ];
        const currentSound = this.currentBook.stats?.goal_reached_sound || 'ping1';

        new Setting(container)
            .setName('Goal Reached Sound')
            .setDesc('Sound played when you reach your daily writing goal.')
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions(Object.fromEntries(soundOptions.map(opt => [opt.value, opt.label])))
                    .setValue(currentSound)
                    .onChange(async (value) => {
                        if (!this.currentBook) return;
                        await this.plugin.bookManager.updateBook(this.currentBook.basic.uuid, {
                            stats: {
                                ...this.currentBook.stats,
                                goal_reached_sound: value
                            }
                        });
                        this.currentBook.stats.goal_reached_sound = value;
                        this.onSettingsChanged();
                        // Preview the sound
                        this.previewGoalSound(value);
                    });
            });
    }

    private async ensureWordsPerPage(): Promise<number | null> {
        const current = Number(this.plugin.settings.stats?.wordsPerPage || 0);
        if (Number.isFinite(current) && current > 0) {
            return current;
        }

        return new Promise((resolve) => {
            new NamePromptModal(this.app, i18n.t('ENTER_WORDS_PER_PAGE'), async (result) => {
                const parsed = Number(result);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    new Notice(i18n.t('INVALID_WORDS_PER_PAGE'));
                    resolve(null);
                    return;
                }

                this.plugin.settings.stats = {
                    displayMode: this.plugin.settings.stats?.displayMode || 'words',
                    writingDisplayMode: this.plugin.settings.stats?.writingDisplayMode || 'new-material-net',
                    leftPaneWritingDisplayMode: this.plugin.settings.stats?.leftPaneWritingDisplayMode || 'daily-output',
                    wordsPerPage: parsed
                };
                await this.plugin.saveSettings();
                this.notifyStatsPreferenceChange();
                resolve(parsed);
            }, '250').open();
        });
    }

    private notifyStatsPreferenceChange(): void {
        const leaves = this.app.workspace.getLeavesOfType('book-smith-tool');
        leaves.forEach((leaf) => {
            const view = leaf.view as any;
            if (typeof view?.onStatsPreferencesChanged === 'function') {
                view.onStatsPreferencesChanged();
            }
        });
    }

    private addInfoToggle(
        container: HTMLElement,
        label: string,
        key: 'todayWords' | 'totalWords' | 'completion' | 'writingDays' | 'dailyAverage'
    ): void {
        const settings = this.getInfoSettings();
        new Setting(container)
            .setName(label)
            .addToggle((toggle) => {
                toggle
                    .setValue(settings[key])
                    .onChange(async (value) => {
                        this.plugin.settings.bookView.leftPanelInfo[key] = value;
                        await this.plugin.saveSettings();
                        this.onSettingsChanged();
                    });
            });
    }

    private getInfoSettings() {
        const current = this.plugin.settings.bookView?.leftPanelInfo;
        return {
            enabled: current?.enabled ?? true,
            metricMode: current?.metricMode === 'pages' ? 'pages' : 'words',
            todayWords: current?.todayWords ?? true,
            totalWords: current?.totalWords ?? true,
            completion: current?.completion ?? true,
            writingDays: current?.writingDays ?? true,
            dailyAverage: current?.dailyAverage ?? true,
            currentFile: current?.currentFile ?? true
        };
    }

    /** Swap a stat with its neighbour in the display order, then re-render. */
    private async moveStat(order: LeftPaneStatKey[], idx: number, dir: number): Promise<void> {
        const target = idx + dir;
        if (target < 0 || target >= order.length) return;
        const next = [...order];
        [next[idx], next[target]] = [next[target], next[idx]];
        this.plugin.settings.bookView.leftPanelInfo.order = next;
        await this.plugin.saveSettings();
        this.onSettingsChanged();
        this.onOpen();
    }

    private formatPages(words: number, wordsPerPage: number): string {
        const pages = words / wordsPerPage;
        if (Number.isInteger(pages)) return String(pages);
        return pages.toFixed(1).replace(/\.0$/, '');
    }

    private async selectAndApplyCover(): Promise<void> {
        if (!this.currentBook) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file || !this.currentBook) return;

            try {
                const coversPath = `${this.plugin.settings.defaultBookPath}/covers`;
                if (!await this.app.vault.adapter.exists(coversPath)) {
                    await this.app.vault.adapter.mkdir(coversPath);
                }

                const fileName = `cover-${Date.now()}.${file.name.split('.').pop()}`;
                const coverPath = `${coversPath}/${fileName}`;
                await this.app.vault.adapter.writeBinary(coverPath, await file.arrayBuffer());

                await this.plugin.bookManager.updateBook(this.currentBook.basic.uuid, {
                    basic: {
                        ...this.currentBook.basic,
                        cover: coverPath
                    }
                });

                this.currentBook.basic.cover = coverPath;
                await this.plugin.saveSettings();
                this.onSettingsChanged();
                this.onOpen();
                new Notice(i18n.t('COVER_UPDATE_SUCCESS'));
            } catch (error: any) {
                new Notice(i18n.t('COVER_UPDATE_FAILED') + (error?.message || String(error)));
            }
        };
        input.click();
    }
}
