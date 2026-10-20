// netlify/functions/requestDeposit.js
// Создание заявки на депозит. Требует Firebase ID Token.
// Статус всегда 'pending', uid берётся из токена (нельзя подделать).

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

  // 1) Авторизация
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
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) }; }

  const amount = Number(body.amount);

  // 3) Валидация
  if (!Number.isFinite(amount) || amount < 100 || amount > 50000) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Сумма должна быть 100-50000' }) };
  }

  // 4) Проверка, что у пользователя нет активной pending-заявки
  const userSnap = await db.ref('users/' + uid).once('value');
  const user = userSnap.val();
  if (!user) {
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Пользователь не найден' }) };
  }

  // Проверяем, есть ли уже pending-заявки у этого пользователя
  const existingSnap = await db.ref('pending_deposits').once('value');
  const existing = existingSnap.val() || {};
  let hasPending = false;
  for (const key in existing) {
    if (existing[key].uid === uid && existing[key].status === 'pending') {
      hasPending = true;
      break;
    }
  }
  if (hasPending) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'У вас уже есть активная заявка на пополнение. Дождитесь её обработки.' }) };
  }

  // 5) Создаём заявку
  const newRequest = {
    uid: uid,
    nick: user.nick,
    email: user.email,
    amount: amount,
    bonus: true,
    total: amount * 2,
    method: 'USDT (BSC-20)',
    status: 'pending',
    date: Date.now()
  };

  try {
    const ref = await db.ref('pending_deposits').push(newRequest);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, requestId: ref.key, request: newRequest })
    };
  } catch (e) {
    console.error('DB write error:', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};