import type { App } from 'obsidian';

// Tasks 8.4.0/8.5.0 integration. Its apiV1 offers modals and toggling, but no
// source-position lookup. These DOM classes and getTasks() are internal and
// must be rechecked after a Tasks upgrade. A mismatch returns null.
const ROW = 'li.plugin-tasks-list-item';
const DESCRIPTION = '.tasks-list-text .task-description';
// Reading View uses block-language-tasks. In Live Preview Obsidian 1.13.7
// wraps the processor in cm-preview-code-block.cm-lang-tasks.
const QUERY = '.block-language-tasks, .cm-preview-code-block.cm-lang-tasks';
const CALLOUT = '.callout';
const RESULT = 'ul.plugin-tasks-query-result';
const NATIVE_CONTROL = 'a, button, input, textarea, select, label, [role="button"], [contenteditable], [draggable="true"], .edit-block-button, .clickable-icon, .callout-title, .task-priority, .task-due, .task-scheduled, .task-start, .task-created, .task-done, .task-cancelled, .task-recurring, .task-onCompletion, .task-dependsOn, .task-id, .task-block-link, .task-list-item-checkbox';

export type QueryHit = { kind: 'description' | 'background' | 'control'; root: Element };

export function captureAction(kind: QueryHit['kind'], type: 'pointerdown' | 'mousedown' | 'click'):
  'block' | 'prevent-focus' | 'native' {
  if (kind !== 'control') return 'block';
  return type === 'mousedown' ? 'prevent-focus' : 'native';
}

export function queryHit(target: Element): QueryHit | null {
  const root = target.closest(QUERY) ?? target.closest(CALLOUT);
  if (!root?.querySelector(RESULT)) return null;
  const description = target.closest(DESCRIPTION);
  const native = target.closest(NATIVE_CONTROL + ', .tag');
  const isNative = !!native && root.contains(native);
  if (description && target.closest(ROW)?.closest(RESULT) &&
      !isNative) return { kind: 'description', root };
  if (isNative) return { kind: 'control', root };
  return { kind: 'background', root };
}

export type CachedTask = {
  path: string;
  description: string;
  originalMarkdown: string;
  taskLocation: { lineNumber: number; path: string };
  status: { symbol: string };
  getLinkText(options: { isFilenameUnique: boolean }): string | null;
  parent?: ParentItem | null;
};

export type ParentItem = {
  path: string;
  description: string;
  originalMarkdown: string;
  taskLocation: { lineNumber: number; path: string };
  parent?: ParentItem | null;
};

// Tasks includes plain list items in the ancestor chain as well as tasks.
// Do not infer ancestry from query order: filtering and sorting change it.
export function parentChain(task: CachedTask): ParentItem[] {
  const chain: ParentItem[] = [];
  const seen = new Set<ParentItem>([task]);
  let childLine = task.taskLocation.lineNumber;
  for (let item = task.parent; item; item = item.parent) {
    if (seen.has(item) || item.path !== task.path ||
        !Number.isInteger(item.taskLocation?.lineNumber) ||
        item.taskLocation.lineNumber < 0 || item.taskLocation.lineNumber >= childLine ||
        typeof item.description !== 'string' || typeof item.originalMarkdown !== 'string') return [];
    seen.add(item);
    childLine = item.taskLocation.lineNumber;
    chain.unshift(item);
  }
  return chain;
}

type TasksPlugin = { manifest?: { version: string }; getTasks?: () => CachedTask[] };

function installedTasks(app: App): TasksPlugin | null {
  const plugins = (app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
  const plugin = plugins?.['obsidian-tasks-plugin'] as TasksPlugin | undefined;
  return plugin?.manifest && ['8.4.0', '8.5.0'].includes(plugin.manifest.version) &&
    typeof plugin.getTasks === 'function' ? plugin : null;
}

export function hasSupportedTasks(app: App): boolean { return !!installedTasks(app); }

export function displayText(markdown: string): string {
  return markdown
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/\*\*|__|(?<!\w)[*_](?!\s)/gu, '')
    .replace(/\s+/gu, ' ').trim();
}

function rowDescription(row: Element): string | null {
  return row.querySelector(DESCRIPTION)?.textContent?.replace(/\s+/gu, ' ').trim() ?? null;
}

function uniqueFilename(app: App, task: CachedTask): boolean {
  const basename = task.path.split('/').pop();
  return !!basename && app.vault.getMarkdownFiles().filter(file => file.name === basename).length === 1;
}

function matches(app: App, row: HTMLElement, task: CachedTask): boolean {
  if (!task.path || !Number.isInteger(task.taskLocation?.lineNumber)) return false;
  if (row.dataset.task !== task.status?.symbol.trim()) return false;
  if (rowDescription(row) !== displayText(task.description)) return false;
  const backlink = row.querySelector('.tasks-backlink > a');
  if (!backlink) return true; // A unique vault-wide match remains safe without backlink.
  return backlink.textContent?.trim() === task.getLinkText({ isFilenameUnique: uniqueFilename(app, task) })?.trim();
}

export type ResolvedRow = { task: CachedTask; descriptionElement: HTMLElement; row: HTMLElement };

export function isKnownTaskDescription(app: App, target: Element): boolean {
  return !!installedTasks(app) && queryHit(target)?.kind === 'description';
}

export function isInertQuerySpace(app: App, target: Element): boolean {
  return !!installedTasks(app) && queryHit(target)?.kind === 'background';
}

export function createRowResolver(app: App): (target: Element) => ResolvedRow | null {
  const plugin = installedTasks(app);
  if (!plugin) return () => null;
  const index = new Map<string, CachedTask[]>();
  try {
    for (const task of plugin.getTasks!()) {
      const key = task.status.symbol.trim() + '\n' + displayText(task.description);
      const bucket = index.get(key) ?? [];
      bucket.push(task);
      index.set(key, bucket);
    }
  } catch {
    return () => null;
  }
  return target => resolveIndexedRow(app, target, index);
}

function resolveIndexedRow(app: App, target: Element, index: Map<string, CachedTask[]>): ResolvedRow | null {
  const descriptionElement = target.closest(DESCRIPTION);
  const row = target.closest(ROW);
  const query = row?.closest(QUERY);
  if (!descriptionElement?.instanceOf(HTMLElement) || !row?.instanceOf(HTMLElement) || !query) return null;
  if (!row.closest(RESULT)) return null;
  let tasks: CachedTask[];
  try {
    const key = (row.dataset.task ?? '') + '\n' + rowDescription(row);
    tasks = (index.get(key) ?? []).filter(task => matches(app, row, task));
  } catch (error) {
    console.warn('Tasks Inline Edit: verified Tasks integration changed', error);
    return null;
  }
  if (tasks.length === 0) return null;
  if (tasks.length === 1) return { task: tasks[0], descriptionElement, row };

  // data-line is a position inside the rendered query group, *not* a source
  // line. Two identical rows cannot be safely distinguished by the DOM.
  return null;
}

export function resolveRow(app: App, target: Element): ResolvedRow | null {
  return createRowResolver(app)(target);
}

export function plainDescriptionTarget(target: Element): boolean {
  const description = target.closest(DESCRIPTION);
  if (!description) return false;
  // Links, tags, controls and context menus belong to Tasks/Obsidian.
  return !target.closest(NATIVE_CONTROL + ', .tag');
}
