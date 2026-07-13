// Helpers shared by all 3 item pages: counter management, item CRUD,
// and the standard "item details" modal.

import {
  archiveAndDeleteDocument,
  archiveAndDeleteDocumentsBatch,
  createDocument,
  deleteDocumentsBatch,
  deleteDocument,
  fetchCollection,
  findDocumentsByField,
  getDocument,
  nextCounterValueAtLeast,
  setCounterValue,
  updateDocument
} from "./firestoreStore.js";
import { openModal, escapeHtml, formatDateTime, detailRows } from "./utils.js";
import {
  syncLostItemDeleteSafe,
  syncLostItemUpsertSafe,
  syncLostItemsDeleteBatchSafe
} from "./googleSheetsBackup.js";

function normalizeBatchEntryId(entry) {
  return typeof entry === "string" ? entry : entry?.id;
}

function mergeItemPatch(item, patch) {
  return item ? { ...item, ...patch, id: item.id } : null;
}

async function fetchDocumentsByIdsInChunks(collectionName, ids, chunkSize = 25) {
  const results = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const docs = await Promise.all(chunk.map((id) => getDocument(collectionName, id)));
    results.push(...docs.filter((item) => item?.id));
  }
  return results;
}

/**
 * Get the next item number for a given collection. We don't strictly rely
 * on a counter (the counter can be reset to 0 — that's why duplicates are
 * possible) but we still increment based on the current max and counter.
 */
export async function nextItemNumber(collectionName) {
  const [lostItems, pendingItems, closedItems] = await Promise.all([
    fetchCollection("lostItems"),
    fetchCollection("pendingPickup"),
    fetchCollection("closedItems")
  ]);
  const largestExisting = lostItems.concat(pendingItems, closedItems)
    .reduce((max, item) => Math.max(max, normalizeItemNumber(item.number) || 0), 0);
  return nextCounterValueAtLeast("itemNumber", largestExisting);
}

/**
 * Set the counter explicitly (used for "reset to 0" admin actions if any).
 * Not currently exposed as UI but available.
 */
export async function setCounter(collectionName, value) {
  await setCounterValue(collectionName, value);
}

export async function fetchAllItems(collectionName) {
  return fetchCollection(collectionName);
}

export async function createItem(collectionName, data) {
  const id = await createDocument(collectionName, data);
  if (collectionName === "lostItems") {
    await syncLostItemUpsertSafe({ id, ...data });
  }
  return id;
}

export async function updateItem(collectionName, id, patch, { existingItem = null } = {}) {
  await updateDocument(collectionName, id, patch);
  if (collectionName === "lostItems") {
    const updated = existingItem
      ? mergeItemPatch(existingItem, patch)
      : await getDocument(collectionName, id);
    if (updated) await syncLostItemUpsertSafe(updated);
  }
}

export async function deleteItem(collectionName, id) {
  const existing = collectionName === "lostItems" ? await getDocument(collectionName, id) : null;
  await deleteDocument(collectionName, id);
  if (collectionName === "lostItems" && existing) {
    await syncLostItemDeleteSafe(existing);
  }
}

export async function deleteItemsBatch(collectionName, itemsOrIds) {
  const normalizedEntries = (itemsOrIds || []).filter(Boolean);
  const ids = normalizedEntries.map(normalizeBatchEntryId).filter(Boolean);
  if (!ids.length) return;

  let deletedItems = [];
  if (collectionName === "lostItems") {
    const objectEntries = normalizedEntries.filter((entry) => typeof entry === "object");
    const missingIds = normalizedEntries
      .filter((entry) => typeof entry === "string")
      .map(normalizeBatchEntryId)
      .filter(Boolean);
    const missingItems = await fetchDocumentsByIdsInChunks(collectionName, missingIds);
    deletedItems = objectEntries.concat(missingItems).filter((item) => item?.id);
  }

  await deleteDocumentsBatch(collectionName, ids);
  if (collectionName === "lostItems" && deletedItems.length) {
    await syncLostItemsDeleteBatchSafe(deletedItems);
  }
}

function archiveSnapshot(collectionName, item, {
  status,
  reason = "",
  returnDetails = null,
  closedBy = null,
  closedByName = "",
  closedAt = new Date().toISOString()
}) {
  const { id, ...itemData } = item;
  return {
    ...itemData,
    sourceId: id,
    sourceCollection: collectionName,
    terminalStatus: status,
    deletionReason: status === "deleted" ? String(reason || "").trim() : "",
    returned: status === "returned",
    returnDetails: returnDetails || item.returnDetails || null,
    closedAt,
    closedBy,
    closedByName
  };
}

export async function closeItem(collectionName, item, options) {
  if (!item?.id) throw new Error("רשומת האבידה אינה תקינה");
  const archiveData = archiveSnapshot(collectionName, item, options);
  const archiveId = await archiveAndDeleteDocument(collectionName, item.id, archiveData);
  if (collectionName === "lostItems") {
    if (options.status === "returned") {
      await syncLostItemUpsertSafe({ id: item.id, ...archiveData });
    } else {
      await syncLostItemDeleteSafe({ ...item, deletionReason: archiveData.deletionReason });
    }
  }
  return archiveId;
}

export async function closeItemsBatch(collectionName, items, options) {
  const entries = (items || []).filter((item) => item?.id).map((item) => ({
    id: item.id,
    archiveData: archiveSnapshot(collectionName, item, options)
  }));
  await archiveAndDeleteDocumentsBatch(collectionName, entries);
  if (collectionName === "lostItems" && items?.length) {
    await syncLostItemsDeleteBatchSafe(items.map((item) => ({
      ...item,
      deletionReason: String(options?.reason || "").trim()
    })));
  }
}

export async function findItemsByNumber(collectionName, number) {
  const normalizedTarget = normalizeItemNumber(number);
  if (normalizedTarget === null) return [];

  const numericMatches = await findDocumentsByField(collectionName, "number", normalizedTarget);
  if (numericMatches.length) return numericMatches;

  const stringMatches = await findDocumentsByField(collectionName, "number", String(normalizedTarget));
  if (stringMatches.length) return stringMatches;

  const items = await fetchAllItems(collectionName);
  return items.filter((item) => normalizeItemNumber(item.number) === normalizedTarget);
}

function normalizeItemNumber(value) {
  const normalized = Number(String(value ?? "").trim());
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

// ===== Item details modal =====
export function openItemDetailsModal({ title, item, extraRows = [], footerButtons = [] }) {
  const baseRows = [
    { label: "מספר אבידה", value: item.number || "טרם הוקצה" },
    { label: "תאריך ושעה", value: formatDateTime(item.dateTime) },
    { label: "תיאור הפריט", value: item.description },
    { label: "יקרת ערך", value: item.valuable ? "כן" : "לא" },
    { label: "איפה נמצא", value: item.foundLocation },
    { label: "איפה מאוחסן", value: item.storageLocation === "אחר" ? `${item.storageLocation} – ${item.storageOther || ""}` : item.storageLocation },
    { label: "שם המוצא", value: item.finderUnknown ? "לא ידוע" : item.finderName },
    { label: "מחלקת המוצא", value: item.finderUnknown ? "" : item.finderDept },
    { label: "הקב\"ט המטפל", value: item.kabatHandler },
    { label: "מיקום נוכחי", value: item.currentLocation },
    { label: "פרטים נוספים", value: item.additionalDetails },
    { label: "שם בעל האבידה", value: item.ownerName },
    { label: "טלפון בעלים", value: item.ownerPhone },
    { label: "תעודת זהות", value: item.ownerId },
    {
      label: "סטטוס", value: item.terminalStatus === "deleted"
        ? `<span class="badge red">נמחקה</span>`
        : item.returned
          ? `<span class="badge green">הוחזרה</span>`
          : `<span class="badge amber">פעילה</span>`,
      html: true
    }
  ];

  const allRows = baseRows.concat(extraRows);

  let bodyHtml = `<div>${detailRows(allRows)}</div>`;
  if (item.photoUrl) {
    bodyHtml += `
      <div class="detail-photo">
        <a href="${escapeHtml(item.photoUrl)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(item.photoUrl)}" alt="תמונת האבידה" />
        </a>
      </div>`;
  }

  return openModal({
    title: title || "פרטי אבידה",
    bodyHtml,
    footerButtons: footerButtons.length
      ? footerButtons
      : [{ label: "סגור", className: "btn-secondary", onClick: ({ close }) => close() }]
  });
}

// Renders the "return details" sub-modal showing who picked up the item.
export function openReturnDetailsModal(item) {
  const rd = item.returnDetails || {};
  const rows = [
    { label: "שם המקבל", value: rd.receiverName },
    { label: "טלפון/ת.ז.", value: rd.receiverContact },
    { label: "קב\"ט שטיפל בהחזרה", value: rd.handlerName },
    { label: "תאריך החזרה", value: formatDateTime(rd.returnedAt) }
  ];
  let bodyHtml = `<div>${detailRows(rows)}</div>`;
  if (rd.signatureUrl) {
    bodyHtml += `
      <div class="detail-photo signature-photo">
        <div class="signature-photo-label">חתימת בעל האבידה</div>
        <a href="${escapeHtml(rd.signatureUrl)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(rd.signatureUrl)}" alt="חתימת בעל האבידה" />
        </a>
      </div>`;
  }
  return openModal({
    title: "פרטי החזרה",
    bodyHtml,
    footerButtons: [{ label: "סגור", className: "btn-secondary", onClick: ({ close }) => close() }]
  });
}
