// Инициализация Telegram WebApp
function initTelegramWebApp() {
    if (window.Telegram && window.Telegram.WebApp) {
        const webApp = Telegram.WebApp;

        // Настраиваем полноэкранный режим
        webApp.expand();
        webApp.enableClosingConfirmation();
        webApp.setHeaderColor('#182533');
        webApp.setBackgroundColor('#182533');

        // Важно для работы Jitsi в WebView
        webApp.disableVerticalSwipes();
        webApp.disableHorizontalSwipes();

        console.log('✅ Telegram WebApp initialized');
        return webApp;
    }
    return null;
}

// Основной класс приложения
class TelegramCallApp {
    constructor() {
        this.webApp = initTelegramWebApp();
        this.jitsiApi = null;
        this.isProcessing = false;
        this.init();
    }

    init() {
        console.log('🚀 Initializing Telegram Call App');
        this.applyTelegramStyles();
        this.bindEvents();
        this.checkUrlCode();
        console.log('✅ Telegram Call App initialized');
    }

    applyTelegramStyles() {
        document.documentElement.style.setProperty('--tg-theme-bg-color', '#182533');
        document.body.style.background = '#182533';
        document.body.style.color = '#ffffff';
    }

    bindEvents() {
        document.getElementById('joinBtn').addEventListener('click', () => this.joinCall());
        document.getElementById('createCallBtn').addEventListener('click', () => this.createCall());
        document.getElementById('backBtn').addEventListener('click', () => this.leaveCall());

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

    showPage(pageId) {
        console.log('📄 Showing page:', pageId);

        // Скрываем все страницы
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
            page.style.display = 'none';
        });

        // Показываем нужную страницу
        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.style.display = 'flex';
            targetPage.classList.add('active');

            // Особые действия для страницы Jitsi
            if (pageId === 'jitsiPage') {
                this.onJitsiPageShow();
            }
        }
    }

    onJitsiPageShow() {
        // Обновляем размеры для Telegram WebView
        if (this.webApp) {
            setTimeout(() => {
                this.webApp.expand();
                if (this.jitsiApi) {
                    // Даем время на отрисовку перед resize
                    setTimeout(() => {
                        this.jitsiApi.executeCommand('resize');
                    }, 500);
                }
            }, 100);
        }
    }

    showStatus(message, type = 'info', duration = 3000) {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        statusEl.style.display = 'block';

        setTimeout(() => {
            statusEl.style.display = 'none';
        }, duration);
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
            // Проверяем существование звонка
            const callInfo = await this.getCallInfo(code);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                this.isProcessing = false;
                return;
            }

            // Регистрируем участие
            await this.registerJoin(code);

            // Запускаем Jitsi внутри Mini App
            this.startJitsiInMiniApp(callInfo.room_name);

        } catch (error) {
            console.error('Join error:', error);
            this.showStatus('Ошибка подключения', 'error');
            this.isProcessing = false;
        }
    }

    // ОСНОВНОЕ ИСПРАВЛЕНИЕ: Jitsi внутри Mini App
    startJitsiInMiniApp(roomName) {
        console.log('🎬 Starting Jitsi inside Mini App:', roomName);

        try {
            // Очищаем контейнер
            const container = document.getElementById('jitsiContainer');
            container.innerHTML = '';

            // Конфигурация оптимизированная для Telegram WebView
            const options = {
                roomName: roomName,
                width: '100%',
                height: '100%',
                parentNode: container,
                configOverwrite: {
                    // Критически важные настройки для WebView
                    prejoinPageEnabled: false,
                    disableDeepLinking: true,
                    enableWelcomePage: false,
                    enableClosePage: false,

                    // Настройки для мобильных устройств
                    startWithAudioMuted: false,
                    startWithVideoMuted: false,
                    disableModeratorIndicator: true,
                    enableInsecureRoomNameWarning: false,
                    disableInviteFunctions: true,

                    // Оптимизация производительности
                    resolution: 360,
                    constraints: {
                        video: {
                            height: { ideal: 360, max: 720, min: 180 },
                            width: { ideal: 640, max: 1280, min: 320 }
                        },
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    },

                    // Отключаем ненужные функции для экономии трафика
                    disableThirdPartyRequests: true,
                    enableNoAudioDetection: true,
                    enableNoisyMicDetection: true,
                    analytics: {
                        disabled: true
                    }
                },
                interfaceConfigOverwrite: {
                    // Минималистичный интерфейс для мобильных
                    TOOLBAR_BUTTONS: [
                        'microphone', 'camera', 'hangup', 'tileview', 'settings'
                    ],

                    // Отключаем брендинг
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_BRAND_WATERMARK: false,
                    SHOW_POWERED_BY: false,
                    SHOW_PROMOTIONAL_CLOSE_PAGE: false,

                    // Оптимизация для мобильных
                    MOBILE_APP_PROMO: false,
                    VERTICAL_FILMSTRIP: true,
                    CLOSE_PAGE_GUEST_HINT: false,
                    DISABLE_VIDEO_BACKGROUND: false,

                    // Упрощаем интерфейс
                    SETTINGS_SECTIONS: ['devices', 'language'],
                    DEFAULT_BACKGROUND: '#182533'
                },
                userInfo: {
                    displayName: this.generateDisplayName()
                }
            };

            console.log('⚙️ Jitsi configuration:', options);

            // Создаем экземпляр Jitsi
            this.jitsiApi = new JitsiMeetExternalAPI('meet.jit.si', options);
            console.log('✅ Jitsi instance created');

            // Настраиваем обработчики событий
            this.setupJitsiEvents();

        } catch (error) {
            console.error('❌ Jitsi initialization error:', error);
            this.showStatus('Ошибка загрузки видеозвонка', 'error');
            this.isProcessing = false;

            // Fallback: открываем в браузере
            this.showStatus('Открываю в браузере...', 'info');
            setTimeout(() => {
                this.openJitsiInBrowser(roomName);
            }, 2000);
        }
    }

    setupJitsiEvents() {
        console.log('🔗 Setting up Jitsi events');

        this.jitsiApi.addEventListener('videoConferenceJoined', () => {
            console.log('🎉 VIDEO CONFERENCE JOINED');
            this.showPage('jitsiPage');
            this.showStatus('Подключено к видеозвонку!', 'success', 2000);
            this.isProcessing = false;

            // Обновляем размеры после подключения
            setTimeout(() => {
                if (this.jitsiApi) {
                    this.jitsiApi.executeCommand('resize');
                }
            }, 1000);
        });

        this.jitsiApi.addEventListener('videoConferenceLeft', () => {
            console.log('👋 VIDEO CONFERENCE LEFT');
            this.leaveCall();
        });

        this.jitsiApi.addEventListener('participantJoined', (participant) => {
            console.log('👤 PARTICIPANT JOINED:', participant.displayName);
        });

        this.jitsiApi.addEventListener('participantLeft', (participant) => {
            console.log('👤 PARTICIPANT LEFT:', participant.displayName);
        });

        // Обработка ошибок
        this.jitsiApi.addEventListener('connectionFailed', (error) => {
            console.error('🔌 CONNECTION FAILED:', error);
            this.showStatus('Ошибка подключения к серверу', 'error');
            this.isProcessing = false;
        });

        this.jitsiApi.addEventListener('conferenceError', (error) => {
            console.error('❌ CONFERENCE ERROR:', error);
            this.showStatus('Ошибка конференции', 'error');
            this.isProcessing = false;
        });

        this.jitsiApi.addEventListener('readyToClose', () => {
            console.log('🚪 READY TO CLOSE');
            this.leaveCall();
        });

        // Специальные события для мобильных устройств
        this.jitsiApi.addEventListener('suspendDetected', () => {
            console.log('📱 SUSPEND DETECTED');
        });

        // Таймаут на случай проблем с загрузкой
        setTimeout(() => {
            if (this.isProcessing) {
                console.log('⏰ Jitsi loading timeout');
                this.showPage('jitsiPage');
                this.showStatus('Загрузка завершена', 'info');
                this.isProcessing = false;
            }
        }, 15000);
    }

    generateDisplayName() {
        const names = ['Участник', 'Гость', 'Собеседник', 'Коллега'];
        const randomNum = Math.floor(Math.random() * 1000);
        return `${names[Math.floor(Math.random() * names.length)]}_${randomNum}`;
    }

    // Fallback метод на случай проблем
    openJitsiInBrowser(roomName) {
        const jitsiUrl = `https://meet.jit.si/${roomName}`;
        console.log('🌐 Fallback: Opening in browser:', jitsiUrl);

        if (this.webApp) {
            this.webApp.openLink(jitsiUrl);
            setTimeout(() => {
                this.webApp.close();
            }, 1000);
        } else {
            window.open(jitsiUrl, '_blank');
        }
    }

    leaveCall() {
        console.log('🚪 Leaving call');

        if (this.jitsiApi) {
            try {
                this.jitsiApi.dispose();
                console.log('✅ Jitsi disposed');
            } catch (error) {
                console.error('❌ Error disposing Jitsi:', error);
            }
            this.jitsiApi = null;
        }

        // Очищаем контейнер
        const container = document.getElementById('jitsiContainer');
        if (container) {
            container.innerHTML = '';
        }

        this.showPage('welcomePage');
        this.isProcessing = false;
        this.showStatus('Звонок завершен', 'info');
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
        this.showStatus('Используйте команду /create в боте Telegram', 'info');
    }
}

// Глобальная обработка ошибок
window.addEventListener('error', (event) => {
    console.error('🌍 Global error:', event.error);
});

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM loaded');

    try {
        // Проверяем наличие Jitsi API
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            throw new Error('Jitsi Meet API не загружен. Проверьте подключение к интернету.');
        }

        console.log('✅ Jitsi Meet API loaded');
        new TelegramCallApp();

    } catch (error) {
        console.error('❌ App initialization error:', error);

        // Показываем пользователю ошибку
        document.body.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: white; background: #182533; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <div style="font-size: 48px; margin-bottom: 20px;">📡</div>
                <h2 style="margin-bottom: 10px;">Ошибка загрузки</h2>
                <p style="color: #8ba0b2; margin-bottom: 10px; text-align: center;">${error.message}</p>
                <p style="color: #8ba0b2; margin-bottom: 30px; font-size: 14px;">Проверьте подключение к интернету</p>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #2ea6ff; color: white; border: none; border-radius: 8px; cursor: pointer;">
                    Повторить попытку
                </button>
            </div>
        `;
    }
});