import { setIcon, Notice, TFolder } from 'obsidian';
import { i18n } from '../i18n/i18n';
import { NavigatorFolderModal } from '../modals/NavigatorFolderModal';
import type { ToolView } from './ToolsView';

export class ToolsViewNavigator {
    private view: ToolView;

    constructor(view: ToolView) {
        this.view = view;
    }

    public async enterNavigatorMode() {
        if (!this.view.normalView) return;
        this.view.isNavigatorMode = true;
        await this.loadNavigatorData();
        this.view.normalView.empty();
        this.renderNavigatorView(this.view.normalView);
    }

    private async loadNavigatorData() {
        const activeBookId = this.view.plugin.settings.lastBookId;
        this.view.navigatorBook = activeBookId
            ? await this.view.plugin.bookManager.getBookById(activeBookId)
            : null;

        const configuredPath = this.view.navigatorBook?.navigatorFolder?.trim();
        this.view.navigatorFolderPath = configuredPath ? configuredPath.replace(/^\/+/g, '').replace(/\/+$/g, '') : null;

        if (!this.view.navigatorFolderPath) {
            this.view.navigatorFiles = [];
            return;
        }

        const folder = this.view.app.vault.getAbstractFileByPath(this.view.navigatorFolderPath);
        if (!(folder instanceof TFolder)) {
            this.view.navigatorFiles = [];
            return;
        }

        const allowedExtensions = new Set(['md', 'pdf', 'txt', 'fountain']);
        this.view.navigatorFiles = this.view.app.vault.getFiles()
            .filter((file) => file.path.startsWith(`${this.view.navigatorFolderPath}/`))
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
            if (!this.view.normalView) return;
            this.view.isNavigatorMode = false;
            this.view.normalView.empty();
            this.view.createNormalView(this.view.normalView);
        });

        const refreshButton = header.createEl('button', {
            cls: 'book-smith-navigator-refresh-btn',
            attr: { 'aria-label': i18n.t('NAVIGATOR_REFRESH') }
        });
        setIcon(refreshButton, 'refresh-cw');
        refreshButton.addEventListener('click', async () => {
            await this.loadNavigatorData();
            this.view.redrawNavigatorView();
        });

        const titleRow = view.createDiv({ cls: 'book-smith-navigator-title-row' });
        const titleIcon = titleRow.createSpan({ cls: 'book-smith-navigator-title-icon' });
        setIcon(titleIcon, 'compass');
        titleRow.createSpan({ cls: 'book-smith-navigator-title', text: i18n.t('NAVIGATOR') });

        if (!this.view.navigatorBook) {
            view.createEl('p', { cls: 'book-smith-navigator-empty', text: i18n.t('NO_ACTIVE_BOOK') });
            return;
        }

        view.createEl('p', {
            cls: 'book-smith-navigator-project-label',
            text: `${i18n.t('SELECT_PROJECT')}: ${this.view.navigatorBook.basic.title}`
        });

        if (!this.view.navigatorFolderPath) {
            this.view.renderNavigatorSetup(view);
            return;
        }

        const folderRow = view.createDiv({ cls: 'book-smith-navigator-folder-row' });
        folderRow.createEl('span', {
            cls: 'book-smith-navigator-folder-path',
            text: this.view.navigatorFolderPath
        });
        const changeButton = folderRow.createEl('button', {
            cls: 'book-smith-navigator-change-folder-btn',
            text: i18n.t('SELECT_FOLDER')
        });
        changeButton.addEventListener('click', () => this.openNavigatorFolderPicker());

        const list = view.createDiv({ cls: 'book-smith-navigator-file-list' });
        if (this.view.navigatorFiles.length === 0) {
            list.createEl('p', { cls: 'book-smith-navigator-empty', text: i18n.t('NAVIGATOR_NO_FILES') });
            return;
        }

        this.view.navigatorFiles.forEach((file) => {
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
                text: file.path.slice(this.view.navigatorFolderPath!.length + 1)
            });

            row.addEventListener('click', async (evt: MouseEvent) => {
                evt.preventDefault();
                const openInNewTab = evt.ctrlKey || evt.metaKey;
                await this.view.app.workspace.getLeaf(openInNewTab).openFile(file);
            });

            const triggerHoverPreview = (evt: MouseEvent) => {
                const isMod = evt.ctrlKey || evt.metaKey;
                if (!isMod) {
                    this.view.navigatorHoverTriggeredPath = null;
                    return;
                }
                if (this.view.navigatorHoverTriggeredPath === file.path) return;

                const sourcePath = this.view.app.workspace.getActiveFile()?.path || '';
                (this.view.app.workspace as any).trigger('hover-link', {
                    event: evt,
                    source: 'book-smith-navigator',
                    hoverParent: this,
                    targetEl: row,
                    linktext: file.path,
                    sourcePath
                });
                this.view.navigatorHoverTriggeredPath = file.path;
            };

            row.addEventListener('mousemove', triggerHoverPreview);
            row.addEventListener('mouseenter', triggerHoverPreview);
            row.addEventListener('mouseleave', () => {
                this.view.navigatorHoverTriggeredPath = null;
            });
        });
    }

    private openNavigatorFolderPicker() {
        if (!this.view.navigatorBook) {
            new Notice(i18n.t('NO_ACTIVE_BOOK'));
            return;
        }

        new NavigatorFolderModal(this.view.app, async (selectedPath) => {
            if (!selectedPath) return;

            await this.view.plugin.bookManager.updateBook(this.view.navigatorBook!.basic.uuid, {
                navigatorFolder: selectedPath
            });
            new Notice(i18n.t('NAVIGATOR_FOLDER_SAVED'));

            await this.loadNavigatorData();
            this.view.redrawNavigatorView();
        }).open();
    }
}
