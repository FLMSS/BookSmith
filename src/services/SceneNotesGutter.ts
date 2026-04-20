import { editorInfoField } from 'obsidian';
import { Extension, StateEffect } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
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
            return other.note.id === this.note.id && other.isStart === this.isStart;
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

    return [sceneNotesGutter];
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
