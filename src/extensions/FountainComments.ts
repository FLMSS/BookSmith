import { Extension, StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

/** Matches /* ... *\/ block comment spans (non-greedy, cross-line). */
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

const commentMark = Decoration.mark({ class: 'cm-fountain-comment' });

function buildDecorations(docText: string): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    BLOCK_COMMENT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BLOCK_COMMENT_RE.exec(docText)) !== null) {
        builder.add(match.index, match.index + match[0].length, commentMark);
    }
    return builder.finish();
}

const fountainCommentField = StateField.define<DecorationSet>({
    create(state) {
        return buildDecorations(state.doc.toString());
    },
    update(deco, tr) {
        if (!tr.docChanged) return deco;
        return buildDecorations(tr.newDoc.toString());
    },
    provide: f => EditorView.decorations.from(f),
});

/** CM6 extension that marks Fountain /* ... *\/ block comments with
 *  the CSS class `cm-fountain-comment`. Does not alter document content. */
export const fountainCommentExtension: Extension = [fountainCommentField];
