# Manual acceptance

Use a disposable source note and a separate query note. Never use private tasks for public screenshots.

1. Add short and wrapping plain-text tasks, including a priority, a due date and a trailing tag. Query only that source note.
2. In Live Preview, click plain description text. Confirm a borderless caret appears, the first text line stays next to the checkbox, and the query source remains hidden. Repeat in Reading view.
3. Append text and press Enter. Compare the source note against its original: only that description must change; suffix metadata and other lines must remain byte-identical.
4. Enter another change and press Escape. Confirm the source stays unchanged. Test saving by clicking blank query space.
5. Check the status menu, checkbox, pencil, due-date picker and a link. Check ordinary Markdown task capture above the query.
6. Try duplicate task mappings, a changed source line and an unsaved source editor. Confirm the edit is refused rather than overwriting data. Unit tests also cover source conflicts and duplicate-line ambiguity.

## Layout regression, 2026-10-14

Actual Tasks-rendered rows in Obsidian 1.13.7 / Tasks 8.5.0, Nord theme, macOS:

| Long plain description | Before editing | During editing |
| --- | ---: | ---: |
| 0.1.1 first text y | 393.12 px | 414.93 px |
| 0.1.1 row height | 46.22 px | 88.22 px |
| 0.1.2 first text y | 393.12 px | 393.12 px |
| 0.1.2 row height | 46.22 px | 46.22 px |

The description changed from `inline` to `inline-block`, making it an atomic box that did not fit after the checkbox. Release 0.1.2 keeps `inline` flow; no minimum width is injected. Raw Markdown links may still reflow naturally because their editable syntax is longer than rendered link labels.

Screenshots use neutral example tasks. Status symbols and callout colors shown belong to separate vault CSS and do not ship with the plugin.
