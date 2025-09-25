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

        console.log('Telegram WebApp initialized');
        return webApp;
    }
    return null;
}

// Основной класс приложения
class VideoCallApp {
    constructor() {
        this.webApp = initTelegramWebApp();
        this.jitsiApi = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkUrlCode();
        console.log('VideoCall App initialized');
    }

    bindEvents() {
        document.getElementById('joinBtn').addEventListener('click', () => this.joinCall());
        document.getElementById('createCallBtn').addEventListener('click', () => this.createCall());
        document.getElementById('backBtn').addEventListener('click', () => this.leaveCall());

        document.getElementById('codeInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinCall();
        });
    }

    checkUrlCode() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            document.getElementById('codeInput').value = code;
        }
    }

    showPage(pageId) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(pageId).classList.add('active');
    }

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        statusEl.style.display = 'block';

        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }

    async joinCall() {
        const code = document.getElementById('codeInput').value.trim();

        if (code.length !== 6) {
            this.showStatus('Введите 6-значный код', 'error');
            return;
        }

        this.showStatus('Подключение...', 'info');

        try {
            // Проверяем код
            const callInfo = await this.getCallInfo(code);
            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                return;
            }

            // Регистрируем участие
            await this.registerJoin(code);

            // Запускаем Jitsi
            this.startJitsi(callInfo.room_name);

        } catch (error) {
            this.showStatus('Ошибка подключения', 'error');
        }
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

    startJitsi(roomName) {
        try {
            const container = document.getElementById('jitsiContainer');
            container.innerHTML = '';

            const options = {
                roomName: roomName,
                width: '100%',
                height: '100%',
                parentNode: container,
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

            this.jitsiApi.addEventListener('videoConferenceJoined', () => {
                this.showPage('jitsiPage');
                this.showStatus('Подключено!', 'success');
            });

            this.jitsiApi.addEventListener('videoConferenceLeft', () => {
                this.leaveCall();
            });

        } catch (error) {
            this.showStatus('Ошибка загрузки видеозвонка', 'error');
        }
    }

    leaveCall() {
        if (this.jitsiApi) {
            this.jitsiApi.dispose();
        }
        this.showPage('welcomePage');

        if (this.webApp) {
            this.webApp.close();
        }
    }

    createCall() {
        this.showStatus('Используйте /create в боте Telegram', 'info');
    }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
    new VideoCallApp();
});