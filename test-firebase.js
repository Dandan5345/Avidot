import { initializeApp } from "firebase/app";
import { getDatabase, ref, get } from "firebase/database";

const firebaseConfig = {
  databaseURL: "https://avidot-4a18d-default-rtdb.firebaseio.com",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
get(ref(db, "tests")).then(console.log).catch(console.error);
