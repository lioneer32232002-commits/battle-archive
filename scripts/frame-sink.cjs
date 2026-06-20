// 一次性除錯用:接收瀏覽器 POST 過來的 canvas dataURL,解碼寫成圖檔。
// 用法:node scripts/frame-sink.cjs  → 監聽 7799;瀏覽器 fetch POST dataURL。
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const name = (req.url || '/frame').replace(/[^a-z0-9_.-]/gi, '') || 'frame';
      const b64 = body.includes(',') ? body.split(',')[1] : body;
      const buf = Buffer.from(b64, 'base64');
      const file = path.join(OUT_DIR, name.endsWith('.jpg') ? name : name + '.jpg');
      fs.writeFileSync(file, buf);
      console.log('WROTE', file, buf.length, 'bytes');
      res.writeHead(200); res.end('saved ' + buf.length);
    } catch (e) {
      console.log('ERR', e.message);
      res.writeHead(500); res.end('err');
    }
  });
}).listen(7799, () => console.log('frame-sink listening on http://localhost:7799'));
