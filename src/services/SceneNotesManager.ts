import { App, TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import BookSmithPlugin from '../main';
import { Book, ChapterNode } from '../types/book';
import {
    SceneNote,
    LegacySceneNotesFile,
    SCENE_NOTES_FILE_PREFIX,
    SCENE_NOTES_FILE_SUFFIX,
    SCENE_NOTES_FOLDER,
    SCENE_NOTES_FOLDER_BACKUP,
    LEGACY_SCENE_NOTES_FILE,
    LEGACY_SINGLE_FILE,
    LEGACY_BACKUP_SUFFIX,
    NOTE_META_OPEN,
    NOTE_META_CLOSE
} from '../types/sceneNote';

/** Metadata resolved for a file: which book owns it and where that book lives. */
export interface BookOwner {
    uuid: string;
    folderPath: string;   // absolute vault path to the book's root folder
    title: string;
    /** The book's Navigator folder (normalized, no leading/trailing slash), if
     *  set. Files under it belong to this project for note-listing purposes
     *  even when they live outside the book's own folder. */
    navigatorFolder?: string;
}

/**
 * Manages Scene Notes across all books in the vault.
 *
 * Storage: one consolidated markdown file per book at
 *   `{bookFolder}/scene-notes.md`
 * containing every note as an H1-delimited section. The file is rewritten on
 * every mutation (debounced for line-anchor edits), serialized through a
 * per-book save lock so concurrent updates can't clobber each other.
 *
 * Migration: any pre-existing `scene-notes/*.md` (legacy v2 per-note files) or
 *   `scene-notes.json` (legacy v1) is read in, consolidated into the single
 *   file, and the source(s) renamed to `*-individual.bak/` and `*.json.bak`.
 *   Idempotent — safe to retry.
 *
 * Cache: notes are keyed by book UUID and loaded lazily the first time a
 *        file in that book is touched.
 *
 * External-edit sync: the consolidated file is watched via vault events.
 *   The user is intended to edit notes through the right-pane panel rather
 *   than the file directly, but external modifications still re-parse and
 *   refresh the cache as a courtesy.
 *
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

    /**
     * Paths we just wrote ourselves (timestamped). Used to ignore the vault
     * `modify`/`create`/`delete` events those writes generate, so we don't
     * thrash the cache and re-notify in a loop.
     */
    private recentlyWrittenPaths: Map<string, number> = new Map();
    private static readonly RECENT_WRITE_TTL_MS = 1500;

    /**
     * Per-book save lock. Each `writeBookFile` chains onto the previous save
     * for that book so concurrent CRUD ops can't interleave their writes and
     * cause the disk file to lag behind the in-memory state.
     */
    private saveLocks: Map<string, Promise<void>> = new Map();

    /** Books whose file needs saving on the next debounced flush. */
    private dirtyBookUuids: Set<string> = new Set();
    private lineFlushTimer: number | null = null;
    private static readonly LINE_FLUSH_DEBOUNCE_MS = 500;

    constructor(private app: App, private plugin: BookSmithPlugin) {
        this.installVaultWatchers();
    }

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
        // Cache first — covers both book-folder and navigator-folder matches.
        const cachedId = this.lookupCachedBookForPath(filePath);
        if (cachedId) {
            const owner = this.owners.get(cachedId);
            if (owner) return owner;
        }

        // 1. Files physically inside a project: walk up to book-config.json.
        const bookRoot = this.plugin.settings.defaultBookPath;
        if (bookRoot && (filePath === bookRoot || filePath.startsWith(bookRoot + '/'))) {
            const rel = filePath.slice(bookRoot.length + 1);
            const parts = rel.split('/').filter(p => p.length > 0);
            for (let i = parts.length; i >= 1; i--) {
                const candidate = `${bookRoot}/${parts.slice(0, i).join('/')}`;
                const configPath = `${candidate}/book-config.json`;
                const configFile = this.app.vault.getAbstractFileByPath(configPath);
                if (!(configFile instanceof TFile)) continue;
                try {
                    const raw = await this.app.vault.read(configFile);
                    const book = JSON.parse(raw) as Book;
                    const nav = book.navigatorFolder?.trim();
                    const owner: BookOwner = {
                        uuid: book.basic.uuid,
                        folderPath: candidate,
                        title: book.basic.title,
                        navigatorFolder: nav ? nav.replace(/^\/+|\/+$/g, '') : undefined
                    };
                    this.owners.set(owner.uuid, owner);
                    this.filePathToBookId.set(candidate, owner.uuid);
                    return owner;
                } catch (err) {
                    console.warn('SceneNotes: failed to read book config at', configPath, err);
                }
            }
        }

        // 2. Files in a project's Navigator folder (which may live anywhere in
        //    the vault). Surface that project's notes even though the file
        //    isn't under the book root.
        return this.findBookByNavigatorFolder(filePath);
    }

    /** Resolve a file that sits inside some project's Navigator folder. */
    private async findBookByNavigatorFolder(filePath: string): Promise<BookOwner | null> {
        let best: { uuid: string; title: string; folderPath: string; nav: string } | null = null;
        const locations = await this.plugin.bookManager.getBookLocations();
        for (const loc of locations) {
            const nav = loc.navigatorFolder;
            if (!nav) continue;
            if (filePath === nav || filePath.startsWith(nav + '/')) {
                // Most specific (longest) navigator folder wins on overlap.
                if (!best || nav.length > best.nav.length) {
                    best = { uuid: loc.uuid, title: loc.title, folderPath: loc.folderPath, nav };
                }
            }
        }
        if (!best) return null;

        const owner: BookOwner = {
            uuid: best.uuid,
            folderPath: best.folderPath,
            title: best.title,
            navigatorFolder: best.nav
        };
        this.owners.set(owner.uuid, owner);
        this.filePathToBookId.set(best.nav, owner.uuid);
        return owner;
    }

    private lookupCachedBookForPath(filePath: string): string | null {
        for (const [folder, uuid] of this.filePathToBookId) {
            if (filePath === folder || filePath.startsWith(folder + '/')) return uuid;
        }
        return null;
    }

    // --- Notes-file path resolution ---

    /**
     * Slugify a book title for use in the notes file's name. Lowercase,
     * runs of non-alphanumerics collapse to `_`, leading/trailing `_`
     * trimmed. Empty result falls back to "untitled" so we never produce
     * a degenerate filename like `scene-notes-.md`.
     */
    private bookSlug(owner: BookOwner): string {
        return owner.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'untitled';
    }

    /** Canonical path for the consolidated notes file of `owner`. */
    private notesFilePath(owner: BookOwner): string {
        return `${owner.folderPath}/${SCENE_NOTES_FILE_PREFIX}${this.bookSlug(owner)}${SCENE_NOTES_FILE_SUFFIX}`;
    }

    // --- Book chapter-order cache ---
    //
    // Notes are written to the consolidated file in chapter-tree order so a
    // top-to-bottom read of the file mirrors the book's reading order. The
    // ordering is sourced from each book's `book-config.json` `structure.tree`
    // and cached per-book; a vault watcher on `book-config.json` invalidates
    // the cache and rewrites the consolidated file when the tree changes
    // (chapter reordered, added, removed, renamed).

    /** Book UUID → flat list of relative file paths in chapter-tree order. */
    private bookOrderCache: Map<string, string[]> = new Map();

    /**
     * Read and cache `book-config.json` chapter order for `owner`. Returns
     * the flattened list of relative file paths (e.g. ["Title Page.md",
     * "Volume 1/Chapter 1.md", …]). Failure cases (missing or unreadable
     * config) cache an empty array so we don't retry on every render.
     */
    private async loadBookOrder(owner: BookOwner): Promise<string[]> {
        const configPath = `${owner.folderPath}/book-config.json`;
        const configFile = this.app.vault.getAbstractFileByPath(configPath);
        if (!(configFile instanceof TFile)) {
            this.bookOrderCache.set(owner.uuid, []);
            return [];
        }
        try {
            const raw = await this.app.vault.read(configFile);
            const book = JSON.parse(raw) as Book;
            const result: string[] = [];
            const flatten = (nodes: ChapterNode[], prefix = '') => {
                const sorted = [...nodes].sort((a, b) => a.order - b.order);
                for (const node of sorted) {
                    if (node.type === 'file') {
                        result.push(prefix ? `${prefix}/${node.path}` : node.path);
                    } else if (node.children?.length) {
                        flatten(node.children, prefix ? `${prefix}/${node.path}` : node.path);
                    }
                }
            };
            if (book.structure?.tree) flatten(book.structure.tree);
            this.bookOrderCache.set(owner.uuid, result);
            return result;
        } catch (err) {
            console.warn('SceneNotes: failed to load chapter order for', owner.title, err);
            this.bookOrderCache.set(owner.uuid, []);
            return [];
        }
    }

    /** Synchronous accessor — returns [] if the book's order hasn't been loaded yet. */
    private getCachedBookOrder(bookUuid: string): string[] {
        return this.bookOrderCache.get(bookUuid) || [];
    }

    // --- Loading ---

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
            // Load chapter order first so any serialization triggered by the
            // migration uses tree-order from the start (avoids an immediate
            // re-save on the very next book-config event).
            await this.loadBookOrder(owner);

            // Run consolidation migration first; it's a no-op if no legacy data
            // is present. Returns true if the migration populated the cache.
            const migrated = await this.migrateLegacyToConsolidated(owner);
            if (migrated) {
                this.notifyChange();
                return;
            }

            // Standard load: parse the consolidated file.
            const path = this.notesFilePath(owner);
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                this.notesByBook.set(owner.uuid, []);
                this.notifyChange();
                return;
            }

            try {
                const raw = await this.app.vault.read(file);
                const notes = parseSceneNotesFile(raw);
                this.notesByBook.set(owner.uuid, notes);
            } catch (err) {
                console.error('SceneNotes: failed to load consolidated file for', owner.title, err);
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

    // --- Migration (any-legacy → consolidated single file) ---

    /**
     * Consolidate any legacy storage (per-note `.md` files in `scene-notes/`,
     * or the older `scene-notes.json`) into the single `scene-notes.md` file.
     * Returns true if migration happened (cache pre-populated, caller should
     * skip standard load); false otherwise.
     */
    private async migrateLegacyToConsolidated(owner: BookOwner): Promise<boolean> {
        const accumulated: SceneNote[] = [];
        const seen = new Set<string>();
        const targetPath = this.notesFilePath(owner);

        // --- Source A: scene-notes/*.md (legacy v2 — per-note files) ---
        const folderPath = `${owner.folderPath}/${SCENE_NOTES_FOLDER}`;
        const legacyFolder = this.app.vault.getAbstractFileByPath(folderPath);
        const havePerNote = legacyFolder instanceof TFolder;
        if (havePerNote && legacyFolder instanceof TFolder) {
            for (const child of legacyFolder.children) {
                if (!(child instanceof TFile) || child.extension !== 'md') continue;
                const note = await this.readPerNoteFile(child);
                if (note && !seen.has(note.id)) {
                    seen.add(note.id);
                    accumulated.push(note);
                }
            }
        }

        // --- Source B: scene-notes.json (legacy v1 — single JSON) ---
        const jsonPath = `${owner.folderPath}/${LEGACY_SCENE_NOTES_FILE}`;
        const jsonFile = this.app.vault.getAbstractFileByPath(jsonPath);
        const haveJson = jsonFile instanceof TFile;
        if (haveJson && jsonFile instanceof TFile) {
            try {
                const raw = await this.app.vault.read(jsonFile);
                const parsed = JSON.parse(raw) as LegacySceneNotesFile;
                const notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
                for (const n of notes) {
                    if (n && typeof n.id === 'string' && typeof n.filePath === 'string'
                        && !seen.has(n.id)) {
                        seen.add(n.id);
                        accumulated.push(n);
                    }
                }
            } catch (err) {
                console.warn('SceneNotes: failed to read legacy JSON', err);
            }
        }

        // --- Source C: scene-notes.md (pre-slug single file) ---
        // Only counts as legacy if the canonical name is now different.
        const oldSinglePath = `${owner.folderPath}/${LEGACY_SINGLE_FILE}`;
        const oldSingleFile = oldSinglePath !== targetPath
            ? this.app.vault.getAbstractFileByPath(oldSinglePath)
            : null;
        const haveOldSingle = oldSingleFile instanceof TFile;
        if (haveOldSingle && oldSingleFile instanceof TFile) {
            try {
                const raw = await this.app.vault.read(oldSingleFile);
                const notes = parseSceneNotesFile(raw);
                for (const n of notes) {
                    if (!seen.has(n.id)) {
                        seen.add(n.id);
                        accumulated.push(n);
                    }
                }
            } catch (err) {
                console.warn('SceneNotes: failed to read pre-slug single file', err);
            }
        }

        if (!havePerNote && !haveJson && !haveOldSingle) return false; // nothing to migrate

        // Write consolidated file at the new per-book path.
        if (accumulated.length > 0) {
            const content = serializeSceneNotesFile(accumulated, owner, this.getCachedBookOrder(owner.uuid));
            this.markRecentlyWritten(targetPath);
            const existing = this.app.vault.getAbstractFileByPath(targetPath);
            try {
                if (existing instanceof TFile) {
                    await this.app.vault.modify(existing, content);
                } else {
                    await this.app.vault.create(targetPath, content);
                }
            } catch (err) {
                console.error('SceneNotes: failed to write consolidated file', err);
                return false; // bail without backing up legacy sources
            }
        }

        // --- Back up every legacy source we read from ---
        if (havePerNote && legacyFolder instanceof TFolder) {
            const bakPath = `${owner.folderPath}/${SCENE_NOTES_FOLDER_BACKUP}`;
            const existingBak = this.app.vault.getAbstractFileByPath(bakPath);
            if (existingBak instanceof TFolder) {
                try { await this.app.vault.delete(existingBak, true); } catch { /* ignore */ }
            }
            try {
                await this.app.fileManager.renameFile(legacyFolder, bakPath);
            } catch (err) {
                console.warn('SceneNotes: failed to back up legacy folder', err);
            }
        }
        if (haveJson && jsonFile instanceof TFile) {
            await this.backupFile(jsonFile, `${jsonPath}${LEGACY_BACKUP_SUFFIX}`);
        }
        if (haveOldSingle && oldSingleFile instanceof TFile) {
            await this.backupFile(oldSingleFile, `${oldSinglePath}${LEGACY_BACKUP_SUFFIX}`);
        }

        // Pre-populate cache so the standard load path is skipped.
        this.notesByBook.set(owner.uuid, accumulated);
        return true;
    }

    /** Move a file aside to a `.bak` (replacing any prior `.bak` at that path). */
    private async backupFile(file: TFile, bakPath: string): Promise<void> {
        const existingBak = this.app.vault.getAbstractFileByPath(bakPath);
        if (existingBak instanceof TFile) {
            try { await this.app.vault.delete(existingBak); } catch { /* ignore */ }
        }
        try {
            await this.app.fileManager.renameFile(file, bakPath);
        } catch (err) {
            console.warn('SceneNotes: failed to back up', file.path, err);
        }
    }

    /** Parse a legacy v2 per-note markdown file. Used only during migration. */
    private async readPerNoteFile(file: TFile): Promise<SceneNote | null> {
        try {
            const raw = await this.app.vault.read(file);
            const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
            if (!fmMatch) return null;
            const fm = (parseYaml(fmMatch[1]) as Record<string, unknown>) || {};
            const body = fmMatch[2] || '';

            const id = fm['note-id'];
            const anchorFile = fm['anchor-file'];
            const range = fm['anchor-range'];
            if (typeof id !== 'string' || typeof anchorFile !== 'string') return null;
            if (!Array.isArray(range) || range.length !== 2) return null;

            const fromLine = typeof range[0] === 'number' ? range[0] : 0;
            const toLine = typeof range[1] === 'number' ? range[1] : fromLine;

            const { title, content } = stripLegacyTitle(body);
            const tagsRaw = fm['tags'];
            const tags = Array.isArray(tagsRaw)
                ? (tagsRaw as unknown[])
                    .filter((t): t is string => typeof t === 'string')
                    .map(t => t.trim()).filter(Boolean)
                : [];

            return {
                id,
                filePath: anchorFile,
                fromLine,
                toLine,
                title: title || undefined,
                content,
                color: typeof fm['color'] === 'string' ? fm['color'] : undefined,
                tags: tags.length > 0 ? tags : undefined,
                createdAt: typeof fm['created'] === 'string' ? fm['created'] : new Date().toISOString(),
                updatedAt: typeof fm['updated'] === 'string' ? fm['updated'] : new Date().toISOString(),
            };
        } catch (err) {
            console.warn('SceneNotes: failed to parse legacy per-note file', file.path, err);
            return null;
        }
    }

    // --- Single-file write (with per-book save serialization) ---

    private async writeBookFile(owner: BookOwner): Promise<void> {
        const prev = this.saveLocks.get(owner.uuid) || Promise.resolve();
        const next = prev.then(() => this.doWriteBookFile(owner)).catch(err => {
            console.error('SceneNotes: write failed for', owner.title, err);
        });
        this.saveLocks.set(owner.uuid, next);
        try {
            await next;
        } finally {
            // Only clear the lock if it still points to OUR task (later writes
            // will have replaced it with their own promise).
            if (this.saveLocks.get(owner.uuid) === next) {
                this.saveLocks.delete(owner.uuid);
            }
        }
    }

    private async doWriteBookFile(owner: BookOwner): Promise<void> {
        const notes = this.notesByBook.get(owner.uuid) || [];
        const path = this.notesFilePath(owner);
        const existing = this.app.vault.getAbstractFileByPath(path);

        if (notes.length === 0) {
            // No notes left → remove the file entirely so the book folder
            // doesn't carry an empty placeholder.
            if (existing instanceof TFile) {
                this.markRecentlyWritten(path);
                await this.app.vault.delete(existing);
            }
            return;
        }

        const content = serializeSceneNotesFile(notes, owner, this.getCachedBookOrder(owner.uuid));
        this.markRecentlyWritten(path);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
        } else {
            await this.app.vault.create(path, content);
        }
    }

    // --- Synchronous accessors ---

    getAllLoadedNotes(): Array<{ owner: BookOwner; note: SceneNote }> {
        const out: Array<{ owner: BookOwner; note: SceneNote }> = [];
        this.notesByBook.forEach((notes, uuid) => {
            const owner = this.owners.get(uuid);
            if (!owner) return;
            notes.forEach(note => out.push({ owner, note }));
        });
        return out;
    }

    getNotesForFile(filePath: string): SceneNote[] {
        const uuid = this.lookupCachedBookForPath(filePath);
        if (!uuid) return [];
        const notes = this.notesByBook.get(uuid) || [];
        return notes.filter(n => n.filePath === filePath);
    }

    getNotesForBook(bookUuid: string): SceneNote[] {
        return (this.notesByBook.get(bookUuid) || []).slice();
    }

    getOwnerByBookId(bookUuid: string): BookOwner | null {
        return this.owners.get(bookUuid) || null;
    }

    getNoteById(id: string): { note: SceneNote; owner: BookOwner } | null {
        for (const [uuid, notes] of this.notesByBook) {
            const note = notes.find(n => n.id === id);
            if (!note) continue;
            const owner = this.owners.get(uuid);
            if (owner) return { note, owner };
        }
        return null;
    }

    findNoteAtLine(filePath: string, line: number): SceneNote | null {
        const notes = this.getNotesForFile(filePath);
        for (const note of notes) {
            if (line >= note.fromLine && line <= note.toLine) return note;
        }
        return null;
    }

    paragraphHasNote(filePath: string, fromLine: number, toLine: number): SceneNote | null {
        const notes = this.getNotesForFile(filePath);
        for (const note of notes) {
            if (note.toLine < fromLine) continue;
            if (note.fromLine > toLine) continue;
            return note;
        }
        return null;
    }

    getAllTagsForBook(bookUuid: string): string[] {
        const set = new Set<string>();
        const notes = this.notesByBook.get(bookUuid) || [];
        for (const n of notes) {
            n.tags?.forEach(t => set.add(t));
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
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
        try {
            await this.writeBookFile(owner);
        } catch (err) {
            console.error('SceneNotes: failed to persist new note', err);
            const idx = arr.findIndex(n => n.id === note.id);
            if (idx >= 0) arr.splice(idx, 1);
            return null;
        }
        this.notifyChange();
        return { note, owner };
    }

    async updateNote(id: string, updates: Partial<Omit<SceneNote, 'id' | 'createdAt'>>): Promise<void> {
        const located = this.locate(id);
        if (!located) return;
        const { uuid, index } = located;
        const arr = this.notesByBook.get(uuid)!;
        const current = arr[index];
        const next: SceneNote = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        // Normalize tags: trim, drop empties, dedupe (case-insensitive identity,
        // preserve user's casing on the kept entry).
        if (next.tags) {
            const seen = new Set<string>();
            const normalized: string[] = [];
            for (const raw of next.tags) {
                const t = raw.trim().replace(/^#/, '');
                if (!t) continue;
                const key = t.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                normalized.push(t);
            }
            next.tags = normalized.length > 0 ? normalized : undefined;
        }
        arr[index] = next;

        const owner = this.owners.get(uuid);
        if (owner) {
            try {
                await this.writeBookFile(owner);
            } catch (err) {
                console.error('SceneNotes: failed to persist note update', id, err);
            }
        }
        this.notifyChange();
    }

    /**
     * Fast in-memory update of a note's line anchors. Used by the CM6 live
     * line-tracker — avoids a disk write per keystroke. Persistence is
     * debounced (500 ms) so rapid edits coalesce into one rewrite of the
     * book's file.
     */
    updateNoteLines(id: string, fromLine: number, toLine: number): void {
        const located = this.locate(id);
        if (!located) return;
        const { uuid, index } = located;
        const arr = this.notesByBook.get(uuid)!;
        const current = arr[index];
        if (current.fromLine === fromLine && current.toLine === toLine) return;
        arr[index] = { ...current, fromLine, toLine, updatedAt: new Date().toISOString() };
        this.scheduleFlush(uuid);
        queueMicrotask(() => this.notifyChange());
    }

    private scheduleFlush(bookUuid: string): void {
        this.dirtyBookUuids.add(bookUuid);
        if (this.lineFlushTimer !== null) window.clearTimeout(this.lineFlushTimer);
        this.lineFlushTimer = window.setTimeout(() => {
            this.lineFlushTimer = null;
            void this.flushDirtyBooks();
        }, SceneNotesManager.LINE_FLUSH_DEBOUNCE_MS);
    }

    private async flushDirtyBooks(): Promise<void> {
        const ids = Array.from(this.dirtyBookUuids);
        this.dirtyBookUuids.clear();
        for (const uuid of ids) {
            const owner = this.owners.get(uuid);
            if (!owner) continue;
            try {
                await this.writeBookFile(owner);
            } catch (err) {
                console.error('SceneNotes: debounced flush failed for', owner.title, err);
            }
        }
    }

    async deleteNote(id: string): Promise<void> {
        const located = this.locate(id);
        if (!located) return;
        const { uuid, index } = located;
        const arr = this.notesByBook.get(uuid)!;
        arr.splice(index, 1);
        const owner = this.owners.get(uuid);
        if (owner) {
            try {
                await this.writeBookFile(owner);
            } catch (err) {
                console.error('SceneNotes: failed to persist note deletion', id, err);
            }
        }
        this.notifyChange();
    }

    private locate(id: string): { uuid: string; index: number } | null {
        for (const [uuid, notes] of this.notesByBook) {
            const idx = notes.findIndex(n => n.id === id);
            if (idx >= 0) return { uuid, index: idx };
        }
        return null;
    }

    /** Drop notes in `filePath` whose anchor sits past the document's last line. */
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
        if (owner) {
            try { await this.writeBookFile(owner); }
            catch (err) { console.error('SceneNotes: failed to persist pruned notes', err); }
        }
        this.notifyChange();
        return true;
    }

    // --- External-edit sync ---

    private installVaultWatchers(): void {
        this.plugin.registerEvent(this.app.vault.on('modify', (file) => {
            if (!(file instanceof TFile)) return;
            // book-config.json modifications mean chapter order may have
            // changed — refresh the cache and rewrite that book's notes file.
            if (file.name === 'book-config.json') {
                void this.onBookConfigChange(file);
                return;
            }
            void this.onExternalChange(file);
        }));
        this.plugin.registerEvent(this.app.vault.on('create', (file) => {
            if (file instanceof TFile) void this.onExternalChange(file);
        }));
        this.plugin.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile) this.onExternalDelete(file);
        }));
        this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile) void this.onExternalRename(file, oldPath);
        }));
    }

    /**
     * Called when any `book-config.json` is modified. Refreshes the cached
     * chapter order for the affected book (if loaded) and re-saves the
     * consolidated file ONLY when the chapter order actually changed.
     *
     * The skip-on-no-change is essential to prevent a feedback loop:
     *   1. We rewrite the consolidated file
     *   2. BookSmith's FileEventManager treats that as a chapter-folder edit
     *      and refreshes stats, which writes back to book-config.json
     *   3. book-config.json modify fires → this handler runs again
     *   4. Without the equality check, we'd rewrite the consolidated again
     *      and loop forever. The ToolsView re-renders the list on each
     *      book-config modify, which turns the loop into visible flicker
     *      under the cursor (rows replaced → :hover state lost → re-hover).
     *
     * Comparing the freshly-loaded order against the previously-cached one
     * makes order-preserving book-config writes a no-op for us, breaking
     * the loop while still rewriting promptly on genuine tree changes.
     */
    private async onBookConfigChange(file: TFile): Promise<void> {
        const folderPath = file.parent?.path;
        if (!folderPath) return;
        let owner: BookOwner | null = null;
        for (const o of this.owners.values()) {
            if (o.folderPath === folderPath) { owner = o; break; }
        }
        if (!owner) return;

        // Reconcile the Navigator folder — if it changed, drop the stale
        // "navigator folder → this book" path cache so old-folder files stop
        // resolving here and new-folder files start.
        try {
            const cfg = JSON.parse(await this.app.vault.read(file)) as Book;
            const nav = cfg.navigatorFolder?.trim();
            const normalized = nav ? nav.replace(/^\/+|\/+$/g, '') : undefined;
            if (normalized !== owner.navigatorFolder) {
                if (owner.navigatorFolder) this.filePathToBookId.delete(owner.navigatorFolder);
                owner.navigatorFolder = normalized;
            }
        } catch { /* ignore malformed config */ }

        if (!this.notesByBook.has(owner.uuid)) return;

        const previous = this.getCachedBookOrder(owner.uuid).slice();
        await this.loadBookOrder(owner);
        const current = this.getCachedBookOrder(owner.uuid);

        // Bail unless the chapter order actually changed.
        if (previous.length === current.length
            && previous.every((p, i) => p === current[i])) {
            return;
        }

        try {
            await this.writeBookFile(owner);
        } catch (err) {
            console.error('SceneNotes: re-save after chapter reorder failed', err);
        }
    }

    private findOwnerByNotesFilePath(path: string): BookOwner | null {
        for (const owner of this.owners.values()) {
            if (path === this.notesFilePath(owner)) return owner;
        }
        return null;
    }

    private markRecentlyWritten(path: string): void {
        this.recentlyWrittenPaths.set(path, Date.now());
    }

    private isRecentlyWritten(path: string): boolean {
        const t = this.recentlyWrittenPaths.get(path);
        if (t === undefined) return false;
        if (Date.now() - t > SceneNotesManager.RECENT_WRITE_TTL_MS) {
            this.recentlyWrittenPaths.delete(path);
            return false;
        }
        return true;
    }

    private async onExternalChange(file: TFile): Promise<void> {
        if (file.extension !== 'md') return;
        if (this.isRecentlyWritten(file.path)) return;
        const owner = this.findOwnerByNotesFilePath(file.path);
        if (!owner) return;
        if (!this.notesByBook.has(owner.uuid)) return;

        try {
            const raw = await this.app.vault.read(file);
            const notes = parseSceneNotesFile(raw);
            this.notesByBook.set(owner.uuid, notes);
            this.notifyChange();
        } catch (err) {
            console.error('SceneNotes: failed to re-parse external edit', err);
        }
    }

    private onExternalDelete(file: TFile): void {
        if (this.isRecentlyWritten(file.path)) return;
        const owner = this.findOwnerByNotesFilePath(file.path);
        if (!owner) return;
        if (!this.notesByBook.has(owner.uuid)) return;
        this.notesByBook.set(owner.uuid, []);
        this.notifyChange();
    }

    private async onExternalRename(file: TFile, oldPath: string): Promise<void> {
        // If the canonical path moved away → treat as delete on the old path.
        const oldOwner = this.findOwnerByNotesFilePathRaw(oldPath);
        if (oldOwner && this.notesByBook.has(oldOwner.uuid)) {
            this.notesByBook.set(oldOwner.uuid, []);
            this.notifyChange();
        }
        // If the renamed file landed AT the canonical path → treat as fresh load.
        const newOwner = this.findOwnerByNotesFilePath(file.path);
        if (newOwner && this.notesByBook.has(newOwner.uuid)) {
            await this.onExternalChange(file);
        }
    }

    /** Like findOwnerByNotesFilePath but matches against an arbitrary candidate path. */
    private findOwnerByNotesFilePathRaw(path: string): BookOwner | null {
        for (const owner of this.owners.values()) {
            if (path === this.notesFilePath(owner)) return owner;
        }
        return null;
    }

    // --- Paragraph detection (pure) ---

    /**
     * Given a file's full text and a cursor line, expand up and down until a
     * blank line (or the document boundary) is hit. Returns inclusive line range.
     *
     * Treats the YAML frontmatter block (`---` ... `---` at the top of the doc)
     * as a hard boundary — the walk will not cross into or through it.
     */
    static detectParagraphRange(docText: string, cursorLine: number): { fromLine: number; toLine: number } {
        const lines = docText.split('\n');
        const isBlank = (idx: number) => idx < 0 || idx >= lines.length || lines[idx].trim() === '';

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

        if (line < frontmatterEnd) {
            let probe = frontmatterEnd;
            while (probe < lines.length && isBlank(probe)) probe++;
            if (probe >= lines.length) return { fromLine: frontmatterEnd, toLine: frontmatterEnd };
            line = probe;
        }

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

// --- Helpers (module-private, pure) ---

/**
 * Parse a consolidated `scene-notes.md` file into an array of SceneNote.
 *
 * File shape:
 *   ---
 *   <book-level frontmatter>
 *   ---
 *
 *   <optional preface text — ignored by the parser>
 *
 *   # <title> ^note-<shortid>
 *   <!--booksmith
 *   note-id: <full uuid>
 *   anchor-file: <vault path>
 *   anchor-range: [<from>, <to>]
 *   ...
 *   -->
 *
 *   <body markdown>
 *
 *   # <next title> ^note-<shortid>
 *   ...
 */
function parseSceneNotesFile(raw: string): SceneNote[] {
    // Strip the file-level frontmatter (book metadata, not per-note).
    let body = raw;
    const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
    if (fmMatch) body = fmMatch[1];

    // Find every line that starts an H1 (`# `). Each such line begins a section.
    const lines = body.split('\n');
    const headerIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('# ')) headerIndices.push(i);
    }
    if (headerIndices.length === 0) return [];

    const out: SceneNote[] = [];
    for (let h = 0; h < headerIndices.length; h++) {
        const start = headerIndices[h];
        const end = h < headerIndices.length - 1 ? headerIndices[h + 1] : lines.length;
        const note = parseNoteSection(lines.slice(start, end));
        if (note) out.push(note);
    }
    return out;
}

/** Parse a single H1-delimited section into a SceneNote. */
function parseNoteSection(sectionLines: string[]): SceneNote | null {
    if (sectionLines.length === 0) return null;
    const headerLine = sectionLines[0];

    // `# Title ^note-shortid` — block ID is optional; we ignore it on parse
    // (the canonical id lives in the metadata block).
    const headerMatch = headerLine.match(/^# (.+?)(?:\s+\^[\w-]+)?\s*$/);
    if (!headerMatch) return null;
    const title = headerMatch[1].trim() || undefined;

    const bodyText = sectionLines.slice(1).join('\n');

    // Locate the `<!--booksmith ... -->` metadata block.
    const metaOpen = bodyText.indexOf(NOTE_META_OPEN);
    if (metaOpen < 0) return null;
    const metaInnerStart = metaOpen + NOTE_META_OPEN.length;
    const metaClose = bodyText.indexOf(NOTE_META_CLOSE, metaInnerStart);
    if (metaClose < 0) return null;

    const yamlText = bodyText.slice(metaInnerStart, metaClose).trim();
    let meta: Record<string, unknown>;
    try {
        meta = (parseYaml(yamlText) as Record<string, unknown>) || {};
    } catch {
        return null;
    }

    const id = meta['note-id'];
    const anchorFile = meta['anchor-file'];
    const range = meta['anchor-range'];
    if (typeof id !== 'string' || typeof anchorFile !== 'string') return null;
    if (!Array.isArray(range) || range.length !== 2) return null;

    const fromLine = typeof range[0] === 'number' ? range[0] : 0;
    const toLine = typeof range[1] === 'number' ? range[1] : fromLine;

    const tagsRaw = meta['tags'];
    const tags = Array.isArray(tagsRaw)
        ? (tagsRaw as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .map(t => t.trim()).filter(Boolean)
        : [];

    // Body content is everything after the metadata close marker.
    const afterMeta = bodyText.slice(metaClose + NOTE_META_CLOSE.length);
    const content = afterMeta.replace(/^[\s\r\n]+/, '').replace(/\s+$/, '');

    return {
        id,
        filePath: anchorFile,
        fromLine,
        toLine,
        title,
        content,
        color: typeof meta['color'] === 'string' ? meta['color'] : undefined,
        tags: tags.length > 0 ? tags : undefined,
        createdAt: typeof meta['created'] === 'string' ? meta['created'] : new Date().toISOString(),
        updatedAt: typeof meta['updated'] === 'string' ? meta['updated'] : new Date().toISOString(),
    };
}

/**
 * Serialize an array of notes into the consolidated file format. Sorted by
 * chapter-tree order (from `book-config.json`) then by anchor start line,
 * so reading the file top-to-bottom mirrors the book's reading order.
 *
 * Notes anchored to files not present in the tree (e.g., a chapter that's
 * been removed from the tree but whose file still exists with notes attached)
 * sort to the end, then alphabetical, then by line.
 */
function serializeSceneNotesFile(
    notes: SceneNote[],
    owner: BookOwner,
    chapterOrder: string[]
): string {
    const orderIndex = new Map<string, number>();
    chapterOrder.forEach((rel, i) => orderIndex.set(rel, i));

    const sorted = notes.slice().sort((a, b) => {
        const aRel = shortPath(a.filePath, owner);
        const bRel = shortPath(b.filePath, owner);
        const aIdx = orderIndex.get(aRel);
        const bIdx = orderIndex.get(bRel);

        // Both files are in the chapter tree → tree order, then line.
        if (aIdx !== undefined && bIdx !== undefined) {
            if (aIdx !== bIdx) return aIdx - bIdx;
            return a.fromLine - b.fromLine;
        }
        // Only one is in the tree → that one comes first.
        if (aIdx !== undefined) return -1;
        if (bIdx !== undefined) return 1;
        // Neither in the tree → alphabetical fallback, then line.
        const cmp = aRel.localeCompare(bRel);
        if (cmp !== 0) return cmp;
        return a.fromLine - b.fromLine;
    });

    const out: string[] = [];

    // File-level frontmatter — purely informational; the parser ignores it.
    out.push('---');
    out.push('book-id: ' + owner.uuid);
    out.push('book-title: ' + JSON.stringify(owner.title));
    out.push('note-count: ' + sorted.length);
    out.push('updated: ' + new Date().toISOString());
    out.push('---');
    out.push('');
    out.push('> [!info] Scene Notes for ' + owner.title);
    out.push('> Auto-generated by BookSmith — edit notes via the right-pane Scene Notes panel rather than directly here.');
    out.push('');

    for (const note of sorted) {
        const blockId = 'note-' + note.id.replace(/-/g, '').slice(0, 8);
        const fallbackTitle = `${shortPath(note.filePath, owner)} · L${note.fromLine + 1}`;
        const titleText = (note.title?.trim()) || fallbackTitle;
        out.push(`# ${titleText} ^${blockId}`);
        out.push('');

        const meta: Record<string, unknown> = {
            'note-id': note.id,
            'anchor-file': note.filePath,
            'anchor-range': [note.fromLine, note.toLine],
        };
        if (note.color) meta['color'] = note.color;
        if (note.tags && note.tags.length > 0) meta['tags'] = note.tags;
        meta['created'] = note.createdAt;
        meta['updated'] = note.updatedAt;

        out.push(NOTE_META_OPEN);
        out.push(stringifyYaml(meta).trimEnd());
        out.push(NOTE_META_CLOSE);
        out.push('');
        if (note.content) {
            out.push(note.content);
            out.push('');
        }
    }

    return out.join('\n');
}

/** Strip the book folder prefix from a vault path for cleaner display. */
function shortPath(absolutePath: string, owner: BookOwner): string {
    const prefix = owner.folderPath + '/';
    if (absolutePath.startsWith(prefix)) return absolutePath.slice(prefix.length);
    return absolutePath;
}

/**
 * Strip the legacy v2 `# Heading\n\n` title prefix from a per-note file body
 * (used only during one-shot migration; new files don't carry a heading in
 * the body — the consolidated file's H1 is the canonical title).
 */
function stripLegacyTitle(body: string): { title?: string; content: string } {
    const trimmed = body.replace(/^[\s\r\n]+/, '');
    const m = trimmed.match(/^#\s+(.+?)\r?\n/);
    if (m) {
        const title = m[1].trim() || undefined;
        const content = trimmed.slice(m[0].length).replace(/^[\s\r\n]+/, '').replace(/\s+$/, '');
        return { title, content };
    }
    return { content: trimmed.replace(/\s+$/, '') };
}
