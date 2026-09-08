// General utilities: HTML escaping, formatting, modal & toast helpers.

// Converts a username to the local part of the login email (before @aovdim.com).
// English/numeric usernames are kept as-is (lowercased) for backward compatibility.
// Non-ASCII usernames (e.g. Hebrew) are encoded to a deterministic ASCII form,
// because Firebase Auth rejects email addresses with non-ASCII characters.
// The same input always produces the same output, so login and user creation match.
export function usernameToEmailLocal(rawUsername) {
  const username = String(rawUsername || "").trim().toLowerCase();
  if (!username) return "";
  // Already a valid ASCII email local part → use as-is.
  if (/^[a-z0-9._-]+$/.test(username)) return username;
  // Otherwise encode the UTF-8 bytes as hex (ASCII-safe, reversible, collision-free).
  const bytes = new TextEncoder().encode(username);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "u" + hex;
}

// Reverse of usernameToEmailLocal: recover the readable username from a login email.
// Used for display only (e.g. showing the username in the edit dialog).
export function usernameFromEmail(email) {
  const local = String(email || "").split("@")[0];
  if (!local) return "";
  // Encoded non-ASCII form is "u" followed by an even number of hex digits.
  if (local.length > 2 && /^u([0-9a-f]{2})+$/.test(local)) {
    try {
      const hex = local.slice(1);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      // Only treat it as encoded if it actually decodes to non-ASCII (e.g. Hebrew).
      if (/[^\x00-\x7F]/.test(decoded)) return decoded;
    } catch (_) {
      // Not an encoded username — fall through and show the local part as-is.
    }
  }
  return local;
}

// ===== Password hashing (Firestore-based login, no Firebase Auth) =====
// Not a substitute for a proper server-side auth system: the hash lives in a
// Firestore doc readable by any signed-in (incl. anonymous) session. Chosen
// deliberately to avoid the Blaze plan (Cloud Functions/Admin SDK) — see
// project memory "firestore-auth-migration-plan".
export function generateSalt(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashPassword(salt, password) {
  const data = new TextEncoder().encode(String(salt) + String(password));

  // `crypto.subtle` only exists in a secure context (HTTPS or localhost).
  // Opening the app over plain http on a LAN address — which is how the site
  // gets tested from a phone — leaves it undefined, and login used to die with
  // "Cannot read properties of undefined (reading 'digest')". Fall back to a
  // plain SHA-256 so the same hash comes out either way.
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHex(new Uint8Array(digest));
  }
  return toHex(sha256Bytes(data));
}

/** True when the browser exposes WebCrypto (HTTPS or localhost). */
export function hasNativeCrypto() {
  return !!globalThis.crypto?.subtle?.digest;
}

// Minimal SHA-256 (FIPS 180-4), used only as the fallback above. Verified to
// produce byte-identical output to crypto.subtle.digest("SHA-256", …).
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256Bytes(input) {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  // Pad: 0x80, zeros, then the 64-bit big-endian bit length.
  const bitLength = input.length * 8;
  const paddedLength = ((input.length + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(paddedLength);
  msg.set(input);
  msg[input.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, h[0]);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, h[i]);
  return out;
}

export async function verifyPassword(salt, hash, password) {
  const computed = await hashPassword(salt, password);
  return computed === hash;
}

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
  const safeId = escapeHtml(idPrefix);
  return `
    <div class="signature-card full" id="${safeId}_card">
      <div class="signature-card-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </div>
      <div class="signature-pad-shell" id="${safeId}_shell">
        <canvas id="${safeId}_canvas" class="signature-canvas" touch-action="none"></canvas>
        <div id="${safeId}_placeholder" class="signature-placeholder">
          <span class="signature-placeholder-mark" aria-hidden="true">✍️</span>
          <span>חתמו כאן בתוך המסגרת</span>
        </div>
        <div id="${safeId}_loading" class="signature-loading">טוען אזור חתימה...</div>
      </div>
      <div class="signature-actions">
        <span class="signature-state" id="${safeId}_state">עדיין לא נחתם</span>
        <button type="button" class="btn btn-sm btn-outline" id="${safeId}_clear">נקה חתימה</button>
      </div>
    </div>`;
}

/**
 * Wires the signature canvas.
 *
 * Two mobile bugs are handled here, both of which used to wipe a finished
 * signature:
 * - The on-screen keyboard opening/closing fires `resize`. The old code
 *   re-sized the canvas on every `resize` and called `clear()`, so dismissing
 *   the keyboard after typing an ID erased the signature. We now ignore
 *   height-only changes (which is all the keyboard causes) and, when a real
 *   width change forces a re-size, we restore the strokes afterwards.
 * - Without `touch-action: none` the browser treats a stroke as a page scroll,
 *   so drawing felt stuck and dropped half the line.
 */
export async function createSignaturePadController(root, { idPrefix = "signature", onChange } = {}) {
  const canvas = root.querySelector(`#${idPrefix}_canvas`);
  const clearButton = root.querySelector(`#${idPrefix}_clear`);
  const placeholder = root.querySelector(`#${idPrefix}_placeholder`);
  const loadingEl = root.querySelector(`#${idPrefix}_loading`);
  const stateEl = root.querySelector(`#${idPrefix}_state`);
  const shell = root.querySelector(`#${idPrefix}_shell`);
  if (!canvas || !clearButton) throw new Error("אזור החתימה לא נטען כראוי");

  // Dismiss the on-screen keyboard the moment the guest reaches for the pad,
  // so the pad is never hidden behind it.
  const dismissKeyboard = () => {
    const active = document.activeElement;
    if (active && active !== canvas && typeof active.blur === "function" &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
      active.blur();
    }
  };
  if (shell) shell.addEventListener("pointerdown", dismissKeyboard, { capture: true });

  let SignaturePad;
  try {
    SignaturePad = await loadSignaturePadLibrary();
  } catch (error) {
    if (loadingEl) {
      loadingEl.textContent = "טעינת אזור החתימה נכשלה. בדקו את החיבור לאינטרנט ונסו לפתוח שוב.";
      loadingEl.classList.add("error");
    }
    throw error;
  }
  if (loadingEl) loadingEl.remove();

  const signaturePad = new SignaturePad(canvas, {
    penColor: "#235b74",
    minWidth: 0.9,
    maxWidth: 2.6,
    throttle: 8,
    backgroundColor: "rgba(255,255,255,0)"
  });

  const syncState = () => {
    const empty = signaturePad.isEmpty();
    if (placeholder) placeholder.classList.toggle("hidden", !empty);
    if (stateEl) {
      stateEl.textContent = empty ? "עדיין לא נחתם" : "נחתם ✓";
      stateEl.classList.toggle("signed", !empty);
    }
    if (shell) shell.classList.toggle("has-signature", !empty);
    if (typeof onChange === "function") {
      try { onChange(!empty); } catch (_) { }
    }
  };

  // Track the width we last rendered at. The keyboard only changes the
  // viewport HEIGHT, so a height-only change must never touch the canvas.
  let lastWidth = 0;

  const applyCanvasSize = ({ preserve = true } = {}) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return; // detached or hidden — nothing to do
    const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const strokes = preserve && !signaturePad.isEmpty() ? signaturePad.toData() : null;

    canvas.width = Math.max(Math.floor(rect.width * ratio), 1);
    canvas.height = Math.max(Math.floor(rect.height * ratio), 1);
    canvas.getContext("2d").scale(ratio, ratio);
    lastWidth = Math.round(rect.width);

    // Setting canvas.width wipes the bitmap, so redraw what was there.
    signaturePad.clear();
    if (strokes && strokes.length) {
      try { signaturePad.fromData(strokes); } catch (_) { }
    }
    syncState();
  };

  let resizeTimer = null;
  const handleViewportChange = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const width = Math.round(canvas.getBoundingClientRect().width);
      if (!width || width === lastWidth) return; // keyboard-only change → ignore
      applyCanvasSize({ preserve: true });
    }, 120);
  };

  applyCanvasSize({ preserve: false });

  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("orientationchange", handleViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleViewportChange);
  }

  const onClear = () => {
    signaturePad.clear();
    syncState();
  };
  clearButton.addEventListener("click", onClear);
  signaturePad.addEventListener("endStroke", syncState);
  signaturePad.addEventListener("beginStroke", syncState);

  return {
    isEmpty() {
      return signaturePad.isEmpty();
    },
    focusPad() {
      if (shell && typeof shell.scrollIntoView === "function") {
        shell.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    async toBlob(type = "image/png") {
      return await canvasToBlob(canvas, type);
    },
    destroy() {
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleViewportChange);
      }
      clearButton.removeEventListener("click", onClear);
      if (shell) shell.removeEventListener("pointerdown", dismissKeyboard, { capture: true });
      try { signaturePad.off(); } catch (_) { }
    }
  };
}


async function loadSignaturePadLibrary() {
  if (window.SignaturePad) return window.SignaturePad;
  if (signaturePadLibraryPromise) return signaturePadLibraryPromise;

  // The library is vendored into the repo so a guest can still sign when the
  // hotel wifi is flaky or a CDN is blocked — this screen has to work offline.
  // The CDN stays as a second chance in case the local file is missing.
  const SOURCES = [
    new URL("./vendor/signature_pad.umd.min.js", import.meta.url).href,
    "https://cdn.jsdelivr.net/npm/signature_pad@4.2.0/dist/signature_pad.umd.min.js"
  ];

  signaturePadLibraryPromise = (async () => {
    let lastError = null;
    for (const src of SOURCES) {
      try {
        await loadScriptOnce(src);
        if (window.SignaturePad) return window.SignaturePad;
        lastError = new Error("ספריית החתימה לא זמינה");
      } catch (error) {
        lastError = error;
      }
    }
    signaturePadLibraryPromise = null; // allow a retry on the next attempt
    throw lastError || new Error("טעינת ספריית החתימה נכשלה");
  })();

  return signaturePadLibraryPromise;
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    // Match on the property rather than building an attribute selector out of
    // a URL — no escaping rules to get subtly wrong.
    const existing = Array.from(document.querySelectorAll("script[data-signature-pad]"))
      .find((el) => el.dataset.signaturePad === src);
    if (existing) {
      if (existing.dataset.loaded === "true") { resolve(); return; }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("טעינת ספריית החתימה נכשלה")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.signaturePad = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("טעינת ספריית החתימה נכשלה")), { once: true });
    document.head.appendChild(script);
  });
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
// Renders a modal and returns a controller {close, body, modal, setBusy}.
// `bodyHtml` is the inner HTML of the body section; `footerButtons` is an array
// of button descriptors.
//
// Mobile notes:
// - Only the top-most modal reacts to Escape, so a nested dialog no longer
//   closes its parent too.
// - `dismissible: false` stops a stray tap on the backdrop from throwing away
//   a half-filled form — the guest-return form uses it.
// - The page behind is scroll-locked while a modal is open, so scrolling
//   inside the modal never drags the list underneath.
const openModalStack = [];
let savedBodyScrollY = 0;

function lockBodyScroll() {
  if (openModalStack.length !== 1) return;
  savedBodyScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.classList.add("modal-open");
  document.body.style.top = `-${savedBodyScrollY}px`;
}

function unlockBodyScroll() {
  if (openModalStack.length !== 0) return;
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, savedBodyScrollY);
}

export function openModal({
  title,
  bodyHtml = "",
  footerButtons = [],
  large = false,
  onClose,
  dismissible = true,
  onRequestClose = null
}) {
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

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", escListener);
    const index = openModalStack.indexOf(handle);
    if (index !== -1) openModalStack.splice(index, 1);
    backdrop.remove();
    unlockBodyScroll();
    if (typeof onClose === "function") onClose();
  }

  // A close the *user* asked for (X, backdrop, Escape). Lets the caller warn
  // about unsaved work before anything is discarded.
  function requestClose() {
    if (closed) return;
    if (typeof onRequestClose === "function") {
      const proceed = onRequestClose();
      if (proceed === false) return;
      if (proceed && typeof proceed.then === "function") {
        proceed.then((ok) => { if (ok !== false) close(); });
        return;
      }
    }
    close();
  }

  const escListener = (e) => {
    if (e.key !== "Escape") return;
    if (openModalStack[openModalStack.length - 1] !== handle) return; // not on top
    e.stopPropagation();
    requestClose();
  };

  closeBtn.addEventListener("click", requestClose);
  backdrop.addEventListener("click", (e) => {
    if (e.target !== backdrop) return;
    if (!dismissible) return;
    requestClose();
  });
  document.addEventListener("keydown", escListener);

  const footerButtonEls = new Map();
  for (const btn of footerButtons) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ${btn.className || ""}`;
    b.textContent = btn.label;
    if (btn.id) b.id = btn.id;
    if (btn.primary) b.dataset.primary = "true";
    b.addEventListener("click", () => {
      // Belt and braces against a double submit: a disabled button should not
      // fire at all, but a stray programmatic click must not slip through.
      if (b.disabled) return;
      if (btn.onClick) btn.onClick({ close, body: bodyEl, modal: modalEl, button: b });
    });
    footerEl.appendChild(b);
    footerButtonEls.set(btn.label, b);
  }

  const handle = {
    close,
    requestClose,
    body: bodyEl,
    modal: modalEl,
    backdrop,
    /** Disables the footer while an async action runs (double-submit guard). */
    setBusy(isBusy, label) {
      footerEl.querySelectorAll("button").forEach((b) => { b.disabled = !!isBusy; });
      const primary = footerEl.querySelector("[data-primary='true']") ||
        footerEl.querySelector(".btn-success, .btn-danger");
      if (!primary) return;
      if (isBusy) {
        if (!primary.dataset.idleLabel) primary.dataset.idleLabel = primary.textContent;
        primary.innerHTML = `<span class="spinner"></span> ${escapeHtml(label || "שומר...")}`;
      } else if (primary.dataset.idleLabel) {
        primary.textContent = primary.dataset.idleLabel;
      }
    }
  };

  openModalStack.push(handle);
  lockBodyScroll();

  return handle;
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
// `inputMode` / `type` let callers ask for the numeric keypad on phones, and
// Enter (the keyboard's "done" key) submits, so the guest-return flow never
// needs the user to dismiss the keyboard just to reach the confirm button.
export function promptDialog({
  title = "הזנת ערך",
  label = "",
  placeholder = "",
  defaultValue = "",
  inputMode = "",
  type = "text",
  hint = ""
}) {
  return new Promise((resolve) => {
    const id = "promptInput_" + Math.random().toString(36).slice(2, 8);
    let settled = false;
    const settle = (value) => {
      if (settled) return false;
      settled = true;
      resolve(value);
      return true;
    };

    const m = openModal({
      title,
      bodyHtml: `
        <label class="field">
          <span>${escapeHtml(label)}</span>
          <input id="${id}" type="${escapeHtml(type)}"
            ${inputMode ? `inputmode="${escapeHtml(inputMode)}"` : ""}
            enterkeyhint="done" autocomplete="off" autocorrect="off" spellcheck="false"
            placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}" />
          ${hint ? `<small class="field-note">${escapeHtml(hint)}</small>` : ""}
        </label>`,
      footerButtons: [
        { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => { settle(null); close(); } },
        {
          label: "אישור", className: "btn-success", primary: true, onClick: ({ close, body }) => {
            const v = body.querySelector(`#${id}`).value.trim();
            settle(v);
            close();
          }
        }
      ],
      onClose: () => settle(null)
    });

    const inp = m.body.querySelector(`#${id}`);
    if (inp) {
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        settle(inp.value.trim());
        m.close();
      });
      // Delay focus so the modal is laid out before the keyboard pushes the
      // viewport around — otherwise mobile Safari scrolls the field off-screen.
      setTimeout(() => {
        inp.focus();
        inp.select();
      }, 120);
    }
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
