// Google Calendar API v3 の呼び出し。
// 予定には extendedProperties.private.mfTotalAssetsDate = "YYYY-MM-DD" を付け、
// これで「その日の記録が既にあるか」を判定する（タイトルを手で変えても重複しない）。

const API = 'https://www.googleapis.com/calendar/v3';
export const PROP_KEY = 'mfTotalAssetsDate';

export class HttpError extends Error {
  constructor(status, body) {
    super(`Calendar API エラー (HTTP ${status}): ${body.slice(0, 300)}`);
    this.status = status;
  }
}

async function call(fetchFn, token, url, init = {}) {
  const res = await fetchFn(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  return res.json();
}

/** "YYYY-MM-DD" の翌日を返す。 */
export function nextDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/** 端末のローカル時刻での今日を "YYYY-MM-DD" で返す。 */
export function localDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function formatTitle(amount) {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/** その日の記録（この拡張が作った予定）が既にあれば、その予定を返す。 */
export async function findDailyEvent(fetchFn, token, calendarId, date) {
  const params = new URLSearchParams({
    privateExtendedProperty: `${PROP_KEY}=${date}`,
    showDeleted: 'false',
    maxResults: '5',
  });
  const data = await call(fetchFn, token, `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  return (data.items || []).find((e) => e.status !== 'cancelled') || null;
}

/** 当日の終日予定を作る。 */
export async function createDailyEvent(fetchFn, token, calendarId, date, amount) {
  const body = {
    summary: formatTitle(amount),
    start: { date },
    end: { date: nextDate(date) },
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { [PROP_KEY]: date } },
  };
  return call(fetchFn, token, `${API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
