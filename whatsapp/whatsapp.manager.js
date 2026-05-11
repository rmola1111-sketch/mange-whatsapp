const { Client, LocalAuth } = require("whatsapp-web.js");
const db = require("../db/db");
const { handleMessage } = require("../services/bot.service");
const chatService = require("../services/chat.service");

let io;

// Keep existing exports/shape
const clients = {};
const retryMap = {};
const initializingClients = new Set(); // Prevents race condition on concurrent createClient calls
const clientQueues = new Map(); // Track queues for cleanup

// ===== LIFECYCLE SAFETY =====
// Serializes create/destroy per business
const lifecycleLocks = new Map(); // businessId -> Promise

// Prevent reconnect timers from resurrecting disabled/deleted clients
const reconnectTimers = new Map(); // businessId -> Timeout

// Track init timeout timers so we can cancel them on destroy
const initTimeouts = new Map(); // businessId -> Timeout

// When we intentionally stop a client, do NOT auto-reconnect.
const stopRequested = new Set(); // businessId

// Pairing code request de-duplication
const pairingLocks = new Map(); // businessId -> Promise


// ===== CONSTANTS =====
const MAX_QUEUE_SIZE = 100;
const MAX_QUEUE_WAIT_SECONDS = 30;
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 10000;
const MAX_RETRY_DELAY_MS = 300000; // 5 minutes
const INIT_TIMEOUT_MS = 60000; // 60 seconds
const MESSAGE_SEND_DELAY_MS = 300;
const SEND_RETRY_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 500;

const dbAsync = db.dbAsync;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function roomName(businessId) {
    return `business:${businessId}`;
}

function emitToBusiness(businessId, event, payload) {
    try {
        if (!io) return;
        io.to(roomName(businessId)).emit(event, payload);
    } catch (e) {
        console.error(`[WhatsApp] Socket emit error for business ${businessId}:`, e.message);
    }
}

function init(socket) {
    io = socket;
    console.log("[WhatsApp Manager] Initialized with Socket.IO");
}

function withLifecycleLock(businessId, fn) {
    const prev = lifecycleLocks.get(businessId) || Promise.resolve();

    const next = prev
        .catch(() => {})
        .then(async () => fn())
        .finally(() => {
            // Only delete if we are still the last lock
            if (lifecycleLocks.get(businessId) === next) {
                lifecycleLocks.delete(businessId);
            }
        });

    lifecycleLocks.set(businessId, next);
    return next;
}

function clearReconnectTimer(businessId) {
    const t = reconnectTimers.get(businessId);
    if (t) {
        clearTimeout(t);
        reconnectTimers.delete(businessId);
    }
}

function clearInitTimeout(businessId) {
    const t = initTimeouts.get(businessId);
    if (t) {
        clearTimeout(t);
        initTimeouts.delete(businessId);
    }
}

async function scheduleReconnect(businessId, meta = {}) {
    try {
        if (stopRequested.has(businessId)) {
            return;
        }

        const retries = retryMap[businessId] || 0;
        if (retries >= MAX_RETRY_ATTEMPTS) {
            console.error(`[WhatsApp] ❌ Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached for business ${businessId}. Manual intervention required.`);
            delete retryMap[businessId];

            db.run(
                "UPDATE businesses SET connection_status='failed' WHERE id=?",
                [businessId],
                () => {}
            );

            emitToBusiness(businessId, `status_${businessId}`, {
                status: "failed",
                message: "Max retry attempts reached"
            });

            return;
        }

        // Exponential backoff: 10s, 20s, 40s, 80s, 160s (capped at 5 min)
        const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retries), MAX_RETRY_DELAY_MS);
        retryMap[businessId] = retries + 1;

        clearReconnectTimer(businessId);

        console.log(`[WhatsApp] Scheduling reconnect for business ${businessId} - attempt ${retryMap[businessId]}/${MAX_RETRY_ATTEMPTS} in ${Math.round(delay / 1000)}s`);

        const timer = setTimeout(async () => {
            reconnectTimers.delete(businessId);

            try {
                // Always fetch fresh state to avoid resurrecting inactive businesses
                const biz = await dbAsync.get("SELECT * FROM businesses WHERE id=?", [businessId]);
                if (!biz) {
                    console.log(`[WhatsApp] Reconnect skipped for business ${businessId}: business not found`);
                    return;
                }

                if (biz.is_active === 0) {
                    console.log(`[WhatsApp] Reconnect skipped for business ${businessId}: business is inactive`);
                    return;
                }

                createClient(biz);
            } catch (e) {
                console.error(`[WhatsApp] Reconnect fetch/init error for business ${businessId}:`, e.message);
            }
        }, delay);

        reconnectTimers.set(businessId, timer);

    } catch (e) {
        console.error(`[WhatsApp] scheduleReconnect error for business ${businessId}:`, e.message);
    }
}

// ===== PUBLIC LIFECYCLE API =====

/**
 * Idempotent destroy with full cleanup (listeners/timers/reconnect).
 * Safe to call even if client is missing.
 */
function destroyClient(businessId, options = {}) {
    const id = Number(businessId);
    if (!id) return Promise.resolve(false);

    return withLifecycleLock(id, async () => {
        const reason = options.reason || "manual";

        // Prevent auto-reconnect while we are intentionally stopping
        stopRequested.add(id);

        clearReconnectTimer(id);
        clearInitTimeout(id);

        const client = clients[id];

        // Always clear queue references
        const queue = clientQueues.get(id);
        if (queue) {
            const queueLength = queue.length;
            queue.length = 0;
            clientQueues.delete(id);
            if (queueLength > 0) {
                console.log(`[WhatsApp] Cleared ${queueLength} pending messages during destroy (${reason}) for business ${id}`);
            }
        }

        // Best-effort cleanup for init flags
        initializingClients.delete(id);

        if (!client) {
            delete retryMap[id];
            stopRequested.delete(id);
            return true;
        }

        try {
            // Avoid reconnect logic triggered by existing listeners
            if (typeof client.removeAllListeners === "function") {
                client.removeAllListeners();
            }
        } catch (e) {
            console.error(`[WhatsApp] removeAllListeners error for business ${id}:`, e.message);
        }

        try {
            await client.destroy();
        } catch (e) {
            console.error(`[WhatsApp] destroy() error for business ${id}:`, e.message);
        }

        delete clients[id];
        delete retryMap[id];
        stopRequested.delete(id);

        return true;
    });
}

async function refreshClient(businessId) {
    const id = Number(businessId);
    if (!id) return { ok: false, error: "invalid_business_id" };

    try {
        const biz = await dbAsync.get("SELECT * FROM businesses WHERE id=?", [id]);
        if (!biz) return { ok: false, error: "business_not_found" };

        await destroyClient(id, { reason: "refresh" });

        if (biz.is_active === 0) {
            return { ok: true, skipped: true, reason: "inactive" };
        }

        createClient(biz);
        return { ok: true };
    } catch (e) {
        console.error(`[WhatsApp] refreshClient error for business ${id}:`, e.message);
        return { ok: false, error: "refresh_failed" };
    }
}

// ===== CREATE CLIENT (IDEMPOTENT + LOCKED) =====

function createClient(business) {
    // Keep backward compatibility: callers can ignore the returned promise.
    if (!business || !business.id) {
        console.error("[WhatsApp] createClient called with invalid business");
        return Promise.resolve(false);
    }

    const businessId = Number(business.id);

    return withLifecycleLock(businessId, async () => {
        try {
            // Safety checks
            if (business.is_active === 0) {
                console.log(`[WhatsApp] Business ${businessId} is inactive, skipping`);
                return false;
            }

            // If a reconnect was scheduled, and we are starting now, cancel it.
            clearReconnectTimer(businessId);

            // Idempotency
            if (clients[businessId]) {
                // If already initialized/exists, do nothing
                console.log(`[WhatsApp] Client ${businessId} already exists, skipping`);
                return true;
            }

            if (initializingClients.has(businessId)) {
                console.log(`[WhatsApp] Client ${businessId} already initializing, skipping`);
                return true;
            }

            // Mark as initializing to prevent race conditions
            initializingClients.add(businessId);
            stopRequested.delete(businessId); // allow reconnect behavior for this new run

            console.log(`[WhatsApp] Starting client for business ${businessId} (${business.name})`);

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: `business_${businessId}`
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--no-zygote",
                        "--disable-gpu"
                    ]
                }
            });

            const messageQueue = [];
            let isProcessing = false;

            // Store queue reference for cleanup
            clientQueues.set(businessId, messageQueue);

            // ===== QUEUE =====
            function enqueueOutbound(to, body) {
                try {
                    if (!to || !body) return;

                    if (messageQueue.length >= MAX_QUEUE_SIZE) {
                        console.warn(`[WhatsApp] Queue overflow for business ${businessId}, dropping oldest outbound message (queue size: ${messageQueue.length})`);
                        messageQueue.shift();
                    }

                    messageQueue.push({ to, body });
                    processQueue();
                } catch (e) {
                    console.error(`[WhatsApp] enqueueOutbound error for business ${businessId}:`, e.message);
                }
            }

            async function processQueue() {
                if (isProcessing) return;
                isProcessing = true;

                let waitAttempts = 0;

                try {
                    while (messageQueue.length > 0) {
                        // Wait for client to be ready with timeout
                        if (!client.info) {
                            waitAttempts++;
                            if (waitAttempts > MAX_QUEUE_WAIT_SECONDS) {
                                // Important: do NOT drop queue. We exit gracefully and resume on "ready".
                                console.error(`[WhatsApp] Queue wait timeout for business ${businessId} - client not ready after ${MAX_QUEUE_WAIT_SECONDS}s (queue size: ${messageQueue.length})`);
                                return;
                            }
                            await sleep(1000);
                            continue;
                        }

                        waitAttempts = 0;

                        const { to, body } = messageQueue.shift();

                        let attempts = 0;
                        let sent = false;

                        while (!sent && attempts < SEND_RETRY_ATTEMPTS) {
                            try {
                                await client.sendMessage(to, body);
                                sent = true;
                            } catch (e) {
                                attempts++;
                                console.error(`[WhatsApp] Send retry ${attempts}/${SEND_RETRY_ATTEMPTS} for business ${businessId}:`, e.message);
                                if (attempts < SEND_RETRY_ATTEMPTS) {
                                    await sleep(SEND_RETRY_DELAY_MS);
                                }
                            }
                        }

                        if (!sent) {
                            console.error(`[WhatsApp] Failed to send message after ${SEND_RETRY_ATTEMPTS} attempts for business ${businessId}`);
                        }

                        await sleep(MESSAGE_SEND_DELAY_MS);
                    }
                } catch (error) {
                    console.error(`[WhatsApp] Queue processing error for business ${businessId}:`, error.message);
                } finally {
                    isProcessing = false;
                }
            }

            // ===== INITIALIZATION TIMEOUT =====
            clearInitTimeout(businessId);

            const initTimeout = setTimeout(async () => {
                try {
                    if (initializingClients.has(businessId) && !clients[businessId]) {
                        console.error(`[WhatsApp] Init timeout for business ${businessId} after ${INIT_TIMEOUT_MS / 1000}s`);
                        initializingClients.delete(businessId);

                        try {
                            if (typeof client.removeAllListeners === "function") client.removeAllListeners();
                        } catch {}

                        try {
                            await client.destroy();
                        } catch {}

                        clientQueues.delete(businessId);

                        // retry init
                        await scheduleReconnect(businessId, { reason: "init_timeout" });
                    }
                } catch (e) {
                    console.error(`[WhatsApp] Init timeout handler error for business ${businessId}:`, e.message);
                }
            }, INIT_TIMEOUT_MS);

            initTimeouts.set(businessId, initTimeout);

            // ===== EVENTS =====
            client.on("qr", (qr) => {
                console.log(`[WhatsApp] QR generated for business ${businessId}`);
                emitToBusiness(businessId, `qr_${businessId}`, { qr });
            });

            client.on("ready", () => {
                clearInitTimeout(businessId);
                initializingClients.delete(businessId);
                retryMap[businessId] = 0;

                console.log(`[WhatsApp] ✅ Client ready for business ${businessId} (${business.name})`);

                emitToBusiness(businessId, `status_${businessId}`, { status: "connected" });

                // Resume queue if it previously timed out while waiting for readiness
                if (messageQueue.length > 0) {
                    processQueue();
                }

                db.run(
                    "UPDATE businesses SET connection_status='connected' WHERE id=?",
                    [businessId],
                    () => {}
                );
            });

            client.on("message", async (msg) => {
                // Ignore group messages
                if (msg.from && msg.from.includes("@g.us")) return;

                try {
                    const customerPhone = msg.from;
                    const incomingText = msg.body || "";

                    // Persist inbound message + update conversation/unread
                    let convo;
                    try {
                        const ingest = await chatService.ingestInboundCustomerMessage(businessId, customerPhone, incomingText);
                        convo = ingest?.conversation;

                        if (convo) {
                            emitToBusiness(businessId, "conversation_updated", { business_id: businessId, conversation: convo });
                            emitToBusiness(businessId, "new_message", {
                                business_id: businessId,
                                conversation_id: convo.id,
                                sender: "customer",
                                message: incomingText,
                                created_at: new Date().toISOString()
                            });
                        }
                    } catch (e) {
                        console.error(`[WhatsApp] Chat persistence error for business ${businessId}:`, e.message);
                    }

                    // Manual mode: bot should not reply
                    try {
                        const mode = await chatService.getConversationModeByPhone(businessId, customerPhone);
                        if (mode === "manual") {
                            return;
                        }
                    } catch (e) {
                        console.error(`[WhatsApp] Mode fetch error for business ${businessId}:`, e.message);
                    }

                    const reply = await Promise.race([
                        handleMessage(businessId, customerPhone, incomingText),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error("Handler timeout")), 5000)
                        )
                    ]);

                    if (reply) {
                        // Persist bot message
                        try {
                            const out = await chatService.ingestOutboundMessageByPhone(businessId, customerPhone, "bot", reply);
                            const updated = out?.conversation;
                            if (updated) {
                                emitToBusiness(businessId, "conversation_updated", { business_id: businessId, conversation: updated });
                                emitToBusiness(businessId, "new_message", {
                                    business_id: businessId,
                                    conversation_id: updated.id,
                                    sender: "bot",
                                    message: reply,
                                    created_at: new Date().toISOString()
                                });
                            }
                        } catch (e) {
                            console.error(`[WhatsApp] Outbound persistence error for business ${businessId}:`, e.message);
                        }

                        enqueueOutbound(customerPhone, reply);
                    }

                } catch (error) {
                    console.error(`[WhatsApp] Message handling error for business ${businessId}:`, error.message);
                }
            });

            client.on("auth_failure", (msg) => {
                console.error(`[WhatsApp] Auth failure for business ${businessId}:`, msg);
                clearInitTimeout(businessId);
                initializingClients.delete(businessId);

                emitToBusiness(businessId, `status_${businessId}`, { status: "auth_failure" });

                db.run(
                    "UPDATE businesses SET connection_status='auth_failure' WHERE id=?",
                    [businessId],
                    () => {}
                );
            });

            client.on("disconnected", async (reason) => {
                // Serialize cleanup + retry with lifecycle lock
                await withLifecycleLock(businessId, async () => {
                    console.log(`[WhatsApp] Disconnected business ${businessId}:`, reason);

                    clearInitTimeout(businessId);

                    db.run(
                        "UPDATE businesses SET connection_status='disconnected' WHERE id=?",
                        [businessId],
                        () => {}
                    );

                    emitToBusiness(businessId, `status_${businessId}`, { status: "disconnected" });

                    // Cleanup memory (queue + references)
                    const queueLength = messageQueue.length;
                    messageQueue.length = 0;
                    clientQueues.delete(businessId);
                    if (queueLength > 0) {
                        console.log(`[WhatsApp] Cleared ${queueLength} pending messages for business ${businessId}`);
                    }

                    // If we are intentionally stopping, do not reconnect
                    if (stopRequested.has(businessId)) {
                        try {
                            if (typeof client.removeAllListeners === "function") client.removeAllListeners();
                        } catch {}

                        try {
                            await client.destroy();
                        } catch {}

                        delete clients[businessId];
                        initializingClients.delete(businessId);
                        delete retryMap[businessId];

                        // stopRequested will be cleared by destroyClient() or next createClient()
                        return;
                    }

                    // Best-effort destroy
                    try {
                        if (typeof client.removeAllListeners === "function") client.removeAllListeners();
                    } catch {}

                    try {
                        await client.destroy();
                    } catch (e) {
                        console.error(`[WhatsApp] Error destroying client ${businessId}:`, e.message);
                    }

                    delete clients[businessId];
                    initializingClients.delete(businessId);

                    // Only reconnect if business is still active (fresh DB check)
                    try {
                        const row = await dbAsync.get("SELECT is_active FROM businesses WHERE id=?", [businessId]);
                        const isActive = row && row.is_active !== 0;
                        if (!isActive) {
                            console.log(`[WhatsApp] Auto-reconnect disabled for business ${businessId}: inactive`);
                            return;
                        }
                    } catch (e) {
                        // If DB check fails, default to reconnect (preserve previous behavior)
                        console.error(`[WhatsApp] is_active check failed for business ${businessId}:`, e.message);
                    }

                    await scheduleReconnect(businessId, { reason: "disconnected" });
                });
            });

            client.initialize().catch(async (err) => {
                console.error(`[WhatsApp] Init error for business ${businessId}:`, err.message);
                clearInitTimeout(businessId);
                initializingClients.delete(businessId);
                clientQueues.delete(businessId);

                // remove the client reference (we haven't added it yet, but be defensive)
                delete clients[businessId];

                // Schedule retry on init failure
                await scheduleReconnect(businessId, { reason: "init_error" });
            });

            // Expose outbound enqueue for API-driven admin sends
            client.__enqueueOutbound = enqueueOutbound;

            clients[businessId] = client;

            return true;
        } catch (e) {
            console.error(`[WhatsApp] createClient error for business ${businessId}:`, e.message);
            initializingClients.delete(businessId);
            clientQueues.delete(businessId);
            return false;
        }
    });
}

/**
 * Backward compatible API: shutdown client (now uses destroyClient)
 */
async function shutdownClient(businessId) {
    const ok = await destroyClient(businessId, { reason: "shutdown" });
    return Boolean(ok);
}

/**
 * Get status of all clients for monitoring
 * @returns {Object} - Status object
 */
function getStatus() {
    const status = {
        activeClients: Object.keys(clients).length,
        initializingClients: initializingClients.size,
        retryingClients: Object.keys(retryMap).length,
        queues: {}
    };

    for (const [id, queue] of clientQueues.entries()) {
        status.queues[id] = queue.length;
    }

    return status;
}

function normalizePhoneForPairing(input) {
    const raw = String(input || "").trim();
    const digits = raw.replace(/\D/g, "");

    // Heuristic for Israel local numbers: 05XXXXXXXX => 9725XXXXXXXX
    if (digits.length === 10 && digits.startsWith("0")) {
        return `972${digits.slice(1)}`;
    }

    // If user already provided country code (e.g. 972...) keep as-is
    return digits;
}

async function requestPairingCode(businessId, phoneInput) {
    const id = Number(businessId);
    if (!id) return { ok: false, error: "invalid_business_id", fallback: "qr" };

    const phone = normalizePhoneForPairing(phoneInput);
    if (!phone || phone.length < 8) {
        return { ok: false, error: "invalid_phone", fallback: "qr" };
    }

    // Deduplicate concurrent requests per business
    if (pairingLocks.has(id)) {
        try {
            return await pairingLocks.get(id);
        } catch {
            // continue
        }
    }

    const p = (async () => {
        // Important: Do NOT destroy existing sessions here.
        // If client is already connected, pairing code is unnecessary.
        const existing = clients[id];
        if (existing && existing.info) {
            return { ok: false, error: "already_connected", fallback: "qr" };
        }

        // Ensure client exists
        if (!existing && !initializingClients.has(id)) {
            try {
                const biz = await dbAsync.get("SELECT * FROM businesses WHERE id=?", [id]);
                if (!biz) return { ok: false, error: "business_not_found", fallback: "qr" };
                if (biz.is_active === 0) return { ok: false, error: "business_inactive", fallback: "qr" };

                // Start client (idempotent)
                createClient(biz);
            } catch (e) {
                console.error(`[WhatsApp] requestPairingCode start client error for business ${id}:`, e.message);
            }
        }

        // Wait for client object to exist
        const waitMs = 15000;
        const start = Date.now();
        while (!clients[id] && Date.now() - start < waitMs) {
            await sleep(150);
        }

        const client = clients[id];
        if (!client) {
            return { ok: false, error: "client_not_ready", fallback: "qr" };
        }

        if (typeof client.requestPairingCode !== "function") {
            return { ok: false, error: "pairing_unsupported", fallback: "qr" };
        }

        try {
            // whatsapp-web.js expects phone with country code, digits only
            const code = await client.requestPairingCode(phone);

            if (!code) {
                return { ok: false, error: "pairing_failed", fallback: "qr" };
            }

            return { ok: true, code: String(code), phone };
        } catch (e) {
            console.error(`[WhatsApp] requestPairingCode error for business ${id}:`, e.message);
            return { ok: false, error: "pairing_failed", fallback: "qr" };
        }
    })();

    pairingLocks.set(id, p);

    try {
        return await p;
    } finally {
        if (pairingLocks.get(id) === p) pairingLocks.delete(id);
    }
}

async function sendAdminMessage(businessId, customerPhone, messageText) {

    const id = Number(businessId);

    try {
        const client = clients[id];
        if (!client) {
            return { ok: false, error: "client_not_ready" };
        }

        if (typeof client.__enqueueOutbound === "function") {
            client.__enqueueOutbound(customerPhone, messageText);
        } else {
            // Fallback
            await client.sendMessage(customerPhone, messageText);
        }

        // Persist admin message
        try {
            const out = await chatService.ingestOutboundMessageByPhone(id, customerPhone, "admin", messageText);
            const updated = out?.conversation;
            if (updated) {
                emitToBusiness(id, "conversation_updated", { business_id: id, conversation: updated });
                emitToBusiness(id, "message_sent", {
                    business_id: id,
                    conversation_id: updated.id,
                    sender: "admin",
                    message: messageText,
                    created_at: new Date().toISOString()
                });
            }
        } catch (e) {
            console.error(`[WhatsApp] Admin persistence error for business ${id}:`, e.message);
        }

        return { ok: true };
    } catch (err) {
        console.error(`[WhatsApp] sendAdminMessage error for business ${id}:`, err.message);
        return { ok: false, error: "send_failed" };
    }
}

module.exports = {
    init,
    createClient,
    destroyClient,
    refreshClient,
    requestPairingCode,
    clients,
    shutdownClient,
    getStatus,
    sendAdminMessage,

    // exported for server diagnostics / tests
    _internal: {
        roomName
    }
};