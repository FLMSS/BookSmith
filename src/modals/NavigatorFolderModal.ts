import { App, Modal, Setting, TFolder, setIcon } from 'obsidian';
import { i18n } from '../i18n/i18n';

export class NavigatorFolderModal extends Modal {
    private folders: TFolder[] = [];
    private selectedPath: string | null = null;
    private listEl: HTMLElement | null = null;

    constructor(
        app: App,
        private onSelect: (folderPath: string | null) => void,
        private currentPath: string | null = null
    ) {
        super(app);
        this.selectedPath = currentPath;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('book-smith-navigator-folder-modal');

        contentEl.createEl('h2', { text: i18n.t('NAVIGATOR_SELECT_FOLDER') });

        // Show which folder this project is currently linked to.
        const currentRow = contentEl.createDiv({ cls: 'book-smith-navigator-folder-current' });
        const currentIcon = currentRow.createSpan({ cls: 'book-smith-navigator-folder-current-icon' });
        setIcon(currentIcon, 'link');
        currentRow.createSpan({
            cls: 'book-smith-navigator-folder-current-path',
            text: this.currentPath
                ? this.currentPath
                : i18n.t('NAVIGATOR_NOT_SET_TITLE')
        });

        const search = contentEl.createEl('input', {
            cls: 'book-smith-navigator-folder-search',
            attr: {
                type: 'text',
                placeholder: i18n.t('NAVIGATOR_FOLDER_SEARCH_PLACEHOLDER')
            }
        });

        this.folders = this.app.vault
            .getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder)
            .filter((folder) => folder.path !== '/' && folder.path.trim().length > 0)
            .sort((a, b) => a.path.localeCompare(b.path));

        this.listEl = contentEl.createDiv({ cls: 'book-smith-navigator-folder-list' });

        const render = (query: string) => {
            if (!this.listEl) return;
            this.listEl.empty();

            const normalized = query.trim().toLowerCase();
            const matched = normalized.length > 0
                ? this.folders.filter((folder) => folder.path.toLowerCase().includes(normalized))
                : this.folders;

            if (matched.length === 0) {
                this.listEl.createEl('p', {
                    cls: 'book-smith-navigator-folder-empty',
                    text: i18n.t('NAVIGATOR_NO_MATCHING_FOLDERS')
                });
                return;
            }

            matched.forEach((folder) => {
                const item = this.listEl!.createDiv({ cls: 'book-smith-navigator-folder-item' });
                if (this.selectedPath === folder.path) {
                    item.addClass('is-selected');
                }

                const icon = item.createSpan({ cls: 'book-smith-navigator-folder-item-icon' });
                setIcon(icon, 'folder');
                item.createSpan({ text: folder.path, cls: 'book-smith-navigator-folder-item-path' });

                item.addEventListener('click', () => {
                    this.selectedPath = folder.path;
                    render(search.value);
                });

                item.addEventListener('dblclick', () => {
                    this.onSelect(folder.path);
                    this.close();
                });
            });
        };

        search.addEventListener('input', () => render(search.value));
        render('');

        const actionRow = contentEl.createDiv({ cls: 'book-smith-navigator-folder-actions' });

        new Setting(actionRow)
            .addButton((button) => button
                .setButtonText(i18n.t('CANCEL'))
                .onClick(() => {
                    this.onSelect(null);
                    this.close();
                }))
            .addButton((button) => button
                .setButtonText(i18n.t('SELECT_FOLDER'))
                .setCta()
                .onClick(() => {
                    this.onSelect(this.selectedPath);
                    this.close();
                }));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
