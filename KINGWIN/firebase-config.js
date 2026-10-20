var firebaseConfig = {
  apiKey: "AIzaSyC8PI8bCzGB_tODO6MnOKAjkxXaASbA3vM",
  authDomain: "kingwin-260a8.firebaseapp.com",
  databaseURL: "https://kingwin-260a8-default-rtdb.firebaseio.com",
  projectId: "kingwin-260a8",
  storageBucket: "kingwin-260a8.firebasestorage.app",
  messagingSenderId: "1085884746167",
  appId: "1:1085884746167:web:9962cbc9eb5c876ae78032"
};

document.write('<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"><\/script>');
document.write('<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js"><\/script>');

firebase.initializeApp(firebaseConfig);
var db = firebase.database();