// /db/db.js
const Database = require("better-sqlite3");
const path = require("path");

// ===== DEFAULT BUSINESS SETTINGS =====
const DEFAULT_SETTINGS = {
    opening_hour: "09:00",
    closing_hour: "18:00",
    appointment_duration: 30,
    timezone: "Asia/Jerusalem"
};

// ===== DATABASE CONNECTION =====
const dbPath = path.join(__dirname, "..", "database.sqlite");

let db;

try {
    db = new Database(dbPath);

    console.log("✅ Connected to SQLite database:", dbPath);

} catch (err) {
    console.error("❌ DB connection error:", err.message);
    process.exit(1);
}

// ===== PRODUCTION SQLITE SETTINGS =====
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

// ===== SAFE MIGRATION RUNNER =====
function runMigration(sql, description) {
    try {
        db.exec(sql);
    } catch (err) {
        const msg = err.message.toLowerCase();

        if (
            msg.includes("duplicate column") ||
            msg.includes("already exists") ||
            msg.includes("no such column")
        ) {
            return;
        }

        console.error(`❌ Migration failed (${description}):`, err.message);
    }
}

// ===== SAFE COLUMN ADDER =====
function addColumnSafe(table, column, type, staticDefault = null) {
    const defaultClause =
        staticDefault !== null ? ` DEFAULT ${staticDefault}` : "";

    runMigration(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`,
        `${table}.${column}`
    );
}

// ===== BACKFILL TIMESTAMP =====
function backfillTimestamp(table, column) {
    try {
        db.prepare(
            `UPDATE ${table} 
             SET ${column} = CURRENT_TIMESTAMP 
             WHERE ${column} IS NULL`
        ).run();
    } catch (err) {
        if (!err.message.includes("no such column")) {
            console.error(`❌ Backfill failed (${table}.${column}):`, err.message);
        }
    }
}

// ===== CREATE TABLES =====

db.exec(`
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

CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    duration INTEGER DEFAULT 30,
    price INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS sessions (
    customer_phone TEXT NOT NULL,
    business_id INTEGER NOT NULL,
    step TEXT DEFAULT 'idle',
    data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(customer_phone, business_id),
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
`);


// ===== MIGRATIONS =====

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

// ===== INDEXES =====

db.exec(`
CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_datetime ON bookings(datetime);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(connection_status);
CREATE INDEX IF NOT EXISTS idx_businesses_active ON businesses(is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique 
ON conversations(business_id, customer_phone);

CREATE INDEX IF NOT EXISTS idx_conversations_business 
ON conversations(business_id);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at 
ON conversations(last_message_at);

CREATE INDEX IF NOT EXISTS idx_conversations_unread 
ON conversations(unread_count);

CREATE INDEX IF NOT EXISTS idx_messages_conversation 
ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_created_at 
ON messages(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_unique 
ON bookings(business_id, datetime);
`);

// ===== BACKFILL =====

backfillTimestamp("businesses", "created_at");
backfillTimestamp("businesses", "updated_at");

backfillTimestamp("bookings", "created_at");
backfillTimestamp("bookings", "updated_at");

backfillTimestamp("services", "created_at");

backfillTimestamp("sessions", "updated_at");

console.log("✅ Database schema initialized");

// ===== PROMISIFIED HELPERS =====

const dbAsync = {

    get: async (sql, params = []) => {
        return db.prepare(sql).get(...params);
    },

    all: async (sql, params = []) => {
        return db.prepare(sql).all(...params);
    },

    run: async (sql, params = []) => {
        const result = db.prepare(sql).run(...params);

        return {
            lastID: result.lastInsertRowid,
            changes: result.changes
        };
    }
};

// ===== CHAT RETENTION CLEANUP =====

function startChatRetentionCleanup() {

    const retentionDays =
        Number(process.env.CHAT_RETENTION_DAYS || 90);

    const intervalHours =
        Number(process.env.CHAT_CLEANUP_INTERVAL_HOURS || 24);

    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
        console.log("[DB] Chat retention cleanup disabled");
        return;
    }

    const intervalMs =
        Math.max(1, intervalHours) * 60 * 60 * 1000;

    const runCleanup = async () => {

        const startedAt = Date.now();

        try {

            const res = await dbAsync.run(
                `DELETE FROM messages
                 WHERE created_at < datetime('now', ?)`,
                [`-${Math.floor(retentionDays)} days`]
            );

            const convRes = await dbAsync.run(`
                DELETE FROM conversations
                WHERE id NOT IN (
                    SELECT DISTINCT conversation_id
                    FROM messages
                )
            `);

            const ms = Date.now() - startedAt;

            if (
                res.changes > 0 ||
                convRes.changes > 0
            ) {
                console.log(
                    `[DB] Cleanup: deleted messages=${res.changes}, empty conversations=${convRes.changes} (${ms}ms)`
                );
            }

        } catch (e) {
            console.error("[DB] Cleanup error:", e.message);
        }
    };

    setTimeout(() => {

        runCleanup();

        const interval = setInterval(
            runCleanup,
            intervalMs
        );

        if (typeof interval.unref === "function") {
            interval.unref();
        }

    }, 60000);
}

startChatRetentionCleanup();

module.exports = db;
module.exports.dbAsync = dbAsync;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;