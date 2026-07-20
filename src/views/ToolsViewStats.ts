import { ToolView } from './ToolsView';
import { setIcon } from 'obsidian';
import { i18n } from '../i18n/i18n';

export class ToolsViewStats {
            public renderSelectedDayStats(container: HTMLElement) {
                const selectedDate = this.view.parseLocalISODate(this.view.selectedStatsDate);
                const selectedMetric = this.view.getMetricForPeriod(selectedDate);
                const anchorDate = this.view.getPeriodAnchorDate(selectedDate);
                const anchorIso = this.view.toLocalISODate(anchorDate);
                const commentKey = this.view.getCommentStorageKey(anchorIso);
                const selectedComment = this.view.statsPeriodMode === 'day'
                    ? (this.view.statsDailyComments[this.view.selectedStatsDate] || '')
                    : (this.view.statsPeriodComments[commentKey] || '');
                const selectedProgress = this.view.getProgressForSelectedPeriod(selectedDate);
                const mainMetric = this.view.getMainMetricForDetails(selectedMetric, selectedProgress);
                const details = container.createDiv({ cls: 'book-smith-stats-day-details' });

                // Create a relatively positioned container for date and absolutely positioned icon
                const dateHeader = details.createDiv({
                    cls: 'book-smith-stats-selected-date-row'
                });
                const dateText = document.createElement('span');
                dateText.textContent = this.view.getSelectedPeriodLabel(selectedDate);
                dateText.className = 'book-smith-stats-selected-date';
                dateHeader.appendChild(dateText);

                // Debug icon button (darker, thinner, absolutely positioned)
                const debugBtn = document.createElement('button');
                debugBtn.className = 'book-smith-debug-stats-btn';
                debugBtn.title = 'Debug Stats';
                debugBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';
                debugBtn.onclick = () => this.view.openDebugStatsPopup(this.view.toLocalISODate(selectedDate));
                dateHeader.appendChild(debugBtn);

                const metricRow = details.createDiv({ cls: 'book-smith-stats-selected-metric-row' });
                const selectedMetricEl = metricRow.createEl('div', {
                    cls: 'book-smith-stats-selected-words',
                    text: this.view.getSelectedDayMetricText(mainMetric)
                });
                if ((this.view.statsDisplayMode === 'words' || this.view.statsDisplayMode === 'pages') && selectedProgress && this.view.hasProgressActivity(selectedProgress)) {
                    selectedMetricEl.addClass('book-smith-stats-tooltip-target');
                    selectedMetricEl.setAttr('data-breakdown-tooltip', this.view.getMainMetricHoverLabel());
                }
                if (mainMetric < 0) {
                    selectedMetricEl.addClass('progress-negative');
                } else if (mainMetric > 0 && (this.view.statsDisplayMode === 'words' || this.view.statsDisplayMode === 'pages')) {
                    selectedMetricEl.addClass('progress-purple');
                }

                if ((this.view.statsDisplayMode === 'words' || this.view.statsDisplayMode === 'pages') && selectedProgress && this.view.hasProgressActivity(selectedProgress)) {
                    const breakdownValues = this.view.getDisplayedBreakdown(selectedProgress);
                    const breakdownLabels = this.view.getBreakdownHoverLabels();
                    const breakdown = metricRow.createDiv({ cls: 'book-smith-stats-selected-breakdown' });
                    breakdown.createEl('span', { text: '(' });
                    if (this.view.statsWritingDisplayMode === 'daily-output') {
                        const netValue = selectedProgress.net_change || 0;
                        breakdown.createEl('span', {
                            cls: `${netValue < 0 ? 'progress-negative book-smith-stats-breakdown-negative' : 'progress-purple book-smith-stats-breakdown-positive'} book-smith-stats-breakdown-value`,
                            attr: { 'data-breakdown-tooltip': 'Net material', 'aria-label': 'Net material' },
                            text: this.view.getBreakdownValueText(netValue)
                        });
                        breakdown.createEl('span', { text: ' | ' });
                        breakdown.createEl('span', {
                            cls: 'progress-negative book-smith-stats-breakdown-value book-smith-stats-breakdown-negative',
                            attr: { 'data-breakdown-tooltip': 'Old material removed', 'aria-label': 'Old material removed' },
                            text: this.view.getBreakdownValueText(breakdownValues.negative, false, true)
                        });
                    } else {
                        breakdown.createEl('span', {
                            cls: 'progress-purple book-smith-stats-breakdown-value book-smith-stats-breakdown-positive',
                            attr: { 'data-breakdown-tooltip': breakdownLabels.positive, 'aria-label': breakdownLabels.positive },
                            text: this.view.getBreakdownValueText(breakdownValues.positive, true)
                        });
                        breakdown.createEl('span', { text: ' | ' });
                        breakdown.createEl('span', {
                            cls: 'progress-negative book-smith-stats-breakdown-value book-smith-stats-breakdown-negative',
                            attr: { 'data-breakdown-tooltip': breakdownLabels.negative, 'aria-label': breakdownLabels.negative },
                            text: this.view.getBreakdownValueText(breakdownValues.negative, false, true)
                        });
                    }
                    breakdown.createEl('span', { text: ')' });
                }

                const commentWrap = details.createDiv({ cls: 'book-smith-stats-comment-wrap' });
                const commentLabelText = this.view.statsPeriodMode === 'day'
                    ? i18n.t('DAY_COMMENT')
                    : `${this.view.getSelectedPeriodLabel(selectedDate)} notes`;
                const placeholderText = this.view.statsPeriodMode === 'day'
                    ? i18n.t('DAY_COMMENT_PLACEHOLDER')
                    : `Write a note for this ${this.view.statsPeriodMode}...`;

                commentWrap.createEl('label', { cls: 'book-smith-stats-comment-label', text: commentLabelText });
                const commentInput = commentWrap.createEl('textarea', {
                    cls: 'book-smith-stats-comment-input',
                    attr: { placeholder: placeholderText }
                });
                commentInput.value = selectedComment;

                const saveCommentBtn = commentWrap.createEl('button', {
                    cls: 'book-smith-stats-comment-save',
                    text: i18n.t('SAVE_DAY_COMMENT')
                });
                saveCommentBtn.addEventListener('click', async () => {
                    await this.view.saveSelectedPeriodComment(commentInput.value, anchorIso);
                });
            }
        public renderCalendar(container: HTMLElement) {
            const calendar = container.createDiv({ cls: 'book-smith-stats-calendar' });

            // The infinite-scroll list spans all history, so the month/year nav
            // has nothing to drive — omit it entirely rather than show dead buttons.
            if (!this.view.isInfiniteDailyList()) {
                const nav = calendar.createDiv({ cls: 'book-smith-stats-calendar-nav' });

                const prevButton = nav.createEl('button', { cls: 'book-smith-stats-nav-btn', text: i18n.t('PREVIOUS_MONTH') });
                prevButton.addEventListener('click', () => {
                    this.view.shiftViewPeriod(-1);
                    this.view.redrawStatisticsView();
                });

                this.view.renderMonthYearPicker(nav);

                const nextButton = nav.createEl('button', { cls: 'book-smith-stats-nav-btn', text: i18n.t('NEXT_MONTH') });
                nextButton.addEventListener('click', () => {
                    this.view.shiftViewPeriod(1);
                    this.view.redrawStatisticsView();
                });
            }

            this.view.renderCalendarBody(calendar);
        }
    constructor(private view: ToolView) {}



    public renderStatisticsView(container: HTMLElement) {
        container.empty();
        container.addClass('book-smith-stats-view');
        const statsView = container;

        const header = statsView.createDiv({ cls: 'book-smith-stats-header' });
        const backButton = header.createEl('button', { cls: 'book-smith-stats-back-btn' });
        setIcon(backButton, 'arrow-left');
        const backSpan = document.createElement('span');
        backSpan.textContent = ` ${i18n.t('BACK_TO_TOOLBOX')}`;
        backButton.appendChild(backSpan);
        backButton.addEventListener('click', () => {
            if (!this.view.normalView) return;
            this.view.normalView.empty();
            this.view.createNormalView(this.view.normalView);
        });

        const settingsButton = header.createEl('button', {
            cls: `book-smith-stats-settings-btn${this.view.statsSettingsOpen ? ' is-active' : ''}`,
            attr: { 'aria-label': i18n.t('DISPLAY_MODE') }
        });
        const settingsSpan = document.createElement('span');
        settingsSpan.textContent = '⚙';
        settingsButton.appendChild(settingsSpan);
        settingsButton.addEventListener('click', () => {
            const nextOpen = !this.view.statsSettingsOpen;
            this.view.statsSettingsOpen = nextOpen;
            if (nextOpen) {
                this.view.statsPeriodSettingsOpen = false;
            }
            this.view.redrawStatisticsView();
        });

        const periodButton = header.createEl('button', {
            cls: `book-smith-stats-period-btn${this.view.statsPeriodSettingsOpen ? ' is-active' : ''}`,
            attr: { 'aria-label': i18n.t('STATS_PERIOD') }
        });
        const periodSpan = document.createElement('span');
        periodSpan.textContent = '📅';
        periodButton.appendChild(periodSpan);
        periodButton.addEventListener('click', () => {
            const nextOpen = !this.view.statsPeriodSettingsOpen;
            this.view.statsPeriodSettingsOpen = nextOpen;
            if (nextOpen) {
                this.view.statsSettingsOpen = false;
            }
            this.view.redrawStatisticsView();
        });

        if (this.view.statsBooks.length === 0) {
            statsView.createEl('p', { cls: 'book-smith-stats-empty', text: i18n.t('NO_ACTIVE_BOOK') });
            return;
        }

        if (this.view.statsSettingsOpen) {
            this.view.renderStatsSettingsPanel(statsView);
        }
        if (this.view.statsPeriodSettingsOpen) {
            this.view.renderStatsPeriodPanel(statsView);
        }

        this.view.renderStatsSourceRow(statsView);
        this.renderCalendar(statsView);
        this.renderSelectedDayStats(statsView);
    }
}
