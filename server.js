const http = require('http');
const crypto = require('crypto');

// ===== 組態 =====
const PORT = parseInt(process.env.PORT || process.env.LISTEN_PORT || '8080', 10);
const CHANNEL_SECRET = process.env.CHANNEL_SECRET || '';
const CHANNEL_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || '';

// ===== 訊息儲存（記憶體版）=====
let messageStore = [];
let replyQueue = []; 

// ===== 簽章驗證 =====
function verifySignature(body, signature) {
  if (!CHANNEL_SECRET || !signature) return true;
  const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64');
  return hash === signature;
}

// ===== 發送回覆給 LINE =====
async function sendReply(replyToken, text) {
  if (!CHANNEL_TOKEN) return;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CHANNEL_TOKEN,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
    console.log('LINE Reply result:', res.status);
  } catch (err) {
    console.error('Failed to send LINE reply:', err.message);
  }
}

// ===== HTTP Server =====
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Line-Signature');
  
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ===== Webhook endpoint =====
  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const signature = req.headers['x-line-signature'];
      
      if (!verifySignature(body, signature)) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({ error: 'Invalid signature' }));
      }

      let data;
      try { data = JSON.parse(body); } catch(e) {
        return res.writeHead(400).end('Bad Request');
      }

      const events = data.events || [];
      let newMessages = [];

      for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
          const msg = { timestamp: new Date().toISOString(), replyToken: event.replyToken, userId: event.source?.userId, text: event.message.text, status: 'pending' };
          messageStore.push(msg);
          newMessages.push(msg);
        } else if (event.type === 'postback') {
          const msg = { timestamp: new Date().toISOString(), replyToken: event.replyToken, text: event.data.postbackData || event.data.params?.text || '[Postback]', status: 'pending' };
          messageStore.push(msg);
          newMessages.push(msg);
        }
      }

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ received: true, messages: newMessages }));
    });
    return;
  }

  // ===== REST API =====
  if (req.url.startsWith('/api/messages') && req.method === 'GET') {
    const pending = messageStore.filter(m => m.status === 'pending');
    res.writeHead(200, {'Content-Type': 'application/json'});
    return res.end(JSON.stringify({ messages: pending, count: pending.length }));
  }

  if (req.url === '/api/conversation' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    return res.end(JSON.stringify({ messages: messageStore, total: messageStore.length }));
  }

  if (req.url === '/api/reply' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const data = JSON.parse(body);
      replyQueue.push({ replyToken: data.replyToken, text: data.text });
      sendReply(data.replyToken, data.text).catch(err => console.error('Send reply error:', err));
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({ received: true }));
    });
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    return res.end(JSON.stringify({ status: 'ok', pending: messageStore.filter(m => m.status === 'pending').length }));
  }

  // ===== Default =====
  if (req.url === '/' && req.method === 'GET') {
    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>Codex LINE Bot</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:0 20px;}h1{color:#037D49;}button{padding:8px 16px;margin:5px;background:#037D49;color:white;border:none;border-radius:4px;cursor:pointer;}.msg{background:#f0f0f0;padding:10px;margin:5px 0;border-radius:4px;}#messages{max-height:400px;overflow:auto;}</style></head>
<body><h1>🤖 Codex LINE Bot</h1>
<div><button onclick="checkStatus()">刷新狀態</button> <span id="statusText"></span></div>
<h2>訊息歷史</h2><div id="messages"></div>
<script>const checkStatus=async()=>{try{const r=await fetch('/health');const d=await r.json();document.getElementById('statusText').textContent='待處理：'+d.pending+'則';}catch(e){}};
const loadMessages=async()=>{try{const r=await fetch('/api/conversation');const d=await r.json();document.getElementById('messages').innerHTML=d.messages.map(m=>'<div class="msg">'+m.timestamp+'<br/><b>'+m.text+'</b>('+m.status+')</div>').join('');}catch(e){}};
setInterval(checkStatus,3000);setInterval(loadMessages,5000);checkStatus();loadMessages();</script></body></html>`;
    res.writeHead(200, {'Content-Type': 'text/html'});
    return res.end(html);
  }

  res.writeHead(404).end(JSON.stringify({ error: 'Not Found' }));
});

// ===== 啟動 =====
server.listen(PORT, () => {
  console.log('========================================');
  console.log(`Codex LINE Bot running on port ${PORT}`);
  console.log(`Webhook URL: https://codex-line-bot-production.up.railway.app/webhook`);
  console.log('========================================');
});
