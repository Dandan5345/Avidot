import {
  createDocument,
  deleteDocument,
  fetchCollection,
  subscribeCollection
} from "./firestoreStore.js";
import { currentUser } from "./auth.js";

const COLLECTION = "activityLogs";
const RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const PRUNE_CHECK_MS = 12 * 60 * 60 * 1000;
const LAST_PRUNE_KEY = "activityLogs:lastPruneAt";

let prunePromise = null;

export async function logActivity({
  action = "general",
  summary,
  entityType = "general",
  entityId = null,
  itemNumber = null,
  detailLines = [],
  metadata = {}
}) {
  if (!summary) return;

  await createDocument(COLLECTION, {
    action,
    summary,
    entityType,
    entityId,
    itemNumber,
    detailLines: detailLines.filter(Boolean),
    metadata,
    actorUid: currentUser.uid || null,
    actorName: currentUser.name || currentUser.email || "משתמש לא מזוהה",
    actorEmail: currentUser.email || "",
    actorRole: currentUser.role || "kabat",
    createdAt: new Date().toISOString()
  });
}

export function logActivitySafe(payload) {
  return logActivity(payload).catch((error) => {
    console.warn("[activity-log] failed to save activity:", error);
  });
}

export function subscribeActivityLogs(onData, onError) {
  return subscribeCollection(
    COLLECTION,
    (logs) => {
      const sorted = logs.slice().sort((a, b) => {
        const aTs = Date.parse(a.createdAt || "") || 0;
        const bTs = Date.parse(b.createdAt || "") || 0;
        return bTs - aTs;
      });
      onData(sorted);
    },
    onError
  );
}

export async function pruneOldActivityLogs() {
  if (prunePromise) return prunePromise;

  prunePromise = (async () => {
    const lastPruneAt = Number(localStorage.getItem(LAST_PRUNE_KEY) || 0);
    if (lastPruneAt && Date.now() - lastPruneAt < PRUNE_CHECK_MS) return;

    const cutoff = Date.now() - RETENTION_MS;
    const logs = await fetchCollection(COLLECTION);
    const staleLogs = logs.filter((log) => {
      const createdAt = Date.parse(log.createdAt || "");
      return createdAt && createdAt < cutoff;
    });

    for (const log of staleLogs) {
      await deleteDocument(COLLECTION, log.id);
    }

    localStorage.setItem(LAST_PRUNE_KEY, String(Date.now()));
  })();

  try {
    await prunePromise;
  } finally {
    prunePromise = null;
  }
}

export function collectionLabel(collectionName) {
  switch (collectionName) {
    case "lostItems":
      return "אבידות רגילות";
    case "pendingPickup":
      return "ממתינות לאיסוף";
    case "awaitingInfo":
      return "ממתינות למידע";
    case "users":
      return "משתמשים";
    default:
      return collectionName || "מערכת";
  }
}