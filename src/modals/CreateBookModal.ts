import { App, Modal, Setting, Notice } from 'obsidian';
import { BookBasicInfo, Book } from '../types/book';
import BookSmithPlugin from '../main';
import { TemplateManager } from '../services/TemplateManager';
import { i18n } from '../i18n/i18n';
import { parseWordCountInput, formatWordCount } from '../utils/wordCount';
import { FolderSelectModal } from './FolderSelectModal';
import { NamePromptModal } from './NamePromptModal';

export class CreateBookModal extends Modal {
    private bookInfo: Partial<BookBasicInfo> = {
        author: this.plugin.settings.defaultAuthor ? [this.plugin.settings.defaultAuthor] : []
    };
    private selectedTemplate: string = 'screenplay';
    private targetTotalWords: number = 10000;  // 默认1万字
    private selectedFolder: string = '';
    private dailyGoalWords: number = 0;
    private dailyGoalInputMode: 'words' | 'pages' = 'words';

    constructor(
        app: App, 
        private plugin: BookSmithPlugin,
        private onBookCreated?: (book: Book) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('book-smith-create-book-modal');
        contentEl.createEl('h2', { text: i18n.t('CREATE_BOOK_TITLE') });

        // 添加模板选择
        new Setting(contentEl)
            .setName(i18n.t('BOOK_TEMPLATE'))
            .setDesc(i18n.t('TEMPLATE_CHECK_DESC'))
            .addDropdown(dropdown => {
                const templates = this.plugin.templateManager.getAllTemplateTypes();
                templates.forEach(template => {
                    dropdown.addOption(template.key, template.name);
                    // 设置默认选中的模板
                    if (template.key === this.plugin.settings.templates.default) {
                        this.selectedTemplate = template.key;
                    }
                });
                dropdown.setValue(this.selectedTemplate)
                    .onChange(value => this.selectedTemplate = value);
            });
        // 添加封面上传
        new Setting(contentEl)
            .setName(i18n.t('COVER'))
            .setDesc(i18n.t('COVER_DESC'))
            .addButton(button => button
                .setButtonText(i18n.t('SELECT_IMAGE'))
                .onClick(async () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async () => {
                        const file = input.files?.[0];
                        if (file) {
                            try {
                                // 确保 covers 目录存在
                                const coversPath = `${this.plugin.settings.defaultBookPath}/covers`;
                                if (!await this.plugin.app.vault.adapter.exists(coversPath)) {
                                    await this.plugin.app.vault.adapter.mkdir(coversPath);
                                }

                                // 复制图片到插件目录
                                const fileName = `cover-${Date.now()}.${file.name.split('.').pop()}`;
                                const coverPath = `${coversPath}/${fileName}`;
                                await this.plugin.app.vault.adapter.writeBinary(coverPath, await file.arrayBuffer());
                                this.bookInfo.cover = coverPath;
                                new Notice(i18n.t('COVER_UPLOAD_SUCCESS'));
                            } catch (error) {
                                new Notice(i18n.t('COVER_UPLOAD_FAILED') + error.message);
                            }
                        }
                    };
                    input.click();
                }));

        new Setting(contentEl)
            .setName(i18n.t('BOOK_TITLE'))
            .setDesc(i18n.t('BOOK_TITLE_DESC'))
            .addText(text => text
                .setPlaceholder(i18n.t('BOOK_TITLE_PLACEHOLDER'))
                .onChange(value => this.bookInfo.title = value));

        new Setting(contentEl)
            .setName(i18n.t('SUBTITLE'))
            .setDesc(i18n.t('SUBTITLE_DESC'))
            .addText(text => text
                .setPlaceholder(i18n.t('SUBTITLE_PLACEHOLDER'))
                .onChange(value => this.bookInfo.subtitle = value));

        let targetMode: 'words' | 'pages' = 'words';
        let wordsPerPage = this.plugin.settings.stats?.wordsPerPage || 250;
        let targetInputEl: HTMLInputElement | null = null;
        let wordsPerPageSettingEl: HTMLElement | null = null;
        let targetValueSetting: Setting | null = null;
        let dailyGoalInputEl: HTMLInputElement | null = null;
        let dailyGoalSetting: Setting | null = null;
        const getTargetCountLabel = () => targetMode === 'pages'
            ? i18n.t('TARGET_PAGE_COUNT')
            : i18n.t('TARGET_WORD_COUNT');
        const getDailyGoalLabel = () => targetMode === 'pages'
            ? 'Daily Page Count Goal'
            : 'Daily Word Count Goal';
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
        const syncDailyGoalInput = () => {
            if (!dailyGoalInputEl) return;
            dailyGoalSetting?.setName(getDailyGoalLabel());
            // Always apply faded style
            dailyGoalInputEl.classList.add('daily-goal-input-faded');
            if (targetMode === 'pages') {
                // If switching to pages and value is empty, set to 500 by default
                if (!this.dailyGoalWords) this.dailyGoalWords = 500;
                dailyGoalInputEl.value = this.formatPages(this.dailyGoalWords, wordsPerPage);
                dailyGoalInputEl.placeholder = '2';
            } else {
                // If switching to words and value is empty, set to 500 by default
                if (!this.dailyGoalWords) this.dailyGoalWords = 500;
                dailyGoalInputEl.value = this.dailyGoalWords ? String(this.dailyGoalWords) : '';
                dailyGoalInputEl.placeholder = '500';
            }
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
                        // Always set daily goal to 500 if empty when switching
                        if (!this.dailyGoalWords) this.dailyGoalWords = 500;
                        syncTargetInput();
                        syncWordsPerPageVisibility();
                        syncDailyGoalInput();
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
                syncTargetInput();

                text.onChange(value => {
                    if (targetMode === 'pages') {
                        const parsedPages = Number(value);
                        if (!Number.isFinite(parsedPages) || parsedPages < 0 || wordsPerPage <= 0) return;
                        this.targetTotalWords = Math.round(parsedPages * wordsPerPage);
                        return;
                    }

                    this.targetTotalWords = parseWordCountInput(value, 10000);
                });
            });

        // Move Daily Writing Goal input to after the targetValueSetting
        dailyGoalSetting = new Setting(contentEl)
            .setName(getDailyGoalLabel())
            .setDesc('Per-project target for the Today stat.')
            .addText((text) => {
                dailyGoalInputEl = text.inputEl;
                syncDailyGoalInput();
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.inputEl.step = targetMode === 'pages' ? '0.1' : '1';
                text.inputEl.classList.add('daily-goal-input-faded');
                text.inputEl.addEventListener('input', () => {
                    text.inputEl.classList.remove('daily-goal-input-faded');
                });
                text.onChange((value) => {
                    if (targetMode === 'pages') {
                        const parsedPages = Number(value);
                        if (!Number.isFinite(parsedPages) || parsedPages < 0 || wordsPerPage <= 0) return;
                        this.dailyGoalWords = Math.round(parsedPages * wordsPerPage);
                        return;
                    }
                    this.dailyGoalWords = Number(value) || 0;
                });
            });

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
                .setPlaceholder(i18n.t('AUTHOR_PLACEHOLDER'))
                .setValue(this.plugin.settings.defaultAuthor || '')
                .onChange(value => this.bookInfo.author = value ? value.split(',') : []));

        new Setting(contentEl)
            .setName(i18n.t('DESCRIPTION'))
            .setDesc(i18n.t('DESCRIPTION_DESC'))
            .addTextArea(text => text
                .setPlaceholder(i18n.t('DESCRIPTION_PLACEHOLDER'))
                .onChange(value => this.bookInfo.desc = value));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(i18n.t('CREATE'))
                .setCta()
                .onClick(async () => {
                    if (!this.validateBookInfo()) {
                        new Notice(i18n.t('REQUIRED_FIELDS'));
                        return;
                    }
                    try {
                        const newBook = await this.plugin.bookManager.createBook(
                            this.bookInfo as Omit<BookBasicInfo, 'uuid'>,
                            this.selectedTemplate,
                            this.targetTotalWords,
                            this.dailyGoalWords
                        );

                        if (this.selectedFolder.trim()) {
                            await this.plugin.bookManager.setBookProjectFolder(newBook.basic.uuid, this.selectedFolder);
                            this.plugin.sharedDataManager.addProjectFolder(this.selectedFolder);
                            await this.plugin.sharedDataManager.save();
                        }

                        new Notice(i18n.t('CREATE_SUCCESS'));
                        if (this.onBookCreated) {
                            this.onBookCreated(newBook);
                        }
                        this.close();
                    } catch (error) {
                        new Notice(i18n.t('CREATE_FAILED') + error.message);
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