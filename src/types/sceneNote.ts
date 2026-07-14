// Scene Note — Final Draft-style paragraph-anchored note.
// Anchored to a paragraph in a specific file by line range.
//
// Storage (current): one consolidated `scene-notes.md` per book holds every
//   note in that project as an H1-delimited section. Each section pairs a
//   human-readable header + body with a `<!--booksmith ... -->` metadata
//   block carrying anchor info, color, tags, and timestamps. Reading the file
//   top-to-bottom gives you a chapter-ordered survey of the project's notes.
//   The right-pane Scene Notes panel is the canonical editor — users
//   shouldn't (and shouldn't need to) edit `scene-notes.md` directly.
//
// Storage (legacy v2): one `.md` file per note inside `{bookFolder}/scene-notes/`.
//   On first load post-upgrade, those files are consolidated into the single
//   file and the folder is renamed to `scene-notes-individual.bak/`.
//
// Storage (legacy v1): single `scene-notes.json` per book. Already handled by
//   prior migrations; the consolidator picks up any leftover JSON too.

export interface SceneNote {
    id: string;                 // Unique identifier
    filePath: string;           // Vault-relative path to the file this note is anchored to
    fromLine: number;           // Start line of the paragraph (0-indexed)
    toLine: number;             // End line of the paragraph (0-indexed, inclusive)
    title?: string;             // Optional short title for the note
    content: string;            // Note body (plain markdown)
    color?: string;             // Optional flag color (hex or named)
    tags?: string[];            // Tag list (no '#' prefix in storage)
    createdAt: string;          // ISO creation timestamp
    updatedAt: string;          // ISO last-updated timestamp
}

/**
 * The consolidated file is named `scene-notes-{book_slug}.md` so that opening
 * a book folder in the file explorer shows which project the notes belong to
 * at a glance. Slug rules (see `bookSlug` in SceneNotesManager): lowercase,
 * non-alphanumeric runs collapse to `_`.
 */
export const SCENE_NOTES_FILE_PREFIX = 'scene-notes-';
export const SCENE_NOTES_FILE_SUFFIX = '.md';

/** Pre-slug single file produced by the prior deploy. Read on migration. */
export const LEGACY_SINGLE_FILE = 'scene-notes.md';

/** Sentinel that opens each note's metadata HTML comment block in the file. */
export const NOTE_META_OPEN = '<!--booksmith';
export const NOTE_META_CLOSE = '-->';

// --- Legacy v2 (one .md file per note) — kept for migration only. ---
export const SCENE_NOTES_FOLDER = 'scene-notes';
export const SCENE_NOTES_FOLDER_BACKUP = 'scene-notes-individual.bak';

// --- Legacy v1 (single JSON) — kept for migration only. ---
export interface LegacySceneNotesFile {
    version: number;
    notes: SceneNote[];
}
export const LEGACY_SCENE_NOTES_FILE = 'scene-notes.json';
export const LEGACY_BACKUP_SUFFIX = '.bak';
