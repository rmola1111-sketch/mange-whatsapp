require("dotenv").config();
// Premium SaaS-grade WhatsApp booking assistant (incremental upgrade)
// Preserves existing behavior while adding a real, predictable state machine.

const OpenAI = require("openai").default;
const db = require("../db/db");

// db exports are attached to the sqlite Database instance
const dbAsync = db.dbAsync;

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

// ===== CONFIG =====
const TTL = 600000; // 10 דקות
const SESSION_ACTIVE_TTL_MINUTES = 30;

// ===== STATES =====
// Backward compatibility:
// - existing DB may contain: idle / waiting
// - we keep supporting "waiting" as a legacy state
const STATES = {
    IDLE: "idle",
    LEGACY_WAITING: "waiting",

    BOOKING_DATE: "booking_date",
    BOOKING_TIME: "booking_time",
    CONFIRMATION: "confirmation",
    BOOKED: "booked",

    MANUAL_MODE: "manual_mode" // reserved for dashboard control later
};

// ===== CACHES =====
const businessCache = new Map();

// ===== CLEANUP =====
setInterval(() => {
    try {
        const now = Date.now();
        for (const [k, v] of businessCache.entries()) {
            if (now - v.time > TTL) businessCache.delete(k);
        }

        // Clean stale sessions (any non-idle flow)
        // NOTE: keep compatibility with old schemas: if updated_at is missing this will no-op and log.
        db.run(
            `DELETE FROM sessions 
             WHERE step != 'idle'
             AND updated_at < datetime('now', '-${SESSION_ACTIVE_TTL_MINUTES} minutes')`
        );
        db.run(`DELETE FROM sessions WHERE updated_at < datetime('now', '-1 day')`);
    } catch (e) {
        console.error("[Bot] Cleanup error:", e.message);
    }
}, 60000);

// ===== SMALL UTILS =====
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function normalize(text) {
    return (text || "").trim().toLowerCase();
}

function isTimeStringHHMM(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatDateISO(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function formatHebrewDate(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;

    const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    return `יום ${days[d.getDay()]}, ${d.toLocaleDateString("he-IL")}`;
}

function formatTimeList(slots, max = 6) {
    if (!Array.isArray(slots) || slots.length === 0) return null;
    return slots.slice(0, max).join(" | ");
}

// ===== INTENTS =====
function detectIntent(clean) {
    const cancel = ["בטל", "לבטל", "ביטול", "עזוב", "לא משנה", "cancel", "reset", "מחדש", "חדש"];
    if (cancel.some(w => clean.includes(w))) return "CANCEL";

    const confirm = ["כן", "בטח", "מאשר", "אשר", "בסדר", "אוקיי", "ok", "yes"];
    if (confirm.some(w => clean === w || clean.startsWith(w + " "))) return "CONFIRM";

    const decline = ["לא", "no", "לא תודה"];
    if (decline.some(w => clean === w)) return "DECLINE";

    const book = ["תור", "לקבוע", "להזמין", "לבוא", "פגישה", "להגיע"];
    if (book.some(w => clean.includes(w))) return "BOOK";

    const greet = ["שלום", "היי", "אהלן", "בוקר טוב", "ערב טוב"];
    if (greet.some(w => clean.includes(w))) return "GREETING";

    if (clean.includes("מחיר") || clean.includes("עולה")) return "PRICE";
    if (clean.includes("איפה") || clean.includes("מיקום") || clean.includes("כתובת")) return "LOCATION";
    if (clean.includes("שעות") || clean.includes("פתוח") || clean.includes("סגור")) return "HOURS";

    return "UNKNOWN";
}

// ===== DB HELPERS (defensive) =====
async function safeGetBusiness(businessId) {
    const cached = businessCache.get(businessId);
    if (cached && Date.now() - cached.time < TTL) return cached.value;

    try {
        const business = await dbAsync.get("SELECT * FROM businesses WHERE id=?", [businessId]);
        if (business) businessCache.set(businessId, { value: business, time: Date.now() });
        return business || null;
    } catch (err) {
        console.error("[Bot] DB ERROR (Business):", err.message);
        return null;
    }
}

async function safeGetSession(phone, businessId) {
    try {
        // Prefer reading both step & data (newer schema)
        const row = await dbAsync.get(
            "SELECT step, data FROM sessions WHERE customer_phone=? AND business_id=?",
            [phone, businessId]
        );

        if (!row) return { step: STATES.IDLE, data: {} };

        let data = {};
        if (row.data) {
            try {
                data = JSON.parse(row.data);
            } catch {
                data = {};
            }
        }

        return { step: row.step || STATES.IDLE, data };
    } catch (err) {
        // Fallback for older schema without data column
        if (String(err.message || "").includes("no such column: data")) {
            try {
                const row = await dbAsync.get(
                    "SELECT step FROM sessions WHERE customer_phone=? AND business_id=?",
                    [phone, businessId]
                );
                return row ? { step: row.step || STATES.IDLE, data: {} } : { step: STATES.IDLE, data: {} };
            } catch (e2) {
                console.error("[Bot] DB ERROR (Session fallback):", e2.message);
                return { step: STATES.IDLE, data: {} };
            }
        }

        console.error("[Bot] DB ERROR (Session):", err.message);
        return { step: STATES.IDLE, data: {} };
    }
}

async function safeSetSession(phone, businessId, step, data = {}) {
    const payload = JSON.stringify(data || {});

    try {
        // Prefer newer schema with data column
        await dbAsync.run(
            "INSERT OR REPLACE INTO sessions (customer_phone, business_id, step, data, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [phone, businessId, step, payload]
        );
        return;
    } catch (err) {
        // Fallback if schema doesn't have data column
        if (String(err.message || "").includes("no such column: data")) {
            try {
                await dbAsync.run(
                    "INSERT OR REPLACE INTO sessions (customer_phone, business_id, step, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                    [phone, businessId, step]
                );
            } catch (e2) {
                console.error("[Bot] DB ERROR (Set session fallback):", e2.message);
            }
            return;
        }

        console.error("[Bot] DB ERROR (Set session):", err.message);
    }
}

async function safeClearSession(phone, businessId) {
    await safeSetSession(phone, businessId, STATES.IDLE, {});
}

// ===== PARSING (deterministic first) =====
function parseDate(clean) {
    const now = new Date();

    if (clean.includes("היום")) return formatDateISO(now);

    if (clean.includes("מחר") && !clean.includes("מחרתיים")) {
        const d = new Date(now);
        d.setDate(now.getDate() + 1);
        return formatDateISO(d);
    }

    if (clean.includes("מחרתיים")) {
        const d = new Date(now);
        d.setDate(now.getDate() + 2);
        return formatDateISO(d);
    }

    const m = clean.match(/(\d{1,2})[\/\.](\d{1,2})/);
    if (m) {
        const day = Number(m[1]);
        const month = Number(m[2]);
        if (!day || !month) return null;

        const d = new Date(now.getFullYear(), month - 1, day);
        // If past, assume next year (simple + predictable)
        if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
            d.setFullYear(now.getFullYear() + 1);
        }
        return formatDateISO(d);
    }

    return null;
}

function parseTime(clean) {
    // HH:MM
    const m = clean.match(/([0-1]?[0-9]|2[0-3]):([0-5][0-9])/);
    if (m) return `${String(m[1]).padStart(2, "0")}:${m[2]}`;

    // "ב-10" / "בשעה 10"
    const h = clean.match(/(?:בשעה\s*|ב-?)(\d{1,2})(?:\D|$)/);
    if (h) {
        const hour = Number(h[1]);
        if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:00`;
    }

    // "10" (standalone)
    if (/^\d{1,2}$/.test(clean)) {
        const hour = Number(clean);
        if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, "0")}:00`;
    }

    return null;
}

// Legacy parser: tries to parse a full datetime from a single message (keeps old behavior)
function parseLegacyDateTime(clean) {
    // "עוד שעה" support from previous bot
    if (clean.includes("עוד שעה")) {
        const d = new Date();
        d.setHours(d.getHours() + 1);
        d.setMinutes(0, 0, 0);
        return `${formatDateISO(d)} ${String(d.getHours()).padStart(2, "0")}:00`;
    }

    const date = parseDate(clean);
    const time = parseTime(clean);
    if (!time) return null;

    // if no explicit date, default: today, or tomorrow if "מחר" exists
    const now = new Date();
    let dateFinal = date;
    if (!dateFinal) {
        if (clean.includes("מחר")) {
            const d = new Date(now);
            d.setDate(now.getDate() + 1);
            dateFinal = formatDateISO(d);
        } else {
            dateFinal = formatDateISO(now);
        }
    }

    return `${dateFinal} ${time}`;
}

// ===== AVAILABILITY =====
function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

function generateSlots(openingHour, closingHour, durationMinutes) {
    if (!isTimeStringHHMM(openingHour) || !isTimeStringHHMM(closingHour)) return [];
    const duration = Number(durationMinutes) || 30;
    if (duration <= 0) return [];

    const start = timeToMinutes(openingHour);
    const end = timeToMinutes(closingHour);
    if (start >= end) return [];

    const slots = [];
    for (let t = start; t + duration <= end; t += duration) {
        const h = Math.floor(t / 60);
        const m = t % 60;
        slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
    return slots;
}

async function getBookedTimes(businessId, dateStr) {
    try {
        const rows = await dbAsync.all(
            "SELECT datetime FROM bookings WHERE business_id=? AND datetime LIKE ? AND (status IS NULL OR status != 'cancelled')",
            [businessId, `${dateStr}%`]
        );

        return rows
            .map(r => String(r.datetime || "").split(" ")[1])
            .filter(Boolean);
    } catch (err) {
        console.error("[Bot] DB ERROR (Booked times):", err.message);
        return [];
    }
}

async function getAvailableTimes(business, dateStr) {
    const opening = business.opening_hour || "09:00";
    const closing = business.closing_hour || "18:00";
    const duration = business.appointment_duration || 30;

    const all = generateSlots(opening, closing, duration);
    if (all.length === 0) return [];

    const booked = await getBookedTimes(business.id, dateStr);
    let available = all.filter(t => !booked.includes(t));

    // If booking for today, remove past times (+30min buffer)
    const today = formatDateISO(new Date());
    if (dateStr === today) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes() + 30;
        available = available.filter(t => timeToMinutes(t) > nowMin);
    }

    return available;
}

// ===== BOOKINGS =====
async function createBooking(businessId, phone, dateTime) {
    try {
        const res = await dbAsync.run(
            "INSERT OR IGNORE INTO bookings (business_id, customer_phone, datetime, status) VALUES (?, ?, ?, 'confirmed')",
            [businessId, phone, dateTime]
        );
        return res.changes > 0;
    } catch (err) {
        console.error("[Bot] DB ERROR (Create booking):", err.message);
        return false;
    }
}

async function cancelLastBooking(businessId, phone) {
    try {
        const booking = await dbAsync.get(
            "SELECT * FROM bookings WHERE business_id=? AND customer_phone=? AND (status IS NULL OR status='confirmed') ORDER BY datetime DESC LIMIT 1",
            [businessId, phone]
        );

        if (!booking) return null;

        await dbAsync.run("UPDATE bookings SET status='cancelled' WHERE id=?", [booking.id]);
        return booking;
    } catch (err) {
        console.error("[Bot] DB ERROR (Cancel booking):", err.message);
        return null;
    }
}

// ===== UX REPLIES (short, consistent) =====
function replyAskDate(businessName) {
    return `מעולה 👍\nלאיזה יום נוח לך?\n(היום / מחר / או 25/12)`;
}

function replyAskTime(dateStr, timePreview) {
    const dateHeb = formatHebrewDate(dateStr);
    return `📅 ${dateHeb}\n\nשעות פנויות:\n${timePreview}\n\nלאיזו שעה?`;
}

function replyConfirm(businessName, dateStr, timeStr) {
    const dateHeb = formatHebrewDate(dateStr);
    return `📋 סיכום התור:\nשירות: תור\nיום: ${dateHeb}\nשעה: ${timeStr}\n\nלאשר? (כן/לא)`;
}

function replyBooked(businessName, dateStr, timeStr) {
    const dateHeb = formatHebrewDate(dateStr);
    return `תור נקבע בהצלחה 🎉\n${businessName}\n${dateHeb} • ${timeStr}`;
}

// ===== STATE HANDLERS =====
async function handleIdle(business, phone, clean) {
    const intent = detectIntent(clean);

    if (intent === "CANCEL") {
        const cancelled = await cancelLastBooking(business.id, phone);
        return cancelled
            ? `התור ב-${cancelled.datetime} בוטל.`
            : `אין תור לביטול.\nאיך אפשר לעזור?`;
    }

    if (intent === "PRICE") {
        return business.price
            ? `המחיר הוא ${business.price}₪.\nלקבוע תור?`
            : `לפרטי מחיר, דברו איתנו.\nלקבוע תור?`;
    }

    if (intent === "LOCATION") {
        return `📍 ${business.location || "לא הוגדר"}\nלקבוע תור?`;
    }

    if (intent === "HOURS") {
        return `🕐 שעות: ${business.opening_hour || "09:00"}-${business.closing_hour || "18:00"}\nלקבוע תור?`;
    }

    if (intent === "BOOK") {
        await safeSetSession(phone, business.id, STATES.BOOKING_DATE, {});
        return replyAskDate(business.name);
    }

    if (intent === "GREETING") {
        return `היי! 👋\nרוצה לקבוע תור ב${business.name}?`;
    }

    // Fallback: keep short, nudge to CTA
    return `איך אפשר לעזור?\nלקבוע תור?`;
}

async function handleBookingDate(business, phone, clean) {
    const intent = detectIntent(clean);
    if (intent === "CANCEL") {
        await safeClearSession(phone, business.id);
        return `בסדר 👍`;
    }

    const dateStr = parseDate(clean);
    if (!dateStr) {
        return `לא הבנתי את היום 😅\nנסה: היום / מחר / 25/12`;
    }

    const today = formatDateISO(new Date());
    if (dateStr < today) {
        return `זה תאריך שעבר.\nבחר יום אחר:`;
    }

    const available = await getAvailableTimes(business, dateStr);
    if (available.length === 0) {
        return `אין זמנים פנויים ב-${formatHebrewDate(dateStr)}.\nיום אחר?`;
    }

    const preview = formatTimeList(available);
    await safeSetSession(phone, business.id, STATES.BOOKING_TIME, { date: dateStr });
    return replyAskTime(dateStr, preview);
}

async function handleBookingTime(business, phone, clean, data) {
    const intent = detectIntent(clean);
    if (intent === "CANCEL") {
        await safeClearSession(phone, business.id);
        return `בסדר 👍`;
    }

    if (intent === "DECLINE") {
        await safeSetSession(phone, business.id, STATES.BOOKING_DATE, {});
        return replyAskDate(business.name);
    }

    const dateStr = data?.date;
    if (!dateStr) {
        // corrupted session; reset safely
        await safeSetSession(phone, business.id, STATES.BOOKING_DATE, {});
        return replyAskDate(business.name);
    }

    const timeStr = parseTime(clean);
    if (!timeStr) {
        const available = await getAvailableTimes(business, dateStr);
        const preview = formatTimeList(available) || "";
        return preview
            ? `לאיזו שעה?\n${preview}`
            : `לאיזו שעה תרצה להגיע?`;
    }

    const available = await getAvailableTimes(business, dateStr);
    if (!available.includes(timeStr)) {
        const preview = formatTimeList(available);
        return preview
            ? `${timeStr} לא פנוי.\n${preview}`
            : `${timeStr} לא פנוי.\nבחר שעה אחרת:`;
    }

    await safeSetSession(phone, business.id, STATES.CONFIRMATION, { date: dateStr, time: timeStr });
    return replyConfirm(business.name, dateStr, timeStr);
}

async function handleConfirmation(business, phone, clean, data) {
    const intent = detectIntent(clean);

    if (intent === "CANCEL") {
        await safeClearSession(phone, business.id);
        return `בסדר 👍`;
    }

    if (intent === "DECLINE") {
        await safeSetSession(phone, business.id, STATES.BOOKING_DATE, {});
        return replyAskDate(business.name);
    }

    if (intent !== "CONFIRM") {
        return `לאשר? (כן/לא)`;
    }

    const dateStr = data?.date;
    const timeStr = data?.time;
    if (!dateStr || !timeStr) {
        await safeSetSession(phone, business.id, STATES.BOOKING_DATE, {});
        return replyAskDate(business.name);
    }

    // Re-check availability to avoid race conditions
    const available = await getAvailableTimes(business, dateStr);
    if (!available.includes(timeStr)) {
        await safeSetSession(phone, business.id, STATES.BOOKING_TIME, { date: dateStr });
        const preview = formatTimeList(available);
        return preview
            ? `${timeStr} נתפס 😅\n${preview}`
            : `${timeStr} נתפס 😅\nבחר שעה אחרת:`;
    }

    const dateTime = `${dateStr} ${timeStr}`;
    const ok = await createBooking(business.id, phone, dateTime);

    if (!ok) {
        // likely conflict
        await safeSetSession(phone, business.id, STATES.BOOKING_TIME, { date: dateStr });
        const fresh = await getAvailableTimes(business, dateStr);
        const preview = formatTimeList(fresh);
        return preview
            ? `${timeStr} נתפס 😅\n${preview}`
            : `${timeStr} נתפס 😅\nבחר שעה אחרת:`;
    }

    await safeSetSession(phone, business.id, STATES.BOOKED, { date: dateStr, time: timeStr });
    return replyBooked(business.name, dateStr, timeStr);
}

async function handleBooked(business, phone, clean) {
    const intent = detectIntent(clean);

    if (intent === "BOOK") {
        await safeSetSession(phone, business.id, STATES.BOOKING_DATE, {});
        return replyAskDate(business.name);
    }

    if (intent === "CANCEL") {
        const cancelled = await cancelLastBooking(business.id, phone);
        await safeClearSession(phone, business.id);
        return cancelled ? `התור בוטל.` : `אין תור לביטול.`;
    }

    // End conversation cleanly.
    await safeClearSession(phone, business.id);
    return `צריך משהו נוסף?`;
}

// ===== LEGACY HANDLER =====
// Preserves the old behavior: when step is "waiting", user can send full datetime and it books directly.
async function handleLegacyWaiting(business, phone, clean) {
    const dateTime = parseLegacyDateTime(clean);
    if (!dateTime) {
        return `לא הצלחתי להבין את הזמן 😅\nלדוגמה: מחר ב-10:00`;
    }

    const ok = await createBooking(business.id, phone, dateTime);
    if (!ok) {
        return `השעה תפוסה 😅 יש זמן אחר שמתאים?`;
    }

    await safeClearSession(phone, business.id);

    const d = new Date(dateTime.replace(" ", "T"));
    const display = `${d.toLocaleDateString("he-IL")} בשעה ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
    return `מעולה! נקבע ל-${display}`;
}

// ===== MAIN =====
async function handleMessage(businessId, phone, text) {
    try {
        const clean = normalize(text);
        if (!clean) return null;

        const business = await safeGetBusiness(businessId);
        if (!business) return null;

        const session = await safeGetSession(phone, businessId);

        // Manual mode reserved for dashboard integration later
        if (session.step === STATES.MANUAL_MODE) {
            return null; // bot should not reply
        }

        // Route by state
        switch (session.step) {
            case STATES.IDLE:
                return await handleIdle(business, phone, clean);

            case STATES.BOOKING_DATE:
                return await handleBookingDate(business, phone, clean);

            case STATES.BOOKING_TIME:
                return await handleBookingTime(business, phone, clean, session.data);

            case STATES.CONFIRMATION:
                return await handleConfirmation(business, phone, clean, session.data);

            case STATES.BOOKED:
                return await handleBooked(business, phone, clean);

            case STATES.LEGACY_WAITING:
                return await handleLegacyWaiting(business, phone, clean);

            default:
                await safeClearSession(phone, business.id);
                return await handleIdle(business, phone, clean);
        }
    } catch (err) {
        console.error("[Bot] CRITICAL ERROR:", err);
        return "מצטער, חלה שגיאה זמנית. נסה שוב.";
    }
}

module.exports = { handleMessage, STATES };

