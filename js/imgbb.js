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
  const fileInput = rootEl.querySelector('input[type="file"]');
  const statusEl = rootEl.querySelector(".upload-status");
  const previewEl = rootEl.querySelector(".upload-preview");

  let uploadPromise = null;
  let uploadedUrl = null;

  fileInput.addEventListener("change", () => {
    uploadedUrl = null;
    uploadPromise = null;
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      statusEl.textContent = "";
      statusEl.className = "upload-status";
      previewEl.style.display = "none";
      previewEl.src = "";
      return;
    }
    // local preview
    const reader = new FileReader();
    reader.onload = () => {
      previewEl.src = reader.result;
      previewEl.style.display = "inline-block";
    };
    reader.readAsDataURL(file);

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
    <label class="field full">
      <span>${label}</span>
      <div class="upload-row">
        <input type="file" accept="image/*" />
        <img class="upload-preview" alt="" style="display:none" />
        <span class="upload-status"></span>
      </div>
    </label>`;
}
