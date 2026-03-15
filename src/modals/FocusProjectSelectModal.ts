import { App, Modal } from 'obsidian';
import BookSmithPlugin from '../main';
import { i18n } from '../i18n/i18n';

export class FocusProjectSelectModal extends Modal {
    constructor(
        app: App,
        private plugin: BookSmithPlugin,
        private selectedBookId: string | null,
        private onSelect: (bookId: string | null) => void
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('book-smith-focus-project-modal');

        const books = await this.plugin.bookManager.getAllBooks();

        contentEl.createEl('h2', { text: i18n.t('FOCUS_SELECT_PROJECT') });

        const list = contentEl.createDiv({ cls: 'book-smith-focus-project-list' });

        const renderOption = (id: string | null, label: string) => {
            const row = list.createEl('button', {
                cls: `book-smith-focus-project-row${this.selectedBookId === id ? ' is-selected' : ''}`,
                text: label
            });
            row.addEventListener('click', () => {
                this.onSelect(id);
                this.close();
            });
        };

        renderOption(null, i18n.t('FOCUS_UNASSIGNED'));
        books.forEach((book) => {
            renderOption(book.basic.uuid, book.basic.title);
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
