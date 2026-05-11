// backend/routes/google.routes.js

const express = require("express");
const router = express.Router();
const fs = require("fs");
const { google } = require("googleapis");

const CLIENT_PATH = "./data/global_credentials.json";

// התחלת חיבור יומן לעסק
router.get("/connect/:businessId", (req, res) => {

  const businessId = req.params.businessId;

  const credentials = JSON.parse(fs.readFileSync(CLIENT_PATH));
  const { client_id, client_secret, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
    state: businessId
  });

  res.redirect(url);
});

// callback אחרי אישור בגוגל
router.get("/callback", async (req, res) => {

  try {

    const { code, state } = req.query;
    const businessId = state;

    const credentials = JSON.parse(fs.readFileSync(CLIENT_PATH));
    const { client_id, client_secret, redirect_uris } = credentials.installed;

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    const { tokens } = await oAuth2Client.getToken(code);

    const dir = `data/${businessId}`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(`${dir}/token.json`, JSON.stringify(tokens));

    res.send("✅ העסק חובר ליומן בהצלחה! אפשר לחזור לדשבורד");

  } catch (err) {
    console.log(err);
    res.send("❌ שגיאה בחיבור יומן");
  }

});

module.exports = router;