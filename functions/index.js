const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();
const SUPER_ADMIN_EMAIL = "Doronenakache@gmail.com";
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{6,}$/;
const ACTIVITY_LOGS_COLLECTION = "activityLogs";
const ACTIVITY_LOG_RETENTION_DAYS = 31;
const LOST_ITEMS_COLLECTION = "lostItems";
const LOST_ITEMS_FULL_SYNC_BATCH_SIZE = 100;

function isSuperAdminEmail(email) {
    return !!email && email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

function normalizedString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value) {
    if (typeof value === "string") return value.trim();
    if (value === null || value === undefined) return "";
    return String(value);
}

function requiredGoogleSheetsScriptUrl() {
    const url = normalizedString(process.env.GOOGLE_SHEETS_SCRIPT_URL);
    if (!url) {
        throw new Error("Missing GOOGLE_SHEETS_SCRIPT_URL environment variable for the Google Apps Script web app endpoint. See README.");
    }
    return url;
}

function truncateForError(value, maxLength = 300) {
    const text = normalizeOptionalString(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...truncated`;
}

function storageDisplayValue(item) {
    if (normalizedString(item.storageLocation) !== "אחר") {
        return normalizeOptionalString(item.storageLocation);
    }
    return normalizeOptionalString(item.storageOther) || "אחר";
}

function buildLostItemSyncRecord(itemId, itemData = {}, { deleted = false, syncedAt } = {}) {
    const returnDetails = itemData.returnDetails || {};
    const isReturned = !!itemData.returned;
    const status = deleted ? "deleted" : (isReturned ? "returned" : "active");
    const statusLabel = deleted ? "נמחקה" : (isReturned ? "הוחזרה לבעל האבידה" : "פעילה");

    return {
        id: itemId,
        collection: LOST_ITEMS_COLLECTION,
        number: itemData.number ?? "",
        dateTime: normalizeOptionalString(itemData.dateTime),
        description: normalizeOptionalString(itemData.description),
        valuable: !!itemData.valuable,
        foundLocation: normalizeOptionalString(itemData.foundLocation),
        storageLocation: normalizeOptionalString(itemData.storageLocation),
        storageOther: normalizeOptionalString(itemData.storageOther),
        storageDisplay: storageDisplayValue(itemData),
        finderName: normalizeOptionalString(itemData.finderName),
        finderDept: normalizeOptionalString(itemData.finderDept),
        finderUnknown: !!itemData.finderUnknown,
        kabatHandler: normalizeOptionalString(itemData.kabatHandler),
        currentLocation: normalizeOptionalString(itemData.currentLocation),
        additionalDetails: normalizeOptionalString(itemData.additionalDetails),
        ownerName: normalizeOptionalString(itemData.ownerName),
        ownerPhone: normalizeOptionalString(itemData.ownerPhone),
        ownerId: normalizeOptionalString(itemData.ownerId),
        photoUrl: normalizeOptionalString(itemData.photoUrl),
        returned: isReturned,
        status,
        statusLabel,
        returnReceiverName: normalizeOptionalString(returnDetails.receiverName),
        returnReceiverContact: normalizeOptionalString(returnDetails.receiverContact),
        returnHandlerName: normalizeOptionalString(returnDetails.handlerName),
        returnReturnedAt: normalizeOptionalString(returnDetails.returnedAt),
        returnReturnedBy: normalizeOptionalString(returnDetails.returnedBy),
        returnSignatureUrl: normalizeOptionalString(returnDetails.signatureUrl),
        createdAt: normalizeOptionalString(itemData.createdAt),
        createdBy: normalizeOptionalString(itemData.createdBy),
        createdByName: normalizeOptionalString(itemData.createdByName),
        deletedAt: deleted ? syncedAt : "",
        syncedAt
    };
}

async function postLostItemsSync(payload) {
    try {
        const response = await fetch(requiredGoogleSheetsScriptUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8"
            },
            body: JSON.stringify(payload)
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(`Google Sheets sync failed (${response.status}): ${truncateForError(responseText)}`);
        }
        return responseText;
    } catch (error) {
        throw new Error(`Google Sheets sync request failed for action "${payload.action}": ${error.message}`);
    }
}

function chunkItems(items, size) {
    const chunks = [];
    for (let start = 0; start < items.length; start += size) {
        chunks.push(items.slice(start, start + size));
    }
    return chunks;
}

async function syncSingleLostItemChange({ itemId, itemData, deleted = false }) {
    const syncedAt = new Date().toISOString();
    return postLostItemsSync({
        source: "firebase-functions",
        projectId: process.env.GCLOUD_PROJECT || "",
        action: deleted ? "delete" : "upsert",
        item: buildLostItemSyncRecord(itemId, itemData, { deleted, syncedAt })
    });
}

async function syncAllLostItemsSnapshot() {
    const syncedAt = new Date().toISOString();
    const snapshot = await db.collection(LOST_ITEMS_COLLECTION).get();
    const items = snapshot.docs.map((docSnap) =>
        buildLostItemSyncRecord(docSnap.id, docSnap.data(), { syncedAt })
    );
    const chunks = chunkItems(items, LOST_ITEMS_FULL_SYNC_BATCH_SIZE);

    if (!chunks.length) {
        await postLostItemsSync({
            source: "firebase-functions",
            projectId: process.env.GCLOUD_PROJECT || "",
            action: "full_sync",
            collection: LOST_ITEMS_COLLECTION,
            syncedAt,
            items: [],
            chunkIndex: 1,
            chunkCount: 1
        });
        return 0;
    }

    // Keep chunk delivery sequential so Apps Script receives predictable order
    // and does not hit burst limits during a full backfill.
    for (let index = 0; index < chunks.length; index += 1) {
        try {
            await postLostItemsSync({
                source: "firebase-functions",
                projectId: process.env.GCLOUD_PROJECT || "",
                action: "full_sync",
                collection: LOST_ITEMS_COLLECTION,
                syncedAt,
                items: chunks[index],
                chunkIndex: index + 1,
                chunkCount: chunks.length
            });
        } catch (error) {
            console.error("[lost-items-sync] full sync chunk failed", {
                chunkIndex: index + 1,
                chunkCount: chunks.length,
                error: error.message
            });
            throw error;
        }
    }

    return items.length;
}

function assertStrongPassword(password) {
    if (!PASSWORD_RULE.test(password)) {
        throw new HttpsError(
            "invalid-argument",
            "הסיסמה חייבת להכיל לפחות 6 תווים, לפחות מספר אחד ולפחות אות אנגלית גדולה אחת"
        );
    }
}

async function requireAdmin(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "יש להתחבר כדי לבצע את הפעולה");
    }

    const caller = {
        uid: request.auth.uid,
        email: normalizedString(request.auth.token.email),
        isSuperAdmin: isSuperAdminEmail(request.auth.token.email)
    };

    if (caller.isSuperAdmin) return caller;

    const snap = await db.collection("users").doc(caller.uid).get();
    if (!snap.exists || !snap.data()?.isAdmin) {
        throw new HttpsError("permission-denied", "רק מנהלים רשאים לבצע את הפעולה");
    }

    return caller;
}

async function getTargetUser(targetUid) {
    const uid = normalizedString(targetUid);
    if (!uid) {
        throw new HttpsError("invalid-argument", "חסר מזהה משתמש");
    }

    try {
        const authUser = await admin.auth().getUser(uid);
        const profileSnap = await db.collection("users").doc(uid).get();
        return {
            uid,
            authUser,
            profile: profileSnap.exists ? profileSnap.data() : null
        };
    } catch (error) {
        if (error?.code === "auth/user-not-found") {
            const profileSnap = await db.collection("users").doc(uid).get();
            return {
                uid,
                authUser: null,
                profile: profileSnap.exists ? profileSnap.data() : null
            };
        }
        throw error;
    }
}

async function assertManageableTarget(actor, target, { allowSelfDelete = false } = {}) {
    const targetEmail = target.authUser?.email || target.profile?.email || "";
    if (isSuperAdminEmail(targetEmail)) {
        throw new HttpsError("permission-denied", "לא ניתן לנהל את מנהל העל דרך המסך הזה");
    }

    if (!allowSelfDelete && actor.uid === target.uid) {
        throw new HttpsError("permission-denied", "לא ניתן למחוק את המשתמש המחובר כרגע");
    }

    if (target.profile?.isAdmin && !actor.isSuperAdmin) {
        const adminsSnap = await db.collection("users").where("isAdmin", "==", true).get();
        const adminsAfterAction = adminsSnap.docs.filter((doc) => doc.id !== target.uid);
        if (!adminsAfterAction.length) {
            throw new HttpsError("failed-precondition", "לא ניתן להסיר את המנהל האחרון במערכת");
        }
    }
}

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

// Retries are enabled because the Apps Script webhook may fail transiently.
// The payloads are idempotent, so duplicate deliveries should be handled safely downstream.
exports.syncLostItemsToGoogleSheets = onDocumentWritten({
    document: `${LOST_ITEMS_COLLECTION}/{itemId}`,
    region: "europe-west1",
    retry: true
}, async (event) => {
    const itemId = event.params.itemId;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    try {
        await syncSingleLostItemChange({
            itemId,
            itemData: afterData || (event.data.before.exists ? event.data.before.data() : {}),
            deleted: !afterData
        });
    } catch (error) {
        console.error("[lost-items-sync] item sync failed", {
            itemId,
            action: afterData ? "upsert" : "delete",
            error: error.message
        });
        throw error;
    }
});

exports.syncLostItemsFullBackup = onSchedule({
    // Runs every 6 hours.
    schedule: "0 */6 * * *",
    timeZone: "Asia/Jerusalem",
    region: "europe-west1"
}, async () => {
    const count = await syncAllLostItemsSnapshot();
    console.log(`[lost-items-sync] full backup completed. synced=${count}`);
});

exports.setUserPassword = onCall(async (request) => {
    const actor = await requireAdmin(request);
    const targetUid = normalizedString(request.data?.targetUid);
    const newPassword = normalizedString(request.data?.newPassword);

    if (!targetUid || !newPassword) {
        throw new HttpsError("invalid-argument", "חסרים פרטי משתמש או סיסמה חדשה");
    }

    assertStrongPassword(newPassword);

    const target = await getTargetUser(targetUid);
    if (!target.authUser) {
        throw new HttpsError("not-found", "החשבון לא נמצא ב-Firebase Authentication");
    }

    await assertManageableTarget(actor, target, { allowSelfDelete: true });
    await admin.auth().updateUser(targetUid, { password: newPassword });
    await db.collection("users").doc(targetUid).set({
        passwordUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        passwordUpdatedBy: actor.uid
    }, { merge: true });

    return { ok: true };
});

exports.deleteUserCompletely = onCall(async (request) => {
    const actor = await requireAdmin(request);
    const targetUid = normalizedString(request.data?.targetUid);

    if (!targetUid) {
        throw new HttpsError("invalid-argument", "חסר מזהה משתמש למחיקה");
    }

    const target = await getTargetUser(targetUid);
    await assertManageableTarget(actor, target);

    if (target.authUser) {
        await admin.auth().deleteUser(targetUid);
    }
    await db.collection("users").doc(targetUid).delete().catch(() => undefined);

    return { ok: true };
});
