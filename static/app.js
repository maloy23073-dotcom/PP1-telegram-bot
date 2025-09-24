// Упрощенная версия app.js для тестирования
console.log('VideoCall app loading...');

const welcomePage = document.getElementById('welcomePage');
const callPage = document.getElementById('callPage');
const codeInput = document.getElementById('codeInput');
const joinBtn = document.getElementById('joinBtn');
const currentCodeSpan = document.getElementById('currentCode');
const timerElement = document.getElementById('timer');
const localVideo = document.getElementById('localVideo');
const remotesContainer = document.getElementById('remotes');
const statusElement = document.getElementById('status');
const leaveBtn = document.getElementById('leaveBtn');

let roomCode = '';
let localStream = null;
let websocket = null;
let timerInterval = null;

function showPage(page) {
    welcomePage.style.display = page === welcomePage ? 'flex' : 'none';
    callPage.style.display = page === callPage ? 'flex' : 'none';
}

function showStatus(message, type = 'info') {
    statusElement.textContent = message;
    statusElement.className = `connection-status ${type}`;
    statusElement.style.display = 'block';

    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 3000);
}

// Базовая функция подключения
async function join() {
    const code = codeInput.value.trim();

    if (!/^\d{6}$/.test(code)) {
        showStatus("Код должен быть 6 цифр", "error");
        return;
    }

    showStatus("Проверка активности звонка...");
    const isActive = await checkCallActive(code);

    if (!isActive) {
        showStatus("Звонок не найден", "error");
        return;
    }

    roomCode = code;
    currentCodeSpan.textContent = code;

    try {
        showStatus("Запрашиваю доступ к камере...");
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        localVideo.srcObject = localStream;
    } catch (e) {
        showStatus("Ошибка доступа к камере", "error");
        return;
    }

    showStatus("Подключение к звонку...");

    // Простое подключение WebSocket
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        websocket = new WebSocket(`${protocol}//${window.location.host}/ws/${roomCode}`);

        websocket.onopen = () => {
            showStatus("Подключено!", "success");
            startTimer();
            showPage(callPage);
        };

        websocket.onerror = () => {
            showStatus("Ошибка соединения", "error");
        };

    } catch (e) {
        showStatus("Ошибка подключения", "error");
    }
}

function leaveCall() {
    if (websocket) websocket.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (timerInterval) clearInterval(timerInterval);

    showPage(welcomePage);
    codeInput.value = '';
    showStatus("Звонок завершен", "info");
}

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

// Обработчики событий
joinBtn.addEventListener('click', join);
leaveBtn.addEventListener('click', leaveCall);

// Инициализация
window.addEventListener('load', () => {
    showPage(welcomePage);

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
        codeInput.value = code;
    }

    console.log('✅ VideoCall app initialized');
});