// Элементы DOM
const welcomePage = document.getElementById('welcomePage');
const callPage = document.getElementById('callPage');
const codeInput = document.getElementById('codeInput');
const joinBtn = document.getElementById('joinBtn');
const createCallBtn = document.getElementById('createCallBtn');
const backBtn = document.getElementById('backBtn');
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
let isMicOn = true;
let isCamOn = true;
let callStartTime = null;
let timerInterval = null;

// Функции для работы со страницами
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    page.classList.add('active');
}

function showStatus(message, type = 'info') {
    statusElement.textContent = message;
    statusElement.className = `connection-status ${type}`;
    statusElement.style.display = 'block';

    if (type !== 'error') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    }
}

// Проверка активности звонка
async function checkCallActive(code) {
    try {
        const response = await fetch(`/call/${code}/status`);
        const data = await response.json();
        return data.active;
    } catch (e) {
        console.error("Check call active error:", e);
        return false;
    }
}

// Регистрация в звонке
async function joinCall(code) {
    try {
        const response = await fetch(`/call/${code}/join`, { method: 'POST' });
        const data = await response.json();
        return data.success;
    } catch (e) {
        console.error("Join call error:", e);
        return false;
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
    callStartTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - callStartTime;
        const hours = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
        const minutes = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
        const seconds = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
        timerElement.textContent = `${hours}:${minutes}:${seconds}`;
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
        }
    }
}

// Основные функции
async function join() {
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
        showStatus("Код должен быть 6 цифр", "error");
        return;
    }

    // Проверка активности звонка
    showStatus("Проверка активности звонка...");
    const isActive = await checkCallActive(code);
    if (!isActive) {
        showStatus("Звонок не найден или не активен", "error");
        return;
    }

    // Регистрация участника
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

    showStatus("Подключение...");

    // Запускаем таймер
    startTimer();

    // Переходим на страницу звонка
    showPage(callPage);
    showStatus("Подключено успешно", "success");
}

function leaveCall() {
    stopTimer();
    stopLocalMedia();
    roomCode = '';
    showPage(welcomePage);
    codeInput.value = '';
}

// Обработчики событий
joinBtn.addEventListener('click', join);

codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        join();
    }
});

createCallBtn.addEventListener('click', () => {
    showStatus("Используйте команду /create в боте для создания звонка", "info");
});

backBtn.addEventListener('click', leaveCall);

toggleMic.addEventListener('click', toggleMicrophone);
toggleCam.addEventListener('click', toggleCamera);
leaveBtn.addEventListener('click', leaveCall);

// Обработка параметров URL (автозаполнение кода)
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code && /^\d{6}$/.test(code)) {
        codeInput.value = code;
    }
});

// Обработка изменения размера окна
window.addEventListener('resize', () => {
    // Можно добавить адаптацию интерфейса
});