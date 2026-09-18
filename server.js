'use strict';

/*
  ============================================================
  WRITTEN BURA — MONOLITHIC SERVER.JS
  ============================================================
  საჭიროა მხოლოდ:
    npm install express socket.io
    node server.js

  Render Start Command:
    npm start

  package.json-ში:
    "scripts": { "start": "node server.js" }

  ეს ვერსია არ იყენებს public/index.html-ს.
  HTML + CSS + Client JS მთლიანად PAGE-შია.
  ============================================================
*/

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: 1000000
});

const PORT = Number(process.env.PORT || 10000);
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* ============================================================
   CONFIG
   ============================================================ */

const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;
const TURN_SECONDS = 20;
const RECONNECT_MS = 30000;

const CAPACITIES = [3, 4];
const STAKES = [5, 10, 25, 50, 100];
const MAX_PARTIES = 4;

const VALUES = {
  '6': 0, '7': 0, '8': 0, '9': 0,
  'J': 2, 'Q': 3, 'K': 4,
  '10': 10, 'A': 11
};

const RANKS = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
const TRUMPS = ['spades', 'clubs', 'diamonds', 'hearts', 'no_trump'];

const rooms = new Map();
const users = new Map();
const sessions = new Map();

const scryptAsync = promisify(crypto.scrypt);
let saveTimer = null;

/* ============================================================
   HELPERS
   ============================================================ */

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
    crypto.randomBytes(5).toString('hex');
}

function clean(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function lower(v) {
  return clean(v).toLowerCase();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function tester(name) {
  return lower(name) === TESTER_NAME;
}

function suitSymbol(suit) {
  return {
    spades: '♠',
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    no_trump: '★'
  }[suit] || '★';
}

/* ============================================================
   USERS / AUTH
   ============================================================ */

function defaultQuests() {
  return {
    date: today(),
    wins: 0,
    maliutka: 0,
    tables: 0,
    tableIds: [],
    rewards: {
      wins: false,
      maliutka: false,
      tables: false
    }
  };
}

function defaults(u) {
  u.avatar = u.avatar || '🦊';
  u.xp = Number(u.xp || 0);
  u.level = Math.floor(u.xp / 100) + 1;
  u.wins = Number(u.wins || 0);
  u.balance = Number(u.balance === undefined ? START_BALANCE : u.balance);
  u.achievements = Array.isArray(u.achievements) ? u.achievements : [];

  if (!u.quests || u.quests.date !== today()) {
    u.quests = defaultQuests();
  }

  return u;
}

function profile(u) {
  defaults(u);
  return {
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    xp: u.xp,
    level: u.level,
    wins: u.wins,
    balance: u.balance,
    quests: u.quests,
    achievements: u.achievements
  };
}

function findUser(username) {
  const n = lower(username);
  return Array.from(users.values()).find(function (u) {
    return lower(u.username) === n;
  }) || null;
}

async function passwordHash(password, salt) {
  const result = await scryptAsync(String(password), salt, 64);
  return Buffer.from(result).toString('hex');
}

async function makePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    salt: salt,
    hash: await passwordHash(password, salt)
  };
}

async function checkPassword(password, user) {
  try {
    const value = await passwordHash(password, user.passwordSalt);
    const a = Buffer.from(value, 'hex');
    const b = Buffer.from(user.passwordHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function validAvatar(value) {
  const v = String(value || '');
  if (!v) return '🦊';
  if (v.length <= 20) return v;

  if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(v) && v.length < 700000) {
    return v;
  }

  return '🦊';
}

async function loadUsers() {
  try {
    const raw = await fs.promises.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.users || []);

    list.forEach(function (u) {
      if (u && u.id && u.username) {
        defaults(u);
        users.set(u.id, u);
      }
    });
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('users.json:', e.message);
  }
}

async function saveUsersNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const list = Array.from(users.values()).map(function (u) {
    const x = Object.assign({}, u);
    delete x.socketId;
    delete x.roomId;
    return x;
  });

  try {
    await fs.promises.writeFile(
      USERS_FILE,
      JSON.stringify({ users: list }, null, 2),
      'utf8'
    );
  } catch (e) {
    console.error('SAVE:', e.message);
  }
}

function saveLater() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    saveTimer = null;
    saveUsersNow();
  }, 4000);
}

function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id });
  return token;
}

function addXP(user, amount) {
  if (!user) return;
  user.xp += Number(amount || 0);
  user.level = Math.floor(user.xp / 100) + 1;
  saveLater();

  if (user.socketId) {
    io.to(user.socketId).emit('profileUpdate', profile(user));
  }
}

function checkQuests(user) {
  defaults(user);
  const q = user.quests;
  let bonus = 0;

  if (q.wins >= 3 && !q.rewards.wins) {
    q.rewards.wins = true;
    bonus += 100;
  }

  if (q.maliutka >= 1 && !q.rewards.maliutka) {
    q.rewards.maliutka = true;
    bonus += 250;
  }

  if (q.tables >= 5 && !q.rewards.tables) {
    q.rewards.tables = true;
    bonus += 50;
  }

  if (bonus) addXP(user, bonus);
  saveLater();
}

function playedTable(user, roomId) {
  if (!user) return;
  defaults(user);

  if (!user.quests.tableIds.includes(roomId)) {
    user.quests.tableIds.push(roomId);
    user.quests.tables++;
    checkQuests(user);
  }
}

/* ============================================================
   CARDS
   ============================================================ */

function deck() {
  const d = [];

  SUITS.forEach(function (suit) {
    RANKS.forEach(function (rank) {
      d.push({
        id: uid('c'),
        suit: suit,
        rank: rank
      });
    });
  });

  for (let i = d.length - 1; i > 0; i--) {
    const j = rand(0, i);
    const t = d[i];
    d[i] = d[j];
    d[j] = t;
  }

  return d;
}

function points(card) {
  return VALUES[card.rank] || 0;
}

function rank(card) {
  return RANKS.indexOf(card.rank);
}

function isTrump(card, trump) {
  return trump !== 'no_trump' && card.suit === trump;
}

function sameSuit(cards) {
  return cards.length > 0 && cards.every(function (c) {
    return c.suit === cards[0].suit;
  });
}

function maliutka(cards) {
  return cards.length === 5 && sameSuit(cards);
}

/* ============================================================
   CUTTING LOGIC
   ============================================================ */

function cardBeats(base, challenger, trump) {
  const bt = isTrump(base, trump);
  const ct = isTrump(challenger, trump);

  if (ct && !bt) return true;
  if (bt && !ct) return false;
  if (base.suit !== challenger.suit) return false;

  return rank(challenger) > rank(base);
}

/*
  მნიშვნელოვანი FIX:
  2/3/4/5 კარტის ჭრისას არ ხდება უბრალოდ
  array[index]-ების შედარება.

  კეთდება one-to-one matching.
*/
function playBeats(baseCards, challengerCards, trump) {
  if (!baseCards || !challengerCards ||
      baseCards.length !== challengerCards.length) {
    return false;
  }

  const bases = baseCards.slice().sort(function (a, b) {
    return rank(b) - rank(a);
  });

  const used = new Array(challengerCards.length).fill(false);

  function search(i) {
    if (i >= bases.length) return true;

    for (let j = 0; j < challengerCards.length; j++) {
      if (used[j]) continue;

      if (cardBeats(bases[i], challengerCards[j], trump)) {
        used[j] = true;
        if (search(i + 1)) return true;
        used[j] = false;
      }
    }

    return false;
  }

  return search(0);
}

function winnerIndex(table, trump) {
  if (!table.length) return -1;

  let winner = 0;

  for (let i = 1; i < table.length; i++) {
    if (playBeats(table[winner].cards, table[i].cards, trump)) {
      winner = i;
    }
  }

  return winner;
}

function sameSuitPossible(hand, count) {
  const x = {};

  hand.forEach(function (c) {
    x[c.suit] = (x[c.suit] || 0) + 1;
  });

  return Object.keys(x).some(function (s) {
    return x[s] >= count;
  });
}

/* ============================================================
   ROOM / PLAYERS
   ============================================================ */

function makeRoom(name, capacity, parties, stake) {
  const room = {
    id: uid('room'),
    name: clean(name) || 'Written Bura',
    capacity: CAPACITIES.includes(Number(capacity)) ? Number(capacity) : 4,
    parties: Math.max(1, Math.min(MAX_PARTIES, Number(parties) || 1)),
    stake: STAKES.includes(Number(stake)) ? Number(stake) : 5,
    players: [],
    game: null,
    timer: null,
    botTimer: null
  };

  rooms.set(room.id, room);
  lobby();
  return room;
}

function human(user, socket, guestName) {
  return {
    id: user ? user.id : uid('guest'),
    userId: user ? user.id : null,
    name: user ? user.username : (clean(guestName) || 'Guest'),
    avatar: user ? user.avatar : '😎',
    socketId: socket.id,
    isBot: false,
    connected: true,
    hand: [],
    captured: [],
    total: 0,
    lastRaw: 0,
    xp: user ? user.xp : 0,
    level: user ? user.level : 1,
    wins: user ? user.wins : 0,
    reconnectTimer: null
  };
}

function bot(n) {
  return {
    id: uid('bot'),
    userId: null,
    name: 'BOT ' + n,
    avatar: '🤖',
    socketId: null,
    isBot: true,
    connected: true,
    hand: [],
    captured: [],
    total: 0,
    lastRaw: 0,
    xp: 0,
    level: rand(2, 8),
    wins: 0
  };
}

function userOf(player) {
  return player && player.userId ? users.get(player.userId) : null;
}

function fillBots(room) {
  let n = 1;
  while (room.players.length < room.capacity) {
    room.players.push(bot(n++));
  }
}

/* ============================================================
   GAME START
   ============================================================ */

function startHand(room, previous) {
  const d = deck();
  const handIndex = previous ? previous.handIndex + 1 : 1;
  const partyIndex = Math.ceil(handIndex / 5);
  const trump = TRUMPS[(handIndex - 1) % TRUMPS.length];

  room.players.forEach(function (p) {
    p.hand = [];
    p.captured = [];
    p.lastRaw = 0;
  });

  for (let r = 0; r < 5; r++) {
    room.players.forEach(function (p) {
      if (d.length) p.hand.push(d.pop());
    });
  }

  const leader = previous && Number.isInteger(previous.nextLeader)
    ? previous.nextLeader
    : 0;

  room.game = {
    handIndex: handIndex,
    partyIndex: partyIndex,
    totalHands: room.parties * 5,
    trump: trump,
    deck: d,
    table: [],
    current: leader,
    leadCount: 0,
    leadMaliutka: false,
    processing: false,
    gameOver: false,
    turnEndsAt: 0,
    history: previous ? previous.history : [],
    lastScores: previous ? previous.lastScores : {},
    lastTrickOrder: [],
    nextLeader: leader,
    partyStart: previous && previous.partyIndex === partyIndex
      ? previous.partyStart
      : Object.fromEntries(room.players.map(function (p) {
          return [p.id, p.total];
        }))
  };

  return room.game;
}

/* ============================================================
   CLIENT STATE
   ============================================================ */

function state(room, viewerId, reveal) {
  const g = room.game;
  if (!g) return null;

  const cards = {};

  room.players.forEach(function (p) {
    if (reveal || p.id === viewerId) cards[p.id] = p.hand;
  });

  const wi = winnerIndex(g.table, g.trump);

  return {
    roomId: room.id,
    roomName: room.name,
    capacity: room.capacity,
    parties: room.parties,
    stake: room.stake,
    viewerId: viewerId,

    handIndex: g.handIndex,
    partyIndex: g.partyIndex,
    totalHands: g.totalHands,
    trump: g.trump,
    deckCount: g.deck.length,
    currentTurnIndex: g.current,
    leadCount: g.leadCount,
    leadWasMaliutka: g.leadMaliutka,
    processing: g.processing,
    gameOver: g.gameOver,
    turnEndsAt: g.turnEndsAt,
    turnSeconds: TURN_SECONDS,

    playersCards: cards,
    history: g.history,
    lastHandScores: g.lastScores,

    players: room.players.map(function (p, i) {
      return {
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        connected: p.connected,
        cardCount: p.hand.length,
        totalPoints: p.total,
        lastRawPoints: p.lastRaw,
        level: p.level,
        xp: p.xp,
        wins: p.wins,
        isCurrent: i === g.current
      };
    }),

    table: g.table.map(function (play, i) {
      return {
        playerId: play.playerId,
        playerName: play.playerName,
        cards: play.cards,
        cuts: play.cuts,
        isWinning: i === wi
      };
    })
  };
}

function broadcast(room) {
  if (!room || !room.game) return;

  room.players.forEach(function (p) {
    if (p.isBot || !p.socketId || !p.connected) return;

    io.to(p.socketId).emit(
      'gameStateUpdate',
      state(room, p.id, tester(p.name))
    );
  });
}

/* ============================================================
   TURN
   ============================================================ */

function setTurn(room, index) {
  if (!room || !room.game || room.game.gameOver) return;

  if (room.timer) clearTimeout(room.timer);

  room.game.current = index % room.players.length;
  room.game.turnEndsAt = Date.now() + TURN_SECONDS * 1000;

  room.timer = setTimeout(function () {
    room.timer = null;
    autoPlay(room);
  }, TURN_SECONDS * 1000);

  broadcast(room);
  scheduleBot(room);
}

/* ============================================================
   VALIDATION
   ============================================================ */

function validate(game, hand, indexes) {
  if (!Array.isArray(indexes) || !indexes.length) {
    return { ok: false, message: 'აირჩიე კარტი.' };
  }

  const ids = Array.from(new Set(indexes.map(Number)));

  if (ids.length !== indexes.length || ids.length > 5) {
    return { ok: false, message: 'არასწორი არჩევანი.' };
  }

  const cards = ids.map(function (i) {
    return hand[i];
  });

  if (cards.some(function (c) { return !c; })) {
    return { ok: false, message: 'კარტი ვერ მოიძებნა.' };
  }

  if (!game.table.length) {
    if (!sameSuit(cards)) {
      return {
        ok: false,
        message: 'ერთად ჩასული კარტები ერთი მასტის უნდა იყოს.'
      };
    }

    if (cards.length === 5 && !maliutka(cards)) {
      return { ok: false, message: '5 კარტი მხოლოდ მალიუტკაა.' };
    }

    return { ok: true, cards: cards, indexes: ids };
  }

  if (game.leadMaliutka) {
    if (cards.length !== hand.length) {
      return {
        ok: false,
        message: 'მალიუტკაზე ყველა დარჩენილი კარტი უნდა ჩამოხვიდე.'
      };
    }

    return { ok: true, cards: cards, indexes: ids };
  }

  const required = game.leadCount || 1;

  if (cards.length !== required) {
    return {
      ok: false,
      message: 'უნდა მონიშნო ზუსტად ' + required + ' კარტი.'
    };
  }

  /*
    თუ N ერთმასტიანი კომბინაცია არსებობს,
    პასუხიც ერთმასტიანი უნდა იყოს.

    თუ საერთოდ შეუძლებელია N ერთმასტიანი კარტის პოვნა,
    N კარტის გადაგდება ნებადართულია, რათა თამაში არ გაიყინოს.
  */
  if (
    required > 1 &&
    sameSuitPossible(hand, required) &&
    !sameSuit(cards)
  ) {
    return {
      ok: false,
      message: 'აირჩიე ერთი მასტის ' + required + ' კარტი.'
    };
  }

  return { ok: true, cards: cards, indexes: ids };
}

/* ============================================================
   PLAY
   ============================================================ */

function play(room, player, indexes) {
  const g = room.game;

  if (!g || g.processing || g.gameOver) return false;

  const v = validate(g, player.hand, indexes);

  if (!v.ok) {
    if (player.socketId) {
      io.to(player.socketId).emit('errorMessage', v.message);
    }
    return false;
  }

  let cuts = false;

  if (g.table.length) {
    const wi = winnerIndex(g.table, g.trump);
    if (wi >= 0) {
      cuts = playBeats(g.table[wi].cards, v.cards, g.trump);
    }
  }

  const selectedCards = v.cards.slice();

  v.indexes.slice().sort(function (a, b) {
    return b - a;
  }).forEach(function (i) {
    player.hand.splice(i, 1);
  });

  if (!g.table.length) {
    g.leadCount = selectedCards.length;
    g.leadMaliutka = maliutka(selectedCards);

    if (g.leadMaliutka) {
      const u = userOf(player);

      if (u) {
        defaults(u);
        u.quests.maliutka++;
        checkQuests(u);

        if (!u.achievements.includes('მალიუტკის ოსტატი')) {
          u.achievements.push('მალიუტკის ოსტატი');
          addXP(u, 40);
          io.to(room.id).emit('achievement', {
            playerId: player.id,
            title: 'მალიუტკის ოსტატი'
          });
        }
      }
    }
  }

  g.table.push({
    playerId: player.id,
    playerName: player.name,
    cards: selectedCards,
    cuts: cuts
  });

  io.to(room.id).emit('playFX', {
    playerId: player.id,
    cuts: cuts
  });

  if (g.table.length === room.players.length) {
    completeTrick(room);
    return true;
  }

  const index = room.players.findIndex(function (p) {
    return p.id === player.id;
  });

  setTurn(room, (index + 1) % room.players.length);
  return true;
}

/* ============================================================
   TRICK
   ============================================================ */

function refill(room, start) {
  const g = room.game;

  for (let n = 0; n < room.players.length; n++) {
    const p = room.players[(start + n) % room.players.length];

    while (p.hand.length < 5 && g.deck.length) {
      p.hand.push(g.deck.pop());
    }
  }
}

function completeTrick(room) {
  const g = room.game;

  if (!g || g.processing) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  g.processing = true;

  const wi = winnerIndex(g.table, g.trump);
  const winnerPlay = g.table[wi];
  const pi = room.players.findIndex(function (p) {
    return p.id === winnerPlay.playerId;
  });

  const winner = room.players[pi];

  g.table.forEach(function (p) {
    winner.captured.push.apply(winner.captured, p.cards);
  });

  g.lastTrickOrder = g.table.map(function (p) {
    return p.playerId;
  });

  io.to(room.id).emit('trickWon', {
    winnerId: winner.id
  });

  setTimeout(function () {
    if (!rooms.has(room.id) || room.game !== g) return;

    g.table = [];
    g.leadCount = 0;
    g.leadMaliutka = false;

    refill(room, pi);

    const empty =
      !g.deck.length &&
      room.players.every(function (p) {
        return p.hand.length === 0;
      });

    if (empty) {
      finishHand(room);
      return;
    }

    g.processing = false;
    setTurn(room, pi);
  }, 850);
}

/* ============================================================
   NEXT LEADER / GAKHISHTVA
   ============================================================ */

function nextLeader(room, g, raw) {
  const zeros = room.players.filter(function (p) {
    return raw[p.id] === 0;
  }).map(function (p) {
    return p.id;
  });

  if (zeros.length >= 2 && g.lastTrickOrder.length) {
    let lastZero = null;

    g.lastTrickOrder.forEach(function (id) {
      if (zeros.includes(id)) lastZero = id;
    });

    if (lastZero) {
      const i = room.players.findIndex(function (p) {
        return p.id === lastZero;
      });

      return (i + 1) % room.players.length;
    }
  }

  let min = Infinity;
  let index = 0;

  room.players.forEach(function (p, i) {
    if (raw[p.id] < min) {
      min = raw[p.id];
      index = i;
    }
  });

  return (index + 1) % room.players.length;
}

/* ============================================================
   HAND / PARTY SCORING
   ============================================================ */

async function finishHand(room) {
  const g = room.game;
  const raw = {};
  const score = {};

  room.players.forEach(function (p) {
    const r = p.captured.reduce(function (sum, c) {
      return sum + points(c);
    }, 0);

    raw[p.id] = r;
    score[p.id] = r === 0 ? -120 : r;

    p.lastRaw = r;
    p.total += score[p.id];
  });

  g.lastScores = score;

  g.history.push({
    hand: g.handIndex,
    party: g.partyIndex,
    trump: g.trump,
    rawScores: Object.assign({}, raw),
    scores: Object.assign({}, score)
  });

  /* ყოველი 5 ხელი = ერთი პარტია */
  if (g.handIndex % 5 === 0) {
    let best = -Infinity;
    let winners = [];

    room.players.forEach(function (p) {
      const delta = p.total - Number(g.partyStart[p.id] || 0);

      if (delta > best) {
        best = delta;
        winners = [p];
      } else if (delta === best) {
        winners.push(p);
      }

      const u = userOf(p);
      if (u) addXP(u, 20); // ითამაშა პარტია
    });

    winners.forEach(function (p) {
      const u = userOf(p);
      if (!u) return;

      u.wins++;
      u.quests.wins++;
      addXP(u, 80);
      checkQuests(u);

      p.wins = u.wins;
      p.xp = u.xp;
      p.level = u.level;
    });
  }

  await saveUsersNow();

  if (g.handIndex >= g.totalHands) {
    finishGame(room);
    return;
  }

  g.nextLeader = nextLeader(room, g, raw);

  const history = g.history;
  const scores = g.lastScores;

  startHand(room, g);

  room.game.history = history;
  room.game.lastScores = scores;

  setTurn(room, room.game.current);
}

/* ============================================================
   GAME OVER
   ============================================================ */

function finishGame(room) {
  const g = room.game;
  g.gameOver = true;
  g.processing = false;

  let winner = room.players[0];

  room.players.forEach(function (p) {
    if (p.total > winner.total) winner = p;
  });

  const u = userOf(winner);
  if (u) addXP(u, 100);

  io.to(room.id).emit('gameWinner', {
    playerId: winner.id,
    playerName: winner.name
  });

  broadcast(room);
}

/* ============================================================
   SMART BOT
   ============================================================ */

function combinations(arr, count, start, current, out) {
  start = start || 0;
  current = current || [];
  out = out || [];

  if (current.length === count) {
    out.push(current.slice());
    return out;
  }

  for (let i = start; i < arr.length; i++) {
    current.push(arr[i]);
    combinations(arr, count, i + 1, current, out);
    current.pop();
  }

  return out;
}

function cardCost(card, trump) {
  let cost = points(card) * 100 + rank(card);
  if (isTrump(card, trump)) cost += 10000;
  return cost;
}

function cheapestCut(hand, count, target, trump) {
  const indexes = hand.map(function (_, i) { return i; });
  const combos = combinations(indexes, count);
  const requireSuit = count > 1 && sameSuitPossible(hand, count);

  let best = null;
  let cost = Infinity;

  combos.forEach(function (combo) {
    const cards = combo.map(function (i) { return hand[i]; });

    if (requireSuit && !sameSuit(cards)) return;
    if (!playBeats(target, cards, trump)) return;

    const c = cards.reduce(function (sum, card) {
      return sum + cardCost(card, trump);
    }, 0);

    if (c < cost) {
      cost = c;
      best = combo;
    }
  });

  return best;
}

function lowestDiscard(hand, count, trump) {
  const indexes = hand.map(function (_, i) { return i; });
  const combos = combinations(indexes, Math.min(count, hand.length));
  const requireSuit = count > 1 && sameSuitPossible(hand, count);

  let best = null;
  let cost = Infinity;

  combos.forEach(function (combo) {
    const cards = combo.map(function (i) { return hand[i]; });

    if (requireSuit && !sameSuit(cards)) return;

    const c = cards.reduce(function (sum, card) {
      return sum + cardCost(card, trump);
    }, 0);

    if (c < cost) {
      cost = c;
      best = combo;
    }
  });

  return best || indexes.slice(0, count);
}

function botChoice(room, player) {
  const g = room.game;

  if (!g.table.length) {
    const groups = {};

    player.hand.forEach(function (c, i) {
      if (!groups[c.suit]) groups[c.suit] = [];
      groups[c.suit].push(i);
    });

    const five = Object.values(groups).find(function (x) {
      return x.length === 5;
    });

    if (five) return five;

    const multi = Object.values(groups)
      .filter(function (x) { return x.length >= 2; })
      .sort(function (a, b) { return b.length - a.length; });

    if (multi.length && Math.random() < 0.3) {
      return multi[0].slice(0, Math.min(4, multi[0].length));
    }

    return lowestDiscard(player.hand, 1, g.trump);
  }

  if (g.leadMaliutka) {
    return player.hand.map(function (_, i) { return i; });
  }

  const count = g.leadCount;
  const wi = winnerIndex(g.table, g.trump);
  const target = g.table[wi].cards;

  return cheapestCut(player.hand, count, target, g.trump) ||
    lowestDiscard(player.hand, count, g.trump);
}

function scheduleBot(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;

  if (room.botTimer) clearTimeout(room.botTimer);

  const p = room.players[room.game.current];
  if (!p || !p.isBot) return;

  io.to(room.id).emit('botThinking', {
    playerId: p.id,
    text: '🤖 ბოტი ფიქრობს...'
  });

  room.botTimer = setTimeout(function () {
    room.botTimer = null;

    if (!room.game || room.game.processing || room.game.gameOver) return;

    const active = room.players[room.game.current];
    if (!active || active.id !== p.id) return;

    play(room, p, botChoice(room, p));
  }, rand(1200, 1800));
}

function autoPlay(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;

  const p = room.players[room.game.current];
  if (!p) return;

  play(room, p, botChoice(room, p));
}

/* ============================================================
   LOBBY
   ============================================================ */

function lobbyData() {
  return Array.from(rooms.values())
    .filter(function (r) {
      return !r.game && r.players.length < r.capacity;
    })
    .map(function (r) {
      return {
        id: r.id,
        name: r.name,
        stake: r.stake,
        players: r.players.length,
        capacity: r.capacity,
        parties: r.parties
      };
    });
}

function lobby() {
  io.emit('lobbyTables', lobbyData());
}

/* ============================================================
   TOURNAMENTS — SINGLE ELIMINATION INFO/REGISTRATION
   ============================================================ */

const tournaments = [{
  id: 'bura_cup',
  name: 'Written Bura Cup',
  prize: '$1,000',
  startAt: Date.now() + 60 * 60 * 1000,
  maxPlayers: 16,
  registered: [],
  status: 'registration'
}];

function tournamentData() {
  return tournaments.map(function (t) {
    return {
      id: t.id,
      name: t.name,
      prize: t.prize,
      startAt: t.startAt,
      maxPlayers: t.maxPlayers,
      registered: t.registered.length,
      status: t.status
    };
  });
}

/* ============================================================
   JOIN
   ============================================================ */

function joinRoom(socket, data) {
  const user = users.get(socket.data.userId);
  let room = data.roomId ? rooms.get(data.roomId) : null;

  if (room && (room.game || room.players.length >= room.capacity)) {
    socket.emit('errorMessage', 'მაგიდა აღარ არის თავისუფალი.');
    return;
  }

  if (!room) {
    room = makeRoom(
      data.tableName,
      data.capacity,
      data.parties,
      data.stake
    );
  }

  let p = user
    ? human(user, socket)
    : human(null, socket, data.name);

  const existing = user ? room.players.find(function (x) {
    return x.userId === user.id;
  }) : null;

  if (existing) {
    p = existing;
    p.socketId = socket.id;
    p.connected = true;
  } else {
    room.players.push(p);
  }

  socket.data.roomId = room.id;
  socket.data.playerId = p.id;
  socket.join(room.id);

  if (user) {
    user.socketId = socket.id;
    user.roomId = room.id;
    playedTable(user, room.id);
  }

  if (tester(p.name)) fillBots(room);

  if (room.players.length >= room.capacity) {
    startHand(room);
    setTurn(room, 0);
    io.to(room.id).emit('dealAnimation');
  } else {
    io.to(room.id).emit('waitingForPlayers', {
      current: room.players.length,
      max: room.capacity
    });
  }

  lobby();
}

/* ============================================================
   RECOVERY
   ============================================================ */

function recover(socket, user) {
  const room = Array.from(rooms.values()).find(function (r) {
    return r.players.some(function (p) {
      return p.userId === user.id;
    });
  });

  if (!room) return;

  const p = room.players.find(function (x) {
    return x.userId === user.id;
  });

  if (!p || p.isBot) return;

  if (p.reconnectTimer) {
    clearTimeout(p.reconnectTimer);
    p.reconnectTimer = null;
  }

  p.connected = true;
  p.socketId = socket.id;

  socket.data.roomId = room.id;
  socket.data.playerId = p.id;

  user.roomId = room.id;
  user.socketId = socket.id;

  socket.join(room.id);

  socket.emit('sessionRecovered');

  if (room.game) {
    socket.emit(
      'gameStateUpdate',
      state(room, p.id, tester(p.name))
    );
  }
}

/* ============================================================
   SOCKET.IO
   ============================================================ */

io.on('connection', function (socket) {
  socket.data.userId = null;
  socket.data.roomId = null;
  socket.data.playerId = null;

  socket.emit('lobbyTables', lobbyData());
  socket.emit('tournaments', tournamentData());

  socket.on('register', async function (data) {
    try {
      const username = clean(data && data.username);
      const password = String((data && data.password) || '');

      if (username.length < 3) {
        socket.emit('authError', 'Username მინიმუმ 3 სიმბოლო.');
        return;
      }

      if (password.length < 6) {
        socket.emit('authError', 'Password მინიმუმ 6 სიმბოლო.');
        return;
      }

      if (findUser(username)) {
        socket.emit('authError', 'Username უკვე არსებობს.');
        return;
      }

      const pw = await makePassword(password);

      const u = defaults({
        id: uid('user'),
        username: username,
        passwordSalt: pw.salt,
        passwordHash: pw.hash,
        avatar: validAvatar(data.avatar),
        xp: 0,
        wins: 0,
        balance: START_BALANCE,
        achievements: [],
        quests: defaultQuests(),
        socketId: socket.id
      });

      users.set(u.id, u);
      socket.data.userId = u.id;

      const token = newSession(u);
      await saveUsersNow();

      socket.emit('authSuccess', {
        token: token,
        profile: profile(u)
      });
    } catch (e) {
      console.error(e);
      socket.emit('authError', 'რეგისტრაცია ვერ შესრულდა.');
    }
  });

  socket.on('login', async function (data) {
    const u = findUser(data && data.username);

    if (!u || !(await checkPassword((data && data.password) || '', u))) {
      socket.emit('authError', 'Username ან Password არასწორია.');
      return;
    }

    u.socketId = socket.id;
    socket.data.userId = u.id;

    const token = newSession(u);

    socket.emit('authSuccess', {
      token: token,
      profile: profile(u)
    });

    recover(socket, u);
  });

  socket.on('testerLogin', function () {
    let u = findUser(TESTER_NAME);

    if (!u) {
      u = defaults({
        id: uid('tester'),
        username: TESTER_NAME,
        passwordSalt: '',
        passwordHash: '',
        avatar: '🧙',
        xp: 999,
        wins: 10,
        balance: START_BALANCE,
        achievements: [],
        quests: defaultQuests(),
        tester: true
      });

      users.set(u.id, u);
    }

    u.socketId = socket.id;
    socket.data.userId = u.id;

    const token = newSession(u);

    socket.emit('authSuccess', {
      token: token,
      profile: profile(u)
    });

    recover(socket, u);
    saveLater();
  });

  socket.on('restoreSession', function (data) {
    const s = sessions.get(String((data && data.token) || ''));

    if (!s) {
      socket.emit('sessionInvalid');
      return;
    }

    const u = users.get(s.userId);

    if (!u) {
      socket.emit('sessionInvalid');
      return;
    }

    u.socketId = socket.id;
    socket.data.userId = u.id;

    socket.emit('authSuccess', {
      token: data.token,
      profile: profile(u)
    });

    recover(socket, u);
  });

  socket.on('joinTable', function (data) {
    joinRoom(socket, data || {});
  });

  socket.on('playCards', function (data) {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.game) return;

    const p = room.players.find(function (x) {
      return x.id === socket.data.playerId;
    });

    if (!p) return;

    const active = room.players[room.game.current];

    if (!active || active.id !== p.id) {
      socket.emit('errorMessage', 'ახლა შენი სვლა არ არის.');
      return;
    }

    play(room, p, (data && (data.cardIndices || data.indexes)) || []);
  });

  socket.on('quickMessage', function (data) {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    const allowed = [
      'სიქიიიიიმ!',
      'ყვერო, მალე!',
      'რას შვრები, ძმაო?!',
      'ვაჰ, კოზირი!',
      '⚡ სწრაფად!',
      '👍 კარგი იყო'
    ];

    const text = String((data && data.text) || '');

    if (!allowed.includes(text)) return;

    io.to(room.id).emit('quickMessage', {
      playerId: socket.data.playerId,
      text: text
    });
  });

  socket.on('throwable', function (data) {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    const type = String((data && data.type) || '');
    if (!['tomato', 'egg', 'paper'].includes(type)) return;

    io.to(room.id).emit('throwableEvent', {
      fromPlayerId: socket.data.playerId,
      targetPlayerId: data.targetPlayerId,
      type: type
    });
  });

  socket.on('registerTournament', function (data) {
    const u = users.get(socket.data.userId);
    if (!u) return;

    const t = tournaments.find(function (x) {
      return x.id === data.id;
    });

    if (!t || t.status !== 'registration') return;

    if (!t.registered.includes(u.id) && t.registered.length < t.maxPlayers) {
      t.registered.push(u.id);
    }

    io.emit('tournaments', tournamentData());
  });

  socket.on('disconnect', function () {
    const room = rooms.get(socket.data.roomId);
    const u = users.get(socket.data.userId);

    if (u && u.socketId === socket.id) {
      u.socketId = null;
    }

    if (!room) return;

    const p = room.players.find(function (x) {
      return x.id === socket.data.playerId;
    });

    if (!p) return;

    p.connected = false;
    p.socketId = null;

    broadcast(room);

    if (p.reconnectTimer) clearTimeout(p.reconnectTimer);

    p.reconnectTimer = setTimeout(function () {
      p.reconnectTimer = null;

      if (p.connected) return;

      if (room.game && !room.game.gameOver) {
        p.isBot = true;
        p.name += ' 🤖';
        p.avatar = '🤖';

        if (room.players[room.game.current] === p) {
          scheduleBot(room);
        }

        broadcast(room);
        return;
      }

      const i = room.players.indexOf(p);
      if (i >= 0) room.players.splice(i, 1);

      if (!room.players.length) {
        if (room.timer) clearTimeout(room.timer);
        if (room.botTimer) clearTimeout(room.botTimer);
        rooms.delete(room.id);
      }

      lobby();
    }, RECONNECT_MS);
  });
});

/* ============================================================
   MONOLITHIC PAGE
   IMPORTANT:
   Client JS intentionally avoids nested template literals.
   ============================================================ */

const PAGE = String.raw`<!doctype html>
<html lang="ka">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Written Bura</title>
<style>
*{box-sizing:border-box}
:root{
 --bg:#07110e;--glass:rgba(7,20,17,.78);--gold:#e5bd61;
 --felt:#073f2d;--felt2:#052a20;--wood:#492718;--text:#f7f3e8;
 --muted:#9eb1aa;--red:#7c1725;--green:#1ba66d
}
html,body{margin:0;min-height:100%;font-family:Arial,"Noto Sans Georgian",sans-serif;background:#050b09;color:var(--text)}
body{overflow-x:hidden}
button,input,select{font:inherit}
button{cursor:pointer}
.hidden{display:none!important}

.bg{
 position:fixed;inset:0;z-index:-5;
 background:
 radial-gradient(circle at 50% 20%,rgba(21,121,82,.18),transparent 35%),
 linear-gradient(135deg,#040806,#0b1c16 50%,#050907)
}
.bg:after{
 content:"♠   ♥   ♦   ♣";position:absolute;inset:0;display:grid;place-items:center;
 font-size:min(20vw,260px);letter-spacing:4vw;color:rgba(255,255,255,.018);
 filter:blur(2px)
}
.glass{
 background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.025));
 border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(18px);
 box-shadow:0 20px 70px rgba(0,0,0,.35)
}
#auth,#lobby{width:min(1100px,94vw);margin:35px auto}
.brand{font-size:30px;font-weight:900;letter-spacing:.5px}
.brand span{color:var(--gold)}
.authbox{width:min(520px,100%);margin:10vh auto;padding:28px;border-radius:28px}
.tabs{display:flex;gap:8px;margin:20px 0}
.tabs button,.smallBtn{border:1px solid rgba(255,255,255,.12);background:#10231d;color:white;border-radius:12px;padding:10px 15px}
.tabs button.active{background:var(--gold);color:#15100a}
.field{width:100%;padding:13px;margin:7px 0;border-radius:13px;border:1px solid #29443a;background:#081612;color:white}
.primary{border:0;background:linear-gradient(135deg,#e8c76e,#a87523);color:#171006;font-weight:900;padding:13px 18px;border-radius:14px;box-shadow:0 8px 25px rgba(229,189,97,.22)}
.avatarChoices{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.avatarChoice{font-size:25px;background:#10231d;border:2px solid transparent;border-radius:50%;width:48px;height:48px}
.avatarChoice.on{border-color:var(--gold)}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px}
.profile{display:flex;align-items:center;gap:10px}
.profileAvatar{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-size:27px;border:2px solid var(--gold);overflow:hidden}
.profileAvatar img,.avatar img{width:100%;height:100%;object-fit:cover}
.level{font-size:11px;background:var(--gold);color:#171006;border-radius:20px;padding:3px 8px;font-weight:900}
.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}
.panel{padding:18px;border-radius:22px}
.tableRow,.tourRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid rgba(255,255,255,.08)}
.stakes{display:flex;gap:8px;flex-wrap:wrap}
.stake{padding:10px 14px;border-radius:12px;background:#10231d;color:white;border:1px solid #315247}
.stake.on{background:var(--gold);color:#181108}
.quest{padding:10px;background:rgba(0,0,0,.18);border-radius:12px;margin:8px 0}
.progress{height:7px;background:#172720;border-radius:10px;overflow:hidden;margin-top:6px}
.progress i{display:block;height:100%;background:var(--gold)}
.error{color:#ff8994;min-height:20px;margin:8px 0}

#game{min-height:100vh;padding:10px 12px 20px}
.hud{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;position:relative;z-index:20}
.pill{padding:8px 13px;border-radius:999px;background:rgba(6,18,15,.72);border:1px solid rgba(255,255,255,.13);box-shadow:0 6px 22px #0006}
.pill b{color:var(--gold)}
.gameButtons{position:absolute;right:15px;top:12px;display:flex;gap:6px;z-index:30}

.arena{height:calc(100vh - 75px);min-height:620px;position:relative;display:flex;align-items:center;justify-content:center}
.wood{
 width:min(1120px,94vw);height:min(690px,78vh);min-height:540px;
 border-radius:48% / 42%;
 padding:22px;
 background:
 linear-gradient(90deg,rgba(255,255,255,.07),transparent 12%,rgba(0,0,0,.18)),
 repeating-linear-gradient(90deg,#4b2818 0 25px,#57301d 25px 50px,#3e2115 50px 75px);
 box-shadow:0 40px 100px #000, inset 0 0 0 4px #7b4d2b,inset 0 0 40px #000
}
.table{
 width:100%;height:100%;border-radius:48% / 42%;position:relative;overflow:hidden;
 background:
 radial-gradient(ellipse at 50% 42%,rgba(31,132,87,.3),transparent 42%),
 repeating-radial-gradient(circle at 30% 30%,rgba(255,255,255,.018) 0 1px,transparent 1px 4px),
 linear-gradient(145deg,#07513a,#052b21);
 box-shadow:inset 0 0 90px #001a12,inset 0 0 0 3px rgba(255,255,255,.05)
}
.table:after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 120px #0008;border-radius:inherit}

.trump{position:absolute;left:50%;top:36%;transform:translate(-50%,-50%);text-align:center;z-index:3}
.trumpSymbol{font-size:75px;line-height:1;text-shadow:0 0 8px white,0 0 22px #f1c45b,0 0 45px #e0a529;filter:drop-shadow(0 14px 10px #0008)}
.trumpLabel{font-size:11px;letter-spacing:3px;color:#d9c58e}

.deck{position:absolute;left:42%;top:50%;width:62px;height:88px;border-radius:9px;background:linear-gradient(135deg,#142e67,#071738);border:3px solid white;box-shadow:6px 6px 0 #07162f,10px 10px 0 #061126;z-index:4}
.deck:after{content:"♠";display:grid;place-items:center;height:100%;font-size:38px;color:#d9b85e}

.centerCards{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);display:flex;gap:5px;z-index:8}
.playGroup{display:flex;gap:3px;margin:0 -8px;animation:drop .28s ease}
@keyframes drop{from{transform:translate3d(0,-35px,0) scale(.8);opacity:0}to{transform:none;opacity:1}}

.card{
 width:66px;height:96px;border-radius:10px;background:linear-gradient(145deg,#fff,#e9e5dc);
 border:1px solid #fff;box-shadow:0 8px 18px #0008;position:relative;color:#101010;
 display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;
 user-select:none;transition:.2s transform,.2s box-shadow,.2s filter
}
.card:before{content:"";position:absolute;inset:1px;border-radius:9px;background:linear-gradient(120deg,rgba(255,255,255,.75),transparent 35%);pointer-events:none}
.card .rank{font-size:20px}
.card .suit{font-size:25px}
.card.hearts{color:#7d1423}
.card.diamonds{color:#102e69}
.card.clubs{color:#08704c}
.card.spades{color:#111}
.card.selected{transform:translateY(-20px)!important;box-shadow:0 0 0 3px #e7bd54,0 0 28px #ffd86b,0 12px 25px #0009}
.card.cutGlow{box-shadow:0 0 28px #fff,0 0 50px #e9c45e}

.seat{position:absolute;z-index:12;text-align:center;min-width:120px;transform:translate(-50%,-50%)}
.avatarWrap{position:relative;display:inline-block}
.avatar{
 width:70px;height:70px;border-radius:50%;background:#17251f;border:3px solid #d4a944;
 display:grid;place-items:center;font-size:34px;overflow:hidden;box-shadow:0 7px 20px #0008;
 transition:.25s
}
.seat.active .avatar{box-shadow:0 0 0 4px #f0c85b55,0 0 30px #f6ce5d,0 0 55px #43d893;animation:pulse 1s infinite alternate}
@keyframes pulse{to{transform:scale(1.06)}}
.seatName{font-weight:900;text-shadow:0 2px 5px #000;margin-top:4px}
.seatMeta{font-size:11px;color:#d7d9cf}
.levelBadge{position:absolute;right:-5px;bottom:2px;background:var(--gold);color:#1a1208;border-radius:20px;padding:3px 7px;font-size:10px;font-weight:900}
.timerRing{position:absolute;inset:-7px;border-radius:50%;border:3px solid transparent;pointer-events:none}
.seat.active .timerRing{border-top-color:#f4cf65;border-right-color:#49d69a}

.me{left:50%;bottom:2%;top:auto;transform:translateX(-50%)}
.topSeat{left:50%;top:10%}
.leftSeat{left:10%;top:50%}
.rightSeat{left:90%;top:50%}

.hand{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);display:flex;justify-content:center;z-index:20;height:125px}
.hand .card{margin-left:-18px;transform-origin:50% 150%;cursor:pointer}
.hand .card:first-child{margin-left:0}
.hand .card:hover{transform:translateY(-10px)}

.actionArea{position:absolute;left:50%;bottom:145px;transform:translateX(-50%);z-index:30;text-align:center}
.playBtn{min-width:180px;border:0;border-radius:16px;padding:13px 20px;background:#234037;color:#778c85;font-weight:900;box-shadow:0 8px 20px #0007}
.playBtn.ready{background:linear-gradient(135deg,#f0ce73,#a87826);color:#171007;box-shadow:0 0 25px #e7bd5555}
.status{font-size:12px;margin-top:6px;text-shadow:0 2px 4px #000}

.side{position:absolute;right:16px;top:75px;width:260px;z-index:25}
.score{border-radius:18px;padding:13px;max-height:380px;overflow:auto}
.score h3{margin:0 0 8px}
.scorePlayer{display:flex;justify-content:space-between;padding:5px 0}
.total{font-size:18px;color:var(--gold);font-weight:900}
.historyItem{font-size:11px;padding:6px;border-top:1px solid #ffffff12;color:#cad7d1}
.reactions{margin-top:8px;border-radius:16px;padding:9px;display:flex;flex-wrap:wrap;gap:5px}
.reactions button{border:1px solid #ffffff18;background:#10231d;color:white;border-radius:10px;padding:7px;font-size:11px}

.giftMenu{position:fixed;z-index:100;background:#0b1915;border:1px solid #d9b65b;border-radius:15px;padding:8px;display:flex;gap:5px;box-shadow:0 15px 50px #000}
.giftMenu button{font-size:24px;background:#13261f;border:0;border-radius:10px;padding:8px}
.projectile{position:fixed;z-index:999;font-size:35px;pointer-events:none;transition:transform .7s cubic-bezier(.2,.7,.2,1)}
.splat{position:absolute;inset:0;display:grid;place-items:center;font-size:48px;z-index:50;pointer-events:none;animation:splat .25s ease}
@keyframes splat{from{transform:scale(.2) rotate(-40deg)}to{transform:scale(1) rotate(0)}}

.toast{position:fixed;left:50%;top:85px;transform:translateX(-50%);z-index:500;padding:13px 20px;border-radius:15px;background:#111f1a;border:1px solid #d7b45c;box-shadow:0 15px 50px #000;animation:toast .3s ease}
@keyframes toast{from{transform:translate(-50%,-20px);opacity:0}}

.modal{position:fixed;inset:0;background:#000b;z-index:1000;display:grid;place-items:center;padding:15px}
.modalBox{width:min(760px,96vw);max-height:86vh;overflow:auto;border-radius:24px;padding:24px;background:#0c1915;border:1px solid #ffffff20}
.modalBox h2{color:var(--gold)}
.rule{background:#ffffff08;border-radius:14px;padding:12px;margin:8px 0;line-height:1.55}

@media(max-width:850px){
 .grid{grid-template-columns:1fr}
 .side{right:6px;top:70px;width:190px}
 .wood{width:98vw;height:72vh;min-height:530px;padding:12px}
 .avatar{width:56px;height:56px;font-size:27px}
 .seat{min-width:90px}
 .leftSeat{left:8%}.rightSeat{left:92%}
 .card{width:53px;height:78px}
 .hand .card{margin-left:-22px}
 .hand{bottom:1%;height:105px}
 .actionArea{bottom:115px}
 .trumpSymbol{font-size:58px}
}
@media(max-width:600px){
 .side{top:110px;width:150px}
 .score{font-size:11px;max-height:220px}
 .reactions{display:none}
 .hud{padding-right:0}
 .pill{font-size:10px;padding:6px 9px}
 .gameButtons{position:relative;right:auto;top:auto;justify-content:center;margin-top:6px}
 .arena{min-height:570px}
}
</style>
</head>
<body>

<div class="bg"></div>

<section id="auth">
 <div class="authbox glass">
  <div class="brand">WRITTEN <span>BURA</span></div>
  <p style="color:#9eb1aa">წერითი ბურა · ონლაინ მაგიდა</p>

  <div class="tabs">
   <button id="loginTab" class="active">შესვლა</button>
   <button id="registerTab">რეგისტრაცია</button>
  </div>

  <input id="username" class="field" placeholder="Username" value="saba123">
  <input id="password" class="field" type="password" placeholder="Password">

  <div id="avatarBox" class="hidden">
   <small>აირჩიე ავატარი</small>
   <div class="avatarChoices">
    <button class="avatarChoice on">🦊</button>
    <button class="avatarChoice">😎</button>
    <button class="avatarChoice">🦁</button>
    <button class="avatarChoice">🐺</button>
    <button class="avatarChoice">👑</button>
    <button class="avatarChoice">🧙</button>
   </div>
   <input id="avatarFile" class="field" type="file" accept="image/png,image/jpeg,image/webp">
  </div>

  <div id="authError" class="error"></div>
  <button id="authBtn" class="primary">შესვლა</button>
  <button id="testerBtn" class="smallBtn">🧪 saba123 TEST MODE</button>
 </div>
</section>

<section id="lobby" class="hidden">
 <div class="top">
  <div class="brand">WRITTEN <span>BURA</span></div>
  <div class="profile">
   <div id="profileAvatar" class="profileAvatar">🦊</div>
   <div>
    <b id="profileName">Player</b>
    <div><span id="profileLevel" class="level">LVL 1</span> <small id="profileXp">0 XP</small></div>
   </div>
  </div>
 </div>

 <div class="grid">
  <div>
   <div class="panel glass">
    <h2>🎴 ახალი მაგიდა</h2>
    <input id="tableName" class="field" value="Written Bura" placeholder="მაგიდის სახელი">

    <div class="stakes">
     <button class="stake on" data-stake="5">$5</button>
     <button class="stake" data-stake="10">$10</button>
     <button class="stake" data-stake="25">$25</button>
     <button class="stake" data-stake="50">$50</button>
     <button class="stake" data-stake="100">$100</button>
    </div>

    <div style="display:flex;gap:8px;margin:12px 0">
     <select id="capacity" class="field"><option value="3">3 მოთამაშე</option><option value="4" selected>4 მოთამაშე</option></select>
     <select id="parties" class="field"><option value="1">1 პარტია</option><option value="2">2 პარტია</option><option value="3">3 პარტია</option><option value="4">4 პარტია</option></select>
    </div>

    <button id="createBtn" class="primary">შექმენი / შედი მაგიდაზე</button>
   </div>

   <div class="panel glass" style="margin-top:15px">
    <h2>🟢 აქტიური მაგიდები</h2>
    <div id="tables"></div>
   </div>
  </div>

  <div>
   <div class="panel glass">
    <h2>🎯 დღიური დავალებები</h2>
    <div id="quests"></div>
   </div>

   <div class="panel glass" style="margin-top:15px">
    <h2>🏆 ტურნირები</h2>
    <div id="tournaments"></div>
   </div>
  </div>
 </div>
</section>

<section id="game" class="hidden">
 <div class="hud">
  <div class="pill">🏆 პარტია <b id="hudParty">1</b></div>
  <div class="pill">🎴 ხელი <b id="hudHand">1</b></div>
  <div class="pill">♛ კოზირი <b id="hudTrump">♠</b></div>
  <div class="pill">🂠 დასტა <b id="hudDeck">0</b></div>
  <div class="pill">💰 ფსონი <b id="hudStake">$5</b></div>
 </div>

 <div class="gameButtons">
  <button id="rulesBtn" class="smallBtn">📖 წესები</button>
  <button id="muteBtn" class="smallBtn">🔊</button>
 </div>

 <div class="arena">
  <div class="wood">
   <div id="table" class="table">
    <div class="trump">
     <div class="trumpLabel">TRUMP</div>
     <div id="trumpSymbol" class="trumpSymbol">♠</div>
    </div>
    <div class="deck"></div>
    <div id="centerCards" class="centerCards"></div>
    <div id="seats"></div>
    <div id="hand" class="hand"></div>

    <div class="actionArea">
     <button id="playBtn" class="playBtn" disabled>სვლის გაკეთება</button>
     <div id="status" class="status">...</div>
    </div>
   </div>
  </div>

  <aside class="side">
   <div class="score glass">
    <h3>LIVE SCORE</h3>
    <div id="scorePlayers"></div>
    <div id="history"></div>
   </div>

   <div class="reactions glass">
    <button data-phrase="სიქიიიიიმ!">სიქიიიიიმ!</button>
    <button data-phrase="ყვერო, მალე!">ყვერო, მალე!</button>
    <button data-phrase="რას შვრები, ძმაო?!">რას შვრები, ძმაო?!</button>
    <button data-phrase="ვაჰ, კოზირი!">ვაჰ, კოზირი!</button>
   </div>
  </aside>
 </div>
</section>

<div id="giftMenu" class="giftMenu hidden">
 <button data-gift="tomato">🍅</button>
 <button data-gift="egg">🥚</button>
 <button data-gift="paper">🧻</button>
</div>

<div id="rulesModal" class="modal hidden">
 <div class="modalBox">
  <button id="closeRules" class="smallBtn" style="float:right">✕</button>
  <h2>📖 წერითი ბურას წესები</h2>

  <div class="rule"><b>🃏 დასტა</b><br>თამაშში გამოიყენება 36 კარტი: 6, 7, 8, 9, J, Q, K, 10, A. თითოეულ მოთამაშეს ურიგდება 5 კარტი.</div>
  <div class="rule"><b>💯 ქულები</b><br>J=2, Q=3, K=4, 10=10, A=11. 6–9 არის 0 ქულა. ხელში 0 აღებული ქულის შემთხვევაში მოთამაშე იღებს -120 ქულას.</div>
  <div class="rule"><b>✂️ ჭრა</b><br>თუ პირველი მოთამაშე ჩამოდის N კარტით, პასუხიც ზუსტად N კარტია. მაღალი იმავე მასტის კარტი ჭრის დაბალს; კოზირი ჭრის არაკოზირს. მრავალკარტიან სვლაზე სისტემა ამოწმებს ყველა კარტის one-to-one ჭრას.</div>
  <div class="rule"><b>4️⃣ ოთხი კარტი</b><br>შესაძლებელია 2, 3 ან 4 ერთნაირი მასტის კარტით ერთდროულად სვლა.</div>
  <div class="rule"><b>🔥 მალიუტკა</b><br>5 ერთნაირი მასტის კარტი არის მალიუტკა. მალიუტკის შემდეგ მოთამაშეები ჩამოდიან მთელი დარჩენილი ხელით.</div>
  <div class="rule"><b>💀 გახიშტვა</b><br>თუ მოთამაშემ ხელში საერთოდ ვერ აიღო ქულა, მისი ხელის ქულაა -120. ბოლო ხელში რამდენიმე ნულიანი მოთამაშის შემთხვევაში შემდეგი დამწყები განისაზღვრება ბოლო ნულიანი მოთამაშის შემდეგ.</div>
  <div class="rule"><b>🔄 შემდეგი ხელი</b><br>პირველ ხელს იწყებს მაგიდაზე პირველი შემოსული მოთამაშე. შემდეგ ხელს იწყებს წინა ხელში ყველაზე ნაკლები raw ქულის მქონე მოთამაშის შემდეგ მჯდომი.</div>
 </div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
(function(){
'use strict';

var socket = io();
var current = null;
var profile = null;
var selected = [];
var authMode = 'login';
var chosenAvatar = '🦊';
var stake = 5;
var giftTarget = null;
var muted = false;
var audio = null;
var touchStart = {};

function el(id){return document.getElementById(id)}
function esc(v){var d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML}
function symbol(s){return {spades:'♠',hearts:'♥',diamonds:'♦',clubs:'♣',no_trump:'★'}[s]||'★'}
function suitClass(s){return s||'spades'}

function show(id){el(id).classList.remove('hidden')}
function hide(id){el(id).classList.add('hidden')}

function setAvatar(node,value){
 node.innerHTML='';
 if(String(value||'').indexOf('data:image/')===0){
  var img=document.createElement('img');img.src=value;node.appendChild(img);
 }else node.textContent=value||'🦊';
}

function initAudio(){
 if(audio)return;
 var AC=window.AudioContext||window.webkitAudioContext;
 if(AC)audio=new AC();
}
document.addEventListener('pointerdown',function(){initAudio();if(audio&&audio.state==='suspended')audio.resume()},{once:true});

function tone(freq,dur,type,vol,delay){
 if(muted)return;
 initAudio();
 if(!audio)return;
 var o=audio.createOscillator(),g=audio.createGain();
 var t=audio.currentTime+(delay||0);
 o.type=type||'sine';o.frequency.setValueAtTime(freq,t);
 g.gain.setValueAtTime(vol||.04,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
 o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+dur);
}
function sfx(type){
 if(type==='deal'){tone(500,.05,'triangle',.025);tone(650,.05,'triangle',.02,.07)}
 if(type==='place'){tone(150,.07,'triangle',.06)}
 if(type==='cut'){tone(900,.08,'sawtooth',.05);tone(250,.12,'triangle',.04,.05)}
 if(type==='win'){tone(523,.12,'triangle',.05);tone(659,.12,'triangle',.05,.12);tone(784,.25,'triangle',.05,.24)}
 if(type==='lose'){tone(300,.18,'sine',.04);tone(220,.3,'sine',.04,.16)}
}

function speak(text){
 if(muted)return;
 if('speechSynthesis' in window){
  try{
   var u=new SpeechSynthesisUtterance(text);
   u.lang='ka-GE';u.rate=1.03;u.pitch=.92;
   var voices=speechSynthesis.getVoices();
   var ka=voices.find(function(v){return String(v.lang).toLowerCase().indexOf('ka')===0});
   if(ka)u.voice=ka;
   speechSynthesis.cancel();speechSynthesis.speak(u);
   if(!ka){tone(520,.08,'square',.025);tone(690,.1,'triangle',.02,.1)}
   return;
  }catch(e){}
 }
 tone(520,.08,'square',.025);tone(690,.1,'triangle',.02,.1);
}

el('loginTab').onclick=function(){authMode='login';this.classList.add('active');el('registerTab').classList.remove('active');hide('avatarBox');el('authBtn').textContent='შესვლა'}
el('registerTab').onclick=function(){authMode='register';this.classList.add('active');el('loginTab').classList.remove('active');show('avatarBox');el('authBtn').textContent='რეგისტრაცია'}

document.querySelectorAll('.avatarChoice').forEach(function(b){
 b.onclick=function(){
  document.querySelectorAll('.avatarChoice').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');chosenAvatar=b.textContent;
 }
});

el('avatarFile').onchange=function(){
 var f=this.files&&this.files[0];if(!f)return;
 if(f.size>500000){el('authError').textContent='ავატარი მაქსიმუმ 500KB.';return}
 var r=new FileReader();r.onload=function(){chosenAvatar=r.result};r.readAsDataURL(f);
};

el('authBtn').onclick=function(){
 el('authError').textContent='';
 var data={username:el('username').value,password:el('password').value,avatar:chosenAvatar};
 socket.emit(authMode,data);
};
el('testerBtn').onclick=function(){socket.emit('testerLogin')};

socket.on('authSuccess',function(data){
 profile=data.profile;
 if(data.token)localStorage.setItem('buraToken',data.token);
 hide('auth');show('lobby');renderProfile();
});
socket.on('authError',function(m){el('authError').textContent=m});
socket.on('sessionInvalid',function(){localStorage.removeItem('buraToken')});

function renderProfile(){
 if(!profile)return;
 el('profileName').textContent=profile.username;
 setAvatar(el('profileAvatar'),profile.avatar);
 el('profileLevel').textContent='LVL '+profile.level;
 el('profileXp').textContent=profile.xp+' XP';
 renderQuests();
}
socket.on('profileUpdate',function(p){profile=p;renderProfile()});

function renderQuests(){
 if(!profile)return;
 var q=profile.quests||{};
 var items=[
  ['მოიგე 3 პარტია',q.wins||0,3,'+100 XP'],
  ['ჩადი მალიუტკა 1-ხელ',q.maliutka||0,1,'+250 XP'],
  ['ითამაშე 5 მაგიდაზე',q.tables||0,5,'+50 XP']
 ];
 el('quests').innerHTML=items.map(function(x){
  var pct=Math.min(100,(x[1]/x[2])*100);
  return '<div class="quest"><b>'+esc(x[0])+'</b> · '+x[3]+'<br><small>'+x[1]+'/'+x[2]+'</small><div class="progress"><i style="width:'+pct+'%"></i></div></div>';
 }).join('');
}

document.querySelectorAll('.stake').forEach(function(b){
 b.onclick=function(){
  document.querySelectorAll('.stake').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');stake=Number(b.dataset.stake);
 }
});

el('createBtn').onclick=function(){
 socket.emit('joinTable',{
  tableName:el('tableName').value,
  capacity:Number(el('capacity').value),
  parties:Number(el('parties').value),
  stake:stake
 });
};

socket.on('lobbyTables',function(list){
 el('tables').innerHTML=list.length?list.map(function(t){
  return '<div class="tableRow"><div><b>'+esc(t.name)+'</b><br><small>$'+t.stake+' · '+t.players+'/'+t.capacity+' · '+t.parties+' პარტია</small></div><button class="primary joinRoom" data-id="'+esc(t.id)+'">შეერთება</button></div>';
 }).join(''):'<p style="color:#91a49d">ღია მაგიდები ჯერ არ არის.</p>';

 document.querySelectorAll('.joinRoom').forEach(function(b){
  b.onclick=function(){socket.emit('joinTable',{roomId:b.dataset.id})};
 });
});

socket.on('tournaments',function(list){
 el('tournaments').innerHTML=list.map(function(t){
  return '<div class="tourRow"><div><b>'+esc(t.name)+'</b><br><small>'+esc(t.prize)+' · '+t.registered+'/'+t.maxPlayers+'</small><br><small class="countdown" data-time="'+t.startAt+'"></small></div><button class="smallBtn regTour" data-id="'+t.id+'">რეგისტრაცია</button></div>';
 }).join('');
 document.querySelectorAll('.regTour').forEach(function(b){b.onclick=function(){socket.emit('registerTournament',{id:b.dataset.id})}});
});

setInterval(function(){
 document.querySelectorAll('.countdown').forEach(function(n){
  var ms=Math.max(0,Number(n.dataset.time)-Date.now());
  var h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);
  n.textContent='დაწყებამდე '+h+'სთ '+m+'წთ '+s+'წმ';
 });
},1000);

socket.on('waitingForPlayers',function(x){toast('ველოდებით მოთამაშეებს '+x.current+'/'+x.max)});

socket.on('gameStateUpdate',function(s){
 current=s;selected=[];
 hide('auth');hide('lobby');show('game');render();
});

function render(){
 if(!current)return;
 el('hudParty').textContent=current.partyIndex;
 el('hudHand').textContent=current.handIndex+'/'+current.totalHands;
 el('hudTrump').textContent=symbol(current.trump);
 el('hudDeck').textContent=current.deckCount;
 el('hudStake').textContent='$'+current.stake;

 var ts=el('trumpSymbol');ts.textContent=symbol(current.trump);
 ts.style.color=(current.trump==='hearts')?'#8c1c2c':(current.trump==='diamonds'?'#173e82':(current.trump==='clubs'?'#159568':'#101412'));

 renderSeats();renderCenter();renderHand();renderScore();updateAction();
}

function seatClass(index,total){
 var me=current.players.findIndex(function(p){return p.id===current.viewerId});
 var rel=(index-me+total)%total;
 if(rel===0)return 'me';
 if(total===3)return rel===1?'leftSeat':'rightSeat';
 if(rel===1)return 'leftSeat';
 if(rel===2)return 'topSeat';
 return 'rightSeat';
}

function renderSeats(){
 var box=el('seats');box.innerHTML='';
 current.players.forEach(function(p,i){
  var d=document.createElement('div');
  d.className='seat '+seatClass(i,current.players.length)+(p.isCurrent?' active':'');
  d.dataset.player=p.id;
  var av=document.createElement('div');av.className='avatarWrap';
  var face=document.createElement('div');face.className='avatar';
  setAvatar(face,p.avatar);
  av.appendChild(face);
  var ring=document.createElement('div');ring.className='timerRing';av.appendChild(ring);
  var lvl=document.createElement('div');lvl.className='levelBadge';lvl.textContent='L'+p.level;av.appendChild(lvl);
  d.appendChild(av);
  var nm=document.createElement('div');nm.className='seatName';nm.textContent=p.name;d.appendChild(nm);
  var meta=document.createElement('div');meta.className='seatMeta';meta.textContent=p.cardCount+' კარტი · '+p.totalPoints;d.appendChild(meta);

  if(p.id!==current.viewerId){
   face.onclick=function(ev){
    giftTarget=p.id;
    var m=el('giftMenu');m.style.left=Math.min(window.innerWidth-180,ev.clientX)+'px';m.style.top=Math.min(window.innerHeight-80,ev.clientY)+'px';show('giftMenu');
   };
  }
  box.appendChild(d);
 });
}

function cardNode(c,index,own){
 var d=document.createElement('div');d.className='card '+suitClass(c.suit);
 d.innerHTML='<div class="rank">'+esc(c.rank)+'</div><div class="suit">'+symbol(c.suit)+'</div>';
 if(own){
  d.dataset.index=index;
  if(selected.includes(index))d.classList.add('selected');
  d.onclick=function(){toggle(index)};
  d.addEventListener('touchstart',function(e){touchStart[index]=e.touches[0].clientY},{passive:true});
  d.addEventListener('touchend',function(e){
   var start=touchStart[index],end=e.changedTouches[0].clientY;
   if(start-end>30)toggle(index);
  },{passive:true});
 }
 return d;
}

function renderCenter(){
 var b=el('centerCards');b.innerHTML='';
 current.table.forEach(function(play){
  var g=document.createElement('div');g.className='playGroup';
  play.cards.forEach(function(c){
   var n=cardNode(c,0,false);
   if(play.isWinning)n.classList.add('cutGlow');
   g.appendChild(n);
  });
  b.appendChild(g);
 });
}

function myHand(){
 return current.playersCards[current.viewerId]||[];
}

function renderHand(){
 var h=el('hand');h.innerHTML='';
 myHand().forEach(function(c,i){
  var n=cardNode(c,i,true);
  var mid=(myHand().length-1)/2;
  n.style.transform='rotate('+((i-mid)*5)+'deg) translateY('+Math.abs(i-mid)*2+'px)';
  h.appendChild(n);
 });
}

function toggle(i){
 if(!current)return;
 var meIndex=current.players.findIndex(function(p){return p.id===current.viewerId});
 if(meIndex!==current.currentTurnIndex)return;
 var pos=selected.indexOf(i);
 if(pos>=0)selected.splice(pos,1);else if(selected.length<5)selected.push(i);
 renderHand();updateAction();sfx('place');
}

function selectionValid(){
 if(!current||!selected.length)return false;
 var hand=myHand(),cards=selected.map(function(i){return hand[i]}).filter(Boolean);
 if(cards.length!==selected.length)return false;

 if(!current.table.length){
  return cards.every(function(c){return c.suit===cards[0].suit})&&cards.length<=5;
 }

 if(current.leadWasMaliutka)return cards.length===hand.length;

 if(cards.length!==current.leadCount)return false;

 if(current.leadCount>1){
  var counts={};hand.forEach(function(c){counts[c.suit]=(counts[c.suit]||0)+1});
  var possible=Object.keys(counts).some(function(s){return counts[s]>=current.leadCount});
  if(possible&&!cards.every(function(c){return c.suit===cards[0].suit}))return false;
 }
 return true;
}

function updateAction(){
 var me=current.players.findIndex(function(p){return p.id===current.viewerId});
 var turn=me===current.currentTurnIndex&&!current.processing&&!current.gameOver;
 var valid=turn&&selectionValid();
 var b=el('playBtn');b.disabled=!valid;b.classList.toggle('ready',valid);

 if(selected.length===5&&myHand().length===5){
  var cs=selected.map(function(i){return myHand()[i]});
  if(cs.length===5&&cs.every(function(c){return c.suit===cs[0].suit}))b.textContent='🔥 ჩადი მალიუტკა!';
  else b.textContent='ჩადი 5 კარტი';
 }else if(selected.length)b.textContent='ჩადი '+selected.length+' კარტი';
 else b.textContent='სვლის გაკეთება';

 el('status').textContent=current.gameOver?'თამაში დასრულდა':(turn?'შენი სვლაა':'მოწინააღმდეგის სვლა...');
}

el('playBtn').onclick=function(){
 if(!selectionValid())return;
 socket.emit('playCards',{cardIndices:selected.slice()});
 selected=[];
};

function renderScore(){
 el('scorePlayers').innerHTML=current.players.map(function(p){
  return '<div class="scorePlayer"><span>'+esc(p.name)+'</span><span class="total">'+p.totalPoints+'</span></div>';
 }).join('');

 el('history').innerHTML=current.history.slice().reverse().map(function(h){
  var parts=current.players.map(function(p){
   var raw=h.rawScores&&h.rawScores[p.id]!=null?h.rawScores[p.id]:0;
   return esc(p.name)+': '+raw+'pt';
  }).join(' · ');
  return '<div class="historyItem">Round '+h.hand+' ('+symbol(h.trump)+')<br>'+parts+'</div>';
 }).join('');
}

el('rulesBtn').onclick=function(){show('rulesModal')};
el('closeRules').onclick=function(){hide('rulesModal')};
el('rulesModal').onclick=function(e){if(e.target===this)hide('rulesModal')};

el('muteBtn').onclick=function(){
 muted=!muted;this.textContent=muted?'🔇':'🔊';
};

document.querySelectorAll('[data-phrase]').forEach(function(b){
 b.onclick=function(){var text=b.dataset.phrase;socket.emit('quickMessage',{text:text});speak(text)};
});

socket.on('quickMessage',function(x){
 toast(x.text);speak(x.text);
});

document.querySelectorAll('[data-gift]').forEach(function(b){
 b.onclick=function(){
  if(giftTarget)socket.emit('throwable',{targetPlayerId:giftTarget,type:b.dataset.gift});
  hide('giftMenu');
 };
});
document.addEventListener('click',function(e){if(!e.target.closest('.avatar')&&!e.target.closest('#giftMenu'))hide('giftMenu')});

socket.on('throwableEvent',function(x){
 animateThrowable(x);
});

function seatAvatar(playerId){
 var s=document.querySelector('.seat[data-player="'+CSS.escape(playerId)+'"] .avatar');
 return s;
}

function animateThrowable(x){
 var from=seatAvatar(x.fromPlayerId),to=seatAvatar(x.targetPlayerId);
 if(!from||!to)return;
 var a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
 var icons={tomato:'🍅',egg:'🥚',paper:'🧻'};
 var p=document.createElement('div');p.className='projectile';p.textContent=icons[x.type]||'🍅';
 p.style.left=(a.left+a.width/2)+'px';p.style.top=(a.top+a.height/2)+'px';document.body.appendChild(p);
 var dx=b.left-a.left,dy=b.top-a.top;
 requestAnimationFrame(function(){
  p.style.transform='translate3d('+dx+'px,'+(dy-50)+'px,0) rotate(360deg)';
  setTimeout(function(){
   p.style.transition='transform .18s ease-in';
   p.style.transform='translate3d('+dx+'px,'+dy+'px,0) rotate(450deg)';
  },520);
 });
 setTimeout(function(){
  p.remove();
  var splat=document.createElement('div');splat.className='splat';
  splat.textContent=x.type==='tomato'?'💥🍅':(x.type==='egg'?'🍳':'🧻');
  to.parentElement.appendChild(splat);
  tone(x.type==='egg'?230:150,.12,'triangle',.05);
  setTimeout(function(){splat.remove()},3000);
 },720);
}

socket.on('playFX',function(x){
 sfx(x.cuts?'cut':'place');
 if(x.cuts){
  var table=el('table');table.style.filter='brightness(1.3)';
  setTimeout(function(){table.style.filter=''},150);
 }
});
socket.on('trickWon',function(x){sfx('cut')});
socket.on('botThinking',function(x){el('status').textContent=x.text||'🤖 ბოტი ფიქრობს...'});
socket.on('achievement',function(x){toast('🏆 '+x.title)});
socket.on('errorMessage',function(x){toast('⚠️ '+x)});
socket.on('gameWinner',function(x){
 toast('🏆 გამარჯვებულია '+x.playerName);
 if(x.playerId===current.viewerId)sfx('win');else sfx('lose');
});

function toast(text){
 var n=document.createElement('div');n.className='toast';n.textContent=text;document.body.appendChild(n);
 setTimeout(function(){n.remove()},2800);
}

/* Timer redraw */
setInterval(function(){
 if(!current)return;
 var left=Math.max(0,current.turnEndsAt-Date.now());
 var sec=Math.ceil(left/1000);
 var active=current.players[current.currentTurnIndex];
 if(active){
  var seat=document.querySelector('.seat[data-player="'+CSS.escape(active.id)+'"] .seatMeta');
  if(seat){
   var base=active.cardCount+' კარტი · '+active.totalPoints;
   seat.textContent=base+' · ⏱ '+sec;
  }
 }
},250);

/* session restore */
var saved=localStorage.getItem('buraToken');
if(saved)socket.emit('restoreSession',{token:saved});

})();
</script>
</body>
</html>`;

/* ============================================================
   ROOT ROUTE — NO public/ DIRECTORY REQUIRED
   ============================================================ */

app.get('/', function (req, res) {
  res.type('html').send(PAGE);
});

app.get('/health', function (req, res) {
  res.json({
    ok: true,
    service: 'Written Bura',
    cards: 36,
    tester: TESTER_NAME,
    rooms: rooms.size,
    users: users.size,
    uptime: Math.floor(process.uptime())
  });
});

/* Any accidental browser GET should return main app instead of Not Found */
app.get('*', function (req, res, next) {
  if (req.path.indexOf('/socket.io/') === 0) {
    return next();
  }

  res.type('html').send(PAGE);
});

/* ============================================================
   CLEANUP
   ============================================================ */

setInterval(function () {
  rooms.forEach(function (room, id) {
    const connectedHumans = room.players.filter(function (p) {
      return !p.isBot && p.connected;
    });

    if (room.game && room.game.gameOver && connectedHumans.length === 0) {
      if (room.timer) clearTimeout(room.timer);
      if (room.botTimer) clearTimeout(room.botTimer);

      room.players.forEach(function (p) {
        if (p.reconnectTimer) clearTimeout(p.reconnectTimer);
      });

      rooms.delete(id);
    }

    if (!room.game && room.players.length === 0) {
      if (room.timer) clearTimeout(room.timer);
      if (room.botTimer) clearTimeout(room.botTimer);
      rooms.delete(id);
    }
  });

  lobby();
}, 60000);

/* ============================================================
   SHUTDOWN
   ============================================================ */

async function shutdown() {
  if (saveTimer) clearTimeout(saveTimer);

  rooms.forEach(function (room) {
    if (room.timer) clearTimeout(room.timer);
    if (room.botTimer) clearTimeout(room.botTimer);

    room.players.forEach(function (p) {
      if (p.reconnectTimer) clearTimeout(p.reconnectTimer);
    });
  });

  await saveUsersNow();

  server.close(function () {
    process.exit(0);
  });

  setTimeout(function () {
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', function (e) {
  console.error('UNHANDLED:', e);
});

/* ============================================================
   BOOT
   ============================================================ */

async function boot() {
  await loadUsers();

  server.listen(PORT, '0.0.0.0', function () {
    console.log('==========================================');
    console.log(' WRITTEN BURA ONLINE');
    console.log(' PORT:', PORT);
    console.log(' ROOT: /');
    console.log(' PUBLIC DIRECTORY: NOT REQUIRED');
    console.log(' TESTER:', TESTER_NAME);
    console.log('==========================================');
  });
}

boot().catch(function (e) {
  console.error('BOOT ERROR:', e);
  process.exit(1);
});
