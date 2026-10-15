import test from 'node:test';
import assert from 'node:assert/strict';
import { parentChain, displayText } from './tasks-adapter.mjs';

const item = (description, line, parent = null, path = 'Example.md') => ({
  description, path, originalMarkdown: `- [ ] ${description}`,
  taskLocation: { lineNumber: line, path }, parent,
});

test('ancestors retain source order across independent task statuses', () => {
  const project = { ...item('Project', 0), status: { symbol: '/' } };
  const phase = { ...item('Phase', 2, project), status: { symbol: 'w' } };
  for (const symbol of [' ', '/', 'w', 'x']) {
    const task = { ...item('Send to everyone', 5, phase), status: { symbol } };
    assert.deepEqual(parentChain(task), [project, phase]);
  }
  assert.deepEqual(parentChain(project), []);
});

test('plain list items can supply context between task ancestors', () => {
  const project = item('Project', 0);
  const heading = { ...item('Preparation', 1, project), originalMarkdown: '  - Preparation' };
  assert.deepEqual(parentChain(item('Send', 3, heading)), [project, heading]);
});

test('malformed and cyclic ancestry fails closed', () => {
  const child = item('Child', 4);
  const parent = item('Parent', 1, child);
  child.parent = parent;
  assert.deepEqual(parentChain(child), []);
  for (const candidate of [item('Wrong file', 0, null, 'Other.md'), item('After child', 6),
    item('Same line', 4), item('Negative', -1), item('Fraction', 0.5), { description: 'Broken' }]) {
    assert.deepEqual(parentChain(item('Child', 4, candidate)), []);
  }
});

test('ancestor labels use readable link text without injecting HTML', () => {
  assert.equal(displayText('**Project** [[Folder/Note|Passport]]'), 'Project Passport');
  assert.equal(displayText('[Passport](https://example.com)  template'), 'Passport template');
  // The renderer inserts this via textContent, never innerHTML.
  assert.equal(displayText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
});
