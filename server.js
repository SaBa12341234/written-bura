'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const { Server } = require('socket.io');

const scryptAsync = promisify(crypto.scrypt);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1024 * 1024
});

const PORT = process.env.PORT || 10000;
const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;
const TURN_SECONDS = 20;
const RECONNECT_GRACE_MS = 30000;
const SAVE_DEBOUNCE_MS = 4000;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const CARD_VALUES = {
  '6': 0, '7': 0, '8': 0, '9': 0,
  J: 2, Q: 3, K: 4, '10': 10, A: 11
};

const RANKS = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
const TRUMPS = ['spades', 'clubs', 'diamonds', 'hearts', 'no_trump'];
const ALLOWED_STAKES = [5, 10, 25, 50, 100];
const ALLOWED_CAPACITIES = [3, 4];
const AVATARS = ['🦊', '🐺', '🦁', '🐯', '🐻', '🦅', '🐼', '🐸', '🐵', '😎', '🤠', '🧙'];
const THROWABLES = ['tomato', 'egg', 'paper'];

const QUICK_MESSAGES = [
  'სწრაფად!',
  'მალდე!',
  'კარგი იყო',
  'ვაჰ, კოზირი!',
  'სიქიიიიიმ!',
  'ყვერო, მალე!',
  'რას შვრები, ძმაო?!'
];

const rooms = new Map();
const sessions = new Map();
const disconnectTimers = new Map();

let users = {};
let saveTimer = null;
let savePromise = Promise.resolve();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function userKey(value) {
  return cleanName(value).toLowerCase();
}

function makeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultQuests() {
  return {
    date: today(),
    wins: 0,
    maliutka: 0,
    tables: 0,
    claimedWins: false,
    claimedMaliutka: false,
    claimedTables: false
  };
}

function levelFromXP(xp) {
  return Math.max(1, Math.floor(Number(xp || 0) / 250) + 1);
}

function frameFromWins(wins) {
  if (wins >= 25) return 'diamond';
  if (wins >= 8) return 'gold';
  return 'bronze';
}

function normalizeUser(user) {
  if (!user) return null;

  user.xp = Number.isFinite(user.xp) ? user.xp : 0;
  user.wins = Number.isFinite(user.wins) ? user.wins : 0;
  user.games = Number.isFinite(user.games) ? user.games : 0;
  user.balance = Number.isFinite(user.balance) ? user.balance : START_BALANCE;
  user.avatar = user.avatar || AVATARS[0];
  user.achievements = Array.isArray(user.achievements) ? user.achievements : [];
  user.cardSkin = user.cardSkin || 'royal';
  user.tableSkin = user.tableSkin || 'emerald';

  if (!user.quests || user.quests.date !== today()) {
    user.quests = defaultQuests();
  }

  return user;
}

function publicProfile(user) {
  normalizeUser(user);

  return {
    username: user.username,
    avatar: user.avatar,
    xp: user.xp,
    level: levelFromXP(user.xp),
    wins: user.wins,
    games: user.games,
    balance: user.balance,
    frame: frameFromWins(user.wins),
    quests: user.quests,
    achievements: user.achievements,
    cardSkin: user.cardSkin,
    tableSkin: user.tableSkin
  };
}

async function loadUsers() {
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });

    const raw = await fs.promises.readFile(USERS_FILE, 'utf8');
    users = JSON.parse(raw) || {};

    for (const key of Object.keys(users)) {
      normalizeUser(users[key]);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('users.json load error:', error);
    }

    users = {};
  }
}

async function saveUsersNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const snapshot = JSON.stringify(users, null, 2);

  savePromise = savePromise
    .catch(() => {})
    .then(async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });

      const temp = USERS_FILE + '.tmp';
      await fs.promises.writeFile(temp, snapshot, 'utf8');
      await fs.promises.rename(temp, USERS_FILE);
    })
    .catch(error => {
      console.error('users.json save error:', error);
    });

  return savePromise;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveUsersNow();
  }, SAVE_DEBOUNCE_MS);
}

async function hashPassword(password, salt) {
  const result = await scryptAsync(String(password), salt, 64);
  return result.toString('hex');
}

function safeAvatar(value) {
  const avatar = String(value || '');

  if (AVATARS.includes(avatar)) return avatar;

  if (
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) &&
    avatar.length < 700000
  ) {
    return avatar;
  }

  return AVATARS[0];
}

function createSession(key) {
  const token = crypto.randomBytes(32).toString('hex');

  sessions.set(token, {
    userKey: key,
    createdAt: Date.now()
  });

  return token;
}

function getSession(token) {
  const session = sessions.get(String(token || ''));
  if (!session) return null;
  if (!users[session.userKey]) return null;
  return session;
}

function emitProfile(key) {
  const user = users[key];
  if (!user) return;

  for (const socket of io.sockets.sockets.values()) {
    if (socket.userKey === key) {
      socket.emit('profileUpdate', publicProfile(user));
    }
  }
}

function addXP(key, amount) {
  const user = users[key];
  if (!user) return;

  normalizeUser(user);
  user.xp += amount;
  scheduleSave();
  emitProfile(key);
}

function updateQuest(key, field, amount = 1) {
  const user = users[key];
  if (!user) return;

  normalizeUser(user);

  user.quests[field] = Number(user.quests[field] || 0) + amount;

  let reward = 0;

  if (user.quests.wins >= 3 && !user.quests.claimedWins) {
    user.quests.claimedWins = true;
    reward += 100;
  }

  if (user.quests.maliutka >= 1 && !user.quests.claimedMaliutka) {
    user.quests.claimedMaliutka = true;
    reward += 250;
  }

  if (user.quests.tables >= 5 && !user.quests.claimedTables) {
    user.quests.claimedTables = true;
    reward += 50;
  }

  user.xp += reward;

  scheduleSave();
  emitProfile(key);
}

function unlockAchievement(room, player, id, title) {
  if (!player) return;

  if (player.userKey && users[player.userKey]) {
    const user = normalizeUser(users[player.userKey]);

    if (user.achievements.includes(id)) return;

    user.achievements.push(id);
    user.xp += 50;

    scheduleSave();
    emitProfile(player.userKey);
  }

  io.to(room.id).emit('achievement', {
    playerId: player.id,
    playerName: player.name,
    title
  });
}

function createDeck() {
  const cards = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        suit,
        rank,
        value: CARD_VALUES[rank]
      });
    }
  }

  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

function rankIndex(card) {
  return RANKS.indexOf(card.rank);
}

function isTrump(card, trump) {
  return trump !== 'no_trump' && card.suit === trump;
}

function points(cards) {
  return (cards || []).reduce((sum, card) => sum + Number(card.value || 0), 0);
}

function sameSuit(cards) {
  return cards.length > 0 && cards.every(card => card.suit === cards[0].suit);
}

function isMaliutka(cards) {
  return cards.length === 5 && sameSuit(cards);
}

function cardBeats(base, challenger, trump) {
  const baseTrump = isTrump(base, trump);
  const challengerTrump = isTrump(challenger, trump);

  if (challengerTrump && !baseTrump) return true;
  if (baseTrump && !challengerTrump) return false;

  if (base.suit !== challenger.suit) return false;

  return rankIndex(challenger) > rankIndex(base);
}

/*
  Multi-card comparison:
  challenge wins only if every base card can be beaten
  by a unique challenge card.

  This supports N = 1..5.
*/
function playBeats(baseCards, challengeCards, trump) {
  if (baseCards.length !== challengeCards.length) return false;

  const base = baseCards
    .slice()
    .sort((a, b) => rankIndex(b) - rankIndex(a));

  const used = new Array(challengeCards.length).fill(false);

  function search(index) {
    if (index >= base.length) return true;

    for (let i = 0; i < challengeCards.length; i++) {
      if (used[i]) continue;

      if (cardBeats(base[index], challengeCards[i], trump)) {
        used[i] = true;

        if (search(index + 1)) return true;

        used[i] = false;
      }
    }

    return false;
  }

  return search(0);
}

function winningPlayIndex(game) {
  if (!game.table.length) return -1;

  let winner = 0;

  for (let i = 1; i < game.table.length; i++) {
    if (
      playBeats(
        game.table[winner].cards,
        game.table[i].cards,
        game.trump
      )
    ) {
      winner = i;
    }
  }

  return winner;
}

function selectionCutsCurrent(game, cards) {
  if (!game.table.length) return true;

  const winner = winningPlayIndex(game);
  if (winner < 0) return false;

  return playBeats(
    game.table[winner].cards,
    cards,
    game.trump
  );
}

function validateSelection(game, hand, indexes) {
  if (!indexes.length) {
    return { ok: false, message: 'აირჩიე მინიმუმ 1 კარტი.' };
  }

  if (indexes.length > 5) {
    return { ok: false, message: 'მაქსიმუმ 5 კარტის არჩევა შეგიძლია.' };
  }

  const cards = indexes.map(index => hand[index]);

  if (cards.some(card => !card)) {
    return { ok: false, message: 'კარტის არჩევაში შეცდომაა.' };
  }

  if (!game.table.length) {
    if (!sameSuit(cards)) {
      return {
        ok: false,
        message: 'პირველი სვლისას რამდენიმე კარტი ერთი მასტის უნდა იყოს.'
      };
    }

    return {
      ok: true,
      cards,
      cuts: true
    };
  }

  if (game.leadWasMaliutka) {
    if (indexes.length !== hand.length) {
      return {
        ok: false,
        message: 'მალიუტკაზე ხელში დარჩენილი ყველა კარტი უნდა ჩამოხვიდე.'
      };
    }

    return {
      ok: true,
      cards,
      cuts: selectionCutsCurrent(game, cards)
    };
  }

  const required = game.leadCount || 1;

  if (indexes.length !== required) {
    return {
      ok: false,
      message: `უნდა აირჩიო ზუსტად ${required} კარტი.`
    };
  }

  return {
    ok: true,
    cards,
    cuts: selectionCutsCurrent(game, cards)
  };
}

function createRoom(options = {}) {
  const room = {
    id: makeId('room'),
    name: cleanName(options.name) || 'Bura Table',
    capacity: ALLOWED_CAPACITIES.includes(Number(options.capacity))
      ? Number(options.capacity)
      : 3,
    parties: Math.max(1, Math.min(4, Number(options.parties) || 1)),
    stake: ALLOWED_STAKES.includes(Number(options.stake))
      ? Number(options.stake)
      : 5,
    players: [],
    game: null,
    timer: null,
    botTimer: null,
    trickTimer: null,
    tournamentId: options.tournamentId || null,
    tournamentMatchId: options.tournamentMatchId || null
  };

  rooms.set(room.id, room);
  return room;
}

function clearRoomTimers(room) {
  if (!room) return;

  if (room.timer) clearTimeout(room.timer);
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.trickTimer) clearTimeout(room.trickTimer);

  room.timer = null;
  room.botTimer = null;
  room.trickTimer = null;
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  clearRoomTimers(room);

  for (const player of room.players) {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
  }

  rooms.delete(roomId);
  emitLobby();
}

function createHand(room, previousGame = null) {
  const deck = createDeck();
  const hands = {};
  const taken = {};
  const totals = {};

  for (const player of room.players) {
    hands[player.id] = deck.splice(0, 5);
    taken[player.id] = [];
    totals[player.id] = previousGame
      ? Number(previousGame.totals[player.id] || 0)
      : 0;
  }

  const handIndex = previousGame ? previousGame.handIndex + 1 : 1;
  const leaderIndex = previousGame &&
    Number.isInteger(previousGame.nextLeaderIndex)
    ? previousGame.nextLeaderIndex
    : 0;

  return {
    deck,
    hands,
    taken,
    totals,
    table: [],
    handIndex,
    partyIndex: Math.ceil(handIndex / 5),
    trump: TRUMPS[(handIndex - 1) % TRUMPS.length],
    currentTurnIndex: leaderIndex,
    nextLeaderIndex: leaderIndex,
    leadCount: null,
    leadWasMaliutka: false,
    leadPlayerId: null,
    processing: false,
    gameOver: false,
    lastHandScores: previousGame
      ? previousGame.lastHandScores || {}
      : {},
    history: previousGame
      ? previousGame.history || []
      : [],
    lastTrickOrder: [],
    turnEndsAt: Date.now() + TURN_SECONDS * 1000,
    lastAction: null
  };
}

function playerCosmetics(player) {
  if (player.userKey && users[player.userKey]) {
    const user = normalizeUser(users[player.userKey]);

    return {
      avatar: user.avatar,
      xp: user.xp,
      level: levelFromXP(user.xp),
      wins: user.wins,
      frame: frameFromWins(user.wins),
      cardSkin: user.cardSkin,
      tableSkin: user.tableSkin
    };
  }

  return {
    avatar: player.avatar || '🤖',
    xp: 0,
    level: 1,
    wins: 0,
    frame: 'bronze',
    cardSkin: 'royal',
    tableSkin: 'emerald'
  };
}

function clientState(room, viewerId, revealAll = false) {
  const game = room.game;
  const visibleHands = {};

  if (revealAll) {
    for (const player of room.players) {
      visibleHands[player.id] = game.hands[player.id] || [];
    }
  } else {
    visibleHands[viewerId] = game.hands[viewerId] || [];
  }

  const winnerIndex = winningPlayIndex(game);

  return {
    roomId: room.id,
    roomName: room.name,
    capacity: room.capacity,
    parties: room.parties,
    stake: room.stake,
    totalHands: room.parties * 5,

    handIndex: game.handIndex,
    partyIndex: game.partyIndex,
    trump: game.trump,
    deckCount: game.deck.length,

    currentTurnIndex: game.currentTurnIndex,
    turnEndsAt: game.turnEndsAt,
    turnSeconds: TURN_SECONDS,

    processing: game.processing,
    gameOver: game.gameOver,

    viewingPlayerId: viewerId,
    revealAll,

    leadCount: game.leadCount,
    leadWasMaliutka: game.leadWasMaliutka,

    playersCards: visibleHands,

    table: game.table.map((play, index) => ({
      playerId: play.playerId,
      playerName: play.playerName,
      cards: play.cards,
      cuts: play.cuts,
      isWinning: index === winnerIndex
    })),

    lastHandScores: game.lastHandScores,
    history: game.history,
    lastAction: game.lastAction,

    players: room.players.map((player, index) => {
      const cosmetic = playerCosmetics(player);

      return {
        id: player.id,
        name: player.name,
        isBot: !!player.isBot,
        isTester: !!player.isTester,
        connected: player.connected !== false,
        cardCount: (game.hands[player.id] || []).length,
        handPoints: points(game.taken[player.id]),
        totalPoints: Number(game.totals[player.id] || 0),
        isCurrent: index === game.currentTurnIndex,
        ...cosmetic
      };
    })
  };
}

function broadcast(room) {
  if (!room.game) return;

  for (const player of room.players) {
    if (player.isBot || !player.socketId || player.connected === false) continue;

    io.to(player.socketId).emit(
      'gameStateUpdate',
      clientState(room, player.id, player.isTester)
    );
  }
}

function lobbyRooms() {
  return [...rooms.values()]
    .filter(room => !room.game && room.players.length < room.capacity)
    .map(room => ({
      id: room.id,
      name: room.name,
      stake: room.stake,
      capacity: room.capacity,
      players: room.players.length,
      parties: room.parties
    }));
}

function emitLobby() {
  io.emit('lobbyTables', lobbyRooms());
}

function setTurn(room, index) {
  if (!room.game || room.game.gameOver) return;

  if (room.timer) clearTimeout(room.timer);

  room.game.currentTurnIndex = index;
  room.game.turnEndsAt = Date.now() + TURN_SECONDS * 1000;

  room.timer = setTimeout(() => {
    autoPlayCurrent(room);
  }, TURN_SECONDS * 1000 + 150);
}

function refill(room, winnerIndex) {
  const game = room.game;

  while (game.deck.length) {
    let dealt = false;

    for (let offset = 0; offset < room.players.length; offset++) {
      const player = room.players[(winnerIndex + offset) % room.players.length];
      const hand = game.hands[player.id];

      if (hand.length < 5 && game.deck.length) {
        hand.push(game.deck.pop());
        dealt = true;
      }
    }

    if (!dealt) break;
  }
}

function calculateNextLeader(room, game, rawScores) {
  const zeroPlayers = room.players.filter(
    player => Number(rawScores[player.id] || 0) === 0
  );

  if (zeroPlayers.length >= 2 && game.lastTrickOrder.length) {
    const zeroIds = new Set(zeroPlayers.map(player => player.id));
    let lastZeroId = null;

    for (const playerId of game.lastTrickOrder) {
      if (zeroIds.has(playerId)) {
        lastZeroId = playerId;
      }
    }

    if (lastZeroId) {
      const index = room.players.findIndex(player => player.id === lastZeroId);
      return (index + 1) % room.players.length;
    }
  }

  let minimum = Infinity;
  let minimumIndex = 0;

  room.players.forEach((player, index) => {
    const score = Number(rawScores[player.id] || 0);

    if (score < minimum) {
      minimum = score;
      minimumIndex = index;
    }
  });

  return (minimumIndex + 1) % room.players.length;
}

function determineGameWinner(room) {
  return room.players.reduce((best, player) => {
    if (!best) return player;

    return Number(room.game.totals[player.id] || 0) >
      Number(room.game.totals[best.id] || 0)
      ? player
      : best;
  }, null);
}

async function finishHand(room) {
  const game = room.game;
  const rawScores = {};
  const scores = {};

  for (const player of room.players) {
    rawScores[player.id] = points(game.taken[player.id]);

    scores[player.id] = rawScores[player.id] === 0
      ? -120
      : rawScores[player.id];

    game.totals[player.id] =
      Number(game.totals[player.id] || 0) +
      scores[player.id];

    if (player.userKey) {
      addXP(player.userKey, 20);
    }
  }

  game.lastHandScores = { ...scores };

  game.history.push({
    hand: game.handIndex,
    party: game.partyIndex,
    trump: game.trump,
    rawScores: { ...rawScores },
    scores: { ...scores },
    totals: { ...game.totals }
  });

  await saveUsersNow();

  if (game.handIndex >= room.parties * 5) {
    game.gameOver = true;
    clearRoomTimers(room);

    const winner = determineGameWinner(room);

    for (const player of room.players) {
      if (!player.userKey || !users[player.userKey]) continue;

      const user = normalizeUser(users[player.userKey]);
      user.games += 1;
      user.xp += 30;

      if (winner && player.id === winner.id) {
        user.wins += 1;
        user.xp += 100;
        updateQuest(player.userKey, 'wins');
      }

      emitProfile(player.userKey);
    }

    await saveUsersNow();

    broadcast(room);

    if (winner) {
      io.to(room.id).emit('gameWinner', {
        playerId: winner.id,
        playerName: winner.name
      });
    }

    io.to(room.id).emit('sfxEvent', {
      type: 'win',
      winnerId: winner ? winner.id : null
    });

    if (room.tournamentId && room.tournamentMatchId && winner) {
      tournamentMatchFinished(room, winner);
    }

    return;
  }

  game.nextLeaderIndex = calculateNextLeader(room, game, rawScores);

  room.game = createHand(room, game);
  room.game.lastHandScores = { ...scores };

  setTurn(room, room.game.currentTurnIndex);
  broadcast(room);

  io.to(room.id).emit('sfxEvent', { type: 'deal' });

  scheduleBot(room);
}

function completeTrick(room) {
  const game = room.game;
  const winnerPlayIndex = winningPlayIndex(game);
  const winnerPlay = game.table[winnerPlayIndex];

  if (!winnerPlay) return;

  const allCards = game.table.flatMap(play => play.cards);

  game.taken[winnerPlay.playerId].push(...allCards);
  game.lastTrickOrder = game.table.map(play => play.playerId);
  game.processing = true;

  const winnerIndex = room.players.findIndex(
    player => player.id === winnerPlay.playerId
  );

  game.lastAction = {
    type: 'trick',
    winnerId: winnerPlay.playerId,
    at: Date.now()
  };

  clearRoomTimers(room);
  broadcast(room);

  io.to(room.id).emit('trickWon', {
    winnerId: winnerPlay.playerId,
    cards: allCards
  });

  io.to(room.id).emit('sfxEvent', {
    type: winnerPlayIndex === 0 ? 'take' : 'cut'
  });

  room.trickTimer = setTimeout(async () => {
    if (!rooms.has(room.id) || room.game !== game) return;

    game.table = [];
    game.leadCount = null;
    game.leadWasMaliutka = false;
    game.leadPlayerId = null;

    refill(room, winnerIndex);

    game.processing = false;

    const finished =
      room.players.every(player => (game.hands[player.id] || []).length === 0) &&
      game.deck.length === 0;

    if (finished) {
      await finishHand(room);
      return;
    }

    setTurn(room, winnerIndex);
    broadcast(room);
    scheduleBot(room);
  }, 950);
}

function applyPlay(room, player, indexes) {
  const game = room.game;

  if (!game || game.processing || game.gameOver) {
    return { ok: false, message: 'ახლა სვლა შეუძლებელია.' };
  }

  const hand = game.hands[player.id] || [];
  const validation = validateSelection(game, hand, indexes);

  if (!validation.ok) return validation;

  if (!game.table.length) {
    game.leadCount = validation.cards.length;
    game.leadWasMaliutka = isMaliutka(validation.cards);
    game.leadPlayerId = player.id;

    if (game.leadWasMaliutka) {
      unlockAchievement(
        room,
        player,
        'maliutka_master',
        'მალიუტკის ოსტატი'
      );

      if (player.userKey) {
        updateQuest(player.userKey, 'maliutka');
      }
    }
  }

  game.hands[player.id] = hand.filter(
    (_, index) => !indexes.includes(index)
  );

  game.table.push({
    playerId: player.id,
    playerName: player.name,
    cards: validation.cards,
    cuts: validation.cuts
  });

  game.lastAction = {
    type: validation.cuts && game.table.length > 1 ? 'cut' : 'play',
    playerId: player.id,
    at: Date.now()
  };

  io.to(room.id).emit('cardPlayed', {
    playerId: player.id,
    cards: validation.cards,
    cuts: validation.cuts
  });

  io.to(room.id).emit('sfxEvent', {
    type: validation.cuts && game.table.length > 1 ? 'cut' : 'place'
  });

  if (game.table.length === room.players.length) {
    completeTrick(room);
  } else {
    setTurn(
      room,
      (game.currentTurnIndex + 1) % room.players.length
    );

    broadcast(room);
    scheduleBot(room);
  }

  return { ok: true };
}

function combinations(length, count) {
  const result = [];

  function build(start, current) {
    if (current.length === count) {
      result.push(current.slice());
      return;
    }

    for (let i = start; i < length; i++) {
      current.push(i);
      build(i + 1, current);
      current.pop();
    }
  }

  build(0, []);
  return result;
}

function cardWasteCost(card, trump) {
  let cost = card.value * 20 + rankIndex(card);

  if (isTrump(card, trump)) {
    cost += 100;
  }

  return cost;
}

function comboWasteCost(cards, trump) {
  return cards.reduce(
    (sum, card) => sum + cardWasteCost(card, trump),
    0
  );
}

function smartBotChoice(room, player) {
  const game = room.game;
  const hand = game.hands[player.id] || [];

  if (!hand.length) return [];

  if (!game.table.length) {
    /*
      5-card Maliutka first.
    */
    if (hand.length === 5 && sameSuit(hand)) {
      return hand.map((_, index) => index);
    }

    /*
      Prefer useful multi-card same-suit combinations,
      but don't throw expensive cards unnecessarily.
    */
    for (let count = Math.min(4, hand.length); count >= 2; count--) {
      const candidates = combinations(hand.length, count)
        .filter(indexes => sameSuit(indexes.map(index => hand[index])))
        .sort((a, b) => {
          const ac = a.map(index => hand[index]);
          const bc = b.map(index => hand[index]);

          return comboWasteCost(ac, game.trump) -
            comboWasteCost(bc, game.trump);
        });

      if (candidates.length) {
        return candidates[0];
      }
    }

    /*
      Otherwise lowest cheap non-trump card.
    */
    return hand
      .map((card, index) => ({
        index,
        cost: cardWasteCost(card, game.trump)
      }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 1)
      .map(item => item.index);
  }

  const required = game.leadWasMaliutka
    ? hand.length
    : Math.min(game.leadCount || 1, hand.length);

  const candidates = combinations(hand.length, required);

  /*
    Find every legal cutting combination.
    Then spend the cheapest one.
  */
  const cutting = candidates
    .filter(indexes => {
      const cards = indexes.map(index => hand[index]);
      return selectionCutsCurrent(game, cards);
    })
    .sort((a, b) => {
      const ac = a.map(index => hand[index]);
      const bc = b.map(index => hand[index]);

      return comboWasteCost(ac, game.trump) -
        comboWasteCost(bc, game.trump);
    });

  if (cutting.length) {
    return cutting[0];
  }

  /*
    Can't cut: dump the lowest-value/lowest-rank cards.
  */
  return hand
    .map((card, index) => ({
      index,
      value: card.value,
      trump: isTrump(card, game.trump) ? 1 : 0,
      rank: rankIndex(card)
    }))
    .sort((a, b) =>
      a.value - b.value ||
      a.trump - b.trump ||
      a.rank - b.rank
    )
    .slice(0, required)
    .map(item => item.index)
    .sort((a, b) => a - b);
}

function scheduleBot(room) {
  if (!room.game || room.game.processing || room.game.gameOver) return;

  if (room.botTimer) clearTimeout(room.botTimer);

  const player = room.players[room.game.currentTurnIndex];

  if (!player || !player.isBot) return;

  io.to(room.id).emit('botThinking', {
    playerId: player.id,
    playerName: player.name
  });

  const delay = crypto.randomInt(1200, 1801);
  const gameReference = room.game;

  room.botTimer = setTimeout(() => {
    if (!rooms.has(room.id)) return;
    if (room.game !== gameReference) return;
    if (room.game.processing || room.game.gameOver) return;

    const current = room.players[room.game.currentTurnIndex];

    if (!current || current.id !== player.id) return;

    applyPlay(
      room,
      player,
      smartBotChoice(room, player)
    );
  }, delay);
}

function autoPlayCurrent(room) {
  if (!room.game || room.game.processing || room.game.gameOver) return;

  const player = room.players[room.game.currentTurnIndex];
  if (!player) return;

  const indexes = smartBotChoice(room, player);

  io.to(room.id).emit('quickMessage', {
    playerId: player.id,
    playerName: player.name,
    text: '⏱ ავტომატური სვლა'
  });

  applyPlay(room, player, indexes);
}

/* ---------------- TOURNAMENTS ---------------- */

const tournaments = new Map();

function createTournament(id, name, prize, startDelayMs, maxPlayers) {
  tournaments.set(id, {
    id,
    name,
    prize,
    startAt: Date.now() + startDelayMs,
    maxPlayers,
    registered: new Map(),
    status: 'registration',
    round: 0,
    matches: [],
    champion: null,
    timer: null
  });
}

createTournament('maliutka-cup', 'Maliutka Cup', '$5,000', 60 * 60 * 1000, 16);
createTournament('night-bura', 'Night Bura', '$2,500', 30 * 60 * 1000, 16);

function publicTournaments() {
  return [...tournaments.values()].map(t => ({
    id: t.id,
    name: t.name,
    prize: t.prize,
    startAt: t.startAt,
    maxPlayers: t.maxPlayers,
    registered: t.registered.size,
    status: t.status,
    round: t.round,
    champion: t.champion,
    matches: t.matches.map(match => ({
      id: match.id,
      round: match.round,
      playerNames: match.players.map(player => player.name),
      winnerName: match.winnerName || null,
      status: match.status
    }))
  }));
}

function emitTournaments() {
  io.emit('tournaments', publicTournaments());
}

function scheduleTournament(tournament) {
  if (tournament.timer) clearTimeout(tournament.timer);

  const delay = Math.max(0, tournament.startAt - Date.now());

  tournament.timer = setTimeout(() => {
    startTournament(tournament);
  }, delay);
}

function startTournament(tournament) {
  if (tournament.status !== 'registration') return;

  const entrants = [...tournament.registered.values()];

  if (entrants.length < 2) {
    tournament.status = 'cancelled';
    emitTournaments();
    return;
  }

  tournament.status = 'running';
  tournament.round = 1;

  createTournamentRound(tournament, entrants);
}

function createTournamentRound(tournament, entrants) {
  tournament.matches = [];

  const shuffled = entrants.slice();

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  /*
    Written Bura tables are 3/4 players.
    Tournament groups are therefore made in groups of up to 4.
    Single winner from each table advances.
  */
  const groups = [];

  while (shuffled.length) {
    let size = Math.min(4, shuffled.length);

    if (shuffled.length === 2) {
      /*
        Need 3-player Bura table, so one bot fills the seat.
      */
      size = 2;
    }

    groups.push(shuffled.splice(0, size));
  }

  groups.forEach((group, index) => {
    const match = {
      id: makeId('match'),
      round: tournament.round,
      players: group,
      winnerKey: null,
      winnerName: null,
      status: 'waiting',
      roomId: null
    };

    tournament.matches.push(match);

    createTournamentMatchRoom(tournament, match);
  });

  emitTournaments();
}

function createTournamentMatchRoom(tournament, match) {
  const capacity = match.players.length >= 4 ? 4 : 3;

  const room = createRoom({
    name: `${tournament.name} · R${tournament.round}`,
    capacity,
    parties: 1,
    stake: 5,
    tournamentId: tournament.id,
    tournamentMatchId: match.id
  });

  for (const entrant of match.players) {
    const user = users[entrant.userKey];

    if (!user) continue;

    room.players.push({
      id: makeId('tp'),
      socketId: null,
      userKey: entrant.userKey,
      name: user.username,
      avatar: user.avatar,
      isBot: false,
      isTester: entrant.userKey === TESTER_NAME,
      connected: false,
      tournamentReserved: true
    });
  }

  let botNumber = 1;

  while (room.players.length < capacity) {
    room.players.push({
      id: makeId('bot'),
      socketId: null,
      userKey: null,
      name: `TOUR BOT ${botNumber++}`,
      avatar: '🤖',
      isBot: true,
      isTester: false,
      connected: true
    });
  }

  match.roomId = room.id;
  match.status = 'ready';

  /*
    Give connected entrants a chance to attach.
    Bots can also keep tournament progressing if needed.
  */
  setTimeout(() => {
    if (!rooms.has(room.id) || room.game) return;

    room.game = createHand(room);
    setTurn(room, 0);
    broadcast(room);
    scheduleBot(room);
  }, 3000);
}

function tournamentMatchFinished(room, winner) {
  const tournament = tournaments.get(room.tournamentId);
  if (!tournament) return;

  const match = tournament.matches.find(
    item => item.id === room.tournamentMatchId
  );

  if (!match || match.status === 'finished') return;

  match.status = 'finished';
  match.winnerKey = winner.userKey || null;
  match.winnerName = winner.name;

  const unfinished = tournament.matches.some(
    item => item.status !== 'finished'
  );

  if (unfinished) {
    emitTournaments();
    return;
  }

  const winners = tournament.matches
    .map(item => ({
      userKey: item.winnerKey,
      name: item.winnerName
    }))
    .filter(item => item.userKey);

  if (winners.length <= 1) {
    tournament.status = 'finished';
    tournament.champion = winners[0] ? winners[0].name : null;
    emitTournaments();
    return;
  }

  tournament.round += 1;
  createTournamentRound(tournament, winners);
}

for (const tournament of tournaments.values()) {
  scheduleTournament(tournament);
}

/* ---------------- RECONNECT ---------------- */

function findPlayerByUserKey(key) {
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.userKey === key);

    if (player) {
      return { room, player };
    }
  }

  return null;
}

function reconnectPlayer(socket) {
  if (!socket.userKey) return false;

  const found = findPlayerByUserKey(socket.userKey);
  if (!found) return false;

  const { room, player } = found;

  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }

  disconnectTimers.delete(socket.userKey);

  player.socketId = socket.id;
  player.connected = true;

  socket.roomId = room.id;
  socket.playerId = player.id;

  socket.join(room.id);

  socket.emit('sessionRecovered', {
    roomId: room.id
  });

  if (room.game) {
    socket.emit(
      'gameStateUpdate',
      clientState(room, player.id, player.isTester)
    );

    broadcast(room);
  }

  return true;
}

function handleDisconnect(socket) {
  if (!socket.roomId) return;

  const room = rooms.get(socket.roomId);
  if (!room) return;

  const player = room.players.find(
    p => p.id === socket.playerId || p.socketId === socket.id
  );

  if (!player || player.isBot) return;

  player.connected = false;
  player.socketId = null;

  if (!room.game) {
    const timer = setTimeout(() => {
      const currentRoom = rooms.get(room.id);
      if (!currentRoom) return;

      const currentPlayer = currentRoom.players.find(p => p.id === player.id);

      if (currentPlayer && currentPlayer.connected === false) {
        currentRoom.players = currentRoom.players.filter(
          p => p.id !== player.id
        );

        if (!currentRoom.players.length) {
          deleteRoom(currentRoom.id);
        } else {
          emitLobby();
        }
      }
    }, RECONNECT_GRACE_MS);

    player.disconnectTimer = timer;
    return;
  }

  /*
    In active games we keep the seat.
    After 30 seconds the disconnected human becomes AI-controlled,
    but retains the same identity/score/hand.
  */
  const timer = setTimeout(() => {
    const currentRoom = rooms.get(room.id);
    if (!currentRoom || !currentRoom.game) return;

    const currentPlayer = currentRoom.players.find(p => p.id === player.id);

    if (!currentPlayer || currentPlayer.connected !== false) return;

    currentPlayer.isBot = true;
    currentPlayer.reconnectBot = true;

    broadcast(currentRoom);
    scheduleBot(currentRoom);
  }, RECONNECT_GRACE_MS);

  player.disconnectTimer = timer;

  if (socket.userKey) {
    disconnectTimers.set(socket.userKey, timer);
  }

  broadcast(room);
}

/* ---------------- SOCKETS ---------------- */

io.on('connection', socket => {
  socket.emit('lobbyTables', lobbyRooms());
  socket.emit('tournaments', publicTournaments());

  socket.on('restoreSession', async data => {
    const session = getSession(data && data.token);

    if (!session) {
      socket.emit('sessionInvalid');
      return;
    }

    socket.userKey = session.userKey;

    socket.emit(
      'authSuccess',
      {
        profile: publicProfile(users[socket.userKey]),
        token: data.token
      }
    );

    reconnectPlayer(socket);
  });

  socket.on('register', async data => {
    try {
      const username = cleanName(data && data.username);
      const password = String((data && data.password) || '');
      const key = userKey(username);

      if (username.length < 3) {
        socket.emit('authError', 'Username მინიმუმ 3 სიმბოლო უნდა იყოს.');
        return;
      }

      if (password.length < 4) {
        socket.emit('authError', 'Password მინიმუმ 4 სიმბოლო უნდა იყოს.');
        return;
      }

      if (users[key]) {
        socket.emit('authError', 'ეს Username უკვე არსებობს.');
        return;
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = await hashPassword(password, salt);

      users[key] = normalizeUser({
        username,
        salt,
        passwordHash,
        avatar: safeAvatar(data && data.avatar),
        xp: 0,
        wins: 0,
        games: 0,
        balance: START_BALANCE,
        achievements: [],
        quests: defaultQuests(),
        cardSkin: 'royal',
        tableSkin: 'emerald'
      });

      await saveUsersNow();

      socket.userKey = key;

      const token = createSession(key);

      socket.emit('authSuccess', {
        profile: publicProfile(users[key]),
        token
      });
    } catch (error) {
      console.error(error);
      socket.emit('authError', 'რეგისტრაციის შეცდომა.');
    }
  });

  socket.on('login', async data => {
    try {
      const key = userKey(data && data.username);
      const password = String((data && data.password) || '');
      const user = users[key];

      if (!user) {
        socket.emit('authError', 'Username ან Password არასწორია.');
        return;
      }

      const suppliedHash = await hashPassword(password, user.salt);

      const a = Buffer.from(suppliedHash, 'hex');
      const b = Buffer.from(user.passwordHash, 'hex');

      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        socket.emit('authError', 'Username ან Password არასწორია.');
        return;
      }

      socket.userKey = key;

      const token = createSession(key);

      socket.emit('authSuccess', {
        profile: publicProfile(user),
        token
      });

      reconnectPlayer(socket);
    } catch (error) {
      console.error(error);
      socket.emit('authError', 'შესვლის შეცდომა.');
    }
  });

  socket.on('testerLogin', async () => {
    let user = users[TESTER_NAME];

    if (!user) {
      const salt = crypto.randomBytes(16).toString('hex');

      user = users[TESTER_NAME] = normalizeUser({
        username: TESTER_NAME,
        salt,
        passwordHash: await hashPassword('test', salt),
        avatar: '😎',
        xp: 0,
        wins: 0,
        games: 0,
        balance: START_BALANCE,
        achievements: [],
        quests: defaultQuests(),
        cardSkin: 'royal',
        tableSkin: 'emerald'
      });

      await saveUsersNow();
    }

    socket.userKey = TESTER_NAME;

    const token = createSession(TESTER_NAME);

    socket.emit('authSuccess', {
      profile: publicProfile(user),
      token
    });

    reconnectPlayer(socket);
  });

  socket.on('updateCosmetics', data => {
    if (!socket.userKey || !users[socket.userKey]) return;

    const user = normalizeUser(users[socket.userKey]);

    if (['royal', 'midnight', 'ruby'].includes(data && data.cardSkin)) {
      user.cardSkin = data.cardSkin;
    }

    if (['emerald', 'midnight', 'royal'].includes(data && data.tableSkin)) {
      user.tableSkin = data.tableSkin;
    }

    scheduleSave();
    emitProfile(socket.userKey);
  });

  socket.on('joinTable', data => {
    if (socket.roomId) return;

    const user = socket.userKey ? users[socket.userKey] : null;
    const name = user
      ? user.username
      : cleanName(data && data.name) || `Guest${crypto.randomInt(1000, 9999)}`;

    const capacity = ALLOWED_CAPACITIES.includes(Number(data && data.capacity))
      ? Number(data.capacity)
      : 3;

    const parties = Math.max(
      1,
      Math.min(4, Number(data && data.parties) || 1)
    );

    const stake = ALLOWED_STAKES.includes(Number(data && data.stake))
      ? Number(data.stake)
      : 5;

    let room = data && data.roomId
      ? rooms.get(String(data.roomId))
      : null;

    if (
      !room ||
      room.game ||
      room.players.length >= room.capacity
    ) {
      room = [...rooms.values()].find(r =>
        !r.game &&
        !r.tournamentId &&
        r.capacity === capacity &&
        r.parties === parties &&
        r.stake === stake &&
        r.players.length < r.capacity
      );
    }

    if (!room) {
      room = createRoom({
        name: cleanName(data && data.tableName) || `${name} Table`,
        capacity,
        parties,
        stake
      });
    }

    const player = {
      id: socket.id,
      socketId: socket.id,
      userKey: socket.userKey || null,
      name,
      avatar: user ? user.avatar : AVATARS[0],
      isBot: false,
      isTester: userKey(name) === TESTER_NAME,
      connected: true
    };

    room.players.push(player);

    socket.roomId = room.id;
    socket.playerId = player.id;
    socket.join(room.id);

    if (socket.userKey) {
      updateQuest(socket.userKey, 'tables');
    }

    if (player.isTester) {
      let botNumber = 1;

      while (room.players.length < room.capacity) {
        room.players.push({
          id: makeId('bot'),
          socketId: null,
          userKey: null,
          name: `BOT ${botNumber++}`,
          avatar: '🤖',
          isBot: true,
          isTester: false,
          connected: true
        });
      }
    }

    emitLobby();

    if (room.players.length === room.capacity) {
      room.game = createHand(room);
      setTurn(room, 0);

      broadcast(room);
      io.to(room.id).emit('dealAnimation');
      io.to(room.id).emit('sfxEvent', { type: 'deal' });

      scheduleBot(room);
    } else {
      io.to(room.id).emit('waitingForPlayers', {
        current: room.players.length,
        max: room.capacity
      });
    }
  });

  socket.on('joinTournamentRoom', data => {
    if (!socket.userKey) return;

    const tournament = tournaments.get(String(data && data.tournamentId));
    if (!tournament) return;

    const match = tournament.matches.find(
      m => m.players.some(p => p.userKey === socket.userKey)
    );

    if (!match || !match.roomId) return;

    const room = rooms.get(match.roomId);
    if (!room) return;

    const player = room.players.find(
      p => p.userKey === socket.userKey
    );

    if (!player) return;

    player.socketId = socket.id;
    player.connected = true;

    if (player.reconnectBot) {
      player.isBot = false;
      player.reconnectBot = false;
    }

    socket.roomId = room.id;
    socket.playerId = player.id;
    socket.join(room.id);

    if (room.game) {
      socket.emit(
        'gameStateUpdate',
        clientState(room, player.id, player.isTester)
      );
    }
  });

  socket.on('playCards', data => {
    const room = socket.roomId ? rooms.get(socket.roomId) : null;
    if (!room || !room.game) return;

    const currentPlayer = room.players[room.game.currentTurnIndex];

    if (!currentPlayer || currentPlayer.id !== socket.playerId) {
      socket.emit('errorMessage', 'ახლა შენი სვლა არ არის.');
      return;
    }

    const hand = room.game.hands[currentPlayer.id] || [];

    const indexes = Array.isArray(data && data.cardIndices)
      ? [...new Set(data.cardIndices)]
        .filter(index =>
          Number.isInteger(index) &&
          index >= 0 &&
          index < hand.length
        )
        .sort((a, b) => a - b)
      : [];

    const result = applyPlay(room, currentPlayer, indexes);

    if (!result.ok) {
      socket.emit('errorMessage', result.message);
    }
  });

  socket.on('quickMessage', data => {
    const room = socket.roomId ? rooms.get(socket.roomId) : null;
    if (!room) return;

    const player = room.players.find(p => p.id === socket.playerId);
    if (!player) return;

    const text = String((data && data.text) || '').slice(0, 60);

    if (!QUICK_MESSAGES.includes(text)) return;

    io.to(room.id).emit('quickMessage', {
      playerId: player.id,
      playerName: player.name,
      text
    });
  });

  socket.on('throwable', data => {
    const room = socket.roomId ? rooms.get(socket.roomId) : null;
    if (!room) return;

    const from = room.players.find(p => p.id === socket.playerId);
    const target = room.players.find(
      p => p.id === String((data && data.targetPlayerId) || '')
    );

    const type = String((data && data.type) || '');

    if (
      !from ||
      !target ||
      from.id === target.id ||
      !THROWABLES.includes(type)
    ) {
      return;
    }

    io.to(room.id).emit('throwableEvent', {
      fromPlayerId: from.id,
      targetPlayerId: target.id,
      type
    });
  });

  socket.on('registerTournament', data => {
    if (!socket.userKey || !users[socket.userKey]) {
      socket.emit('errorMessage', 'ჯერ შედი პროფილში.');
      return;
    }

    const tournament = tournaments.get(String(data && data.id));

    if (!tournament || tournament.status !== 'registration') {
      socket.emit('errorMessage', 'რეგისტრაცია დახურულია.');
      return;
    }

    if (tournament.registered.size >= tournament.maxPlayers) {
      socket.emit('errorMessage', 'ტურნირი შევსებულია.');
      return;
    }

    tournament.registered.set(socket.userKey, {
      userKey: socket.userKey,
      name: users[socket.userKey].username
    });

    socket.emit('tournamentRegistered', {
      id: tournament.id
    });

    emitTournaments();
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    cards: 36,
    rooms: rooms.size,
    users: Object.keys(users).length,
    tester: TESTER_NAME,
    turnSeconds: TURN_SECONDS
  });
});

async function shutdown() {
  for (const room of rooms.values()) {
    clearRoomTimers(room);
  }

  for (const tournament of tournaments.values()) {
    if (tournament.timer) clearTimeout(tournament.timer);
  }

  for (const timer of disconnectTimers.values()) {
    clearTimeout(timer);
  }

  await saveUsersNow();

  server.close(() => process.exit(0));

  setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

loadUsers()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Written Bura running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
