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
  getFirestore, doc, getDoc, setDoc, getDocs, collection,
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
          _email: (auth.currentUser && auth.currentUser.email) || data._email || '',
        }, { merge: false });
      },
      // 管理者用: 全ユーザーの user_state を一括取得
      // 注: Firestore Rules で admin email を allow する必要あり
      listAllUserStates: async () => {
        const snap = await getDocs(collection(db, 'user_state'));
        const arr = [];
        snap.forEach(d => arr.push({ uid: d.id, ...d.data() }));
        return arr;
      },
    };
    // 起動完了通知 (app.js が listen している)
    window.dispatchEvent(new CustomEvent('firebase-ready'));
  } catch (e) {
    console.error('[firebase] init failed', e);
    window.FIREBASE_READY = false;
  }
}
