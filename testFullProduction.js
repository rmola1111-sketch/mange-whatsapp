process.env.TEST_MODE = "true";

const db = require("./db/db");

// טעינה בטוחה
const bot = require("./services/bot.service");
const handleMessage = bot.handleMessage;

if (typeof handleMessage !== "function") {
console.log("בעיה בטעינת הבוט");
console.log(bot);
process.exit(1);
}

// helpers תקינים
function run(sql, params = []) {
return new Promise((resolve, reject) => {
db.run(sql, params, function (err) {
if (err) return reject(err);
resolve(true);
});
});
}

function get(sql, params = []) {
return new Promise((resolve, reject) => {
db.get(sql, params, function (err, row) {
if (err) return reject(err);
resolve(row);
});
});
}

// RESET
async function reset() {
await run("DELETE FROM bookings");
await run("DELETE FROM businesses");
await run("DELETE FROM sessions");

await run(
"INSERT INTO businesses (id, name, phone, price, location, is_active) VALUES (?, ?, ?, ?, ?, ?)",
[1, "מספרת הבדיקה", "0501111111", 100, "רחוב הבדיקות 1", 1]
);
}

// TEST
async function test() {
const phone = "test";

const send = async (msg) => {
const res = await handleMessage(1, phone, msg);
console.log("USER:", msg);
console.log("BOT :", res);
return res || "";
};

await send("שלום");
await send("אני רוצה לקבוע תור");

const r1 = await send("מחר ב-10:00");
if (!r1.includes("נקבע")) throw new Error("booking failed");

const row = await get(
"SELECT * FROM bookings WHERE business_id=? AND customer_phone=?",
[1, phone]
);

if (!row) throw new Error("db failed");

const r2 = await send("מחר ב-10:00");
if (!r2.includes("תפוס")) throw new Error("duplicate failed");

const r3 = await send("עזוב");
if (!r3.includes("בוטל")) throw new Error("cancel failed");

console.log("SUCCESS");
}

// RUN
(async () => {
try {
console.log("START TEST");
await reset();
await test();
console.log("ALL GOOD");
} catch (e) {
console.log("FAILED:", e.message);
} finally {
process.exit(0);
}
})();
