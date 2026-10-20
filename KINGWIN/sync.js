// ==========================================
// SYNC.JS — БАЛАНС ЧЕРЕЗ FIREBASE (UID-based)
// ==========================================
// localStorage 'kw_current_user' = UID (не email!)
// Ключ в Realtime DB: users/{uid}
//
// Функции:
//   getRealBalance()        — текущий баланс из кэша
//   loadBalanceFromDB(cb)   — загрузить баланс из Firebase
//   setRealBalance(total)   — УСТАРЕЛО, пишет напрямую (до Rules)
//   safeChangeBalance(d,t)  — безопасно менять через Netlify Function
//   fmt(n)                  — форматирование чисел
//   checkAuth()             — редирект на auth.html, если не залогинен
// ==========================================

(function() {
  var CURRENT_USER_KEY = 'kw_current_user';

  function getCurrentUid() {
    return localStorage.getItem(CURRENT_USER_KEY);
  }

  window.__balanceCache = 0;

  window.getRealBalance = function() {
    return window.__balanceCache;
  };

  // ==================== ЗАГРУЗКА БАЛАНСА ====================
  window.loadBalanceFromDB = function(callback) {
    var uid = getCurrentUid();
    if(!uid) { window.__balanceCache = 0; if(callback) callback(0); return; }

    if(typeof firebase === 'undefined' || !firebase.database) {
      console.error('❌ Firebase не подключён на этой странице! Добавь firebase-app.js и firebase-database.js');
      if(callback) callback(0);
      return;
    }

    firebase.database().ref('users/' + uid).once('value').then(function(snapshot){
      var user = snapshot.val();
      if(!user) { window.__balanceCache = 0; if(callback) callback(0); return; }
      var total = (user.realBalance || 0) + (user.bonusBalance || 0);
      window.__balanceCache = total;
      console.log('✅ Баланс загружен:', total);
      if(callback) callback(total);
    }).catch(function(error){
      console.error('❌ Ошибка загрузки баланса:', error);
      if(callback) callback(0);
    });
  };

  // ==================== ПРЯМАЯ ЗАПИСЬ (устаревшая) ====================
  // Работает только пока Rules = Test mode. После включения правил — не работает.
  // Оставлено для обратной совместимости со старыми играми.
  window.saveBalanceToDB = function(newTotal, callback) {
    var uid = getCurrentUid();
    if(!uid) return;
    if(typeof firebase === 'undefined' || !firebase.database) return;

    firebase.database().ref('users/' + uid).once('value').then(function(snapshot){
      var user = snapshot.val();
      if(!user) return;

      var oldTotal = (user.realBalance || 0) + (user.bonusBalance || 0);
      var diff = newTotal - oldTotal;

      if(diff > 0) {
        user.realBalance = (user.realBalance || 0) + diff;
      } else if(diff < 0) {
        var toTake = -diff;
        var real = user.realBalance || 0;
        var bonus = user.bonusBalance || 0;
        if(real >= toTake) {
          user.realBalance = real - toTake;
        } else {
          user.realBalance = 0;
          user.bonusBalance = bonus - (toTake - real);
        }
      }

      firebase.database().ref('users/' + uid).set(user).then(function(){
        window.__balanceCache = newTotal;
        if(callback) callback(newTotal);
      }).catch(function(err){
        console.error('❌ saveBalanceToDB error (возможно, Rules блокируют):', err);
      });
    });
  };

  window.setRealBalance = function(newTotal) {
    window.saveBalanceToDB(newTotal, null);
  };

  // ==================== БЕЗОПАСНОЕ ИЗМЕНЕНИЕ ====================
  // Меняет баланс через Netlify Function. Требует:
  //   1) netlify/functions/updateBalance.js
  //   2) FIREBASE_* env vars в Netlify
  //
  // Использование:
  //   await safeChangeBalance(-100, 'bet');   // ставка
  //   await safeChangeBalance(+250, 'win');   // выигрыш
  //   → вернёт новый total, либо null при ошибке
  window.safeChangeBalance = async function(delta, type) {
    var uid = getCurrentUid();
    if(!uid) {
      console.warn('❌ safeChangeBalance: нет UID (не залогинен)');
      return null;
    }

    if(typeof firebase === 'undefined' || !firebase.auth) {
      console.error('❌ Firebase Auth не подключён');
      return null;
    }

    var user = firebase.auth().currentUser;
    if(!user) {
      console.error('❌ Нет авторизованного пользователя');
      return null;
    }

    try {
      var idToken = await user.getIdToken();
      var resp = await fetch('/.netlify/functions/updateBalance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify({ delta: delta, type: type || 'game' })
      });

      if(!resp.ok) {
        var errText = await resp.text();
        console.error('❌ updateBalance error:', resp.status, errText);
        return null;
      }

      var data = await resp.json();
      window.__balanceCache = data.total;
      console.log('✅ Баланс изменён:', delta, '→ новый:', data.total);
      return data.total;
    } catch(e) {
      console.error('❌ safeChangeBalance exception:', e);
      return null;
    }
  };

  // ==================== ФОРМАТИРОВАНИЕ ====================
  window.fmt = function(n) {
    var r = Math.round(n * 100) / 100;
    if (r % 1 === 0) return Math.floor(r).toLocaleString('ru-RU');
    return r.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  // ==================== ПРОВЕРКА АВТОРИЗАЦИИ ====================
  window.checkAuth = function() {
    var uid = getCurrentUid();
    if(!uid) {
      window.location.replace('auth.html?need_auth=1');
      return false;
    }
    return true;
  };

  // ==================== АВТО-ПРОВЕРКА ====================
  var path = window.location.pathname;
  var isPublicPage =
    path.indexOf('index.html') !== -1 ||
    path.indexOf('auth.html') !== -1 ||
    path.indexOf('profile.html') !== -1 ||
    path.indexOf('admin.html') !== -1 ||
    path === '/' || path === '';

  if (!isPublicPage) window.checkAuth();
})();