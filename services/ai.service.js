const moment = require("moment");

// 🎯 זיהוי כוונה
function extractIntent(text) {
    text = text.toLowerCase();

    if (text.includes("תור") || text.includes("לקבוע")) return "booking";
    if (text.includes("בטל") || text.includes("לבטל")) return "cancel";
    if (text.includes("שנה") || text.includes("לעדכן")) return "update";
    if (text.includes("כמה") || text.includes("מחיר")) return "price";

    return null;
}

// 🕐 זיהוי זמן חכם
function extractTime(text) {
    const now = moment();

    // 14:30 או 14.30
    const match = text.match(/([0-1]?[0-9]|2[0-3])[:. ]([0-5][0-9])/);
    if (match) {
        return `${match[1].padStart(2, "0")}:${match[2]}`;
    }

    // עוד שעה / שעתיים
    if (text.includes("עוד שעה")) return now.add(1, "hour").format("HH:mm");
    if (text.includes("עוד שעתיים")) return now.add(2, "hour").format("HH:mm");

    // מחר
    if (text.includes("מחר")) return "10:00";

    // ביטוי חכם
    if (text.includes("מתי אפשר") || text.includes("מתי יש")) {
        return "suggest";
    }

    return null;
}

module.exports = {
    extractIntent,
    extractTime
};