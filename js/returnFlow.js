// The "אבידה הוחזרה" flow — the screen a guard runs on a phone, standing next
// to the guest, while the guest signs.
//
// Both item pages (אבידות / ממתינות לאיסוף) share this so the mobile fixes
// live in one place:
// - The confirm button stays disabled until the signature pad is actually
//   ready, instead of reporting "no signature" while the library loads.
// - Submitting is guarded against a double tap, which used to fire two
//   uploads and two closeItem() calls.
// - Closing a form that already has typing or a signature in it asks first,
//   and a stray tap on the backdrop no longer discards anything.
// - Text fields carry the right mobile keyboard and dismiss it on "done", so
//   the keyboard is never left covering the signature pad.
import { closeItem } from "./itemsCommon.js";
import { currentUser, defaultHandlerName } from "./auth.js";
import {
  escapeHtml, formatDateTime, openModal, toast, detailRows, confirmDialog,
  signaturePadHtml, createSignaturePadController
} from "./utils.js";
import { uploadImageToImgBB } from "./imgbb.js";
import { collectionLabel, logActivitySafe } from "./activityLog.js";

function actorLabel() {
  return currentUser.name || currentUser.email || "משתמש";
}

/**
 * @param {object} options
 * @param {string} options.collection            Firestore collection the item lives in.
 * @param {object} options.item                  The item being handed back.
 * @param {string} options.idPrefix              Unique DOM id prefix for the signature pad.
 * @param {string} options.title                 Modal title.
 * @param {string} options.confirmLabel          Primary button label.
 * @param {string} options.successMessage        Toast shown after a successful save.
 * @param {string} options.contactLabel          Label for the identifying field.
 * @param {string} options.contactNote           Helper text under that field.
 * @param {string} options.contactLogLabel       How that field is named in the activity log.
 * @param {boolean} options.contactNumeric       Show the numeric keypad for it (ID numbers).
 * @param {Array}  options.summaryRows           Rows describing the item.
 * @param {string} options.logAction             Activity-log action key.
 */
export function openReturnFormModal({
  collection,
  item,
  idPrefix,
  title,
  confirmLabel,
  successMessage,
  contactLabel,
  contactNote,
  contactLogLabel,
  contactNumeric = false,
  contactDefault = "",
  summaryRows,
  logAction
}) {
  const summary = detailRows(summaryRows);
  let signatureController = null;
  let signatureReady = false;
  let isSaving = false;
  let isClosing = false;

  const m = openModal({
    title,
    // A misplaced tap on the backdrop must not throw away a signature the
    // guest already gave.
    dismissible: false,
    bodyHtml: `
      <div class="modal-note">
        <strong>אישור מסירת האבידה</strong>
        <span>מלאו את פרטי מקבל האבידה, ציינו מי מסר את הפריט, ואספו חתימה דיגיטלית לפני האישור.</span>
      </div>
      <div class="return-summary">
        <div class="return-summary-title">פרטי האבידה</div>
        ${summary}
      </div>
      <div class="form-grid">
        <label class="field full"><span>שם מלא של המקבל</span>
          <input type="text" id="r_receiverName" value="${escapeHtml(item.ownerName || "")}"
            autocomplete="name" enterkeyhint="next" required />
          <small class="field-note">רשמו את האדם שקיבל את האבידה בפועל, גם אם מישהו אחר תיאם את האיסוף.</small>
        </label>
        <label class="field full"><span>${escapeHtml(contactLabel)}</span>
          <input type="text" id="r_receiverContact" value="${escapeHtml(contactDefault)}"
            ${contactNumeric ? 'inputmode="numeric" pattern="[0-9]*"' : ""}
            autocomplete="off" enterkeyhint="next" />
          <small class="field-note">${escapeHtml(contactNote)}</small>
        </label>
        <label class="field full"><span>שם הקב"ט שטיפל</span>
          <input type="text" id="r_handlerName" value="${escapeHtml(defaultHandlerName())}"
            autocomplete="off" enterkeyhint="done" required />
          <small class="field-note">מי בדק את הפרטים ואישר את המסירה.</small>
        </label>
        ${signaturePadHtml({ idPrefix })}
      </div>`,
    onRequestClose: async () => {
      if (isSaving) return false;               // never abandon a save mid-flight
      if (!hasUnsavedWork()) return true;
      return await confirmDialog({
        title: "לצאת בלי לשמור?",
        message: "כבר מולאו פרטים בטופס ההחזרה. יציאה עכשיו תמחק אותם.",
        confirmText: "צא בלי לשמור",
        cancelText: "המשך למלא",
        danger: true
      });
    },
    onClose: () => {
      isClosing = true;
      signatureController?.destroy();
      signatureController = null;
    },
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: () => m.requestClose() },
      { label: confirmLabel, className: "btn-success", primary: true, id: `${idPrefix}_submit`, onClick: onSubmit }
    ]
  });

  const submitBtn = m.modal.querySelector(`#${idPrefix}_submit`);
  const fields = {
    receiverName: m.body.querySelector("#r_receiverName"),
    receiverContact: m.body.querySelector("#r_receiverContact"),
    handlerName: m.body.querySelector("#r_handlerName")
  };

  // On a phone the "done" key should put the keyboard away, not leave it
  // sitting on top of the signature pad.
  const fieldList = [fields.receiverName, fields.receiverContact, fields.handlerName];
  fieldList.forEach((input, index) => {
    if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const next = fieldList[index + 1];
      if (next) next.focus();
      else {
        input.blur();
        signatureController?.focusPad();
      }
    });
  });

  // Compare against what the form was pre-filled with, so only real typing
  // (or a collected signature) counts as work worth warning about.
  const initialValues = fieldList.map((input) => (input ? input.value : ""));

  function hasUnsavedWork() {
    const edited = fieldList.some((input, index) =>
      input && input.value !== initialValues[index]);
    return edited || !!(signatureController && !signatureController.isEmpty());
  }

  // Keep the button honest about why it is unavailable.
  function syncSubmitState() {
    if (!submitBtn || isSaving) return;
    submitBtn.disabled = !signatureReady;
    submitBtn.title = signatureReady ? "" : "ממתין לטעינת אזור החתימה";
  }
  syncSubmitState();

  createSignaturePadController(m.body, { idPrefix })
    .then((controller) => {
      if (isClosing) { controller.destroy(); return; }
      signatureController = controller;
      signatureReady = true;
      syncSubmitState();
    })
    .catch((error) => {
      signatureReady = false;
      syncSubmitState();
      toast(error.message || "שגיאה בטעינת אזור החתימה", "error");
    });

  async function onSubmit() {
    if (isSaving) return;                       // double-tap guard

    const receiverName = fields.receiverName.value.trim();
    const receiverContact = fields.receiverContact.value.trim();
    const handlerName = fields.handlerName.value.trim();

    // Identifying details are optional — the signature is the real proof of
    // handover, and a guest often has no ID on them at the desk.
    const missing = !receiverName ? fields.receiverName
      : !handlerName ? fields.handlerName
        : null;
    if (missing) {
      toast("יש למלא שם מקבל ושם קב\"ט", "error");
      missing.focus();
      missing.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!signatureController) {
      toast("אזור החתימה עדיין נטען, נסו שוב בעוד רגע", "error");
      return;
    }
    if (signatureController.isEmpty()) {
      toast("יש לאסוף חתימה דיגיטלית של בעל האבידה", "error");
      signatureController.focusPad();
      return;
    }

    isSaving = true;
    m.setBusy(true, "שומר...");
    try {
      const signatureBlob = await signatureController.toBlob();
      const signatureUrl = await uploadImageToImgBB(signatureBlob);
      const returnDetails = {
        receiverName, receiverContact, handlerName,
        returnedAt: new Date().toISOString(),
        returnedBy: currentUser.uid || null,
        signatureUrl
      };
      await closeItem(collection, item, {
        status: "returned",
        returnDetails,
        closedAt: returnDetails.returnedAt,
        closedBy: currentUser.uid || null,
        closedByName: actorLabel()
      });
      void logActivitySafe({
        action: logAction,
        entityType: "item",
        entityId: item.id,
        itemNumber: item.number,
        summary: `${actorLabel()} החזיר את אבידה מספר ${item.number} מדף ${collectionLabel(collection)}`,
        detailLines: [
          `המקבל: ${receiverName}`,
          `${contactLogLabel}: ${receiverContact || "לא הוזן"}`,
          `קב"ט שטיפל: ${handlerName}`
        ],
        metadata: { sourceCollection: collection }
      });
      toast(successMessage, "success");
      m.close();
    } catch (e) {
      // Leave everything the user typed and signed in place so they can retry.
      isSaving = false;
      m.setBusy(false);
      syncSubmitState();
      toast(e.message || "שגיאה בשמירה", "error");
    }
  }

  return m;
}

/** Shared summary block for the item being returned. */
export function returnSummaryRows(item, extraRows = []) {
  return [
    { label: "מספר", value: item.number },
    { label: "תאריך", value: formatDateTime(item.dateTime) },
    { label: "תיאור", value: item.description }
  ].concat(extraRows);
}
