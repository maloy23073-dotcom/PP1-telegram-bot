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
const backBtn = document.getElementById('backBtn');

// Переменные состояния
let roomCode = '';
let localStream = null;
let isMicOn = true;
let isCamOn = true;
let timerInterval = null;
let websocket = null;
let peerConnections = {};
let localUserId = generateUserId();

// Генерация ID пользователя
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

// Функции для работы со страницами
function showPage(page) {
    welcomePage.style.display = 'none';
    callPage.style.display = 'none';
    page.style.display = 'flex';
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    page.classList.add('active');
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
        console.log('WebSocket connected');
        showStatus("Соединение установлено", "success");

        // Запрашиваем список пользователей
        websocket.send(JSON.stringify({ type: "get_users" }));
    };

    websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
    };

    websocket.onclose = () => {
        console.log('WebSocket disconnected');
        showStatus("Соединение разорвано", "error");
    };

    websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        showStatus("Ошибка соединения", "error");
    };
}

// Обработка сообщений WebSocket
function handleWebSocketMessage(message) {
    console.log('Received message:', message);

    switch (message.type) {
        case "user_joined":
            showStatus(`Пользователь присоединился: ${message.user_id}`, "info");
            createPeerConnection(message.user_id);
            break;

        case "user_left":
            showStatus(`Пользователь вышел: ${message.user_id}`, "info");
            removeRemoteVideo(message.user_id);
            break;

        case "users_list":
            message.users.forEach(userId => {
                if (userId !== localUserId) {
                    createPeerConnection(userId);
                }
            });
            break;

        case "offer":
            handleOffer(message.offer, message.from);
            break;

        case "answer":
            handleAnswer(message.answer, message.from);
            break;

        case "ice_candidate":
            handleIceCandidate(message.candidate, message.from);
            break;
    }
}

// WebRTC функции
function createPeerConnection(userId) {
    if (peerConnections[userId]) return;

    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    peerConnections[userId] = peerConnection;

    // Добавляем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Обработка удаленного потока
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream from:', userId);
        addRemoteVideo(userId, event.streams[0]);
    };

    // Генерация ICE кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            websocket.send(JSON.stringify({
                type: "ice_candidate",
                candidate: event.candidate,
                to: userId
            }));
        }
    };

    // Создаем offer для нового пользователя
    if (userId !== localUserId) {
        createOffer(userId);
    }
}

async function createOffer(userId) {
    try {
        const peerConnection = peerConnections[userId];
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

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
    try {
        const peerConnection = peerConnections[fromUserId] || createPeerConnection(fromUserId);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

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
    try {
        const peerConnection = peerConnections[fromUserId];
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

async function handleIceCandidate(candidate, fromUserId) {
    try {
        const peerConnection = peerConnections[fromUserId];
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (error) {
        console.error('Error handling ICE candidate:', error);
    }
}

// Управление видео элементами
function addRemoteVideo(userId, stream) {
    // Удаляем существующее видео если есть
    removeRemoteVideo(userId);

    const videoElement = document.createElement('video');
    videoElement.id = `remoteVideo_${userId}`;
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.srcObject = stream;
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.borderRadius = '8px';

    const videoContainer = document.createElement('div');
    videoContainer.className = 'remote-video-container';
    videoContainer.style.position = 'relative';
    videoContainer.style.width = '100%';
    videoContainer.style.height = '100%';
    videoContainer.appendChild(videoElement);

    // Добавляем индикатор пользователя
    const userLabel = document.createElement('div');
    userLabel.textContent = `Участник ${userId.substr(5)}`;
    userLabel.style.position = 'absolute';
    userLabel.style.bottom = '5px';
    userLabel.style.left = '5px';
    userLabel.style.background = 'rgba(0,0,0,0.7)';
    userLabel.style.color = 'white';
    userLabel.style.padding = '2px 6px';
    userLabel.style.borderRadius = '4px';
    userLabel.style.fontSize = '10px';
    videoContainer.appendChild(userLabel);

    remotesContainer.appendChild(videoContainer);
    showStatus(`Участник подключен`, "success");
}

function removeRemoteVideo(userId) {
    const existingVideo = document.getElementById(`remoteVideo_${userId}`);
    if (existingVideo) {
        existingVideo.parentElement.remove();
    }
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
}

// Работа с медиа
async function startLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        localVideo.srcObject = localStream;
        return true;
    } catch (error) {
        throw new Error('Не удалось получить доступ к камере/микрофону');
    }
}

function stopLocalMedia() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
}

// Таймер звонка
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
            isMicOn = audioTrack.enabled;
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
            isCamOn = videoTrack.enabled;
            toggleCam.classList.toggle('muted', !isCamOn);
            localVideo.style.opacity = isCamOn ? '1' : '0.5';
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
    showStatus("Запрашиваю доступ к камере/микрофону...");

    try {
        await startLocalMedia();
    } catch (e) {
        showStatus("Ошибка доступа к медиа: " + e.message, "error");
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
        showStatus("Подключено успешно", "success");
    }, 1000);
}

function leaveCall() {
    // Закрываем WebSocket
    if (websocket) {
        websocket.close();
    }

    // Закрываем все peer соединения
    Object.keys(peerConnections).forEach(userId => {
        removeRemoteVideo(userId);
    });

    stopTimer();
    stopLocalMedia();
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
backBtn.addEventListener('click', leaveCall);
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
});