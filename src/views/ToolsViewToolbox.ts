import { setIcon } from 'obsidian';
import { i18n } from '../i18n/i18n';
import type { ToolView } from './ToolsView';

export class ToolsViewToolbox {
    private view: ToolView;

    constructor(view: ToolView) {
        this.view = view;
    }

    render(container: HTMLElement) {
        this.createPrimaryActions(container);
    }

    private createPrimaryActions(container: HTMLElement) {
        const actions = container.createDiv({ cls: 'book-smith-tool-group' });

        const focusItem = this.createToolItem(actions, 'target', i18n.t('FOCUS_MODE'));
        focusItem.addEventListener('click', () => this.view.enterFocusMode());

        const navigatorItem = this.createToolItem(actions, 'compass', i18n.t('NAVIGATOR'));
        navigatorItem.addEventListener('click', () => void this.view.enterNavigatorMode());

        const sceneNotesItem = this.createToolItem(actions, 'flag', 'Scene Notes');
        sceneNotesItem.addEventListener('click', () => void this.view.enterSceneNotesMode());

        const statsItem = this.createToolItem(actions, 'calendar-days', i18n.t('STATS'));
        statsItem.addEventListener('click', () => void this.view.enterStatisticsMode());

        const exportItem = this.createToolItem(actions, 'book', i18n.t('EXPORT'));
        exportItem.addEventListener('click', () => this.view.enterTypographyMode());
    }

    private createToolItem(container: HTMLElement, icon: string, text: string) {
        const item = container.createDiv({ cls: 'book-smith-tool-item' });
        const iconSpan = item.createSpan({ cls: 'book-smith-tool-icon' });
        setIcon(iconSpan, icon);
        item.createSpan({ text });
        return item;
    }
}
