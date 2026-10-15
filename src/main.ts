import { Component, MarkdownRenderer, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { applyEdit, parseTaskLine, snapshotAt, type Snapshot } from './line';
import { captureAction, hasSupportedTasks, queryHit, resolveRow, type ResolvedRow } from './tasks-adapter';
import { ParentContext } from './parent-context';

type Editing = {
  resolved: ResolvedRow;
  editor: HTMLElement;
  originalNodes: DocumentFragment;
  listeners: AbortController;
  snapshot: Snapshot;
  file: TFile;
  original: string;
  done: boolean;
};

function clickedTextOffset(event: MouseEvent, description: HTMLElement): number | null {
  const rangeAtPoint = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (!rangeAtPoint || !description.contains(rangeAtPoint.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(description);
  before.setEnd(rangeAtPoint.startContainer, rangeAtPoint.startOffset);
  return before.toString().length;
}

function placeCaret(editor: HTMLElement, offset: number): void {
  const text = editor.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return;
  const range = document.createRange();
  range.setStart(text, Math.min(offset, text.textContent?.length ?? 0));
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export default class TasksInlineEdit extends Plugin {
  settings = { showParentContext: true };
  private parentContext: ParentContext | null = null;
  private editing: Editing | null = null;
  private guardedRoots = new WeakSet<Element>();
  private guardedEditors = new WeakSet<Element>();

  private guardNativeClick(root: HTMLElement): void {
    const editor = root.closest('.cm-embed-block')?.closest('.cm-content');
    if (!editor?.instanceOf(HTMLElement)) return;
    if (this.guardedRoots.has(root)) return;
    this.guardedRoots.add(root);
    // Pointer and mouse handlers on the actual control run before these.
    for (const type of ['pointerdown', 'mousedown'] as const) {
      this.registerDomEvent(root, type, (event: MouseEvent | PointerEvent) => {
        if (event.target instanceof Element && queryHit(event.target)?.kind === 'control') {
          event.stopPropagation();
        }
      });
    }
    if (this.guardedEditors.has(editor)) return;
    this.guardedEditors.add(editor);
    // Obsidian delegates Markdown links on cm-content. This listener is added
    // later, so links open first; only the outer editor click is suppressed.
    this.registerDomEvent(editor, 'click', (event: MouseEvent) => {
      if (event.target instanceof Element && queryHit(event.target)?.kind === 'control') {
        event.stopPropagation();
      }
    });
  }

  async onload(): Promise<void> {
    const stored = await this.loadData();
    this.settings = { showParentContext: stored?.showParentContext !== false };
    this.addSettingTab(new TasksInlineEditSettings(this));
    this.updateParentContext();
    const root = window;
    for (const event of ['pointerdown', 'mousedown'] as const) {
      this.registerDomEvent(root, event, (e: MouseEvent | PointerEvent) => {
        if (e.button !== 0 || !(e.target instanceof Element)) return;
        if (this.editing?.editor.contains(e.target)) {
          e.stopImmediatePropagation(); // Keep caret placement native while blocking CodeMirror.
          return;
        }
        const hit = queryHit(e.target);
        if (!hit) return;
        if (hit.root.instanceOf(HTMLElement)) this.guardNativeClick(hit.root);
        const action = captureAction(hit.kind, event);
        if (action === 'prevent-focus') {
          // A mouse-down focus transfer can select the fenced source before
          // Tasks receives its click. The click and its default action remain.
          e.preventDefault();
          return;
        }
        if (action === 'block') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }, true);
    }
    this.registerDomEvent(root, 'click', (e: MouseEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element)) return;
      if (this.editing?.editor.contains(e.target)) {
        e.stopImmediatePropagation();
        return;
      }
      const hit = queryHit(e.target);
      if (!hit || captureAction(hit.kind, 'click') === 'native') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (hit.kind === 'background') {
        if (this.editing) void this.save(this.editing);
        return;
      }
      if (!hasSupportedTasks(this.app)) {
        new Notice('Tasks Inline Edit: эта версия Tasks ещё не проверена. Используйте кнопку 📝 для редактирования; исходная задача не изменена.');
        return;
      }
      const resolved = resolveRow(this.app, e.target);
      if (!resolved) {
        new Notice('Tasks Inline Edit: не удалось однозначно найти исходную задачу; файл не изменён.');
        return;
      }
      void this.open(resolved, clickedTextOffset(e, resolved.descriptionElement));
    }, true);
    this.registerDomEvent(root, 'focusin', (e: FocusEvent) => {
      if (e.target instanceof Node && this.editing?.editor.contains(e.target)) {
        e.stopImmediatePropagation();
      }
    }, true);
  }

  onunload(): void {
    this.cancel();
  }

  async setShowParentContext(enabled: boolean): Promise<void> {
    const next = { ...this.settings, showParentContext: enabled };
    // Do not change the running feature if persisting the preference fails.
    await this.saveData(next);
    this.settings = next;
    this.updateParentContext();
  }

  private updateParentContext(): void {
    if (this.settings.showParentContext && !this.parentContext) {
      this.parentContext = this.addChild(new ParentContext(this.app));
    } else if (!this.settings.showParentContext && this.parentContext) {
      // Unload removes labels, disconnects observers and cancels pending work.
      this.removeChild(this.parentContext);
      this.parentContext = null;
    }
  }

  private async open(resolved: ResolvedRow, clickedOffset: number | null): Promise<void> {
    if (this.editing) {
      if (this.editing.resolved.row === resolved.row) return;
      await this.save(this.editing);
      if (this.editing) return;
    }
    const file = this.app.vault.getAbstractFileByPath(resolved.task.path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    if (this.hasUnsavedEditorBuffer(file, content)) {
      new Notice('Tasks Inline Edit: дождитесь сохранения изменений в открытой заметке и повторите клик.');
      return;
    }
    const snapshot = snapshotAt(content, resolved.task.taskLocation.lineNumber);
    if (!snapshot || snapshot.line !== resolved.task.originalMarkdown) {
      new Notice('Tasks Inline Edit: исходная строка не совпадает с кэшем Tasks. Используйте 📝 для редактирования; файл не изменён.');
      return;
    }
    const parsed = parseTaskLine(snapshot.line);
    if (!parsed || !this.canEditDescription(parsed.description, parsed.suffix, resolved.task.description)) {
      new Notice('Tasks Inline Edit: формат этой задачи пока нельзя безопасно редактировать.');
      return;
    }
    const editor = resolved.descriptionElement;
    if (!editor.isConnected) return;
    const originalNodes = createFragment();
    while (editor.firstChild) originalNodes.appendChild(editor.firstChild);
    editor.textContent = parsed.description;
    editor.setAttribute('contenteditable', 'plaintext-only');
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', 'Изменить текст задачи');
    editor.classList.add('tasks-inline-edit-active');
    const listeners = new AbortController();
    const editing: Editing = { resolved, editor, originalNodes, listeners, snapshot, file, original: parsed.description, done: false };
    this.editing = editing;
    editor.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); void this.save(editing); }
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); }
    }, { signal: listeners.signal });
    editor.addEventListener('keyup', e => e.stopPropagation(), { signal: listeners.signal });
    editor.addEventListener('beforeinput', e => e.stopPropagation(), { signal: listeners.signal });
    editor.addEventListener('input', e => e.stopPropagation(), { signal: listeners.signal });
    editor.addEventListener('blur', () => { if (this.editing === editing) void this.save(editing); }, { signal: listeners.signal });
    editor.focus({ preventScroll: true });
    placeCaret(editor, clickedOffset ?? parsed.description.length);
  }

  private canEditDescription(description: string, suffix: string, tasksDescription: string): boolean {
    // Tasks moves tail tags into its parsed description. If our narrow parser
    // disagrees with Tasks, never risk editing a metadata signifier.
    const tags = [...suffix.matchAll(/\s+(#[^\s#]+)/gu)].map(match => match[1]);
    const expected = [description.trim(), ...tags].join(' ');
    return expected === tasksDescription.trim() && !/[📅⏳🛫➕✅❌🔁🏁🆔⛔🔺⏫🔼🔽⏬]/u.test(description);
  }

  private hasUnsavedEditorBuffer(file: TFile, diskContent: string): boolean {
    return this.app.workspace.getLeavesOfType('markdown').some(leaf => {
      const view = leaf.view;
      return view instanceof MarkdownView && view.file?.path === file.path &&
        view.editor.getValue() !== diskContent;
    });
  }

  private async save(editing: Editing): Promise<void> {
    if (editing.done || this.editing !== editing) return;
    editing.done = true;
    const value = (editing.editor.textContent ?? '').trim();
    if (value === editing.original) { this.finish(editing); return; }
    if (!value || /[\r\n]/u.test(value)) {
      editing.done = false;
      new Notice('Tasks Inline Edit: текст задачи не может быть пустым.');
      editing.editor.focus({ preventScroll: true });
      return;
    }
    try {
      const diskContent = await this.app.vault.read(editing.file);
      if (this.hasUnsavedEditorBuffer(editing.file, diskContent)) throw new Error('unsaved-editor-buffer');
      await this.app.vault.process(editing.file, current => applyEdit(current, editing.snapshot, value));
      // The Tasks cache will redraw the query after Vault.process(). Render a
      // short-lived preview meanwhile, keeping Markdown links clickable.
      if (editing.editor.isConnected) {
        const parsed = parseTaskLine(editing.snapshot.line);
        const tags = parsed ? [...parsed.suffix.matchAll(/\s+(#[^\s#]+)/gu)].map(match => match[1]) : [];
        const preview = createSpan();
        const component = this.addChild(new Component());
        try {
          await MarkdownRenderer.render(this.app, [value, ...tags].join(' '), preview, editing.file.path, component);
          const paragraph = preview.querySelector('p');
          editing.editor.replaceChildren(...Array.from(paragraph?.childNodes ?? preview.childNodes));
        } catch (error) {
          console.warn('Tasks Inline Edit: preview rendering failed; Tasks will redraw', error);
          editing.editor.textContent = [value, ...tags].join(' ');
        } finally {
          this.removeChild(component);
        }
      }
      this.finish(editing, false);
    } catch (error) {
      editing.done = false;
      new Notice(error instanceof Error && error.message === 'unsaved-editor-buffer'
        ? 'Tasks Inline Edit: дождитесь сохранения открытой заметки и повторите Enter. Текст оставлен на месте.'
        : 'Tasks Inline Edit: исходная задача изменилась; файл не записан. Текст оставлен на месте.');
      console.warn('Tasks Inline Edit: save cancelled', error);
      editing.editor.focus({ preventScroll: true });
    }
  }

  private finish(editing: Editing, restore = true): void {
    editing.listeners.abort();
    editing.editor.removeAttribute('contenteditable');
    editing.editor.removeAttribute('role');
    editing.editor.removeAttribute('aria-label');
    editing.editor.classList.remove('tasks-inline-edit-active');
    if (restore) editing.editor.replaceChildren(editing.originalNodes);
    if (this.editing === editing) this.editing = null;
  }

  private cancel(): void {
    if (this.editing) this.finish(this.editing);
  }
}

class TasksInlineEditSettings extends PluginSettingTab {
  constructor(private plugin: TasksInlineEdit) { super(plugin.app, plugin); }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('Показывать контекст родительских задач')
      .setDesc('Добавляет под подзадачами кликабельную цепочку родителей. Статусы и распределение по спискам не меняются.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showParentContext)
        .onChange(async enabled => {
          toggle.setDisabled(true);
          try {
            await this.plugin.setShowParentContext(enabled);
          } catch (error) {
            toggle.setValue(this.plugin.settings.showParentContext);
            new Notice('Не удалось сохранить настройку контекста задач. Попробуйте ещё раз.');
            console.error('Tasks Inline Edit: saving settings failed', error);
          } finally {
            toggle.setDisabled(false);
          }
        }));
  }
}
