// Service Worker for Voice Recorder PWA
const CACHE_NAME = 'voice-recorder-v1.0.0';
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    '/app.js',
    '/style.css',
    '/icon-192.png',
    '/icon-512.png'
];

// Service Worker インストール
self.addEventListener('install', (event) => {
    console.log('[SW] Install');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .then(() => {
                console.log('[SW] Skip waiting');
                return self.skipWaiting();
            })
    );
});

// Service Worker アクティベート
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Claiming clients');
            return self.clients.claim();
        })
    );
});

// ネットワークリクエストの処理
self.addEventListener('fetch', (event) => {
    // Google APIs や外部リソースはキャッシュしない
    if (event.request.url.includes('googleapis.com') || 
        event.request.url.includes('google.com') ||
        event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // キャッシュにあればそれを返す
                if (response) {
                    console.log('[SW] Cache hit:', event.request.url);
                    return response;
                }

                // キャッシュになければネットワークから取得
                console.log('[SW] Cache miss, fetching:', event.request.url);
                return fetch(event.request).then((response) => {
                    // レスポンスが有効でない場合はそのまま返す
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }

                    // レスポンスをクローンしてキャッシュに保存
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => {
                            cache.put(event.request, responseToCache);
                        });

                    return response;
                }).catch(() => {
                    // ネットワークエラーの場合、基本のHTMLを返す（オフライン対応）
                    if (event.request.destination === 'document') {
                        return caches.match('/index.html');
                    }
                });
            })
    );
});

// バックグラウンド同期（将来の拡張用）
self.addEventListener('sync', (event) => {
    console.log('[SW] Background sync:', event.tag);
    
    if (event.tag === 'upload-recordings') {
        event.waitUntil(
            // ここで未アップロードの録音をアップロード
            syncRecordings()
        );
    }
});

// プッシュ通知（将来の拡張用）
self.addEventListener('push', (event) => {
    console.log('[SW] Push received');
    
    const options = {
        body: event.data ? event.data.text() : 'New notification',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Open App',
                icon: '/icon-192.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: '/icon-192.png'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('Voice Recorder', options)
    );
});

// 通知クリック処理
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification click received.');

    event.notification.close();

    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// 未アップロード録音の同期処理（将来の実装用）
async function syncRecordings() {
    try {
        // IndexedDBから未アップロードの録音を取得
        // Google Drive APIでアップロード
        console.log('[SW] Syncing recordings...');
        
        // 実際の同期処理はここに実装
        // 現在はメインアプリで処理しているため、ここは将来の拡張用
        
    } catch (error) {
        console.error('[SW] Sync failed:', error);
    }
}

// ネットワーク状態の変更通知
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);
    
    if (event.data.action === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.action === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_NAME });
    }
});

// エラーハンドリング
self.addEventListener('error', (event) => {
    console.error('[SW] Error:', event.error);
});

// 未処理のPromise拒否をキャッチ
self.addEventListener('unhandledrejection', (event) => {
    console.error('[SW] Unhandled promise rejection:', event.reason);
    event.preventDefault();
});

console.log('[SW] Service Worker loaded successfully');
