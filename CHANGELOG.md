# Changelog

## 0.1.2

First public release of Tasks Inline Edit.

- Edit descriptions directly in rendered Tasks queries: Enter saves, Escape cancels, and leaving the description saves changes.
- Keep queries rendered when clicking empty query or task callout space in Live Preview.
- Preserve native checkbox, status-menu, pencil, date and link actions.
- Support Tasks 8.4.0 and 8.5.0 with conservative source mapping and conflict checks.
- Fix long descriptions moving to the next line when editing begins: keep inline layout and remove width locking.
- Preserve source suffix metadata and refuse ambiguous or stale source mappings.

Validation: TypeScript checks and 12 automated tests passed. Real Obsidian 1.13.7 / Tasks 8.5.0 acceptance on macOS verified short and wrapped descriptions, Enter, Escape, and source metadata preservation. The long plain-text example previously moved down 21.8 CSS pixels; its first line now stays in place.

Download `main.js`, `manifest.json`, and `styles.css`, or unpack `tasks-inline-edit-0.1.2.zip` into your vault's plugin directory. See the README for compatibility and installation. `SHA256SUMS.txt` and GitHub artifact attestations identify the published build.
