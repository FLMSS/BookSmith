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

/** Metadata resolved for a file: which book owns it and where that book lives. */
export interface BookOwner {
    uuid: string;
    folderPath: string;   // absolute vault path to the book's root folder
    title: string;
}

/**
 * Manages Scene Notes across all books in the vault.
 *
 * Storage: one JSON file per book at `{bookFolder}/scene-notes.json`.
 * Cache: notes are keyed by book UUID and loaded lazily the first time a
 *        file in that book is touched. This lets the gutter, Ctrl+J, and the
 *        side panel all work against whatever book owns the currently open
 *        file — no explicit "active book" toggle needed.
 * Observers: call onNotesChange() to be notified on any mutation.
 */
export class SceneNotesManager {
    /** Notes cache, keyed by book UUID. */
    private notesByBook: Map<string, SceneNote[]> = new Map();
    /** Book metadata (folder + title), keyed by book UUID. */
    private owners: Map<string, BookOwner> = new Map();
    /** Outstanding load promises, keyed by book UUID. */
    private loadsInFlight: Map<string, Promise<void>> = new Map();
    /** Reverse index: file path prefix → book UUID, to avoid re-resolving on every paint. */
    private filePathToBookId: Map<string, string> = new Map();
    private changeCallbacks: Set<() => void> = new Set();

    constructor(private app: App, private plugin: BookSmithPlugin) {}

    // --- Observers ---

    onNotesChange(callback: () => void): () => void {
        this.changeCallbacks.add(callback);
        return () => this.changeCallbacks.delete(callback);
    }

    private notifyChange() {
        this.changeCallbacks.forEach(cb => {
            try { cb(); } catch (e) { console.error('SceneNotes listener failed:', e); }
        });
    }

    // --- Book resolution ---

    /**
     * Given any file path, find the book that owns it by walking up the path
     * until a `book-config.json` is found. Returns null if the file is not in
     * any book under the configured root.
     */
    async findBookForFile(filePath: string): Promise<BookOwner | null> {
        const bookRoot = this.plugin.settings.defaultBookPath;
        if (!bookRoot) return null;
        if (!(filePath === bookRoot || filePath.startsWith(bookRoot + '/'))) return null;

        // Fast path: we've resolved this file (or a sibling) before.
        const cachedId = this.lookupCachedBookForPath(filePath);
        if (cachedId) {
            const owner = this.owners.get(cachedId);
            if (owner) return owner;
        }

        const rel = filePath.slice(bookRoot.length + 1);
        const parts = rel.split('/').filter(p => p.length > 0);
        // Walk from the deepest parent up to the root, checking for book-config.json.
        for (let i = parts.length; i >= 1; i--) {
            const candidate = `${bookRoot}/${parts.slice(0, i).join('/')}`;
            const configPath = `${candidate}/book-config.json`;
            const configFile = this.app.vault.getAbstractFileByPath(configPath);
            if (!(configFile instanceof TFile)) continue;
            try {
                const raw = await this.app.vault.read(configFile);
                const book = JSON.parse(raw) as Book;
                const owner: BookOwner = {
                    uuid: book.basic.uuid,
                    folderPath: candidate,
                    title: book.basic.title
                };
                this.owners.set(owner.uuid, owner);
                this.filePathToBookId.set(candidate, owner.uuid);
                return owner;
            } catch (err) {
                console.warn('SceneNotes: failed to read book config at', configPath, err);
            }
        }
        return null;
    }

    private lookupCachedBookForPath(filePath: string): string | null {
        for (const [folder, uuid] of this.filePathToBookId) {
            if (filePath === folder || filePath.startsWith(folder + '/')) return uuid;
        }
        return null;
    }

    // --- Loading ---

    /**
     * Ensure the book's notes cache is loaded. Safe to call repeatedly — returns
     * immediately if already loaded or if a load is already in flight.
     */
    async ensureLoadedForFile(filePath: string): Promise<BookOwner | null> {
        const owner = await this.findBookForFile(filePath);
        if (!owner) return null;
        await this.ensureLoaded(owner);
        return owner;
    }

    private async ensureLoaded(owner: BookOwner): Promise<void> {
        if (this.notesByBook.has(owner.uuid)) return;
        const existing = this.loadsInFlight.get(owner.uuid);
        if (existing) return existing;

        const task = (async () => {
            const notesPath = `${owner.folderPath}/${SCENE_NOTES_FILE_NAME}`;
            const file = this.app.vault.getAbstractFileByPath(notesPath);
            if (!(file instanceof TFile)) {
                this.notesByBook.set(owner.uuid, []);
                this.notifyChange();
                return;
            }
            try {
                const raw = await this.app.vault.read(file);
                const parsed = JSON.parse(raw) as SceneNotesFile;
                const notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
                this.notesByBook.set(
                    owner.uuid,
                    notes.filter(n => n && typeof n.id === 'string' && typeof n.filePath === 'string')
                );
            } catch (err) {
                console.error('Failed to load scene notes for', owner.title, err);
                this.notesByBook.set(owner.uuid, []);
            }
            this.notifyChange();
        })();

        this.loadsInFlight.set(owner.uuid, task);
        try {
            await task;
        } finally {
            this.loadsInFlight.delete(owner.uuid);
        }
    }

    // --- Synchronous accessors (call ensureLoadedForFile first for reliable results) ---

    /** All notes across all currently-loaded books. */
    getAllLoadedNotes(): Array<{ owner: BookOwner; note: SceneNote }> {
        const out: Array<{ owner: BookOwner; note: SceneNote }> = [];
        this.notesByBook.forEach((notes, uuid) => {
            const owner = this.owners.get(uuid);
            if (!owner) return;
            notes.forEach(note => out.push({ owner, note }));
        });
        return out;
    }

    /** Notes anchored to a specific file (across all loaded books). */
    getNotesForFile(filePath: string): SceneNote[] {
        const uuid = this.lookupCachedBookForPath(filePath);
        if (!uuid) return [];
        const notes = this.notesByBook.get(uuid) || [];
        return notes.filter(n => n.filePath === filePath);
    }

    /** Notes for a specific book (by UUID). */
    getNotesForBook(bookUuid: string): SceneNote[] {
        return (this.notesByBook.get(bookUuid) || []).slice();
    }

    getOwnerByBookId(bookUuid: string): BookOwner | null {
        return this.owners.get(bookUuid) || null;
    }

    /** Find a note by id across all loaded books. */
    getNoteById(id: string): { note: SceneNote; owner: BookOwner } | null {
        for (const [uuid, notes] of this.notesByBook) {
            const note = notes.find(n => n.id === id);
            if (!note) continue;
            const owner = this.owners.get(uuid);
            if (owner) return { note, owner };
        }
        return null;
    }

    /** Returns the note at the given line (inclusive), if any, for filePath. */
    findNoteAtLine(filePath: string, line: number): SceneNote | null {
        const notes = this.getNotesForFile(filePath);
        for (const note of notes) {
            if (line >= note.fromLine && line <= note.toLine) return note;
        }
        return null;
    }

    /** True if any existing note overlaps the paragraph [fromLine, toLine]. */
    paragraphHasNote(filePath: string, fromLine: number, toLine: number): SceneNote | null {
        const notes = this.getNotesForFile(filePath);
        for (const note of notes) {
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
    }): Promise<{ note: SceneNote; owner: BookOwner } | null> {
        const owner = await this.findBookForFile(params.filePath);
        if (!owner) return null;
        await this.ensureLoaded(owner);

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
        const arr = this.notesByBook.get(owner.uuid) || [];
        arr.push(note);
        this.notesByBook.set(owner.uuid, arr);
        await this.saveNotes(owner);
        this.notifyChange();
        return { note, owner };
    }

    async updateNote(id: string, updates: Partial<Omit<SceneNote, 'id' | 'createdAt'>>): Promise<void> {
        const located = this.locate(id);
        if (!located) return;
        const { uuid, index } = located;
        const arr = this.notesByBook.get(uuid)!;
        const current = arr[index];
        arr[index] = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        const owner = this.owners.get(uuid);
        if (owner) await this.saveNotes(owner);
        this.notifyChange();
    }

    /**
     * Fast in-memory update of a note's line anchors. Used by the CM6 live
     * line-tracker — avoids a disk write per keystroke.
     *
     * IMPORTANT: the mutation is synchronous (so the gutter paint that happens
     * later in THIS same CM6 update cycle sees the fresh line numbers), but
     * the `notifyChange` is deferred via microtask because listeners trigger
     * editor dispatches, which CM6 forbids while an update is in progress.
     * Persistence is debounced (500 ms) so rapid edits coalesce into one write.
     */
    updateNoteLines(id: string, fromLine: number, toLine: number): void {
        const located = this.locate(id);
        if (!located) return;
        const { uuid, index } = located;
        const arr = this.notesByBook.get(uuid)!;
        const current = arr[index];
        if (current.fromLine === fromLine && current.toLine === toLine) return;
        arr[index] = { ...current, fromLine, toLine, updatedAt: new Date().toISOString() };
        this.scheduleLineFlush(uuid);
        queueMicrotask(() => this.notifyChange());
    }

    private pendingLineFlushes: Map<string, number> = new Map();
    private scheduleLineFlush(uuid: string): void {
        const prev = this.pendingLineFlushes.get(uuid);
        if (prev) window.clearTimeout(prev);
        const timer = window.setTimeout(() => {
            this.pendingLineFlushes.delete(uuid);
            const owner = this.owners.get(uuid);
            if (owner) void this.saveNotes(owner);
        }, 500);
        this.pendingLineFlushes.set(uuid, timer);
    }

    async deleteNote(id: string): Promise<void> {
        const located = this.locate(id);
        if (!located) return;
        const { uuid, index } = located;
        const arr = this.notesByBook.get(uuid)!;
        arr.splice(index, 1);
        const owner = this.owners.get(uuid);
        if (owner) await this.saveNotes(owner);
        this.notifyChange();
    }

    private locate(id: string): { uuid: string; index: number } | null {
        for (const [uuid, notes] of this.notesByBook) {
            const idx = notes.findIndex(n => n.id === id);
            if (idx >= 0) return { uuid, index: idx };
        }
        return null;
    }

    /**
     * Remove notes in a given file whose fromLine is beyond the document's
     * last line. Returns true if any notes were pruned.
     */
    async pruneNotesPastEnd(filePath: string, lastLine: number): Promise<boolean> {
        const uuid = this.lookupCachedBookForPath(filePath);
        if (!uuid) return false;
        const notes = this.notesByBook.get(uuid);
        if (!notes) return false;
        const before = notes.length;
        const filtered = notes.filter(n => n.filePath !== filePath || n.fromLine <= lastLine);
        if (filtered.length === before) return false;
        this.notesByBook.set(uuid, filtered);
        const owner = this.owners.get(uuid);
        if (owner) await this.saveNotes(owner);
        this.notifyChange();
        return true;
    }

    // --- Persistence ---

    private async saveNotes(owner: BookOwner): Promise<void> {
        const notesPath = `${owner.folderPath}/${SCENE_NOTES_FILE_NAME}`;
        const payload: SceneNotesFile = {
            version: SCENE_NOTES_FILE_VERSION,
            notes: this.notesByBook.get(owner.uuid) || []
        };
        const json = JSON.stringify(payload, null, 2);
        const existing = this.app.vault.getAbstractFileByPath(notesPath);
        try {
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, json);
            } else {
                await this.app.vault.create(notesPath, json);
            }
        } catch (err) {
            console.error('Failed to save scene notes for', owner.title, err);
        }
    }

    // --- Paragraph detection (pure) ---

    /**
     * Given a file's full text and a cursor line, expand up and down until a
     * blank line (or the document boundary) is hit. Returns inclusive line range.
     *
     * Treats the YAML frontmatter block (`---` ... `---` at the top of the doc)
     * as a hard boundary — the walk will not cross into or through it, because
     * Obsidian's Live Preview hides frontmatter lines and a flag anchored
     * there would be invisible.
     */
    static detectParagraphRange(docText: string, cursorLine: number): { fromLine: number; toLine: number } {
        const lines = docText.split('\n');
        const isBlank = (idx: number) => idx < 0 || idx >= lines.length || lines[idx].trim() === '';

        // Detect frontmatter end: if the first line is `---`, find the matching
        // closing `---`. `frontmatterEnd` is the first line index AFTER the block.
        let frontmatterEnd = 0;
        if (lines.length > 0 && lines[0] === '---') {
            for (let i = 1; i < lines.length; i++) {
                if (lines[i] === '---') {
                    frontmatterEnd = i + 1;
                    break;
                }
            }
        }

        let line = Math.max(0, Math.min(cursorLine, lines.length - 1));

        // If the cursor is inside the frontmatter block, snap down to the first
        // non-blank line after it.
        if (line < frontmatterEnd) {
            let probe = frontmatterEnd;
            while (probe < lines.length && isBlank(probe)) probe++;
            if (probe >= lines.length) return { fromLine: frontmatterEnd, toLine: frontmatterEnd };
            line = probe;
        }

        // If the cursor is on a blank line, snap to the nearest non-blank paragraph.
        if (isBlank(line)) {
            let probe = line + 1;
            while (probe < lines.length && isBlank(probe)) probe++;
            if (probe < lines.length) {
                line = probe;
            } else {
                probe = line - 1;
                while (probe >= frontmatterEnd && isBlank(probe)) probe--;
                if (probe >= frontmatterEnd) line = probe;
                else return { fromLine: line, toLine: line };
            }
        }

        let fromLine = line;
        while (fromLine - 1 >= frontmatterEnd && !isBlank(fromLine - 1)) fromLine--;
        let toLine = line;
        while (toLine + 1 < lines.length && !isBlank(toLine + 1)) toLine++;
        return { fromLine, toLine };
    }
}
