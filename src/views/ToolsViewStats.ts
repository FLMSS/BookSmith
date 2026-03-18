import { ToolView } from './ToolsView';
import { setIcon } from 'obsidian';
import { i18n } from '../i18n/i18n';

export class ToolsViewStats {
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
        this.view.renderCalendar(statsView);
        this.view.renderSelectedDayStats(statsView);
    }
}
