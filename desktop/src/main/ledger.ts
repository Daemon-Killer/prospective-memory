import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { Reminder, ReminderStatus } from '../types';

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    raw TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'inbox',
    trigger_type TEXT NOT NULL DEFAULT 'none',
    trigger_detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    confidence REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE TABLE IF NOT EXISTS jarvis_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    package TEXT NOT NULL DEFAULT '',
    app_label TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    otp TEXT,
    posted_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_kind_posted ON jarvis_events(kind, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jarvis_expires ON jarvis_events(expires_at);
CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    snooze_count INTEGER NOT NULL DEFAULT 0,
    last_snoozed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    armed INTEGER NOT NULL DEFAULT 1,
    ink_data TEXT,
    cultural_metadata TEXT,
    priority TEXT,
    context TEXT DEFAULT 'all',
    tags TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status, due_date ASC);
CREATE INDEX IF NOT EXISTS idx_reminders_updated ON reminders(updated_at DESC);
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

export class LocalLedger {
  private db: Database | null = null;
  private dbPath: string;
  private isMemory: boolean;
  private SQL: any = null;
  private lastLoadedMtime: number = 0;
  private lastLoadedSize: number = 0;
  private watcher: fs.FSWatcher | null = null;
  private watchDebounceTimer: NodeJS.Timeout | null = null;
  private changeListeners: Set<() => void> = new Set();

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
    this.isMemory = dbPath === ':memory:';
  }

  public async init(): Promise<void> {
    const wasmPath = path.resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
    const localWasm = path.resolve(__dirname, './sql-wasm.wasm');
    this.SQL = await initSqlJs({
      locateFile: (file) => {
        if (file.endsWith('.wasm')) {
          if (fs.existsSync(localWasm)) return localWasm;
          if (fs.existsSync(wasmPath)) return wasmPath;
        }
        return file;
      },
    });
    if (this.isMemory) {
      this.db = new this.SQL.Database();
    } else {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fileBuffer);
        try {
          const stat = fs.statSync(this.dbPath);
          this.lastLoadedMtime = stat.mtimeMs;
          this.lastLoadedSize = stat.size;
        } catch (_) {}
      } else {
        this.db = new this.SQL.Database();
        this.persist();
      }
      this.startWatching();
    }
    if (this.db) {
      this.db.run(SQLITE_SCHEMA);
      try {
        this.db.run("ALTER TABLE reminders ADD COLUMN context TEXT DEFAULT 'all'");
      } catch (_) {}
      try {
        this.db.run("ALTER TABLE reminders ADD COLUMN tags TEXT");
      } catch (_) {}
      this.persist();
    }
  }

  public reloadIfModified(force: boolean = false): boolean {
    if (this.isMemory || !this.SQL || !fs.existsSync(this.dbPath)) {
      return false;
    }
    try {
      const stat = fs.statSync(this.dbPath);
      const isModified =
        force ||
        stat.mtimeMs > this.lastLoadedMtime ||
        (stat.mtimeMs >= this.lastLoadedMtime && this.lastLoadedSize > 0 && stat.size !== this.lastLoadedSize);

      if (isModified) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        if (this.db) {
          try {
            this.db.close();
          } catch (_) {}
        }
        this.db = new this.SQL.Database(fileBuffer);
        this.lastLoadedMtime = stat.mtimeMs;
        this.lastLoadedSize = stat.size;
        this.emitChange();
        return true;
      }
    } catch (e) {
      console.warn('LocalLedger: Failed to reload modified database file', e);
    }
    return false;
  }

  private startWatching(): void {
    if (this.isMemory || !fs.existsSync(this.dbPath)) return;
    try {
      this.watcher = fs.watch(this.dbPath, (_eventType) => {
        if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
        this.watchDebounceTimer = setTimeout(() => {
          this.reloadIfModified();
        }, 100);
      });
    } catch (e) {
      console.warn('LocalLedger: Could not watch db file for external changes', e);
    }
  }

  public onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (e) {
        console.error('LocalLedger: change listener error', e);
      }
    }
  }

  private persist(): void {
    if (this.isMemory || !this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
    try {
      const stat = fs.statSync(this.dbPath);
      this.lastLoadedMtime = stat.mtimeMs;
      this.lastLoadedSize = stat.size;
    } catch (_) {}
  }

  private mapRowToReminder(row: any[]): Reminder {
    let tags: string[] | null = null;
    if (row[16]) {
      try {
        tags = JSON.parse(String(row[16]));
      } catch {
        tags = String(row[16]).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return {
      id: String(row[0]),
      title: String(row[1]),
      notes: row[2] ? String(row[2]) : null,
      dueDate: String(row[3]),
      status: (row[4] || 'pending') as ReminderStatus,
      snoozeCount: Number(row[5] || 0),
      lastSnoozedAt: row[6] ? String(row[6]) : null,
      createdAt: String(row[7]),
      updatedAt: String(row[8]),
      completedAt: row[9] ? String(row[9]) : null,
      isDeleted: Boolean(Number(row[10]) !== 0),
      armed: Boolean(Number(row[11]) !== 0),
      inkData: row[12] ? String(row[12]) : null,
      culturalMetadata: row[13] ? String(row[13]) : null,
      priority: row[14] ? String(row[14]) : null,
      context: (row[15] ? String(row[15]) : 'all') as any,
      tags,
    };
  }

  public listReminders(options: { status?: string; context?: string; includeDeleted?: boolean } = {}): Reminder[] {
    this.reloadIfModified();
    if (!this.db) throw new Error('Database not initialized');
    const { status, context, includeDeleted = false } = options;

    let sql = 'SELECT id, title, notes, due_date, status, snooze_count, last_snoozed_at, created_at, updated_at, completed_at, is_deleted, armed, ink_data, cultural_metadata, priority, context, tags FROM reminders';
    const conditions: string[] = [];
    const params: any[] = [];

    if (!includeDeleted) {
      conditions.push('is_deleted = 0');
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY due_date ASC';

    const stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    let results: Reminder[] = [];
    while (stmt.step()) {
      results.push(this.mapRowToReminder(stmt.get()));
    }
    stmt.free();

    if (context && context !== 'all') {
      const mode = context.toLowerCase();
      if (mode === 'work') {
        results = results.filter(
          (r) =>
            r.context === 'work' ||
            r.tags?.some((t) => ['work', 'office', 'job'].includes(t.toLowerCase()))
        );
      } else if (mode === 'home') {
        results = results.filter(
          (r) =>
            r.context === 'home' ||
            r.context === 'personal' ||
            r.tags?.some((t) =>
              ['home', 'personal', 'chore', 'chores', 'grocery', 'groceries', 'errand', 'errands'].includes(
                t.toLowerCase()
              )
            ) ||
            (r.context !== 'work' &&
              !r.tags?.some((t) => ['work', 'office', 'job'].includes(t.toLowerCase())))
        );
      } else {
        results = results.filter((r) => r.context === mode);
      }
    }

    return results;
  }

  public getReminder(id: string): Reminder | null {
    this.reloadIfModified();
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(
      'SELECT id, title, notes, due_date, status, snooze_count, last_snoozed_at, created_at, updated_at, completed_at, is_deleted, armed, ink_data, cultural_metadata, priority, context, tags FROM reminders WHERE id = ?'
    );
    stmt.bind([id]);
    let result: Reminder | null = null;
    if (stmt.step()) {
      result = this.mapRowToReminder(stmt.get());
    }
    stmt.free();
    return result;
  }

  public upsertReminder(rem: Reminder): Reminder {
    this.reloadIfModified();
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const createdAt = rem.createdAt || now;
    const updatedAt = rem.updatedAt || now;

    // Check conflict resolution against local existing
    const existing = this.getReminder(rem.id);
    if (existing) {
      const localUpdated = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
      const remoteUpdated = new Date(updatedAt).getTime();
      if (localUpdated > remoteUpdated) {
        return existing;
      }
    }

    const upsertSql = `
      INSERT INTO reminders (
        id, title, notes, due_date, status, snooze_count, last_snoozed_at,
        created_at, updated_at, completed_at, is_deleted, armed,
        ink_data, cultural_metadata, priority, context, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        notes = excluded.notes,
        due_date = excluded.due_date,
        status = excluded.status,
        snooze_count = excluded.snooze_count,
        last_snoozed_at = excluded.last_snoozed_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        is_deleted = excluded.is_deleted,
        armed = excluded.armed,
        ink_data = excluded.ink_data,
        cultural_metadata = excluded.cultural_metadata,
        priority = excluded.priority,
        context = excluded.context,
        tags = excluded.tags
    `;

    this.db.run(upsertSql, [
      rem.id,
      rem.title,
      rem.notes ?? null,
      rem.dueDate,
      rem.status,
      rem.snoozeCount,
      rem.lastSnoozedAt ?? null,
      createdAt,
      updatedAt,
      rem.completedAt ?? null,
      rem.isDeleted ? 1 : 0,
      rem.armed !== false ? 1 : 0,
      rem.inkData ?? null,
      rem.culturalMetadata ?? null,
      rem.priority ?? null,
      rem.context ?? 'all',
      rem.tags ? JSON.stringify(rem.tags) : null,
    ]);

    // Mirror to tasks table
    this.mirrorReminderToTask(rem);
    this.persist();

    return this.getReminder(rem.id)!;
  }

  public getSetting(key: string, defaultValue: string = ''): string {
    this.reloadIfModified();
    if (!this.db) return defaultValue;
    try {
      const stmt = this.db.prepare('SELECT value FROM app_settings WHERE key = ?');
      stmt.bind([key]);
      let res = defaultValue;
      if (stmt.step()) {
        res = String(stmt.get()[0]);
      }
      stmt.free();
      return res;
    } catch {
      return defaultValue;
    }
  }

  public setSetting(key: string, value: string): void {
    this.reloadIfModified();
    if (!this.db) return;
    try {
      this.db.run(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      );
      this.persist();
    } catch (e) {
      console.warn('LocalLedger: setSetting error', e);
    }
  }

  public batchUpsert(rems: Reminder[]): Reminder[] {
    const results: Reminder[] = [];
    for (const rem of rems) {
      results.push(this.upsertReminder(rem));
    }
    return results;
  }

  private mirrorReminderToTask(rem: Reminder): void {
    if (!this.db) return;
    let taskStatus = 'open';
    let completedAt: string | null = null;
    if (rem.isDeleted) {
      taskStatus = 'dropped';
      completedAt = rem.updatedAt || new Date().toISOString();
    } else if (rem.status === 'completed') {
      taskStatus = 'done';
      completedAt = rem.completedAt || rem.updatedAt || new Date().toISOString();
    }

    const isArmed = rem.armed !== false;
    const triggerType = isArmed ? 'time' : 'none';
    const triggerDetail = isArmed ? rem.dueDate : '';

    let category = 'inbox';
    if (rem.culturalMetadata) {
      category = 'watchlist';
    } else if (rem.notes && rem.notes.startsWith('category:')) {
      category = rem.notes.split(':', 2)[1].trim() || 'inbox';
    }

    const taskSql = `
      INSERT INTO tasks (
        id, text, raw, category, trigger_type, trigger_detail,
        status, confidence, source, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = EXCLUDED.text,
        raw = EXCLUDED.raw,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        trigger_type = EXCLUDED.trigger_type,
        trigger_detail = EXCLUDED.trigger_detail,
        updated_at = EXCLUDED.updated_at,
        completed_at = EXCLUDED.completed_at
      WHERE EXCLUDED.updated_at >= tasks.updated_at
    `;
    this.db.run(taskSql, [
      rem.id,
      rem.title,
      rem.title,
      category,
      triggerType,
      triggerDetail,
      taskStatus,
      0.8,
      'remy',
      rem.createdAt || new Date().toISOString(),
      rem.updatedAt || new Date().toISOString(),
      completedAt,
    ]);
  }

  public snoozeReminder(id: string, newDueDate: string): Reminder | null {
    const rem = this.getReminder(id);
    if (!rem) return null;
    const now = new Date().toISOString();
    rem.status = 'snoozed';
    rem.dueDate = newDueDate;
    rem.snoozeCount = (rem.snoozeCount || 0) + 1;
    rem.lastSnoozedAt = now;
    rem.updatedAt = now;
    return this.upsertReminder(rem);
  }

  public completeReminder(id: string): Reminder | null {
    const rem = this.getReminder(id);
    if (!rem) return null;
    const now = new Date().toISOString();
    rem.status = 'completed';
    rem.completedAt = now;
    rem.updatedAt = now;
    return this.upsertReminder(rem);
  }

  public deleteReminder(id: string): boolean {
    const rem = this.getReminder(id);
    if (!rem) return false;
    const now = new Date().toISOString();
    rem.isDeleted = true;
    rem.updatedAt = now;
    this.upsertReminder(rem);
    return true;
  }

  public getDueReminders(nowIso?: string): Reminder[] {
    this.reloadIfModified();
    const target = nowIso || new Date().toISOString();
    const all = this.listReminders({ includeDeleted: false });
    return all.filter((r) => r.status !== 'completed' && r.armed !== false && r.dueDate <= target);
  }

  public close(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (_) {}
      this.watcher = null;
    }
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
    this.changeListeners.clear();
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }
}
