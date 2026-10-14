import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, parseTaskLine, replaceDescription, snapshotAt } from './line.mjs';

test('replaces only description and preserves task metadata bytes', () => {
  const source = '    - [ ] Подготовить отчёт #work 🔺 ⏳ 2026-09-23 📅 2026-09-25 ^abc123';
  assert.equal(replaceDescription(source, 'Подготовить финальный отчёт'),
    '    - [ ] Подготовить финальный отчёт #work 🔺 ⏳ 2026-09-23 📅 2026-09-25 ^abc123');
});

test('preserves statuses, links, recurrence, indentation and line endings', () => {
  const lines = [
    '- [x] Проверить ✅ 2026-09-21',
    '- [-] Отменено ❌ 2026-09-22',
    '\t- [/] Обсудить [[VoiceBot ФЛ]] с [коллегой](https://example.com) 📅 2026-09-25',
    '- [ ] Регулярно 🔁 every week 📅 2026-09-25',
    '- [ ] Текст #tag ^abc123\r',
  ];
  for (const line of lines) {
    const parsed = parseTaskLine(line);
    assert.ok(parsed, line);
    assert.equal(replaceDescription(line, 'Новое'), parsed.prefix + 'Новое' + parsed.suffix + parsed.ending);
  }
});

test('changes the chosen duplicate only', () => {
  const source = '- [ ] Повтор\n- [ ] Повтор\n';
  const snapshot = snapshotAt(source, 1);
  assert.ok(snapshot);
  assert.equal(applyEdit(source, snapshot, 'Второй'), '- [ ] Повтор\n- [ ] Второй\n');
});

test('refuses ambiguous duplicates after insertion', () => {
  const source = 'Title\n- [ ] Повтор\n- [ ] Повтор\n';
  const snapshot = snapshotAt(source, 2);
  assert.ok(snapshot);
  assert.throws(() => applyEdit('New\n' + source, snapshot, 'Второй'), /source-conflict/);
});

test('permits status-only concurrent edit but rejects text conflict', () => {
  const source = 'Before\n- [ ] Текст 📅 2026-09-25\nAfter';
  const snapshot = snapshotAt(source, 1);
  assert.ok(snapshot);
  assert.equal(applyEdit(source.replace('[ ]', '[x]'), snapshot, 'Новое'),
    'Before\n- [x] Новое 📅 2026-09-25\nAfter');
  assert.throws(() => applyEdit(source.replace('Текст', 'Другое'), snapshot, 'Новое'), /source-conflict/);
});

test('refuses empty and multiline replacements', () => {
  assert.equal(replaceDescription('- [ ] Text', ''), null);
  assert.equal(replaceDescription('- [ ] Text', 'a\nb'), null);
});
