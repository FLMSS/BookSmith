# Book Smith+

**Book Smith+** is a long-form writing and book-management plugin for [Obsidian](https://obsidian.md). It helps you organize a manuscript into chapters, track your writing progress, annotate scenes, and export the finished work.

> This is a fork of [yeban8090/book-smith](https://github.com/yeban8090/book-smith) by Yeban, with a rebuilt statistics engine, a new Scene Notes system, screenplay/Fountain support, and a range of UI and reliability improvements. See [Differences from upstream](#differences-from-upstream) below.

## Features

- **📚 Project management** — Create and manage multiple book projects, each with custom templates, a cover image, and basic metadata.
- **📑 Chapter management** — Tree-structured chapter view with drag-and-drop reordering, status markers, and flexible folder organization.
- **📊 Writing statistics** — Real-time word counts, progress tracking against goals, per-day writing volume, and a calendar heatmap. Configurable bottom-left stat block (see below).
- **🎬 Scene Notes** — Paragraph-anchored notes shown in the editor gutter, with titles, dates, colored flags, and drag-tracking. Notes are consolidated per book and ordered to match your chapter structure. Clicking a note glows its paragraph in the editor.
- **🎯 Focus mode** — Pomodoro-style focused writing with customizable work/break durations, writing-data tracking, and interruption stats.
- **📝 Reference management** — Create references from selected text with automatic numbering, bibliography generation, and search.
- **🎭 Screenplay / Fountain support** — A screenplay template and Fountain-aware editing (including block-comment highlighting).
- **📤 Export** — Export your manuscript to multiple formats.

### Configurable left-pane stats

The bottom-left statistics block is fully customizable in **Project Settings → Left Pane Stats**:

- **Current file** — word/page count of the active file (only for files inside a book folder).
- Toggle any row on or off: Today, Current file, Total, Completion, Writing days, Daily average.
- Reorder rows with the ▲/▼ buttons.
- **Reset to default order** restores the original order and re-enables all rows.
- Switch the whole block between **words** and **pages** mode.

## Installation

This fork is not in the Obsidian community plugin directory. Install it manually:

### From a release (if available)
1. Download `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/FLMSS/BookSmith/releases) page.
2. Copy them into `{vault}/.obsidian/plugins/book-smith-fork/`.
3. Restart Obsidian and enable **Book Smith+** in **Settings → Community plugins**.

### Building from source
1. Clone this repository and run `npm install`.
2. Run `npm run build` to produce `main.js`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into `{vault}/.obsidian/plugins/book-smith-fork/`.
4. Restart Obsidian and enable the plugin.

## Usage

1. After enabling the plugin, open the Book Smith+ view from the left sidebar.
2. Click **New Project** to create your first book.
3. From the view you can create and edit chapters, manage book info, add scene notes, and track statistics.
4. Select text and use the right-click menu to create and manage references.
5. Enter **Focus mode** to write in timed sessions and track your output.

## Differences from upstream

Relative to [yeban8090/book-smith](https://github.com/yeban8090/book-smith), this fork adds/changes:

- A **Scene Notes** system (gutter-anchored notes, titles, dates, colored flags, drag-tracking, multi-book auto-detect, and editor glow-on-click).
- A rebuilt **statistics engine** with real-time updates and write-then-delete desync fixes.
- A **configurable left-pane stat block** (per-row visibility, reordering, current-file count, reset).
- **Screenplay / Fountain** template and editing support.
- **Responsive UI** — toolbar collapses on narrow sidebars; the statistics calendar nav compresses cleanly (labels collapse to arrows) instead of overflowing.
- **Render-time disk reconciliation** so externally added/removed files stay in sync with the file tree.
- **Auto-switch to a file's project** when opening a file from a different book.

## Cross-platform support

Works on both desktop and mobile Obsidian.

## Languages

The plugin interface supports Simplified Chinese and English.

## Credits

- Original plugin: [Book Smith](https://github.com/yeban8090/book-smith) by **Yeban** ([@yeban8090](https://github.com/yeban8090)).
- Fork maintained by **FelMNZ** ([@FLMSS](https://github.com/FLMSS)).

## License

MIT License. See [LICENSE](LICENSE) for details.

## Feedback

Found a bug or have a suggestion? Please open an issue on [GitHub](https://github.com/FLMSS/BookSmith/issues).
