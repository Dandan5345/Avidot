// Firebase initialization (Firestore + Auth)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCnDspKbDjH50B9mIFlOfGnHFpNCT4ux20",
  authDomain: "avidot-4a18d.firebaseapp.com",
  projectId: "avidot-4a18d",
  storageBucket: "avidot-4a18d.firebasestorage.app",
  messagingSenderId: "1084515945555",
  appId: "1:1084515945555:web:9ba95fe805290c9692caa6",
  measurementId: "G-T6ETZ7ZTDW"
};

// Primary app
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

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
