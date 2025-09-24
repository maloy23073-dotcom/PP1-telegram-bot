// Элементы DOM
const welcomePage = document.getElementById('welcomePage');
const callPage = document.getElementById('callPage');
const codeInput = document.getElementById('codeInput');
const joinBtn = document.getElementById('joinBtn');
const currentCodeSpan = document.getElementById('currentCode');
const timerElement = document.getElementById('timer');
const localVideo = document.getElementById('localVideo');
const remotesContainer = document.getElementById('remotes');
const statusElement = document.getElementById('status');
const toggleMic = document.getElementById('toggleMic');
const toggleCam = document.getElementById('toggleCam');
const leaveBtn = document.getElementById('leaveBtn');

// Переменные состояния
let roomCode = '';
let localStream = null;
let websocket = null;
let peerConnections = {};
let localUserId = Math.random().toString(36).substr(2, 9);
let timerInterval = null;

// Функции для работы со страницами
function showPage(page) {
    welcomePage.style.display = 'none';
    callPage.style.display = 'none';
    page.style.display = 'flex';
}

function showStatus(message, type = 'info') {
    statusElement.textContent = message;
    statusElement.className = `connection-status ${type}`;
    statusElement.style.display = 'block';

    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 3000);
}

// WebSocket соединение
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${roomCode}/${localUserId}`;

    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
        console.log('✅ WebSocket connected');
        showStatus("Соединение установлено", "success");
    };

    websocket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('📨 Received:', message.type, 'from:', message.from);
        await handleWebSocketMessage(message);
    };

    websocket.onclose = () => {
        console.log('❌ WebSocket disconnected');
        showStatus("Соединение разорвано", "error");
    };
}

// Обработка сообщений WebSocket
async function handleWebSocketMessage(message) {
    switch (message.type) {
        case "user_joined":
            showStatus(`Участник присоединился`, "info");
            await createPeerConnection(message.from);
            break;

        case "user_left":
            showStatus(`Участник вышел`, "info");
            removePeerConnection(message.from);
            break;

        case "offer":
            await handleOffer(message.offer, message.from);
            break;

        case "answer":
            await handleAnswer(message.answer, message.from);
            break;

        case "ice_candidate":
            await handleIceCandidate(message.candidate, message.from);
            break;
    }
}

// WebRTC функции
async function createPeerConnection(userId) {
    if (peerConnections[userId]) {
        console.log('Peer connection already exists for:', userId);
        return;
    }

    console.log('Creating peer connection for:', userId);

    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    const peerConnection = new RTCPeerConnection(configuration);
    peerConnections[userId] = peerConnection;

    // Добавляем локальные треки
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log('Adding local track:', track.kind);
            peerConnection.addTrack(track, localStream);
        });
    }

    // Обработка удаленного потока
    peerConnection.ontrack = (event) => {
        console.log('✅ Received remote stream from:', userId);
        const remoteStream = event.streams[0];
        addRemoteVideo(userId, remoteStream);
        showStatus("Видеосвязь установлена!", "success");
    };

    // ICE кандидаты
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to:', userId);
            websocket.send(JSON.stringify({
                type: "ice_candidate",
                candidate: event.candidate,
                to: userId
            }));
        }
    };

    // Создаем offer
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        console.log('Sending offer to:', userId);
        websocket.send(JSON.stringify({
            type: "offer",
            offer: offer,
            to: userId
        }));
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

async function handleOffer(offer, fromUserId) {
    console.log('Handling offer from:', fromUserId);

    if (!peerConnections[fromUserId]) {
        await createPeerConnection(fromUserId);
    }

    const peerConnection = peerConnections[fromUserId];

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        console.log('Sending answer to:', fromUserId);
        websocket.send(JSON.stringify({
            type: "answer",
            answer: answer,
            to: fromUserId
        }));
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(answer, fromUserId) {
    console.log('Handling answer from:', fromUserId);

    const peerConnection = peerConnections[fromUserId];
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('✅ Answer set successfully');
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
}

async function handleIceCandidate(candidate, fromUserId) {
    console.log('Handling ICE candidate from:', fromUserId);

    const peerConnection = peerConnections[fromUserId];
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('✅ ICE candidate added');
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }
}

function removePeerConnection(userId) {
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
    removeRemoteVideo(userId);
}

// Управление видео элементами
function addRemoteVideo(userId, stream) {
    // Удаляем старое видео если есть
    removeRemoteVideo(userId);

    const videoElement = document.createElement('video');
    videoElement.id = `remoteVideo_${userId}`;
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = false; // Важно: не mute удаленное видео!
    videoElement.srcObject = stream;

    // Стилизация
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.objectFit = 'cover';
    videoElement.style.borderRadius = '8px';
    videoElement.style.backgroundColor = '#1e1e1e';

    const videoContainer = document.createElement('div');
    videoContainer.className = 'remote-video-container';
    videoContainer.style.position = 'relative';
    videoContainer.style.width = '100%';
    videoContainer.style.height = '100%';
    videoContainer.style.minHeight = '200px';
    videoContainer.appendChild(videoElement);

    // Индикатор пользователя
    const userLabel = document.createElement('div');
    userLabel.textContent = 'Участник';
    userLabel.style.position = 'absolute';
    userLabel.style.bottom = '8px';
    userLabel.style.left = '8px';
    userLabel.style.background = 'rgba(0,0,0,0.7)';
    userLabel.style.color = 'white';
    userLabel.style.padding = '4px 8px';
    userLabel.style.borderRadius = '4px';
    userLabel.style.fontSize = '12px';
    videoContainer.appendChild(userLabel);

    remotesContainer.appendChild(videoContainer);

    console.log('✅ Remote video added for:', userId);
}

function removeRemoteVideo(userId) {
    const existingVideo = document.getElementById(`remoteVideo_${userId}`);
    if (existingVideo && existingVideo.parentElement) {
        existingVideo.parentElement.remove();
    }
}

// Работа с медиа
async function startLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        localVideo.srcObject = localStream;
        localVideo.muted = true; // Mute локальное видео

        console.log('✅ Local media started');
        return true;
    } catch (error) {
        console.error('❌ Error accessing media devices:', error);
        throw new Error('Не удалось получить доступ к камере/микрофону');
    }
}

function stopLocalMedia() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
}

// Таймер
function startTimer() {
    let seconds = 0;
    timerInterval = setInterval(() => {
        seconds++;
        const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        timerElement.textContent = `${hours}:${minutes}:${secs}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Управление медиа
function toggleMicrophone() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const isMicOn = audioTrack.enabled;
            toggleMic.classList.toggle('muted', !isMicOn);
            showStatus(`Микрофон ${isMicOn ? 'включен' : 'выключен'}`, 'info');
        }
    }
}

function toggleCamera() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const isCamOn = videoTrack.enabled;
            toggleCam.classList.toggle('muted', !isCamOn);
            localVideo.style.opacity = isCamOn ? '1' : '0.3';
            showStatus(`Камера ${isCamOn ? 'включена' : 'выключена'}`, 'info');
        }
    }
}

// Основная функция подключения
async function join() {
    const code = codeInput.value.trim();

    if (!/^\d{6}$/.test(code)) {
        showStatus("Код должен быть 6 цифр", "error");
        return;
    }

    showStatus("Проверка активности звонка...");
    const isActive = await checkCallActive(code);

    if (!isActive) {
        showStatus("Звонок не найден или не активен", "error");
        return;
    }

    showStatus("Регистрация в звонке...");
    const joined = await joinCall(code);

    if (!joined) {
        showStatus("Ошибка регистрации в звонке", "error");
        return;
    }

    roomCode = code;
    currentCodeSpan.textContent = code;

    try {
        showStatus("Запрашиваю доступ к камере/микрофону...");
        await startLocalMedia();
    } catch (e) {
        showStatus("Ошибка доступа к медиа", "error");
        return;
    }

    showStatus("Подключение к звонку...");

    // Подключаем WebSocket
    connectWebSocket();

    // Запускаем таймер
    startTimer();

    // Переходим на страницу звонка
    showPage(callPage);

    setTimeout(() => {
        showStatus("Готов к видеозвонку!", "success");
    }, 1000);
}

function leaveCall() {
    // Закрываем WebSocket
    if (websocket) {
        websocket.close();
    }

    // Закрываем все peer соединения
    Object.keys(peerConnections).forEach(userId => {
        removePeerConnection(userId);
    });

    stopTimer();
    stopLocalMedia();

    // Очищаем контейнер удаленных видео
    remotesContainer.innerHTML = '';

    roomCode = '';
    showPage(welcomePage);
    codeInput.value = '';
    showStatus("Звонок завершен", "info");
}

// API функции
async function checkCallActive(code) {
    try {
        const response = await fetch(`/call/${code}/status`);
        const data = await response.json();
        return data.active;
    } catch (e) {
        return false;
    }
}

async function joinCall(code) {
    try {
        const response = await fetch(`/call/${code}/join`, { method: 'POST' });
        const data = await response.json();
        return data.success;
    } catch (e) {
        return false;
    }
}

// Обработчики событий
joinBtn.addEventListener('click', join);

codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') join();
});

leaveBtn.addEventListener('click', leaveCall);
toggleMic.addEventListener('click', toggleMicrophone);
toggleCam.addEventListener('click', toggleCamera);

// Инициализация
window.addEventListener('load', () => {
    welcomePage.style.display = 'flex';
    callPage.style.display = 'none';

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code && /^\d{6}$/.test(code)) {
        codeInput.value = code;
    }

    console.log('🚀 VideoCall app initialized');
});