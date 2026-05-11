// javascript db/db.js
// Migration -> better-sqlite3
// Production-safe, backward-compatible wrapper that preserves the old sqlite3-style callback API
// while providing a modern synchronous engine + async-friendly dbAsync helpers.
//
// - Preserves table names, indexes, schema
// - Adds processed_messages table for dedup
// - Adds PRAGMA tuning for production
// - Exposes db (legacy-like) and dbAsync (promise-based)
// - Includes retention cleanup (uses dbAsync)

const path = require("path");
const fs = require("fs");

let Database;
try {
  Database = require("better-sqlite3");
} catch (e) {
  console.error("❌ better-sqlite3 not installed. Run: npm install better-sqlite3");
  process.exit(1);
}

const dbPath = path.join(__dirname, "..", "database.sqlite");

// Open DB with safe defaults
let raw;
try {
  raw = new Database(dbPath, { fileMustExist: false });
  console.log("✅ Connected to better-sqlite3 database:", dbPath);
} catch (err) {
  console.error("❌ DB connection error (better-sqlite3):", err.message);
  process.exit(1);
}

// ===== PRAGMAS for production tuning =====
try {
  raw.pragma("journal_mode = WAL");
  raw.pragma("synchronous = NORMAL");
  raw.pragma("busy_timeout = 5000");
  raw.pragma("foreign_keys = ON");
  raw.pragma("temp_store = MEMORY");
  // Negative cache_size means KB in pages; -64000 ~ 64MB cache
  raw.pragma("cache_size = -64000");
} catch (e) {
  console.warn("[DB] Warning: failed to set some pragmas:", e.message);
}

// ===== Helpers for migrations with better-sqlite3 =====
function runMigration(sql, description) {
  try {
    raw.exec(sql);
  } catch (err) {
    const msg = String(err.message || "").toLowerCase();
    // ignore expected duplicates / exists errors
    if (
      msg.includes("duplicate column") ||
      msg.includes("already exists") ||
      msg.includes("no such column") ||
      msg.includes("already exists")
    ) {
      return;
    }
    console.error(`❌ Migration failed (${description}):`, err.message);
  }
}

function addColumnSafe(table, column, type, staticDefault = null) {
  const defaultClause = staticDefault !== null ? ` DEFAULT ${staticDefault}` : "";
  try {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`);
  } catch (err) {
    const msg = String(err.message || "").toLowerCase();
    if (msg.includes("duplicate column") || msg.includes("already exists") || msg.includes("no such column")) {
      return;
    }
    console.error(`❌ addColumnSafe failed (${table}.${column}):`, err.message);
  }
}

function backfillTimestamp(table, column) {
  try {
    raw.exec(`UPDATE ${table} SET ${column} = CURRENT_TIMESTAMP WHERE ${column} IS NULL`);
  } catch (err) {
    if (!String(err.message || "").includes("no such column")) {
      console.error(`❌ Backfill failed (${table}.${column}):`, err.message);
    }
  }
}

// ===== CREATE TABLES / SCHEMA (using db.exec) =====
try {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        price INTEGER DEFAULT 0,
        location TEXT,
        is_active INTEGER DEFAULT 1,
        connection_status TEXT DEFAULT 'disconnected',
        opening_hour TEXT DEFAULT '09:00',
        closing_hour TEXT DEFAULT '18:00',
        appointment_duration INTEGER DEFAULT 30,
        timezone TEXT DEFAULT 'Asia/Jerusalem',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  raw.exec(`
    CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        duration INTEGER DEFAULT 30,
        price INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );
  `);

  raw.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER NOT NULL,
        service_id INTEGER,
        customer_phone TEXT NOT NULL,
        customer_name TEXT,
        datetime TEXT NOT NULL,
        status TEXT DEFAULT 'confirmed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
    );
  `);

  raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        customer_phone TEXT NOT NULL,
        business_id INTEGER NOT NULL,
        step TEXT DEFAULT 'idle',
        data TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(customer_phone, business_id),
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );
  `);

  raw.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_name TEXT,
        last_message TEXT,
        last_message_at TEXT,
        unread_count INTEGER DEFAULT 0,
        mode TEXT DEFAULT 'bot',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );
  `);

  raw.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  // Dedup table for inbound message processing
  raw.exec(`
    CREATE TABLE IF NOT EXISTS processed_messages (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Indexes
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(customer_phone);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_datetime ON bookings(datetime);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(connection_status);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_businesses_active ON businesses(is_active);`);

  raw.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique ON conversations(business_id, customer_phone);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_business ON conversations(business_id);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_unread ON conversations(unread_count);`);

  raw.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);`);
  raw.exec(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);`);

  raw.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_unique ON bookings(business_id, datetime);`);
} catch (err) {
  console.error("❌ Schema initialization failed:", err.message);
  process.exit(1);
}

// ===== BACKFILL (like before) =====
try {
  addColumnSafe("businesses", "opening_hour", "TEXT", "'09:00'");
  addColumnSafe("businesses", "closing_hour", "TEXT", "'18:00'");
  addColumnSafe("businesses", "appointment_duration", "INTEGER", "30");
  addColumnSafe("businesses", "timezone", "TEXT", "'Asia/Jerusalem'");

  addColumnSafe("businesses", "created_at", "DATETIME");
  addColumnSafe("businesses", "updated_at", "DATETIME");

  addColumnSafe("bookings", "service_id", "INTEGER");
  addColumnSafe("bookings", "customer_name", "TEXT");
  addColumnSafe("bookings", "status", "TEXT", "'confirmed'");
  addColumnSafe("bookings", "updated_at", "DATETIME");

  addColumnSafe("services", "created_at", "DATETIME");

  addColumnSafe("sessions", "data", "TEXT");
  addColumnSafe("sessions", "updated_at", "DATETIME");

  backfillTimestamp("businesses", "created_at");
  backfillTimestamp("businesses", "updated_at");
  backfillTimestamp("bookings", "created_at");
  backfillTimestamp("bookings", "updated_at");
  backfillTimestamp("services", "created_at");
  backfillTimestamp("sessions", "updated_at");
} catch (e) {
  console.error("[DB] Backfill error:", e.message);
}

// ===== Async-friendly wrapper over better-sqlite3 =====
const dbAsync = {
  get: async (sql, params = []) => {
    try {
      const stmt = raw.prepare(sql);
      return stmt.get(...params);
    } catch (err) {
      throw err;
    }
  },
  all: async (sql, params = []) => {
    try {
      const stmt = raw.prepare(sql);
      return stmt.all(...params);
    } catch (err) {
      throw err;
    }
  },
  run: async (sql, params = []) => {
    try {
      const stmt = raw.prepare(sql);
      const info = stmt.run(...params);
      return { lastID: info.lastInsertRowid, changes: info.changes };
    } catch (err) {
      throw err;
    }
  }
};

// ===== Backward-compatible db object (mimic sqlite3 Database minimal behaviors) =====
const db = {
  // expose raw DB for advanced usage
  raw,

  // callback-style run(get/all) to keep existing code working
  run(sql, params = [], cb) {
    // allow signature db.run(sql, cb)
    if (typeof params === "function") {
      cb = params;
      params = [];
    }
    try {
      const stmt = raw.prepare(sql);
      const info = stmt.run(...params);
      if (typeof cb === "function") {
        // mimic sqlite3 `this` context having lastID and changes
        cb.call({ lastID: info.lastInsertRowid, changes: info.changes }, null);
      }
      return { lastID: info.lastInsertRowid, changes: info.changes };
    } catch (err) {
      if (typeof cb === "function") cb(err);
      else throw err;
    }
  },

  get(sql, params = [], cb) {
    if (typeof params === "function") {
      cb = params;
      params = [];
    }
    try {
      const stmt = raw.prepare(sql);
      const row = stmt.get(...params);
      if (typeof cb === "function") cb(null, row);
      return row;
    } catch (err) {
      if (typeof cb === "function") cb(err);
      else throw err;
    }
  },

  all(sql, params = [], cb) {
    if (typeof params === "function") {
      cb = params;
      params = [];
    }
    try {
      const stmt = raw.prepare(sql);
      const rows = stmt.all(...params);
      if (typeof cb === "function") cb(null, rows);
      return rows;
    } catch (err) {
      if (typeof cb === "function") cb(err);
      else throw err;
    }
  },

  exec(sql) {
    return raw.exec(sql);
  },

  // sqlite3 compatibility: serialize(fn) -> just run fn synchronously
  serialize(fn) {
    try {
      fn();
    } catch (e) {
      throw e;
    }
  },

  // close
  close() {
    try {
      raw.close();
    } catch (e) {
      console.error("[DB] close error:", e.message);
    }
  },

  // expose dbAsync for async usages
  dbAsync
};

// ===== CHAT RETENTION CLEANUP (preserve behavior) =====
function startChatRetentionCleanup() {
  const retentionDays = Number(process.env.CHAT_RETENTION_DAYS || 90); // 3 months default
  const intervalHours = Number(process.env.CHAT_CLEANUP_INTERVAL_HOURS || 24);

  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    console.log("[DB] Chat retention cleanup disabled (CHAT_RETENTION_DAYS invalid)");
    return;
  }

  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

  const runCleanup = async () => {
    const startedAt = Date.now();
    const modifier = `-${Math.floor(retentionDays)} days`;

    try {
      // Delete old processed_messages (dedup table) and old messages in batches
      const batchSize = 5000;
      const maxBatches = 24; // safety cap
      let totalDeleted = 0;

      for (let i = 0; i < maxBatches; i++) {
        const res = await dbAsync.run(
          "DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE created_at < datetime('now', ?) LIMIT ?)",
          [modifier, batchSize]
        );
        totalDeleted += res.changes || 0;
        if (!res.changes) break;
        await new Promise((r) => setTimeout(r, 25));
      }

      // Cleanup old processed_messages too (keep small history)
      await dbAsync.run("DELETE FROM processed_messages WHERE created_at < datetime('now', ?)", [
        modifier,
      ]);

      // Remove conversations with no messages
      const convRes = await dbAsync.run(
        "DELETE FROM conversations WHERE id NOT IN (SELECT DISTINCT conversation_id FROM messages)",
        []
      );

      const ms = Date.now() - startedAt;
      if (totalDeleted > 0 || (convRes.changes || 0) > 0) {
        console.log(
          `[DB] Chat retention cleanup: deleted messages=${totalDeleted}, empty conversations=${convRes.changes || 0} (retention=${retentionDays}d, ${ms}ms)`
        );
      }
    } catch (e) {
      console.error("[DB] Chat retention cleanup error:", e.message);
    }
  };

  const t = setTimeout(() => {
    runCleanup();
    const interval = setInterval(runCleanup, intervalMs);
    if (typeof interval.unref === "function") interval.unref();
  }, 60 * 1000);

  if (typeof t.unref === "function") t.unref();
}

startChatRetentionCleanup();

// Export API (backward-compatible)
module.exports = db;
module.exports.dbAsync = dbAsync;
module.exports.DEFAULT_SETTINGS = {
  opening_hour: "09:00",
  closing_hour: "18:00",
  appointment_duration: 30,
  timezone: "Asia/Jerusalem",
};