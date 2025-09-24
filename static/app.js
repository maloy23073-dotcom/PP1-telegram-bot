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
    console.log('Переход на страницу:', page.id);

    // Скрываем все страницы
    welcomePage.style.display = 'none';
    callPage.style.display = 'none';

    // Показываем нужную страницу
    page.style.display = 'flex';

    // Обновляем классы для анимации
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    page.classList.add('active');
}

function showStatus(message, type = 'info') {
    console.log('Статус:', message);
    statusElement.textContent = message;
    statusElement.className = `connection-status ${type}`;
    statusElement.style.display = 'block';

    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 3000);
}

// Проверка активности звонка
async function checkCallActive(code) {
    try {
        console.log('Проверка активности звонка:', code);
        const response = await fetch(`/call/${code}/status`);
        const data = await response.json();
        console.log('Результат проверки:', data);
        return data.active;
    } catch (e) {
        console.error("Check call active error:", e);
        return false;
    }
}

// Регистрация в звонке
async function joinCall(code) {
    try {
        console.log('Регистрация в звонке:', code);
        const response = await fetch(`/call/${code}/join`, { method: 'POST' });
        const data = await response.json();
        console.log('Результат регистрации:', data);
        return data.success;
    } catch (e) {
        console.error("Join call error:", e);
        return false;
    }
}

// Работа с медиа
async function startLocalMedia() {
    try {
        console.log('Запрос доступа к медиаустройствам');
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        console.log('Доступ к медиаустройствам получен');
        localVideo.srcObject = localStream;
        return true;
    } catch (error) {
        console.error('Ошибка доступа к медиа:', error);
        throw new Error('Не удалось получить доступ к камере/микрофону');
    }
}

function stopLocalMedia() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        console.log('Медиаустройства отключены');
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
    console.log('Таймер запущен');
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        console.log('Таймер остановлен');
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
            console.log('Микрофон:', isMicOn ? 'включен' : 'выключен');
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
            console.log('Камера:', isCamOn ? 'включена' : 'выключена');
            showStatus(`Камера ${isCamOn ? 'включена' : 'выключена'}`, 'info');
        }
    }
}

// Основная функция подключения
async function join() {
    console.log('=== НАЧАЛО ПРОЦЕССА ПОДКЛЮЧЕНИЯ ===');
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
        console.log('✅ Медиаустройства успешно подключены');
    } catch (e) {
        showStatus("Ошибка доступа к медиа: " + e.message, "error");
        return;
    }

    showStatus("Подключение завершено!");

    // Запускаем таймер
    startTimer();

    // Переходим на страницу звонка
    console.log('🔄 Попытка перехода на страницу звонка');
    showPage(callPage);
    console.log('✅ Переход на страницу звонка выполнен');

    // Показываем финальный статус
    setTimeout(() => {
        showStatus("Подключено успешно", "success");
    }, 500);
}

function leaveCall() {
    console.log('=== ВЫХОД ИЗ ЗВОНКА ===');
    stopTimer();
    stopLocalMedia();
    roomCode = '';
    showPage(welcomePage);
    codeInput.value = '';
    showStatus("Звонок завершен", "info");
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
    console.log('📄 Страница загружена');
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code && /^\d{6}$/.test(code)) {
        codeInput.value = code;
        console.log('🔢 Код из URL установлен:', code);
    }

    // Инициализация отображения страниц
    welcomePage.style.display = 'flex';
    callPage.style.display = 'none';
});

// Добавим CSS классы для состояний кнопок
const style = document.createElement('style');
style.textContent = `
    .control-btn.muted {
        background: var(--tg-danger) !important;
        opacity: 0.7;
    }
    
    .connection-status {
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 12px 24px;
        border-radius: 12px;
        font-size: 14px;
        z-index: 1000;
        text-align: center;
    }
    
    .connection-status.success {
        background: var(--tg-success);
    }
    
    .connection-status.error {
        background: var(--tg-danger);
    }
    
    .connection-status.info {
        background: var(--tg-warning);
        color: black;
    }
`;
document.head.appendChild(style);

console.log('🚀 app.js загружен и готов к работе');