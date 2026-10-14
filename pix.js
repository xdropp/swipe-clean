// Swipe Clean — doação por Pix.
// Gera o "Pix Copia e Cola" (BR Code estático, padrão do Banco Central) e o QR Code em SVG,
// tudo localmente, sem internet.

const QRCode = require('./vendor/qrcode');
const QRErrorCorrectLevel = require('./vendor/qrcode/QRErrorCorrectLevel');

// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no campo 63 do BR Code
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const field = (id, value) => id + String(value.length).padStart(2, '0') + value;

// nome e cidade só aceitam letras sem acento, números e espaços
const ascii = (s, max) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, '')
    .trim()
    .slice(0, max);

function brCode({ key, name, city, amount, message }) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Chave Pix vazia');
  let account = field('00', 'br.gov.bcb.pix') + field('01', k);
  const msg = ascii(message, 40);
  if (msg && account.length + msg.length + 4 <= 99) account += field('02', msg);
  let payload =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (amount ? field('54', Number(amount).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', ascii(name, 25) || 'SWIPE CLEAN') +
    field('60', ascii(city, 15) || 'BRASIL') +
    field('62', field('05', '***'));
  payload += '6304';
  return payload + crc16(payload);
}

function qrSVG(text, { margin = 2, dark = '#0e1014', light = '#ffffff' } = {}) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

const svgDataURL = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

module.exports = { brCode, qrSVG, svgDataURL, crc16 };
