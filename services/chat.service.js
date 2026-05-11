// /services/chat.service.js
// Minimal chat persistence layer for premium SaaS inbox.
// Keeps existing architecture intact: sqlite3 + callbacks via db.dbAsync.

const db = require("../db/db");
const dbAsync = db.dbAsync;

function nowIso() {
    return new Date().toISOString();
}

async function getOrCreateConversation(businessId, customerPhone) {
    // Try existing
    const existing = await dbAsync.get(
        "SELECT * FROM conversations WHERE business_id = ? AND customer_phone = ?",
        [businessId, customerPhone]
    );
    if (existing) return existing;

    // Create
    const res = await dbAsync.run(
        `INSERT INTO conversations (
            business_id, customer_phone, mode,
            last_message, last_message_at,
            unread_count, created_at, updated_at
        ) VALUES (?, ?, 'bot', NULL, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [businessId, customerPhone]
    );

    return await dbAsync.get("SELECT * FROM conversations WHERE id = ?", [res.lastID]);
}

async function updateConversationPreview(conversationId, updates) {
    const fields = [];
    const values = [];

    if (updates.last_message !== undefined) {
        fields.push("last_message = ?");
        values.push(updates.last_message);
    }
    if (updates.last_message_at !== undefined) {
        fields.push("last_message_at = ?");
        values.push(updates.last_message_at);
    }
    if (updates.unread_count !== undefined) {
        fields.push("unread_count = ?");
        values.push(updates.unread_count);
    }
    if (updates.mode !== undefined) {
        fields.push("mode = ?");
        values.push(updates.mode);
    }

    // Always update updated_at
    fields.push("updated_at = CURRENT_TIMESTAMP");

    values.push(conversationId);

    await dbAsync.run(
        `UPDATE conversations SET ${fields.join(", ")} WHERE id = ?`,
        values
    );

    return await dbAsync.get("SELECT * FROM conversations WHERE id = ?", [conversationId]);
}

async function addMessage(conversationId, sender, message) {
    await dbAsync.run(
        `INSERT INTO messages (conversation_id, sender, message, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [conversationId, sender, message]
    );
}

async function ingestInboundCustomerMessage(businessId, customerPhone, messageText) {
    const convo = await getOrCreateConversation(businessId, customerPhone);

    await addMessage(convo.id, "customer", messageText);

    const newUnread = (convo.unread_count || 0) + 1;
    const updated = await updateConversationPreview(convo.id, {
        last_message: messageText,
        last_message_at: nowIso(),
        unread_count: newUnread
    });

    return { conversation: updated };
}

async function ingestOutboundMessageByPhone(businessId, customerPhone, sender, messageText) {
    const convo = await getOrCreateConversation(businessId, customerPhone);

    await addMessage(convo.id, sender, messageText);

    const updated = await updateConversationPreview(convo.id, {
        last_message: messageText,
        last_message_at: nowIso()
        // unread_count unchanged for outbound
    });

    return { conversation: updated };
}

function normalizeListOptions(opts, defaults) {
    // Backward compatibility: allow old signature listXxx(id, limitNumber)
    if (typeof opts === "number") {
        return { limit: opts, offset: 0 };
    }

    const limit = Number(opts?.limit);
    const offset = Number(opts?.offset);

    return {
        limit: Number.isFinite(limit) ? limit : defaults.limit,
        offset: Number.isFinite(offset) ? offset : defaults.offset
    };
}

async function listConversations(businessId, opts = {}) {
    const { limit, offset } = normalizeListOptions(opts, { limit: 100, offset: 0 });

    return await dbAsync.all(
        `SELECT * FROM conversations 
         WHERE business_id = ?
         ORDER BY COALESCE(last_message_at, created_at) DESC
         LIMIT ? OFFSET ?`,
        [businessId, limit, offset]
    );
}

async function getConversation(conversationId) {
    return await dbAsync.get("SELECT * FROM conversations WHERE id = ?", [conversationId]);
}

async function listMessages(conversationId, opts = {}) {
    const { limit, offset } = normalizeListOptions(opts, { limit: 200, offset: 0 });

    return await dbAsync.all(
        `SELECT * FROM messages 
         WHERE conversation_id = ?
         ORDER BY id ASC
         LIMIT ? OFFSET ?`,
        [conversationId, limit, offset]
    );
}

async function markConversationRead(conversationId) {
    const convo = await getConversation(conversationId);
    if (!convo) return null;

    return await updateConversationPreview(conversationId, { unread_count: 0 });
}

async function setConversationMode(conversationId, mode) {
    const allowed = new Set(["bot", "manual"]);
    const finalMode = allowed.has(mode) ? mode : "bot";
    return await updateConversationPreview(conversationId, { mode: finalMode });
}

async function getConversationModeByPhone(businessId, customerPhone) {
    const convo = await dbAsync.get(
        "SELECT mode FROM conversations WHERE business_id = ? AND customer_phone = ?",
        [businessId, customerPhone]
    );
    return convo?.mode || "bot";
}

module.exports = {
    ingestInboundCustomerMessage,
    ingestOutboundMessageByPhone,
    listConversations,
    listMessages,
    getConversation,
    markConversationRead,
    setConversationMode,
    getConversationModeByPhone
};
