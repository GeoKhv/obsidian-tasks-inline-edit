export type TaskLine = {
  prefix: string;
  description: string;
  suffix: string;
  ending: string;
};

// The installed Tasks 8.4.0 serializer removes these signifiers from its
// description. Keep their original bytes instead of serializing a Task object.
const tailPart = /(?:\s+(?:[🔺⏫🔼🔽⏬]|[📅⏳🛫➕✅❌] \d{4}-\d{2}-\d{2}|🔁 [^\n]*?|🏁 [^\n]*?|🆔 [^\s]+|⛔ [^\n]*?|#[^\s#]+))$/u;
const blockId = /\s+\^[A-Za-z0-9-]+$/u;
const taskPrefix = /^([ \t]*(?:[-*+]|\d+[.)]) \[[^\]\r\n]\] )/u;

export function parseTaskLine(line: string): TaskLine | null {
  const ending = line.endsWith('\r') ? '\r' : '';
  const bodyLine = ending ? line.slice(0, -1) : line;
  const match = bodyLine.match(taskPrefix);
  if (!match) return null;
  const prefix = match[1];
  let body = bodyLine.slice(prefix.length);
  let suffix = '';
  const hardBreak = body.match(/ {2,}$/u);
  if (hardBreak) {
    suffix = hardBreak[0];
    body = body.slice(0, -suffix.length);
  }
  for (let i = 0; i < 24; i++) {
    const part = body.match(blockId) ?? body.match(tailPart);
    if (!part) break;
    suffix = part[0] + suffix;
    body = body.slice(0, -part[0].length);
  }
  if (!body.trim()) return null;
  return { prefix, description: body, suffix, ending };
}

export function replaceDescription(line: string, replacement: string): string | null {
  if (!replacement.trim() || /[\r\n]/u.test(replacement)) return null;
  const parsed = parseTaskLine(line);
  if (!parsed) return null;
  return parsed.prefix + replacement.trim() + parsed.suffix + parsed.ending;
}

export type Snapshot = {
  lineNumber: number;
  line: string;
  before: string | null;
  after: string | null;
};

export function snapshotAt(content: string, lineNumber: number): Snapshot | null {
  const lines = content.split('\n');
  const line = lines[lineNumber];
  if (line === undefined || !parseTaskLine(line)) return null;
  return { lineNumber, line, before: lines[lineNumber - 1] ?? null, after: lines[lineNumber + 1] ?? null };
}

// A moved task may be followed only when its entire old line is unique.
// A status-only change is accepted at the original position with intact
// neighboring lines. All other concurrent changes fail closed.
export function applyEdit(content: string, snapshot: Snapshot, replacement: string): string {
  const lines = content.split('\n');
  let index = snapshot.lineNumber;
  const neighboursMatch = (i: number) =>
    (lines[i - 1] ?? null) === snapshot.before && (lines[i + 1] ?? null) === snapshot.after;
  if (lines[index] !== snapshot.line || !neighboursMatch(index)) {
    const old = parseTaskLine(snapshot.line);
    const now = lines[index] === undefined ? null : parseTaskLine(lines[index]);
    const statusOnly = old && now && neighboursMatch(index) &&
      old.prefix.replace(/\[[^\]]\]/u, '[ ]') === now.prefix.replace(/\[[^\]]\]/u, '[ ]') &&
      old.description === now.description && old.suffix === now.suffix;
    if (!statusOnly) {
      const exact = lines.flatMap((line, i) => line === snapshot.line ? [i] : []);
      if (exact.length !== 1) throw new Error('source-conflict');
      index = exact[0];
    }
  }
  const updated = replaceDescription(lines[index], replacement);
  if (updated === null) throw new Error('invalid-description');
  lines[index] = updated;
  return lines.join('\n');
}
