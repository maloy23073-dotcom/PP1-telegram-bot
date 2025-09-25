class JitsiVideoCall {
    constructor() {
        this.initializeElements();
        this.attachEventListeners();
        this.jitsiApi = null;
        this.roomCode = '';
    }

    initializeElements() {
        this.welcomePage = document.getElementById('welcomePage');
        this.loadingPage = document.getElementById('loadingPage');
        this.jitsiPage = document.getElementById('jitsiPage');
        this.codeInput = document.getElementById('codeInput');
        this.joinBtn = document.getElementById('joinBtn');
        this.createCallBtn = document.getElementById('createCallBtn');
        this.cancelBtn = document.getElementById('cancelBtn');
        this.leaveJitsiBtn = document.getElementById('leaveJitsiBtn');
        this.loadingStatus = document.getElementById('loadingStatus');
        this.statusElement = document.getElementById('status');
    }

    attachEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinCall());
        this.createCallBtn.addEventListener('click', () => this.createCall());
        this.cancelBtn.addEventListener('click', () => this.cancelJoin());
        this.leaveJitsiBtn.addEventListener('click', () => this.leaveCall());

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
        this.loadingPage.classList.remove('active');
        this.jitsiPage.classList.remove('active');
        page.classList.add('active');
    }

    showStatus(message, type = 'info') {
        this.statusElement.textContent = message;
        this.statusElement.className = `status-message ${type}`;
        this.statusElement.classList.add('show');

        setTimeout(() => {
            this.statusElement.classList.remove('show');
        }, 3000);
    }

    updateLoadingStatus(message) {
        if (this.loadingStatus) {
            this.loadingStatus.textContent = message;
        }
    }

    async joinCall() {
        const code = this.codeInput.value.trim();

        if (!code) {
            this.showStatus('Введите код звонка', 'error');
            return;
        }

        this.roomCode = code;
        this.showPage(this.loadingPage);

        try {
            // Проверяем существование звонка
            this.updateLoadingStatus('Проверка кода звонка...');
            const callInfo = await this.getCallInfo(code);

            if (!callInfo.exists) {
                this.showStatus('Звонок не найден', 'error');
                this.showPage(this.welcomePage);
                return;
            }

            // Регистриуем участие
            this.updateLoadingStatus('Подготовка видеозвонка...');
            await this.registerJoin(code);

            // Запускаем Jitsi
            this.updateLoadingStatus('Загрузка Jitsi Meet...');
            await this.startJitsiMeet(callInfo.room_name);

        } catch (error) {
            console.error('Error joining call:', error);
            this.showStatus('Ошибка подключения', 'error');
            this.showPage(this.welcomePage);
        }
    }

    async createCall() {
        this.showStatus('Используйте команду /create в боте Telegram', 'info');
    }

    cancelJoin() {
        this.showPage(this.welcomePage);
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

    startJitsiMeet(roomName) {
        return new Promise((resolve, reject) => {
            try {
                const domain = 'meet.jit.si'; // Можно заменить на свой сервер
                const options = {
                    roomName: roomName,
                    width: '100%',
                    height: '100%',
                    parentNode: document.getElementById('jitsiContainer'),
                    configOverwrite: {
                        prejoinPageEnabled: false,
                        startWithAudioMuted: false,
                        startWithVideoMuted: false,
                        disableModeratorIndicator: false,
                        startScreenSharing: false,
                        enableEmailInStats: false
                    },
                    interfaceConfigOverwrite: {
                        TOOLBAR_BUTTONS: [
                            'microphone', 'camera', 'closedcaptions', 'desktop', 'embedmeeting',
                            'fullscreen', 'fodeviceselection', 'hangup', 'profile', 'chat',
                            'recording', 'livestreaming', 'etherpad', 'sharedvideo', 'settings',
                            'raisehand', 'videoquality', 'filmstrip', 'invite', 'feedback',
                            'stats', 'shortcuts', 'tileview', 'videobackgroundblur', 'download',
                            'help', 'mute-everyone', 'security'
                        ],
                        SETTINGS_SECTIONS: ['devices', 'language', 'moderator', 'profile', 'calendar'],
                        SHOW_JITSI_WATERMARK: false,
                        SHOW_WATERMARK_FOR_GUESTS: false,
                        SHOW_BRAND_WATERMARK: false,
                        BRAND_WATERMARK_LINK: '',
                        SHOW_POWERED_BY: false,
                        SHOW_PROMOTIONAL_CLOSE_PAGE: false,
                        SHOW_CHROME_EXTENSION_BANNER: false
                    },
                    userInfo: {
                        displayName: `Участник_${Math.random().toString(36).substr(2, 5)}`
                    }
                };

                this.jitsiApi = new JitsiMeetExternalAPI(domain, options);

                this.jitsiApi.addEventListener('videoConferenceJoined', () => {
                    console.log('Joined Jitsi conference');
                    this.showPage(this.jitsiPage);
                    resolve();
                });

                this.jitsiApi.addEventListener('videoConferenceLeft', () => {
                    console.log('Left Jitsi conference');
                    this.leaveCall();
                });

                this.jitsiApi.addEventListener('participantJoined', () => {
                    this.showStatus('Новый участник присоединился', 'info');
                });

                this.jitsiApi.addEventListener('participantLeft', () => {
                    this.showStatus('Участник вышел', 'info');
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    leaveCall() {
        if (this.jitsiApi) {
            this.jitsiApi.dispose();
            this.jitsiApi = null;
        }

        // Очищаем контейнер Jitsi
        const jitsiContainer = document.getElementById('jitsiContainer');
        jitsiContainer.innerHTML = '';

        this.showPage(this.welcomePage);
        this.codeInput.value = '';
        this.showStatus('Звонок завершен', 'info');
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    window.videoCallApp = new JitsiVideoCall();
    console.log('Jitsi VideoCall App initialized');
});