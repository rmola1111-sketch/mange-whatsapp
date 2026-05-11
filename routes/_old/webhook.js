const express = require("express");
const router = express.Router();

const { handleFreeText } = require("../services/bot");
const { sendMessage } = require("../services/whatsapp");

router.post("/", async (req, res) => {
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const phone = message.from;
    const text = message.text?.body || "";

    const reply = await handleFreeText(phone, text);

    // 📤 שליחה אמיתית לוואטסאפ
    await sendMessage(phone, reply);

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(200);
  }
});

module.exports = router;