import { Component, MarkdownView, Notice, TFile, type App } from 'obsidian';
import { createRowResolver, displayText, parentChain, type ParentItem } from './tasks-adapter';

const CONTEXT = 'tasks-parent-context';
const ROWS = '.plugin-tasks-query-result li.plugin-tasks-list-item';

/** Adds read-only context to query results; never changes task sources or filters. */
export class ParentContext extends Component {
  private observer: MutationObserver | null = null;
  private timer: number | null = null;
  private stopped = false;

  constructor(private app: App) { super(); }

  onload(): void {
    this.stopped = false;
    this.observer = new MutationObserver(records => {
      // Ignore ordinary typing elsewhere in the note. Query insertion/removal,
      // text edits and status changes can all invalidate row-to-source mappings.
      if (records.some(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return !!element?.closest('.plugin-tasks-query-result') ||
          [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node => node instanceof Element &&
            (node.matches('.plugin-tasks-query-result') || !!node.querySelector('.plugin-tasks-query-result')));
      })) this.schedule();
    });
    this.observe();
    this.registerEvent(this.app.workspace.on('layout-change', () => this.schedule()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.schedule()));
    this.schedule();
  }

  private observe(): void {
    this.observer?.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-task', 'contenteditable'],
    });
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; this.refresh(); }, 150);
  }

  private refresh(): void {
    // Own DOM additions must not trigger another refresh.
    this.observer?.disconnect();
    try {
      const resolve = createRowResolver(this.app);
      for (const row of Array.from(document.querySelectorAll<HTMLElement>(ROWS))) {
        if (row.querySelector('.tasks-inline-edit-active')) continue;
        row.querySelectorAll(`:scope > .${CONTEXT}`).forEach(el => el.remove());
        // A visible tree already provides context. Only decorate flat results.
        if (row.parentElement?.closest('li.plugin-tasks-list-item')) continue;
        const description = row.querySelector<HTMLElement>('.task-description');
        if (!description) continue;
        const resolved = resolve(description);
        const parents = resolved ? parentChain(resolved.task).filter(parent => displayText(parent.description)) : [];
        if (!parents.length) continue;
        const context = createSpan({ cls: CONTEXT });
        context.createSpan({ text: '↳ ', attr: { 'aria-hidden': 'true' } });
        parents.forEach((parent, index) => {
          if (index) context.createSpan({ text: ' → ', attr: { 'aria-hidden': 'true' } });
          const label = displayText(parent.description);
          const link = context.createEl('a', {
            text: label, href: '#',
            attr: { 'aria-label': `Открыть контекст: ${label}`, title: `${parent.path}:${parent.taskLocation.lineNumber + 1}` },
          });
          link.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            void this.openParent(parent);
          });
        });
        row.appendChild(context);
      }
    } finally { if (!this.stopped) this.observe(); }
  }

  private async openParent(parent: ParentItem): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(parent.path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    const line = parent.taskLocation.lineNumber;
    // Never jump to a different task after an external edit or stale cache.
    if (content.split(/\r?\n/u)[line] !== parent.originalMarkdown ||
        this.app.workspace.getLeavesOfType('markdown').some(leaf =>
          leaf.view instanceof MarkdownView && leaf.view.getMode() === 'source' && leaf.view.file?.path === file.path &&
          leaf.view.editor.getValue() !== content)) {
      new Notice('Контекст задачи обновляется. Повторите переход после сохранения заметки.');
      this.schedule();
      return;
    }
    // Reading view ignores line-only ephemeral state when reopening the same
    // file. Use the editor so the link always lands on the actual source line.
    await this.app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' }, eState: { line } });
  }

  onunload(): void {
    this.stopped = true;
    this.observer?.disconnect();
    if (this.timer !== null) window.clearTimeout(this.timer);
    document.querySelectorAll(`.${CONTEXT}`).forEach(el => el.remove());
  }
}
