// backend/services/calendar.service.js

const fs = require("fs");
const { google } = require("googleapis");

function getAuth(businessId) {

  try {

    const base = `data/${businessId}/`;

    const credentials = JSON.parse(
      fs.readFileSync("data/global_credentials.json")
    );

    const token = JSON.parse(
      fs.readFileSync(base + "token.json")
    );

    const { client_id, client_secret, redirect_uris } = credentials.installed;

    const auth = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    auth.setCredentials(token);

    return auth;

  } catch {
    return null;
  }
}

// בדיקת זמינות
async function isAvailable(businessId, time) {

  const auth = getAuth(businessId);
  if (!auth) return true;

  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date();
  const [h, m] = time.split(":");

  start.setHours(h);
  start.setMinutes(m);

  const end = new Date(start.getTime() + 30 * 60000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  });

  return res.data.items.length === 0;
}

// יצירת אירוע
async function createEvent(businessId, time, phone) {

  const auth = getAuth(businessId);
  if (!auth) return;

  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date();
  const [h, m] = time.split(":");

  start.setHours(h);
  start.setMinutes(m);

  const end = new Date(start.getTime() + 30 * 60000);

  await calendar.events.insert({
    calendarId: "primary",
    resource: {
      summary: "תור",
      description: phone,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    }
  });
}

module.exports = { isAvailable, createEvent };