/* global firebase, self */
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyApbQHymJkakiKyfYHYHmf9D7e_818SVVc',
  authDomain: 'dmd-project-7d5bc.firebaseapp.com',
  projectId: 'dmd-project-7d5bc',
  storageBucket: 'dmd-project-7d5bc.firebasestorage.app',
  messagingSenderId: '752938708459',
  appId: '1:752938708459:web:7afe66d7c91de32b30bdae',
  measurementId: 'G-WWK6WT7TPB',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title ?? 'Notification';
  const body = payload?.notification?.body ?? 'You have a new update.';
  const data = payload?.data ?? {};
  self.registration.showNotification(title, {
    body,
    data,
  });
});
