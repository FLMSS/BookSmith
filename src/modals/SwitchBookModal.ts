import { App, Modal, Setting } from 'obsidian';
import { Book } from '../types/book';
import { i18n } from '../i18n/i18n';
import { formatWordCount } from '../utils/wordCount';
import BookSmithPlugin from '../main';
import { NamePromptModal } from './NamePromptModal';
import { FolderSelectModal } from './FolderSelectModal';

export class SwitchBookModal extends Modal {
    constructor(
        app: App,
        private plugin: BookSmithPlugin,
        private books: Book[],
        private onSelect: (book: Book) => void
    ) {
        super(app);
    }

    private searchInput: HTMLInputElement;
    private bookList: HTMLDivElement;
    private expandedFolders: Set<string> = new Set();

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('book-smith-switch-book-modal');
        contentEl.createEl('h2', { text: i18n.t('SWITCH_BOOK_TITLE') });

        const toolbar = contentEl.createDiv({ cls: 'book-smith-folder-toolbar' });
        const newFolderBtn = toolbar.createEl('button', {
            cls: 'book-smith-folder-new-btn',
            text: 'New folder'
        });
        newFolderBtn.addEventListener('click', () => {
            new NamePromptModal(this.app, 'Folder name', async (result) => {
                const folder = (result || '').trim();
                if (!folder) return;
                this.plugin.sharedDataManager.addProjectFolder(folder);
                await this.plugin.sharedDataManager.save();
                this.renderBooks(this.filterBooks(this.books));
            }).open();
        });

        // 添加搜索框
        const searchContainer = contentEl.createDiv({ cls: 'book-smith-search-container' });
        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: i18n.t('SEARCH_BOOK_PLACEHOLDER'),
            cls: 'book-smith-search-input'
        });
        
        this.searchInput.addEventListener('input', () => {
            this.renderBooks(this.filterBooks(this.books));
        });

        // 添加分割线
        contentEl.createDiv({ cls: 'book-smith-switch-book-divider' });

        // 创建书籍列表容器
        this.bookList = contentEl.createDiv({ cls: 'book-smith-book-list' });
        this.initializeExpandedFolders();
        this.renderBooks(this.books);
    }

    private initializeExpandedFolders() {
        this.expandedFolders.clear();
        const folders = this.getAvailableFolders();
        folders.forEach((folder) => {
            if (this.plugin.sharedDataManager.isProjectFolderExpandedByDefault(folder)) {
                this.expandedFolders.add(folder);
            }
        });
    }

    private filterBooks(books: Book[]): Book[] {
        const searchTerm = this.searchInput.value.toLowerCase();
        if (!searchTerm) return books;

        const folderMap = this.getProjectFolderMap();
        return books.filter(book => 
            book.basic.title.toLowerCase().includes(searchTerm) ||
            (book.basic.subtitle?.toLowerCase().includes(searchTerm)) ||
            book.basic.author.some(author => author.toLowerCase().includes(searchTerm)) ||
            (book.basic.desc?.toLowerCase().includes(searchTerm)) ||
            (folderMap[book.basic.uuid] || '').toLowerCase().includes(searchTerm)
        );
    }

    private renderBooks(books: Book[]) {
        this.bookList.empty();

        if (books.length === 0) {
            this.bookList.createDiv({ text: i18n.t('NO_BOOKS_FOUND'), cls: 'book-smith-folder-empty' });
            return;
        }

        const grouped = new Map<string, Book[]>();
        const folderMap = this.getProjectFolderMap();
        this.getAvailableFolders().forEach((folder) => {
            grouped.set(folder, []);
        });
        books.forEach((book) => {
            const folder = folderMap[book.basic.uuid] || '';
            if (!grouped.has(folder)) grouped.set(folder, []);
            grouped.get(folder)!.push(book);
        });

        const searchTerm = this.searchInput.value.trim();
        const sortedFolders = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

        for (const folder of sortedFolders) {
            const items = grouped.get(folder)!;
            if (searchTerm) {
                this.expandedFolders.add(folder);
            }

            const section = this.bookList.createDiv({ cls: 'book-smith-folder-section' });
            const header = section.createDiv({ cls: 'book-smith-folder-header' });
            const isExpanded = this.expandedFolders.has(folder);
            const isPinned = this.plugin.sharedDataManager.isProjectFolderPinned(folder);
            const toggle = header.createEl('button', {
                cls: 'book-smith-folder-toggle',
                text: `${isExpanded ? '▾' : '▸'} ${folder || 'Root'}`
            });
            const pinButton = header.createEl('button', {
                cls: `book-smith-folder-pin${isPinned ? ' is-pinned' : ''}`,
                text: ''
            });
            pinButton.setAttribute('aria-label', isPinned ? 'Pinned default state' : 'Pin current state');
            pinButton.addEventListener('click', async (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (this.plugin.sharedDataManager.isProjectFolderPinned(folder)) {
                    this.plugin.sharedDataManager.clearProjectFolderExpandedByDefault(folder);
                } else {
                    this.plugin.sharedDataManager.setProjectFolderExpandedByDefault(folder, this.expandedFolders.has(folder));
                }
                await this.plugin.sharedDataManager.save();
                this.renderBooks(this.filterBooks(this.books));
            });

            const setDropActive = (isActive: boolean) => toggle.classList.toggle('is-drop-target', isActive);
            toggle.addEventListener('dragover', (evt: DragEvent) => {
                evt.preventDefault();
                setDropActive(true);
            });
            toggle.addEventListener('dragleave', () => setDropActive(false));
            toggle.addEventListener('drop', async (evt: DragEvent) => {
                evt.preventDefault();
                setDropActive(false);
                const bookId = evt.dataTransfer?.getData('text/book-id');
                if (!bookId) return;
                await this.assignBookToFolder(bookId, folder);
            });

            toggle.addEventListener('click', () => {
                if (this.expandedFolders.has(folder)) this.expandedFolders.delete(folder);
                else this.expandedFolders.add(folder);
                if (this.plugin.sharedDataManager.isProjectFolderPinned(folder)) {
                    this.plugin.sharedDataManager.setProjectFolderExpandedByDefault(folder, this.expandedFolders.has(folder));
                    void this.plugin.sharedDataManager.save();
                }
                this.renderBooks(this.filterBooks(this.books));
            });

            if (!this.expandedFolders.has(folder)) {
                continue;
            }

            for (const book of items) {
                const setting = new Setting(section)
                .setName(`${book.basic.title}${book.basic.subtitle ? ` - ${book.basic.subtitle}` : ''}`)
                .setDesc(
                    `${i18n.t('BOOK_AUTHOR_LABEL')}：${book.basic.author.join('、')}
                    \n | ${i18n.t('BOOK_PROGRESS_LABEL')}：${Math.round(book.stats.progress_by_chapter * 100)}% | ${i18n.t('BOOK_WORDCOUNT_LABEL')}：${formatWordCount(book.stats.target_total_words)}
                    \n | ${i18n.t('BOOK_LASTMOD_LABEL')}：${new Date(book.stats.last_modified).toLocaleString()}`
                )
                .addButton(btn => btn
                    .setButtonText(i18n.t('SELECT_BOOK'))
                    .setCta()
                    .onClick(() => {
                        this.onSelect(book);
                        this.close();
                    }))
                .addExtraButton(btn => btn
                    .setIcon('folder')
                    .setTooltip('Set folder')
                    .onClick(() => {
                        const currentFolder = folderMap[book.basic.uuid] || '';
                        new FolderSelectModal(
                            this.app,
                            this.getAvailableFolders().filter((folder) => !!folder),
                            currentFolder,
                            async (selectedFolder) => {
                                await this.assignBookToFolder(book.basic.uuid, selectedFolder);
                            }
                        ).open();
                    }));

                setting.settingEl.draggable = true;
                setting.settingEl.addEventListener('dragstart', (evt: DragEvent) => {
                    evt.dataTransfer?.setData('text/book-id', book.basic.uuid);
                    setting.settingEl.classList.add('book-smith-book-dragging');
                });
                setting.settingEl.addEventListener('dragend', () => {
                    setting.settingEl.classList.remove('book-smith-book-dragging');
                });
            }
        }
    }

    private getProjectFolderMap(): Record<string, string> {
        const map: Record<string, string> = {};
        this.books.forEach((book) => {
            map[book.basic.uuid] = (book.basic.projectFolder || '').trim();
        });
        return map;
    }

    private getAvailableFolders(): string[] {
        const folders = new Set<string>(['', ...this.plugin.sharedDataManager.getProjectFolders()]);
        this.books.forEach((book) => {
            const folder = (book.basic.projectFolder || '').trim();
            if (folder) folders.add(folder);
        });
        return Array.from(folders).sort((a, b) => a.localeCompare(b));
    }

    private async assignBookToFolder(bookId: string, folder: string): Promise<void> {
        await this.plugin.bookManager.setBookProjectFolder(bookId, folder);
        this.plugin.sharedDataManager.addProjectFolder(folder);
        await this.plugin.sharedDataManager.save();
        this.books = await this.plugin.bookManager.getAllBooks();
        this.renderBooks(this.filterBooks(this.books));
    }
}