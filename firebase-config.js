// Firebase 設定ファイル
// Firebase Console → プロジェクトの設定 → マイアプリ で取得した値をここに貼り付け
// このファイルは公開されてOK(公開鍵相当)。実際のアクセス制御は Firebase Security Rules で行う。

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyXXXXX_PLACEHOLDER_XXXXX",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abcdefghijklmnop",
};

// 管理者メールアドレス(課金設定パネルが表示される)
// 複数指定可
window.ADMIN_EMAILS = [
  "playmark0227@gmail.com",
];

// デフォルト課金設定(管理者がUIから変更可)
window.DEFAULT_BILLING_CONFIG = {
  baseMonthly: 50000,      // 月額基本料金 (円)
  perSearch: 0.5,          // Web検索 単価/1クエリ
  perAiEvaluation: 2.0,    // AI評価 単価/1社
  perHpFetch: 0.1,         // HP取得 単価/1URL
  monthlyCap: 0,           // 月額利用上限 (0=無制限)
  hardCap: true,           // 上限到達で検索停止するか
};
