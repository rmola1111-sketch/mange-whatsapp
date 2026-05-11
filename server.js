require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const db = require("./db/db");
const whatsappManager = require("./whatsapp/whatsapp.manager");
const { initWhatsApp } = require("./whatsapp/init");
const chatService = require("./services/chat.service");

process.on("uncaughtException", (err) => console.error("🔥 UNCAUGHT:", err));
process.on("unhandledRejection", (err) => console.error("🔥 REJECTION:", err));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function businessRoom(businessId) {
    return `business:${businessId}`;
}

function safeInt(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
}

function clampInt(value, def, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return def;
    const i = Math.floor(n);
    return Math.max(min, Math.min(max, i));
}

// ===== SOCKET.IO (TENANT ROOMS) =====
io.on("connection", (socket) => {
    // Client must explicitly join rooms (tenant isolation)
    socket.on("join_business", async (payload, ack) => {
        try {
            const businessId = safeInt(payload?.business_id);
            if (!businessId) {
                if (typeof ack === "function") ack({ ok: false, error: "invalid_business_id" });
                return;
            }

            // Optional safety: verify business exists (cheap read). If DB is under load, we still allow join.
            db.get("SELECT id FROM businesses WHERE id = ?", [businessId], (err, row) => {
                if (err) {
                    socket.join(businessRoom(businessId));
                    if (typeof ack === "function") ack({ ok: true, business_id: businessId, warning: "db_check_failed" });
                    return;
                }

                if (!row) {
                    if (typeof ack === "function") ack({ ok: false, error: "business_not_found" });
                    return;
                }

                socket.join(businessRoom(businessId));
                if (typeof ack === "function") ack({ ok: true, business_id: businessId });
            });
        } catch (e) {
            console.error("[Socket] join_business error:", e);
            if (typeof ack === "function") ack({ ok: false, error: "join_failed" });
        }
    });

    socket.on("leave_business", (payload, ack) => {
        try {
            const businessId = safeInt(payload?.business_id);
            if (!businessId) {
                if (typeof ack === "function") ack({ ok: false, error: "invalid_business_id" });
                return;
            }

            socket.leave(businessRoom(businessId));
            if (typeof ack === "function") ack({ ok: true, business_id: businessId });
        } catch (e) {
            console.error("[Socket] leave_business error:", e);
            if (typeof ack === "function") ack({ ok: false, error: "leave_failed" });
        }
    });
});

// Initialize WhatsApp manager after socket is ready
whatsappManager.init(io);

// ===== LIGHTWEIGHT DIAGNOSTICS (MEMORY/QUEUE/CLIENTS) =====
function startDiagnostics() {
    const intervalMs = 60000;

    const t = setInterval(() => {
        try {
            const wa = whatsappManager.getStatus ? whatsappManager.getStatus() : null;
            const mem = process.memoryUsage();

            const heapMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
            const rssMb = Math.round((mem.rss / 1024 / 1024) * 10) / 10;

            const sockets = io?.engine?.clientsCount || 0;

            console.log(
                `[Diagnostics] sockets=${sockets} heapMB=${heapMb} rssMB=${rssMb}` +
                (wa ? ` waClients=${wa.activeClients} waInit=${wa.initializingClients} waRetrying=${wa.retryingClients}` : "")
            );
        } catch (e) {
            console.error("[Diagnostics] error:", e.message);
        }
    }, intervalMs);

    // Do not keep process alive if this is the only active timer
    if (typeof t.unref === "function") t.unref();
}

startDiagnostics();

// ===== BUSINESSES ROUTES =====

// שליפת כל העסקים (תומך גם ביחיד וגם ברבים למניעת שגיאות 404)
const getBusinesses = (req, res) => {
    db.all("SELECT * FROM businesses", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
};
app.get("/api/businesses", getBusinesses);
app.get("/api/business", getBusinesses);

// יצירת עסק חדש
app.post("/api/businesses", (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: "Missing name or phone" });

    db.run(
        `INSERT INTO businesses (
            name, phone, is_active, connection_status,
            opening_hour, closing_hour, appointment_duration, timezone,
            created_at, updated_at
        ) VALUES (?, ?, 1, 'disconnected', '09:00', '18:00', 30, 'Asia/Jerusalem', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [name, phone],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            const lastId = this.lastID;

            // Fetch complete business record with all fields
            db.get("SELECT * FROM businesses WHERE id = ?", [lastId], (err2, biz) => {
                if (err2 || !biz) {
                    return res.json({ id: lastId, name, phone, is_active: 1 });
                }
                whatsappManager.createClient(biz);
                res.json(biz);
            });
        }
    );
});

// QR refresh / re-init (used by dashboard)
app.post("/api/businesses/:id/qr", async (req, res) => {
    const id = safeInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid business id" });

    try {
        const out = await whatsappManager.refreshClient(id);
        if (!out.ok) return res.status(404).json({ error: out.error || "Refresh failed" });
        res.json({ success: true });
    } catch (e) {
        console.error("[QR] Refresh error:", e);
        res.status(500).json({ error: "Refresh failed" });
    }
});

// Pairing code onboarding (mobile-friendly alternative to QR)
// NOTE: Falls back to QR flow if unsupported.
app.post("/api/businesses/:id/pairing-code", async (req, res) => {
    const id = safeInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid business id" });

    const phone = String(req.body?.phone || "").trim();
    if (!phone) return res.status(400).json({ error: "Missing phone" });

    try {
        const out = await whatsappManager.requestPairingCode(id, phone);
        if (!out.ok) {
            // Keep UX smooth: client can fallback to QR
            return res.status(409).json({ error: out.error || "pairing_code_failed", fallback: out.fallback || "qr" });
        }

        res.json({ success: true, code: out.code, phone: out.phone });
    } catch (e) {
        console.error("[Pairing] Error:", e);
        res.status(500).json({ error: "pairing_code_failed", fallback: "qr" });
    }
});


// עדכון פרטי עסק (כולל הגדרות תורים) - תומך ב-PUT וגם ב-POST update
const updateBusiness = (req, res) => {
    const {
        name, price, location, is_active,
        opening_hour, closing_hour, appointment_duration, timezone
    } = req.body;
    const id = req.params.id;

    // Validation
    if (opening_hour && closing_hour && opening_hour >= closing_hour) {
        return res.status(400).json({ error: "שעת פתיחה חייבת להיות לפני שעת סגירה" });
    }
    if (appointment_duration !== undefined && (appointment_duration < 5 || appointment_duration > 480)) {
        return res.status(400).json({ error: "משך תור חייב להיות בין 5 ל-480 דקות" });
    }

    // Build dynamic UPDATE query based on existing columns
    // This handles cases where new columns may not exist yet
    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push("name = ?"); values.push(name); }
    if (price !== undefined) { updates.push("price = ?"); values.push(price); }
    if (location !== undefined) { updates.push("location = ?"); values.push(location); }
    if (is_active !== undefined) { updates.push("is_active = ?"); values.push(is_active); }
    if (opening_hour !== undefined) { updates.push("opening_hour = ?"); values.push(opening_hour); }
    if (closing_hour !== undefined) { updates.push("closing_hour = ?"); values.push(closing_hour); }
    if (appointment_duration !== undefined) { updates.push("appointment_duration = ?"); values.push(appointment_duration); }
    if (timezone !== undefined) { updates.push("timezone = ?"); values.push(timezone); }

    if (updates.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
    }

    values.push(id);

    db.run(
        `UPDATE businesses SET ${updates.join(", ")} WHERE id = ?`,
        values,
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Business not found" });

            // Try to update timestamp (may fail silently if column doesn't exist)
            db.run("UPDATE businesses SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [id], () => {});

            // Return updated business
            db.get("SELECT * FROM businesses WHERE id = ?", [id], (err2, biz) => {
                if (err2) return res.json({ success: true });
                res.json({ success: true, business: biz });
            });
        }
    );
};
app.put("/api/businesses/:id", updateBusiness);
app.post("/api/businesses/update/:id", updateBusiness);

// קבלת עסק בודד
app.get("/api/businesses/:id", (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM businesses WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Business not found" });
        res.json(row);
    });
});

// הפעלה/כיבוי של בוט (עם הגנה מפני כפילויות)
const toggleInProgress = new Set();

app.post("/api/businesses/toggle/:id", async (req, res) => {
    const id = req.params.id;

    // Prevent duplicate toggle requests
    if (toggleInProgress.has(id)) {
        return res.status(429).json({ error: "פעולה בתהליך, אנא המתן" });
    }

    toggleInProgress.add(id);

    try {
        const row = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM businesses WHERE id=?", [id], (err, r) => {
                if (err) reject(err);
                else resolve(r);
            });
        });

        if (!row) {
            return res.status(404).json({ error: "Not found" });
        }

        const newStatus = row.is_active ? 0 : 1;

        await new Promise((resolve, reject) => {
            // Use simple UPDATE - updated_at column may not exist in older DBs
            db.run("UPDATE businesses SET is_active=? WHERE id=?", [newStatus, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Try to update timestamp separately (safe if column doesn't exist)
        db.run("UPDATE businesses SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [id], () => {});

        const businessId = safeInt(id);
        if (newStatus === 0) {
            // Use manager API for full cleanup (prevents memory leaks + reconnect resurrection)
            await whatsappManager.destroyClient(businessId, { reason: "toggle_off" });
        } else if (newStatus === 1) {
            // Fetch fresh row and start client (idempotent)
            db.get("SELECT * FROM businesses WHERE id=?", [id], (err, fresh) => {
                if (fresh) whatsappManager.createClient({ ...fresh, is_active: 1 });
            });
        }

        res.json({ success: true, is_active: newStatus });
    } catch (err) {
        console.error(`[Toggle] Error:`, err);
        res.status(500).json({ error: err.message });
    } finally {
        toggleInProgress.delete(id);
    }
});

// מחיקת עסק (עם try/catch יציב)
app.delete("/api/businesses/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const businessId = safeInt(id);
        if (!businessId) return res.status(400).json({ error: "Invalid business id" });

        // Safely destroy WhatsApp client if exists (full cleanup)
        await whatsappManager.destroyClient(businessId, { reason: "delete" });

        // Delete from database
        await new Promise((resolve, reject) => {
            db.run("DELETE FROM businesses WHERE id=?", [id], function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        // Also delete related data (best-effort; foreign_keys ON may handle some)
        db.run("DELETE FROM bookings WHERE business_id=?", [id], () => {});
        db.run("DELETE FROM sessions WHERE business_id=?", [id], () => {});
        db.run("DELETE FROM services WHERE business_id=?", [id], () => {});

        res.json({ success: true });
    } catch (err) {
        console.error(`[Delete] Error:`, err);
        res.status(500).json({ error: err.message });
    }
});

// ===== CHAT ROUTES (Premium Inbox) =====

// List conversations for a business
app.get("/api/conversations", async (req, res) => {
    try {
        const businessId = safeInt(req.query.business_id);
        if (!businessId) return res.status(400).json({ error: "Missing business_id" });

        const limit = clampInt(req.query.limit, 100, 1, 200);
        const offset = clampInt(req.query.offset, 0, 0, 100000);

        const conversations = await chatService.listConversations(businessId, { limit, offset });
        res.json(conversations || []);
    } catch (err) {
        console.error("[Chat] List conversations error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get messages for a conversation
app.get("/api/conversations/:id/messages", async (req, res) => {
    try {
        const id = safeInt(req.params.id);
        if (!id) return res.status(400).json({ error: "Invalid conversation id" });

        const limit = clampInt(req.query.limit, 200, 1, 500);
        const offset = clampInt(req.query.offset, 0, 0, 200000);

        const messages = await chatService.listMessages(id, { limit, offset });
        res.json(messages || []);
    } catch (err) {
        console.error("[Chat] List messages error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Send admin message to customer via WhatsApp
app.post("/api/conversations/:id/messages", async (req, res) => {
    try {
        const conversationId = safeInt(req.params.id);
        if (!conversationId) return res.status(400).json({ error: "Invalid conversation id" });

        const { message } = req.body || {};
        if (!message || !String(message).trim()) {
            return res.status(400).json({ error: "Missing message" });
        }

        const convo = await chatService.getConversation(conversationId);
        if (!convo) return res.status(404).json({ error: "Conversation not found" });

        const send = await whatsappManager.sendAdminMessage(convo.business_id, convo.customer_phone, String(message).trim());
        if (!send.ok) {
            return res.status(503).json({ error: "WhatsApp client not ready" });
        }

        // Return updated messages (lightweight)
        res.json({ success: true });
    } catch (err) {
        console.error("[Chat] Send message error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Mark conversation as read
app.post("/api/conversations/:id/read", async (req, res) => {
    try {
        const conversationId = safeInt(req.params.id);
        if (!conversationId) return res.status(400).json({ error: "Invalid conversation id" });

        const updated = await chatService.markConversationRead(conversationId);
        if (!updated) return res.status(404).json({ error: "Conversation not found" });

        // Emit realtime update (tenant-scoped)
        io.to(businessRoom(updated.business_id)).emit("conversation_updated", {
            business_id: updated.business_id,
            conversation: updated
        });

        res.json({ success: true, conversation: updated });
    } catch (err) {
        console.error("[Chat] Read error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Toggle BOT/MANUAL mode
app.post("/api/conversations/:id/mode", async (req, res) => {
    try {
        const conversationId = safeInt(req.params.id);
        if (!conversationId) return res.status(400).json({ error: "Invalid conversation id" });

        const { mode } = req.body || {};

        const updated = await chatService.setConversationMode(conversationId, mode);
        if (!updated) return res.status(404).json({ error: "Conversation not found" });

        io.to(businessRoom(updated.business_id)).emit("conversation_updated", {
            business_id: updated.business_id,
            conversation: updated
        });

        res.json({ success: true, conversation: updated });
    } catch (err) {
        console.error("[Chat] Mode error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ===== BOOKINGS ROUTES =====

// שליפת כל התורים מהיומן
app.get("/api/bookings", (req, res) => {
    db.all(
        `
        SELECT b.*, biz.name as business_name 
        FROM bookings b 
        JOIN businesses biz ON b.business_id = biz.id 
        ORDER BY b.datetime DESC
    `,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    initWhatsApp(); // הפעלת הבוטים השמורים ב-DB בטעינת השרת
});
