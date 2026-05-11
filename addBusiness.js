
const db = require("./db/db");

db.run(
  "INSERT INTO businesses (name, phone) VALUES (?, ?)",
  ["בדיקה", "972501234567"],
  function (err) {
    if (err) {
      console.log("❌ ERROR:", err);
    } else {
      console.log("✅ עסק נוסף!");
    }
  }
);
