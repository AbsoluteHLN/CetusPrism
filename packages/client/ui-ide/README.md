---
description: "The IDE workspace surface: a session's project tree on the left, its code in the middle and its assistant conversation on the right."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-ide

English | [中文](README.zh.md)

The IDE workspace surface: a session's project tree on the left, the code being edited in the middle, and that same session's assistant conversation on the right — the coding front end of CetusPrism, in the application's own design language.

The IDE belongs to ONE session. Its left column is that session's workspace, its middle column is the file being edited, and its right column is that session's conversation — a second, explicitly bound occurrence of the shared conversation content, independent of the conversation frame the app shows in the central column.

The surface carries its own identity: a title bar over the three columns names the IDE, the session it is bound to and the project it shows, and every column carries a header of its own, so the surface reads as a workbench rather than as a conversation page with three panes. The code column is an EDITOR: the file is the user's to change, and the changes go back to disk.

## Summary

The IDE workspace surface: a session's project tree on the left, its code in the middle and its assistant conversation on the right.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### The workspace model

`ide-model.ts` holds the workspace's own state: the bound session, the listed directory levels, the expanded directories and the open files in tab order. Every change is a pure function over that state, so the model is testable without a Remote, a filesystem or a browser.

```ts
import { bindSession, openFile, closeFile, activeFile } from '@deepseek-ai/dsh-client-ui-ide/client'

let state = bindSession(state, sessionId, '/project', reference)
state = openFile(state, { path: '/project/a.ts', name: 'a.ts', language: 'typescript', content: '' })
state = closeFile(state, '/project/a.ts')
```

Binding another session starts the workspace over — the tree and the tab strip are that session's project. Binding the same session again keeps them, so the workspace survives being left and re-entered. Opening a file that is already open re-opens it rather than duplicating the tab, and closing the active tab hands the surface to its neighbour instead of leaving an empty pane.

### The project tree

`ide-tree.ts` projects the listed levels into the rows the left column renders: directories before files, each group sorted by name, and every row carrying its depth. A directory is listed only when it opens, so the workspace holds what the user has actually looked at. A filter keeps the ANCESTORS of a match — a file whose parent folder does not match the query stays reachable, because the path that reached it is what the user typed — and a filtered tree walks every listed level, not only the expanded ones.

The tree FOLLOWS the workspace: every listed level is OBSERVED through the Host's file watch, and one observation re-lists that level and re-reads the clean open files under it, so the Agent's writes reach the tree without a hand-driven refresh. A dirty editor is never reread over — the observation serves the disk's truth, not the editor's — and a failed watch goes silently, because a tree refreshed by hand is still a working tree.

### The code surface

The middle column is an EDITOR, not a picture of a file. `IdeCodeEditor` lays a transparent text area over a highlighted layer, so the browser keeps the caret, the selection and the undo stack, while the source behind it wears the same grammar the rest of the product uses. Three things a code view must get right, it gets right:

- The text does not WRAP. A source line is a line; a narrow column scrolls sideways instead of breaking a word in half.
- The line numbers do not clip. The gutter is a column of its own, wide enough for the file's own line count, and it scrolls with the text.
- The code fills the column. There is no floating card inside the pane and no margin around the text: the pane IS the code.

Ctrl+S (Cmd+S) writes the file back, and Tab inserts two spaces instead of leaving the surface. The caret's line and column are reported to the status bar, which sits under the code it describes.

### The way a file changes

An edit makes the file DIRTY: its tab carries a dot, and the column offers a save button. The write names the version the editor read, so a file the Agent rewrote under the editor is refused rather than overwritten — the edits stay on screen and the status bar says why. The write is confined to the session's workspace root and runs under that session's own sandbox mode: a read-only session cannot be edited at all. A re-read never throws the user's edits away: a dirty file keeps them.

### The surface

`IdeWorkspace` renders the three columns from the workspace service: the project tree on the left, the tab strip and the editor in the middle, the assistant column on the right. It is a controlled component: it reads the state from the store it is handed and calls back with the verbs, so the same surface serves the web client, the desktop shell and the tests.

Above the columns sits the title bar: the IDE's mark, the bound session's title, the project root as breadcrumb steps, and the two verbs that leave the surface — refresh and back to the conversation. Under it, `IdePaneHeader` gives each column the same header shape: an icon, the column's name, and the detail that column knows best — the project root, the open file's language, the session's title.

The path is a crumb RUN, not a string to squeeze: every step keeps its own width, and when the title bar no longer has room for it the middle steps fold into a single `…` crumb, so the project name — the last step — stays readable instead of collapsing into single letters.

The tree reads like an IDE's file tree: folders carry a folder icon that follows their state, files carry their own type icon, and a file that is open in the tab strip keeps a marker, with the current one wearing the accent.

The columns are not welded shut. A separator sits on each edge of the middle column and drags that column's width — with the pointer or the arrow keys — and the tree column collapses to an icon rail. The WIDTHS are the editor's first: the code column is what the workbench exists for, so each side column is capped by its share of the frame, and the code keeps its minimum while any side column can still give way. The tree gives way first, the assistant second, and the code never. The assistant folds to its own icon rail with one click. The layout is remembered locally, so the widths a user settles on are the widths they get back.

### The way in

The IDE is entered from a SESSION, not from the navigation. The plugin registers the surface in the layout's central panel under the key `ide`, and registers a menu row and a row button on every session row: one click opens the IDE for that session, binds the workspace to its project and shows its conversation beside the code.

The IDE takes the frame: the application's own sidebar is collapsed while the IDE is on screen and restored when it leaves, because the workbench is the tree, the code and the assistant — not the tree, the code, the assistant and the navigation. The layout face names which state it wants (`ctx.layout.setSidebarCollapsed`), because a toggle cannot tell "entered" from "left".

<a id="understand-the-implementation"></a>
## Understand the implementation

### The service and the file source

`createIdeWorkspace()` owns the state and the verbs. The FILES come from the Host's `workspaceFiles` Remote namespace, bound to the session the workspace belongs to:

```ts
const workspace = createIdeWorkspace(createFilesPort(ctx.remote))
workspace.bind(sessionId, cwd, reference)
```

A directory listing speaks workspace paths and is confined to the session's workspace root; a file read follows the composed filesystem's read authority and is paged, because a whole file may be larger than one page. One listing or read is in force per path: asking again retires the request still in flight for it.

The same namespace carries the WRITE. `workspaceFiles.write` replaces one file's text under the session's own sandbox mode, guarded by the version the caller read, and confined to the session's workspace root — a read may reach beyond the workspace, an edit may not. It is the exception to the read authority, and the only path in the namespace that mutates anything.

The same namespace also OBSERVES. `workspaceFiles.changes` streams one directory's filesystem notifications through the Remote's supervised stream — one watch per listed level, opened when the level settles and ended when the binding goes away.

### The assistant column

The right column renders the SHARED conversation content in its `embedded` variant under an explicit session binding. The conversation itself is not re-implemented here — the shared content factory owns the message flow, the composer and the views; the column only decides WHICH session it speaks for.

The column asks that content for its REDUCED composer: the text surface, the command button and the submit action, and nothing else. The access mode, the computer-use delivery switch, the agent preset and backend, the plan mode, the model selector and the metric row belong to the product's own conversation panel — a second copy of them in a side column is noise, and the computer-use switch has no business beside a code view. The reduction is opt-in and owned by the host: `variant: 'embedded'` keeps its meaning for the Sidebar's subagent chat, and the main panel never asks for the reduced form. The column starts at 420px, narrower than the tree it sits next to, because it holds less.

The column hosts that conversation in a flex box of its own height, the way the Sidebar's subagent chat does. The conversation therefore owns the scrolling: the transcript scrolls under the composer, which stays pinned to the bottom of the column, and the column itself never scrolls as one block.

### The skin

The surface wears the application's own token layer (`--dsw-*`), so it follows the active theme — light or dark, Folio or the classic palette — without a second set of colours of its own. The geometry is the soft one: 4px controls, 6px cards, hairline separators instead of shadows, and a single accent for the things that are actually current.

More than the tokens, the SHAPES come from the product too, so the IDE reads as a panel of CetusPrism rather than as a second product wearing a code editor's skin. Its title bar is the conversation header's geometry: one row at the 20/28px side padding, a 0.5px l3 rule under it, the session title as the current crumb and the project path as its ancestor crumbs, separated by `/`. Its column headers are section labels — 13px secondary text, a 14px outline glyph, ghost icon buttons — with no band behind them and no rule under them. Its tab strip is the conversation's view tabs: 13px/500, tertiary, the active one business-primary under a 2px bar. Its file tree rows are the Sidebar's rows: radius-md and the interactive hover fill, for the hovered row and the current one alike. Its status bar is the composer's metric row: flat, 12px, tertiary.

<a id="further-exploration"></a>
## Further Exploration

- `packages/client/ui-layout` — the central panel this surface mounts into.
- `packages/client/ui-conversation` — the shared conversation content the assistant column renders.
- `packages/client/ui-primitives` — the shared highlighter the code surface draws its grammar with.
- `packages/api/workspace-files` — the Remote namespace the tree and the code read and write through.

<a id="model-experience"></a>
## Model Experience

None, as the browser-only IDE surface registers no tool, prompt section, or session event.

#### KV Cache effect

The surface renders the files it reads, writes back the files it edits and re-renders the session's conversation; nothing it shows enters a model request, and opening or editing a file changes no session state.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A file read stops after four pages of five thousand lines and says so; the rest of a very large file is not shown.
- The IDE keeps one retained session at a time; binding another session releases the previous one.
- A write replaces the whole file: there is no patch, no multi-file edit and no rename.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
