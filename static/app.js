class JitsiVideoCall {
    constructor() {
        this.jitsiApi = null;
        this.isInitializing = false;
        this.initializeElements();
        this.attachEventListeners();
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

    log(message) {
        console.log(`📝 ${message}`);
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
        // Простое переключение без рекурсии
        this.welcomePage.style.display = page.id === 'welcomePage' ? 'flex' : 'none';
        this.jitsiPage.style.display = page.id === 'jitsiPage' ? 'flex' : 'none';
        this.log(`Showing page: ${page.id}`);
    }

    showStatus(message, type = 'info') {
        this.statusElement.textContent = message;
        this.statusElement.className = `status-message ${type}`;
        this.statusElement.style.display = 'block';
        this.log(`Status: ${message}`);

        setTimeout(() => {
            this.statusElement.style.display = 'none';
        }, 3000);
    }

    async joinCall() {
        if (this.isInitializing) {
            this.log('Already initializing, skipping');
            return;
        }

        this.isInitializing = true;
        const code = this.codeInput.value.trim();

        if (!code) {
            this.showStatus('Введите код звонка', 'error');
            this.isInitializing = false;
            return;
        }

        this.showStatus('Подключение...', 'info');

        try {
            // 1. Проверяем код
            const callInfo = await this.getCallInfo(code);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                this.isInitializing = false;
                return;
            }

            // 2. Регистрируем участие
            await this.registerJoin(code);

            // 3. Запускаем Jitsi
            this.startJitsiMeet(callInfo.room_name);

        } catch (error) {
            this.log('Error in joinCall:', error);
            this.showStatus('Ошибка подключения', 'error');
            this.isInitializing = false;
        }
    }

    async getCallInfo(code) {
        try {
            const response = await fetch(`/call/${code}/info`);
            if (!response.ok) throw new Error('Network error');
            return await response.json();
        } catch (error) {
            throw new Error('Не удалось проверить код');
        }
    }

    async registerJoin(code) {
        try {
            const response = await fetch(`/call/${code}/join`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error('Network error');
            return await response.json();
        } catch (error) {
            throw new Error('Не удалось присоединиться');
        }
    }

    startJitsiMeet(roomName) {
        this.log('Starting Jitsi Meet: ' + roomName);

        try {
            // Очищаем контейнер
            this.jitsiContainer.innerHTML = '';

            // Минимальная конфигурация
            const options = {
                roomName: roomName,
                width: '100%',
                height: '100%',
                parentNode: this.jitsiContainer,
                configOverwrite: {
                    prejoinPageEnabled: false,
                    startWithAudioMuted: false,
                    startWithVideoMuted: false
                },
                interfaceConfigOverwrite: {
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_POWERED_BY: false
                }
            };

            this.jitsiApi = new JitsiMeetExternalAPI('meet.jit.si', options);

            // Простые обработчики событий
            this.jitsiApi.addEventListener('videoConferenceJoined', () => {
                this.log('Conference joined');
                this.showPage(this.jitsiPage);
                this.showStatus('Подключено!', 'success');
                this.isInitializing = false;
            });

            this.jitsiApi.addEventListener('videoConferenceLeft', () => {
                this.log('Conference left');
                this.leaveCall();
            });

            this.jitsiApi.addEventListener('participantJoined', () => {
                this.log('Participant joined');
            });

            // Таймаут на случай проблем
            setTimeout(() => {
                if (!this.isInitializing) return;
                this.log('Jitsi timeout - forcing display');
                this.showPage(this.jitsiPage);
                this.isInitializing = false;
            }, 10000);

        } catch (error) {
            this.log('Jitsi error: ' + error.message);
            this.showStatus('Ошибка загрузки Jitsi', 'error');
            this.isInitializing = false;
        }
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
        this.showStatus('Используйте /create в боте', 'info');
    }
}

// Простая инициализация
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Проверяем Jitsi API
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            throw new Error('Jitsi API not loaded');
        }

        // Инициализируем приложение
        window.videoCallApp = new JitsiVideoCall();

        // Показываем welcome page
        document.getElementById('welcomePage').style.display = 'flex';
        document.getElementById('jitsiPage').style.display = 'none';

        console.log('✅ App initialized successfully');

    } catch (error) {
        console.error('❌ Initialization error:', error);
        document.body.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <h2>Ошибка загрузки</h2>
                <p>${error.message}</p>
                <button onclick="location.reload()">Перезагрузить</button>
            </div>
        `;
    }
});