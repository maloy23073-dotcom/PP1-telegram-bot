class JitsiVideoCall {
    constructor() {
        this.jitsiApi = null;
        this.isInitializing = false;
        this.initializeElements();
        this.attachEventListeners();
        this.setupTelegramApp();
        this.log('App initialized');
    }

    setupTelegramApp() {
        if (window.Telegram && window.Telegram.WebApp) {
            const webApp = window.Telegram.WebApp;
            webApp.expand();
            webApp.setBackgroundColor('#182533');
            this.log('Telegram WebApp configured');
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

        this.codeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinCall();
        });

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

            if (!callInfo.active) {
                this.showStatus('Звонок завершен', 'error');
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
        this.log(`Starting Jitsi Meet - Room: ${callInfo.room_name}`);

        try {
            this.jitsiContainer.innerHTML = '';

            // Базовая конфигурация для открытых комнат
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
                    enableNoAudioDetection: true,
                    disableModeratorIndicator: true,
                    enableInsecureRoomNameWarning: false,
                    disableInviteFunctions: false,
                    enableLobbyChat: false
                },
                interfaceConfigOverwrite: {
                    TOOLBAR_BUTTONS: [
                        'microphone', 'camera', 'hangup', 'tileview', 'settings'
                    ],
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_POWERED_BY: false,
                    MOBILE_APP_PROMO: false
                }
            };

            // Добавляем JWT токен если он есть
            if (callInfo.jwt_token) {
                config.jwt = callInfo.jwt_token;
                this.log('Using JWT token for authentication');
            } else {
                this.log('Using open room access');
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

        // Обработка ошибок доступа
        this.jitsiApi.addEventListener('connectionFailed', (event) => {
            this.log('Connection failed: ' + JSON.stringify(event));
            this.showStatus('Ошибка подключения к серверу', 'error');
            this.isInitializing = false;
        });

        this.jitsiApi.addEventListener('conferenceError', (error) => {
            this.log('Conference error: ' + JSON.stringify(error));

            if (error.error.includes('not allowed') || error.error.includes('permission')) {
                this.showStatus('Нет доступа к этому звонку', 'error');
            } else {
                this.showStatus('Ошибка конференции: ' + error.error, 'error');
            }
            this.isInitializing = false;
        });

        // Таймаут
        setTimeout(() => {
            if (this.isInitializing) {
                this.showStatus('Проверьте подключение к интернету', 'info');
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
    }

    createCall() {
        this.showStatus('Используйте команду /create в боте Telegram', 'info');
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    try {
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            throw new Error('Jitsi Meet API не загружен');
        }

        window.videoCallApp = new JitsiVideoCall();

    } catch (error) {
        console.error('Initialization error:', error);
        document.body.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; color: white; background: #182533; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
                <h2 style="margin-bottom: 10px;">Ошибка загрузки</h2>
                <p style="color: #8ba0b2; margin-bottom: 30px;">${error.message}</p>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #2ea6ff; color: white; border: none; border-radius: 8px; cursor: pointer;">
                    Попробовать снова
                </button>
            </div>
        `;
    }
});