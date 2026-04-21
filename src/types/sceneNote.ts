// Scene Note — Final Draft-style paragraph-anchored note.
// Anchored to a paragraph in a specific file by line range.

export interface SceneNote {
    id: string;                 // Unique identifier
    filePath: string;           // Vault-relative path to the file this note is in
    fromLine: number;           // Start line of the paragraph (0-indexed)
    toLine: number;             // End line of the paragraph (0-indexed, inclusive)
    title?: string;             // Optional short title for the note
    content: string;            // Note body (plain text)
    color?: string;             // Optional flag color (hex or named)
    createdAt: string;          // ISO creation timestamp
    updatedAt: string;          // ISO last-updated timestamp
}

// On-disk storage shape per book.
export interface SceneNotesFile {
    version: number;            // Schema version for forward-compat migrations
    notes: SceneNote[];
}

export const SCENE_NOTES_FILE_VERSION = 1;
export const SCENE_NOTES_FILE_NAME = 'scene-notes.json';
