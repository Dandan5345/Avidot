// General utilities: HTML escaping, formatting, modal & toast helpers.

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleString("he-IL", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

export function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString("he-IL", {
    year: "numeric", month: "2-digit", day: "2-digit"
  });
}

// Returns ISO `yyyy-mm-ddThh:mm` for <input type="datetime-local"> default
export function nowAsLocalInputValue() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let signaturePadLibraryPromise = null;

export function signaturePadHtml({
  idPrefix = "signature",
  title = "חתימת בעל האבידה",
  description = "בעל האבידה חותם כאן עם האצבע, עט מגע או העכבר לפני אישור ההחזרה."
} = {}) {
  return `
    <div class="signature-card full">
      <div class="signature-card-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </div>
      <div class="signature-pad-shell">
        <canvas id="${escapeHtml(idPrefix)}_canvas" class="signature-canvas"></canvas>
        <div id="${escapeHtml(idPrefix)}_placeholder" class="signature-placeholder">חתמו כאן בתוך המסגרת</div>
      </div>
      <div class="signature-actions">
        <button type="button" class="btn btn-sm btn-outline" id="${escapeHtml(idPrefix)}_clear">נקה חתימה</button>
      </div>
    </div>`;
}

export async function createSignaturePadController(root, { idPrefix = "signature" } = {}) {
  const SignaturePad = await loadSignaturePadLibrary();
  const canvas = root.querySelector(`#${idPrefix}_canvas`);
  const clearButton = root.querySelector(`#${idPrefix}_clear`);
  const placeholder = root.querySelector(`#${idPrefix}_placeholder`);
  if (!canvas || !clearButton) throw new Error("אזור החתימה לא נטען כראוי");

  const signaturePad = new SignaturePad(canvas, {
    penColor: "#235b74",
    minWidth: 0.9,
    maxWidth: 2.2,
    backgroundColor: "rgba(255,255,255,0)"
  });

  const syncPlaceholder = () => {
    if (!placeholder) return;
    placeholder.classList.toggle("hidden", !signaturePad.isEmpty());
  };

  const resizeCanvas = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(Math.floor(rect.width * ratio), 1);
    canvas.height = Math.max(Math.floor(rect.height * ratio), 1);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    signaturePad.clear();
    syncPlaceholder();
  };

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  clearButton.addEventListener("click", () => {
    signaturePad.clear();
    syncPlaceholder();
  });
  canvas.addEventListener("pointerup", syncPlaceholder);
  canvas.addEventListener("mouseleave", syncPlaceholder);
  canvas.addEventListener("touchend", syncPlaceholder, { passive: true });

  return {
    isEmpty() {
      return signaturePad.isEmpty();
    },
    async toBlob(type = "image/png") {
      return await canvasToBlob(canvas, type);
    },
    destroy() {
      window.removeEventListener("resize", resizeCanvas);
    }
  };
}

async function loadSignaturePadLibrary() {
  if (window.SignaturePad) return window.SignaturePad;
  if (signaturePadLibraryPromise) return signaturePadLibraryPromise;

  signaturePadLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-signature-pad="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.SignaturePad), { once: true });
      existing.addEventListener("error", () => reject(new Error("טעינת ספריית החתימה נכשלה")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/signature_pad@4.2.0/dist/signature_pad.umd.min.js";
    script.async = true;
    script.dataset.signaturePad = "true";
    script.onload = () => {
      if (!window.SignaturePad) {
        reject(new Error("ספריית החתימה לא זמינה"));
        return;
      }
      resolve(window.SignaturePad);
    };
    script.onerror = () => reject(new Error("טעינת ספריית החתימה נכשלה"));
    document.head.appendChild(script);
  });

  return signaturePadLibraryPromise;
}

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("לא ניתן לייצר תמונת חתימה"));
        return;
      }
      resolve(blob);
    }, type);
  });
}

export function toIsoFromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d)) return null;
  return d.toISOString();
}

// ===== Toast =====
export function toast(message, type = "info", duration = 2800) {
  const root = document.getElementById("toastRoot");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ===== Modal =====
// Renders a modal and returns a controller {close, root}. `bodyHtml` is the
// inner HTML of the body section; `footer` is an array of button descriptors.
export function openModal({ title, bodyHtml = "", footerButtons = [], large = false, onClose }) {
  const root = document.getElementById("modalRoot");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal ${large ? "large" : ""}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>${escapeHtml(title || "")}</h3>
        <button type="button" class="modal-close" aria-label="סגור">×</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer"></div>
    </div>
  `;
  root.appendChild(backdrop);

  const modalEl = backdrop.querySelector(".modal");
  const bodyEl = backdrop.querySelector(".modal-body");
  const footerEl = backdrop.querySelector(".modal-footer");
  const closeBtn = backdrop.querySelector(".modal-close");

  if (typeof bodyHtml === "string") bodyEl.innerHTML = bodyHtml;
  else if (bodyHtml instanceof Node) bodyEl.appendChild(bodyHtml);

  if (bodyEl.querySelector("form")) modalEl.classList.add("modal-has-form");
  if (bodyEl.querySelector(".table-wrap")) modalEl.classList.add("modal-has-table");

  let closed = false;
  const escListener = (e) => {
    if (e.key === "Escape") close();
  };

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", escListener);
    backdrop.remove();
    if (typeof onClose === "function") onClose();
  }

  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", escListener);

  for (const btn of footerButtons) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ${btn.className || ""}`;
    b.textContent = btn.label;
    if (btn.id) b.id = btn.id;
    b.addEventListener("click", () => btn.onClick && btn.onClick({ close, body: bodyEl, modal: modalEl }));
    footerEl.appendChild(b);
  }

  return { close, body: bodyEl, modal: modalEl };
}

// Promise-based confirm dialog with custom buttons.
export function confirmDialog({ title = "אישור", message = "", confirmText = "אישור", cancelText = "ביטול", danger = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      bodyHtml: `<p style="margin:0;font-size:15px;">${escapeHtml(message)}</p>`,
      footerButtons: [
        { label: cancelText, className: "btn-secondary", onClick: ({ close }) => { resolve(false); close(); } },
        { label: confirmText, className: danger ? "btn-danger" : "btn-success", onClick: ({ close }) => { resolve(true); close(); } }
      ],
      onClose: () => resolve(false)
    });
    return m;
  });
}

// Promise-based prompt for a string input.
export function promptDialog({ title = "הזנת ערך", label = "", placeholder = "", defaultValue = "" }) {
  return new Promise((resolve) => {
    const id = "promptInput_" + Math.random().toString(36).slice(2, 8);
    const m = openModal({
      title,
      bodyHtml: `
        <label class="field">
          <span>${escapeHtml(label)}</span>
          <input id="${id}" type="text" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}" />
        </label>`,
      footerButtons: [
        { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => { resolve(null); close(); } },
        {
          label: "אישור", className: "btn-success", onClick: ({ close, body }) => {
            const v = body.querySelector(`#${id}`).value.trim();
            resolve(v);
            close();
          }
        }
      ],
      onClose: () => resolve(null)
    });
    setTimeout(() => {
      const inp = m.body.querySelector(`#${id}`);
      if (inp) {
        inp.focus();
        inp.select();
      }
    }, 50);
  });
}

// Build a "key/value" detail block (for item-detail modal).
export function detailRows(rows) {
  return rows
    .filter((r) => r && r.value !== undefined && r.value !== null && r.value !== "")
    .map((r) => `
      <div class="detail-row">
        <div class="key">${escapeHtml(r.label)}</div>
        <div class="val">${r.html ? r.value : escapeHtml(r.value)}</div>
      </div>`)
    .join("");
}

// Filter array by free-text search against given fields, plus optional date.
export function filterItems(items, { search = "", dateFilter = "", dateField = "dateTime" }) {
  let out = items;
  const s = search.trim().toLowerCase();
  if (s) {
    out = out.filter((it) => {
      return Object.values(it).some((v) => {
        if (v === null || v === undefined) return false;
        if (typeof v === "object") return JSON.stringify(v).toLowerCase().includes(s);
        return String(v).toLowerCase().includes(s);
      });
    });
  }
  if (dateFilter) {
    out = out.filter((it) => {
      const v = it[dateField];
      if (!v) return false;
      const d = new Date(v);
      if (isNaN(d)) return false;
      const iso = d.toISOString().slice(0, 10);
      return iso === dateFilter;
    });
  }
  return out;
}
