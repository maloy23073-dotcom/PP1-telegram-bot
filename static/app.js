// Исправленная инициализация Telegram WebApp
function initTelegramWebApp() {
    if (window.Telegram && window.Telegram.WebApp) {
        const webApp = Telegram.WebApp;

        // Расширяем на весь экран
        webApp.expand();
        webApp.enableClosingConfirmation();

        // Устанавливаем цвета
        webApp.setHeaderColor('#182533');
        webApp.setBackgroundColor('#182533');

        // Только существующие методы
        if (webApp.disableVerticalSwipes) {
            webApp.disableVerticalSwipes();
        }

        console.log('✅ Telegram WebApp initialized');
        return webApp;
    }
    return null;
}

// Обновленный конструктор класса
class TelegramCallApp {
    constructor() {
        this.webApp = initTelegramWebApp();
        this.isProcessing = false;
        this.init();
    }

    init() {
        console.log('🚀 Initializing Telegram Call App');
        this.applyTelegramStyles();
        this.bindEvents();
        this.checkUrlCode();
        this.setupAppearance();
        console.log('✅ Telegram Call App initialized');
    }

    // Остальной код остается без изменений...
    applyTelegramStyles() {
        document.documentElement.style.setProperty('--tg-theme-bg-color', '#182533');
        document.documentElement.style.setProperty('--tg-theme-text-color', '#ffffff');
        document.documentElement.style.setProperty('--tg-theme-hint-color', '#8ba0b2');
        document.documentElement.style.setProperty('--tg-theme-link-color', '#2ea6ff');
        document.documentElement.style.setProperty('--tg-theme-button-color', '#2ea6ff');
        document.documentElement.style.setProperty('--tg-theme-button-text-color', '#ffffff');

        document.body.style.background = '#182533';
        document.body.style.color = '#ffffff';
    }

    setupAppearance() {
        const style = document.createElement('style');
        style.textContent = `
            .telegram-header {
                background: #182533;
                padding: 16px;
                text-align: center;
                border-bottom: 1px solid #2d4256;
            }
            
            .telegram-title {
                font-size: 18px;
                font-weight: 600;
                margin-bottom: 4px;
                color: #ffffff;
            }
            
            .telegram-subtitle {
                font-size: 14px;
                color: #8ba0b2;
            }
            
            .telegram-card {
                background: transparent;
                padding: 16px;
                margin: 0;
            }
            
            .telegram-input {
                width: 100%;
                padding: 12px 16px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid #2d4256;
                border-radius: 10px;
                color: #ffffff;
                font-size: 16px;
                text-align: center;
                margin-bottom: 16px;
            }
            
            .telegram-input:focus {
                outline: none;
                border-color: #2ea6ff;
                background: rgba(255, 255, 255, 0.12);
            }
            
            .telegram-button {
                width: 100%;
                padding: 14px 16px;
                background: #2ea6ff;
                color: #ffffff;
                border: none;
                border-radius: 10px;
                font-size: 16px;
                font-weight: 500;
                cursor: pointer;
                margin-bottom: 8px;
                transition: background 0.2s;
            }
            
            .telegram-button:hover {
                background: #1e8dd8;
            }
            
            .telegram-button:active {
                transform: scale(0.98);
            }
            
            .telegram-button-secondary {
                background: transparent;
                border: 1px solid #2ea6ff;
                color: #2ea6ff;
            }
            
            .telegram-divider {
                display: flex;
                align-items: center;
                margin: 20px 0;
                color: #5d7a8f;
                font-size: 14px;
            }
            
            .telegram-divider::before,
            .telegram-divider::after {
                content: '';
                flex: 1;
                height: 1px;
                background: #2d4256;
            }
            
            .telegram-divider::before {
                margin-right: 12px;
            }
            
            .telegram-divider::after {
                margin-left: 12px;
            }
            
            .telegram-status {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 12px 20px;
                border-radius: 10px;
                z-index: 1000;
                display: none;
                max-width: 90%;
                text-align: center;
                font-size: 14px;
            }
            
            .telegram-button:disabled {
                background: #1c3b5a;
                cursor: not-allowed;
                opacity: 0.6;
            }
        `;
        document.head.appendChild(style);
    }

    bindEvents() {
        document.getElementById('joinBtn').addEventListener('click', () => this.joinCall());
        document.getElementById('createCallBtn').addEventListener('click', () => this.createCall());

        document.getElementById('codeInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinCall();
        });

        document.getElementById('codeInput').addEventListener('input', (e) => {
            this.updateButtonState(e.target.value);
        });
    }

    updateButtonState(code) {
        const button = document.getElementById('joinBtn');
        if (code.length === 6) {
            button.disabled = false;
            button.style.opacity = '1';
        } else {
            button.disabled = true;
            button.style.opacity = '0.6';
        }
    }

    checkUrlCode() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            document.getElementById('codeInput').value = code;
            this.updateButtonState(code);
        }
    }

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = `telegram-status ${type}`;
        statusEl.style.display = 'block';

        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }

    async joinCall() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        const code = document.getElementById('codeInput').value.trim();

        console.log('🔗 Joining call with code:', code);

        if (code.length !== 6) {
            this.showStatus('Введите 6-значный код', 'error');
            this.isProcessing = false;
            return;
        }

        this.showStatus('Проверка кода...', 'info');

        try {
            const callInfo = await this.getCallInfo(code);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                this.isProcessing = false;
                return;
            }

            await this.registerJoin(code);
            this.openJitsiInBrowser(callInfo.room_name);

        } catch (error) {
            console.error('Join error:', error);
            this.showStatus('Ошибка подключения', 'error');
            this.isProcessing = false;
        }
    }

    openJitsiInBrowser(roomName) {
        const jitsiUrl = `https://meet.jit.si/${roomName}`;
        console.log('🌐 Opening Jitsi URL:', jitsiUrl);

        if (this.webApp) {
            this.webApp.openLink(jitsiUrl);
            this.showStatus('Открываю видеозвонок...', 'success');

            setTimeout(() => {
                this.webApp.close();
            }, 2000);

        } else {
            window.open(jitsiUrl, '_blank');
            this.showStatus('Видеозвонок открыт в новой вкладке', 'success');
        }

        this.isProcessing = false;
    }

    async getCallInfo(code) {
        const response = await fetch(`/call/${code}/info`);
        if (!response.ok) throw new Error('Network error');
        return await response.json();
    }

    async registerJoin(code) {
        const response = await fetch(`/call/${code}/join`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Network error');
        return await response.json();
    }

    createCall() {
        if (this.webApp) {
            this.webApp.showPopup({
                title: 'Создание звонка',
                message: 'Для создания нового звонка используйте команду /create в чате с ботом',
                buttons: [{ type: 'ok' }]
            });
        } else {
            this.showStatus('Используйте /create в боте Telegram', 'info');
        }
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    try {
        new TelegramCallApp();
        console.log('✅ App started successfully');
    } catch (error) {
        console.error('❌ App initialization error:', error);

        document.body.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: white; background: #182533; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
                <div style="font-size: 48px; margin-bottom: 20px;">😔</div>
                <h2 style="margin-bottom: 10px; color: #fff;">Ошибка загрузки</h2>
                <p style="color: #8ba0b2; margin-bottom: 30px;">${error.message}</p>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #2ea6ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;">
                    Обновить
                </button>
            </div>
        `;
    }
});