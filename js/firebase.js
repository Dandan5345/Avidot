// Firebase initialization (Realtime Database + Auth)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCnDspKbDjH50B9mIFlOfGnHFpNCT4ux20",
  authDomain: "avidot-4a18d.firebaseapp.com",
  databaseURL: "https://avidot-4a18d-default-rtdb.firebaseio.com",
  projectId: "avidot-4a18d",
  storageBucket: "avidot-4a18d.firebasestorage.app",
  messagingSenderId: "1084515945555",
  appId: "1:1084515945555:web:425c84b844985d6a92caa6",
  measurementId: "G-6W49NJ9Q16"
};

// Primary app
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Secondary app instance — used when admins create new users so the
// admin's session is not replaced by the newly-created user.
export const secondaryApp = initializeApp(firebaseConfig, "secondary");
export const secondaryAuth = getAuth(secondaryApp);

// Hard-coded super-admin email. This account always has admin privileges,
// cannot be deleted, and bypasses all database permission checks in the UI.
// The same email is enforced server-side by database.rules.json.
export const SUPER_ADMIN_EMAIL = "Doronenakache@gmail.com";

// ImgBB API key for image uploads.
export const IMGBB_API_KEY = "20208d6daf1f48791209299a5fe61cd1";

export const isSuperAdminEmail = (email) =>
  !!email && email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
