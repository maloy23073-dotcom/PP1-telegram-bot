// webapp/app.js
const SIGNALING_WS = (window.SIGNALING_WS_URL || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

let socket = null;
let localStream = null;
let pcs = {}; // peer_id -> RTCPeerConnection
let clientId = Math.random().toString(36).substring(2,9);
let roomCode = null;
let timerInterval = null;
let startTime = null;

// DOM elements
const welcomePage = document.getElementById('welcomePage');
const callPage = document.getElementById('callPage');
const codeInput = document.getElementById('code');
const joinBtn = document.getElementById('joinBtn');
const createCallBtn = document.getElementById('createCallBtn');
const backBtn = document.getElementById('backBtn');
const currentCodeSpan = document.getElementById('currentCode');
const status = document.getElementById('status');
const localVideo = document.getElementById('localVideo');
const remotes = document.getElementById('remotes');
const toggleMic = document.getElementById('toggleMic');
const toggleCam = document.getElementById('toggleCam');
const leaveBtn = document.getElementById('leaveBtn');
const timerEl = document.getElementById('timer');

// Page navigation
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
}

// Show status message
function showStatus(message, type = "info") {
  status.textContent = message;
  status.className = "connection-status";

  if (type === "error") {
    status.style.background = "var(--tg-danger)";
  } else if (type === "success") {
    status.style.background = "var(--tg-success)";
  } else {
    status.style.background = "rgba(0, 0, 0, 0.7)";
  }

  // Auto-hide info messages after 3 seconds
  if (type === "info") {
    setTimeout(() => {
      status.textContent = "";
    }, 3000);
  }
}

// Initialize
function init() {
  // Try to prefill code from Telegram WebApp
  try {
    if (window.Telegram?.WebApp?.initDataUnsafe?.start_param) {
      codeInput.value = window.Telegram.WebApp.initDataUnsafe.start_param;
    }
  } catch(e){}

  // Event listeners
  joinBtn.addEventListener('click', join);
  createCallBtn.addEventListener('click', createNewCall);
  backBtn.addEventListener('click', leaveCall);
  leaveBtn.addEventListener('click', leaveCall);
  toggleMic.addEventListener('click', toggleMicrophone);
  toggleCam.addEventListener('click', toggleCamera);

  // Enter key to join
  codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') join();
  });
}

// Create new call (redirect to bot)
function createNewCall() {
  showStatus("Перенаправление в Telegram...");
  // This would typically open the bot chat
  if (window.Telegram?.WebApp) {
    window.Telegram.WebApp.openTelegramLink("https://t.me/your_bot_username?start=create");
  } else {
    showStatus("Откройте бота в Telegram для создания звонка", "info");
  }
}

async function startLocalMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localVideo.srcObject = localStream;
}

async function connectSignaling(code) {
  socket = new WebSocket(SIGNALING_WS);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', code: code, peer_id: clientId }));
    showStatus("Подключение к сигналингу...");
  });

  socket.addEventListener('message', async (ev) => {
    const data = JSON.parse(ev.data);

    if (data.type === 'peers') {
      // create offers to existing peers
      for (const peer of data.peers) {
        await createOffer(peer, code);
      }
      startCallUI();
      showStatus("Подключено к комнате", "success");
    } else if (data.type === 'new_peer') {
      // someone joined after us — nothing to do; they will create offer
      showStatus("Новый участник присоединился");
    } else if (data.type === 'offer' && data.target === clientId) {
      await handleOffer(data);
    } else if (data.type === 'answer' && data.target === clientId) {
      await pcs[data.from].setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'ice' && data.target === clientId) {
      if (pcs[data.from]) {
        try { await pcs[data.from].addIceCandidate(data.candidate); } catch(e){console.warn(e);}
      }
    } else if (data.type === 'peer_left') {
      const pid = data.peer_id;
      removePeer(pid);
      showStatus("Участник покинул звонок");
    } else if (data.type === 'room_closed') {
      endCall("Комната закрыта");
    }
  });

  socket.addEventListener('error', (error) => {
    showStatus("Ошибка подключения", "error");
    console.error("WebSocket error:", error);
  });

  socket.addEventListener('close', () => {
    showStatus("Соединение закрыто", "error");
  });
}

async function createOffer(peerId, code) {
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  pcs[peerId] = pc;
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    addRemoteVideo(peerId, e.streams[0]);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.send(JSON.stringify({ type: 'ice', code, from: clientId, target: peerId, candidate: e.candidate }));
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.send(JSON.stringify({ type: 'offer', code, from: clientId, target: peerId, offer }));
}

async function handleOffer(data) {
  const from = data.from, code = data.code;
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  pcs[from] = pc;

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = (e) => addRemoteVideo(from, e.streams[0]);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.send(JSON.stringify({ type: 'ice', code, from: clientId, target: from, candidate: e.candidate }));
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.send(JSON.stringify({ type: 'answer', code, from: clientId, target: from, answer }));
}

function addRemoteVideo(peerId, stream) {
  let vid = document.getElementById('remote-' + peerId);
  if (!vid) {
    vid = document.createElement('video');
    vid.id = 'remote-' + peerId;
    vid.autoplay = true;
    vid.playsInline = true;
    vid.className = 'remote-video';
    remotes.appendChild(vid);
  }
  vid.srcObject = stream;
}

function removePeer(peerId) {
  if (pcs[peerId]) {
    try { pcs[peerId].close(); } catch(e){}
    delete pcs[peerId];
  }
  const v = document.getElementById('remote-' + peerId);
  if (v) v.remove();
}

function startCallUI() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime)/1000);
    const hh = String(Math.floor(s/3600)).padStart(2,'0');
    const mm = String(Math.floor((s%3600)/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    timerEl.textContent = `${hh}:${mm}:${ss}`;
  }, 1000);
}

async function join() {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showStatus("Код должен быть 6 цифр", "error");
    return;
  }

  roomCode = code;
  currentCodeSpan.textContent = code;
  showStatus("Запрашиваю доступ к камере/микрофону...");

  try {
    await startLocalMedia();
  } catch (e) {
    showStatus("Ошибка доступа к медиа: " + e.message, "error");
    return;
  }

  showStatus("Подключение к сигналингу...");
  await connectSignaling(code);
  showPage(callPage);
}

function endCall(reason) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ type: 'leave', code: roomCode, peer_id: clientId }));
      socket.close();
    } catch(e){}
  }

  for (const pid in pcs) {
    try { pcs[pid].close(); } catch(e){}
  }
  pcs = {};

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (timerInterval) clearInterval(timerInterval);

  showPage(welcomePage);
  if (reason) {
    showStatus(reason, "info");
  }
}

function leaveCall() {
  endCall("Вы покинули звонок");
}

function toggleMicrophone() {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  toggleMic.querySelector('span').textContent = t.enabled ? "Микрофон" : "Вкл микрофон";
  showStatus(t.enabled ? "Микрофон включен" : "Микрофон выключен");
}

function toggleCamera() {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  toggleCam.querySelector('span').textContent = t.enabled ? "Камера" : "Вкл камеру";
  showStatus(t.enabled ? "Камера включена" : "Камера выключена");
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);