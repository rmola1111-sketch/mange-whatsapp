const { handleMessage } = require("./services/bot.service");

// 🔥 תבדוק כמה פורמטים שונים
const tests = [
  "0544892567@c.us",
  "972544892567@c.us",
  "544892567@c.us",
  "+972544892567@c.us"
];

async function run() {

  for (let phone of tests) {

    console.log("\n=====================");
    console.log("📱 INPUT:", phone);

    const res = await handleMessage(phone, "שלום");

    console.log("💬 OUTPUT:", res);
  }

}

run();