type ServiceLine = { nameEn: string; nameAr: string; price: number }

export type ReceiptData = {
  id: string
  createdAt: Date
  slot: Date
  paymentMethod: string
  totalPrice: number
  depositPaid: number
  barberName: string | null
  shop: { nameEn: string; nameAr: string; address: string }
  services: ServiceLine[]
}

function fmtPrice(n: number) {
  return new Intl.NumberFormat('en').format(n) + ' IQD'
}

function fmtDate(d: Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baghdad',
  }).format(d)
}

export function generateReceiptHtml(b: ReceiptData): string {
  const serviceRows = b.services
    .map(s => `<tr><td>${s.nameEn} / ${s.nameAr}</td><td class="right">${fmtPrice(s.price)}</td></tr>`)
    .join('\n')

  const remaining = b.totalPrice - b.depositPaid
  const method = b.paymentMethod.charAt(0) + b.paymentMethod.slice(1).toLowerCase()

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BarberOS Receipt #${b.id.slice(-8).toUpperCase()}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f4f4f5;min-height:100vh;padding:24px 16px;color:#18181b}
  .card{max-width:460px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .header{background:#16a34a;padding:24px 20px;color:#fff}
  .header h1{font-size:18px;font-weight:700}
  .header p{font-size:11px;opacity:.75;margin-top:4px}
  .section{padding:14px 20px;border-bottom:1px solid #f4f4f5}
  .label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa;margin-bottom:3px}
  .value{font-size:14px;font-weight:500}
  .sub{font-size:12px;color:#71717a;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td{padding:7px 0;border-bottom:1px solid #f4f4f5}
  .right{text-align:right}
  .totals td{padding:8px 0;font-size:14px;border:none}
  .accent{color:#16a34a;font-weight:700}
  .bold{font-weight:700}
  .footer{padding:14px 20px;text-align:center;font-size:11px;color:#a1a1aa}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>BarberOS — Booking Receipt</h1>
    <p>#${b.id.slice(-8).toUpperCase()} &nbsp;·&nbsp; ${new Date(b.createdAt).toLocaleDateString('en-US')}</p>
  </div>
  <div class="section">
    <div class="label">Shop</div>
    <div class="value">${b.shop.nameEn}</div>
    <div class="sub">${b.shop.nameAr} · ${b.shop.address}</div>
  </div>
  <div class="section">
    <div class="label">Appointment</div>
    <div class="value">${fmtDate(new Date(b.slot))}</div>
    ${b.barberName ? `<div class="sub">Barber: ${b.barberName}</div>` : ''}
  </div>
  <div class="section">
    <div class="label">Services</div>
    <table><tbody>${serviceRows}</tbody></table>
  </div>
  <div class="section">
    <table class="totals"><tbody>
      <tr><td>Total</td><td class="right">${fmtPrice(b.totalPrice)}</td></tr>
      <tr class="accent"><td>Deposit Paid</td><td class="right">${fmtPrice(b.depositPaid)}</td></tr>
      <tr class="bold"><td>Remaining at Shop</td><td class="right">${fmtPrice(remaining)}</td></tr>
    </tbody></table>
  </div>
  <div class="section">
    <div class="label">Payment Method</div>
    <div class="value">${method}</div>
  </div>
  <div class="footer">BarberOS · This is your official booking confirmation receipt</div>
</div>
</body>
</html>`
}
