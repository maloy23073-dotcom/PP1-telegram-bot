class JitsiVideoCall {
    constructor() {
        this.jitsiApi = null;
        this.initializeElements();
        this.attachEventListeners();
        this.expandMiniApp();
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

    expandMiniApp() {
        // Расширяем Mini App на весь экран
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.expand();
            window.Telegram.WebApp.enableClosingConfirmation();
        }
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
        this.welcomePage.classList.remove('active');
        this.jitsiPage.classList.remove('active');
        page.classList.add('active');
    }

    showStatus(message, type = 'info') {
        this.statusElement.textContent = message;
        this.statusElement.className = `status-message ${type}`;
        this.statusElement.style.display = 'block';

        setTimeout(() => {
            this.statusElement.style.display = 'none';
        }, 3000);
    }

    async joinCall() {
        const code = this.codeInput.value.trim();

        if (!code) {
            this.showStatus('Введите код звонка', 'error');
            return;
        }

        this.showStatus('Подключение к видеозвонку...', 'info');

        try {
            // Проверяем существование звонка
            const callInfo = await this.getCallInfo(code);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                return;
            }

            // Регистрируем участие
            await this.registerJoin(code);

            // Запускаем Jitsi
            this.startJitsiMeet(callInfo.room_name);

        } catch (error) {
            console.error('Error joining call:', error);
            this.showStatus('Ошибка подключения', 'error');
        }
    }

    async createCall() {
        this.showStatus('Используйте команду /create в боте Telegram', 'info');
    }

    startJitsiMeet(roomName) {
        try {
            // Очищаем контейнер перед инициализацией
            this.jitsiContainer.innerHTML = '';

            const domain = 'meet.jit.si';

            // Конфигурация для Mobile/Telegram
            const options = {
                roomName: roomName,
                width: '100%',
                height: '100%',
                parentNode: this.jitsiContainer,
                configOverwrite: {
                    prejoinPageEnabled: false, // Пропускаем страницу предварительного присоединения
                    startWithAudioMuted: false,
                    startWithVideoMuted: false,
                    disableModeratorIndicator: false,
                    startScreenSharing: false,
                    enableEmailInStats: false,
                    disableInviteFunctions: true,
                    disableRecordAudioNotification: true,
                    enableNoAudioDetection: true,
                    enableNoisyMicDetection: true,
                    resolution: 360, // Оптимальное для мобильных
                    constraints: {
                        video: {
                            height: { ideal: 360, max: 720, min: 180 }
                        },
                        audio: {
                            stereo: false,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    },
                    prejoinConfig: {
                        enabled: false
                    }
                },
                interfaceConfigOverwrite: {
                    // Упрощенный интерфейс для мобильных
                    TOOLBAR_BUTTONS: [
                        'microphone', 'camera', 'hangup', 'settings', 'videoquality'
                    ],
                    SETTINGS_SECTIONS: ['devices', 'language'],
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_BRAND_WATERMARK: false,
                    SHOW_POWERED_BY: false,
                    SHOW_PROMOTIONAL_CLOSE_PAGE: false,
                    MOBILE_APP_PROMO: false,
                    VERTICAL_FILMSTRIP: true, // Вертикальная пленка для мобильных
                    CLOSE_PAGE_GUEST_HINT: false,
                    DISABLE_VIDEO_BACKGROUND: false,
                    DISABLE_FOCUS_INDICATOR: false,
                    TILE_VIEW_MAX_COLUMNS: 3
                },
                userInfo: {
                    displayName: this.generateDisplayName()
                }
            };

            console.log('Initializing Jitsi Meet with options:', options);

            this.jitsiApi = new JitsiMeetExternalAPI(domain, options);

            // Обработчики событий Jitsi
            this.jitsiApi.addEventListener('videoConferenceJoined', (payload) => {
                console.log('✅ Joined Jitsi conference:', payload);
                this.showPage(this.jitsiPage);
                this.showStatus('Подключено к видеозвонку', 'success');

                // Скрываем статус через 2 секунды
                setTimeout(() => {
                    this.statusElement.style.display = 'none';
                }, 2000);
            });

            this.jitsiApi.addEventListener('videoConferenceLeft', () => {
                console.log('Left Jitsi conference');
                this.leaveCall();
            });

            this.jitsiApi.addEventListener('participantJoined', (payload) => {
                console.log('Participant joined:', payload);
                this.showStatus('Новый участник присоединился', 'info');
            });

            this.jitsiApi.addEventListener('participantLeft', (payload) => {
                console.log('Participant left:', payload);
                this.showStatus('Участник вышел', 'info');
            });

            this.jitsiApi.addEventListener('audioMuteStatusChanged', (payload) => {
                console.log('Audio mute status changed:', payload);
            });

            this.jitsiApi.addEventListener('videoMuteStatusChanged', (payload) => {
                console.log('Video mute status changed:', payload);
            });

            this.jitsiApi.addEventListener('readyToClose', () => {
                console.log('Jitsi ready to close');
                this.leaveCall();
            });

        } catch (error) {
            console.error('❌ Error initializing Jitsi Meet:', error);
            this.showStatus('Ошибка загрузки видеозвонка', 'error');
        }
    }

    generateDisplayName() {
        // Генерируем случайное имя для участника
        const adjectives = ['Веселый', 'Серьезный', 'Умный', 'Дружелюбный', 'Спокойный'];
        const nouns = ['Котик', 'Пёсик', 'Тигр', 'Медведь', 'Орёл'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj} ${noun}`;
    }

    leaveCall() {
        if (this.jitsiApi) {
            try {
                this.jitsiApi.dispose();
                this.jitsiApi = null;
            } catch (error) {
                console.error('Error disposing Jitsi:', error);
            }
        }

        // Очищаем контейнер
        this.jitsiContainer.innerHTML = '';

        // Возвращаемся на главную
        this.showPage(this.welcomePage);
        this.showStatus('Звонок завершен', 'info');
    }

    async getCallInfo(code) {
        const response = await fetch(`/call/${code}/info`);
        return await response.json();
    }

    async registerJoin(code) {
        const response = await fetch(`/call/${code}/join`, {
            method: 'POST'
        });
        return await response.json();
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    // Ждем загрузки Jitsi API
    if (typeof JitsiMeetExternalAPI === 'undefined') {
        console.error('Jitsi Meet API not loaded');
        document.getElementById('status').textContent = 'Ошибка загрузки Jitsi Meet';
        return;
    }

    window.videoCallApp = new JitsiVideoCall();
    console.log('✅ Jitsi VideoCall App initialized');
});

// Обработка ошибок загрузки Jitsi
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});