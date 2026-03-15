import { App, Modal, Notice, ButtonComponent, Setting } from 'obsidian';
import { ExportModal } from './ExportModal';
import { BookRenderService } from '../services/BookRenderService';
import { i18n } from '../i18n/i18n';
import { Book } from '../types/book';
import BookSmithPlugin from '../main';
import { formatWordCount } from '../utils/wordCount';
import { NamePromptModal } from './NamePromptModal';
import { FolderSelectModal } from './FolderSelectModal';

export class BookSelectionModal extends Modal {
    private static readonly MODAL_SHELL_CLASS = 'book-smith-switch-book-modal-shell';
    private static readonly MODAL_INIT_CLASS = 'book-smith-switch-book-modal-initializing';
    private selectedBook: Book | null = null;
    private books: Book[] = [];
    private bookListContainer: HTMLElement;
    private searchInput: HTMLInputElement;
    private expandedFolders: Set<string> = new Set();
    constructor(
        app: App,
        private plugin: BookSmithPlugin
    ) {
        super(app);
        this.modalEl.addClass(BookSelectionModal.MODAL_SHELL_CLASS);
    }

    async onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass(BookSelectionModal.MODAL_INIT_CLASS);
        contentEl.empty();
        contentEl.addClass('book-smith-switch-book-modal');

        // 设置模态框标题
        contentEl.createEl('h2', { text: i18n.t('SELECT_BOOKS_TO_EXPORT') });

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
                this.renderBookList();
            }).open();
        });

        const searchContainer = contentEl.createDiv({ cls: 'book-smith-search-container' });
        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: i18n.t('SEARCH_BOOK_PLACEHOLDER'),
            cls: 'book-smith-search-input'
        });
        this.searchInput.addEventListener('input', () => this.renderBookList());

        contentEl.createDiv({ cls: 'book-smith-switch-book-divider' });

        // 创建书籍列表容器
        this.bookListContainer = contentEl.createDiv({ cls: 'book-smith-book-list' });
        this.bookListContainer.createDiv({
            cls: 'book-selection-loading',
            text: 'Loading books...'
        });

        // 加载书籍列表
        await this.loadBooks();
        this.initializeExpandedFolders();
        this.ensureSelectedBook();
        this.renderBookList();

        // 创建按钮容器
        const buttonContainer = contentEl.createDiv({ cls: 'book-selection-buttons' });

        // 取消按钮
        new ButtonComponent(buttonContainer)
            .setButtonText(i18n.t('CANCEL'))
            .onClick(() => {
                this.close();
            });

        // 导出按钮
        new ButtonComponent(buttonContainer)
            .setButtonText(i18n.t('EXPORT_SETTINGS'))
            .setCta()
            .onClick(() => {
                this.handleExport();
            });

        window.requestAnimationFrame(() => {
            this.modalEl.removeClass(BookSelectionModal.MODAL_INIT_CLASS);
        });
    }

    private async loadBooks() {
        try {
            this.books = await this.plugin.bookManager.getAllBooks();
        } catch (error) {
            console.error('Failed to load books:', error);
            new Notice(i18n.t('LOAD_BOOKS_FAILED'));
            this.books = [];
        }
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

    private ensureSelectedBook() {
        if (!this.selectedBook) return;
        if (this.books.some((book) => book.basic.uuid === this.selectedBook?.basic.uuid)) {
            return;
        }
        this.selectedBook = null;
    }

    private filterBooks(books: Book[]): Book[] {
        const searchTerm = (this.searchInput?.value || '').toLowerCase().trim();
        if (!searchTerm) return books;

        const folderMap = this.getProjectFolderMap();
        return books.filter((book) =>
            book.basic.title.toLowerCase().includes(searchTerm) ||
            (book.basic.subtitle?.toLowerCase().includes(searchTerm) ?? false) ||
            book.basic.author.some((author) => author.toLowerCase().includes(searchTerm)) ||
            (book.basic.desc?.toLowerCase().includes(searchTerm) ?? false) ||
            (folderMap[book.basic.uuid] || '').toLowerCase().includes(searchTerm)
        );
    }

    private renderBookList() {
        this.bookListContainer.empty();

        const filteredBooks = this.filterBooks(this.books);
        this.ensureSelectedBook();

        if (filteredBooks.length === 0) {
            const emptyMessage = this.bookListContainer.createDiv({ cls: 'book-selection-empty' });
            emptyMessage.createEl('p', { text: i18n.t('NO_BOOKS_FOUND') });
            emptyMessage.createEl('p', {
                text: i18n.t('CREATE_BOOK_FIRST_TO_EXPORT'),
                cls: 'book-selection-hint'
            });
            return;
        }

        const grouped = new Map<string, Book[]>();
        const folderMap = this.getProjectFolderMap();
        this.getAvailableFolders().forEach((folder) => grouped.set(folder, []));
        filteredBooks.forEach((book) => {
            const folder = folderMap[book.basic.uuid] || '';
            if (!grouped.has(folder)) grouped.set(folder, []);
            grouped.get(folder)!.push(book);
        });

        const searchTerm = (this.searchInput?.value || '').trim();
        const sortedFolders = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

        for (const folder of sortedFolders) {
            const items = grouped.get(folder)!;
            if (searchTerm) this.expandedFolders.add(folder);

            const section = this.bookListContainer.createDiv({ cls: 'book-smith-folder-section' });
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
                this.renderBookList();
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
                this.renderBookList();
            });

            if (!this.expandedFolders.has(folder)) {
                continue;
            }

            for (const book of items) {
                const isSelected = this.selectedBook?.basic.uuid === book.basic.uuid;
                const setting = new Setting(section)
                    .setName(`${book.basic.title}${book.basic.subtitle ? ` - ${book.basic.subtitle}` : ''}`)
                    .setDesc(
                        `${i18n.t('BOOK_AUTHOR_LABEL')}：${book.basic.author.join('、')}
                    \n | ${i18n.t('BOOK_WORDCOUNT_LABEL')}：${formatWordCount(book.stats?.total_words || 0)} | ${i18n.t('CREATED_DATE')}：${new Date(book.basic.created_at).toLocaleDateString()}`
                    )
                    .addButton((btn) => btn
                        .setButtonText(isSelected ? 'Selected' : i18n.t('SELECT_BOOK'))
                        .setCta()
                        .onClick(() => {
                            this.selectedBook = book;
                            this.renderBookList();
                        }))
                    .addExtraButton((btn) => btn
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

                if (isSelected) {
                    setting.settingEl.addClass('book-selection-item-selected');
                }

                setting.settingEl.addEventListener('click', () => {
                    this.selectedBook = book;
                    this.renderBookList();
                });

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
        await this.loadBooks();
        this.renderBookList();
    }

    private async handleExport() {
        if (!this.selectedBook) {
            new Notice(i18n.t('SELECT_BOOK_FIRST_TO_EXPORT'));
            return;
        }

        try {
            this.close();
            const bookRenderService = new BookRenderService(this.app);
            // 创建并打开导出模态框 - 修正参数顺序
            const exportModal = new ExportModal(
                this.app,
                this.plugin,
                bookRenderService,
                this.selectedBook
            );
            exportModal.open();
        } catch (error) {
            console.error('Failed to open export modal:', error);
            new Notice(i18n.t('OPEN_EXPORT_FAILED'));
        }
    }

    // 移除 addStyles 方法，因为样式已经移到独立的CSS文件中

    onClose() {
        this.modalEl.removeClass(BookSelectionModal.MODAL_INIT_CLASS);
        this.modalEl.removeClass(BookSelectionModal.MODAL_SHELL_CLASS);
        const { contentEl } = this;
        contentEl.empty();
    }
}