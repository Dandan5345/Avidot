const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

const db = admin.firestore();
const ACTIVITY_LOGS_COLLECTION = "activityLogs";
const ACTIVITY_LOG_RETENTION_DAYS = 31;

async function deleteExpiredActivityLogs() {
    const cutoffIso = new Date(
        Date.now() - ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    let deletedCount = 0;

    while (true) {
        const snapshot = await db.collection(ACTIVITY_LOGS_COLLECTION)
            .where("createdAt", "<", cutoffIso)
            .limit(400)
            .get();

        if (snapshot.empty) break;

        const batch = db.batch();
        snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        await batch.commit();
        deletedCount += snapshot.size;

        if (snapshot.size < 400) break;
    }

    return deletedCount;
}

exports.pruneActivityLogsMonthly = onSchedule({
    schedule: "0 3 1 * *",
    timeZone: "Asia/Jerusalem",
    region: "europe-west1"
}, async () => {
    const deletedCount = await deleteExpiredActivityLogs();
    console.log(`[activity-log] monthly prune completed. deleted=${deletedCount}`);
});
