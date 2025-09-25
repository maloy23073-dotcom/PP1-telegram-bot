class JitsiVideoCall {
    constructor() {
        this.jitsiApi = null;
        this.isInitializing = false;
        this.telegramWebApp = null;
        this.initializeElements();
        this.initializeTelegramWebApp();
        this.attachEventListeners();
        this.log('App initialized');
    }

    initializeTelegramWebApp() {
        // Инициализация Telegram WebApp
        if (window.Telegram && window.Telegram.WebApp) {
            this.telegramWebApp = window.Telegram.WebApp;

            // Настраиваем WebApp
            this.telegramWebApp.expand();
            this.telegramWebApp.enableClosingConfirmation();
            this.telegramWebApp.setHeaderColor('#182533');
            this.telegramWebApp.setBackgroundColor('#182533');

            // Отключаем нативные жесты
            this.telegramWebApp.disableVerticalSwipes();
            this.telegramWebApp.disableHorizontalSwipes();

            this.log('Telegram WebApp initialized');

            // Показываем основную кнопку
            this.telegramWebApp.MainButton.setText("Присоединиться к звонку");
            this.telegramWebApp.MainButton.hide();

        } else {
            this.log('Telegram WebApp not detected - running in browser mode');
        }
    }

    initializeElements() {
        this.welcomePage = document.getElementById('welcomePage');
        this.jitsiPage = document.getElementById('jitsiPage');
        this.jitsiContainer = document.getElementById('jitsiContainer');
        this.codeInput = document.getElementById('codeInput');
        this.joinBtn = document.getElementById('joinBtn');
        this.createCallBtn = document.getElementById('createCallBtn');
        this.backBtn = document.getElementById('backBtn');
        this.statusElement = document.getElementById('status');
    }

    log(message) {
        console.log(`📞 ${message}`);
    }

    attachEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinCall());
        this.createCallBtn.addEventListener('click', () => this.createCall());
        this.backBtn.addEventListener('click', () => this.leaveCall());

        this.codeInput.addEventListener('input', () => this.onCodeInput());
        this.codeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinCall();
        });

        // Обработчик закрытия Telegram WebApp
        if (this.telegramWebApp) {
            this.telegramWebApp.onEvent('viewportChanged', this.onViewportChanged.bind(this));
        }

        // Автозаполнение кода из URL
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            this.codeInput.value = code;
            this.onCodeInput();
        }
    }

    onCodeInput() {
        // Обновляем состояние кнопки в зависимости от ввода
        const code = this.codeInput.value.trim();
        if (code.length === 6) {
            this.joinBtn.disabled = false;
            this.joinBtn.style.opacity = '1';
        } else {
            this.joinBtn.disabled = true;
            this.joinBtn.style.opacity = '0.7';
        }
    }

    onViewportChanged() {
        // Адаптируем интерфейс при изменении размера окна
        this.log('Viewport changed');
        if (this.jitsiApi) {
            setTimeout(() => {
                this.jitsiApi.executeCommand('resize');
            }, 100);
        }
    }

    showPage(page) {
        this.welcomePage.style.display = 'none';
        this.jitsiPage.style.display = 'none';
        page.style.display = 'flex';

        // Обновляем интерфейс Telegram WebApp
        if (this.telegramWebApp) {
            if (page === this.jitsiPage) {
                this.telegramWebApp.MainButton.setText("Завершить звонок");
                this.telegramWebApp.MainButton.onClick(this.leaveCall.bind(this));
                this.telegramWebApp.MainButton.show();
            } else {
                this.telegramWebApp.MainButton.hide();
            }

            // Принудительно обновляем viewport
            setTimeout(() => {
                this.telegramWebApp.expand();
            }, 50);
        }
    }

    showStatus(message, type = 'info', duration = 3000) {
        this.statusElement.textContent = message;
        this.statusElement.className = `status-message ${type}`;
        this.statusElement.style.display = 'block';

        setTimeout(() => {
            this.statusElement.style.display = 'none';
        }, duration);
    }

    async joinCall() {
        if (this.isInitializing) return;
        this.isInitializing = true;

        const code = this.codeInput.value.trim();
        if (!code || code.length !== 6) {
            this.showStatus('Введите 6-значный код', 'error');
            this.isInitializing = false;
            return;
        }

        this.showStatus('Подключение к звонку...', 'info');

        try {
            const callInfo = await this.getCallInfo(code);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                this.isInitializing = false;
                return;
            }

            await this.registerJoin(code);
            this.startJitsiMeet(callInfo);

        } catch (error) {
            this.showStatus('Ошибка подключения', 'error');
            this.isInitializing = false;
        }
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

    startJitsiMeet(callInfo) {
        this.log(`Starting Jitsi Meet: ${callInfo.room_name}`);

        try {
            this.jitsiContainer.innerHTML = '';

            const config = {
                roomName: callInfo.room_name,
                width: '100%',
                height: '100%',
                parentNode: this.jitsiContainer,
                configOverwrite: {
                    prejoinPageEnabled: false,
                    enableWelcomePage: false,
                    enableClosePage: false,
                    startWithAudioMuted: false,
                    startWithVideoMuted: false,
                    disableModeratorIndicator: true,
                    enableInsecureRoomNameWarning: false,
                },
                interfaceConfigOverwrite: {
                    TOOLBAR_BUTTONS: [
                        'microphone', 'camera', 'hangup', 'tileview', 'settings'
                    ],
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_POWERED_BY: false,
                    MOBILE_APP_PROMO: false,
                    VERTICAL_FILMSTRIP: true
                }
            };

            if (callInfo.jwt_token) {
                config.jwt = callInfo.jwt_token;
            }

            this.jitsiApi = new JitsiMeetExternalAPI('meet.jit.si', config);

            this.setupJitsiEvents();

        } catch (error) {
            this.log('Jitsi error: ' + error.message);
            this.showStatus('Ошибка загрузки видеозвонка', 'error');
            this.isInitializing = false;
        }
    }

    setupJitsiEvents() {
        this.jitsiApi.addEventListener('videoConferenceJoined', () => {
            this.log('Conference joined successfully');
            this.showPage(this.jitsiPage);
            this.showStatus('Подключено к звонку', 'success', 2000);
            this.isInitializing = false;
        });

        this.jitsiApi.addEventListener('videoConferenceLeft', () => {
            this.leaveCall();
        });

        this.jitsiApi.addEventListener('participantJoined', () => {
            this.log('New participant joined');
        });

        this.jitsiApi.addEventListener('conferenceError', (error) => {
            this.log('Conference error: ' + JSON.stringify(error));
            this.showStatus('Ошибка подключения', 'error');
            this.isInitializing = false;
        });

        setTimeout(() => {
            if (this.isInitializing) {
                this.showPage(this.jitsiPage);
                this.isInitializing = false;
            }
        }, 10000);
    }

    leaveCall() {
        this.log('Leaving call');

        if (this.jitsiApi) {
            try {
                this.jitsiApi.dispose();
            } catch (error) {
                this.log('Error disposing Jitsi: ' + error.message);
            }
            this.jitsiApi = null;
        }

        this.jitsiContainer.innerHTML = '';
        this.showPage(this.welcomePage);
        this.isInitializing = false;

        // Закрываем WebApp если это Telegram
        if (this.telegramWebApp) {
            setTimeout(() => {
                this.telegramWebApp.close();
            }, 1000);
        }
    }

    createCall() {
        if (this.telegramWebApp) {
            this.telegramWebApp.showPopup({
                title: 'Создание звонка',
                message: 'Используйте команду /create в чате с ботом',
                buttons: [{ type: 'ok' }]
            });
        } else {
            this.showStatus('Используйте команду /create в боте Telegram', 'info');
        }
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    try {
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            throw new Error('Jitsi Meet API не загружен');
        }

        // Устанавливаем стиль как в Telegram
        document.documentElement.style.backgroundColor = '#182533';
        document.body.style.backgroundColor = '#182533';

        window.videoCallApp = new JitsiVideoCall();

    } catch (error) {
        console.error('Initialization error:', error);
        document.body.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: white; background: #182533; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <h2 style="margin-bottom: 10px;">Ошибка загрузки</h2>
                <p style="color: #8ba0b2; margin-bottom: 30px;">${error.message}</p>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #2ea6ff; color: white; border: none; border-radius: 8px; cursor: pointer;">
                    Обновить страницу
                </button>
            </div>
        `;
    }
});