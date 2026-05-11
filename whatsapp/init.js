const db = require("../db/db");
const whatsappManager = require("./whatsapp.manager");

// Promisified DB query for async/await usage
function getActiveBusinesses() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM businesses WHERE is_active = 1", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * Initialize WhatsApp clients for all active businesses
 * Called once on server startup
 */
async function initWhatsApp() {
    console.log("[WhatsApp Init] Starting initialization...");

    try {
        const businesses = await getActiveBusinesses();

        if (businesses.length === 0) {
            console.log("[WhatsApp Init] No active businesses found");
            return;
        }

        console.log(`[WhatsApp Init] Found ${businesses.length} active business(es)`);

        // Initialize clients with small delay between each to avoid resource spike
        for (let i = 0; i < businesses.length; i++) {
            const business = businesses[i];
            console.log(`[WhatsApp Init] Initializing ${i + 1}/${businesses.length}: ${business.name} (ID: ${business.id})`);
            
                        try {
                await whatsappManager.createClient(business);
            } catch (e) {
                console.error(`[WhatsApp Init] Error initializing business ${business.id}:`, e.message);
            }


            // Stagger initialization to prevent resource spike (except for last one)
            if (i < businesses.length - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log("[WhatsApp Init] All clients initialization triggered");

    } catch (error) {
        console.error("[WhatsApp Init] ❌ Critical error during initialization:", error.message);
        // Don't throw - allow server to continue running
    }
}

module.exports = { initWhatsApp };
