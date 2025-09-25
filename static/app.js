class JitsiVideoCall {
    constructor() {
        this.jitsiApi = null;
        this.initializeElements();
        this.attachEventListeners();
        this.expandMiniApp();
        this.log('App initialized');
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

    log(message, data = null) {
        console.log(`📝 ${message}`, data || '');
        // Также показываем в статусе для отладки
        if (typeof data !== 'undefined') {
            this.showStatus(`${message} - ${JSON.stringify(data)}`, 'info');
        }
    }

    expandMiniApp() {
        this.log('Expanding Mini App');
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.expand();
            this.log('Mini App expanded');
        } else {
            this.log('Telegram WebApp API not available');
        }
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
            this.log('Code from URL:', code);
        }
    }

    showPage(page) {
        this.welcomePage.classList.remove('active');
        this.jitsiPage.classList.remove('active');
        page.classList.add('active');
        this.log(`Showing page: ${page.id}`);
    }

    showStatus(message, type = 'info') {
        this.statusElement.textContent = message;
        this.statusElement.className = `status-message ${type}`;
        this.statusElement.style.display = 'block';
        this.log(`Status: ${message}`);

        if (type !== 'error') {
            setTimeout(() => {
                this.statusElement.style.display = 'none';
            }, 5000);
        }
    }

    async joinCall() {
        const code = this.codeInput.value.trim();
        this.log('Join call started', { code });

        if (!code) {
            this.showStatus('Введите код звонка', 'error');
            return;
        }

        this.showStatus('Проверка кода...', 'info');

        try {
            // Шаг 1: Проверяем код на сервере
            this.log('Step 1: Checking call info');
            const callInfo = await this.getCallInfo(code);
            this.log('Call info response:', callInfo);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                return;
            }

            // Шаг 2: Регистрируем участие
            this.log('Step 2: Registering join');
            const joinResult = await this.registerJoin(code);
            this.log('Join result:', joinResult);

            // Шаг 3: Запускаем Jitsi
            this.log('Step 3: Starting Jitsi Meet');
            this.showStatus('Загрузка видеозвонка...', 'info');
            this.startJitsiMeet(callInfo.room_name);

        } catch (error) {
            this.log('Error in joinCall:', error);
            this.showStatus(`Ошибка: ${error.message}`, 'error');
        }
    }

    async getCallInfo(code) {
        this.log(`Fetching call info for code: ${code}`);
        try {
            const response = await fetch(`/call/${code}/info`);
            this.log('Response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.log('Call info data:', data);
            return data;
        } catch (error) {
            this.log('Error fetching call info:', error);
            throw error;
        }
    }

    async registerJoin(code) {
        this.log(`Registering join for code: ${code}`);
        try {
            const response = await fetch(`/call/${code}/join`, {
                method: 'POST'
            });
            this.log('Join response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.log('Join response data:', data);
            return data;
        } catch (error) {
            this.log('Error registering join:', error);
            throw error;
        }
    }

    startJitsiMeet(roomName) {
        this.log('Starting Jitsi Meet', { roomName });

        try {
            // Очищаем контейнер
            this.jitsiContainer.innerHTML = '';

            // Проверяем доступность Jitsi API
            if (typeof JitsiMeetExternalAPI === 'undefined') {
                throw new Error('Jitsi Meet API не загружен');
            }

            this.log('Jitsi API is available');

            const domain = 'meet.jit.si';

            // Минимальная конфигурация для тестирования
            const options = {
                roomName: roomName,
                width: '100%',
                height: '100%',
                parentNode: this.jitsiContainer,
                configOverwrite: {
                    prejoinPageEnabled: false,
                    startWithAudioMuted: false,
                    startWithVideoMuted: false,
                    disableThirdPartyRequests: true,
                    enableWelcomePage: false,
                    enableClosePage: false
                },
                interfaceConfigOverwrite: {
                    TOOLBAR_BUTTONS: [
                        'microphone', 'camera', 'hangup', 'settings'
                    ],
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_POWERED_BY: false
                }
            };

            this.log('Jitsi options:', options);

            // Создаем экземпляр Jitsi
            this.jitsiApi = new JitsiMeetExternalAPI(domain, options);
            this.log('Jitsi instance created');

            // Добавляем обработчики событий
            this.jitsiApi.addEventListener('videoConferenceJoined', () => {
                this.log('✅ VIDEO CONFERENCE JOINED');
                this.showPage(this.jitsiPage);
                this.showStatus('Подключено!', 'success');
            });

            this.jitsiApi.addEventListener('videoConferenceLeft', () => {
                this.log('VIDEO CONFERENCE LEFT');
                this.leaveCall();
            });

            this.jitsiApi.addEventListener('participantJoined', (payload) => {
                this.log('PARTICIPANT JOINED', payload);
                this.showStatus('Участник присоединился', 'info');
            });

            this.jitsiApi.addEventListener('participantLeft', (payload) => {
                this.log('PARTICIPANT LEFT', payload);
                this.showStatus('Участник вышел', 'info');
            });

            this.jitsiApi.addEventListener('readyToClose', () => {
                this.log('READY TO CLOSE');
                this.leaveCall();
            });

            this.jitsiApi.addEventListener('connectionFailed', () => {
                this.log('CONNECTION FAILED');
                this.showStatus('Ошибка подключения', 'error');
            });

            this.jitsiApi.addEventListener('loadConfigError', (error) => {
                this.log('LOAD CONFIG ERROR', error);
                this.showStatus('Ошибка конфигурации', 'error');
            });

            this.jitsiApi.addEventListener('proxyConnectionError', (error) => {
                this.log('PROXY CONNECTION ERROR', error);
                this.showStatus('Ошибка сети', 'error');
            });

            // Таймаут для проверки загрузки
            setTimeout(() => {
                if (this.jitsiPage.classList.contains('active')) {
                    this.log('Jitsi loaded successfully');
                } else {
                    this.log('Jitsi loading timeout - showing page anyway');
                    this.showPage(this.jitsiPage);
                    this.showStatus('Проверьте подключение', 'info');
                }
            }, 10000);

        } catch (error) {
            this.log('❌ Error starting Jitsi Meet:', error);
            this.showStatus(`Ошибка Jitsi: ${error.message}`, 'error');

            // Показываем страницу Jitsi даже при ошибке
            this.showPage(this.jitsiPage);
        }
    }

    leaveCall() {
        this.log('Leaving call');

        if (this.jitsiApi) {
            try {
                this.jitsiApi.dispose();
                this.jitsiApi = null;
                this.log('Jitsi disposed');
            } catch (error) {
                this.log('Error disposing Jitsi:', error);
            }
        }

        this.jitsiContainer.innerHTML = '';
        this.showPage(this.welcomePage);
        this.showStatus('Звонок завершен', 'info');
    }

    async createCall() {
        this.showStatus('Используйте /create в боте Telegram', 'info');
    }
}

// Инициализация с обработкой ошибок
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Проверяем загрузку Jitsi API
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            console.error('❌ Jitsi Meet API not loaded');
            document.getElementById('status').textContent = 'Ошибка: Jitsi API не загружен';
            document.getElementById('status').style.display = 'block';
            return;
        }

        console.log('✅ Jitsi Meet API loaded successfully');
        window.videoCallApp = new JitsiVideoCall();

    } catch (error) {
        console.error('❌ App initialization error:', error);
        document.getElementById('status').textContent = `Ошибка инициализации: ${error.message}`;
        document.getElementById('status').style.display = 'block';
    }
});

// Глобальный обработчик ошибок
window.addEventListener('error', (event) => {
    console.error('🌍 Global error:', event.error);
    if (window.videoCallApp) {
        window.videoCallApp.showStatus(`Ошибка: ${event.error.message}`, 'error');
    }
});