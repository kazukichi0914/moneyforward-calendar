import { extractTotalAssetsFromHtml, extractTotalAssetsFromDom } from './src/parse.js';
import { findDailyEvent, createDailyEvent, localDate, formatTitle, HttpError } from './src/calendar.js';

const CALENDAR_ID = 'g3qppsm17ck4e8tqrik1f497k0@group.calendar.google.com';
const MF_URL = 'https://moneyforward.com/';
const RETRY_ALARM = 'retry';
const MAX_RETRIES = 3;
const LOGIN_NOTIFICATION = 'mf-login';

let running = false;

chrome.runtime.onStartup.addListener(() => run({ manual: false }));
chrome.action.onClicked.addListener(() => run({ manual: true }));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) run({ manual: false, isRetry: true });
});

chrome.notifications.onClicked.addListener((id) => {
  if (id === LOGIN_NOTIFICATION) chrome.tabs.create({ url: MF_URL });
  chrome.notifications.clear(id);
});

async function run({ manual, isRetry = false }) {
  if (running) {
    if (manual) report('running', '処理中です', '前回の処理がまだ終わっていません。Google の認証画面が開いたままになっていないか確認してください。');
    return;
  }
  running = true;
  setBadge('running', '総資産を記録しています…');
  try {
    if (!isRetry) await chrome.storage.session.set({ retryCount: 0 });
    const today = localDate();

    const { lastRecordedDate } = await chrome.storage.local.get('lastRecordedDate');
    if (lastRecordedDate === today) {
      report('done', '今日の総資産は記録済みです', '同じ日の予定は追加しません。', '', manual);
      return;
    }

    const existing = await withToken((token) => findDailyEvent(fetch, token, CALENDAR_ID, today));
    if (existing) {
      await chrome.storage.local.set({ lastRecordedDate: today });
      report('done', '今日の総資産は記録済みです', '同じ日の予定は追加しません。', '', manual);
      return;
    }

    const amount = await readTotalAssets();
    if (amount === null) {
      report('error', 'MoneyForward から総資産を読み取れませんでした',
        'MoneyForward ME にログインしてから、拡張のアイコンをクリックしてください。（ここをクリックで開きます）',
        LOGIN_NOTIFICATION);
      return;
    }

    await withToken((token) => createDailyEvent(fetch, token, CALENDAR_ID, today, amount));
    await chrome.storage.local.set({ lastRecordedDate: today });
    report('done', '総資産をカレンダーに記録しました', `${today}  ${formatTitle(amount)}`);
  } catch (err) {
    console.error(err);
    if (!manual && isNetworkError(err) && (await scheduleRetry())) {
      setBadge('running', 'ネットワークにつながらないため、1分後にやり直します');
      return;
    }
    report('error', '総資産の記録に失敗しました', String(err && err.message || err));
  } finally {
    running = false;
  }
}

/** 認証トークンを取って fn を呼ぶ。トークン切れ（401）のときは一度だけ取り直す。 */
async function withToken(fn) {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id || '';
  if (!clientId || clientId.startsWith('YOUR_CLIENT_ID')) {
    throw new Error('manifest.json の oauth2.client_id がまだ設定されていません。README の手順でクライアント ID を作って書き込み、拡張を再読み込みしてください。');
  }
  let token;
  try {
    ({ token } = await chrome.identity.getAuthToken({ interactive: true }));
  } catch (err) {
    throw new Error(`Google の認証に失敗しました（Chrome のログインアカウント: ${await chromeAccount()}）: ${err && err.message || err}`);
  }
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 401)) throw err;
    await chrome.identity.removeCachedAuthToken({ token });
    ({ token } = await chrome.identity.getAuthToken({ interactive: true }));
    return fn(token);
  }
}

/** まず HTML を直接取得して読む。読めなければ裏のタブで開いて DOM から読む。 */
async function readTotalAssets() {
  try {
    const res = await fetch(MF_URL, { credentials: 'include', cache: 'no-store' });
    if (res.ok && new URL(res.url).hostname === 'moneyforward.com') {
      const amount = extractTotalAssetsFromHtml(await res.text());
      if (amount !== null) return amount;
    }
  } catch (err) {
    if (isNetworkError(err)) throw err;
    console.warn('fetch での取得に失敗', err);
  }
  return readTotalAssetsViaTab();
}

async function readTotalAssetsViaTab() {
  const tab = await chrome.tabs.create({ url: MF_URL, active: false });
  try {
    await waitForTabComplete(tab.id, 30000);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractTotalAssetsFromDom,
    });
    return result ? result.result : null;
  } catch (err) {
    // ログアウト中は id.moneyforward.com に飛ばされ、権限が無いため executeScript が失敗する
    console.warn('タブでの取得に失敗', err);
    return null;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('MoneyForward の読み込みがタイムアウトしました'));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function isNetworkError(err) {
  return err instanceof TypeError && /fetch/i.test(err.message);
}

/** 起動直後でネットワークがつながっていない場合に備え、1分後に再試行する。 */
async function scheduleRetry() {
  const { retryCount = 0 } = await chrome.storage.session.get('retryCount');
  if (retryCount >= MAX_RETRIES) return false;
  await chrome.storage.session.set({ retryCount: retryCount + 1 });
  await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 1 });
  return true;
}

/** Chrome のプロファイルにログインしている Google アカウント（認証に使われるアカウント）。 */
async function chromeAccount() {
  try {
    const { email } = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    return email || 'ログインしていません';
  } catch {
    return '不明';
  }
}

const BADGES = {
  running: { text: '…', color: '#6b7280' },
  done: { text: '✓', color: '#16a34a' },
  error: { text: '!', color: '#dc2626' },
};

/** ツールバーのアイコンに状態を表示する。通知がオフでも結果が分かるように、マウスを乗せるとメッセージが出る。 */
function setBadge(kind, message) {
  const b = BADGES[kind];
  chrome.action.setBadgeText({ text: b.text });
  chrome.action.setBadgeBackgroundColor({ color: b.color });
  chrome.action.setTitle({ title: `MoneyForward 総資産カレンダー\n${message}` });
}

/** 結果をアイコン・通知・ストレージに残す。 */
function report(kind, title, message, notificationId = '', withNotification = true) {
  setBadge(kind, `${title}\n${message}`);
  chrome.storage.local.set({ lastResult: { at: new Date().toISOString(), kind, title, message } });
  if (withNotification) notify(title, message, notificationId);
}

function notify(title, message, id = '') {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
  });
}
