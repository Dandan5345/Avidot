// Helpers shared by all 3 item pages: counter management, item CRUD,
// and the standard "item details" modal.

import {
  createDocument,
  deleteDocumentsBatch,
  deleteDocument,
  fetchCollection,
  findDocumentsByField,
  getDocument,
  nextCounterValue,
  setCounterValue,
  updateDocument
} from "./firestoreStore.js";
import { openModal, escapeHtml, formatDateTime, detailRows } from "./utils.js";
import {
  syncLostItemDeleteSafe,
  syncLostItemUpsertSafe,
  syncLostItemsDeleteBatchSafe
} from "./googleSheetsBackup.js";

/**
 * Get the next item number for a given collection. We don't strictly rely
 * on a counter (the counter can be reset to 0 — that's why duplicates are
 * possible) but we still increment based on the current max and counter.
 */
export async function nextItemNumber(collectionName) {
  return nextCounterValue(collectionName);
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

export async function updateItem(collectionName, id, patch) {
  await updateDocument(collectionName, id, patch);
  if (collectionName === "lostItems") {
    const updated = await getDocument(collectionName, id);
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
  const ids = (itemsOrIds || []).map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean);
  if (!ids.length) return;

  let deletedItems = [];
  if (collectionName === "lostItems") {
    deletedItems = await Promise.all((itemsOrIds || []).map(async (entry) => {
      if (entry && typeof entry === "object") return entry;
      return getDocument(collectionName, entry);
    }));
    deletedItems = deletedItems.filter((item) => item?.id);
  }

  await deleteDocumentsBatch(collectionName, ids);
  if (collectionName === "lostItems" && deletedItems.length) {
    await syncLostItemsDeleteBatchSafe(deletedItems);
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
    { label: "מספר אבידה", value: item.number },
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
      label: "סטטוס", value: item.returned
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
