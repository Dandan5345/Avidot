// Helpers shared by all 3 item pages: counter management, item CRUD,
// and the standard "item details" modal.

import {
  createDocument,
  deleteDocument,
  fetchCollection,
  findDocumentsByField,
  nextCounterValue,
  setCounterValue,
  updateDocument
} from "./firestoreStore.js";
import { openModal, escapeHtml, formatDateTime, detailRows } from "./utils.js";

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
  return createDocument(collectionName, data);
}

export async function updateItem(collectionName, id, patch) {
  await updateDocument(collectionName, id, patch);
}

export async function deleteItem(collectionName, id) {
  await deleteDocument(collectionName, id);
}

export async function findItemsByNumber(collectionName, number) {
  return findDocumentsByField(collectionName, "number", Number(number));
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
  return openModal({
    title: "פרטי החזרה",
    bodyHtml: `<div>${detailRows(rows)}</div>`,
    footerButtons: [{ label: "סגור", className: "btn-secondary", onClick: ({ close }) => close() }]
  });
}
