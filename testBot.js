// 📁 backend/testBot.js

process.env.TEST_MODE = "true";

const db = require("./db/db");
const { handleMessage } = require("./services/bot.service");

const PHONE = "0544892567@c.us";

// איפוס DB
function resetDB() {
  return new Promise(resolve => {
    db.serialize(() => {
      db.run("DELETE FROM bookings");
      db.run("DELETE FROM messages");
      db.run("DELETE FROM businesses");

      db.run(
        "INSERT INTO businesses (name, phone, price, open_hour, close_hour, is_active) VALUES (?, ?, ?, ?, ?, ?)",
        ["בדיקה", "0544892567", 100, 9, 18, 1],
        resolve
      );
    });
  });
}

// בדיקה
async function runTest(name, input, expectedContains) {

  const output = await handleMessage(PHONE, input);

  const pass = output && output.includes(expectedContains);

  console.log("-------------");
  console.log("בדיקה:", name);
  console.log("INPUT:", input);
  console.log("OUTPUT:", output);
  console.log(pass ? "✅ PASS" : "❌ FAIL");
}

// הרצה
async function run() {

  console.log("🚀 מתחיל בדיקות...\n");

  await resetDB();

  await runTest("ברכה", "שלום", "היי");
  await runTest("בקשת תור", "אני רוצה תור", "שעה");
  await runTest("קביעת שעה", "14:00", "נקבע");
  await runTest("בדיקת תפוס", "14:00", "תפוס");
  await runTest("שינוי", "תשנה", "שעה");
  await runTest("שינוי שעה", "15:00", "עודכן");
  await runTest("ביטול", "תבטל", "בוטל");
  await runTest("מחיר", "כמה עולה", "₪");
  await runTest("שעה לא חוקית", "23:00", "פתוחים");

  console.log("\n🎯 סיום בדיקות");
}

run();