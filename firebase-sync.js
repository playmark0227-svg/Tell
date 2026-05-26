// Firebase 認証 + Firestore 同期
// 全ユーザーデータ(store) を user_state/{uid} ドキュメントに JSON で保存する。
// 単純化のため store 全体を 1ドキュメントで管理(Firestoreの1MB制限内に収まる想定)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const cfg = window.FIREBASE_CONFIG;
if (!cfg || /PLACEHOLDER/.test(cfg.apiKey || '')) {
  console.warn('[firebase] firebase-config.js 未設定。ローカルモードで起動します。');
  window.FIREBASE_READY = false;
} else {
  try {
    const app = initializeApp(cfg);
    const auth = getAuth(app);
    const db = getFirestore(app);

    window.FIREBASE_READY = true;
    window.firebaseApi = {
      auth, db,
      onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb),
      signIn: (email, pass) => signInWithEmailAndPassword(auth, email, pass),
      signUp: (email, pass) => createUserWithEmailAndPassword(auth, email, pass),
      signOut: () => signOut(auth),
      resetPassword: (email) => sendPasswordResetEmail(auth, email),
      loadUserState: async (uid) => {
        const snap = await getDoc(doc(db, 'user_state', uid));
        return snap.exists() ? snap.data() : null;
      },
      saveUserState: async (uid, data) => {
        await setDoc(doc(db, 'user_state', uid), {
          ...data,
          _updatedAt: serverTimestamp(),
        }, { merge: false });
      },
    };
    // 起動完了通知 (app.js が listen している)
    window.dispatchEvent(new CustomEvent('firebase-ready'));
  } catch (e) {
    console.error('[firebase] init failed', e);
    window.FIREBASE_READY = false;
  }
}
