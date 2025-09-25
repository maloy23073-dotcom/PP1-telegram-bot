// Простая инициализация Telegram WebApp
function initTelegramWebApp() {
    if (window.Telegram && window.Telegram.WebApp) {
        const webApp = Telegram.WebApp;

        // Расширяем на весь экран
        webApp.expand();
        webApp.enableClosingConfirmation();

        // Устанавливаем цвета
        webApp.setHeaderColor('#182533');
        webApp.setBackgroundColor('#182533');

        console.log('✅ Telegram WebApp initialized');
        return webApp;
    }
    console.log('⚠️ Telegram WebApp not detected - running in browser mode');
    return null;
}

// Основной класс приложения
class VideoCallApp {
    constructor() {
        this.webApp = initTelegramWebApp();
        this.jitsiApi = null;
        this.isInitializing = false;
        this.init();
    }

    init() {
        console.log('🚀 Initializing VideoCall App');
        this.bindEvents();
        this.checkUrlCode();
        console.log('✅ VideoCall App initialized');
    }

    bindEvents() {
        console.log('🔗 Binding events');

        document.getElementById('joinBtn').addEventListener('click', () => {
            console.log('🎯 Join button clicked');
            this.joinCall();
        });

        document.getElementById('createCallBtn').addEventListener('click', () => {
            console.log('🎯 Create button clicked');
            this.createCall();
        });

        document.getElementById('backBtn').addEventListener('click', () => {
            console.log('🎯 Back button clicked');
            this.leaveCall();
        });

        document.getElementById('codeInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                console.log('🎯 Enter key pressed');
                this.joinCall();
            }
        });

        // Логируем изменения значения кода
        document.getElementById('codeInput').addEventListener('input', (e) => {
            console.log('⌨️ Code input:', e.target.value);
        });
    }

    checkUrlCode() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            console.log('🔗 Code from URL:', code);
            document.getElementById('codeInput').value = code;
        }
    }

    showPage(pageId) {
        console.log('📄 Showing page:', pageId);

        document.querySelectorAll('.page').forEach(page => {
            page.style.display = 'none';
        });

        const targetPage = document.getElementById(pageId);
        if (targetPage) {
            targetPage.style.display = 'flex';
            console.log('✅ Page displayed:', pageId);
        } else {
            console.error('❌ Page not found:', pageId);
        }
    }

    showStatus(message, type = 'info') {
        console.log('📢 Status:', message, type);

        const statusEl = document.getElementById('status');
        if (!statusEl) {
            console.error('❌ Status element not found');
            return;
        }

        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        statusEl.style.display = 'block';

        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }

    async joinCall() {
        if (this.isInitializing) {
            console.log('⏳ Already initializing, skipping');
            return;
        }

        this.isInitializing = true;
        const code = document.getElementById('codeInput').value.trim();

        console.log('🔍 Starting join process for code:', code);

        if (code.length !== 6) {
            this.showStatus('Введите 6-значный код', 'error');
            this.isInitializing = false;
            return;
        }

        this.showStatus('Проверка кода...', 'info');

        try {
            // Шаг 1: Проверяем код звонка
            console.log('📞 Step 1: Checking call info');
            const callInfo = await this.getCallInfo(code);
            console.log('📊 Call info response:', callInfo);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                this.isInitializing = false;
                return;
            }

            if (!callInfo.active) {
                this.showStatus('Звонок завершен', 'error');
                this.isInitializing = false;
                return;
            }

            // Шаг 2: Регистрируем участие
            console.log('📝 Step 2: Registering join');
            this.showStatus('Регистрация...', 'info');
            const joinResult = await this.registerJoin(code);
            console.log('✅ Join result:', joinResult);

            // Шаг 3: Запускаем Jitsi
            console.log('🎥 Step 3: Starting Jitsi');
            this.showStatus('Загрузка видеозвонка...', 'info');
            this.startJitsi(callInfo.room_name);

        } catch (error) {
            console.error('❌ Join call error:', error);
            this.showStatus('Ошибка подключения: ' + error.message, 'error');
            this.isInitializing = false;
        }
    }

    async getCallInfo(code) {
        console.log('🌐 Fetching call info for code:', code);

        try {
            const response = await fetch(`/call/${code}/info`);
            console.log('📡 Response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('📋 Call info data:', data);
            return data;
        } catch (error) {
            console.error('❌ Get call info error:', error);
            throw error;
        }
    }

    async registerJoin(code) {
        console.log('🌐 Registering join for code:', code);

        try {
            const response = await fetch(`/call/${code}/join`, {
                method: 'POST'
            });
            console.log('📡 Join response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ Join registration data:', data);
            return data;
        } catch (error) {
            console.error('❌ Register join error:', error);
            throw error;
        }
    }

    startJitsi(roomName) {
        console.log('🎬 Starting Jitsi for room:', roomName);

        try {
            // Очищаем контейнер
            const container = document.getElementById('jitsiContainer');
            container.innerHTML = '';
            console.log('✅ Container cleared');

            // Проверяем доступность Jitsi API
            if (typeof JitsiMeetExternalAPI === 'undefined') {
                throw new Error('Jitsi Meet API не загружен');
            }
            console.log('✅ Jitsi API is available');

            const options = {
                roomName: roomName,
                width: '100%',
                height: '100%',
                parentNode: container,
                configOverwrite: {
                    prejoinPageEnabled: false, // Убираем страницу выбора
                    startWithAudioMuted: false,
                    startWithVideoMuted: false,
                    disableModeratorIndicator: true,
                    enableWelcomePage: false,
                    enableClosePage: false
                },
                interfaceConfigOverwrite: {
                    TOOLBAR_BUTTONS: [
                        'microphone', 'camera', 'hangup', 'tileview'
                    ],
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_POWERED_BY: false,
                    MOBILE_APP_PROMO: false
                }
            };

            console.log('⚙️ Jitsi options:', options);

            // Создаем экземпляр Jitsi
            this.jitsiApi = new JitsiMeetExternalAPI('meet.jit.si', options);
            console.log('✅ Jitsi instance created');

            // Настраиваем обработчики событий
            this.setupJitsiEvents();

        } catch (error) {
            console.error('❌ Jitsi initialization error:', error);
            this.showStatus('Ошибка загрузки видеозвонка: ' + error.message, 'error');
            this.isInitializing = false;

            // Показываем страницу Jitsi даже при ошибке для отладки
            this.showPage('jitsiPage');
        }
    }

    setupJitsiEvents() {
        console.log('🔗 Setting up Jitsi events');

        this.jitsiApi.addEventListener('videoConferenceJoined', () => {
            console.log('🎉 VIDEO CONFERENCE JOINED - Success!');
            this.showPage('jitsiPage');
            this.showStatus('Подключено к видеозвонку!', 'success');
            this.isInitializing = false;
        });

        this.jitsiApi.addEventListener('videoConferenceLeft', () => {
            console.log('👋 VIDEO CONFERENCE LEFT');
            this.leaveCall();
        });

        this.jitsiApi.addEventListener('participantJoined', (participant) => {
            console.log('👤 PARTICIPANT JOINED:', participant);
        });

        this.jitsiApi.addEventListener('participantLeft', (participant) => {
            console.log('👤 PARTICIPANT LEFT:', participant);
        });

        // Обработка ошибок
        this.jitsiApi.addEventListener('connectionFailed', () => {
            console.error('🔌 CONNECTION FAILED');
            this.showStatus('Ошибка подключения к серверу', 'error');
            this.isInitializing = false;
        });

        this.jitsiApi.addEventListener('conferenceError', (error) => {
            console.error('❌ CONFERENCE ERROR:', error);
            this.showStatus('Ошибка конференции', 'error');
            this.isInitializing = false;
        });

        this.jitsiApi.addEventListener('readyToClose', () => {
            console.log('🚪 READY TO CLOSE');
            this.leaveCall();
        });

        // Таймаут на случай если Jitsi не загрузится
        setTimeout(() => {
            if (this.isInitializing) {
                console.log('⏰ Jitsi timeout - forcing page switch');
                this.showPage('jitsiPage');
                this.showStatus('Проверьте подключение к интернету', 'info');
                this.isInitializing = false;
            }
        }, 10000);
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
        this.isInitializing = false;
        this.showStatus('Звонок завершен', 'info');

        // Закрываем Mini App если это Telegram
        if (this.webApp) {
            setTimeout(() => {
                this.webApp.close();
            }, 2000);
        }
    }

    createCall() {
        console.log('📝 Create call requested');
        this.showStatus('Используйте команду /create в боте Telegram', 'info');
    }
}

// Глобальный обработчик ошибок
window.addEventListener('error', (event) => {
    console.error('🌍 Global error:', event.error);
});

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM loaded');

    try {
        // Проверяем загрузку Jitsi API
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            console.error('❌ Jitsi Meet API not loaded');
            document.body.innerHTML = `
                <div style="padding: 40px; text-align: center; color: white; background: #182533; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
                    <h2>Ошибка загрузки</h2>
                    <p>Jitsi Meet API не загружен</p>
                    <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #2ea6ff; color: white; border: none; border-radius: 8px; cursor: pointer;">
                        Обновить страницу
                    </button>
                </div>
            `;
            return;
        }

        console.log('✅ Jitsi Meet API loaded');
        new VideoCallApp();

    } catch (error) {
        console.error('❌ App initialization error:', error);
    }
});