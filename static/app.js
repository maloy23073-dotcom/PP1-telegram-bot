class JitsiVideoCall {
    constructor() {
        this.jitsiApi = null;
        this.isInitializing = false;
        this.isMobile = this.checkMobile();
        this.initializeElements();
        this.attachEventListeners();
        this.setupMobileOptimizations();
        this.log('App initialized - Mobile: ' + this.isMobile);
    }

    checkMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    setupMobileOptimizations() {
        // Оптимизации для мобильных устройств
        if (this.isMobile) {
            // Добавляем viewport meta tag если его нет
            if (!document.querySelector('meta[name="viewport"]')) {
                const meta = document.createElement('meta');
                meta.name = 'viewport';
                meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
                document.head.appendChild(meta);
            }

            // Предотвращаем zoom на input focus
            document.addEventListener('touchstart', function() {}, {passive: true});
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
        this.mobileControls = document.getElementById('mobileControls');
    }

    log(message) {
        console.log(`📱 ${this.isMobile ? 'MOBILE' : 'DESKTOP'}: ${message}`);
    }

    attachEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinCall());
        this.createCallBtn.addEventListener('click', () => this.createCall());
        this.backBtn.addEventListener('click', () => this.leaveCall());

        this.codeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinCall();
        });

        // Мобильные события
        if (this.isMobile) {
            this.codeInput.addEventListener('focus', () => this.onInputFocus());
            this.codeInput.addEventListener('blur', () => this.onInputBlur());
        }

        // Автозаполнение кода из URL
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            this.codeInput.value = code;
        }
    }

    onInputFocus() {
        // Для мобильных - немного поднимаем форму при фокусе
        if (this.isMobile) {
            setTimeout(() => {
                this.codeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    }

    onInputBlur() {
        // Возвращаем скролл после ввода
        if (this.isMobile) {
            setTimeout(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }, 300);
        }
    }

    showPage(page) {
        this.welcomePage.style.display = 'none';
        this.jitsiPage.style.display = 'none';
        page.style.display = 'flex';

        // Для мобильных - скрываем клавиатуру при переходе
        if (this.isMobile && page === this.jitsiPage) {
            this.codeInput.blur();
        }
    }

    showStatus(message, type = 'info', duration = 3000) {
        this.statusElement.textContent = message;
        this.statusElement.className = `status-message ${type} ${this.isMobile ? 'mobile' : ''}`;
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
        this.log('Starting Jitsi - Organizer: ' + callInfo.is_organizer);

        try {
            this.jitsiContainer.innerHTML = '';

            // Конфигурация для мобильных/десктоп
            const config = {
                roomName: callInfo.room_name,
                width: '100%',
                height: '100%',
                parentNode: this.jitsiContainer,
                configOverwrite: this.getJitsiConfig(callInfo),
                interfaceConfigOverwrite: this.getInterfaceConfig()
            };

            // Добавляем JWT токен если это организатор
            if (callInfo.is_organizer && callInfo.jwt_token) {
                config.jwt = callInfo.jwt_token;
                this.log('Using JWT token for moderator');
            }

            this.jitsiApi = new JitsiMeetExternalAPI('meet.jit.si', config);

            this.setupJitsiEvents();

        } catch (error) {
            this.log('Jitsi error: ' + error.message);
            this.showStatus('Ошибка загрузки', 'error');
            this.isInitializing = false;
        }
    }

    getJitsiConfig(callInfo) {
        const baseConfig = {
            prejoinPageEnabled: false,
            startWithAudioMuted: !callInfo.is_organizer, // Организатор с включенным звуком
            startWithVideoMuted: !callInfo.is_organizer, // Организатор с включенной камерой
            disableModeratorIndicator: false,
            enableWelcomePage: false,
            resolution: this.isMobile ? 360 : 720,
            constraints: {
                video: {
                    height: { ideal: this.isMobile ? 360 : 720 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            }
        };

        // Мобильные специфичные настройки
        if (this.isMobile) {
            baseConfig.disableAudioLevels = false;
            baseConfig.enableTalkWhileMuted = false;
            baseConfig.faceLandmarks = {
                enableFaceExpressionsDetection: false,
                enableFaceLandmarksDetection: false
            };
        }

        return baseConfig;
    }

    getInterfaceConfig() {
        return {
            TOOLBAR_BUTTONS: this.isMobile ? [
                'microphone', 'camera', 'hangup', 'desktop', 'fullscreen'
            ] : [
                'microphone', 'camera', 'closedcaptions', 'desktop', 'embedmeeting',
                'fullscreen', 'fodeviceselection', 'hangup', 'profile', 'chat',
                'recording', 'livestreaming', 'etherpad', 'sharedvideo', 'settings',
                'raisehand', 'videoquality', 'filmstrip', 'invite', 'feedback',
                'stats', 'shortcuts', 'tileview', 'videobackgroundblur', 'download',
                'help', 'mute-everyone', 'security'
            ],
            MOBILE_APP_PROMO: false,
            SHOW_CHROME_EXTENSION_BANNER: false,
            VERTICAL_FILMSTRIP: this.isMobile, // Вертикальная пленка на мобильных
            filmStripOnly: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false
        };
    }

    setupJitsiEvents() {
        this.jitsiApi.addEventListener('videoConferenceJoined', () => {
            this.log('Conference joined');
            this.showPage(this.jitsiPage);
            this.showStatus('Подключено!', 'success', 2000);
            this.isInitializing = false;
        });

        this.jitsiApi.addEventListener('videoConferenceLeft', () => {
            this.leaveCall();
        });

        this.jitsiApi.addEventListener('participantJoined', () => {
            this.log('New participant joined');
        });

        // Обработка ошибок
        this.jitsiApi.addEventListener('connectionFailed', () => {
            this.showStatus('Ошибка подключения', 'error');
            this.isInitializing = false;
        });

        // Таймаут
        setTimeout(() => {
            if (this.isInitializing) {
                this.log('Jitsi timeout');
                this.showPage(this.jitsiPage);
                this.isInitializing = false;
            }
        }, 15000);
    }

    leaveCall() {
        this.log('Leaving call');

        if (this.jitsiApi) {
            try {
                this.jitsiApi.dispose();
            } catch (error) {
                this.log('Dispose error: ' + error.message);
            }
            this.jitsiApi = null;
        }

        this.jitsiContainer.innerHTML = '';
        this.showPage(this.welcomePage);
        this.isInitializing = false;

        // Показываем статус только если не было ошибки
        if (!this.isInitializing) {
            this.showStatus('Звонок завершен', 'info', 2000);
        }
    }

    createCall() {
        this.showStatus('Используйте /create в боте Telegram', 'info');
    }
}

// Инициализация с мобильной оптимизацией
document.addEventListener('DOMContentLoaded', () => {
    try {
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            throw new Error('Jitsi API не загружен');
        }

        // Mobile-specific optimizations
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
            // Prevent bounce effect on iOS
            document.body.style.overflow = 'hidden';
            document.body.style.height = '100vh';
        }

        window.videoCallApp = new JitsiVideoCall();

    } catch (error) {
        console.error('Initialization error:', error);
        document.body.innerHTML = `
            <div style="padding: 20px; text-align: center; color: white; background: #0f0f0f; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
                <h2>😔 Ошибка загрузки</h2>
                <p>${error.message}</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #2b87db; color: white; border: none; border-radius: 8px; cursor: pointer;">
                    Попробовать снова
                </button>
            </div>
        `;
    }
});