import { toast } from "./utils.js";

const GOOGLE_SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzY2kLjZYsJCgWXChCZz9KA8IcLTan8k3i-y-k0DUjCzUwrFt8qLTRgQFqBwSHxc_p4/exec";
const LOST_ITEMS_COLLECTION = "lostItems";
const FULL_SYNC_BATCH_SIZE = 100;
const DELETE_SYNC_BATCH_SIZE = 10;
const FULL_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
const LAST_FULL_SYNC_KEY = "lostItemsGoogleSheets:lastFullSyncAt";
const LOST_ITEM_SYNC_FIELDS = [
  "id",
  "collection",
  "number",
  "dateTime",
  "description",
  "valuable",
  "foundLocation",
  "storageLocation",
  "storageOther",
  "storageDisplay",
  "finderName",
  "finderDept",
  "finderUnknown",
  "kabatHandler",
  "currentLocation",
  "additionalDetails",
  "ownerName",
  "ownerPhone",
  "ownerId",
  "photoUrl",
  "returned",
  "status",
  "statusLabel",
  "returnReceiverName",
  "returnReceiverContact",
  "returnHandlerName",
  "returnReturnedAt",
  "returnReturnedBy",
  "returnSignatureUrl",
  "createdAt",
  "createdBy",
  "createdByName",
  "deletedAt",
  "syncedAt"
];

function normalizeOptionalString(value) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value);
}

function storageDisplayValue(item) {
  if (normalizeOptionalString(item.storageLocation) !== "אחר") {
    return normalizeOptionalString(item.storageLocation);
  }
  return normalizeOptionalString(item.storageOther) || "אחר";
}

function normalizeOptionalBoolean(value) {
  return !!value;
}

function normalizeReturnDetails(returnDetails = {}) {
  return {
    receiverName: normalizeOptionalString(returnDetails.receiverName),
    receiverContact: normalizeOptionalString(returnDetails.receiverContact),
    handlerName: normalizeOptionalString(returnDetails.handlerName),
    returnedAt: normalizeOptionalString(returnDetails.returnedAt),
    returnedBy: normalizeOptionalString(returnDetails.returnedBy),
    signatureUrl: normalizeOptionalString(returnDetails.signatureUrl)
  };
}

function buildLostItemRawSnapshot(item = {}, { deleted = false, syncedAt } = {}) {
  const returnDetails = normalizeReturnDetails(item.returnDetails || {});
  const returned = normalizeOptionalBoolean(item.returned);
  const status = deleted ? "deleted" : (returned ? "returned" : "active");
  const statusLabel = deleted ? "נמחקה" : (returned ? "הוחזרה לבעל האבידה" : "פעילה");

  return {
    id: normalizeOptionalString(item.id),
    collection: LOST_ITEMS_COLLECTION,
    number: item.number ?? "",
    dateTime: normalizeOptionalString(item.dateTime),
    description: normalizeOptionalString(item.description),
    valuable: normalizeOptionalBoolean(item.valuable),
    foundLocation: normalizeOptionalString(item.foundLocation),
    storageLocation: normalizeOptionalString(item.storageLocation),
    storageOther: normalizeOptionalString(item.storageOther),
    storageDisplay: storageDisplayValue(item),
    finderName: normalizeOptionalString(item.finderName),
    finderDept: normalizeOptionalString(item.finderDept),
    finderUnknown: normalizeOptionalBoolean(item.finderUnknown),
    kabatHandler: normalizeOptionalString(item.kabatHandler),
    currentLocation: normalizeOptionalString(item.currentLocation),
    additionalDetails: normalizeOptionalString(item.additionalDetails),
    ownerName: normalizeOptionalString(item.ownerName),
    ownerPhone: normalizeOptionalString(item.ownerPhone),
    ownerId: normalizeOptionalString(item.ownerId),
    photoUrl: normalizeOptionalString(item.photoUrl),
    returned,
    status,
    statusLabel,
    returnReceiverName: returnDetails.receiverName,
    returnReceiverContact: returnDetails.receiverContact,
    returnHandlerName: returnDetails.handlerName,
    returnReturnedAt: returnDetails.returnedAt,
    returnReturnedBy: returnDetails.returnedBy,
    returnSignatureUrl: returnDetails.signatureUrl,
    returnDetails,
    createdAt: normalizeOptionalString(item.createdAt),
    createdBy: normalizeOptionalString(item.createdBy),
    createdByName: normalizeOptionalString(item.createdByName),
    deletedAt: deleted ? syncedAt : "",
    syncedAt
  };
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildLostItemSyncRecord(item = {}, { deleted = false, syncedAt } = {}) {
  const returnDetails = normalizeReturnDetails(item.returnDetails || {});
  const returned = !!item.returned;
  const status = deleted ? "deleted" : (returned ? "returned" : "active");
  const statusLabel = deleted ? "נמחקה" : (returned ? "הוחזרה לבעל האבידה" : "פעילה");

  return {
    id: normalizeOptionalString(item.id),
    collection: LOST_ITEMS_COLLECTION,
    number: item.number ?? "",
    dateTime: normalizeOptionalString(item.dateTime),
    description: normalizeOptionalString(item.description),
    valuable: !!item.valuable,
    foundLocation: normalizeOptionalString(item.foundLocation),
    storageLocation: normalizeOptionalString(item.storageLocation),
    storageOther: normalizeOptionalString(item.storageOther),
    storageDisplay: storageDisplayValue(item),
    finderName: normalizeOptionalString(item.finderName),
    finderDept: normalizeOptionalString(item.finderDept),
    finderUnknown: !!item.finderUnknown,
    kabatHandler: normalizeOptionalString(item.kabatHandler),
    currentLocation: normalizeOptionalString(item.currentLocation),
    additionalDetails: normalizeOptionalString(item.additionalDetails),
    ownerName: normalizeOptionalString(item.ownerName),
    ownerPhone: normalizeOptionalString(item.ownerPhone),
    ownerId: normalizeOptionalString(item.ownerId),
    photoUrl: normalizeOptionalString(item.photoUrl),
    returned,
    status,
    statusLabel,
    returnReceiverName: normalizeOptionalString(returnDetails.receiverName),
    returnReceiverContact: normalizeOptionalString(returnDetails.receiverContact),
    returnHandlerName: normalizeOptionalString(returnDetails.handlerName),
    returnReturnedAt: normalizeOptionalString(returnDetails.returnedAt),
    returnReturnedBy: normalizeOptionalString(returnDetails.returnedBy),
    returnSignatureUrl: normalizeOptionalString(returnDetails.signatureUrl),
    createdAt: normalizeOptionalString(item.createdAt),
    createdBy: normalizeOptionalString(item.createdBy),
    createdByName: normalizeOptionalString(item.createdByName),
    deletedAt: deleted ? syncedAt : "",
    syncedAt
  };
}

function buildLostItemChangePayload(item, { deleted = false } = {}) {
  const syncedAt = new Date().toISOString();
  const record = buildLostItemSyncRecord(item, { deleted, syncedAt });

  return {
    source: "firestore-client",
    schemaVersion: 2,
    action: deleted ? "delete" : "upsert",
    collection: LOST_ITEMS_COLLECTION,
    syncedAt,
    fieldOrder: LOST_ITEM_SYNC_FIELDS,
    record,
    item: record,
    rawItem: buildLostItemRawSnapshot(item, { deleted, syncedAt }),
    ...record
  };
}

function buildLostItemFullSyncPayload(items, { syncedAt, chunkIndex, chunkCount } = {}) {
  const records = (items || []).map((item) => buildLostItemSyncRecord(item, { syncedAt }));
  const rawItems = (items || []).map((item) => buildLostItemRawSnapshot(item, { syncedAt }));

  return {
    source: "firestore-client",
    schemaVersion: 2,
    action: "full_sync",
    collection: LOST_ITEMS_COLLECTION,
    syncedAt,
    fieldOrder: LOST_ITEM_SYNC_FIELDS,
    items: records,
    records,
    rawItems,
    chunkIndex,
    chunkCount
  };
}

async function postLostItemsSync(payload) {
  // Apps Script accepts the raw JSON string via postData.contents, while a
  // text/plain request avoids the browser CORS preflight that blocked syncs.
  const response = await fetch(GOOGLE_SHEETS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || `Google Sheets sync failed (${response.status})`);
  }
  return responseText;
}

async function syncLostItemChange(item, { deleted = false } = {}) {
  await postLostItemsSync(buildLostItemChangePayload(item, { deleted }));
}

async function syncLostItemsFullSnapshot(items) {
  const syncedAt = new Date().toISOString();
  const chunks = chunkItems(items || [], FULL_SYNC_BATCH_SIZE);

  if (!chunks.length) {
    await postLostItemsSync(buildLostItemFullSyncPayload([], {
      syncedAt,
      chunkIndex: 1,
      chunkCount: 1
    }));
    return;
  }

  // Keep full-sync chunks sequential so the Apps Script endpoint receives
  // a predictable order and avoids burst traffic when an entire sheet is rebuilt.
  for (let index = 0; index < chunks.length; index += 1) {
    await postLostItemsSync(buildLostItemFullSyncPayload(chunks[index], {
      syncedAt,
      chunkIndex: index + 1,
      chunkCount: chunks.length
    }));
  }
}

function notifySyncFailure(message, error, { silent = false } = {}) {
  console.warn("[google-sheets-sync]", error);
  if (!silent) toast(message, "error");
}

export async function syncLostItemUpsertSafe(item, { silent = false } = {}) {
  try {
    await syncLostItemChange(item, { deleted: false });
    return true;
  } catch (error) {
    notifySyncFailure("הרשומה נשמרה ב-Firestore אבל העדכון ל-Google Sheets נכשל", error, { silent });
    return false;
  }
}

export async function syncLostItemDeleteSafe(item, { silent = false } = {}) {
  try {
    await syncLostItemChange(item, { deleted: true });
    return true;
  } catch (error) {
    notifySyncFailure("הרשומה נמחקה מ-Firestore אבל העדכון ל-Google Sheets נכשל", error, { silent });
    return false;
  }
}

export async function syncLostItemsDeleteBatchSafe(items, { silent = false } = {}) {
  const validItems = (items || []).filter((item) => item?.id);
  try {
    const chunks = chunkItems(validItems, DELETE_SYNC_BATCH_SIZE);
    // Delete updates stay in small parallel groups because each payload is a
    // single item, unlike full_sync which already batches 100 records per request.
    for (const chunk of chunks) {
      await Promise.all(chunk.map((item) => syncLostItemChange(item, { deleted: true })));
    }
    return true;
  } catch (error) {
    notifySyncFailure("חלק מהמחיקות עודכנו ב-Firestore אבל הסנכרון ל-Google Sheets נכשל", error, { silent });
    return false;
  }
}

export async function syncLostItemsFullSnapshotSafe(items, { force = false, silent = true } = {}) {
  const now = Date.now();
  const lastSyncAt = Number(localStorage.getItem(LAST_FULL_SYNC_KEY) || 0);
  if (!force && now - lastSyncAt < FULL_SYNC_COOLDOWN_MS) return false;

  try {
    await syncLostItemsFullSnapshot(items);
    localStorage.setItem(LAST_FULL_SYNC_KEY, String(now));
    return true;
  } catch (error) {
    notifySyncFailure("האבידות נטענו, אבל הגיבוי המלא ל-Google Sheets נכשל", error, { silent });
    return false;
  }
}
