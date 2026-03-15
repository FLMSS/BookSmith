import { App, TFile, editorInfoField } from 'obsidian';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { Book, ChapterNode, BookStats } from '../types/book';
import BookSmithPlugin from '../main';
import { BookManager } from './BookManager';
import { getLogicalDayISODate, toLocalISODate } from '../utils/logicalDay';

interface ProjectMoveTracker {
    pendingDeletedWords: number;
    pendingDeletedIterationWords: number;
    pendingDeletedOldWords: number;
    pendingPastedWords: number;
    pendingAddedWords: number;
    pendingRemovedWords: number;
    pendingIterationDeletions: number;
    pendingOldDeletions: number;
    newWordsBalance: number;
    balanceDate: string;
}

export class BookStatsManager {
    private currentBook: Book | null = null;
    private statsChangeCallbacks: Set<() => void> = new Set();
    private currentProjectId: string | null = null;
    private projectMoveTrackers: Map<string, ProjectMoveTracker> = new Map();
    private pendingDetectedPasteWords = 0;
    private activeEditorPath: string | null = null;
    private lastPasteDetection = {
        words: 0,
        path: '',
        timestamp: 0
    };

    constructor(
        private app: App,
        private plugin: BookSmithPlugin,
        private bookManager: BookManager
    ) {
        this.registerEditorTrackingExtension();
        this.registerPasteDetectionListeners();
    }

    // 统计更新入口
    async updateStatsForFile() {
        if (!this.currentBook) return;
        
        // 1. 计算总字数
        const totalWordCount = await this.calculateTotalWordCount(this.currentBook.structure.tree);
        
        // 2. 更新统计数据
        const stats = await this.updateStats(this.currentBook.stats, totalWordCount);
        
        // 3. 更新当前book
        this.currentBook.stats = stats;
        
        // 4. 保存到配置文件
        await this.bookManager.updateBook(this.currentBook.basic.uuid, this.currentBook);
        
        // 5. 通知UI更新
        this.notifyStatsChange();
    }

    private async calculateTotalWordCount(nodes: ChapterNode[]): Promise<number> {
        let totalCount = 0;
        for (const node of nodes) {
            if (node.exclude) continue;
            
            if (node.type === 'file') {
                const fullPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook?.basic.title}/${node.path}`;
                const abstractFile = this.app.vault.getAbstractFileByPath(fullPath);
                if (abstractFile instanceof TFile) {
                    const content = await this.app.vault.read(abstractFile);
                    totalCount += this.calculateWordCount(content);
                }
            } else if (node.children) {
                totalCount += await this.calculateTotalWordCount(node.children);
            }
        }
        return totalCount;
    }
    // 添加监听器
    onStatsChange(callback: () => void) {
        this.statsChangeCallbacks.add(callback);
        return () => this.statsChangeCallbacks.delete(callback);
    }

    private notifyStatsChange() {
        this.statsChangeCallbacks.forEach(callback => callback());
    }

    private calculateWordCount(content: string): number {
        // Remove frontmatter (YAML block at the start)
        const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, '');
        let processed = contentWithoutFrontmatter;
        // Check if comments should be counted
        const countComments = this.currentBook?.stats?.countCommentsInWordCount ?? false;
        if (!countComments) {
            // Remove comments/annotations (%%, <!-- -->, /* */, blockquotes)
            processed = processed
                .replace(/%%[\s\S]*?%%/g, '\n') // Obsidian comments
                .replace(/<!--[\s\S]*?-->/g, '\n') // HTML comments
                .replace(/\/\*[\s\S]*?\*\//g, '\n'); // Fountain boneyard comments
            // Remove blockquote lines
            processed = processed
                .split('\n')
                .filter(line => !line.trimStart().startsWith('>'))
                .join('\n');
        } else {
            // Only remove code comments (not blockquotes)
            processed = this.stripComments(processed);
        }

        // 移除 Markdown 语法标记和标点符号
        const plainText = processed
            .replace(/[#*`~\[\](){}|_]/g, '') // 移除 Markdown 标记
            .replace(/[^\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf\uAC00-\uD7AF\u1100-\u11FF\u0600-\u06FF\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F\u0400-\u04FF\u0500-\u052FЁёa-zA-Z0-9\u00C0-\u00FF\u0100-\u017F\u0180-\u024F\s]/g, ' '); // 保留各种语言字符和空格
        
        // 统计中文字、日文汉字和韩文
        const cjkWords = (plainText.match(/[\u4e00-\u9fa5\u3400-\u4dbf\uAC00-\uD7AF]/g) || []).length;
        
        // 统计日文假名和韩文字母
        const jpKoWords = (plainText.match(/[\u3040-\u30ff\u1100-\u11FF]/g) || []).length;
        
        // 统计其他语言单词（连续的字母或数字视为一个单词）
        const otherWords = plainText
            .split(/\s+/)
            .filter(word => /[a-zA-Z0-9\u00C0-\u00FF\u0100-\u017F\u0180-\u024F\u0400-\u04FF\u0500-\u052FЁё\u0600-\u06FF\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F]+/.test(word))
            .length;

        return cjkWords + jpKoWords + otherWords;
    }

    private stripComments(text: string): string {
        return text
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/^\s*\/\/.*$/gm, '');
    }

    private async updateStats(stats: BookStats, totalWordCount: number): Promise<BookStats> {
        const now = new Date();
        const today = getLogicalDayISODate(now, this.plugin.settings.focus.dailyRolloverMinutes);
        const delta = totalWordCount - stats.total_words;
        const tracker = this.getCurrentProjectTracker();
        this.ensureTrackerDate(tracker, today);

        const hasTrackedChanges =
            tracker.pendingAddedWords > 0 ||
            tracker.pendingRemovedWords > 0 ||
            tracker.pendingIterationDeletions > 0 ||
            tracker.pendingOldDeletions > 0;
        const rawAdded = hasTrackedChanges ? tracker.pendingAddedWords : Math.max(0, delta);
        const rawRemoved = hasTrackedChanges ? tracker.pendingRemovedWords : Math.max(0, -delta);
        if (rawRemoved > 0) {
            tracker.pendingDeletedWords += rawRemoved;
        }

        if (rawAdded > 0) {
            const detectedPasteWords = Math.min(rawAdded, this.pendingDetectedPasteWords);
            if (detectedPasteWords > 0) {
                this.pendingDetectedPasteWords -= detectedPasteWords;
                tracker.pendingPastedWords += detectedPasteWords;
            }
        }

        const wordsAddedDelta = rawAdded;
        const wordsDeletedDelta = rawRemoved;

        // 更新每日字数
        const dailyWords = { ...stats.daily_words };
        const nextDailyWords = Math.max(0, (dailyWords[today] || 0) + wordsAddedDelta);
        if (nextDailyWords > 0) {
            dailyWords[today] = nextDailyWords;
        } else {
            delete dailyWords[today];
        }

        // 更新每日净进度明细（新增、删减、净值）
        const dailyProgress = { ...(stats.daily_progress || {}) };
        if (delta !== 0 || rawAdded > 0 || rawRemoved > 0) {
            const previous = dailyProgress[today] || {
                positive_change: 0,
                negative_change: 0,
                net_change: 0,
                words_added: 0,
                words_deleted: 0
            };

            const positiveChange = Math.max(0, previous.positive_change + wordsAddedDelta);
            const negativeChange = Math.min(0, previous.negative_change - wordsDeletedDelta);
            const netChange = positiveChange + negativeChange;
            const wordsAdded = Math.max(0, (previous.words_added || 0) + wordsAddedDelta);
            const wordsDeleted = Math.max(0, (previous.words_deleted || 0) + wordsDeletedDelta);

            dailyProgress[today] = {
                positive_change: positiveChange,
                negative_change: negativeChange,
                net_change: netChange,
                words_added: wordsAdded,
                words_deleted: wordsDeleted
            };
        }

        tracker.pendingAddedWords = 0;
        tracker.pendingRemovedWords = 0;
        tracker.pendingIterationDeletions = 0;
        tracker.pendingOldDeletions = 0;

        // 计算实际有写作记录的天数和平均字数
        const effectiveDays = Object.values(dailyWords).filter(count => count > 0).length;
        const averageDailyWords = effectiveDays > 0 
            ? Math.round(totalWordCount / effectiveDays) 
            : 0;

        // 计算进度
        const progressByWords = stats.target_total_words > 0 
            ? totalWordCount / stats.target_total_words 
            : 0;

        return {
            ...stats,
            total_words: totalWordCount,
            progress_by_words: progressByWords,
            daily_words: dailyWords,
            daily_progress: dailyProgress,
            daily_comments: stats.daily_comments || {},
            writing_days: effectiveDays,
            average_daily_words: averageDailyWords,
            last_writing_date: now.toISOString(),
            last_modified: now.toISOString()
        };
    }

    // 设置当前书籍
    setCurrentBook(book: Book | null) {
        const nextProjectId = book?.basic.uuid || null;
        if (nextProjectId !== this.currentProjectId) {
            this.resetMoveTrackingState();
            this.currentProjectId = nextProjectId;
        }
        this.currentBook = book;
    }

    // 重置统计信息
    resetStats(targetWords: number = 0): BookStats {
        const now = new Date().toISOString();
        return {
            total_words: 0,
            target_total_words: targetWords,
            progress_by_words: 0,
            progress_by_chapter: 0,
            daily_words: {},
            daily_progress: {},
            daily_comments: {},
            writing_periods: [],
            writing_days: 0,
            average_daily_words: 0,
            last_writing_date: now,
            last_modified: now
        };
    }

    private registerPasteDetectionListeners(): void {
        this.plugin.registerEvent(
            this.app.workspace.on('editor-change', (_editor: unknown, info: any) => {
                const filePath = info?.file?.path || this.app.workspace.getActiveFile()?.path || null;
                this.activeEditorPath = filePath;
            })
        );

        this.plugin.registerDomEvent(document, 'paste', (event: ClipboardEvent) => {
            this.handlePasteEvent(event);
        });

        this.plugin.registerDomEvent(document, 'beforeinput', (event: InputEvent) => {
            if (event.inputType !== 'insertFromPaste') return;
            this.handleBeforeInputPaste(event);
        });
    }

    private registerEditorTrackingExtension(): void {
        this.plugin.registerEditorExtension(
            EditorView.updateListener.of((update) => {
                this.handleEditorUpdate(update);
            })
        );
    }

    private handleEditorUpdate(update: ViewUpdate): void {
        if (!update.docChanged || !this.currentBook) return;

        const info = update.state.field(editorInfoField, false);
        const path = info?.file?.path || null;
        if (!path || !this.isPathInCurrentProject(path)) return;

        let addedWords = 0;
        let deletedWords = 0;

        update.transactions.forEach((transaction) => {
            if (!transaction.docChanged) return;

            transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                const impact = this.getChangeWordImpact(
                    transaction.startState.doc,
                    transaction.newDoc,
                    fromA,
                    toA,
                    _fromB,
                    _toB
                );

                addedWords += impact.addedWords;
                deletedWords += impact.deletedWords;
            });
        });

        if (addedWords === 0 && deletedWords === 0) return;

        this.recordTrackedWordChanges(addedWords, deletedWords);
    }

    private recordTrackedWordChanges(addedWords: number, deletedWords: number): void {
        const tracker = this.getCurrentProjectTracker();
        const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        this.ensureTrackerDate(tracker, today);

        if (addedWords > 0) {
            tracker.pendingAddedWords += addedWords;
            tracker.newWordsBalance += addedWords;
        }

        if (deletedWords <= 0) {
            return;
        }

        const iterationDeletions = Math.min(tracker.newWordsBalance, deletedWords);
        const oldDeletions = Math.max(0, deletedWords - iterationDeletions);

        tracker.pendingRemovedWords += deletedWords;
        tracker.pendingIterationDeletions += iterationDeletions;
        tracker.pendingOldDeletions += oldDeletions;
        tracker.newWordsBalance = Math.max(0, tracker.newWordsBalance - deletedWords);
    }

    private getChangeWordImpact(
        oldDoc: { length: number; sliceString(from: number, to: number): string },
        newDoc: { length: number; sliceString(from: number, to: number): string },
        fromA: number,
        toA: number,
        fromB: number,
        toB: number
    ): { addedWords: number; deletedWords: number } {
        const oldRange = this.expandWordBoundaryRange(oldDoc, fromA, toA);
        const newRange = this.expandWordBoundaryRange(newDoc, fromB, toB);

        const oldText = oldDoc.sliceString(oldRange.from, oldRange.to);
        const newText = newDoc.sliceString(newRange.from, newRange.to);
        const oldCount = this.calculateWordCount(oldText);
        const newCount = this.calculateWordCount(newText);

        return {
            addedWords: Math.max(0, newCount - oldCount),
            deletedWords: Math.max(0, oldCount - newCount)
        };
    }

    private expandWordBoundaryRange(
        doc: { length: number; sliceString(from: number, to: number): string },
        from: number,
        to: number
    ): { from: number; to: number } {
        let start = from;
        let end = to;

        while (start > 0 && this.isCountedWordCharacter(doc.sliceString(start - 1, start))) {
            start -= 1;
        }

        while (end < doc.length && this.isCountedWordCharacter(doc.sliceString(end, end + 1))) {
            end += 1;
        }

        return { from: start, to: end };
    }

    private isCountedWordCharacter(char: string): boolean {
        if (!char) return false;
        return /[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf\uAC00-\uD7AF\u1100-\u11FF\u0600-\u06FF\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F\u0400-\u04FF\u0500-\u052FЁёa-zA-Z0-9\u00C0-\u00FF\u0100-\u017F\u0180-\u024F]/.test(char);
    }

    private ensureTrackerDate(tracker: ProjectMoveTracker, today: string): void {
        if (tracker.balanceDate === today) {
            if (tracker.newWordsBalance <= 0) {
                const seededBalance = this.getPersistedTodayNewWordsBalance(today);
                if (seededBalance > 0) {
                    tracker.newWordsBalance = seededBalance;
                }
            }
            return;
        }

        tracker.balanceDate = today;
        tracker.newWordsBalance = this.getPersistedTodayNewWordsBalance(today);
    }

    private getPersistedTodayNewWordsBalance(today: string): number {
        const entry = this.currentBook?.stats?.daily_progress?.[today];
        if (!entry) {
            const dailyNet = this.currentBook?.stats?.daily_words?.[today] || 0;
            return Math.max(0, dailyNet);
        }

        const wordsAdded = entry.words_added ?? entry.positive_change ?? 0;
        // iteration_deletions removed
        return Math.max(0, wordsAdded);
    }

    private handlePasteEvent(event: ClipboardEvent): void {
        const targetPath = this.getActiveEditorPath();
        if (!targetPath || !this.isPathInCurrentProject(targetPath)) return;

        const pastedText = event.clipboardData?.getData('text/plain') || '';
        const words = this.calculateWordCount(pastedText);
        this.recordDetectedPasteWords(words, targetPath);
    }

    private handleBeforeInputPaste(event: InputEvent): void {
        const targetPath = this.getActiveEditorPath();
        if (!targetPath || !this.isPathInCurrentProject(targetPath)) return;

        const dataTransferText = (event as any).dataTransfer?.getData?.('text/plain') || '';
        const fallbackText = typeof (event as any).data === 'string' ? (event as any).data : '';
        const pastedText = dataTransferText || fallbackText;
        const words = this.calculateWordCount(pastedText);
        this.recordDetectedPasteWords(words, targetPath);
    }

    private recordDetectedPasteWords(words: number, path: string): void {
        if (words <= 0) return;

        const now = Date.now();
        const isDuplicate =
            this.lastPasteDetection.words === words &&
            this.lastPasteDetection.path === path &&
            now - this.lastPasteDetection.timestamp < 200;

        if (isDuplicate) {
            return;
        }

        this.pendingDetectedPasteWords += words;
        this.lastPasteDetection = {
            words,
            path,
            timestamp: now
        };
    }

    private getCurrentProjectTracker(): ProjectMoveTracker {
        if (!this.currentProjectId) {
            return {
                pendingDeletedWords: 0,
                pendingDeletedIterationWords: 0,
                pendingDeletedOldWords: 0,
                pendingPastedWords: 0,
                pendingAddedWords: 0,
                pendingRemovedWords: 0,
                pendingIterationDeletions: 0,
                pendingOldDeletions: 0,
                newWordsBalance: 0,
                balanceDate: getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes)
            };
        }

        const existing = this.projectMoveTrackers.get(this.currentProjectId);
        if (existing) return existing;

        const tracker: ProjectMoveTracker = {
            pendingDeletedWords: 0,
            pendingDeletedIterationWords: 0,
            pendingDeletedOldWords: 0,
            pendingPastedWords: 0,
            pendingAddedWords: 0,
            pendingRemovedWords: 0,
            pendingIterationDeletions: 0,
            pendingOldDeletions: 0,
            newWordsBalance: 0,
            balanceDate: getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes)
        };
        this.projectMoveTrackers.set(this.currentProjectId, tracker);
        return tracker;
    }

    private resetMoveTrackingState(): void {
        this.projectMoveTrackers.clear();
        this.pendingDetectedPasteWords = 0;
        this.lastPasteDetection = {
            words: 0,
            path: '',
            timestamp: 0
        };
    }

    private getActiveEditorPath(): string | null {
        return this.activeEditorPath || this.app.workspace.getActiveFile()?.path || null;
    }

    private isPathInCurrentProject(path: string): boolean {
        if (!this.currentBook) return false;
        const bookPath = `${this.plugin.settings.defaultBookPath}/${this.currentBook.basic.title}`;
        return path === bookPath || path.startsWith(`${bookPath}/`);
    }
}