import { editorInfoField } from 'obsidian';
import { Extension, StateEffect } from '@codemirror/state';
import { EditorView, gutter, GutterMarker, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { SceneNotesManager } from './SceneNotesManager';
import { SceneNote } from '../types/sceneNote';

/** Fired to force a gutter repaint when external state (notes) changes. */
export const sceneNotesRepaintEffect = StateEffect.define<null>();

/**
 * Returns a CM6 extension that:
 *  - Draws a flag marker in the gutter on any line that falls within an
 *    anchored scene-note range.
 *  - On gutter click, invokes the provided handler with the clicked note.
 *
 * The manager lookup is live (fresh on each paint) so note additions/removals
 * reflect immediately once the manager notifies and the editor paints.
 */
export function buildSceneNotesGutter(
    manager: SceneNotesManager,
    onMarkerClick: (note: SceneNote, view: EditorView) => void
): Extension {
    /** Per-line gutter marker for a scene note. */
    class SceneNoteMarker extends GutterMarker {
        constructor(readonly note: SceneNote, readonly isStart: boolean) {
            super();
        }

        override eq(other: GutterMarker): boolean {
            if (!(other instanceof SceneNoteMarker)) return false;
            // Include color, fromLine, toLine so the gutter repaints when any
            // visible-affecting property changes — not just the note id.
            return other.note.id === this.note.id
                && other.isStart === this.isStart
                && (other.note.color || null) === (this.note.color || null)
                && other.note.fromLine === this.note.fromLine
                && other.note.toLine === this.note.toLine;
        }

        override toDOM(): HTMLElement {
            const el = document.createElement('div');
            el.addClass('book-smith-scene-note-marker');
            if (this.isStart) el.addClass('is-start');
            el.setAttr('aria-label', 'Scene note');
            el.dataset.noteId = this.note.id;
            if (this.note.color) {
                el.style.setProperty('--scene-note-color', this.note.color);
            }
            // A simple flag glyph — pure CSS via character, no external icon dependency.
            el.setText('\u2691');
            return el;
        }
    }

    // --- Helpers ---
    const currentFilePath = (view: EditorView): string | null => {
        const info = view.state.field(editorInfoField, false);
        return info?.file?.path || null;
    };

    const findNoteAtLine = (view: EditorView, line: number): SceneNote | null => {
        const path = currentFilePath(view);
        if (!path) return null;
        return manager.findNoteAtLine(path, line);
    };

    // --- The gutter itself ---
    const sceneNotesGutter = gutter({
        class: 'book-smith-scene-notes-gutter',
        lineMarker(view, blockInfo) {
            const path = currentFilePath(view);
            if (!path) return null;
            const line = view.state.doc.lineAt(blockInfo.from).number - 1; // 0-indexed
            const note = manager.findNoteAtLine(path, line);
            if (!note) return null;
            // Only paint the flag on the first line of the paragraph to keep the gutter clean.
            const isStart = line === note.fromLine;
            if (!isStart) return null;
            return new SceneNoteMarker(note, true);
        },
        // Without this, effect-only transactions (like our repaint effect fired
        // from manager.notifyChange) don't cause the gutter to re-query
        // lineMarker, so the flag stays stuck on its pre-edit line.
        lineMarkerChange(update) {
            return update.transactions.some(tr =>
                tr.effects.some(e => e.is(sceneNotesRepaintEffect))
            );
        },
        initialSpacer: () => new SceneNoteMarker(
            {
                id: '__spacer__',
                filePath: '',
                fromLine: 0,
                toLine: 0,
                content: '',
                createdAt: '',
                updatedAt: ''
            },
            true
        ),
        domEventHandlers: {
            mousedown(view, blockInfo, event) {
                const line = view.state.doc.lineAt(blockInfo.from).number - 1;
                const note = findNoteAtLine(view, line);
                if (!note) return false;
                event.preventDefault();
                event.stopPropagation();
                onMarkerClick(note, view);
                return true;
            }
        }
    });

    /**
     * Live anchor tracker — on every document change, maps each note's
     * [fromLine, toLine] range through the transaction's changes so flags
     * follow the text they were attached to.
     *
     * Uses `mapPos(pos, 1)` for `from` (push through an insert at the start)
     * and `mapPos(pos, -1)` for `to` (don't absorb inserts at the end). Writes
     * go through `updateNoteLines`, which only persists on a 500ms debounce.
     * The actual mutation is deferred with `queueMicrotask` so we never call
     * `dispatch` while a CM6 update is still in progress.
     */
    const lineTrackerPlugin = ViewPlugin.fromClass(class {
        update(u: ViewUpdate) {
            if (!u.docChanged) return;
            const path = currentFilePath(u.view);
            if (!path) return;
            const notes = manager.getNotesForFile(path);
            if (notes.length === 0) return;

            const oldDoc = u.startState.doc;
            const newDoc = u.state.doc;
            const pending: Array<{ id: string; fromLine: number; toLine: number }> = [];

            for (const note of notes) {
                const oldLineCount = oldDoc.lines;
                const oldFromLine = Math.max(0, Math.min(note.fromLine, oldLineCount - 1));
                const oldToLine = Math.max(oldFromLine, Math.min(note.toLine, oldLineCount - 1));
                let oldFromPos: number;
                let oldToPos: number;
                try {
                    oldFromPos = oldDoc.line(oldFromLine + 1).from;
                    oldToPos = oldDoc.line(oldToLine + 1).to;
                } catch {
                    continue;
                }

                const mappedFromPos = u.changes.mapPos(oldFromPos, 1);
                const mappedToPos = u.changes.mapPos(oldToPos, -1);

                const clampedFromPos = Math.max(0, Math.min(mappedFromPos, newDoc.length));
                const clampedToPos = Math.max(clampedFromPos, Math.min(mappedToPos, newDoc.length));

                const newFromLine = newDoc.lineAt(clampedFromPos).number - 1;
                const newToLine = newDoc.lineAt(clampedToPos).number - 1;

                if (newFromLine !== note.fromLine || newToLine !== note.toLine) {
                    pending.push({ id: note.id, fromLine: newFromLine, toLine: newToLine });
                }
            }

            // Apply synchronously so the gutter paint later in THIS update
            // cycle sees the new line numbers. `updateNoteLines` defers its
            // own notifyChange via microtask, so no dispatch happens mid-update.
            for (const p of pending) manager.updateNoteLines(p.id, p.fromLine, p.toLine);
        }
    });

    return [sceneNotesGutter, lineTrackerPlugin];
}

/**
 * Nudge all visible editors to repaint their gutters. Call this after
 * note CRUD so flag markers appear/disappear without requiring a user edit.
 */
export function requestGutterRepaint(app: { workspace: { iterateAllLeaves: (cb: (leaf: any) => void) => void } }) {
    app.workspace.iterateAllLeaves((leaf: any) => {
        const view = leaf?.view;
        const cm: EditorView | undefined = view?.editor?.cm;
        if (!cm) return;
        // Dispatch a StateEffect — forces a new view update so gutter.lineMarker reruns.
        cm.dispatch({ effects: sceneNotesRepaintEffect.of(null) });
    });
}
