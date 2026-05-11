הנה קובץ מלא, מתוקן ויציב יותר ל־`/db/db.js`
מוכן להעתקה מלאה בלי לשבור את המערכת שלך.

הקוד כולל:

* SQLite יציב יותר
* מניעת SQLITE_BUSY
* Indexes טובים יותר
* Dedup table להודעות
* Cleanup יציב
* Async wrappers
* Migrations בטוחות
* WAL mode
* Foreign keys
* Retry-safe structure

```javascript
// /db/db.js

const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// ===== DEFAULT BUSINESS SETTINGS =====
const DEFAULT_SETTINGS = {
    opening_hour: "09:00",
    closing_hour: "18:00",
    appointment_duration: 30,
    timezone: "Asia/Jerusalem"
};

// ===== DATABASE PATH =====
const dbPath = path.join(__dirname, "..", "database.sqlite");

// ===== DATABASE CONNECTION =====
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("❌ SQLite connection error:", err.message);
        process.exit(1);
    }

    console.log("✅ Connected to SQLite database:", dbPath);
});

// ===== SQLITE PRODUCTION SETTINGS =====
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA temp_store = MEMORY");
    db.run("PRAGMA cache_size = -64000");
});

// ===== SAFE MIGRATION HELPERS =====
function runMigration(sql, description = "migration") {
    db.run(sql, [], (err) => {
        if (!err) return;

        const msg = err.message.toLowerCase();

        if (
            msg.includes("duplicate column") ||
            msg.includes("already exists") ||
            msg.includes("no such column")
        ) {
            return;
        }

        console.error(`❌ Migration failed (${description}):`, err.message);
    });
}

function addColumnSafe(table, column, type, staticDefault = null) {
    const defaultClause =
        staticDefault !== null ? ` DEFAULT ${staticDefault}` : "";

    runMigration(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`,
        `${table}.${column}`
    );
}

function backfillTimestamp(table, column) {
    db.run(
        `UPDATE ${table} 
         SET ${column} = CURRENT_TIMESTAMP 
         WHERE ${column} IS NULL`,
        [],
        (err) => {
            if (err && !err.message.includes("no such column")) {
                console.error(
                    `❌ Backfill failed (${table}.${column}):`,
                    err.message
                );
            }
        }
    );
}

// ===== CREATE TABLES =====
db.serialize(() => {

    // ===== BUSINESSES =====
    db.run(`
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
        )
    `);

    // ===== SERVICES =====
    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL,

            name TEXT NOT NULL,
            duration INTEGER DEFAULT 30,
            price INTEGER DEFAULT 0,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (business_id)
            REFERENCES businesses(id)
            ON DELETE CASCADE
        )
    `);

    // ===== BOOKINGS =====
    db.run(`
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

            FOREIGN KEY (business_id)
            REFERENCES businesses(id)
            ON DELETE CASCADE,

            FOREIGN KEY (service_id)
            REFERENCES services(id)
            ON DELETE SET NULL
        )
    `);

    // ===== SESSIONS =====
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            customer_phone TEXT NOT NULL,
            business_id INTEGER NOT NULL,

            step TEXT DEFAULT 'idle',
            data TEXT,

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            PRIMARY KEY(customer_phone, business_id),

            FOREIGN KEY (business_id)
            REFERENCES businesses(id)
            ON DELETE CASCADE
        )
    `);

    // ===== CONVERSATIONS =====
    db.run(`
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

            FOREIGN KEY (business_id)
            REFERENCES businesses(id)
            ON DELETE CASCADE
        )
    `);

    // ===== MESSAGES =====
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            conversation_id INTEGER NOT NULL,

            sender TEXT NOT NULL,
            message TEXT NOT NULL,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (conversation_id)
            REFERENCES conversations(id)
            ON DELETE CASCADE
        )
    `);

    // ===== MESSAGE DEDUP =====
    db.run(`
        CREATE TABLE IF NOT EXISTS processed_messages (
            id TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ===== SAFE MIGRATIONS =====
    addColumnSafe("businesses", "opening_hour", "TEXT", "'09:00'");
    addColumnSafe("businesses", "closing_hour", "TEXT", "'18:00'");
    addColumnSafe("businesses", "appointment_duration", "INTEGER", "30");
    addColumnSafe("businesses", "timezone", "TEXT", "'Asia/Jerusalem'");

    addColumnSafe("bookings", "service_id", "INTEGER");
    addColumnSafe("bookings", "customer_name", "TEXT");
    addColumnSafe("bookings", "status", "TEXT", "'confirmed'");
    addColumnSafe("bookings", "updated_at", "DATETIME");

    addColumnSafe("sessions", "data", "TEXT");

    // ===== INDEXES =====
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_bookings_business
        ON bookings(business_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_bookings_datetime
        ON bookings(datetime)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_services_business
        ON services(business_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_sessions_updated
        ON sessions(updated_at)
    `);

    db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique
        ON conversations(business_id, customer_phone)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id)
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_created_at
        ON messages(created_at)
    `);

    db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_unique
        ON bookings(business_id, datetime)
    `);

    // ===== BACKFILL =====
    backfillTimestamp("businesses", "created_at");
    backfillTimestamp("businesses", "updated_at");

    backfillTimestamp("bookings", "created_at");
    backfillTimestamp("bookings", "updated_at");

    backfillTimestamp("sessions", "updated_at");

    console.log("✅ Database schema initialized");
});

// ===== PROMISIFIED HELPERS =====
const dbAsync = {

    get(sql, params = []) {
        return new Promise((resolve, reject) => {

            db.get(sql, params, (err, row) => {

                if (err) {
                    reject(err);
                    return;
                }

                resolve(row);
            });

        });
    },

    all(sql, params = []) {
        return new Promise((resolve, reject) => {

            db.all(sql, params, (err, rows) => {

                if (err) {
                    reject(err);
                    return;
                }

                resolve(rows || []);
            });

        });
    },

    run(sql, params = []) {
        return new Promise((resolve, reject) => {

            db.run(sql, params, function(err) {

                if (err) {
                    reject(err);
                    return;
                }

                resolve({
                    lastID: this.lastID,
                    changes: this.changes
                });

            });

        });
    }

};

// ===== CHAT CLEANUP =====
function startChatRetentionCleanup() {

    const retentionDays = Number(
        process.env.CHAT_RETENTION_DAYS || 90
    );

    const intervalHours = Number(
        process.env.CHAT_CLEANUP_INTERVAL_HOURS || 24
    );

    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
        console.log("⚠️ Chat cleanup disabled");
        return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    const runCleanup = async () => {

        try {

            const modifier = `-${retentionDays} days`;

            const result = await dbAsync.run(
                `
                DELETE FROM messages
                WHERE created_at < datetime('now', ?)
                `,
                [modifier]
            );

            await dbAsync.run(`
                DELETE FROM processed_messages
                WHERE created_at < datetime('now', '-7 days')
            `);

            console.log(
                `🧹 Deleted ${result.changes} old messages`
            );

        } catch (err) {

            console.error(
                "❌ Cleanup error:",
                err.message
            );

        }

    };

    setTimeout(runCleanup, 30000);

    setInterval(runCleanup, intervalMs);
}

startChatRetentionCleanup();

// ===== EXPORTS =====
module.exports = db;
module.exports.dbAsync = dbAsync;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
```
