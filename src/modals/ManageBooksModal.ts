import { App, Modal, Setting, Notice, TFolder } from 'obsidian';
import { EditBookModal } from './EditBookModal';
import { ConfirmModal } from './ConfirmModal';
import { UnimportedBooksModal } from './UnimportedBooksModal'; // 添加导入
import { NamePromptModal } from './NamePromptModal';
import { FolderSelectModal } from './FolderSelectModal';
import BookSmithPlugin from '../main';
import { Book } from '../types/book';
import { i18n } from '../i18n/i18n';
import { formatWordCount } from '../utils/wordCount';

export class ManageBooksModal extends Modal {
    constructor(
        app: App,
        private plugin: BookSmithPlugin,
        private onBookChange?: (result: { type: 'deleted' | 'edited' | 'imported', bookId: string }) => void
    ) {
        super(app);
    }

    private searchInput: HTMLInputElement;
    private bookList: HTMLDivElement;
    private books: Book[] = [];
    private expandedFolders: Set<string> = new Set();

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('book-smith-manage-books-modal');
        contentEl.createEl('h2', { text: i18n.t('MANAGE_BOOKS_TITLE') });

        // 添加搜索框和导入按钮的容器
        const topContainer = contentEl.createDiv({ cls: 'book-smith-manage-top-container' });

        // 添加搜索框
        const searchContainer = topContainer.createDiv({ cls: 'book-smith-manage-search-container' });
        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: i18n.t('SEARCH_BOOKS_PLACEHOLDER'),
            cls: 'book-smith-manage-search-input'
        });
        this.searchInput.addEventListener('input', () => {
            this.renderBooks(this.filterBooks(this.books));
        });

        // 添加导入按钮
        const actionsWrap = topContainer.createDiv({ cls: 'book-smith-manage-actions' });
        const importButton = actionsWrap.createEl('button', {
            text: i18n.t('IMPORT_BOOK'),
            cls: 'book-smith-import-button'
        });

        const newFolderButton = actionsWrap.createEl('button', {
            text: 'New folder',
            cls: 'book-smith-import-button'
        });
        newFolderButton.addEventListener('click', () => {
            new NamePromptModal(this.app, 'Folder name', async (result) => {
                const folder = (result || '').trim();
                if (!folder) return;
                this.plugin.sharedDataManager.addProjectFolder(folder);
                await this.plugin.sharedDataManager.save();
                this.renderBooks(this.filterBooks(this.books));
            }).open();
        });

        importButton.addEventListener('click', () => {
            this.importBook();
        });

        // 添加分割线
        contentEl.createDiv({ cls: 'book-smith-manage-divider' });

        // 创建书籍列表容器
        this.bookList = contentEl.createDiv({ cls: 'book-smith-manage-book-list' });

        // 加载并渲染书籍
        this.books = await this.plugin.bookManager.getAllBooks();
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
            this.bookList.createDiv({ text: 'No projects found', cls: 'book-smith-folder-empty' });
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
                const bookContainer = section.createDiv({ cls: 'book-smith-book-container' });
                bookContainer.draggable = true;
                bookContainer.addEventListener('dragstart', (evt: DragEvent) => {
                    evt.dataTransfer?.setData('text/book-id', book.basic.uuid);
                    bookContainer.classList.add('book-smith-book-dragging');
                });
                bookContainer.addEventListener('dragend', () => {
                    bookContainer.classList.remove('book-smith-book-dragging');
                });

            // 添加封面
            const coverContainer = bookContainer.createDiv({ cls: 'book-smith-book-cover' });
            if (book.basic.cover) {
                coverContainer.createEl('img', {
                    attr: {
                        src: this.app.vault.adapter.getResourcePath(book.basic.cover),
                        alt: book.basic.title
                    }
                });
            }

            const setting = new Setting(bookContainer)
                .setName(createFragment(el => {
                    el.createEl('span', { text: `${book.basic.title}` });
                    if (book.basic.subtitle) {
                        el.createEl('span', {
                            text: book.basic.subtitle,
                            cls: 'subtitle'
                        });
                    }
                }))
                .setDesc(
                    `${i18n.t('BOOK_AUTHOR_PREFIX')}${book.basic.author.join('、')}
                    ${book.basic.desc ? `${i18n.t('BOOK_DESC_PREFIX')}${book.basic.desc}` : ''}
                    ${i18n.t('BOOK_PROGRESS_PREFIX')}${formatWordCount(book.stats.total_words)}${book.stats.target_total_words
                        ? ` / ${formatWordCount(book.stats.target_total_words)}`
                        : ' / 0'
                    }`
                );

            setting.addButton(btn => btn
                .setButtonText(i18n.t('DELETE_BOOK'))
                .setWarning()
                .onClick(() => {
                    new ConfirmModal(
                        this.app,
                        i18n.t('DELETE_BOOK_TITLE'),
                        i18n.t('DELETE_BOOK_DESC', { title: book.basic.title }),
                        async () => {
                            try {
                                await this.plugin.bookManager.deleteBook(book.basic.uuid);
                                new Notice(i18n.t('DELETE_SUCCESS'));
                                this.onBookChange?.({ type: 'deleted', bookId: book.basic.uuid });
                                this.books = await this.plugin.bookManager.getAllBooks();
                                this.renderBooks(this.filterBooks(this.books));
                            } catch (error) {
                                new Notice(i18n.t('DELETE_FAILED') + error.message);
                            }
                        }
                    ).open();
                })).addButton(btn => btn
                    .setButtonText(i18n.t('EDIT_BOOK'))
                    .onClick(() => {
                        new EditBookModal(
                            this.app,
                            book,
                            this.plugin.bookManager,
                            this.plugin,
                            () => {
                                void (async () => {
                                    this.books = await this.plugin.bookManager.getAllBooks();
                                    this.renderBooks(this.filterBooks(this.books));
                                    this.onBookChange?.({ type: 'edited', bookId: book.basic.uuid });
                                })();
                            }
                        ).open();
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

    // 导入书籍方法
    private async importBook() {
        try {
            // 获取书籍根目录下的所有文件夹
            const booksPath = this.plugin.settings.defaultBookPath;
            const rootFolder = this.app.vault.getAbstractFileByPath(booksPath);

            if (!(rootFolder instanceof TFolder)) {
                new Notice(i18n.t('BOOKS_ROOT_NOT_FOUND'));
                return;
            }
            
            // 筛选出没有配置文件的文件夹，并跳过 covers 文件夹
            const unimportedBooks: string[] = [];

            for (const child of rootFolder.children) {
                if (child instanceof TFolder && child.name !== 'covers') {
                    // 检查是否已经有配置文件
                    const configPath = `${child.path}/book-config.json`;
                    const configFile = this.app.vault.getAbstractFileByPath(configPath);
                    
                    if (!configFile) {
                        unimportedBooks.push(child.name);
                    }
                }
            }
            if (unimportedBooks.length === 0) {
                new Notice(i18n.t('NO_UNIMPORTED_BOOKS'));
                return;
            }

            // 打开选择对话框
            new UnimportedBooksModal(
                this.app,
                unimportedBooks,
                this.plugin.settings.defaultBookPath,
                async (selectedFolder) => {
                    if (selectedFolder) {
                        await this.createBookConfig(selectedFolder);
                    }
                }
            ).open();

        } catch (error) {
            new Notice(i18n.t('DETECT_UNIMPORTED_FAILED') + error.message);
        }
    }

    // 创建书籍配置文件
    // 重构后的 createBookConfig 方法
    private async createBookConfig(folderName: string) {
        try {
            // 使用 BookManager 的导入方法
            const newBook = await this.plugin.bookManager.importBookFromFolder(folderName);

            // 刷新书籍列表
            this.books = await this.plugin.bookManager.getAllBooks();
            this.renderBooks(this.filterBooks(this.books));

            // 通知回调
            this.onBookChange?.({
                type: 'imported',
                bookId: newBook.basic.uuid
            });

            new Notice(i18n.t('IMPORT_SUCCESS', { title: newBook.basic.title }));

        } catch (error) {
            new Notice(i18n.t('IMPORT_FAILED') + error.message);
        }
    }
}

