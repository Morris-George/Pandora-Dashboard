// The real clock of Cairo. Egypt is UTC+2 in winter and UTC+3 in summer, so a fixed "+3 hours" gives tomorrow's date
// during the last hour of every winter day (and "+2" gives yesterday's during the first hour of every summer day).
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// a Date whose UTC fields (getUTCFullYear, getUTCHours, toISOString ...) read as Cairo local time
function cairoNow(ms) {
  const t = ms === undefined ? Date.now() : Number(ms);
  try {
    const p = {}; for (const x of fmt.formatToParts(new Date(t))) p[x.type] = Number(x.value);
    return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second, new Date(t).getUTCMilliseconds()));
  } catch (_) { return new Date(t + 2 * 3600 * 1000); }
}
const cairoToday = () => cairoNow().toISOString().slice(0, 10);
// the date n months before today; 31 August minus 6 months is 28 February, not 3 March
function monthsAgo(n) {
  const now = cairoNow(), first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(now.getUTCDate(), last));
  return first.toISOString().slice(0, 10);
}
module.exports = { cairoNow, cairoToday, monthsAgo };
