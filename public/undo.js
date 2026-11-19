export class UndoHistory {
  constructor(limit = 50, byteLimit = 32 * 1024 * 1024) {
    this.limit = limit;
    this.byteLimit = byteLimit;
    this.entries = [];
    this.bytes = 0;
  }
  record(before, after, label = 'Изменение') {
    const snapshot = JSON.stringify(before);
    if (snapshot === JSON.stringify(after)) return false;
    this.entries.push({ snapshot, label });
    this.bytes += snapshot.length * 2;
    while (this.entries.length > this.limit || (this.bytes > this.byteLimit && this.entries.length > 1)) {
      this.bytes -= this.entries.shift().snapshot.length * 2;
    }
    return true;
  }
  get label() { return this.entries.at(-1)?.label || ''; }
  get available() { return this.entries.length > 0; }
  undo() {
    const entry = this.entries.pop();
    if (!entry) return null;
    this.bytes -= entry.snapshot.length * 2;
    return JSON.parse(entry.snapshot);
  }
}
