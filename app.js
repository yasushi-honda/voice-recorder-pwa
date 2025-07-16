// Voice Recorder PWA - Main Application
class VoiceRecorderPWA {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.startTime = null;
        this.timerInterval = null;
        this.recordings = [];
        this.gapi = null;
        this.isAuthenticated = false;

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.updateConnectionStatus();
        this.loadRecordings();
        this.checkMicrophonePermission();
        this.loadGoogleAPI();
        
        // オンライン/オフライン監視
        window.addEventListener('online', () => {
            this.updateConnectionStatus();
            this.uploadPendingRecordings();
        });
        
        window.addEventListener('offline', () => {
            this.updateConnectionStatus();
        });
    }

    setupEventListeners() {
        // 録音ボタン
        document.getElementById('recordBtn').addEventListener('click', () => {
            this.toggleRecording();
        });

        // Google Drive認証ボタン
        document.getElementById('authBtn').addEventListener('click', () => {
            this.authenticateGoogleDrive();
        });
    }

    // マイクロフォン許可チェック
    async checkMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            this.updateStatus('Ready to record');
        } catch (error) {
            this.updateStatus('Microphone permission required');
            console.error('Microphone permission denied:', error);
        }
    }

    // 録音開始/停止切り替え
    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    // 録音開始
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            this.audioChunks = [];
            this.startTime = Date.now();

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.processRecording();
            };

            this.mediaRecorder.start(1000); // 1秒ごとにデータを取得
            this.isRecording = true;
            this.updateUI();
            this.startTimer();
            this.updateStatus('Recording...');

        } catch (error) {
            console.error('Error starting recording:', error);
            this.updateStatus('Failed to start recording');
        }
    }

    // 録音停止
    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            this.isRecording = false;
            this.stopTimer();
            this.updateUI();
            this.updateStatus('Processing recording...');
        }
    }

    // 録音データ処理
    async processRecording() {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const duration = Math.floor((Date.now() - this.startTime) / 1000);
        
        const recording = {
            id: Date.now(),
            filename: `recording_${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '')}.webm`,
            blob: audioBlob,
            duration: duration,
            timestamp: new Date().toISOString(),
            uploaded: false,
            size: audioBlob.size
        };

        // IndexedDBに保存
        await this.saveRecording(recording);
        this.recordings.unshift(recording);
        this.updateRecordingsList();
        this.updateStatus('Recording saved');

        // オンラインの場合、即座にアップロード試行
        if (navigator.onLine && this.isAuthenticated) {
            this.uploadRecording(recording);
        }
    }

    // IndexedDBに録音を保存
    async saveRecording(recording) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('VoiceRecorderDB', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = () => {
                const db = request.result;
                const transaction = db.transaction(['recordings'], 'readwrite');
                const store = transaction.objectStore('recordings');
                
                const addRequest = store.add(recording);
                addRequest.onsuccess = () => resolve();
                addRequest.onerror = () => reject(addRequest.error);
            };
            
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('recordings')) {
                    const store = db.createObjectStore('recordings', { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    // 保存された録音を読み込み
    async loadRecordings() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('VoiceRecorderDB', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = () => {
                const db = request.result;
                
                if (!db.objectStoreNames.contains('recordings')) {
                    this.recordings = [];
                    this.updateRecordingsList();
                    resolve();
                    return;
                }
                
                const transaction = db.transaction(['recordings'], 'readonly');
                const store = transaction.objectStore('recordings');
                const getAllRequest = store.getAll();
                
                getAllRequest.onsuccess = () => {
                    this.recordings = getAllRequest.result.sort((a, b) => 
                        new Date(b.timestamp) - new Date(a.timestamp)
                    );
                    this.updateRecordingsList();
                    resolve();
                };
                
                getAllRequest.onerror = () => reject(getAllRequest.error);
            };
            
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('recordings')) {
                    const store = db.createObjectStore('recordings', { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    // タイマー開始
    startTimer() {
        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            document.getElementById('timer').textContent = `${minutes}:${seconds}`;
        }, 1000);
    }

    // タイマー停止
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    // UI更新
    updateUI() {
        const recordBtn = document.getElementById('recordBtn');
        const recordingInfo = document.getElementById('recordingInfo');

        if (this.isRecording) {
            recordBtn.classList.add('recording');
            recordBtn.querySelector('.record-icon').textContent = '⏹️';
            recordBtn.querySelector('.record-text').textContent = 'Stop Recording';
            recordingInfo.style.display = 'block';
        } else {
            recordBtn.classList.remove('recording');
            recordBtn.querySelector('.record-icon').textContent = '⏺️';
            recordBtn.querySelector('.record-text').textContent = 'Start Recording';
            recordingInfo.style.display = 'none';
            document.getElementById('timer').textContent = '00:00';
        }
    }

    // ステータス更新
    updateStatus(message) {
        document.getElementById('status').textContent = message;
    }

    // 接続状況更新
    updateConnectionStatus() {
        const statusEl = document.getElementById('connectionStatus');
        const statusText = statusEl.querySelector('.status-text');
        
        if (navigator.onLine) {
            statusEl.className = 'connection-status online';
            statusText.textContent = 'Online';
        } else {
            statusEl.className = 'connection-status offline';
            statusText.textContent = 'Offline';
        }
    }

    // 録音一覧更新
    updateRecordingsList() {
        const listContainer = document.getElementById('recordingsList');
        
        if (this.recordings.length === 0) {
            listContainer.innerHTML = '<div class="no-recordings">No recordings yet</div>';
            return;
        }

        listContainer.innerHTML = this.recordings.map(recording => `
            <div class="recording-item" data-id="${recording.id}">
                <div class="recording-info-item">
                    <div class="recording-name">${recording.filename}</div>
                    <div class="recording-meta">
                        ${new Date(recording.timestamp).toLocaleString()} | 
                        ${this.formatDuration(recording.duration)} | 
                        ${this.formatFileSize(recording.size)}
                        ${recording.uploaded ? ' | ✅ Uploaded' : ' | 📁 Local'}
                    </div>
                </div>
                <div class="recording-actions">
                    <button class="btn-small btn-play" onclick="voiceRecorder.playRecording(${recording.id})">
                        ▶️ Play
                    </button>
                    <button class="btn-small btn-delete" onclick="voiceRecorder.deleteRecording(${recording.id})">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 録音再生
    async playRecording(id) {
        const recording = this.recordings.find(r => r.id === id);
        if (!recording) return;

        const audio = new Audio();
        audio.src = URL.createObjectURL(recording.blob);
        audio.play();
        
        audio.onended = () => {
            URL.revokeObjectURL(audio.src);
        };
    }

    // 録音削除
    async deleteRecording(id) {
        if (!confirm('Delete this recording?')) return;

        try {
            // IndexedDBから削除
            await this.deleteRecordingFromDB(id);
            
            // メモリから削除
            this.recordings = this.recordings.filter(r => r.id !== id);
            this.updateRecordingsList();
            this.updateStatus('Recording deleted');
        } catch (error) {
            console.error('Error deleting recording:', error);
            this.updateStatus('Failed to delete recording');
        }
    }

    // IndexedDBから録音削除
    async deleteRecordingFromDB(id) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('VoiceRecorderDB', 1);
            
            request.onsuccess = () => {
                const db = request.result;
                const transaction = db.transaction(['recordings'], 'readwrite');
                const store = transaction.objectStore('recordings');
                
                const deleteRequest = store.delete(id);
                deleteRequest.onsuccess = () => resolve();
                deleteRequest.onerror = () => reject(deleteRequest.error);
            };
            
            request.onerror = () => reject(request.error);
        });
    }

    // ユーティリティ関数
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Google API読み込み
    loadGoogleAPI() {
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
            gapi.load('auth2:client', () => {
                this.initGoogleAPI();
            });
        };
        document.head.appendChild(script);
    }

    // Google API初期化
    async initGoogleAPI() {
        try {
            await gapi.client.init({
                apiKey: 'YOUR_API_KEY', // 実際のAPIキーに置き換え
                clientId: 'YOUR_CLIENT_ID', // 実際のクライアントIDに置き換え
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                scope: 'https://www.googleapis.com/auth/drive.file'
            });

            this.gapi = gapi;
            this.checkAuthStatus();
        } catch (error) {
            console.error('Google API initialization failed:', error);
            this.updateAuthStatus('Google API initialization failed', 'error');
        }
    }

    // 認証状況確認
    checkAuthStatus() {
        if (!this.gapi) return;

        const authInstance = this.gapi.auth2.getAuthInstance();
        this.isAuthenticated = authInstance.isSignedIn.get();
        
        if (this.isAuthenticated) {
            const user = authInstance.currentUser.get();
            const profile = user.getBasicProfile();
            this.updateAuthStatus(`Connected as ${profile.getName()}`, 'connected');
            this.uploadPendingRecordings();
        } else {
            this.updateAuthStatus('Not connected to Google Drive');
        }
    }

    // Google Drive認証
    async authenticateGoogleDrive() {
        if (!this.gapi) {
            this.updateAuthStatus('Google API not loaded', 'error');
            return;
        }

        try {
            const authInstance = this.gapi.auth2.getAuthInstance();
            await authInstance.signIn();
            this.checkAuthStatus();
        } catch (error) {
            console.error('Authentication failed:', error);
            this.updateAuthStatus('Authentication failed', 'error');
        }
    }

    // 認証ステータス更新
    updateAuthStatus(message, type = '') {
        const statusEl = document.getElementById('authStatus');
        statusEl.textContent = message;
        statusEl.className = `auth-status ${type}`;
    }

    // 録音をGoogle Driveにアップロード
    async uploadRecording(recording) {
        if (!this.isAuthenticated || !this.gapi) return;

        try {
            const metadata = {
                name: recording.filename,
                parents: [] // ルートフォルダに保存
            };

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', recording.blob);

            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: new Headers({
                    'Authorization': `Bearer ${this.gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().access_token}`
                }),
                body: form
            });

            if (response.ok) {
                // アップロード成功
                recording.uploaded = true;
                await this.updateRecordingInDB(recording);
                this.updateRecordingsList();
                this.updateStatus(`${recording.filename} uploaded to Google Drive`);
            } else {
                throw new Error('Upload failed');
            }
        } catch (error) {
            console.error('Upload error:', error);
            this.updateStatus(`Failed to upload ${recording.filename}`);
        }
    }

    // 未アップロードの録音をすべてアップロード
    async uploadPendingRecordings() {
        if (!this.isAuthenticated || !navigator.onLine) return;

        const pendingRecordings = this.recordings.filter(r => !r.uploaded);
        
        for (const recording of pendingRecordings) {
            await this.uploadRecording(recording);
        }
    }

    // IndexedDB内の録音を更新
    async updateRecordingInDB(recording) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('VoiceRecorderDB', 1);
            
            request.onsuccess = () => {
                const db = request.result;
                const transaction = db.transaction(['recordings'], 'readwrite');
                const store = transaction.objectStore('recordings');
                
                const updateRequest = store.put(recording);
                updateRequest.onsuccess = () => resolve();
                updateRequest.onerror = () => reject(updateRequest.error);
            };
            
            request.onerror = () => reject(request.error);
        });
    }
}

// アプリ初期化
let voiceRecorder;
document.addEventListener('DOMContentLoaded', () => {
    voiceRecorder = new VoiceRecorderPWA();
});
