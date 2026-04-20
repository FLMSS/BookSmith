import { App, TFile } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import BookSmithPlugin from '../main';
import { Book } from '../types/book';
import {
    SceneNote,
    SceneNotesFile,
    SCENE_NOTES_FILE_NAME,
    SCENE_NOTES_FILE_VERSION
} from '../types/sceneNote';

/**
 * Manages Scene Notes for the currently active book.
 *
 * Storage: one JSON file per book at `{bookFolder}/scene-notes.json`.
 * Cache: notes for the active book are kept in-memory for fast gutter rendering.
 * Observers: call onNotesChange() to be notified on any mutation.
 */
export class SceneNotesManager {
    private currentBook: Book | null = null;
    private notesCache: SceneNote[] = [];
    private changeCallbacks: Set<() => void> = new Set();
    private loadedBookId: string | null = null;
    private loadInFlight: Promise<void> | null = null;

    constructor(private app: App, private plugin: BookSmithPlugin) {}

    // --- Lifecycle ---

    async setCurrentBook(book: Book | null): Promise<void> {
        const nextId = book?.basic.uuid || null;
        if (nextId === this.loadedBookId) {
            this.currentBook = book;
            return;
        }
        this.currentBook = book;
        this.loadedBookId = nextId;
        if (!book) {
            this.notesCache = [];
            this.notifyChange();
            return;
        }
        await this.loadNotes();
    }

    onNotesChange(callback: () => void): () => void {
        this.changeCallbacks.add(callback);
        return () => this.changeCallbacks.delete(callback);
    }

    private notifyChange() {
        this.changeCallbacks.forEach(cb => {
            try { cb(); } catch (e) { console.error('SceneNotes listener failed:', e); }
        });
    }

    // --- Accessors ---

    getCurrentBook(): Book | null {
        return this.currentBook;
    }

    /** All notes for the active book. */
    getAllNotes(): SceneNote[] {
        return this.notesCache.slice();
    }

    /** Notes anchored to a specific file in the active book. */
    getNotesForFile(filePath: string): SceneNote[] {
        return this.notesCache.filter(n => n.filePath === filePath);
    }

    getNoteById(id: string): SceneNote | null {
        return this.notesCache.find(n => n.id === id) || null;
    }

    /** Returns the note at the given line (inclusive), if any. */
    findNoteAtLine(filePath: string, line: number): SceneNote | null {
        for (const note of this.notesCache) {
            if (note.filePath !== filePath) continue;
            if (line >= note.fromLine && line <= note.toLine) return note;
        }
        return null;
    }

    /** True if any existing note overlaps the paragraph [fromLine, toLine]. */
    paragraphHasNote(filePath: string, fromLine: number, toLine: number): SceneNote | null {
        for (const note of this.notesCache) {
            if (note.filePath !== filePath) continue;
            if (note.toLine < fromLine) continue;
            if (note.fromLine > toLine) continue;
            return note;
        }
        return null;
    }

    // --- CRUD ---

    async createNote(params: {
        filePath: string;
        fromLine: number;
        toLine: number;
        content?: string;
        color?: string;
    }): Promise<SceneNote> {
        const now = new Date().toISOString();
        const note: SceneNote = {
            id: uuidv4(),
            filePath: params.filePath,
            fromLine: params.fromLine,
            toLine: params.toLine,
            content: params.content || '',
            color: params.color,
            createdAt: now,
            updatedAt: now
        };
        this.notesCache.push(note);
        await this.saveNotes();
        this.notifyChange();
        return note;
    }

    async updateNote(id: string, updates: Partial<Omit<SceneNote, 'id' | 'createdAt'>>): Promise<void> {
        const idx = this.notesCache.findIndex(n => n.id === id);
        if (idx < 0) return;
        const current = this.notesCache[idx];
        this.notesCache[idx] = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        await this.saveNotes();
        this.notifyChange();
    }

    async deleteNote(id: string): Promise<void> {
        const before = this.notesCache.length;
        this.notesCache = this.notesCache.filter(n => n.id !== id);
        if (this.notesCache.length === before) return;
        await this.saveNotes();
        this.notifyChange();
    }

    /**
     * Update line positions for a note (called after a file edit shifts the paragraph).
     * Does NOT persist — caller batches multiple shifts then triggers save via persistShifts().
     */
    updateNoteLinesInMemory(id: string, fromLine: number, toLine: number): void {
        const idx = this.notesCache.findIndex(n => n.id === id);
        if (idx < 0) return;
        const current = this.notesCache[idx];
        if (current.fromLine === fromLine && current.toLine === toLine) return;
        this.notesCache[idx] = { ...current, fromLine, toLine };
    }

    /** Persist any in-memory line-position changes to disk. */
    async persistShifts(): Promise<void> {
        await this.saveNotes();
        this.notifyChange();
    }

    /**
     * Remove notes whose fromLine is beyond the document's last line.
     * Called after an edit to auto-clean notes whose anchor paragraph was deleted.
     */
    async pruneNotesPastEnd(filePath: string, lastLine: number): Promise<boolean> {
        const before = this.notesCache.length;
        this.notesCache = this.notesCache.filter(n => {
            if (n.filePath !== filePath) return true;
            return n.fromLine <= lastLine;
        });
        if (this.notesCache.length === before) return false;
        await this.saveNotes();
        this.notifyChange();
        return true;
    }

    // --- Persistence ---

    private getNotesPath(book: Book): string {
        const root = this.plugin.settings.defaultBookPath;
        return `${root}/${book.basic.title}/${SCENE_NOTES_FILE_NAME}`;
    }

    private async loadNotes(): Promise<void> {
        if (this.loadInFlight) {
            await this.loadInFlight;
            return;
        }
        const task = this.loadNotesInner();
        this.loadInFlight = task;
        try {
            await task;
        } finally {
            this.loadInFlight = null;
        }
    }

    private async loadNotesInner(): Promise<void> {
        if (!this.currentBook) {
            this.notesCache = [];
            return;
        }
        const path = this.getNotesPath(this.currentBook);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            this.notesCache = [];
            this.notifyChange();
            return;
        }
        try {
            const raw = await this.app.vault.read(file);
            const parsed = JSON.parse(raw) as SceneNotesFile;
            const notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
            this.notesCache = notes.filter(n => n && typeof n.id === 'string' && typeof n.filePath === 'string');
        } catch (err) {
            console.error('Failed to load scene notes:', err);
            this.notesCache = [];
        }
        this.notifyChange();
    }

    private async saveNotes(): Promise<void> {
        if (!this.currentBook) return;
        const path = this.getNotesPath(this.currentBook);
        const payload: SceneNotesFile = {
            version: SCENE_NOTES_FILE_VERSION,
            notes: this.notesCache
        };
        const json = JSON.stringify(payload, null, 2);
        const existing = this.app.vault.getAbstractFileByPath(path);
        try {
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, json);
            } else {
                await this.app.vault.create(path, json);
            }
        } catch (err) {
            console.error('Failed to save scene notes:', err);
        }
    }

    /** Force-reload from disk (used when file path rename / external modify). */
    async reload(): Promise<void> {
        await this.loadNotes();
    }

    // --- Paragraph detection ---

    /**
     * Given a file's full text and a cursor line, expand up and down until a
     * blank line (or the document boundary) is hit. Returns inclusive line range.
     */
    static detectParagraphRange(docText: string, cursorLine: number): { fromLine: number; toLine: number } {
        const lines = docText.split('\n');
        const isBlank = (idx: number) => idx < 0 || idx >= lines.length || lines[idx].trim() === '';

        // Clamp cursor line.
        let line = Math.max(0, Math.min(cursorLine, lines.length - 1));

        // If the cursor is on a blank line, try to treat it as part of the nearest non-blank paragraph below, else above.
        if (isBlank(line)) {
            let probe = line + 1;
            while (probe < lines.length && isBlank(probe)) probe++;
            if (probe < lines.length) {
                line = probe;
            } else {
                probe = line - 1;
                while (probe >= 0 && isBlank(probe)) probe--;
                if (probe >= 0) line = probe;
                else return { fromLine: line, toLine: line };
            }
        }

        let fromLine = line;
        while (fromLine - 1 >= 0 && !isBlank(fromLine - 1)) fromLine--;
        let toLine = line;
        while (toLine + 1 < lines.length && !isBlank(toLine + 1)) toLine++;
        return { fromLine, toLine };
    }
}
