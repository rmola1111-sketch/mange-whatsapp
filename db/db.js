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

// ===== DATABASE CONNECTION =====
const dbPath = path.join(__dirname, "..", "database.sqlite");
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("❌ DB connection error:", err.message);
    } else {
        console.log("✅ Connected to SQLite database:", dbPath);
    }
});

// ===== PRODUCTION SQLITE SETTINGS =====
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA foreign_keys = ON");

// ===== SAFE MIGRATION RUNNER =====
// SQLite does NOT allow DEFAULT CURRENT_TIMESTAMP in ALTER TABLE ADD COLUMN
// So we add columns WITHOUT defaults, then backfill with UPDATE
function runMigration(sql, description) {
    db.run(sql, [], (err) => {
        if (err) {
            // Silently ignore expected errors
            const msg = err.message.toLowerCase();
            if (msg.includes('duplicate column') || 
                msg.includes('already exists') ||
                msg.includes('no such column')) {
                // Expected - column already exists or table structure issue
                return;
            }
            console.error(`❌ Migration failed (${description}):`, err.message);
        }
    });
}

// Safe column adder - adds column without dynamic default
function addColumnSafe(table, column, type, staticDefault = null) {
    const defaultClause = staticDefault !== null ? ` DEFAULT ${staticDefault}` : '';
    runMigration(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`,
        `${table}.${column}`
    );
}

// Backfill NULL values with CURRENT_TIMESTAMP
function backfillTimestamp(table, column) {
    db.run(`UPDATE ${table} SET ${column} = CURRENT_TIMESTAMP WHERE ${column} IS NULL`, [], (err) => {
        if (err && !err.message.includes('no such column')) {
            console.error(`❌ Backfill failed (${table}.${column}):`, err.message);
        }
    });
}

// ===== CREATE TABLES =====
db.serialize(() => {
    
    // 1. BUSINESSES TABLE (with booking settings)
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

    // 2. SERVICES TABLE (normalized - multiple services per business)
    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            duration INTEGER DEFAULT 30,
            price INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )
    `);

    // 3. BOOKINGS TABLE
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
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
        )
    `);

        // 4. SESSIONS TABLE (conversation state machine)
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            customer_phone TEXT NOT NULL,
            business_id INTEGER NOT NULL,
            step TEXT DEFAULT 'idle',
            data TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(customer_phone, business_id),
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )
    `);

    // 5. CONVERSATIONS TABLE (premium inbox)
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
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )
    `);

    // 6. MESSAGES TABLE
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            sender TEXT NOT NULL, -- customer | bot | admin
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
    `);


        // ===== MIGRATIONS FOR EXISTING TABLES =====
    // SQLite-safe: Add columns WITHOUT dynamic defaults, then backfill
    
    // Add new columns to businesses (static defaults only)
    addColumnSafe("businesses", "opening_hour", "TEXT", "'09:00'");
    addColumnSafe("businesses", "closing_hour", "TEXT", "'18:00'");
    addColumnSafe("businesses", "appointment_duration", "INTEGER", "30");
    addColumnSafe("businesses", "timezone", "TEXT", "'Asia/Jerusalem'");
    
    // Timestamp columns - NO default (SQLite limitation)
    addColumnSafe("businesses", "created_at", "DATETIME");
    addColumnSafe("businesses", "updated_at", "DATETIME");
    
    // Add new columns to bookings
    addColumnSafe("bookings", "service_id", "INTEGER");
    addColumnSafe("bookings", "customer_name", "TEXT");
    addColumnSafe("bookings", "status", "TEXT", "'confirmed'");
    addColumnSafe("bookings", "updated_at", "DATETIME");
    
    // Add new columns to services
    addColumnSafe("services", "created_at", "DATETIME");
    
    // Add data column to sessions for state machine
    addColumnSafe("sessions", "data", "TEXT");
    addColumnSafe("sessions", "updated_at", "DATETIME");

        // ===== PRODUCTION INDEXES =====
    db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(customer_phone)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_datetime ON bookings(datetime)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(connection_status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_businesses_active ON businesses(is_active)`);

    // Conversations indexes
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique ON conversations(business_id, customer_phone)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_business ON conversations(business_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_unread ON conversations(unread_count)`);

    // Messages indexes
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`);
    
    // Unique constraint for bookings
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_unique ON bookings(business_id, datetime)`);


        // ===== BACKFILL TIMESTAMP COLUMNS =====
    // Fill NULL timestamps with current time for existing records
    backfillTimestamp("businesses", "created_at");
    backfillTimestamp("businesses", "updated_at");
    backfillTimestamp("bookings", "created_at");
    backfillTimestamp("bookings", "updated_at");
    backfillTimestamp("services", "created_at");
    backfillTimestamp("sessions", "updated_at");
    
    console.log("✅ Database schema initialized");
});

// ===== PROMISIFIED HELPERS =====
const dbAsync = {
    get: (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    }),
    run: (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    })
};

// ===== CHAT RETENTION (AUTO CLEANUP) =====
// Keeps storage bounded without changing any existing API behavior.
// NOTE: Deleting rows does not always shrink database.sqlite on disk until VACUUM is run.
function startChatRetentionCleanup() {
    const retentionDays = Number(process.env.CHAT_RETENTION_DAYS || 90); // ~3 months by default
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
            // Delete old messages in small batches to reduce long write locks.
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

                // Yield to event loop
                await new Promise(r => setTimeout(r, 25));
            }

            // Remove conversations that have no messages left.
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

    // Stagger first run a bit after startup
    const t = setTimeout(() => {
        runCleanup();
        const interval = setInterval(runCleanup, intervalMs);
        if (typeof interval.unref === "function") interval.unref();
    }, 60 * 1000);

    if (typeof t.unref === "function") t.unref();
}

startChatRetentionCleanup();

module.exports = db;
module.exports.dbAsync = dbAsync;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

