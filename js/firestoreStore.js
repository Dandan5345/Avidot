import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    runTransaction,
    setDoc,
    updateDoc,
    writeBatch,
    where
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";

function withId(snapshot) {
    return { id: snapshot.id, ...snapshot.data() };
}

export function subscribeCollection(collectionName, onData, onError) {
    return onSnapshot(
        collection(db, collectionName),
        (snapshot) => onData(snapshot.docs.map(withId)),
        onError
    );
}

export async function fetchCollection(collectionName) {
    const snapshot = await getDocs(collection(db, collectionName));
    return snapshot.docs.map(withId);
}

export async function getDocument(collectionName, id) {
    const snapshot = await getDoc(doc(db, collectionName, id));
    return snapshot.exists() ? withId(snapshot) : null;
}

export async function createDocument(collectionName, data, id = null) {
    if (id) {
        await setDoc(doc(db, collectionName, id), data);
        return id;
    }

    const created = await addDoc(collection(db, collectionName), data);
    return created.id;
}

export async function setDocument(collectionName, id, data, { merge = false } = {}) {
    if (merge) {
        await setDoc(doc(db, collectionName, id), data, { merge: true });
        return;
    }

    await setDoc(doc(db, collectionName, id), data);
}

export async function updateDocument(collectionName, id, patch) {
    await updateDoc(doc(db, collectionName, id), patch);
}

export async function deleteDocument(collectionName, id) {
    await deleteDoc(doc(db, collectionName, id));
}

export async function deleteDocumentsBatch(collectionName, ids) {
    const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
    if (!uniqueIds.length) return;

    const batch = writeBatch(db);
    uniqueIds.forEach((id) => {
        batch.delete(doc(db, collectionName, id));
    });
    await batch.commit();
}

export async function findDocumentsByField(collectionName, fieldName, value) {
    const snapshot = await getDocs(
        query(collection(db, collectionName), where(fieldName, "==", value))
    );
    return snapshot.docs.map(withId);
}

export async function nextCounterValue(counterName) {
    const counterRef = doc(db, "counters", counterName);
    return runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(counterRef);
        const currentValue = snapshot.exists() ? Number(snapshot.data().value) || 0 : 0;
        const nextValue = currentValue + 1;
        transaction.set(counterRef, { value: nextValue }, { merge: true });
        return nextValue;
    });
}

export async function setCounterValue(counterName, value) {
    await setDoc(doc(db, "counters", counterName), { value: value || 0 }, { merge: true });
}