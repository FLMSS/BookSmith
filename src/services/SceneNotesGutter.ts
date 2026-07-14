import { editorInfoField } from 'obsidian';
import { Compartment, Extension, RangeSet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
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
 *  - Only activates (adds the gutter column) for files under the BookSmith
 *    book root; all other editors are left completely untouched.
 *
 * The manager lookup is live (fresh on each paint) so note additions/removals
 * reflect immediately once the manager notifies and the editor paints.
 */
export function buildSceneNotesGutter(
    manager: SceneNotesManager,
    getBookRoot: () => string | undefined,
    onMarkerClick: (note: SceneNote, view: EditorView) => void
): Extension {
    /** Per-line gutter marker for a scene note. */
    class SceneNoteMarker extends GutterMarker {
        constructor(readonly note: SceneNote) {
            super();
        }

        override eq(other: GutterMarker): boolean {
            if (!(other instanceof SceneNoteMarker)) return false;
            // Include color, fromLine, toLine so the gutter repaints when any
            // visible-affecting property changes — not just the note id.
            return other.note.id === this.note.id
                && (other.note.color || null) === (this.note.color || null)
                && other.note.fromLine === this.note.fromLine
                && other.note.toLine === this.note.toLine;
        }

        override toDOM(): HTMLElement {
            const el = document.createElement('div');
            el.addClass('book-smith-scene-note-marker');
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

    /**
     * Build a RangeSet of markers at the START of each note's fromLine.
     * Using `markers` instead of `lineMarker` avoids CM6's per-line marker
     * cache — every view update recomputes from live manager state, so
     * flags appear the moment notes finish loading (no "stuck empty" cache).
     */
    const buildMarkerSet = (view: EditorView): RangeSet<GutterMarker> => {
        const path = currentFilePath(view);
        if (!path) return RangeSet.empty;
        const notes = manager.getNotesForFile(path);
        if (notes.length === 0) return RangeSet.empty;

        // Sort by fromLine so RangeSetBuilder gets positions in order.
        const sorted = notes.slice().sort((a, b) => a.fromLine - b.fromLine);
        const builder = new RangeSetBuilder<GutterMarker>();
        const lineCount = view.state.doc.lines;
        let lastPos = -1;
        for (const note of sorted) {
            const lineNum = note.fromLine + 1;
            if (lineNum < 1 || lineNum > lineCount) continue;
            const pos = view.state.doc.line(lineNum).from;
            // RangeSetBuilder requires strictly non-decreasing positions and
            // rejects duplicates at the same point — skip if we'd repeat.
            if (pos <= lastPos) continue;
            lastPos = pos;
            builder.add(pos, pos, new SceneNoteMarker(note));
        }
        return builder.finish();
    };

    /**
     * StateField that holds the current marker RangeSet. Rebuilt on:
     *  - document changes (line positions shift)
     *  - our repaint effect (notes added/removed/loaded)
     * The gutter reads this field, so any field update triggers a re-render.
     */
    const markerField = StateField.define<RangeSet<GutterMarker>>({
        create() {
            // Can't build yet — no view. Gutter's markers() will compute live.
            return RangeSet.empty;
        },
        update(value, tr) {
            // RangeSet can map through changes, but since positions come
            // from line numbers in the manager, we'll just invalidate and
            // let the gutter's markers() callback recompute.
            // We only use this field as a "version signal" — the actual
            // markers are produced by the gutter's markers() callback below.
            if (tr.docChanged) return value; // value doesn't matter; gutter recomputes
            for (const e of tr.effects) {
                if (e.is(sceneNotesRepaintEffect)) return value; // force an update notification
            }
            return value;
        }
    });

    // --- The gutter itself ---
    const sceneNotesGutter = gutter({
        class: 'book-smith-scene-notes-gutter',
        markers(view) {
            return buildMarkerSet(view);
        },
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
                let oldText: string;
                try {
                    oldFromPos = oldDoc.line(oldFromLine + 1).from;
                    oldToPos = oldDoc.line(oldToLine + 1).to;
                    oldText = oldDoc.sliceString(oldFromPos, oldToPos);
                } catch {
                    continue;
                }

                // Detect if the entire paragraph range was wiped by a single
                // change — the signature of drag-drop or Alt+Up/Down line moves
                // (delete here, insert there, same content).
                let oldRangeFullyDeleted = false;
                u.changes.iterChanges((fromA, toA) => {
                    if (fromA <= oldFromPos && toA >= oldToPos) {
                        oldRangeFullyDeleted = true;
                    }
                });

                let newFromLine: number;
                let newToLine: number;

                if (oldRangeFullyDeleted && oldText.trim().length > 0) {
                    // Paragraph may have moved. Search the new doc for the
                    // exact text. Require a unique match — if the same text
                    // appears multiple times we can't be sure which one is
                    // ours, so we fall back to position mapping.
                    const newText = newDoc.toString();
                    const first = newText.indexOf(oldText);
                    const second = first !== -1 ? newText.indexOf(oldText, first + 1) : -1;
                    if (first !== -1 && second === -1) {
                        newFromLine = newDoc.lineAt(first).number - 1;
                        newToLine = newDoc.lineAt(first + oldText.length).number - 1;
                    } else {
                        // Not found (actually deleted) or ambiguous.
                        const mappedFromPos = u.changes.mapPos(oldFromPos, 1);
                        const clampedFromPos = Math.max(0, Math.min(mappedFromPos, newDoc.length));
                        newFromLine = newDoc.lineAt(clampedFromPos).number - 1;
                        newToLine = newFromLine;
                    }
                } else {
                    // Normal edit — position mapping is sufficient.
                    const mappedFromPos = u.changes.mapPos(oldFromPos, 1);
                    const mappedToPos = u.changes.mapPos(oldToPos, -1);
                    const clampedFromPos = Math.max(0, Math.min(mappedFromPos, newDoc.length));
                    const clampedToPos = Math.max(clampedFromPos, Math.min(mappedToPos, newDoc.length));
                    newFromLine = newDoc.lineAt(clampedFromPos).number - 1;
                    newToLine = newDoc.lineAt(clampedToPos).number - 1;
                }

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

    // --- Per-editor activation via Compartment ---
    //
    // The gutter extension is registered globally, but we only want the gutter
    // column (and its 22px layout cost) in editors whose file lives under the
    // BookSmith book root. Files outside that folder get an empty compartment —
    // no gutter, no layout shift, no markers.
    //
    // The routerPlugin checks the file path on construction (initial open) and
    // on every ViewUpdate where the path changes (tab switch). Reconfiguration
    // is deferred via queueMicrotask so it never dispatches mid-update.
    const gutterCompartment = new Compartment();
    const activeExtensions: Extension = [markerField, sceneNotesGutter, lineTrackerPlugin];

    const isBookSmithFile = (view: EditorView): boolean => {
        const path = currentFilePath(view);
        const root = getBookRoot();
        return !!(path && root && (path === root || path.startsWith(root + '/')));
    };

    const scheduleReconfigure = (view: EditorView, active: boolean) => {
        queueMicrotask(() => {
            try {
                view.dispatch({ effects: gutterCompartment.reconfigure(active ? activeExtensions : []) });
            } catch {
                // View was destroyed before the microtask ran — safe to ignore.
            }
        });
    };

    const routerPlugin = ViewPlugin.fromClass(class {
        private trackedPath: string | null = null;

        constructor(view: EditorView) {
            this.trackedPath = currentFilePath(view);
            scheduleReconfigure(view, isBookSmithFile(view));
        }

        update(u: ViewUpdate) {
            const newPath = currentFilePath(u.view);
            if (newPath === this.trackedPath) return;
            this.trackedPath = newPath;
            scheduleReconfigure(u.view, isBookSmithFile(u.view));
        }
    });

    // Start empty; routerPlugin activates the gutter for BookSmith files.
    return [gutterCompartment.of([]), routerPlugin];
}

/**
 * Nudge all visible editors to repaint their gutters. Call this after
 * note CRUD so flag markers appear/disappear without requiring a user edit.
 *
 * Dispatches both:
 *   - our repaint effect (for any logic keying off it)
 *   - a selection "no-op" (anchor to current anchor) to guarantee CM6
 *     treats it as a user-like transaction and re-runs gutter markers().
 */
export function requestGutterRepaint(app: { workspace: { iterateAllLeaves: (cb: (leaf: any) => void) => void } }) {
    app.workspace.iterateAllLeaves((leaf: any) => {
        const view = leaf?.view;
        const cm: EditorView | undefined = view?.editor?.cm;
        if (!cm) return;
        try {
            cm.dispatch({ effects: sceneNotesRepaintEffect.of(null) });
        } catch (err) {
            console.warn('SceneNotes repaint dispatch failed:', err);
        }
    });
}
