import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAction, hasSupportedTasks, queryHit } from './tasks-adapter.mjs';

// A small DOM tree is enough to test selector routing without loading Obsidian.
class El {
  constructor(tag, classes = '', parent = null, attrs = []) {
    this.tag = tag;
    this.classes = new Set(classes.split(' ').filter(Boolean));
    this.parent = parent;
    this.attrs = new Set(attrs);
    this.children = [];
    parent?.children.push(this);
  }
  matches(selector) {
    if (selector === '.tasks-list-text .task-description') {
      return this.classes.has('task-description') && !!this.parent?.closest('.tasks-list-text');
    }
    return selector.split(',').some(part => {
      const token = part.trim();
      if (token.startsWith('[')) return this.attrs.has(token.slice(1, -1).split('=')[0]);
      const pieces = token.split('.');
      return (!pieces[0] || pieces[0] === this.tag) && pieces.slice(1).every(cls => this.classes.has(cls));
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parent) if (node.matches(selector)) return node;
    return null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  contains(other) {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

function fixture(livePreview, inCallout = false) {
  const editor = new El('div', 'cm-content', null, ['contenteditable']);
  const root = new El('div', livePreview
    ? (inCallout ? 'cm-embed-block cm-callout' : 'cm-preview-code-block cm-embed-block cm-lang-tasks')
    : 'block-language-tasks', editor);
  const callout = inCallout ? new El('div', 'callout', root) : null;
  const content = callout ? new El('div', 'callout-content', callout) : null;
  const title = callout ? new El('div', 'callout-title', callout) : null;
  const processor = content ? new El('div', 'block-language-tasks', content) : livePreview ? new El('div', 'block-language-tasks', root) : root;
  const list = new El('ul', 'plugin-tasks-query-result', processor);
  const row = new El('li', 'plugin-tasks-list-item', list);
  const text = new El('span', 'tasks-list-text', row);
  const description = new El('span', 'task-description', text);
  return { editor, root, processor, list, row, description, callout, content, title };
}

test('verified Tasks versions remain editable after upgrade; unknown versions fail closed', () => {
  const appFor = version => ({ plugins: { plugins: { 'obsidian-tasks-plugin': { manifest: { version }, getTasks: () => [] } } } });
  assert.equal(hasSupportedTasks(appFor('8.4.0')), true);
  assert.equal(hasSupportedTasks(appFor('8.5.0')), true);
  assert.equal(hasSupportedTasks(appFor('8.6.0')), false);
  assert.equal(hasSupportedTasks({ plugins: { plugins: {} } }), false);
});

test('query callout padding is inert while its title and native controls remain usable', () => {
  const f = fixture(true, true);
  assert.equal(queryHit(f.callout)?.kind, 'background');
  assert.equal(queryHit(f.content)?.kind, 'background');
  assert.equal(queryHit(f.title)?.kind, 'control');
  assert.equal(queryHit(f.description)?.kind, 'description');
  assert.equal(queryHit(new El('input', 'task-list-item-checkbox', f.row))?.kind, 'control');
  assert.equal(queryHit(new El('div', 'callout', f.editor)), null);
});

for (const livePreview of [true, false]) {
  test(`${livePreview ? 'Live Preview' : 'Reading View'} routes text, background and native controls`, () => {
    const f = fixture(livePreview);
    const word = new El('span', '', f.description);
    const link = new El('a', 'internal-link', f.description);
    const checkbox = new El('input', 'task-list-item-checkbox', f.row);
    const date = new El('span', 'task-due', f.row);
    const edit = new El('a', 'tasks-edit', f.row);
    const status = new El('button', '', f.row);
    assert.equal(queryHit(word)?.kind, 'description');
    assert.equal(queryHit(f.processor)?.kind, 'background');
    assert.equal(queryHit(f.row)?.kind, 'background');
    for (const control of [link, checkbox, date, edit, status]) {
      assert.equal(queryHit(control)?.kind, 'control');
    }
    // The surrounding CodeMirror contenteditable does not turn the query into a control.
    assert.equal(queryHit(word)?.kind, 'description');
    assert.equal(queryHit(f.editor), null);
  });
}

test('an active plaintext-only editor is a native control', () => {
  const f = fixture(true);
  f.description.attrs.add('contenteditable');
  assert.equal(queryHit(f.description)?.kind, 'control');
});

test('capture policy blocks source activation while preserving native click', () => {
  for (const kind of ['description', 'background']) {
    for (const type of ['pointerdown', 'mousedown', 'click']) {
      assert.equal(captureAction(kind, type), 'block');
    }
  }
  assert.equal(captureAction('control', 'pointerdown'), 'native');
  assert.equal(captureAction('control', 'mousedown'), 'prevent-focus');
  assert.equal(captureAction('control', 'click'), 'native');
});
