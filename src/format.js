// Money formatting (formatters are reused: creating them is slow on a 10 ms CPU budget).
const FMT = new Map();
export function money(amount, cur = 'usd') {
  const c = String(cur || 'usd').toUpperCase();
  let f = FMT.get(c);
  if (f === undefined) {
    try { f = new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }); } catch { f = null; }
    FMT.set(c, f);
  }
  return f ? f.format(amount) : `${Math.round(amount).toLocaleString('en-US')} ${c}`;
}
