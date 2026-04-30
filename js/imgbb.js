// ImgBB image upload helper. Uploads a File and returns the hosted URL.
import { IMGBB_API_KEY } from "./firebase.js";

const ENDPOINT = "https://api.imgbb.com/1/upload";

/**
 * Upload a File or Blob to ImgBB. Returns the public URL on success.
 * @param {File|Blob} file
 * @returns {Promise<string>} hosted image URL
 */
export async function uploadImageToImgBB(file) {
  if (!file) throw new Error("לא נבחר קובץ תמונה");
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("יש להעלות קובץ תמונה בלבד");
  }
  // Limit ~ 32MB for ImgBB; warn on very large
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("קובץ התמונה גדול מדי (מעל 25MB)");
  }

  const form = new FormData();
  form.append("key", IMGBB_API_KEY);
  form.append("image", file);

  const res = await fetch(ENDPOINT, { method: "POST", body: form });
  if (!res.ok) throw new Error(`שגיאה בהעלאה לשרת התמונות (${res.status})`);
  const data = await res.json();
  if (!data || !data.success || !data.data || !data.data.url) {
    throw new Error("שגיאה בהעלאת התמונה");
  }
  return data.data.url;
}

/**
 * Wires up an image-upload UI:
 *   <input type="file" id="..."> + status span + preview img
 * Returns a getter that resolves to the URL (uploads on demand) so we can
 * defer the upload until the parent form is actually submitted.
 *
 * The control DOES start the async upload as soon as the user picks a file
 * and shows a loading state; subsequent calls to getUrl() await it.
 */
export function attachImageUpload(rootEl) {
  const fileInput = rootEl.querySelector(".upload-input");
  const statusEl = rootEl.querySelector(".upload-status");
  const previewEl = rootEl.querySelector(".upload-preview");
  const emptyEl = rootEl.querySelector(".upload-empty");
  const fileNameEl = rootEl.querySelector(".upload-file-name");
  const clearBtn = rootEl.querySelector(".upload-clear");
  const sourceButtons = rootEl.querySelectorAll("[data-upload-source]");

  let uploadPromise = null;
  let uploadedUrl = null;
  let localPreviewUrl = null;

  function resetUi() {
    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
      localPreviewUrl = null;
    }
    fileInput.value = "";
    previewEl.style.display = "none";
    previewEl.src = "";
    emptyEl.classList.remove("hidden");
    fileNameEl.textContent = "לא נבחרה תמונה";
    statusEl.textContent = "";
    statusEl.className = "upload-status";
    clearBtn.classList.add("hidden");
    uploadedUrl = null;
    uploadPromise = null;
  }

  function formatFileSize(size) {
    if (!Number.isFinite(size) || size <= 0) return "";
    if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
    return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  }

  sourceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const source = button.getAttribute("data-upload-source");
      if (source === "camera") fileInput.setAttribute("capture", "environment");
      else fileInput.removeAttribute("capture");
      fileInput.click();
    });
  });

  clearBtn.addEventListener("click", () => {
    resetUi();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      resetUi();
      return;
    }

    uploadedUrl = null;
    uploadPromise = null;
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    localPreviewUrl = URL.createObjectURL(file);
    previewEl.src = localPreviewUrl;
    previewEl.style.display = "block";
    emptyEl.classList.add("hidden");
    fileNameEl.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    clearBtn.classList.remove("hidden");

    statusEl.innerHTML = `<span class="spinner"></span> מעלה תמונה...`;
    statusEl.className = "upload-status";
    uploadPromise = uploadImageToImgBB(file).then(
      (url) => {
        uploadedUrl = url;
        statusEl.textContent = "התמונה הועלתה בהצלחה";
        statusEl.className = "upload-status ok";
        return url;
      },
      (err) => {
        statusEl.textContent = err.message || "שגיאה בהעלאה";
        statusEl.className = "upload-status error";
        uploadPromise = null;
        throw err;
      }
    );
  });

  return {
    /** Awaits the in-flight upload (if any) and returns the URL or null. */
    async getUrl() {
      if (uploadedUrl) return uploadedUrl;
      if (uploadPromise) return await uploadPromise;
      return null;
    },
    isUploading() {
      return !!uploadPromise && !uploadedUrl;
    }
  };
}

/** Returns HTML for an image-upload control. */
export function imageUploadFieldHtml(label = "תמונה (אופציונלי)") {
  return `
    <label class="field full upload-field">
      <span>${label}</span>
      <div class="upload-card">
        <div class="upload-card-header">
          <div class="upload-card-copy">
            <span class="upload-chip">צילום מהיר</span>
            <strong>הוסף תמונה בדרך שנוחה לך</strong>
            <small>אפשר לצלם במקום או לבחור קובץ קיים מהטלפון, בלי לצאת מהטופס.</small>
          </div>
        </div>
        <input class="upload-input hidden" type="file" accept="image/*" />
        <div class="upload-source-actions">
          <button type="button" class="upload-choice primary" data-upload-source="camera">
            <strong>צלם עכשיו</strong>
            <small>פתיחת מצלמה ישירות מהמכשיר</small>
          </button>
          <button type="button" class="upload-choice" data-upload-source="gallery">
            <strong>בחר מהגלריה</strong>
            <small>בחירת תמונה קיימת מהטלפון או המחשב</small>
          </button>
        </div>
        <div class="upload-preview-wrap">
          <div class="upload-preview-glow"></div>
          <div class="upload-empty">
            <strong>עדיין לא נבחרה תמונה</strong>
            <span>אפשר לצלם במקום או לבחור תמונה קיימת.</span>
          </div>
          <img class="upload-preview" alt="תצוגה מקדימה של התמונה שנבחרה" />
        </div>
        <div class="upload-meta">
          <span class="upload-file-name">לא נבחרה תמונה</span>
          <button type="button" class="upload-clear hidden">נקה</button>
        </div>
        <span class="upload-status"></span>
      </div>
    </label>`;
}
