# MoneyForward 総資産カレンダー（Chrome 拡張）

Chrome を起動すると、MoneyForward ME（https://moneyforward.com/ ）の **総資産** を読み取り、
Google カレンダー `g3qppsm17ck4e8tqrik1f497k0@group.calendar.google.com` に
**当日の終日予定「¥12,345,678」** を作ります。

- 1日1件だけ作ります。同じ日に何度起動しても、2回目以降は何もしません。
  （予定に拡張専用の目印を付けているため、タイトルを手で書き換えても重複しません）
- MoneyForward には、**Chrome でログイン済みのセッション** を使ってアクセスします。
  拡張がパスワードを入力したり保存したりすることはありません。
- 拡張のアイコンをクリックすると、その場で同じ処理を実行します（ログインし直した後など）。
- 結果（成功／記録済み／失敗）はデスクトップ通知でお知らせします。

## 動作の流れ

1. `chrome.runtime.onStartup`（Chrome の起動時）に処理を始めます。
2. 今日の予定が既にカレンダーにあれば、何もせずに終わります。
3. `https://moneyforward.com/` の HTML を取得し、総資産の欄
   （`section#user-info section.total-assets .heading-radius-box`）から金額を読み取ります。
   取得できなければ、裏で非アクティブなタブを開いて DOM から読み、読み終わったらタブを閉じます。
4. Google Calendar API で終日予定を作ります。
5. 起動直後でネットワークにつながっていない場合は、1分おきに最大3回やり直します。
6. MoneyForward からログアウトしている場合は「ログインしてください」と通知します。
   通知をクリックすると MoneyForward が開くので、ログインしてから拡張のアイコンをクリックしてください。

## セットアップ

Google Cloud 側の設定は済んでいて、`manifest.json` にクライアント ID も設定してあります。

| 項目 | 値 |
| --- | --- |
| Google Cloud プロジェクト | `mf-calendar`（ID: `mf-calendar-511912`） |
| 有効にした API | Google Calendar API |
| OAuth 同意画面 | アプリ名 `MF Calendar`、ユーザーの種類「外部」、公開ステータス「テスト中」、テストユーザー 1 名 |
| OAuth クライアント | 種類「Chrome 拡張機能」、名前 `MF Calendar Extension` |
| 拡張機能 ID | `jcgldbnllmgcolmnincefblbibnifigg`（`manifest.json` の `key` で固定） |

拡張機能 ID は `manifest.json` の `key` で固定してあるので、フォルダを移動しても変わりません。

### 1. 拡張を読み込む

1. Chrome で `chrome://extensions` を開き、右上の **デベロッパー モード** をオンにします。
2. **パッケージ化されていない拡張機能を読み込む** をクリックし、このフォルダ
   （`moneyforwardカレンダー`）を選びます。
   以前に読み込んだことがある場合は、古いものを **削除** してから読み込み直してください
   （ID が変わったため、古いものは別の拡張として残ります）。
3. ID が `jcgldbnllmgcolmnincefblbibnifigg` になっていることを確認します。

### 2. 初回の認証

拡張のアイコン（ツールバーのパズルアイコンからピン留めできます）をクリックします。
Google のアカウント選択と権限の確認画面が出るので、テストユーザーとして登録したアカウントで許可してください。
「このアプリは Google で確認されていません」と表示された場合は、**続行**（または **詳細 → MF Calendar に移動**）で進めます。

認証が済むと、総資産が今日の予定として書き込まれます。次回からは、Chrome の起動時に自動で実行されます。

### 参考: クライアント ID を作り直す場合

1. https://console.cloud.google.com/ で、プロジェクトを選びます（または新しく作ります）。
2. **API とサービス → ライブラリ** で「Google Calendar API」を **有効にする**。
3. **Google Auth Platform**（OAuth 同意画面）で、アプリ名・サポートメール・ユーザーの種類「外部」・連絡先を入力して作成します。
   **対象 → テストユーザー** に、Chrome にログインしている Google アカウントを追加します。
4. **Google Auth Platform → クライアント → クライアントを作成** で、種類「Chrome 拡張機能」、
   アイテム ID に `jcgldbnllmgcolmnincefblbibnifigg` を入れて作成します。
5. 表示されたクライアント ID を、`manifest.json` の `oauth2.client_id` に書き込み、拡張を再読み込みします。

## 注意点

- **Chrome にログインしている Google アカウント** で認証します。そのアカウントが、
  対象のカレンダーの「予定の変更」以上の権限を持っている必要があります。
- OAuth 同意画面が **テスト** 状態のままだと、Google の仕様で認証がおよそ7日で切れ、
  そのたびに確認画面が出ることがあります。気になる場合は、同意画面の **公開ステータス** を
  「本番環境」にしてください（個人利用であれば Google の審査は不要です。未確認アプリの警告は表示されます）。
- `onStartup` は **Chrome を完全に終了してから起動したとき** に動きます。ウィンドウを閉じただけで
  Chrome がバックグラウンドで動き続けている場合は動きません。その場合はアイコンをクリックしてください。
- MoneyForward の画面のデザインが変わると、総資産を読み取れなくなることがあります。
  その場合は `src/parse.js` のセレクタと正規表現を直してください（2026年10月時点の画面で確認済み）。
- 「今日」は、パソコンのタイムゾーンでの日付です。

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `manifest.json` | 拡張の設定（Manifest V3）。拡張機能 ID を固定する `key` と、OAuth のクライアント ID を含みます |
| `background.js` | Service Worker。起動時の処理、認証、通知、再試行 |
| `src/parse.js` | MoneyForward のページから総資産を読み取る処理 |
| `src/calendar.js` | Google Calendar API の呼び出し（予定の検索と作成） |
| `icons/icon128.png` | アイコン |
| `test/` | 単体テスト（`node --test test/*.test.js`。Node.js 18 以上、追加のパッケージは不要） |
