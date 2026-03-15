import { App, Modal } from 'obsidian';

export class FolderSelectModal extends Modal {
    constructor(
        app: App,
        private folders: string[],
        private currentFolder: string,
        private onSelect: (folder: string) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('book-smith-folder-select-modal');
        contentEl.createEl('h2', { text: 'Select folder' });

        const list = contentEl.createDiv({ cls: 'book-smith-folder-select-list' });

        const rootRow = list.createEl('button', {
            cls: `book-smith-folder-select-option${!this.currentFolder ? ' is-active' : ''}`,
            text: 'Root'
        });
        rootRow.addEventListener('click', () => {
            this.onSelect('');
            this.close();
        });

        const sortedFolders = Array.from(new Set(this.folders.filter(Boolean))).sort((a, b) => a.localeCompare(b));
        sortedFolders.forEach((folder) => {
            const row = list.createEl('button', {
                cls: `book-smith-folder-select-option${this.currentFolder === folder ? ' is-active' : ''}`,
                text: folder
            });
            row.addEventListener('click', () => {
                this.onSelect(folder);
                this.close();
            });
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
