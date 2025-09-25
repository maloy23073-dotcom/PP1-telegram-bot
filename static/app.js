class JitsiVideoCall {
    constructor() {
        this.jitsiApi = null;
        this.isInitializing = false;
        this.isMobile = this.checkMobile();
        this.initializeElements();
        this.attachEventListeners();
        this.setupTelegramApp();
        this.log('App initialized');
    }

    setupTelegramApp() {
        // Расширяем Mini App на весь экран
        if (window.Telegram && window.Telegram.WebApp) {
            const webApp = window.Telegram.WebApp;

            // Расширяем на весь экран
            webApp.expand();

            // Отключаем нативную навигацию Telegram
            webApp.disableVerticalSwipes();
            webApp.enableClosingConfirmation();

            // Устанавливаем цвет фона как в Telegram
            webApp.setBackgroundColor('#182533');
            webApp.setHeaderColor('#182533');

            this.log('Telegram WebApp configured');
        }
    }

    checkMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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

        this.codeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinCall();
        });

        // Автозаполнение кода из URL
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            this.codeInput.value = code;
        }
    }

    showPage(page) {
        this.welcomePage.style.display = 'none';
        this.jitsiPage.style.display = 'none';
        page.style.display = 'flex';

        // Обновляем размеры для Telegram
        this.updateTelegramLayout();
    }

    updateTelegramLayout() {
        // Принудительно обновляем размеры контейнера
        setTimeout(() => {
            if (this.jitsiApi) {
                this.jitsiApi.executeCommand('resize');
            }
        }, 100);
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
        if (!code) {
            this.showStatus('Введите код звонка', 'error');
            this.isInitializing = false;
            return;
        }

        this.showStatus('Подключение...', 'info');

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
        this.log('Starting Jitsi Meet');

        try {
            this.jitsiContainer.innerHTML = '';

            // Конфигурация для автоматического присоединения (без страницы выбора)
            const config = {
                roomName: callInfo.room_name,
                width: '100%',
                height: '100%',
                parentNode: this.jitsiContainer,
                configOverwrite: {
                    prejoinPageEnabled: false, // Убираем страницу выбора
                    disableDeepLinking: true, // Отключаем глубокие ссылки
                    enableWelcomePage: false, // Отключаем приветственную страницу
                    enableClosePage: false, // Отключаем страницу закрытия
                    startWithAudioMuted: false,
                    startWithVideoMuted: false,
                    enableNoAudioDetection: true,
                    enableNoisyMicDetection: true,
                    resolution: 720,
                    constraints: {
                        video: {
                            height: { ideal: 720, max: 1080, min: 360 }
                        },
                        audio: {
                            stereo: false,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    }
                },
                interfaceConfigOverwrite: {
                    // Минималистичный интерфейс как в Telegram
                    TOOLBAR_BUTTONS: [
                        'microphone', 'camera', 'hangup', 'tileview', 'settings'
                    ],
                    SETTINGS_SECTIONS: ['devices', 'language'],
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_BRAND_WATERMARK: false,
                    SHOW_POWERED_BY: false,
                    SHOW_PROMOTIONAL_CLOSE_PAGE: false,
                    SHOW_CHROME_EXTENSION_BANNER: false,
                    MOBILE_APP_PROMO: false,
                    VERTICAL_FILMSTRIP: true,
                    CLOSE_PAGE_GUEST_HINT: false,
                    DISABLE_VIDEO_BACKGROUND: false,
                    DISABLE_FOCUS_INDICATOR: false,
                    TILE_VIEW_MAX_COLUMNS: 5
                },
                userInfo: {
                    displayName: this.generateDisplayName()
                }
            };

            // Добавляем JWT токен если доступен
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

    generateDisplayName() {
        const names = ['Участник', 'Коллега', 'Собеседник', 'Пользователь'];
        return names[Math.floor(Math.random() * names.length)];
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

        this.jitsiApi.addEventListener('participantLeft', () => {
            this.log('Participant left');
        });

        this.jitsiApi.addEventListener('audioMuteStatusChanged', (event) => {
            this.log('Audio mute: ' + event.muted);
        });

        this.jitsiApi.addEventListener('videoMuteStatusChanged', (event) => {
            this.log('Video mute: ' + event.muted);
        });

        // Обработка ошибок
        this.jitsiApi.addEventListener('connectionFailed', () => {
            this.showStatus('Ошибка подключения к серверу', 'error');
            this.isInitializing = false;
        });

        this.jitsiApi.addEventListener('proxyConnectionError', () => {
            this.showStatus('Проблемы с сетью', 'error');
            this.isInitializing = false;
        });

        // Таймаут на случай проблем
        setTimeout(() => {
            if (this.isInitializing) {
                this.log('Jitsi timeout - showing page anyway');
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

        // Закрываем Mini App если это Telegram
        if (window.Telegram && window.Telegram.WebApp) {
            setTimeout(() => {
                window.Telegram.WebApp.close();
            }, 1000);
        }
    }

    createCall() {
        this.showStatus('Используйте команду /create в боте Telegram', 'info');
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    try {
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            throw new Error('Jitsi Meet API не загружен');
        }

        // Устанавливаем стиль как в Telegram
        document.body.style.background = '#182533';

        window.videoCallApp = new JitsiVideoCall();

        // Показываем welcome page
        document.getElementById('welcomePage').style.display = 'flex';

    } catch (error) {
        console.error('Initialization error:', error);
        document.body.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: white; background: #182533; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <div style="font-size: 48px; margin-bottom: 20px;">📞</div>
                <h2 style="margin-bottom: 10px; color: #fff;">Ошибка загрузки</h2>
                <p style="color: #8ba0b2; margin-bottom: 30px;">${error.message}</p>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #2ea6ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;">
                    Попробовать снова
                </button>
            </div>
        `;
    }
});