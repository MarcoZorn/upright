// Tiny local server that receives JPEG frames from the viewer (POST /frame/N) and writes them to tmp/frames.
//   node tools/framesink.mjs   then in the page: upright.recordTo('http://127.0.0.1:8766', {seconds: 8})
import http from 'node:http';
import fs from 'node:fs';
const dir = 'tmp/frames';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method !== 'POST') return res.end('ok');
  const chunks = [];
  req.on('data', (c) => chunks.push(c)).on('end', () => {
    const n = req.url.split('/').pop().padStart(5, '0');
    fs.writeFileSync(`${dir}/${n}.jpg`, Buffer.concat(chunks));
    res.end('ok');
  });
}).listen(8766, '127.0.0.1', () => console.log('frame sink on :8766'));
