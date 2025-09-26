// Минимальная версия приложения
console.log('🚀 Starting Telegram Call App');

// Проверяем загрузку Telegram WebApp
let webApp = null;
if (window.Telegram && window.Telegram.WebApp) {
    webApp = Telegram.WebApp;
    console.log('✅ Telegram WebApp detected');

    // Базовая настройка
    webApp.expand();
    webApp.setHeaderColor('#182533');
    webApp.setBackgroundColor('#182533');
} else {
    console.log('ℹ️ Running in browser mode');
}

// Основные функции
function showStatus(message, type = 'info') {
    console.log('Status:', message);

    // Создаем или находим элемент статуса
    let statusEl = document.getElementById('status');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'status';
        statusEl.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 12px 20px;
            border-radius: 10px;
            z-index: 1000;
            max-width: 90%;
            text-align: center;
            font-size: 14px;
        `;
        document.body.appendChild(statusEl);
    }

    statusEl.textContent = message;
    statusEl.style.display = 'block';

    // Цвета в зависимости от типа
    if (type === 'error') {
        statusEl.style.background = 'rgba(231, 76, 60, 0.9)';
    } else if (type === 'success') {
        statusEl.style.background = 'rgba(39, 174, 96, 0.9)';
    } else {
        statusEl.style.background = 'rgba(52, 152, 219, 0.9)';
    }

    // Автоскрытие
    setTimeout(() => {
        statusEl.style.display = 'none';
    }, 3000);
}

// Функция подключения к звонку
async function joinCall() {
    console.log('Join call function called');

    const codeInput = document.getElementById('codeInput');
    const code = codeInput ? codeInput.value.trim() : '';

    if (!code || code.length !== 6) {
        showStatus('Введите 6-значный код', 'error');
        return;
    }

    showStatus('Проверка кода...', 'info');

    try {
        // Проверяем код на сервере
        const response = await fetch(`/call/${code}/info`);
        console.log('Response status:', response.status);

        if (!response.ok) {
            throw new Error('Ошибка сети');
        }

        const callInfo = await response.json();
        console.log('Call info:', callInfo);

        if (!callInfo.exists) {
            showStatus('Звонок не найден', 'error');
            return;
        }

        // Регистрируем участие
        await fetch(`/call/${code}/join`, { method: 'POST' });

        // Открываем Jitsi
        openJitsiCall(callInfo.room_name);

    } catch (error) {
        console.error('Error:', error);
        showStatus('Ошибка подключения', 'error');
    }
}

// Функция открытия Jitsi
function openJitsiCall(roomName) {
    const jitsiUrl = `https://meet.jit.si/${roomName}`;
    console.log('Opening Jitsi URL:', jitsiUrl);

    showStatus('Открываю видеозвонок...', 'success');

    if (webApp) {
        // В Telegram открываем в браузере
        webApp.openLink(jitsiUrl);

        // Закрываем Mini App через секунду
        setTimeout(() => {
            webApp.close();
        }, 1000);
    } else {
        // В браузере открываем в новой вкладке
        window.open(jitsiUrl, '_blank');
    }
}

// Функция создания звонка
function createCall() {
    if (webApp) {
        webApp.showPopup({
            title: 'Создание звонка',
            message: 'Используйте команду /create в чате с ботом',
            buttons: [{ type: 'ok' }]
        });
    } else {
        showStatus('Используйте /create в боте Telegram', 'info');
    }
}

// Инициализация при загрузке страницы
function initializeApp() {
    console.log('Initializing app...');

    // Проверяем основные элементы
    const codeInput = document.getElementById('codeInput');
    const joinBtn = document.getElementById('joinBtn');
    const createBtn = document.getElementById('createCallBtn');

    if (!codeInput || !joinBtn || !createBtn) {
        console.error('Required elements not found');
        showErrorPage();
        return;
    }

    // Назначаем обработчики
    joinBtn.addEventListener('click', joinCall);
    createBtn.addEventListener('click', createCall);

    codeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinCall();
    });

    // Автозаполнение кода из URL
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
        codeInput.value = code;
    }

    console.log('✅ App initialized successfully');
    showStatus('Приложение загружено', 'success');
}

// Функция показа страницы ошибки
function showErrorPage() {
    document.body.innerHTML = `
        <div style="
            padding: 40px 20px; 
            text-align: center; 
            color: white; 
            background: #182533; 
            height: 100vh; 
            display: flex; 
            flex-direction: column; 
            justify-content: center; 
            align-items: center;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        ">
            <div style="font-size: 48px; margin-bottom: 20px;">📞</div>
            <h2 style="margin-bottom: 10px; color: #fff;">Telegram Call</h2>
            <p style="color: #8ba0b2; margin-bottom: 30px;">Произошла ошибка загрузки</p>
            <button onclick="location.reload()" style="
                padding: 12px 24px; 
                background: #2ea6ff; 
                color: white; 
                border: none; 
                border-radius: 8px; 
                cursor: pointer; 
                font-size: 16px;
            ">
                Обновить страницу
            </button>
        </div>
    `;
}

// Запускаем приложение когда DOM загружен
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Глобальный обработчик ошибок
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});