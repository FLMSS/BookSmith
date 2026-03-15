import { App, Modal, Setting, Notice } from 'obsidian';
import { Book, BookBasicInfo } from '../types/book';
import { BookManager } from '../services/BookManager';
import BookSmithPlugin from '../main';
import { i18n } from '../i18n/i18n';
import { parseWordCountInput, formatWordCount } from '../utils/wordCount';
import { FolderSelectModal } from './FolderSelectModal';
import { NamePromptModal } from './NamePromptModal';

export class EditBookModal extends Modal {
    private bookInfo: Partial<BookBasicInfo>;
    private targetTotalWords: number;
    private selectedFolder: string;

    constructor(
        app: App,
        private book: Book,
        private bookManager: BookManager,
        private plugin: BookSmithPlugin,
        private onSaved?: (result: { type: 'edited', bookId: string }) => void
    ) {
        super(app);
        this.bookInfo = { ...book.basic };
        this.targetTotalWords = book.stats.target_total_words || 10000;
        this.selectedFolder = book.basic.projectFolder || '';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('book-smith-edit-book-modal');
        contentEl.createEl('h2', { text: i18n.t('EDIT_BOOK_TITLE') });

        new Setting(contentEl)
            .setName(i18n.t('COVER'))
            .setDesc(i18n.t('COVER_DESC'))
            .addButton(button => button
                .setButtonText(this.bookInfo.cover ? i18n.t('CHANGE_COVER') : i18n.t('SELECT_COVER'))
                .onClick(async () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async () => {
                        const file = input.files?.[0];
                        if (file) {
                            try {
                                const coversPath = `${this.plugin.settings.defaultBookPath}/covers`;
                                if (!await this.app.vault.adapter.exists(coversPath)) {
                                    await this.app.vault.adapter.mkdir(coversPath);
                                }

                                const fileName = `cover-${Date.now()}.${file.name.split('.').pop()}`;
                                const coverPath = `${coversPath}/${fileName}`;
                                await this.app.vault.adapter.writeBinary(coverPath, await file.arrayBuffer());
                                this.bookInfo.cover = coverPath;
                                new Notice(i18n.t('COVER_UPDATE_SUCCESS'));
                            } catch (error) {
                                new Notice(i18n.t('COVER_UPDATE_FAILED') + error.message);
                            }
                        }
                    };
                    input.click();
                }));

        new Setting(contentEl)
            .setName(i18n.t('BOOK_TITLE'))
            .setDesc(i18n.t('BOOK_TITLE_DESC'))
            .addText(text => text
                .setValue(this.bookInfo.title || '')
                .onChange(value => this.bookInfo.title = value));

        new Setting(contentEl)
            .setName(i18n.t('SUBTITLE'))
            .setDesc(i18n.t('SUBTITLE_DESC'))
            .addText(text => text
                .setValue(this.bookInfo.subtitle || '')
                .onChange(value => this.bookInfo.subtitle = value));

        let targetMode: 'words' | 'pages' = 'words';
        let wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
        let targetInputEl: HTMLInputElement | null = null;
        let wordsPerPageSettingEl: HTMLElement | null = null;
        let targetValueSetting: Setting | null = null;
        const getTargetCountLabel = () => targetMode === 'pages'
            ? i18n.t('TARGET_PAGE_COUNT')
            : i18n.t('TARGET_WORD_COUNT');
        const syncTargetInput = () => {
            if (!targetInputEl) return;
            targetValueSetting?.setName(getTargetCountLabel());

            if (targetMode === 'pages') {
                targetInputEl.value = this.formatPages(this.targetTotalWords, wordsPerPage);
                targetInputEl.placeholder = '300';
            } else {
                targetInputEl.value = formatWordCount(this.targetTotalWords);
                targetInputEl.placeholder = i18n.t('TARGET_WORDS_PLACEHOLDER');
            }
        };
        const syncWordsPerPageVisibility = () => {
            if (!wordsPerPageSettingEl) return;
            wordsPerPageSettingEl.style.display = targetMode === 'pages' ? '' : 'none';
        };

        new Setting(contentEl)
            .setName(i18n.t('TARGET_UNIT'))
            .setDesc(i18n.t('TARGET_UNIT_DESC'))
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('words', i18n.t('WORDS_MODE'))
                    .addOption('pages', i18n.t('PAGES_MODE'))
                    .setValue(targetMode)
                    .onChange((value) => {
                        targetMode = value === 'pages' ? 'pages' : 'words';
                        syncTargetInput();
                        syncWordsPerPageVisibility();
                    });
            });

        const wordsPerPageSetting = new Setting(contentEl)
            .setName(i18n.t('WORDS_PER_PAGE'))
            .setDesc(i18n.t('TARGET_UNIT_PAGES_DESC'))
            .addText((text) => {
                text
                    .setPlaceholder('250')
                    .setValue(String(wordsPerPage))
                    .onChange((value) => {
                        const parsed = Number(value);
                        if (!Number.isFinite(parsed) || parsed <= 0) return;
                        wordsPerPage = parsed;
                        this.plugin.settings.stats = {
                            displayMode: this.plugin.settings.stats?.displayMode || 'words',
                            writingDisplayMode: this.plugin.settings.stats?.writingDisplayMode || 'new-material-net',
                            wordsPerPage: parsed
                        };
                        void this.plugin.saveSettings();
                        syncTargetInput();
                    });

                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.inputEl.step = '1';
            });
        wordsPerPageSettingEl = wordsPerPageSetting.settingEl;
        syncWordsPerPageVisibility();

        targetValueSetting = new Setting(contentEl)
            .setName(getTargetCountLabel())
            .setDesc(i18n.t('TARGET_VALUE_DESC'))
            .addText(text => {
                targetInputEl = text.inputEl;
                text
                    .setPlaceholder(i18n.t('TARGET_WORDS_PLACEHOLDER'))
                    .setValue(formatWordCount(this.targetTotalWords))
                    .onChange(value => {
                    if (targetMode === 'pages') {
                        const parsedPages = Number(value);
                        if (!Number.isFinite(parsedPages) || parsedPages < 0 || wordsPerPage <= 0) return;
                        this.targetTotalWords = Math.round(parsedPages * wordsPerPage);
                        return;
                    }

                    this.targetTotalWords = parseWordCountInput(value, 10000);
                });
            });

        syncTargetInput();

        let folderButtonRef: any = null;
        const updateFolderLabel = () => {
            if (!folderButtonRef) return;
            folderButtonRef.setButtonText(this.selectedFolder || 'Root');
        };

        new Setting(contentEl)
            .setName('Folder')
            .setDesc('Internal Book Smith folder (does not move Obsidian files)')
            .addButton(btn => {
                folderButtonRef = btn;
                updateFolderLabel();
                btn.onClick(() => {
                    new FolderSelectModal(
                        this.app,
                        this.plugin.sharedDataManager.getProjectFolders(),
                        this.selectedFolder,
                        (folder) => {
                            this.selectedFolder = folder;
                            updateFolderLabel();
                        }
                    ).open();
                });
            })
            .addExtraButton(btn => btn
                .setIcon('plus')
                .setTooltip('New folder')
                .onClick(() => {
                    new NamePromptModal(this.app, 'Folder name', async (result) => {
                        const folder = (result || '').trim();
                        if (!folder) return;
                        this.plugin.sharedDataManager.addProjectFolder(folder);
                        await this.plugin.sharedDataManager.save();
                        this.selectedFolder = folder;
                        updateFolderLabel();
                    }).open();
                }));

        new Setting(contentEl)
            .setName(i18n.t('AUTHOR'))
            .setDesc(i18n.t('AUTHOR_DESC'))
            .addText(text => text
                .setValue(this.bookInfo.author?.join(',') || '')
                .onChange(value => this.bookInfo.author = value ? value.split(',') : []));

        new Setting(contentEl)
            .setName(i18n.t('DESCRIPTION'))
            .setDesc(i18n.t('DESCRIPTION_DESC'))
            .addTextArea(text => text
                .setValue(this.bookInfo.desc || '')
                .onChange(value => this.bookInfo.desc = value));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(i18n.t('SAVE'))
                .setCta()
                .onClick(async () => {
                    if (!this.validateBookInfo()) {
                        new Notice(i18n.t('REQUIRED_FIELDS'));
                        return;
                    }
                    try {
                        await this.bookManager.updateBook(this.book.basic.uuid, {
                            basic: this.bookInfo as BookBasicInfo,
                            stats: {
                                ...this.book.stats,
                                target_total_words: this.targetTotalWords
                            }
                        });

                        await this.bookManager.setBookProjectFolder(this.book.basic.uuid, this.selectedFolder);
                        this.plugin.sharedDataManager.addProjectFolder(this.selectedFolder);
                        await this.plugin.sharedDataManager.save();

                        new Notice(i18n.t('SAVE_SUCCESS'));
                        this.close();
                        this.onSaved?.({ type: 'edited', bookId: this.book.basic.uuid });
                    } catch (error) {
                        new Notice(i18n.t('SAVE_FAILED') + error.message);
                    }
                }));
    }

    private validateBookInfo(): boolean {
        return !!(this.bookInfo.title && this.bookInfo.author?.length);
    }

    private formatPages(words: number, wordsPerPage: number): string {
        const pages = words / wordsPerPage;
        if (Number.isInteger(pages)) return String(pages);
        return pages.toFixed(1).replace(/\.0$/, '');
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}