const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);
const CHANNEL_SECRET = process.env.CHANNEL_SECRET || '';
const CHANNEL_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || '';

let messageStore = [];
let replyQueue = []; 

function verifySignature(body, signature) {
  if (!CHANNEL_SECRET || !signature) return true;
  const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64');
  return hash === signature;
}

async function sendReply(replyToken, text) {
  if (!CHANNEL_TOKEN) return console.log('No token configured');
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST', headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CHANNEL_TOKEN,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
    console.log('Reply sent:', res.status);
  } catch (err) { console.error('Send error:', err.message); }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Line-Signature');
  
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const signature = req.headers['x-line-signature'];
      if (!verifySignature(body, signature)) return res.writeHead(400).end('Invalid sig');

      let data; try { data = JSON.parse(body); } catch(e) { return res.writeHead(400).end('Bad json'); }
      const events = data.events || []; let newMessages = [];

      for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
          messageStore.push({ timestamp: new Date().toISOString(), replyToken: event.replyToken, userId: event.source?.userId, text: event.message.text, status: 'pending' });
          newMessages.push(event.message.text);
        } else if (event.type === 'postback') {
          messageStore.push({ timestamp: new Date().toISOString(), replyToken: event.replyToken, text: event.data.postbackData || '[Postback]', status: 'pending' });
          newMessages.push('[Postback]');
        }
      }
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ received: true, messages: newMessages }));
    });
    return;
  }

  if (req.url === '/health') { res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ status: 'ok' })); return; }
  
  if (req.url === '/') {
    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>Codex LINE Bot</title></head>
<body style="font-family:sans-serif;text-align:center;margin-top:50px;">
<h1>🤖 Codex LINE Bot Online</h1><p>Status: <span style="color:green">Active ✅</span></p>
<a href="/webhook" target="_blank">Test Webhook</a> | <a href="/health" target="_blank">Health Check</a>
</body></html>`;
    res.writeHead(200, {'Content-Type': 'text/html'}).end(html); return;
  }
  res.writeHead(404).end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => console.log(`✅ Codex LINE Bot running on port ${PORT}`));
