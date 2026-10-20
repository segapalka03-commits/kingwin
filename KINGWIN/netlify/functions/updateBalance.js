// netlify/functions/updateBalance.js
// Безопасное изменение баланса. Требует Firebase ID Token в Authorization.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
    databaseURL: 'https://kingwin-260a8-default-rtdb.firebaseio.com'
  });
}

const db = admin.database();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // 1) Проверяем Firebase ID Token
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authHeader.replace('Bearer ', '').trim();
  if (!idToken) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'No token' }) };
  }

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (e) {
    console.error('Token verify error:', e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  // 2) Парсим тело
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) };
  }

  const delta = Number(body.delta);
  const type = String(body.type || 'game');

  if (!Number.isFinite(delta) || delta === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'delta must be non-zero number' }) };
  }

  // Защита от абсурдных сумм на клиенте (ставки обычно ≤ 10000, выигрыши ≤ 1 000 000)
  if (Math.abs(delta) > 1_000_000) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'delta too large' }) };
  }

  // 3) Атомарно меняем баланс
  const ref = db.ref('users/' + uid);
  try {
    const result = await ref.transaction((user) => {
      if (!user) return user;
      const real = user.realBalance || 0;
      const bonus = user.bonusBalance || 0;

      if (delta < 0) {
        // Списание: сначала бонус, потом реальные (или наоборот — по твоей логике)
        let toTake = -delta;
        const fromReal = Math.min(real, toTake);
        toTake -= fromReal;
        const fromBonus = Math.min(bonus, toTake);
        if (fromReal + fromBonus < -delta) return; // недостаточно средств
        user.realBalance = real - fromReal;
        user.bonusBalance = bonus - fromBonus;
      } else {
        // Начисление — в реальные (можно менять логику: бонус/реал)
        user.realBalance = real + delta;
      }

      // Статистика
      if (!user.stats) user.stats = { totalBets: 0, totalWins: 0, biggestWin: 0, gamesPlayed: 0, casesOpened: 0 };
      if (delta < 0) {
        user.stats.totalBets = (user.stats.totalBets || 0) + (-delta);
        user.stats.gamesPlayed = (user.stats.gamesPlayed || 0) + 1;
      } else {
        user.stats.totalWins = (user.stats.totalWins || 0) + delta;
        if (delta > (user.stats.biggestWin || 0)) user.stats.biggestWin = delta;
      }

      return user;
    });

    if (!result.committed) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Insufficient balance' }) };
    }

    const u = result.snapshot.val();
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        realBalance: u.realBalance || 0,
        bonusBalance: u.bonusBalance || 0,
        total: (u.realBalance || 0) + (u.bonusBalance || 0)
      })
    };
  } catch (e) {
    console.error('Transaction error:', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};