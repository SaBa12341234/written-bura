'use strict';

/* =========================================================
   WRITTEN BURA SERVER
   Express + Socket.IO + Auth + Persistence + Rooms + Bots
   Tournaments + Session Recovery + Daily Quests
   ========================================================= */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const { Server } = require('socket.io');

/* =========================================================
   APP
   ========================================================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: 1e6
});

const PORT = Number(process.env.PORT || 10000);

const PUBLIC_DIR = path.join(__dirname, 'public');
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* =========================================================
   IMPORTANT: RENDER / PUBLIC ROUTING
   ========================================================= */

app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Written Bura',
    status: 'online',
    rooms: rooms.size,
    users: users.size,
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString()
  });
});

/* =========================================================
   CONSTANTS
   ========================================================= */

const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;

const TURN_SECONDS = 20;
const RECONNECT_GRACE_MS = 30000;

const ALLOWED_CAPACITIES = [3, 4];
const ALLOWED_STAKES = [5, 10, 25, 50, 100];
const MAX_PARTIES = 4;

const CARD_VALUES = {
  '6': 0,
  '7': 0,
  '8': 0,
  '9': 0,
  'J': 2,
  'Q': 3,
  'K': 4,
  '10': 10,
  'A': 11
};

const RANKS = [
  '6', '7', '8', '9',
  'J', 'Q', 'K', '10', 'A'
];

const SUITS = [
  'spades',
  'clubs',
  'diamonds',
  'hearts'
];

const TRUMPS = [
  'spades',
  'clubs',
  'diamonds',
  'hearts',
  'no_trump'
];

const CARD_SKINS = [
  'royal',
  'classic',
  'midnight'
];

const TABLE_SKINS = [
  'emerald',
  'midnight',
  'royal'
];

const QUICK_MESSAGES = new Set([
  '⚡ სწრაფად!',
  '⏳ მალდე!',
  '👍 კარგი იყო',
  '🃏 ვაჰ, კოზირი!',
  'სიქიიიიიმ!',
  'ყვერო, მალე!',
  'რას შვრები, ძმაო?!',
  'ვაჰ, კოზირი!'
]);

const THROWABLES = new Set([
  'tomato',
  'egg',
  'paper'
]);

/* =========================================================
   MEMORY
   ========================================================= */

const rooms = new Map();
const users = new Map();
const sessions = new Map();

let saveTimer = null;

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function id(prefix = 'id') {
  return (
    prefix +
    '_' +
    Date.now().toString(36) +
    '_' +
    crypto.randomBytes(5).toString('hex')
  );
}

function cleanName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function normalizeUsername(value) {
  return cleanName(value).toLowerCase();
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return Math.min(max, Math.max(min, n));
}

function randomInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isTesterName(name) {
  return normalizeUsername(name) === TESTER_NAME;
}

/* =========================================================
   ASYNC PASSWORD HASHING
   ========================================================= */

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password, salt) {
  const derived = await scryptAsync(
    String(password),
    salt,
    64
  );

  return Buffer.from(derived).toString('hex');
}

async function createPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');

  return {
    salt,
    hash: await hashPassword(password, salt)
  };
}

async function verifyPassword(password, user) {
  try {
    const calculated = await hashPassword(
      password,
      user.passwordSalt
    );

    const a = Buffer.from(calculated, 'hex');
    const b = Buffer.from(user.passwordHash, 'hex');

    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* =========================================================
   USERS.JSON PERSISTENCE
   Async + Debounced
   ========================================================= */

async function loadUsers() {
  try {
    const text = await fs.promises.readFile(
      USERS_FILE,
      'utf8'
    );

    const parsed = JSON.parse(text);

    const list = Array.isArray(parsed)
      ? parsed
      : parsed.users || [];

    for (const user of list) {
      if (!user || !user.id || !user.username) continue;

      ensureUserDefaults(user);

      users.set(user.id, user);
    }

    console.log(
      '[USERS] Loaded:',
      users.size
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(
        '[USERS] load error:',
        error
      );
    }

    await saveUsersNow();
  }
}

function serializableUsers() {
  return Array.from(users.values()).map(user => {
    const copy = { ...user };

    delete copy.socketId;
    delete copy.roomId;
    delete copy.disconnectTimer;

    return copy;
  });
}

async function saveUsersNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const data = JSON.stringify(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      users: serializableUsers()
    },
    null,
    2
  );

  try {
    await fs.promises.writeFile(
      USERS_FILE,
      data,
      'utf8'
    );
  } catch (error) {
    console.error(
      '[USERS] save error:',
      error
    );
  }
}

function scheduleUsersSave() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveUsersNow().catch(console.error);
  }, 4000);
}

/* =========================================================
   USER PROFILE
   ========================================================= */

function defaultQuests() {
  return {
    date: todayKey(),
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

function ensureUserDefaults(user) {
  user.avatar = user.avatar || '🦊';

  user.xp = Number(user.xp || 0);
  user.level = Number(user.level || 1);
  user.wins = Number(user.wins || 0);

  user.balance = Number(
    user.balance === undefined
      ? START_BALANCE
      : user.balance
  );

  user.cardSkin = CARD_SKINS.includes(user.cardSkin)
    ? user.cardSkin
    : 'royal';

  user.tableSkin = TABLE_SKINS.includes(user.tableSkin)
    ? user.tableSkin
    : 'emerald';

  user.achievements = Array.isArray(user.achievements)
    ? user.achievements
    : [];

  if (
    !user.quests ||
    user.quests.date !== todayKey()
  ) {
    user.quests = defaultQuests();
  }

  recalcLevel(user);
}

function recalcLevel(user) {
  user.level =
    Math.floor(Number(user.xp || 0) / 100) + 1;
}

function publicProfile(user) {
  ensureUserDefaults(user);

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,

    xp: user.xp,
    level: user.level,
    wins: user.wins,
    balance: user.balance,

    cardSkin: user.cardSkin,
    tableSkin: user.tableSkin,

    achievements: user.achievements,
    quests: user.quests
  };
}

function findUserByUsername(username) {
  const normalized = normalizeUsername(username);

  return Array.from(users.values()).find(
    user =>
      normalizeUsername(user.username) === normalized
  ) || null;
}

function addXP(user, amount) {
  if (!user) return;

  user.xp += Math.max(0, Number(amount || 0));

  recalcLevel(user);

  scheduleUsersSave();

  emitProfile(user);
}

function emitProfile(user) {
  if (!user || !user.socketId) return;

  io.to(user.socketId).emit(
    'profileUpdate',
    publicProfile(user)
  );
}

/* =========================================================
   DAILY QUESTS
   ========================================================= */

function refreshQuests(user) {
  if (!user) return;

  if (
    !user.quests ||
    user.quests.date !== todayKey()
  ) {
    user.quests = defaultQuests();
    scheduleUsersSave();
  }
}

function checkQuestRewards(user) {
  if (!user) return;

  refreshQuests(user);

  const q = user.quests;

  let gained = 0;

  if (
    q.wins >= 3 &&
    !q.rewards.wins
  ) {
    q.rewards.wins = true;
    gained += 100;
  }

  if (
    q.maliutka >= 1 &&
    !q.rewards.maliutka
  ) {
    q.rewards.maliutka = true;
    gained += 250;
  }

  if (
    q.tables >= 5 &&
    !q.rewards.tables
  ) {
    q.rewards.tables = true;
    gained += 50;
  }

  if (gained) {
    user.xp += gained;
    recalcLevel(user);
  }

  scheduleUsersSave();
  emitProfile(user);
}

function questTablePlayed(user, roomId) {
  if (!user) return;

  refreshQuests(user);

  if (!user.quests.tableIds.includes(roomId)) {
    user.quests.tableIds.push(roomId);
    user.quests.tables += 1;

    checkQuestRewards(user);
  }
}

function questMaliutka(user) {
  if (!user) return;

  refreshQuests(user);

  user.quests.maliutka += 1;

  checkQuestRewards(user);
}

function questPartyWin(user) {
  if (!user) return;

  refreshQuests(user);

  user.quests.wins += 1;

  checkQuestRewards(user);
}

/* =========================================================
   SESSION
   ========================================================= */

function createSession(user) {
  const token = crypto
    .randomBytes(32)
    .toString('hex');

  sessions.set(token, {
    userId: user.id,
    createdAt: Date.now()
  });

  return token;
}

function userFromToken(token) {
  const session = sessions.get(
    String(token || '')
  );

  if (!session) return null;

  return users.get(session.userId) || null;
}

/* =========================================================
   AVATAR VALIDATION
   ========================================================= */

function validAvatar(value) {
  const avatar = String(value || '');

  if (!avatar) return '🦊';

  if (avatar.length <= 16) {
    return avatar;
  }

  if (
    /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(
      avatar
    ) &&
    avatar.length <= 700000
  ) {
    return avatar;
  }

  return '🦊';
}

/* =========================================================
   CARDS
   ========================================================= */

function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: id('card'),
        rank,
        suit
      });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i);

    [deck[i], deck[j]] = [
      deck[j],
      deck[i]
    ];
  }

  return deck;
}

function rankIndex(card) {
  return RANKS.indexOf(card.rank);
}

function cardPoints(card) {
  return CARD_VALUES[card.rank] || 0;
}

function isTrump(card, trump) {
  return (
    trump !== 'no_trump' &&
    card.suit === trump
  );
}

function sameSuit(cards) {
  return (
    cards.length > 0 &&
    cards.every(
      card => card.suit === cards[0].suit
    )
  );
}

function isMaliutka(cards) {
  return (
    cards.length === 5 &&
    sameSuit(cards)
  );
}

/* =========================================================
   CARD CUTTING
   ========================================================= */

function cardBeats(base, challenger, trump) {
  const baseTrump = isTrump(base, trump);
  const challengerTrump = isTrump(
    challenger,
    trump
  );

  if (challengerTrump && !baseTrump) {
    return true;
  }

  if (baseTrump && !challengerTrump) {
    return false;
  }

  if (base.suit !== challenger.suit) {
    return false;
  }

  return (
    rankIndex(challenger) >
    rankIndex(base)
  );
}

/*
   IMPORTANT MULTI-CARD FIX

   Instead of sorting two groups and blindly
   comparing indexes, find a valid one-to-one
   matching.

   Maximum 5 cards => at most 120 combinations.
*/

function playBeats(baseCards, challengeCards, trump) {
  if (
    !Array.isArray(baseCards) ||
    !Array.isArray(challengeCards) ||
    baseCards.length !== challengeCards.length
  ) {
    return false;
  }

  const base = baseCards
    .slice()
    .sort((a, b) => rankIndex(b) - rankIndex(a));

  const used = new Array(
    challengeCards.length
  ).fill(false);

  function search(baseIndex) {
    if (baseIndex >= base.length) {
      return true;
    }

    for (
      let challengerIndex = 0;
      challengerIndex < challengeCards.length;
      challengerIndex++
    ) {
      if (used[challengerIndex]) continue;

      const challenger =
        challengeCards[challengerIndex];

      if (
        cardBeats(
          base[baseIndex],
          challenger,
          trump
        )
      ) {
        used[challengerIndex] = true;

        if (search(baseIndex + 1)) {
          return true;
        }

        used[challengerIndex] = false;
      }
    }

    return false;
  }

  return search(0);
}

function winningPlayIndex(table, trump) {
  if (!table.length) return -1;

  let winner = 0;

  for (let i = 1; i < table.length; i++) {
    if (
      playBeats(
        table[winner].cards,
        table[i].cards,
        trump
      )
    ) {
      winner = i;
    }
  }

  return winner;
}

/* =========================================================
   ROOM
   ========================================================= */

function createRoom({
  name,
  capacity,
  parties,
  stake,
  tournament = null
}) {
  const room = {
    id: id('room'),

    name:
      cleanName(name) ||
      'Bura Table',

    capacity,
    parties,
    stake,

    tournament,

    players: [],
    game: null,

    timer: null,
    botTimer: null,

    createdAt: Date.now()
  };

  rooms.set(room.id, room);

  broadcastLobby();

  return room;
}

function destroyRoom(roomId) {
  const room = rooms.get(roomId);

  if (!room) return;

  if (room.timer) {
    clearTimeout(room.timer);
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
  }

  room.timer = null;
  room.botTimer = null;

  rooms.delete(roomId);

  broadcastLobby();
}

function roomOpen(room) {
  return (
    !room.game &&
    room.players.length < room.capacity &&
    !room.tournament
  );
}

/* =========================================================
   PLAYER
   ========================================================= */

function playerFrame(player) {
  const wins = Number(player.wins || 0);

  if (wins >= 10) return 'diamond';
  if (wins >= 3) return 'gold';

  return 'bronze';
}

function createHumanPlayer(user, socket) {
  return {
    id: user.id,
    userId: user.id,
    userKey: user.id,

    socketId: socket.id,

    name: user.username,
    avatar: user.avatar,

    isBot: false,
    connected: true,

    hand: [],
    captured: [],

    totalPoints: 0,
    lastRawPoints: 0,

    xp: user.xp,
    level: user.level,
    wins: user.wins,

    cardSkin: user.cardSkin,

    disconnectTimer: null
  };
}

function createGuestPlayer(name, socket) {
  const playerId = id('guest');

  return {
    id: playerId,
    userId: null,
    userKey: playerId,

    socketId: socket.id,

    name:
      cleanName(name) ||
      'Guest',

    avatar: '😎',

    isBot: false,
    connected: true,

    hand: [],
    captured: [],

    totalPoints: 0,
    lastRawPoints: 0,

    xp: 0,
    level: 1,
    wins: 0,

    cardSkin: 'royal',

    disconnectTimer: null
  };
}

function createBot(number) {
  return {
    id: id('bot'),
    userId: null,
    userKey: null,

    socketId: null,

    name: 'BOT ' + number,
    avatar: ['🤖', '🦾', '👾'][number % 3],

    isBot: true,
    connected: true,

    hand: [],
    captured: [],

    totalPoints: 0,
    lastRawPoints: 0,

    xp: 0,
    level: randomInt(2, 8),
    wins: 0,

    cardSkin: 'royal'
  };
}

function userForPlayer(player) {
  if (!player || !player.userId) {
    return null;
  }

  return users.get(player.userId) || null;
}

/* =========================================================
   START HAND
   ========================================================= */

function startHand(room, previous = null) {
  const deck = createDeck();

  const handIndex = previous
    ? previous.handIndex + 1
    : 1;

  const totalHands =
    room.parties * 5;

  const partyIndex =
    Math.ceil(handIndex / 5);

  const trump =
    TRUMPS[
      (handIndex - 1) % TRUMPS.length
    ];

  for (const player of room.players) {
    player.hand = [];
    player.captured = [];
    player.lastRawPoints = 0;
  }

  for (let round = 0; round < 5; round++) {
    for (const player of room.players) {
      if (!deck.length) break;

      player.hand.push(deck.pop());
    }
  }

  let leaderIndex = 0;

  if (
    previous &&
    Number.isInteger(previous.nextLeaderIndex)
  ) {
    leaderIndex =
      previous.nextLeaderIndex %
      room.players.length;
  }

  const game = {
    handIndex,
    totalHands,
    partyIndex,

    trump,
    deck,

    table: [],

    currentTurnIndex: leaderIndex,

    leadCount: 0,
    leadWasMaliutka: false,
    leadPlayerId: null,

    processing: false,
    gameOver: false,

    turnEndsAt: 0,

    lastHandScores:
      previous
        ? previous.lastHandScores || {}
        : {},

    history:
      previous
        ? previous.history || []
        : [],

    nextLeaderIndex: leaderIndex,

    lastTrickOrder: [],

    partyStartTotals:
      previous &&
      previous.partyIndex === partyIndex
        ? previous.partyStartTotals
        : Object.fromEntries(
            room.players.map(player => [
              player.id,
              player.totalPoints
            ])
          )
  };

  room.game = game;

  return game;
}

/* =========================================================
   STATE
   ========================================================= */

function getClientState(
  room,
  viewerPlayerId,
  revealAll = false
) {
  const game = room.game;

  if (!game) return null;

  const winnerIndex =
    winningPlayIndex(
      game.table,
      game.trump
    );

  const playersCards = {};

  for (const player of room.players) {
    if (
      revealAll ||
      player.id === viewerPlayerId
    ) {
      playersCards[player.id] =
        player.hand;
    }
  }

  return {
    roomId: room.id,
    roomName: room.name,

    capacity: room.capacity,
    parties: room.parties,
    stake: room.stake,

    viewingPlayerId: viewerPlayerId,
    revealAll,

    partyIndex: game.partyIndex,
    handIndex: game.handIndex,
    totalHands: game.totalHands,

    trump: game.trump,
    deckCount: game.deck.length,

    currentTurnIndex:
      game.currentTurnIndex,

    leadCount:
      game.leadCount,

    leadWasMaliutka:
      game.leadWasMaliutka,

    processing:
      game.processing,

    gameOver:
      game.gameOver,

    turnEndsAt:
      game.turnEndsAt,

    turnSeconds:
      TURN_SECONDS,

    lastHandScores:
      game.lastHandScores,

    history:
      game.history,

    players: room.players.map(
      (player, index) => ({
        id: player.id,

        name: player.name,
        avatar: player.avatar,

        isBot: player.isBot,
        connected: player.connected !== false,

        isCurrent:
          index === game.currentTurnIndex,

        cardCount:
          player.hand.length,

        handPoints:
          player.captured.reduce(
            (sum, card) =>
              sum + cardPoints(card),
            0
          ),

        totalPoints:
          player.totalPoints,

        xp: player.xp,
        level: player.level,
        wins: player.wins,

        frame:
          playerFrame(player),

        cardSkin:
          player.cardSkin || 'royal'
      })
    ),

    playersCards,

    table: game.table.map(
      (play, index) => ({
        playerId:
          play.playerId,

        playerName:
          play.playerName,

        cards:
          play.cards,

        cuts:
          Boolean(play.cuts),

        isWinning:
          index === winnerIndex
      })
    )
  };
}

function broadcastRoom(room) {
  if (!room || !room.game) return;

  for (const player of room.players) {
    if (
      player.isBot ||
      !player.socketId ||
      player.connected === false
    ) {
      continue;
    }

    const reveal =
      isTesterName(player.name);

    io.to(player.socketId).emit(
      'gameStateUpdate',
      getClientState(
        room,
        player.id,
        reveal
      )
    );
  }
}

/* =========================================================
   TURN TIMER
   ========================================================= */

function setTurn(room, index) {
  if (
    !room ||
    !room.game ||
    room.game.gameOver
  ) {
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
  }

  room.game.currentTurnIndex =
    index % room.players.length;

  room.game.turnEndsAt =
    Date.now() +
    TURN_SECONDS * 1000;

  room.timer = setTimeout(() => {
    room.timer = null;
    autoPlayCurrent(room);
  }, TURN_SECONDS * 1000);

  broadcastRoom(room);

  scheduleBot(room);
}

/* =========================================================
   VALIDATION
   ========================================================= */

function handHasSameSuitCount(hand, count) {
  const groups = new Map();

  for (const card of hand) {
    if (!groups.has(card.suit)) {
      groups.set(card.suit, []);
    }

    groups.get(card.suit).push(card);
  }

  return Array.from(
    groups.values()
  ).some(group => group.length >= count);
}

function validateSelection(
  game,
  hand,
  indexes
) {
  if (
    !Array.isArray(indexes) ||
    !indexes.length
  ) {
    return {
      ok: false,
      message: 'აირჩიე კარტი.'
    };
  }

  if (indexes.length > 5) {
    return {
      ok: false,
      message:
        'ერთ სვლაზე მაქსიმუმ 5 კარტია.'
    };
  }

  const unique = [
    ...new Set(
      indexes.map(Number)
    )
  ];

  if (unique.length !== indexes.length) {
    return {
      ok: false,
      message: 'არასწორი არჩევანი.'
    };
  }

  const cards =
    unique.map(index => hand[index]);

  if (cards.some(card => !card)) {
    return {
      ok: false,
      message: 'კარტი ვერ მოიძებნა.'
    };
  }

  /*
     FIRST PLAY
     1-5 cards.
     Multi-card lead must be same suit.
  */

  if (!game.table.length) {
    if (!sameSuit(cards)) {
      return {
        ok: false,
        message:
          'ერთად ჩასული კარტები ერთი მასტის უნდა იყოს.'
      };
    }

    if (
      cards.length === 5 &&
      !isMaliutka(cards)
    ) {
      return {
        ok: false,
        message:
          '5 კარტით სვლა მხოლოდ მალიუტკაა.'
      };
    }

    return {
      ok: true,
      cards,
      indexes: unique
    };
  }

  /*
     MALIUTKA RESPONSE:
     play entire remaining hand.
  */

  if (game.leadWasMaliutka) {
    if (cards.length !== hand.length) {
      return {
        ok: false,
        message:
          'მალიუტკაზე მთელი დარჩენილი ხელი უნდა ჩამოხვიდე.'
      };
    }

    return {
      ok: true,
      cards,
      indexes: unique
    };
  }

  /*
     CRITICAL MULTI-CARD FIX

     Table has N cards => response must contain
     exactly N cards.

     N = 1,2,3,4,5 supported.
  */

  const required =
    Number(game.leadCount || 1);

  if (cards.length !== required) {
    return {
      ok: false,
      message:
        'უნდა აირჩიო ზუსტად ' +
        required +
        ' კარტი.'
    };
  }

  /*
     If the hand contains a same-suit group of N,
     multi-card response must use one suit.

     If no such combination exists at all,
     allow N discards so the game cannot deadlock.
  */

  if (
    required > 1 &&
    handHasSameSuitCount(
      hand,
      required
    ) &&
    !sameSuit(cards)
  ) {
    return {
      ok: false,
      message:
        'აირჩიე ერთი მასტის ' +
        required +
        ' კარტი.'
    };
  }

  return {
    ok: true,
    cards,
    indexes: unique
  };
}

/* =========================================================
   PLAY
   ========================================================= */

function applyPlay(
  room,
  player,
  indexes
) {
  const game = room.game;

  if (
    !game ||
    game.processing ||
    game.gameOver
  ) {
    return false;
  }

  const validation =
    validateSelection(
      game,
      player.hand,
      indexes
    );

  if (!validation.ok) {
    if (player.socketId) {
      io.to(player.socketId).emit(
        'errorMessage',
        validation.message
      );
    }

    return false;
  }

  const cards =
    validation.cards.slice();

  const previousWinnerIndex =
    winningPlayIndex(
      game.table,
      game.trump
    );

  const previousWinner =
    previousWinnerIndex >= 0
      ? game.table[previousWinnerIndex]
      : null;

  let cuts = false;

  if (previousWinner) {
    cuts = playBeats(
      previousWinner.cards,
      cards,
      game.trump
    );
  }

  /*
     Remove descending indexes so indexes
     do not shift while splicing.
  */

  const descending =
    validation.indexes
      .slice()
      .sort((a, b) => b - a);

  for (const index of descending) {
    player.hand.splice(index, 1);
  }

  if (!game.table.length) {
    game.leadCount =
      cards.length;

    game.leadWasMaliutka =
      isMaliutka(cards);

    game.leadPlayerId =
      player.id;

    if (game.leadWasMaliutka) {
      const user =
        userForPlayer(player);

      if (user) {
        questMaliutka(user);
        awardAchievement(
          room,
          player,
          'მალიუტკის ოსტატი'
        );
      }
    }
  }

  game.table.push({
    playerId: player.id,
    playerName: player.name,
    cards,
    cuts
  });

  io.to(room.id).emit(
    'cardPlayed',
    {
      playerId: player.id,
      cards,
      cuts
    }
  );

  io.to(room.id).emit(
    'sfxEvent',
    {
      type: cuts
        ? 'cut'
        : 'place'
    }
  );

  if (
    game.table.length >=
    room.players.length
  ) {
    completeTrick(room);
    return true;
  }

  const currentIndex =
    room.players.findIndex(
      p => p.id === player.id
    );

  const nextIndex =
    (currentIndex + 1) %
    room.players.length;

  setTurn(room, nextIndex);

  return true;
}

/* =========================================================
   REFILL
   ========================================================= */

function refillCards(
  room,
  winnerIndex
) {
  const game = room.game;

  if (!game) return;

  for (
    let offset = 0;
    offset < room.players.length;
    offset++
  ) {
    const index =
      (winnerIndex + offset) %
      room.players.length;

    const player =
      room.players[index];

    while (
      player.hand.length < 5 &&
      game.deck.length
    ) {
      player.hand.push(
        game.deck.pop()
      );
    }
  }
}

/* =========================================================
   TRICK
   ========================================================= */

function completeTrick(room) {
  const game = room.game;

  if (
    !game ||
    game.processing ||
    !game.table.length
  ) {
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  game.processing = true;

  const tableWinnerIndex =
    winningPlayIndex(
      game.table,
      game.trump
    );

  const winningPlay =
    game.table[tableWinnerIndex];

  const winnerIndex =
    room.players.findIndex(
      player =>
        player.id ===
        winningPlay.playerId
    );

  const winner =
    room.players[winnerIndex];

  const captured =
    game.table.flatMap(
      play => play.cards
    );

  winner.captured.push(
    ...captured
  );

  game.lastTrickOrder =
    game.table.map(
      play => play.playerId
    );

  io.to(room.id).emit(
    'trickWon',
    {
      winnerId: winner.id
    }
  );

  io.to(room.id).emit(
    'sfxEvent',
    {
      type: 'take'
    }
  );

  setTimeout(() => {
    if (
      !rooms.has(room.id) ||
      room.game !== game
    ) {
      return;
    }

    game.table = [];

    game.leadCount = 0;
    game.leadWasMaliutka = false;
    game.leadPlayerId = null;

    refillCards(
      room,
      winnerIndex
    );

    const noCards =
      room.players.every(
        player =>
          player.hand.length === 0
      );

    if (
      noCards &&
      game.deck.length === 0
    ) {
      finishHand(room);
      return;
    }

    game.processing = false;

    setTurn(
      room,
      winnerIndex
    );

    io.to(room.id).emit(
      'dealAnimation'
    );
  }, 850);
}

/* =========================================================
   NEXT HAND LEADER
   ========================================================= */

function nextHandLeader(
  room,
  game,
  rawScores
) {
  const zeroIds =
    room.players
      .filter(
        player =>
          rawScores[player.id] === 0
      )
      .map(player => player.id);

  /*
     გახიშტვა:
     multiple zero players -> after last zero
     player in final trick order.
  */

  if (
    zeroIds.length >= 2 &&
    game.lastTrickOrder.length
  ) {
    let lastZeroId = null;

    for (
      const playerId of
      game.lastTrickOrder
    ) {
      if (
        zeroIds.includes(playerId)
      ) {
        lastZeroId = playerId;
      }
    }

    if (lastZeroId) {
      const index =
        room.players.findIndex(
          player =>
            player.id === lastZeroId
        );

      return (
        (index + 1) %
        room.players.length
      );
    }
  }

  let minimum = Infinity;
  let minimumIndex = 0;

  room.players.forEach(
    (player, index) => {
      const raw =
        rawScores[player.id];

      if (raw < minimum) {
        minimum = raw;
        minimumIndex = index;
      }
    }
  );

  return (
    (minimumIndex + 1) %
    room.players.length
  );
}

/* =========================================================
   PARTY REWARDS
   ========================================================= */

function finishPartyIfNeeded(
  room,
  game
) {
  if (game.handIndex % 5 !== 0) {
    return;
  }

  const start =
    game.partyStartTotals || {};

  let highest = -Infinity;
  let winners = [];

  for (const player of room.players) {
    const gained =
      player.totalPoints -
      Number(start[player.id] || 0);

    if (gained > highest) {
      highest = gained;
      winners = [player];
    } else if (gained === highest) {
      winners.push(player);
    }
  }

  /*
     XP for every played party.
  */

  for (const player of room.players) {
    const user =
      userForPlayer(player);

    if (user) {
      addXP(user, 20);
    }
  }

  /*
     Winning party XP.
  */

  for (const winner of winners) {
    const user =
      userForPlayer(winner);

    if (!user) continue;

    user.wins += 1;

    addXP(user, 80);

    questPartyWin(user);

    winner.wins = user.wins;
    winner.xp = user.xp;
    winner.level = user.level;
  }

  scheduleUsersSave();
}

/* =========================================================
   FINISH HAND
   ========================================================= */

async function finishHand(room) {
  const game = room.game;

  if (!game) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  const rawScores = {};
  const scores = {};

  for (const player of room.players) {
    const raw =
      player.captured.reduce(
        (sum, card) =>
          sum + cardPoints(card),
        0
      );

    rawScores[player.id] = raw;

    /*
       Written Bura prototype scoring:
       0 captured points = -120.
    */

    const score =
      raw === 0
        ? -120
        : raw;

    scores[player.id] = score;

    player.lastRawPoints = raw;
    player.totalPoints += score;
  }

  game.lastHandScores =
    { ...scores };

  game.history.push({
    hand: game.handIndex,
    party: game.partyIndex,
    trump: game.trump,

    rawScores:
      { ...rawScores },

    scores:
      { ...scores }
  });

  finishPartyIfNeeded(
    room,
    game
  );

  await saveUsersNow();

  const finalHand =
    game.handIndex >=
    game.totalHands;

  if (finalHand) {
    finishGame(room);
    return;
  }

  game.nextLeaderIndex =
    nextHandLeader(
      room,
      game,
      rawScores
    );

  const previousHistory =
    game.history;

  const previousScores =
    game.lastHandScores;

  startHand(room, game);

  room.game.history =
    previousHistory;

  room.game.lastHandScores =
    previousScores;

  setTurn(
    room,
    room.game.currentTurnIndex
  );

  broadcastRoom(room);

  io.to(room.id).emit(
    'dealAnimation'
  );

  io.to(room.id).emit(
    'sfxEvent',
    {
      type: 'deal'
    }
  );
}

/* =========================================================
   FINISH GAME
   ========================================================= */

function finishGame(room) {
  const game = room.game;

  if (!game) return;

  game.gameOver = true;
  game.processing = false;

  let winner =
    room.players[0];

  for (const player of room.players) {
    if (
      player.totalPoints >
      winner.totalPoints
    ) {
      winner = player;
    }
  }

  const winnerUser =
    userForPlayer(winner);

  if (winnerUser) {
    addXP(winnerUser, 100);
  }

  io.to(room.id).emit(
    'gameWinner',
    {
      playerId: winner.id,
      playerName: winner.name
    }
  );

  io.to(room.id).emit(
    'sfxEvent',
    {
      type: 'win',
      winnerId: winner.id
    }
  );

  broadcastRoom(room);

  if (room.tournament) {
    tournamentMatchFinished(
      room,
      winner
    );
  }
}

/* =========================================================
   ACHIEVEMENTS
   ========================================================= */

function awardAchievement(
  room,
  player,
  title
) {
  const user =
    userForPlayer(player);

  if (!user) return;

  if (
    user.achievements.includes(title)
  ) {
    return;
  }

  user.achievements.push(title);

  addXP(user, 40);

  io.to(room.id).emit(
    'achievement',
    {
      playerId: player.id,
      playerName: player.name,
      title
    }
  );
}

/* =========================================================
   BOT AI
   ========================================================= */

function lowCardScore(card, trump) {
  let score =
    cardPoints(card) * 100 +
    rankIndex(card);

  if (isTrump(card, trump)) {
    score += 10000;
  }

  return score;
}

function sameSuitIndexGroups(hand) {
  const groups = {};

  hand.forEach((card, index) => {
    if (!groups[card.suit]) {
      groups[card.suit] = [];
    }

    groups[card.suit].push(index);
  });

  return Object.values(groups);
}

/*
   Find the cheapest valid cutting combination.
   Hand size <= 5, so brute-force combinations
   are tiny and reliable.
*/

function combinations(
  array,
  count,
  start = 0,
  prefix = [],
  output = []
) {
  if (prefix.length === count) {
    output.push(prefix.slice());
    return output;
  }

  for (
    let i = start;
    i < array.length;
    i++
  ) {
    prefix.push(array[i]);

    combinations(
      array,
      count,
      i + 1,
      prefix,
      output
    );

    prefix.pop();
  }

  return output;
}

function cheapestCut(
  hand,
  count,
  targetCards,
  trump
) {
  const indexes =
    hand.map((_, index) => index);

  const choices =
    combinations(indexes, count);

  let best = null;
  let bestCost = Infinity;

  for (const choice of choices) {
    const cards =
      choice.map(index => hand[index]);

    if (
      count > 1 &&
      handHasSameSuitCount(
        hand,
        count
      ) &&
      !sameSuit(cards)
    ) {
      continue;
    }

    if (
      !playBeats(
        targetCards,
        cards,
        trump
      )
    ) {
      continue;
    }

    const cost =
      cards.reduce(
        (sum, card) =>
          sum +
          lowCardScore(card, trump),
        0
      );

    if (cost < bestCost) {
      bestCost = cost;
      best = choice;
    }
  }

  return best;
}

function lowestDiscard(
  hand,
  count,
  trump
) {
  const indexes =
    hand.map((_, index) => index);

  const choices =
    combinations(indexes, count);

  let best = null;
  let bestCost = Infinity;

  const sameSuitAvailable =
    count > 1 &&
    handHasSameSuitCount(
      hand,
      count
    );

  for (const choice of choices) {
    const cards =
      choice.map(index => hand[index]);

    if (
      sameSuitAvailable &&
      !sameSuit(cards)
    ) {
      continue;
    }

    const cost =
      cards.reduce(
        (sum, card) =>
          sum +
          lowCardScore(card, trump),
        0
      );

    if (cost < bestCost) {
      bestCost = cost;
      best = choice;
    }
  }

  return (
    best ||
    indexes.slice(0, count)
  );
}

function currentWinningCards(game) {
  if (!game.table.length) {
    return [];
  }

  const winnerIndex =
    winningPlayIndex(
      game.table,
      game.trump
    );

  return game.table[
    winnerIndex
  ].cards;
}

function botLead(bot, game) {
  /*
     Maliutka first.
  */

  const five =
    sameSuitIndexGroups(bot.hand)
      .find(group => group.length === 5);

  if (five) {
    return five.slice();
  }

  /*
     Occasionally use a multi-card combination,
     but preserve high trump groups.
  */

  const groups =
    sameSuitIndexGroups(bot.hand)
      .filter(group => group.length >= 2)
      .sort(
        (a, b) =>
          b.length - a.length
      );

  if (
    groups.length &&
    Math.random() < 0.35
  ) {
    const group =
      groups[0];

    const count =
      Math.min(4, group.length);

    return group
      .slice()
      .sort((a, b) => {
        return (
          lowCardScore(
            bot.hand[a],
            game.trump
          ) -
          lowCardScore(
            bot.hand[b],
            game.trump
          )
        );
      })
      .slice(0, count);
  }

  /*
     Lowest ordinary card.
  */

  const indexes =
    bot.hand.map((_, index) => index);

  indexes.sort((a, b) => {
    return (
      lowCardScore(
        bot.hand[a],
        game.trump
      ) -
      lowCardScore(
        bot.hand[b],
        game.trump
      )
    );
  });

  return [indexes[0]];
}

function botChoice(
  room,
  bot
) {
  const game = room.game;

  if (!game.table.length) {
    return botLead(bot, game);
  }

  if (game.leadWasMaliutka) {
    return bot.hand.map(
      (_, index) => index
    );
  }

  const count =
    game.leadCount || 1;

  const target =
    currentWinningCards(game);

  /*
     1. Cut with cheapest possible cards.
  */

  const cut =
    cheapestCut(
      bot.hand,
      count,
      target,
      game.trump
    );

  if (cut) return cut;

  /*
     2. Can't cut -> throw lowest value cards.
  */

  return lowestDiscard(
    bot.hand,
    count,
    game.trump
  );
}

function scheduleBot(room) {
  if (
    !room ||
    !room.game ||
    room.game.gameOver ||
    room.game.processing
  ) {
    return;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
  }

  const player =
    room.players[
      room.game.currentTurnIndex
    ];

  if (!player || !player.isBot) {
    return;
  }

  io.to(room.id).emit(
    'botThinking',
    {
      playerId: player.id
    }
  );

  const delay =
    randomInt(1200, 1800);

  room.botTimer =
    setTimeout(() => {
      room.botTimer = null;

      if (
        !room.game ||
        room.game.gameOver ||
        room.game.processing
      ) {
        return;
      }

      const active =
        room.players[
          room.game.currentTurnIndex
        ];

      if (
        !active ||
        active.id !== player.id
      ) {
        return;
      }

      const choice =
        botChoice(
          room,
          player
        );

      applyPlay(
        room,
        player,
        choice
      );
    }, delay);
}

/* =========================================================
   TIMEOUT AUTO PLAY
   ========================================================= */

function autoPlayCurrent(room) {
  if (
    !room ||
    !room.game ||
    room.game.processing ||
    room.game.gameOver
  ) {
    return;
  }

  const player =
    room.players[
      room.game.currentTurnIndex
    ];

  if (!player) return;

  let choice;

  if (player.isBot) {
    choice =
      botChoice(room, player);
  } else if (
    room.game.leadWasMaliutka &&
    room.game.table.length
  ) {
    choice =
      player.hand.map(
        (_, index) => index
      );
  } else if (
    room.game.table.length
  ) {
    const count =
      room.game.leadCount || 1;

    const target =
      currentWinningCards(
        room.game
      );

    choice =
      cheapestCut(
        player.hand,
        count,
        target,
        room.game.trump
      );

    if (!choice) {
      choice =
        lowestDiscard(
          player.hand,
          count,
          room.game.trump
        );
    }
  } else {
    choice =
      lowestDiscard(
        player.hand,
        1,
        room.game.trump
      );
  }

  applyPlay(
    room,
    player,
    choice
  );
}

/* =========================================================
   LOBBY
   ========================================================= */

function lobbyTables() {
  return Array.from(
    rooms.values()
  )
    .filter(roomOpen)
    .map(room => ({
      id: room.id,
      name: room.name,
      stake: room.stake,
      players: room.players.length,
      capacity: room.capacity,
      parties: room.parties
    }));
}

function broadcastLobby() {
  io.emit(
    'lobbyTables',
    lobbyTables()
  );

  broadcastTournaments();
}

/* =========================================================
   START ROOM
   ========================================================= */

function startRoom(room) {
  if (
    !room ||
    room.game ||
    room.players.length <
      room.capacity
  ) {
    return;
  }

  startHand(room);

  /*
     Socket.IO room membership
  */

  for (const player of room.players) {
    if (player.socketId) {
      const socket =
        io.sockets.sockets.get(
          player.socketId
        );

      if (socket) {
        socket.join(room.id);
      }
    }
  }

  setTurn(room, 0);

  broadcastRoom(room);

  io.to(room.id).emit(
    'dealAnimation'
  );

  io.to(room.id).emit(
    'sfxEvent',
    {
      type: 'deal'
    }
  );

  broadcastLobby();
}

/* =========================================================
   TESTER BOTS
   ========================================================= */

function fillWithBots(room) {
  let number = 1;

  while (
    room.players.length <
    room.capacity
  ) {
    room.players.push(
      createBot(number++)
    );
  }
}

/* =========================================================
   TOURNAMENTS
   ========================================================= */

const tournaments = new Map();

function createDefaultTournament() {
  const tournament = {
    id: id('tournament'),

    name: 'Written Bura Cup',
    prize: '$1,000',

    startAt:
      Date.now() +
      10 * 60 * 1000,

    maxPlayers: 16,

    registeredUserIds: [],

    status: 'registration',

    round: 0,

    matches: [],

    championUserId: null
  };

  tournaments.set(
    tournament.id,
    tournament
  );

  scheduleTournamentStart(
    tournament
  );
}

function scheduleTournamentStart(tournament) {
  const delay =
    Math.max(
      0,
      tournament.startAt -
      Date.now()
    );

  tournament.startTimer =
    setTimeout(() => {
      tournament.startTimer = null;
      startTournament(tournament);
    }, delay);
}

function tournamentPublic(tournament) {
  const champion =
    tournament.championUserId
      ? users.get(
          tournament.championUserId
        )
      : null;

  return {
    id: tournament.id,
    name: tournament.name,
    prize: tournament.prize,

    startAt: tournament.startAt,

    maxPlayers:
      tournament.maxPlayers,

    registered:
      tournament
        .registeredUserIds
        .length,

    status:
      tournament.status,

    champion:
      champion
        ? champion.username
        : null,

    matches:
      tournament.matches.map(
        match => ({
          id: match.id,
          round: match.round,

          playerNames:
            match.userIds.map(
              userId => {
                const user =
                  users.get(userId);

                return user
                  ? user.username
                  : 'Unknown';
              }
            ),

          winnerName:
            match.winnerUserId
              ? (
                  users.get(
                    match.winnerUserId
                  ) || {}
                ).username || null
              : null,

          roomId:
            match.roomId || null,

          finished:
            Boolean(
              match.winnerUserId
            )
        })
      )
  };
}

function broadcastTournaments() {
  io.emit(
    'tournaments',
    Array.from(
      tournaments.values()
    ).map(tournamentPublic)
  );
}

function startTournament(tournament) {
  if (
    tournament.status !==
    'registration'
  ) {
    return;
  }

  if (
    tournament.registeredUserIds
      .length < 2
  ) {
    /*
       Not enough players:
       reopen registration for 5 minutes.
    */

    tournament.startAt =
      Date.now() +
      5 * 60 * 1000;

    scheduleTournamentStart(
      tournament
    );

    broadcastTournaments();
    return;
  }

  tournament.status =
    'running';

  tournament.round = 1;

  createTournamentRound(
    tournament,
    tournament.registeredUserIds
  );

  broadcastTournaments();
}

function createTournamentRound(
  tournament,
  userIds
) {
  const shuffled =
    userIds.slice();

  for (
    let i = shuffled.length - 1;
    i > 0;
    i--
  ) {
    const j =
      randomInt(0, i);

    [shuffled[i], shuffled[j]] =
      [shuffled[j], shuffled[i]];
  }

  const round =
    tournament.round;

  const matches = [];

  for (
    let i = 0;
    i < shuffled.length;
    i += 2
  ) {
    const pair =
      shuffled.slice(i, i + 2);

    const match = {
      id: id('match'),

      round,

      userIds: pair,

      winnerUserId: null,
      roomId: null
    };

    matches.push(match);

    tournament.matches.push(
      match
    );

    /*
       Bye.
    */

    if (pair.length === 1) {
      match.winnerUserId =
        pair[0];
    } else {
      createTournamentMatchRoom(
        tournament,
        match
      );
    }
  }

  maybeAdvanceTournament(
    tournament
  );
}

function createTournamentMatchRoom(
  tournament,
  match
) {
  /*
     Tournament uses head-to-head
     single elimination internally.
  */

  const room =
    createRoom({
      name:
        tournament.name +
        ' · R' +
        match.round,

      capacity: 2,
      parties: 1,
      stake: 0,

      tournament: {
        tournamentId:
          tournament.id,

        matchId:
          match.id
      }
    });

  match.roomId =
    room.id;

  for (const userId of match.userIds) {
    const user =
      users.get(userId);

    if (!user) continue;

    const player = {
      id: user.id,
      userId: user.id,
      userKey: user.id,

      socketId:
        user.socketId || null,

      name: user.username,
      avatar: user.avatar,

      isBot: false,

      connected:
        Boolean(user.socketId),

      hand: [],
      captured: [],

      totalPoints: 0,
      lastRawPoints: 0,

      xp: user.xp,
      level: user.level,
      wins: user.wins,

      cardSkin:
        user.cardSkin,

      disconnectTimer: null
    };

    room.players.push(player);

    user.roomId =
      room.id;

    if (user.socketId) {
      const socket =
        io.sockets.sockets.get(
          user.socketId
        );

      if (socket) {
        socket.join(room.id);
      }
    }
  }

  if (
    room.players.length === 2
  ) {
    startRoom(room);
  }
}

function tournamentMatchFinished(
  room,
  winner
) {
  const info =
    room.tournament;

  if (!info) return;

  const tournament =
    tournaments.get(
      info.tournamentId
    );

  if (!tournament) return;

  const match =
    tournament.matches.find(
      item =>
        item.id === info.matchId
    );

  if (!match) return;

  match.winnerUserId =
    winner.userId ||
    winner.id;

  broadcastTournaments();

  setTimeout(() => {
    maybeAdvanceTournament(
      tournament
    );
  }, 1000);
}

function maybeAdvanceTournament(
  tournament
) {
  const roundMatches =
    tournament.matches.filter(
      match =>
        match.round ===
        tournament.round
    );

  if (!roundMatches.length) {
    return;
  }

  if (
    roundMatches.some(
      match =>
        !match.winnerUserId
    )
  ) {
    return;
  }

  const winners =
    roundMatches.map(
      match =>
        match.winnerUserId
    );

  if (winners.length === 1) {
    tournament.status =
      'finished';

    tournament.championUserId =
      winners[0];

    const champion =
      users.get(winners[0]);

    if (champion) {
      addXP(champion, 500);
    }

    broadcastTournaments();
    return;
  }

  tournament.round += 1;

  createTournamentRound(
    tournament,
    winners
  );

  broadcastTournaments();
}

/* =========================================================
   SOCKET.IO
   ========================================================= */

io.on('connection', socket => {
  console.log(
    '[SOCKET] connected:',
    socket.id
  );

  socket.data.userId = null;
  socket.data.playerId = null;
  socket.data.roomId = null;

  socket.emit(
    'lobbyTables',
    lobbyTables()
  );

  socket.emit(
    'tournaments',
    Array.from(
      tournaments.values()
    ).map(tournamentPublic)
  );

  /* -------------------------------------------------------
     REGISTER
     ------------------------------------------------------- */

  socket.on(
    'register',
    async payload => {
      try {
        const username =
          cleanName(
            payload &&
            payload.username
          );

        const password =
          String(
            payload &&
            payload.password || ''
          );

        if (
          username.length < 3 ||
          username.length > 24
        ) {
          socket.emit(
            'authError',
            'Username უნდა იყოს 3-24 სიმბოლო.'
          );

          return;
        }

        if (password.length < 6) {
          socket.emit(
            'authError',
            'Password უნდა იყოს მინიმუმ 6 სიმბოლო.'
          );

          return;
        }

        if (
          findUserByUsername(
            username
          )
        ) {
          socket.emit(
            'authError',
            'ეს Username უკვე გამოყენებულია.'
          );

          return;
        }

        const credentials =
          await createPassword(
            password
          );

        const user = {
          id: id('user'),

          username,

          passwordSalt:
            credentials.salt,

          passwordHash:
            credentials.hash,

          avatar:
            validAvatar(
              payload &&
              payload.avatar
            ),

          xp: 0,
          level: 1,
          wins: 0,

          balance:
            START_BALANCE,

          cardSkin:
            'royal',

          tableSkin:
            'emerald',

          achievements: [],

          quests:
            defaultQuests(),

          createdAt:
            new Date()
              .toISOString(),

          socketId:
            socket.id,

          roomId:
            null
        };

        users.set(
          user.id,
          user
        );

        socket.data.userId =
          user.id;

        const token =
          createSession(user);

        await saveUsersNow();

        socket.emit(
          'authSuccess',
          {
            token,
            profile:
              publicProfile(user)
          }
        );
      } catch (error) {
        console.error(
          '[REGISTER]',
          error
        );

        socket.emit(
          'authError',
          'რეგისტრაციისას დაფიქსირდა შეცდომა.'
        );
      }
    }
  );

  /* -------------------------------------------------------
     LOGIN
     ------------------------------------------------------- */

  socket.on(
    'login',
    async payload => {
      try {
        const username =
          cleanName(
            payload &&
            payload.username
          );

        const password =
          String(
            payload &&
            payload.password || ''
          );

        const user =
          findUserByUsername(
            username
          );

        if (!user) {
          socket.emit(
            'authError',
            'მომხმარებელი ვერ მოიძებნა.'
          );

          return;
        }

        const valid =
          await verifyPassword(
            password,
            user
          );

        if (!valid) {
          socket.emit(
            'authError',
            'არასწორი Password.'
          );

          return;
        }

        user.socketId =
          socket.id;

        socket.data.userId =
          user.id;

        const token =
          createSession(user);

        socket.emit(
          'authSuccess',
          {
            token,
            profile:
              publicProfile(user)
          }
        );

        recoverUserRoom(
          socket,
          user
        );
      } catch (error) {
        console.error(
          '[LOGIN]',
          error
        );

        socket.emit(
          'authError',
          'შესვლისას დაფიქსირდა შეცდომა.'
        );
      }
    }
  );

  /* -------------------------------------------------------
     TESTER LOGIN
     ------------------------------------------------------- */

  socket.on(
    'testerLogin',
    async () => {
      let user =
        findUserByUsername(
          TESTER_NAME
        );

      if (!user) {
        user = {
          id: id('tester'),

          username:
            TESTER_NAME,

          passwordSalt: '',
          passwordHash: '',

          avatar: '🧙',

          xp: 999,
          level: 10,
          wins: 10,

          balance:
            START_BALANCE,

          cardSkin:
            'royal',

          tableSkin:
            'emerald',

          achievements: [],

          quests:
            defaultQuests(),

          tester: true,

          createdAt:
            new Date()
              .toISOString()
        };

        users.set(
          user.id,
          user
        );
      }

      ensureUserDefaults(user);

      user.socketId =
        socket.id;

      socket.data.userId =
        user.id;

      const token =
        createSession(user);

      await saveUsersNow();

      socket.emit(
        'authSuccess',
        {
          token,
          profile:
            publicProfile(user)
        }
      );

      recoverUserRoom(
        socket,
        user
      );
    }
  );

  /* -------------------------------------------------------
     RESTORE SESSION
     ------------------------------------------------------- */

  socket.on(
    'restoreSession',
    payload => {
      const token =
        payload &&
        payload.token;

      const user =
        userFromToken(token);

      if (!user) {
        socket.emit(
          'sessionInvalid'
        );

        return;
      }

      ensureUserDefaults(user);

      user.socketId =
        socket.id;

      socket.data.userId =
        user.id;

      socket.emit(
        'authSuccess',
        {
          token,
          profile:
            publicProfile(user)
        }
      );

      recoverUserRoom(
        socket,
        user
      );
    }
  );

  /* -------------------------------------------------------
     COSMETICS
     ------------------------------------------------------- */

  socket.on(
    'updateCosmetics',
    payload => {
      const user =
        users.get(
          socket.data.userId
        );

      if (!user) return;

      if (
        CARD_SKINS.includes(
          payload &&
          payload.cardSkin
        )
      ) {
        user.cardSkin =
          payload.cardSkin;
      }

      if (
        TABLE_SKINS.includes(
          payload &&
          payload.tableSkin
        )
      ) {
        user.tableSkin =
          payload.tableSkin;
      }

      scheduleUsersSave();

      emitProfile(user);
    }
  );

  /* -------------------------------------------------------
     JOIN TABLE
     ------------------------------------------------------- */

  socket.on(
    'joinTable',
    payload => {
      joinTableHandler(
        socket,
        payload || {}
      );
    }
  );

  /* -------------------------------------------------------
     PLAY CARDS
     ------------------------------------------------------- */

  socket.on(
    'playCards',
    payload => {
      const room =
        rooms.get(
          socket.data.roomId
        );

      if (
        !room ||
        !room.game
      ) {
        return;
      }

      const player =
        room.players.find(
          p =>
            p.id ===
            socket.data.playerId
        );

      if (!player) return;

      const active =
        room.players[
          room.game.currentTurnIndex
        ];

      if (
        !active ||
        active.id !== player.id
      ) {
        socket.emit(
          'errorMessage',
          'ახლა შენი სვლა არ არის.'
        );

        return;
      }

      applyPlay(
        room,
        player,
        payload &&
        payload.cardIndices || []
      );
    }
  );

  /* -------------------------------------------------------
     QUICK MESSAGE
     ------------------------------------------------------- */

  socket.on(
    'quickMessage',
    payload => {
      const room =
        rooms.get(
          socket.data.roomId
        );

      if (!room) return;

      const player =
        room.players.find(
          p =>
            p.id ===
            socket.data.playerId
        );

      if (!player) return;

      const text =
        String(
          payload &&
          payload.text || ''
        ).slice(0, 60);

      if (
        !QUICK_MESSAGES.has(text)
      ) {
        return;
      }

      io.to(room.id).emit(
        'quickMessage',
        {
          playerId:
            player.id,

          text
        }
      );
    }
  );

  /* -------------------------------------------------------
     THROWABLE
     ------------------------------------------------------- */

  socket.on(
    'throwable',
    payload => {
      const room =
        rooms.get(
          socket.data.roomId
        );

      if (!room) return;

      const from =
        room.players.find(
          player =>
            player.id ===
            socket.data.playerId
        );

      const target =
        room.players.find(
          player =>
            player.id ===
            (
              payload &&
              payload.targetPlayerId
            )
        );

      const type =
        String(
          payload &&
          payload.type || ''
        );

      if (
        !from ||
        !target ||
        from.id === target.id ||
        !THROWABLES.has(type)
      ) {
        return;
      }

      io.to(room.id).emit(
        'throwableEvent',
        {
          fromPlayerId:
            from.id,

          targetPlayerId:
            target.id,

          type
        }
      );
    }
  );

  /* -------------------------------------------------------
     REGISTER TOURNAMENT
     ------------------------------------------------------- */

  socket.on(
    'registerTournament',
    payload => {
      const user =
        users.get(
          socket.data.userId
        );

      if (!user) {
        socket.emit(
          'authError',
          'ტურნირისთვის ავტორიზაცია აუცილებელია.'
        );

        return;
      }

      const tournament =
        tournaments.get(
          payload &&
          payload.id
        );

      if (
        !tournament ||
        tournament.status !==
          'registration'
      ) {
        return;
      }

      if (
        tournament
          .registeredUserIds
          .includes(user.id)
      ) {
        socket.emit(
          'tournamentRegistered'
        );

        return;
      }

      if (
        tournament
          .registeredUserIds
          .length >=
        tournament.maxPlayers
      ) {
        socket.emit(
          'errorMessage',
          'ტურნირი შევსებულია.'
        );

        return;
      }

      tournament
        .registeredUserIds
        .push(user.id);

      socket.emit(
        'tournamentRegistered'
      );

      broadcastTournaments();
    }
  );

  /* -------------------------------------------------------
     JOIN TOURNAMENT ROOM
     ------------------------------------------------------- */

  socket.on(
    'joinTournamentRoom',
    payload => {
      const user =
        users.get(
          socket.data.userId
        );

      if (!user) return;

      const tournament =
        tournaments.get(
          payload &&
          payload.tournamentId
        );

      if (!tournament) return;

      const match =
        tournament.matches.find(
          item =>
            !item.winnerUserId &&
            item.userIds.includes(
              user.id
            )
        );

      if (!match || !match.roomId) {
        socket.emit(
          'errorMessage',
          'აქტიური ტურნირის მაგიდა ვერ მოიძებნა.'
        );

        return;
      }

      const room =
        rooms.get(
          match.roomId
        );

      if (!room) return;

      const player =
        room.players.find(
          p =>
            p.userId === user.id
        );

      if (!player) return;

      player.socketId =
        socket.id;

      player.connected = true;

      socket.data.roomId =
        room.id;

      socket.data.playerId =
        player.id;

      user.roomId =
        room.id;

      socket.join(room.id);

      socket.emit(
        'sessionRecovered'
      );

      broadcastRoom(room);
    }
  );

  /* -------------------------------------------------------
     DISCONNECT
     ------------------------------------------------------- */

  socket.on(
    'disconnect',
    () => {
      handleDisconnect(
        socket
      );
    }
  );
});

/* =========================================================
   JOIN TABLE HANDLER
   ========================================================= */

function joinTableHandler(
  socket,
  payload
) {
  const user =
    users.get(
      socket.data.userId
    );

  let room = null;

  /*
     Existing room.
  */

  if (payload.roomId) {
    room =
      rooms.get(
        payload.roomId
      );

    if (
      !room ||
      !roomOpen(room)
    ) {
      socket.emit(
        'errorMessage',
        'ეს მაგიდა აღარ არის ხელმისაწვდომი.'
      );

      return;
    }
  }

  /*
     Create / quick-match room.
  */

  if (!room) {
    const capacity =
      ALLOWED_CAPACITIES.includes(
        Number(payload.capacity)
      )
        ? Number(payload.capacity)
        : 4;

    const parties =
      clampNumber(
        payload.parties,
        1,
        MAX_PARTIES,
        1
      );

    const stake =
      ALLOWED_STAKES.includes(
        Number(payload.stake)
      )
        ? Number(payload.stake)
        : 5;

    /*
       First try matching open table.
    */

    room =
      Array.from(
        rooms.values()
      ).find(
        candidate =>
          roomOpen(candidate) &&
          candidate.capacity ===
            capacity &&
          candidate.parties ===
            parties &&
          candidate.stake ===
            stake
      );

    if (!room) {
      room =
        createRoom({
          name:
            cleanName(
              payload.tableName
            ) ||
            'Bura Table',

          capacity,
          parties,
          stake
        });
    }
  }

  let player;

  if (user) {
    /*
       Avoid same account twice.
    */

    const existing =
      room.players.find(
        item =>
          item.userId === user.id
      );

    if (existing) {
      existing.socketId =
        socket.id;

      existing.connected =
        true;

      player = existing;
    } else {
      player =
        createHumanPlayer(
          user,
          socket
        );

      room.players.push(
        player
      );
    }

    user.roomId =
      room.id;

    questTablePlayed(
      user,
      room.id
    );
  } else {
    player =
      createGuestPlayer(
        payload.name,
        socket
      );

    room.players.push(
      player
    );
  }

  socket.data.roomId =
    room.id;

  socket.data.playerId =
    player.id;

  socket.join(room.id);

  /*
     Tester immediately fills table with bots.
  */

  if (
    isTesterName(
      player.name
    )
  ) {
    fillWithBots(room);
  }

  broadcastLobby();

  if (
    room.players.length >=
    room.capacity
  ) {
    startRoom(room);
  } else {
    io.to(room.id).emit(
      'waitingForPlayers',
      {
        current:
          room.players.length,

        max:
          room.capacity
      }
    );
  }
}

/* =========================================================
   SESSION RECOVERY
   ========================================================= */

function recoverUserRoom(
  socket,
  user
) {
  let room = null;

  if (user.roomId) {
    room =
      rooms.get(
        user.roomId
      );
  }

  /*
     Fallback lookup by user id.
  */

  if (!room) {
    room =
      Array.from(
        rooms.values()
      ).find(
        candidate =>
          candidate.players.some(
            player =>
              player.userId ===
              user.id
          )
      );
  }

  if (!room) {
    user.roomId = null;
    return;
  }

  const player =
    room.players.find(
      item =>
        item.userId ===
        user.id
    );

  if (!player) {
    user.roomId = null;
    return;
  }

  if (player.disconnectTimer) {
    clearTimeout(
      player.disconnectTimer
    );

    player.disconnectTimer =
      null;
  }

  player.socketId =
    socket.id;

  player.connected =
    true;

  player.name =
    user.username;

  player.avatar =
    user.avatar;

  player.xp =
    user.xp;

  player.level =
    user.level;

  player.wins =
    user.wins;

  player.cardSkin =
    user.cardSkin;

  socket.data.roomId =
    room.id;

  socket.data.playerId =
    player.id;

  socket.join(room.id);

  user.roomId =
    room.id;

  socket.emit(
    'sessionRecovered'
  );

  if (room.game) {
    socket.emit(
      'gameStateUpdate',
      getClientState(
        room,
        player.id,
        isTesterName(
          player.name
        )
      )
    );
  } else {
    socket.emit(
      'waitingForPlayers',
      {
        current:
          room.players.length,

        max:
          room.capacity
      }
    );
  }

  broadcastRoom(room);
}

/* =========================================================
   DISCONNECT / 30 SECOND GRACE
   ========================================================= */

function handleDisconnect(
  socket
) {
  console.log(
    '[SOCKET] disconnected:',
    socket.id
  );

  const room =
    rooms.get(
      socket.data.roomId
    );

  const user =
    users.get(
      socket.data.userId
    );

  if (user) {
    if (
      user.socketId ===
      socket.id
    ) {
      user.socketId = null;
    }
  }

  if (!room) return;

  const player =
    room.players.find(
      item =>
        item.id ===
        socket.data.playerId
    );

  if (!player) return;

  player.connected =
    false;

  player.socketId =
    null;

  broadcastRoom(room);

  /*
     Keep player's seat for 30 seconds.
  */

  if (player.disconnectTimer) {
    clearTimeout(
      player.disconnectTimer
    );
  }

  player.disconnectTimer =
    setTimeout(() => {
      player.disconnectTimer =
        null;

      if (player.connected) {
        return;
      }

      /*
         Active game:
         convert disconnected player to bot,
         preserving hand and score so game continues.
      */

      if (
        room.game &&
        !room.game.gameOver
      ) {
        player.isBot = true;

        player.name =
          player.name +
          ' 🤖';

        player.avatar = '🤖';

        /*
           If it is their turn, continue.
        */

        const active =
          room.players[
            room.game.currentTurnIndex
          ];

        if (
          active &&
          active.id === player.id
        ) {
          scheduleBot(room);
        }

        broadcastRoom(room);

        return;
      }

      /*
         Waiting room:
         remove disconnected player.
      */

      const index =
        room.players.findIndex(
          item =>
            item.id ===
            player.id
        );

      if (index >= 0) {
        room.players.splice(
          index,
          1
        );
      }

      if (user) {
        user.roomId = null;
      }

      if (!room.players.length) {
        destroyRoom(room.id);
      } else {
        broadcastLobby();
      }
    }, RECONNECT_GRACE_MS);
}

/* =========================================================
   ROOM CLEANUP
   ========================================================= */

function cleanupRooms() {
  const now = Date.now();

  for (const room of rooms.values()) {
    const humans =
      room.players.filter(
        player =>
          !player.isBot &&
          player.connected
      );

    /*
       Completed room older than 10 minutes.
    */

    if (
      room.game &&
      room.game.gameOver &&
      now - room.createdAt >
        10 * 60 * 1000
    ) {
      destroyRoom(room.id);
      continue;
    }

    /*
       Empty waiting room.
    */

    if (
      !room.game &&
      !room.players.length
    ) {
      destroyRoom(room.id);
      continue;
    }

    /*
       Abandoned bot-only game.
    */

    if (
      room.game &&
      !humans.length &&
      room.players.every(
        player => player.isBot
      )
    ) {
      destroyRoom(room.id);
    }
  }
}

const cleanupInterval =
  setInterval(
    cleanupRooms,
    60 * 1000
  );

/* =========================================================
   GRACEFUL SHUTDOWN
   ========================================================= */

async function shutdown(signal) {
  console.log(
    '[SERVER] shutdown:',
    signal
  );

  clearInterval(
    cleanupInterval
  );

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  for (const room of rooms.values()) {
    if (room.timer) {
      clearTimeout(room.timer);
    }

    if (room.botTimer) {
      clearTimeout(room.botTimer);
    }

    for (const player of room.players) {
      if (player.disconnectTimer) {
        clearTimeout(
          player.disconnectTimer
        );
      }
    }
  }

  for (
    const tournament of
    tournaments.values()
  ) {
    if (tournament.startTimer) {
      clearTimeout(
        tournament.startTimer
      );
    }
  }

  await saveUsersNow();

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 5000).unref();
}

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

/* =========================================================
   UNHANDLED ERRORS
   ========================================================= */

process.on(
  'unhandledRejection',
  error => {
    console.error(
      '[UNHANDLED REJECTION]',
      error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      '[UNCAUGHT EXCEPTION]',
      error
    );
  }
);

/* =========================================================
   START
   ========================================================= */

async function boot() {
  await loadUsers();

  createDefaultTournament();

  server.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        '======================================'
      );

      console.log(
        ' Written Bura server is running'
      );

      console.log(
        ' Port:',
        PORT
      );

      console.log(
        ' Public:',
        PUBLIC_DIR
      );

      console.log(
        ' Index:',
        path.join(
          PUBLIC_DIR,
          'index.html'
        )
      );

      console.log(
        '======================================'
      );
    }
  );
}

boot().catch(error => {
  console.error(
    '[BOOT ERROR]',
    error
  );

  process.exit(1);
});
