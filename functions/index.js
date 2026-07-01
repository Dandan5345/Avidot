const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

const db = admin.firestore();
const SUPER_ADMIN_EMAIL = "Doronenakache@gmail.com";
const PASSWORD_RULE = /^.{6,}$/;
const USERNAME_DOMAIN = "@aovdim.com";
const USERNAME_MIN_LENGTH = 5;
const ACTIVITY_LOGS_COLLECTION = "activityLogs";
const ACTIVITY_LOG_RETENTION_DAYS = 31;

function isSuperAdminEmail(email) {
    return !!email && email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

function normalizedString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function assertStrongPassword(password) {
    if (!PASSWORD_RULE.test(password)) {
        throw new HttpsError(
            "invalid-argument",
            "הסיסמה חייבת להכיל לפחות 6 תווים (אותיות או מספרים)"
        );
    }
}

// Mirror of the client's usernameToEmailLocal (js/utils.js): ASCII usernames stay
// as-is; non-ASCII (Hebrew) usernames are encoded to a deterministic ASCII form.
function usernameToEmailLocal(rawUsername) {
    const username = normalizedString(rawUsername).toLowerCase();
    if (!username) return "";
    if (/^[a-z0-9._-]+$/.test(username)) return username;
    const bytes = Buffer.from(username, "utf8");
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return "u" + hex;
}

function assertValidUsername(username) {
    if (!username) {
        throw new HttpsError("invalid-argument", "יש למלא שם משתמש");
    }
    if (/\s/.test(username)) {
        throw new HttpsError("invalid-argument", "שם המשתמש לא יכול להכיל רווחים");
    }
    if (!/^[a-zA-Z0-9._\-֐-׿]+$/.test(username)) {
        throw new HttpsError("invalid-argument", "שם המשתמש יכול להכיל אנגלית, מספרים או עברית בלבד");
    }
    if ([...username].length < USERNAME_MIN_LENGTH) {
        throw new HttpsError("invalid-argument", `שם המשתמש חייב להכיל לפחות ${USERNAME_MIN_LENGTH} תווים`);
    }
}

async function resolveCaller(request) {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "יש להתחבר כדי לבצע את הפעולה");
    }

    const email = normalizedString(request.auth.token.email);
    const caller = {
        uid: request.auth.uid,
        email,
        isSuperAdmin: isSuperAdminEmail(email),
        isAdmin: false,
        role: "kabat"
    };

    if (caller.isSuperAdmin) {
        caller.isAdmin = true;
        caller.role = "ahmash";
        return caller;
    }

    const snap = await db.collection("users").doc(caller.uid).get();
    const data = snap.exists ? snap.data() : null;
    caller.isAdmin = !!data?.isAdmin;
    caller.role = data?.role || "kabat";
    return caller;
}

async function requireAdmin(request) {
    const caller = await resolveCaller(request);
    if (!caller.isAdmin) {
        throw new HttpsError("permission-denied", "רק מנהלים רשאים לבצע את הפעולה");
    }
    return caller;
}

// Admins manage everyone; ahmash (non-admin) may manage only kabat users.
async function requireUserManager(request) {
    const caller = await resolveCaller(request);
    if (!caller.isAdmin && caller.role !== "ahmash") {
        throw new HttpsError("permission-denied", "אין לך הרשאה לנהל משתמשים");
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

    // Ahmash (non-admin) may only manage kabat, non-admin users.
    if (!actor.isAdmin && actor.role === "ahmash") {
        const targetRole = target.profile?.role || "kabat";
        if (targetRole !== "kabat" || target.profile?.isAdmin) {
            throw new HttpsError("permission-denied", 'אחמ"ש רשאי לנהל משתמשי קב"ט בלבד');
        }
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

exports.setUsername = onCall(async (request) => {
    const actor = await requireUserManager(request);
    const targetUid = normalizedString(request.data?.targetUid);
    const newUsername = normalizedString(request.data?.newUsername);

    if (!targetUid) {
        throw new HttpsError("invalid-argument", "חסר מזהה משתמש");
    }
    assertValidUsername(newUsername);

    const newEmail = usernameToEmailLocal(newUsername) + USERNAME_DOMAIN;

    const target = await getTargetUser(targetUid);
    if (!target.authUser) {
        throw new HttpsError("not-found", "החשבון לא נמצא ב-Firebase Authentication");
    }
    await assertManageableTarget(actor, target, { allowSelfDelete: true });

    // Reject if the new email/username already belongs to a different account.
    try {
        const existing = await admin.auth().getUserByEmail(newEmail);
        if (existing.uid !== targetUid) {
            throw new HttpsError("already-exists", "שם המשתמש כבר תפוס");
        }
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        if (error?.code !== "auth/user-not-found") throw error;
    }

    await admin.auth().updateUser(targetUid, { email: newEmail });
    await db.collection("users").doc(targetUid).set({
        email: newEmail,
        username: newUsername,
        usernameUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        usernameUpdatedBy: actor.uid
    }, { merge: true });

    return { ok: true, email: newEmail, username: newUsername };
});

exports.setUserPassword = onCall(async (request) => {
    const actor = await requireUserManager(request);
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
    const actor = await requireUserManager(request);
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