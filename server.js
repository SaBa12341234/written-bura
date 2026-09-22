'use strict';

/*
  ============================================================
  WRITTEN BURA v2 — MONOLITHIC server.js
  Express 5 / Socket.IO / Render ready
  ============================================================

  Install:        npm install express socket.io
  Start command:  node server.js   (or "npm start")

  Optional environment variables:
    PORT         — port (Render sets it automatically)
    USERS_FILE   — path of the users JSON file
    TESTER_MODE  — set to "off" to disable the passwordless
                   saba123 test login (recommended in production)

  public/ folder is NOT required — the whole UI lives in PAGE.
  No Express 5 incompatible wildcard routes are used.
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
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'users.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* ============================================================
   CONFIG
   ============================================================ */

const TESTER_NAME = 'saba123';
const TESTER_ENABLED = process.env.TESTER_MODE !== 'off';
const START_BALANCE = 1000;
const START_COINS = 300;
const TURN_SECONDS = 20;
const RECONNECT_MS = 30000;
const TRICK_CLEAR_DELAY = 1800;

const RANK_TIERS = [
  { name: 'Bronze', icon: '🥉', min: 0 },
  { name: 'Silver', icon: '🥈', min: 1000 },
  { name: 'Gold', icon: '🥇', min: 1200 },
  { name: 'Platinum', icon: '💠', min: 1400 },
  { name: 'Diamond', icon: '👑', min: 1600 }
];

const CAPACITIES = [3, 4];
const STAKES = [5, 10, 25, 50, 100];
const MAX_PARTIES = 4;

const VALUES = { '6': 0, '7': 0, '8': 0, '9': 0, 'J': 2, 'Q': 3, 'K': 4, '10': 10, 'A': 11 };
const RANKS = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
const TRUMPS = ['spades', 'clubs', 'diamonds', 'hearts', 'no_trump'];

const QUICK_PHRASES = [
  'სიქიიიიიმ!',
  'ყვერო, მალე!',
  'რას შვრები, ძმაო?!',
  'ვაჰ, კოზირი!',
  '⚡ სწრაფად!',
  '👍 კარგი იყო',
  '😂 ჰაჰაჰა',
  '🤝 კარგი თამაში',
  '😱 ეს რა იყო?!',
  '🙏 იღბალი მჭირდება'
];

/* ============================================================
   SHOP CATALOG (virtual coins only — cosmetics, never cash)
   ============================================================ */

function item(type, key, name, price, rarity, extra) {
  return Object.assign(
    { id: type + '_' + key, type: type, key: key, name: name, price: price, rarity: rarity },
    extra || {}
  );
}

const GOLD = 'rgba(229,189,97,.22)';

const SHOP_ITEMS = [
  /* ---------- TABLE FELTS ---------- */
  item('felt', 'classic', 'კლასიკური მწვანე', 0, 'common', { colors: ['#12704a', '#063623'] }),
  item('felt', 'royal', 'სამეფო ლურჯი', 0, 'common', { colors: ['#1d4f8c', '#0a2345'] }),
  item('felt', 'wine', 'ღვინისფერი', 0, 'common', { colors: ['#7a1a31', '#360612'] }),
  item('felt', 'violet', 'იისფერი', 0, 'common', { colors: ['#4d2b7a', '#1e0f38'] }),
  item('felt', 'obsidian', 'ობსიდიანი', 0, 'common', { colors: ['#2e2e34', '#09090b'] }),
  item('felt', 'emerald', 'ზურმუხტის რომბები', 200, 'rare', { colors: ['#0f8a5e', '#03402a'], pattern: 'diamond' }),
  item('felt', 'carbon', 'კარბონი', 250, 'rare', { colors: ['#2a2d31', '#0c0d0f'], pattern: 'stripes' }),
  item('felt', 'ocean', 'ოკეანე', 250, 'rare', { colors: ['#0f6f8c', '#052c42'], pattern: 'waves' }),
  item('felt', 'sunset', 'მზის ჩასვლა', 300, 'rare', { colors: ['#a8462e', '#4a1030'] }),
  item('felt', 'neon', 'ნეონის ბადე', 300, 'rare', { colors: ['#0d4a58', '#2a0d4a'], pattern: 'grid', pc: 'rgba(0,229,255,.16)' }),
  item('felt', 'desert', 'უდაბნო', 300, 'rare', { colors: ['#9a7440', '#4a3216'], pattern: 'dots' }),
  item('felt', 'sakura', 'საკურა', 400, 'epic', { colors: ['#a0516c', '#461a2c'], pattern: 'dots', pc: 'rgba(255,200,220,.18)' }),
  item('felt', 'arctic', 'არქტიკა', 400, 'epic', { colors: ['#4f7f99', '#172f42'], pattern: 'hex' }),
  item('felt', 'lava', 'ლავა', 500, 'epic', { colors: ['#7a200a', '#1f0400'], pattern: 'lava' }),
  item('felt', 'rosegold', 'ვარდისფერი ოქრო', 500, 'epic', { colors: ['#7a4a4e', '#2e1a1c'], pattern: 'damask', pc: GOLD }),
  item('felt', 'galaxy', 'გალაქტიკა', 600, 'epic', { colors: ['#2a1462', '#06051a'], pattern: 'stars' }),
  item('felt', 'aurora', 'ჩრდილოეთის ციალი', 900, 'legendary', { colors: ['#0b3d3a', '#0a0f2a'], pattern: 'aurora' }),
  item('felt', 'tbilisi', 'ძველი თბილისი', 1200, 'legendary', { colors: ['#5a1420', '#1f050a'], pattern: 'ornament', pc: GOLD }),
  item('felt', 'midnight', 'შუაღამის ოქრო', 1500, 'legendary', { colors: ['#1b1b33', '#050510'], pattern: 'damask', pc: 'rgba(229,189,97,.3)' }),

  /* ---------- CARD BACKS ---------- */
  item('cardback', 'blue', 'კლასიკური ლურჯი', 0, 'common', { colors: ['#1e428f', '#0b1c4a'], pattern: 'diamond', emblem: '♠' }),
  item('cardback', 'red', 'კლასიკური წითელი', 0, 'common', { colors: ['#a01d2c', '#4a0810'], pattern: 'diamond', emblem: '♥' }),
  item('cardback', 'green', 'ზურმუხტი', 150, 'common', { colors: ['#15704c', '#053520'], pattern: 'dots', emblem: '♣' }),
  item('cardback', 'marble', 'მარმარილო', 250, 'rare', { colors: ['#ece8df', '#b6afa2'], pattern: 'waves', pc: 'rgba(0,0,0,.08)', emblem: '♦', dark: true }),
  item('cardback', 'tartan', 'შოტლანდიური', 250, 'rare', { colors: ['#1f4d3a', '#6e1818'], pattern: 'tartan', emblem: '♣' }),
  item('cardback', 'carbon', 'შავი კარბონი', 300, 'rare', { colors: ['#2b2b2b', '#0a0a0a'], pattern: 'stripes', pc: GOLD, emblem: '♠' }),
  item('cardback', 'neon', 'ნეონი', 350, 'rare', { colors: ['#14103a', '#05051a'], pattern: 'grid', pc: 'rgba(255,0,229,.28)', emblem: '⚡' }),
  item('cardback', 'galaxy', 'გალაქტიკა', 450, 'epic', { colors: ['#2a1262', '#07051c'], pattern: 'stars', emblem: '✦' }),
  item('cardback', 'lattice', 'ოქროს ბადე', 500, 'epic', { colors: ['#2e2314', '#0f0b05'], pattern: 'grid', pc: GOLD, emblem: '♛' }),
  item('cardback', 'ornament', 'ქართული ორნამენტი', 700, 'epic', { colors: ['#6b1420', '#2a040a'], pattern: 'ornament', pc: GOLD, emblem: '✠' }),
  item('cardback', 'dragon', 'დრაკონის ქერცლი', 1000, 'legendary', { colors: ['#5c0b0b', '#120202'], pattern: 'scales', pc: GOLD, emblem: '🐉' }),
  item('cardback', 'royal', 'სამეფო', 1300, 'legendary', { colors: ['#1c1548', '#070519'], pattern: 'ornament', pc: 'rgba(229,189,97,.3)', emblem: '👑' }),

  /* ---------- AVATAR FRAMES ---------- */
  item('frame', 'none', 'უჩარჩოო', 0, 'common', { colors: ['#b8923f', '#6e5220', '#b8923f'] }),
  item('frame', 'bronze', 'ბრინჯაო', 150, 'common', { colors: ['#e7ab72', '#7a4a20', '#e7ab72', '#7a4a20'] }),
  item('frame', 'silver', 'ვერცხლი', 250, 'rare', { colors: ['#ffffff', '#8e8e9c', '#ffffff', '#8e8e9c'] }),
  item('frame', 'gold', 'ოქრო', 400, 'rare', { colors: ['#fff3b0', '#b8860b', '#fff3b0', '#b8860b'] }),
  item('frame', 'emerald', 'ზურმუხტი', 450, 'rare', { colors: ['#b4ffd9', '#0b7a52', '#b4ffd9', '#0b7a52'] }),
  item('frame', 'ruby', 'ლალი', 450, 'rare', { colors: ['#ffb3bd', '#9b0f22', '#ffb3bd', '#9b0f22'] }),
  item('frame', 'sapphire', 'საფირონი', 450, 'rare', { colors: ['#b3d4ff', '#123f9b', '#b3d4ff', '#123f9b'] }),
  item('frame', 'diamond', 'ბრილიანტი', 700, 'epic', { colors: ['#ffffff', '#7be0e6', '#ffffff', '#b58cff', '#ffffff'], anim: true }),
  item('frame', 'fire', 'ცეცხლი', 900, 'epic', { colors: ['#ffe066', '#ff6a00', '#d90000', '#ff6a00', '#ffe066'], anim: true }),
  item('frame', 'ice', 'ყინული', 900, 'epic', { colors: ['#ffffff', '#8fe3ff', '#2f86d6', '#8fe3ff', '#ffffff'], anim: true }),
  item('frame', 'rainbow', 'ცისარტყელა', 1200, 'legendary', { colors: ['#ff3b3b', '#ffb13b', '#f6ff3b', '#3bff7a', '#3bc4ff', '#8a3bff', '#ff3b3b'], anim: true }),
  item('frame', 'royal', 'სამეფო გვირგვინი', 1500, 'legendary', { colors: ['#fff3b0', '#6b2bd1', '#fff3b0', '#6b2bd1', '#fff3b0'], anim: true }),

  /* ---------- AVATARS ---------- */
  item('avatar', 'fox', 'მელა', 0, 'common', { emoji: '🦊' }),
  item('avatar', 'cool', 'მაგარი ტიპი', 0, 'common', { emoji: '😎' }),
  item('avatar', 'lion', 'ლომი', 0, 'common', { emoji: '🦁' }),
  item('avatar', 'wolf', 'მგელი', 0, 'common', { emoji: '🐺' }),
  item('avatar', 'king', 'მეფე', 0, 'common', { emoji: '👑' }),
  item('avatar', 'wizard', 'ჯადოქარი', 0, 'common', { emoji: '🧙' }),
  item('avatar', 'tiger', 'ვეფხვი', 150, 'common', { emoji: '🐯' }),
  item('avatar', 'bear', 'დათვი', 150, 'common', { emoji: '🐻' }),
  item('avatar', 'panda', 'პანდა', 150, 'common', { emoji: '🐼' }),
  item('avatar', 'beard', 'წვეროსანი', 200, 'common', { emoji: '🧔' }),
  item('avatar', 'eagle', 'არწივი', 250, 'rare', { emoji: '🦅' }),
  item('avatar', 'shark', 'ზვიგენი', 250, 'rare', { emoji: '🦈' }),
  item('avatar', 'octopus', 'რვაფეხა', 250, 'rare', { emoji: '🐙' }),
  item('avatar', 'cowboy', 'კოვბოი', 300, 'rare', { emoji: '🤠' }),
  item('avatar', 'detective', 'დეტექტივი', 350, 'rare', { emoji: '🕵️' }),
  item('avatar', 'princess', 'პრინცესა', 350, 'rare', { emoji: '👸' }),
  item('avatar', 'ninja', 'ნინძა', 400, 'epic', { emoji: '🥷' }),
  item('avatar', 'vampire', 'ვამპირი', 400, 'epic', { emoji: '🧛' }),
  item('avatar', 'genie', 'ჯინი', 450, 'epic', { emoji: '🧞' }),
  item('avatar', 'alien', 'უცხოპლანეტელი', 450, 'epic', { emoji: '👽' }),
  item('avatar', 'unicorn', 'მარტორქა', 600, 'epic', { emoji: '🦄' }),
  item('avatar', 'dragon', 'დრაკონი', 900, 'legendary', { emoji: '🐉' }),
  item('avatar', 'phoenix', 'ფენიქსი', 1200, 'legendary', { emoji: '🐦‍🔥' }),

  /* ---------- THROWABLES ---------- */
  item('throwable', 'tomato', 'პომიდორი', 0, 'common', { emoji: '🍅' }),
  item('throwable', 'egg', 'კვერცხი', 0, 'common', { emoji: '🥚' }),
  item('throwable', 'paper', 'ტუალეტის ქაღალდი', 0, 'common', { emoji: '🧻' }),
  item('throwable', 'beer', 'ლუდი', 0, 'common', { emoji: '🍺' }),
  item('throwable', 'rose', 'ვარდი', 0, 'common', { emoji: '🌹' }),
  item('throwable', 'ice', 'ყინული', 0, 'common', { emoji: '🧊' }),
  item('throwable', 'bomb', 'ბომბი', 0, 'common', { emoji: '💣' }),
  item('throwable', 'pie', 'ნამცხვარი სახეში', 150, 'common', { emoji: '🥧' }),
  item('throwable', 'kiss', 'კოცნა', 150, 'common', { emoji: '💋' }),
  item('throwable', 'balloon', 'წყლის ბუშტი', 200, 'rare', { emoji: '🎈' }),
  item('throwable', 'khinkali', 'ხინკალი', 250, 'rare', { emoji: '🥟' }),
  item('throwable', 'slipper', 'დედის ჩუსტი', 250, 'rare', { emoji: '🩴' }),
  item('throwable', 'fish', 'თევზის შემოკვრა', 250, 'rare', { emoji: '🐟' }),
  item('throwable', 'heart', 'გული', 300, 'rare', { emoji: '💖' }),
  item('throwable', 'money', 'ფულის წვიმა', 450, 'epic', { emoji: '💸' }),
  item('throwable', 'lightning', 'ელვა', 500, 'epic', { emoji: '⚡' }),
  item('throwable', 'fireworks', 'ფეიერვერკი', 600, 'epic', { emoji: '🎆' }),
  item('throwable', 'crown', 'გვირგვინი', 900, 'legendary', { emoji: '👑' }),

  /* ---------- TITLES ---------- */
  item('title', 'none', 'უტიტულო', 0, 'common', { text: '' }),
  item('title', 'rookie', 'დამწყები', 100, 'common', { text: 'დამწყები' }),
  item('title', 'tbilisian', 'თბილისელი', 150, 'common', { text: 'თბილისელი' }),
  item('title', 'coolhead', 'ცივი თავი', 200, 'common', { text: 'ცივი თავი' }),
  item('title', 'lucky', 'ბედის ნებიერი', 300, 'rare', { text: 'ბედის ნებიერი' }),
  item('title', 'cutter', 'ჭრის ოსტატი', 350, 'rare', { text: 'ჭრის ოსტატი' }),
  item('title', 'nightwolf', 'ღამის მგელი', 400, 'rare', { text: 'ღამის მგელი' }),
  item('title', 'trumpmaster', 'კოზირის ოსტატი', 500, 'epic', { text: 'კოზირის ოსტატი' }),
  item('title', 'maliutka', 'მალიუტკის ლეგენდა', 700, 'epic', { text: 'მალიუტკის ლეგენდა' }),
  item('title', 'grandmaster', 'დიდოსტატი', 1000, 'legendary', { text: 'დიდოსტატი' }),
  item('title', 'burakingg', 'ბურას მეფე', 1500, 'legendary', { text: 'ბურას მეფე' }),

  /* ---------- VICTORY EFFECTS ---------- */
  item('effect', 'confetti', 'კონფეტი', 0, 'common', { emoji: '🎊' }),
  item('effect', 'stars', 'ვარსკვლავები', 300, 'rare', { emoji: '✨' }),
  item('effect', 'petals', 'ვარდის ფურცლები', 350, 'rare', { emoji: '🌸' }),
  item('effect', 'fireworks', 'ფეიერვერკი', 500, 'epic', { emoji: '🎆' }),
  item('effect', 'coinrain', 'მონეტების წვიმა', 700, 'legendary', { emoji: '🪙' })
];

const SHOP_TYPES = ['felt', 'cardback', 'frame', 'avatar', 'throwable', 'title', 'effect'];

const DEFAULT_EQUIP = {
  felt: 'classic',
  cardback: 'blue',
  frame: 'none',
  title: 'none',
  effect: 'confetti'
};

function shopItem(type, key) {
  return SHOP_ITEMS.find(function (i) { return i.type === type && i.key === key; }) || null;
}

function freeKeys(type) {
  return SHOP_ITEMS
    .filter(function (i) { return i.type === type && i.price === 0; })
    .map(function (i) { return i.key; });
}

const rooms = new Map();
const users = new Map();
const sessions = new Map();

const scryptAsync = promisify(crypto.scrypt);

let saveTimer = null;

/* ============================================================
   HELPERS
   ============================================================ */

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(5).toString('hex');
}

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function lower(value) {
  return clean(value).toLowerCase();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isTester(name) {
  return TESTER_ENABLED && lower(name) === TESTER_NAME.toLowerCase();
}

function rankOf(rating) {
  let tier = RANK_TIERS[0];
  RANK_TIERS.forEach(function (candidate) {
    if (rating >= candidate.min) tier = candidate;
  });
  return tier;
}

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / msPerDay);
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
    rewards: { wins: false, maliutka: false, tables: false }
  };
}

function defaults(user) {
  user.avatar = user.avatar || '🦊';
  user.xp = Number(user.xp || 0);
  user.level = Math.floor(user.xp / 100) + 1;
  user.wins = Number(user.wins || 0);
  user.balance = Number(user.balance === undefined ? START_BALANCE : user.balance);
  user.achievements = Array.isArray(user.achievements) ? user.achievements : [];

  if (!user.quests || user.quests.date !== today()) {
    user.quests = defaultQuests();
  }

  user.rating = Number(user.rating === undefined ? 1000 : user.rating);
  user.coins = Number(user.coins === undefined ? START_COINS : user.coins);

  /* Inventory (with migration from the v1 felts/frames format). */
  const inv = user.inventory && typeof user.inventory === 'object' ? user.inventory : {};

  if (Array.isArray(inv.felts)) {
    inv.felt = (Array.isArray(inv.felt) ? inv.felt : []).concat(inv.felts);
    delete inv.felts;
  }

  if (Array.isArray(inv.frames)) {
    inv.frame = (Array.isArray(inv.frame) ? inv.frame : []).concat(inv.frames);
    delete inv.frames;
  }

  SHOP_TYPES.forEach(function (type) {
    const list = Array.isArray(inv[type]) ? inv[type] : [];
    inv[type] = Array.from(new Set(list.concat(freeKeys(type)))).filter(function (key) {
      return !!shopItem(type, key);
    });
  });

  user.inventory = inv;

  const eq = user.equipped && typeof user.equipped === 'object' ? user.equipped : {};

  Object.keys(DEFAULT_EQUIP).forEach(function (slot) {
    if (!eq[slot] || inv[slot].indexOf(eq[slot]) < 0) {
      eq[slot] = DEFAULT_EQUIP[slot];
    }
  });

  user.equipped = eq;

  user.stats = user.stats && typeof user.stats === 'object' ? user.stats : {};
  user.stats.handsPlayed = Number(user.stats.handsPlayed || 0);
  user.stats.handsWon = Number(user.stats.handsWon || 0);
  user.stats.partiesPlayed = Number(user.stats.partiesPlayed || 0);
  user.stats.partiesWon = Number(user.stats.partiesWon || 0);
  user.stats.biggestWin = Number(user.stats.biggestWin || 0);
  user.stats.winStreak = Number(user.stats.winStreak || 0);
  user.stats.bestWinStreak = Number(user.stats.bestWinStreak || 0);
  user.stats.maliutkas = Number(user.stats.maliutkas || 0);
  user.stats.recentParties = Array.isArray(user.stats.recentParties) ? user.stats.recentParties.slice(-20) : [];

  user.friends = Array.isArray(user.friends) ? user.friends : [];
  user.loginStreak = Number(user.loginStreak || 0);
  user.lastLoginDate = user.lastLoginDate || null;
  user.lastChest = user.lastChest || null;
  user.selfExcludedUntil = user.selfExcludedUntil || null;
  user.language = user.language || 'ka';

  return user;
}

function profile(user) {
  defaults(user);

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    xp: user.xp,
    level: user.level,
    wins: user.wins,
    balance: user.balance,
    quests: user.quests,
    achievements: user.achievements,
    rating: user.rating,
    rank: rankOf(user.rating),
    coins: user.coins,
    inventory: user.inventory,
    equipped: user.equipped,
    stats: user.stats,
    friends: user.friends,
    loginStreak: user.loginStreak,
    chestReady: user.lastChest !== today(),
    selfExcludedUntil: user.selfExcludedUntil,
    language: user.language,
    tester: !!user.tester
  };
}

function pushProfile(user) {
  if (user && user.socketId) {
    io.to(user.socketId).emit('profileUpdate', profile(user));
  }
}

function findUser(username) {
  const name = lower(username);
  return Array.from(users.values()).find(function (user) {
    return lower(user.username) === name;
  }) || null;
}

async function passwordHash(password, salt) {
  const result = await scryptAsync(String(password), salt, 64);
  return Buffer.from(result).toString('hex');
}

async function makePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt: salt, hash: await passwordHash(password, salt) };
}

async function checkPassword(password, user) {
  try {
    if (!user.passwordSalt || !user.passwordHash) return false;
    const value = await passwordHash(password, user.passwordSalt);
    const a = Buffer.from(value, 'hex');
    const b = Buffer.from(user.passwordHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (error) {
    return false;
  }
}

function validAvatar(value) {
  const avatar = String(value || '');

  if (!avatar) return '🦊';

  /* Short emoji-like values only — no markup characters. */
  if (avatar.length <= 16 && !/[<>"'&]/.test(avatar)) return avatar;

  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(avatar) && avatar.length < 700000) {
    return avatar;
  }

  return '🦊';
}

async function loadUsers() {
  try {
    const raw = await fs.promises.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.users || [];

    list.forEach(function (user) {
      if (user && user.id && user.username) {
        delete user.socketId;
        delete user.roomId;
        defaults(user);
        users.set(user.id, user);
      }
    });

    console.log('[USERS] loaded:', users.size);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[USERS] load error:', error.message);
    }
  }
}

async function saveUsersNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const list = Array.from(users.values()).map(function (user) {
    const copy = Object.assign({}, user);
    delete copy.socketId;
    delete copy.roomId;
    return copy;
  });

  try {
    const tmp = USERS_FILE + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify({ users: list }, null, 2), 'utf8');
    await fs.promises.rename(tmp, USERS_FILE);
  } catch (error) {
    console.error('[USERS] save error:', error.message);
  }
}

function saveLater() {
  if (saveTimer) clearTimeout(saveTimer);

  saveTimer = setTimeout(function () {
    saveTimer = null;
    saveUsersNow().catch(function (error) { console.error(error); });
  }, 4000);
}

function friendSummary(user) {
  if (!user) return null;
  defaults(user);

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    level: user.level,
    rating: user.rating,
    rank: rankOf(user.rating),
    frame: user.equipped.frame,
    title: user.equipped.title,
    online: !!user.socketId
  };
}

function applyLoginStreak(user) {
  defaults(user);

  const key = today();

  if (user.lastLoginDate === key) return 0;

  const diff = user.lastLoginDate ? daysBetween(user.lastLoginDate, key) : null;

  user.loginStreak = diff === 1 ? user.loginStreak + 1 : 1;
  user.lastLoginDate = key;

  const bonus = Math.min(200, 20 * user.loginStreak);
  user.coins = Number(user.coins || 0) + bonus;

  saveLater();

  return bonus;
}

function isExcluded(user) {
  if (!user || !user.selfExcludedUntil) return false;
  if (user.selfExcludedUntil === 'forever') return true;
  return new Date(user.selfExcludedUntil).getTime() > Date.now();
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
  pushProfile(user);
}

function checkQuests(user) {
  defaults(user);

  const quest = user.quests;
  let bonus = 0;

  if (quest.wins >= 3 && !quest.rewards.wins) {
    quest.rewards.wins = true;
    bonus += 100;
  }

  if (quest.maliutka >= 1 && !quest.rewards.maliutka) {
    quest.rewards.maliutka = true;
    bonus += 250;
  }

  if (quest.tables >= 5 && !quest.rewards.tables) {
    quest.rewards.tables = true;
    bonus += 50;
  }

  if (bonus) {
    user.coins += Math.round(bonus / 2);
    addXP(user, bonus);
  }

  saveLater();
}

function playedTable(user, roomId) {
  if (!user) return;
  defaults(user);

  if (!user.quests.tableIds.includes(roomId)) {
    user.quests.tableIds.push(roomId);
    user.quests.tables += 1;
    checkQuests(user);
  }
}

/* ============================================================
   CARDS
   ============================================================ */

function canonicalDeck() {
  const cards = [];
  SUITS.forEach(function (suit) {
    RANKS.forEach(function (rankName) {
      cards.push({ id: uid('card'), suit: suit, rank: rankName });
    });
  });
  return cards;
}

/*
  Deterministic byte stream derived from a seed via chained
  SHA-256 hashing — the same seed always produces the same
  shuffle, so a revealed seed can be independently verified.
*/
function seedStream(seed) {
  let block = crypto.createHash('sha256').update(String(seed)).digest();
  let cursor = 0;

  return function nextByte() {
    if (cursor >= block.length) {
      block = crypto.createHash('sha256').update(block).digest();
      cursor = 0;
    }
    return block[cursor++];
  };
}

function seededShuffle(cards, seed) {
  const nextByte = seedStream(seed);
  const arr = cards.slice();

  for (let i = arr.length - 1; i > 0; i--) {
    /* 16-bit value keeps the modulo bias negligible. */
    const j = ((nextByte() << 8) | nextByte()) % (i + 1);
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }

  return arr;
}

function makeFairness(room, handIndex) {
  const seed = crypto.randomBytes(32).toString('hex');
  const seedInput = seed + ':' + room.id + ':' + handIndex;
  const hash = crypto.createHash('sha256').update(seedInput).digest('hex');

  return { seed: seed, hash: hash, seedInput: seedInput, revealed: false };
}

function cardPoints(card) {
  return VALUES[card.rank] || 0;
}

function rankIndex(card) {
  return RANKS.indexOf(card.rank);
}

function isTrump(card, trump) {
  return trump !== 'no_trump' && card.suit === trump;
}

function sameSuit(cards) {
  return cards.length > 0 && cards.every(function (card) {
    return card.suit === cards[0].suit;
  });
}

function isMaliutka(cards) {
  return cards.length === 5 && sameSuit(cards);
}

/* ============================================================
   BURA CUTTING LOGIC
   ============================================================ */

/* defender = current winning card, attacker = new card.
   true => attacker beats defender. */
function cardBeats(defender, attacker, trump) {
  const defenderTrump = isTrump(defender, trump);
  const attackerTrump = isTrump(attacker, trump);

  if (attackerTrump && !defenderTrump) return true;
  if (defenderTrump && !attackerTrump) return false;
  if (defender.suit !== attacker.suit) return false;

  return rankIndex(attacker) > rankIndex(defender);
}

/*
  Every attacker card must beat a distinct defender card
  (bipartite matching with backtracking). Works with mixed
  suits in the response — each card is matched individually.
*/
function canBeatSet(defenders, attackers, trump) {
  if (!Array.isArray(defenders) || !Array.isArray(attackers) || defenders.length !== attackers.length) {
    return false;
  }

  const used = new Array(attackers.length).fill(false);

  const orderedDefenders = defenders.slice().sort(function (a, b) {
    const at = isTrump(a, trump) ? 1 : 0;
    const bt = isTrump(b, trump) ? 1 : 0;
    if (at !== bt) return bt - at;
    return rankIndex(b) - rankIndex(a);
  });

  function search(index) {
    if (index >= orderedDefenders.length) return true;

    const defender = orderedDefenders[index];

    for (let i = 0; i < attackers.length; i++) {
      if (used[i] || !cardBeats(defender, attackers[i], trump)) continue;
      used[i] = true;
      if (search(index + 1)) return true;
      used[i] = false;
    }

    return false;
  }

  return search(0);
}

function winnerIndex(table, trump) {
  if (!table.length) return -1;

  let winner = 0;

  for (let i = 1; i < table.length; i++) {
    if (canBeatSet(table[winner].cards, table[i].cards, trump)) {
      winner = i;
    }
  }

  return winner;
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
  broadcastLobby();

  return room;
}

function createHumanPlayer(user, socket, guestName) {
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

const BOT_NAMES = ['გიორგი', 'ნიკა', 'ლევანი', 'დათო', 'სანდრო', 'ბექა', 'ზურა', 'თამუნა', 'ნინო', 'მარიამი'];
const BOT_AVATARS = ['🧔', '🐻', '🦅', '🤠', '🐯', '🐺', '🦈', '👸'];

function pickBotName(room) {
  const taken = room ? room.players.map(function (p) { return p.name; }) : [];
  const free = BOT_NAMES.filter(function (n) { return taken.indexOf(n + ' 🤖') < 0; });
  const list = free.length ? free : BOT_NAMES;
  return list[rand(0, list.length - 1)] + ' 🤖';
}

function createBot(number, room) {
  return {
    id: uid('bot'),
    userId: null,
    name: pickBotName(room),
    avatar: BOT_AVATARS[rand(0, BOT_AVATARS.length - 1)],
    socketId: null,
    isBot: true,
    connected: true,
    hand: [],
    captured: [],
    total: 0,
    lastRaw: 0,
    xp: 0,
    level: rand(2, 12),
    wins: 0,
    botNumber: number,
    reconnectTimer: null
  };
}

function userOf(player) {
  if (!player || !player.userId) return null;
  return users.get(player.userId) || null;
}

function fillBots(room) {
  let number = 1;
  while (room.players.length < room.capacity) {
    room.players.push(createBot(number++, room));
  }
}

/* ============================================================
   GAME START
   ============================================================ */

function startHand(room, previousGame) {
  const handIndex = previousGame ? previousGame.handIndex + 1 : 1;
  const fairness = makeFairness(room, handIndex);
  const cards = seededShuffle(canonicalDeck(), fairness.seedInput);
  const partyIndex = Math.ceil(handIndex / 5);
  const trump = TRUMPS[(handIndex - 1) % TRUMPS.length];

  room.players.forEach(function (player) {
    player.hand = [];
    player.captured = [];
    player.lastRaw = 0;
  });

  for (let round = 0; round < 5; round++) {
    room.players.forEach(function (player) {
      if (cards.length) player.hand.push(cards.pop());
    });
  }

  const leader = previousGame && Number.isInteger(previousGame.nextLeader) ? previousGame.nextLeader : 0;

  let partyStart;

  if (previousGame && previousGame.partyIndex === partyIndex) {
    partyStart = previousGame.partyStart;
  } else {
    partyStart = Object.fromEntries(room.players.map(function (player) {
      return [player.id, player.total];
    }));
  }

  room.game = {
    handIndex: handIndex,
    partyIndex: partyIndex,
    totalHands: room.parties * 5,
    trump: trump,
    deck: cards,
    table: [],
    current: leader,
    leadCount: 0,
    leadMaliutka: false,
    processing: false,
    gameOver: false,
    turnEndsAt: 0,
    history: previousGame ? previousGame.history : [],
    lastScores: previousGame ? previousGame.lastScores : {},
    lastTrickOrder: [],
    lastTrickWinner: null,
    nextLeader: leader,
    partyStart: partyStart,
    fairness: fairness
  };

  return room.game;
}

/* ============================================================
   CLIENT STATE
   ============================================================ */

function buildState(room, viewerId, revealAll) {
  const game = room.game;
  if (!game) return null;

  const playersCards = {};

  room.players.forEach(function (player) {
    if (revealAll || player.id === viewerId) {
      playersCards[player.id] = player.hand;
    }
  });

  const winningIndex = winnerIndex(game.table, game.trump);

  return {
    roomId: room.id,
    roomName: room.name,
    capacity: room.capacity,
    parties: room.parties,
    stake: room.stake,
    viewerId: viewerId,
    handIndex: game.handIndex,
    partyIndex: game.partyIndex,
    totalHands: game.totalHands,
    trump: game.trump,
    fairnessHash: game.fairness ? game.fairness.hash : null,
    deckCount: game.deck.length,
    currentTurnIndex: game.current,
    leadCount: game.leadCount,
    leadWasMaliutka: game.leadMaliutka,
    processing: game.processing,
    gameOver: game.gameOver,
    turnEndsAt: game.turnEndsAt,
    serverNow: Date.now(),
    turnSeconds: TURN_SECONDS,
    playersCards: playersCards,
    history: game.history,
    lastHandScores: game.lastScores,

    players: room.players.map(function (player, index) {
      const user = userOf(player);
      const eq = user && user.equipped ? user.equipped : {};

      return {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        isBot: player.isBot,
        connected: player.connected,
        cardCount: player.hand.length,
        capturedCount: player.captured.length,
        capturedPoints: player.captured.reduce(function (s, c) { return s + cardPoints(c); }, 0),
        totalPoints: player.total,
        lastRawPoints: player.lastRaw,
        level: player.level,
        xp: player.xp,
        wins: player.wins,
        rating: user ? user.rating : null,
        frame: eq.frame || 'none',
        cardback: eq.cardback || 'blue',
        title: eq.title || 'none',
        isCurrent: index === game.current
      };
    }),

    table: game.table.map(function (play, index) {
      return {
        playerId: play.playerId,
        playerName: play.playerName,
        cards: play.cards,
        cuts: play.cuts,
        isWinning: index === winningIndex
      };
    })
  };
}

function broadcastGame(room) {
  if (!room || !room.game) return;

  room.players.forEach(function (player) {
    if (player.isBot || !player.socketId || !player.connected) return;

    io.to(player.socketId).emit('gameStateUpdate', buildState(room, player.id, isTester(player.name)));
  });
}

/* ============================================================
   TURN
   ============================================================ */

function setTurn(room, index) {
  if (!room || !room.game || room.game.gameOver) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  room.game.current = index % room.players.length;
  room.game.turnEndsAt = Date.now() + TURN_SECONDS * 1000;

  room.timer = setTimeout(function () {
    room.timer = null;
    autoPlay(room);
  }, TURN_SECONDS * 1000);

  broadcastGame(room);
  scheduleBot(room);
}

/* ============================================================
   PLAY VALIDATION
   ============================================================ */

function validatePlay(game, hand, indexes, minOtherHandSize) {
  if (!Array.isArray(indexes) || indexes.length === 0) {
    return { ok: false, message: 'აირჩიე კარტი.' };
  }

  const normalized = indexes.map(Number);
  const unique = Array.from(new Set(normalized));

  if (
    unique.length !== normalized.length ||
    unique.length > 5 ||
    unique.some(function (i) { return !Number.isInteger(i); })
  ) {
    return { ok: false, message: 'არასწორი არჩევანი.' };
  }

  const cards = unique.map(function (index) { return hand[index]; });

  if (cards.some(function (card) { return !card; })) {
    return { ok: false, message: 'არჩეული კარტი ვერ მოიძებნა.' };
  }

  /* ---- Leader: the led group must be one suit. ---- */
  if (!game.table.length) {
    if (!sameSuit(cards)) {
      return { ok: false, message: 'ერთად ჩამოსული კარტები ერთი მასტის უნდა იყოს.' };
    }

    const isValidMaliutkaLead = cards.length === 5 && isMaliutka(cards);

    if (!isValidMaliutkaLead && typeof minOtherHandSize === 'number' && cards.length > minOtherHandSize) {
      return {
        ok: false,
        message: 'ამდენი კარტის პასუხის გაცემა ვერავინ შეძლებს ახლა — აირჩიე ' + minOtherHandSize + ' ან ნაკლები კარტი.'
      };
    }

    return { ok: true, cards: cards, indexes: unique };
  }

  /* ---- Maliutka response: whole remaining hand. ---- */
  if (game.leadMaliutka) {
    if (cards.length !== hand.length) {
      return { ok: false, message: 'მალიუტკაზე ყველა დარჩენილი კარტი უნდა ჩამოხვიდე.' };
    }
    return { ok: true, cards: cards, indexes: unique };
  }

  /*
    ---- Normal response ----
    FIX: the responder may play ANY cards — mixed suits are
    allowed. Only the count must match the lead. Whether the
    response cuts is decided by one-to-one matching.
  */
  const required = game.leadCount || 1;

  if (cards.length !== required) {
    return { ok: false, message: 'უნდა მონიშნო ზუსტად ' + required + ' კარტი.' };
  }

  return { ok: true, cards: cards, indexes: unique };
}

/* ============================================================
   PLAY
   ============================================================ */

function playCards(room, player, indexes) {
  const game = room.game;

  if (!game || game.processing || game.gameOver) return false;

  const otherHandSizes = room.players
    .filter(function (item) { return item.id !== player.id; })
    .map(function (item) { return item.hand.length; });

  const minOtherHandSize = otherHandSizes.length ? Math.min.apply(null, otherHandSizes) : 5;

  const validation = validatePlay(game, player.hand, indexes, minOtherHandSize);

  if (!validation.ok) {
    if (player.socketId) io.to(player.socketId).emit('errorMessage', validation.message);
    return false;
  }

  let cuts = false;

  if (game.table.length) {
    const currentWinner = winnerIndex(game.table, game.trump);
    if (currentWinner >= 0) {
      cuts = canBeatSet(game.table[currentWinner].cards, validation.cards, game.trump);
    }
  }

  const selectedCards = validation.cards.slice();

  validation.indexes.slice().sort(function (a, b) { return b - a; }).forEach(function (index) {
    player.hand.splice(index, 1);
  });

  if (!game.table.length) {
    game.leadCount = selectedCards.length;
    game.leadMaliutka = isMaliutka(selectedCards);

    if (game.leadMaliutka) {
      io.to(room.id).emit('maliutka', { playerId: player.id, playerName: player.name });

      const user = userOf(player);

      if (user) {
        defaults(user);
        user.quests.maliutka += 1;
        user.stats.maliutkas += 1;
        checkQuests(user);

        if (!user.achievements.includes('მალიუტკის ოსტატი')) {
          user.achievements.push('მალიუტკის ოსტატი');
          addXP(user, 40);
          io.to(room.id).emit('achievement', { playerId: player.id, title: 'მალიუტკის ოსტატი' });
        }
      }
    }
  }

  game.table.push({
    playerId: player.id,
    playerName: player.name,
    cards: selectedCards,
    cuts: cuts
  });

  io.to(room.id).emit('playFX', { playerId: player.id, cuts: cuts, count: selectedCards.length });

  if (game.table.length === room.players.length) {
    completeTrick(room);
    return true;
  }

  const playerIndex = room.players.findIndex(function (item) { return item.id === player.id; });

  setTurn(room, (playerIndex + 1) % room.players.length);

  return true;
}

/* ============================================================
   TRICK
   ============================================================ */

/*
  Draw ONE card at a time, round-robin, starting with the trick
  winner, so hand sizes never drift more than 1 card apart.
*/
function refillHands(room, startIndex) {
  const game = room.game;
  let stillNeeds = true;

  while (stillNeeds && game.deck.length) {
    stillNeeds = false;

    for (let offset = 0; offset < room.players.length; offset++) {
      const player = room.players[(startIndex + offset) % room.players.length];

      if (player.hand.length < 5 && game.deck.length) {
        player.hand.push(game.deck.pop());
        if (player.hand.length < 5) stillNeeds = true;
      }
    }
  }
}

function completeTrick(room) {
  const game = room.game;

  if (!game || game.processing) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  game.processing = true;

  const winningPlayIndex = winnerIndex(game.table, game.trump);

  if (winningPlayIndex < 0) {
    game.processing = false;
    return;
  }

  const winnerPlay = game.table[winningPlayIndex];
  const winnerPlayerIndex = room.players.findIndex(function (player) {
    return player.id === winnerPlay.playerId;
  });

  if (winnerPlayerIndex < 0) {
    game.processing = false;
    return;
  }

  const winner = room.players[winnerPlayerIndex];
  let trickPoints = 0;

  game.table.forEach(function (played) {
    winner.captured.push.apply(winner.captured, played.cards);
    played.cards.forEach(function (c) { trickPoints += cardPoints(c); });
  });

  game.lastTrickOrder = game.table.map(function (played) { return played.playerId; });
  game.lastTrickWinner = winner.id;

  io.to(room.id).emit('trickWon', { winnerId: winner.id, points: trickPoints });

  broadcastGame(room);

  setTimeout(function () {
    if (!rooms.has(room.id) || room.game !== game) return;

    game.table = [];
    game.leadCount = 0;
    game.leadMaliutka = false;

    refillHands(room, winnerPlayerIndex);

    const finished = game.deck.length === 0 && room.players.every(function (player) {
      return player.hand.length === 0;
    });

    if (finished) {
      finishHand(room);
      return;
    }

    game.processing = false;
    setTurn(room, winnerPlayerIndex);
  }, TRICK_CLEAR_DELAY);
}

/* ============================================================
   NEXT LEADER / GAKHISHTVA
   ============================================================ */

function calculateNextLeader(room, game, rawScores) {
  const zeroPlayers = room.players
    .filter(function (player) { return rawScores[player.id] === 0; })
    .map(function (player) { return player.id; });

  if (zeroPlayers.length >= 2 && game.lastTrickOrder.length) {
    let lastZero = null;

    game.lastTrickOrder.forEach(function (playerId) {
      if (zeroPlayers.includes(playerId)) lastZero = playerId;
    });

    if (lastZero) {
      const index = room.players.findIndex(function (player) { return player.id === lastZero; });
      if (index >= 0) return (index + 1) % room.players.length;
    }
  }

  let minimum = Infinity;
  let lowestIndex = 0;

  room.players.forEach(function (player, index) {
    const score = rawScores[player.id];
    if (score < minimum) {
      minimum = score;
      lowestIndex = index;
    }
  });

  return (lowestIndex + 1) % room.players.length;
}

/* ============================================================
   HAND / PARTY SCORING
   ============================================================ */

async function finishHand(room) {
  const game = room.game;
  if (!game) return;

  const rawScores = {};
  const writtenScores = {};

  room.players.forEach(function (player) {
    const raw = player.captured.reduce(function (sum, card) { return sum + cardPoints(card); }, 0);
    rawScores[player.id] = raw;
    writtenScores[player.id] = raw === 0 ? -120 : raw;
    player.lastRaw = raw;
    player.total += writtenScores[player.id];
  });

  game.lastScores = writtenScores;

  const fairnessForHand = game.fairness || null;

  game.history.push({
    hand: game.handIndex,
    party: game.partyIndex,
    trump: game.trump,
    rawScores: Object.assign({}, rawScores),
    scores: Object.assign({}, writtenScores),
    fairness: fairnessForHand ? { seed: fairnessForHand.seed, hash: fairnessForHand.hash } : null
  });

  if (fairnessForHand) {
    io.to(room.id).emit('fairnessReveal', {
      hand: game.handIndex,
      seed: fairnessForHand.seed,
      seedInput: fairnessForHand.seedInput,
      hash: fairnessForHand.hash
    });
  }

  io.to(room.id).emit('handSummary', {
    hand: game.handIndex,
    trump: game.trump,
    players: room.players.map(function (p) {
      return { id: p.id, name: p.name, raw: rawScores[p.id], written: writtenScores[p.id], total: p.total };
    })
  });

  const maxRaw = Math.max.apply(null, room.players.map(function (player) { return rawScores[player.id] || 0; }));

  room.players.forEach(function (player) {
    const user = userOf(player);
    if (!user) return;

    defaults(user);
    user.stats.handsPlayed += 1;

    if (maxRaw > 0 && rawScores[player.id] === maxRaw) {
      user.stats.handsWon += 1;
      user.coins += 5;
    }

    pushProfile(user);
  });

  /* Every 5 hands = party. */
  if (game.handIndex % 5 === 0) {
    let best = -Infinity;
    let winners = [];

    room.players.forEach(function (player) {
      const delta = player.total - Number(game.partyStart[player.id] || 0);

      if (delta > best) {
        best = delta;
        winners = [player];
      } else if (delta === best) {
        winners.push(player);
      }

      const user = userOf(player);
      if (user) addXP(user, 20);
    });

    const humanRatings = room.players.map(function (player) {
      const user = userOf(player);
      return user ? user.rating : 1000;
    });

    const avgRating = humanRatings.reduce(function (sum, value) { return sum + value; }, 0) / (humanRatings.length || 1);

    room.players.forEach(function (player) {
      const user = userOf(player);
      if (!user) return;

      defaults(user);

      const isWinner = winners.indexOf(player) >= 0;
      const delta = player.total - Number(game.partyStart[player.id] || 0);
      const expected = 1 / (1 + Math.pow(10, (avgRating - user.rating) / 400));

      user.rating = Math.max(0, Math.round(user.rating + 32 * ((isWinner ? 1 : 0) - expected)));
      user.stats.partiesPlayed += 1;

      user.stats.recentParties.push({ won: isWinner, delta: delta, rating: user.rating, date: today() });
      user.stats.recentParties = user.stats.recentParties.slice(-20);

      if (isWinner) {
        user.stats.partiesWon += 1;
        user.stats.winStreak += 1;
        if (user.stats.winStreak > user.stats.bestWinStreak) user.stats.bestWinStreak = user.stats.winStreak;
        if (delta > user.stats.biggestWin) user.stats.biggestWin = delta;
        user.coins = Number(user.coins || 0) + 50;
      } else {
        user.stats.winStreak = 0;
      }
    });

    winners.forEach(function (player) {
      const user = userOf(player);
      if (!user) return;

      user.wins += 1;
      user.quests.wins += 1;
      addXP(user, 80);
      checkQuests(user);

      player.wins = user.wins;
      player.xp = user.xp;
      player.level = user.level;
    });

    io.to(room.id).emit('partyWinner', {
      party: game.partyIndex,
      winners: winners.map(function (p) { return { id: p.id, name: p.name }; })
    });

    room.players.forEach(function (player) {
      pushProfile(userOf(player));
    });
  }

  await saveUsersNow();

  if (game.handIndex >= game.totalHands) {
    finishGame(room);
    return;
  }

  game.nextLeader = calculateNextLeader(room, game, rawScores);

  startHand(room, game);
  io.to(room.id).emit('dealAnimation');
  setTurn(room, room.game.current);
}

/* ============================================================
   GAME OVER
   ============================================================ */

function finishGame(room) {
  const game = room.game;
  if (!game) return;

  game.gameOver = true;
  game.processing = false;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  let winner = room.players[0];

  room.players.forEach(function (player) {
    if (player.total > winner.total) winner = player;
  });

  const user = userOf(winner);
  if (user) {
    user.coins += 30;
    addXP(user, 100);
  }

  const winnerEffect = user && user.equipped ? user.equipped.effect : 'confetti';

  io.to(room.id).emit('gameWinner', {
    playerId: winner.id,
    playerName: winner.name,
    effect: winnerEffect,
    standings: room.players
      .map(function (p) { return { id: p.id, name: p.name, avatar: p.avatar, total: p.total, isBot: p.isBot }; })
      .sort(function (a, b) { return b.total - a.total; })
  });

  broadcastGame(room);
  broadcastLobby();

  saveUsersNow().catch(console.error);
}

/* ============================================================
   BOT AI
   ============================================================ */

function combinations(array, count, start, current, output) {
  start = start || 0;
  current = current || [];
  output = output || [];

  if (current.length === count) {
    output.push(current.slice());
    return output;
  }

  for (let i = start; i < array.length; i++) {
    current.push(array[i]);
    combinations(array, count, i + 1, current, output);
    current.pop();
  }

  return output;
}

function cardCost(card, trump) {
  let cost = cardPoints(card) * 100 + rankIndex(card);
  if (isTrump(card, trump)) cost += 10000;
  return cost;
}

/* Cheapest set that beats the target (mixed suits allowed). */
function cheapestCut(hand, count, target, trump) {
  if (count <= 0 || count > hand.length) return null;

  const indexes = hand.map(function (_, index) { return index; });
  const combos = combinations(indexes, count);

  let best = null;
  let bestCost = Infinity;

  combos.forEach(function (combo) {
    const cards = combo.map(function (index) { return hand[index]; });
    if (!canBeatSet(target, cards, trump)) return;

    const cost = cards.reduce(function (sum, card) { return sum + cardCost(card, trump); }, 0);

    if (cost < bestCost) {
      bestCost = cost;
      best = combo;
    }
  });

  return best;
}

/* Cheapest cards to throw away (mixed suits allowed). */
function lowestDiscard(hand, count, trump) {
  count = Math.min(count, hand.length);
  if (count <= 0) return [];

  return hand
    .map(function (card, index) { return { index: index, cost: cardCost(card, trump) }; })
    .sort(function (a, b) { return a.cost - b.cost; })
    .slice(0, count)
    .map(function (entry) { return entry.index; });
}

function tablePoints(table) {
  return table.reduce(function (sum, play) {
    return sum + play.cards.reduce(function (s, c) { return s + cardPoints(c); }, 0);
  }, 0);
}

function botChoice(room, player) {
  const game = room.game;
  if (!game) return [];

  /* ---- Bot leads ---- */
  if (!game.table.length) {
    const otherHandSizes = room.players
      .filter(function (item) { return item.id !== player.id; })
      .map(function (item) { return item.hand.length; });

    const minOtherHandSize = otherHandSizes.length ? Math.min.apply(null, otherHandSizes) : 5;
    const groups = {};

    player.hand.forEach(function (card, index) {
      if (!groups[card.suit]) groups[card.suit] = [];
      groups[card.suit].push(index);
    });

    const five = Object.values(groups).find(function (group) { return group.length === 5; });
    if (five) return five.slice();

    const multi = Object.values(groups)
      .filter(function (group) { return group.length >= 2 && group.length <= minOtherHandSize; })
      .sort(function (a, b) { return b.length - a.length; });

    if (multi.length && Math.random() < 0.3) {
      return multi[0].slice(0, Math.min(4, multi[0].length, minOtherHandSize));
    }

    return lowestDiscard(player.hand, 1, game.trump);
  }

  /* ---- Maliutka response ---- */
  if (game.leadMaliutka) {
    return player.hand.map(function (_, index) { return index; });
  }

  const count = game.leadCount;
  const currentWinner = winnerIndex(game.table, game.trump);
  const target = game.table[currentWinner].cards;

  /* Only spend trumps to cut if something worthwhile is on the table. */
  const cut = cheapestCut(player.hand, count, target, game.trump);

  if (cut) {
    const usesTrump = cut.some(function (i) { return isTrump(player.hand[i], game.trump); });
    const worth = tablePoints(game.table);
    if (!usesTrump || worth >= 10 || Math.random() < 0.5) return cut;
  }

  return lowestDiscard(player.hand, count, game.trump);
}

function forcePlayOrFallback(room, player) {
  const played = playCards(room, player, botChoice(room, player));
  if (played) return;

  const game = room.game;
  if (!game || game.gameOver) return;

  const required = !game.table.length ? 1 : (game.leadMaliutka ? player.hand.length : (game.leadCount || 1));

  const fallbackIndexes = lowestDiscard(player.hand, Math.min(required, player.hand.length), game.trump);
  const fallbackPlayed = playCards(room, player, fallbackIndexes);

  if (!fallbackPlayed && player.hand.length) {
    console.error('[BURA] forced fallback play failed for room', room.id);
    playCards(room, player, [0]);
  }
}

function scheduleBot(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  const player = room.players[room.game.current];
  if (!player || !player.isBot) return;

  io.to(room.id).emit('botThinking', { playerId: player.id, text: player.name + ' ფიქრობს...' });

  room.botTimer = setTimeout(function () {
    room.botTimer = null;

    if (!room.game || room.game.processing || room.game.gameOver) return;

    const active = room.players[room.game.current];
    if (!active || active.id !== player.id) return;

    forcePlayOrFallback(room, player);
  }, rand(900, 1700));
}

function autoPlay(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;

  const player = room.players[room.game.current];
  if (!player) return;

  forcePlayOrFallback(room, player);
}

/* ============================================================
   LOBBY
   ============================================================ */

function lobbyData() {
  return Array.from(rooms.values())
    .filter(function (room) { return !room.game && room.players.length < room.capacity; })
    .map(function (room) {
      return {
        id: room.id,
        name: room.name,
        stake: room.stake,
        players: room.players.length,
        capacity: room.capacity,
        parties: room.parties,
        seated: room.players.map(function (p) { return p.avatar; })
      };
    });
}

function liveCount() {
  let playing = 0;
  rooms.forEach(function (room) {
    if (room.game && !room.game.gameOver) {
      playing += room.players.filter(function (p) { return !p.isBot; }).length;
    }
  });
  return { online: io.engine ? io.engine.clientsCount : 0, playing: playing };
}

function broadcastLobby() {
  io.emit('lobbyTables', lobbyData());
  io.emit('liveCount', liveCount());
}

/* ============================================================
   TOURNAMENT PROTOTYPE (coins prize — virtual)
   ============================================================ */

const tournaments = [
  {
    id: 'bura_cup',
    name: 'Written Bura Cup',
    prize: '5 000 🪙',
    startAt: Date.now() + 60 * 60 * 1000,
    maxPlayers: 16,
    registered: [],
    status: 'registration'
  }
];

function tournamentData() {
  return tournaments.map(function (t) {
    return {
      id: t.id,
      name: t.name,
      prize: t.prize,
      startAt: t.startAt,
      maxPlayers: t.maxPlayers,
      registered: t.registered.length,
      registeredIds: t.registered.slice(),
      status: t.status
    };
  });
}

/* ============================================================
   JOIN ROOM
   ============================================================ */

function joinRoom(socket, data) {
  const user = users.get(socket.data.userId);

  if (socket.data.roomId && rooms.has(socket.data.roomId)) {
    const currentRoom = rooms.get(socket.data.roomId);
    if (currentRoom.game && !currentRoom.game.gameOver) {
      socket.emit('errorMessage', 'ჯერ მიმდინარე თამაში დაასრულე.');
      return;
    }
  }

  let room = data.roomId ? rooms.get(data.roomId) : null;

  if (data.roomId && !room) {
    socket.emit('errorMessage', 'მაგიდა ვერ მოიძებნა.');
    return;
  }

  if (room && (room.game || room.players.length >= room.capacity)) {
    socket.emit('errorMessage', 'მაგიდა აღარ არის თავისუფალი.');
    return;
  }

  if (!room) {
    room = makeRoom(data.tableName, data.capacity, data.parties, data.stake);
  }

  let player = user ? createHumanPlayer(user, socket) : createHumanPlayer(null, socket, data.name);

  const existing = user ? room.players.find(function (item) { return item.userId === user.id; }) : null;

  if (existing) {
    player = existing;
    player.socketId = socket.id;
    player.connected = true;
    player.isBot = false;

    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }
  } else {
    room.players.push(player);
  }

  socket.data.roomId = room.id;
  socket.data.playerId = player.id;
  socket.join(room.id);

  if (user) {
    user.socketId = socket.id;
    user.roomId = room.id;
    playedTable(user, room.id);
  }

  if (isTester(player.name) || data.withBots) {
    fillBots(room);
  }

  if (room.players.length >= room.capacity) {
    startHand(room);
    io.to(room.id).emit('dealAnimation');
    setTurn(room, 0);
  } else {
    io.to(room.id).emit('waitingForPlayers', {
      roomId: room.id,
      roomName: room.name,
      current: room.players.length,
      max: room.capacity,
      players: room.players.map(function (p) { return { name: p.name, avatar: p.avatar }; })
    });
  }

  broadcastLobby();
}

/* ============================================================
   RECONNECT
   ============================================================ */

function recover(socket, user) {
  const room = Array.from(rooms.values()).find(function (candidate) {
    return (!candidate.game || !candidate.game.gameOver) &&
      candidate.players.some(function (player) { return player.userId === user.id && !player.left; });
  });

  if (!room) return;

  const player = room.players.find(function (item) { return item.userId === user.id && !item.left; });

  if (!player) return;

  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }

  /* Take the seat back from the bot that replaced us. */
  if (player.isBot && room.game && !room.game.gameOver) {
    player.isBot = false;
    player.name = user.username;
    player.avatar = user.avatar;
  } else if (player.isBot) {
    return;
  }

  player.connected = true;
  player.socketId = socket.id;

  socket.data.roomId = room.id;
  socket.data.playerId = player.id;

  user.roomId = room.id;
  user.socketId = socket.id;

  socket.join(room.id);
  socket.emit('sessionRecovered');

  if (room.game) {
    socket.emit('gameStateUpdate', buildState(room, player.id, isTester(player.name)));
    broadcastGame(room);
  }
}

function recoverDomino(socket, user) {
  const room = Array.from(dominoRooms.values()).find(function (candidate) {
    return (!candidate.game || !candidate.game.gameOver) &&
      candidate.players.some(function (player) { return player.userId === user.id && !player.left; });
  });

  if (!room) return;

  const player = room.players.find(function (item) { return item.userId === user.id; });
  if (!player || player.isBot) return;

  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }

  player.connected = true;
  player.socketId = socket.id;

  socket.data.dominoRoomId = room.id;
  socket.data.dominoPlayerId = player.id;

  socket.join('domino:' + room.id);

  if (room.game) {
    socket.emit('dominoStateUpdate', buildDominoState(room, player.id, isTester(player.name)));
  }
}

/* ============================================================
   ROOM CLEANUP
   ============================================================ */

function cleanupRoom(room) {
  if (!room) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  room.players.forEach(function (player) {
    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }
  });
}

function botTakeover(room, player, schedule, broadcast) {
  player.connected = false;
  player.socketId = null;
  player.isBot = true;
  if (!player.name.includes('🤖')) player.name += ' 🤖';

  if (room.game && room.players[room.game.current] === player) schedule(room);
  broadcast(room);
}

/* ============================================================
   DOMINO — GAME ENGINE
   ============================================================ */

const DOMINO_CAPACITIES = [2, 3, 4];
const DOMINO_ROUNDS_OPTIONS = [1, 2, 3, 4];
const DOMINO_TURN_SECONDS = 25;

const dominoRooms = new Map();

function canonicalDominoSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      tiles.push({ id: uid('tile'), a: a, b: b });
    }
  }
  return tiles;
}

function tilePips(tile) {
  return tile.a + tile.b;
}

function handPips(hand) {
  return hand.reduce(function (sum, t) { return sum + tilePips(t); }, 0);
}

function tileMatchesEnd(tile, end) {
  return end === null || tile.a === end || tile.b === end;
}

function dominoLobbyData() {
  return Array.from(dominoRooms.values())
    .filter(function (room) { return !room.game && room.players.length < room.capacity; })
    .map(function (room) {
      return {
        id: room.id,
        name: room.name,
        players: room.players.length,
        capacity: room.capacity,
        rounds: room.rounds
      };
    });
}

function broadcastDominoLobby() {
  io.emit('dominoLobbyTables', dominoLobbyData());
}

function makeDominoRoom(name, capacity, rounds) {
  const room = {
    id: uid('droom'),
    name: clean(name) || 'Domino Table',
    capacity: DOMINO_CAPACITIES.includes(Number(capacity)) ? Number(capacity) : 4,
    rounds: DOMINO_ROUNDS_OPTIONS.includes(Number(rounds)) ? Number(rounds) : 1,
    players: [],
    game: null,
    timer: null,
    botTimer: null
  };
  dominoRooms.set(room.id, room);
  broadcastDominoLobby();
  return room;
}

function createDominoHumanPlayer(user, socket, guestName) {
  return {
    id: user ? user.id : uid('dguest'),
    userId: user ? user.id : null,
    name: user ? user.username : (clean(guestName) || 'Guest'),
    avatar: user ? user.avatar : '😎',
    socketId: socket.id,
    isBot: false,
    connected: true,
    hand: [],
    matchScore: 0,
    xp: user ? user.xp : 0,
    level: user ? user.level : 1,
    reconnectTimer: null
  };
}

function createDominoBot(number, room) {
  return {
    id: uid('dbot'),
    userId: null,
    name: pickBotName(room),
    avatar: BOT_AVATARS[rand(0, BOT_AVATARS.length - 1)],
    socketId: null,
    isBot: true,
    connected: true,
    hand: [],
    matchScore: 0,
    xp: 0,
    level: rand(2, 12),
    botNumber: number,
    reconnectTimer: null
  };
}

function fillDominoBots(room) {
  let number = 1;
  while (room.players.length < room.capacity) {
    room.players.push(createDominoBot(number++, room));
  }
}

function dealDomino(players, deck) {
  players.forEach(function (player) { player.hand = []; });

  let i = 0;

  while (deck.length && players.some(function (p) { return p.hand.length < 7; })) {
    const player = players[i % players.length];
    if (player.hand.length < 7) player.hand.push(deck.pop());
    i++;
  }

  return deck;
}

function findStartingPlayerIndex(players) {
  let bestIndex = 0;
  let bestScore = -1;

  players.forEach(function (player, index) {
    player.hand.forEach(function (tile) {
      const score = (tile.a === tile.b ? 1000 : 0) + tilePips(tile);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
  });

  return bestIndex;
}

function startDominoRound(room, previousGame) {
  const roundIndex = previousGame ? previousGame.roundIndex + 1 : 1;
  const fairness = makeFairness(room, 'domino-' + roundIndex);
  const deck = seededShuffle(canonicalDominoSet(), fairness.seedInput);
  const boneyard = dealDomino(room.players, deck);
  const startIndex = findStartingPlayerIndex(room.players);

  room.game = {
    roundIndex: roundIndex,
    totalRounds: room.rounds,
    chain: [],
    leftEnd: null,
    rightEnd: null,
    boneyard: boneyard,
    current: startIndex,
    passStreak: 0,
    processing: false,
    gameOver: false,
    turnEndsAt: 0,
    fairness: fairness,
    history: previousGame ? previousGame.history : []
  };

  return room.game;
}

function dominoHasLegalMove(player, game) {
  if (!game.chain.length) return true;
  return player.hand.some(function (tile) {
    return tileMatchesEnd(tile, game.leftEnd) || tileMatchesEnd(tile, game.rightEnd);
  });
}

function dominoAutoDraw(room) {
  const game = room.game;
  const player = room.players[game.current];
  let drewAny = false;

  while (!dominoHasLegalMove(player, game) && game.boneyard.length) {
    player.hand.push(game.boneyard.pop());
    drewAny = true;
  }

  return drewAny;
}

function buildDominoState(room, viewerId, revealAll) {
  const game = room.game;
  if (!game) return null;

  const hands = {};

  room.players.forEach(function (player) {
    if (revealAll || player.id === viewerId) hands[player.id] = player.hand;
  });

  return {
    roomId: room.id,
    roomName: room.name,
    capacity: room.capacity,
    rounds: room.rounds,
    viewerId: viewerId,
    roundIndex: game.roundIndex,
    totalRounds: game.totalRounds,
    chain: game.chain,
    leftEnd: game.leftEnd,
    rightEnd: game.rightEnd,
    boneyardCount: game.boneyard.length,
    currentTurnIndex: game.current,
    processing: game.processing,
    gameOver: game.gameOver,
    turnEndsAt: game.turnEndsAt,
    serverNow: Date.now(),
    turnSeconds: DOMINO_TURN_SECONDS,
    fairnessHash: game.fairness ? game.fairness.hash : null,
    history: game.history,
    hands: hands,
    players: room.players.map(function (player, index) {
      const user = userOf(player);
      return {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        isBot: player.isBot,
        connected: player.connected,
        tileCount: player.hand.length,
        matchScore: player.matchScore,
        level: player.level,
        frame: (user && user.equipped && user.equipped.frame) || 'none',
        isCurrent: index === game.current
      };
    })
  };
}

function broadcastDominoGame(room) {
  if (!room || !room.game) return;

  room.players.forEach(function (player) {
    if (player.isBot || !player.socketId || !player.connected) return;
    io.to(player.socketId).emit('dominoStateUpdate', buildDominoState(room, player.id, isTester(player.name)));
  });
}

function setDominoTurn(room, index) {
  const game = room.game;
  if (!game || game.gameOver) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  game.current = index % room.players.length;

  dominoAutoDraw(room);

  const player = room.players[game.current];

  if (!dominoHasLegalMove(player, game)) {
    game.passStreak += 1;

    if (game.passStreak >= room.players.length) {
      finishDominoRound(room, null);
      return;
    }

    setDominoTurn(room, game.current + 1);
    return;
  }

  game.turnEndsAt = Date.now() + DOMINO_TURN_SECONDS * 1000;
  room.timer = setTimeout(function () { dominoAutoPlay(room); }, DOMINO_TURN_SECONDS * 1000);

  broadcastDominoGame(room);
  scheduleDominoBot(room);
}

function dominoPlaceTile(room, player, tileId, side) {
  const game = room.game;
  if (!game || game.processing || game.gameOver) return false;

  const active = room.players[game.current];
  if (!active || active.id !== player.id) return false;

  const tileIndex = player.hand.findIndex(function (t) { return t.id === tileId; });
  if (tileIndex < 0) return false;

  const tile = player.hand[tileIndex];

  if (!game.chain.length) {
    game.chain.push({ id: tile.id, left: tile.a, right: tile.b });
    game.leftEnd = tile.a;
    game.rightEnd = tile.b;
  } else {
    const wantsLeft = side === 'left';
    const targetEnd = wantsLeft ? game.leftEnd : game.rightEnd;
    const otherEnd = wantsLeft ? game.rightEnd : game.leftEnd;

    let matchSide = null;

    if (tile.a === targetEnd || tile.b === targetEnd) {
      matchSide = wantsLeft ? 'left' : 'right';
    } else if (tile.a === otherEnd || tile.b === otherEnd) {
      matchSide = wantsLeft ? 'right' : 'left';
    } else {
      if (player.socketId) io.to(player.socketId).emit('dominoError', 'ეს ქვა აქ არ ერგება.');
      return false;
    }

    if (matchSide === 'left') {
      const outward = tile.a === game.leftEnd ? tile.b : tile.a;
      game.chain.unshift({ id: tile.id, left: outward, right: game.leftEnd });
      game.leftEnd = outward;
    } else {
      const outward = tile.a === game.rightEnd ? tile.b : tile.a;
      game.chain.push({ id: tile.id, left: game.rightEnd, right: outward });
      game.rightEnd = outward;
    }
  }

  player.hand.splice(tileIndex, 1);
  game.passStreak = 0;

  io.to('domino:' + room.id).emit('dominoPlayFX', { playerId: player.id });

  if (player.hand.length === 0) {
    finishDominoRound(room, player);
    return true;
  }

  setDominoTurn(room, game.current + 1);
  return true;
}

async function finishDominoRound(room, wentOutPlayer) {
  const game = room.game;
  if (!game) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  game.processing = true;

  const pipsByPlayer = {};
  room.players.forEach(function (player) { pipsByPlayer[player.id] = handPips(player.hand); });

  let winner = wentOutPlayer;
  let reason = 'out';

  if (!winner) {
    reason = 'blocked';
    let minPips = Infinity;

    room.players.forEach(function (player) {
      if (pipsByPlayer[player.id] < minPips) {
        minPips = pipsByPlayer[player.id];
        winner = player;
      }
    });
  }

  const awarded = room.players.reduce(function (sum, player) {
    return player.id === winner.id ? sum : sum + pipsByPlayer[player.id];
  }, 0);

  winner.matchScore += awarded;

  game.history.push({
    round: game.roundIndex,
    winnerId: winner.id,
    winnerName: winner.name,
    reason: reason,
    awarded: awarded,
    pips: pipsByPlayer
  });

  if (game.fairness) {
    io.to('domino:' + room.id).emit('dominoFairnessReveal', {
      round: game.roundIndex,
      seed: game.fairness.seed,
      seedInput: game.fairness.seedInput,
      hash: game.fairness.hash
    });
  }

  io.to('domino:' + room.id).emit('dominoRoundEnd', {
    winnerId: winner.id,
    winnerName: winner.name,
    reason: reason,
    awarded: awarded,
    pips: pipsByPlayer
  });

  broadcastDominoGame(room);

  if (game.roundIndex >= game.totalRounds) {
    finishDominoMatch(room);
    return;
  }

  setTimeout(function () {
    if (!dominoRooms.has(room.id) || room.game !== game) return;

    const nextGame = startDominoRound(room, game);
    io.to('domino:' + room.id).emit('dominoDealAnimation');
    setDominoTurn(room, nextGame.current);
  }, 2600);
}

async function finishDominoMatch(room) {
  const game = room.game;
  if (!game) return;

  game.gameOver = true;

  let champion = room.players[0];

  room.players.forEach(function (player) {
    if (player.matchScore > champion.matchScore) champion = player;
  });

  const avgRating = room.players.reduce(function (sum, p) {
    const u = userOf(p);
    return sum + (u ? u.rating : 1000);
  }, 0) / (room.players.length || 1);

  room.players.forEach(function (player) {
    const user = userOf(player);
    if (!user) return;

    defaults(user);

    const isWinner = player.id === champion.id;
    const expected = 1 / (1 + Math.pow(10, (avgRating - user.rating) / 400));

    user.rating = Math.max(0, Math.round(user.rating + 24 * ((isWinner ? 1 : 0) - expected)));
    user.stats.partiesPlayed += 1;

    if (isWinner) {
      user.stats.partiesWon += 1;
      user.coins = Number(user.coins || 0) + 40;
      addXP(user, 60);
    } else {
      addXP(user, 15);
    }
  });

  await saveUsersNow();

  const champUser = userOf(champion);

  io.to('domino:' + room.id).emit('dominoMatchEnd', {
    winnerId: champion.id,
    winnerName: champion.name,
    effect: champUser ? champUser.equipped.effect : 'confetti',
    standings: room.players
      .map(function (p) { return { id: p.id, name: p.name, avatar: p.avatar, total: p.matchScore, isBot: p.isBot }; })
      .sort(function (a, b) { return b.total - a.total; })
  });

  broadcastDominoGame(room);
}

function dominoBotChoice(player, game) {
  const legal = [];

  player.hand.forEach(function (tile) {
    if (!game.chain.length) {
      legal.push({ tile: tile, side: 'right' });
      return;
    }
    if (tileMatchesEnd(tile, game.leftEnd)) legal.push({ tile: tile, side: 'left' });
    if (tileMatchesEnd(tile, game.rightEnd)) legal.push({ tile: tile, side: 'right' });
  });

  if (!legal.length) return null;

  legal.sort(function (a, b) {
    const da = a.tile.a === a.tile.b ? 1 : 0;
    const db = b.tile.a === b.tile.b ? 1 : 0;
    if (da !== db) return db - da;
    return tilePips(b.tile) - tilePips(a.tile);
  });

  return legal[0];
}

function scheduleDominoBot(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  const player = room.players[room.game.current];
  if (!player || !player.isBot) return;

  room.botTimer = setTimeout(function () {
    room.botTimer = null;

    if (!room.game || room.game.processing || room.game.gameOver) return;

    const active = room.players[room.game.current];
    if (!active || active.id !== player.id) return;

    const choice = dominoBotChoice(player, room.game);
    if (choice) dominoPlaceTile(room, player, choice.tile.id, choice.side);
  }, rand(900, 1600));
}

function dominoAutoPlay(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;

  const player = room.players[room.game.current];
  if (!player) return;

  const choice = dominoBotChoice(player, room.game);
  if (choice) dominoPlaceTile(room, player, choice.tile.id, choice.side);
}

function joinDominoRoom(socket, data) {
  const user = users.get(socket.data.userId);

  let room = data.roomId ? dominoRooms.get(data.roomId) : null;

  if (data.roomId && !room) {
    socket.emit('dominoError', 'მაგიდა ვერ მოიძებნა.');
    return;
  }

  if (room && (room.game || room.players.length >= room.capacity)) {
    socket.emit('dominoError', 'მაგიდა აღარ არის თავისუფალი.');
    return;
  }

  if (!room) room = makeDominoRoom(data.tableName, data.capacity, data.rounds);

  let player = user ? createDominoHumanPlayer(user, socket) : createDominoHumanPlayer(null, socket, data.name);

  const existing = user ? room.players.find(function (p) { return p.userId === user.id; }) : null;

  if (existing) {
    player = existing;
    player.socketId = socket.id;
    player.connected = true;
    player.isBot = false;

    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }
  } else {
    room.players.push(player);
  }

  socket.data.dominoRoomId = room.id;
  socket.data.dominoPlayerId = player.id;
  socket.join('domino:' + room.id);

  if (isTester(player.name) || data.withBots) fillDominoBots(room);

  if (room.players.length >= room.capacity) {
    const game = startDominoRound(room);
    io.to('domino:' + room.id).emit('dominoDealAnimation');
    setDominoTurn(room, game.current);
  } else {
    io.to('domino:' + room.id).emit('dominoWaiting', {
      roomId: room.id,
      current: room.players.length,
      max: room.capacity
    });
  }

  broadcastDominoLobby();
}

function dominoCleanupRoom(room) {
  if (!room) return;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  room.players.forEach(function (player) {
    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }
  });
}

/* ============================================================
   SOCKET.IO
   ============================================================ */

function sendFriends(socket, user) {
  socket.emit(
    'friendsList',
    user.friends.map(function (id) { return friendSummary(users.get(id)); }).filter(Boolean)
  );
}

function completeLogin(socket, user, token) {
  user.socketId = socket.id;
  socket.data.userId = user.id;

  const streakBonus = applyLoginStreak(user);

  socket.emit('authSuccess', {
    token: token,
    profile: profile(user),
    streakBonus: streakBonus,
    loginStreak: user.loginStreak
  });

  recover(socket, user);
  recoverDomino(socket, user);
}

io.on('connection', function (socket) {
  socket.data.userId = null;
  socket.data.roomId = null;
  socket.data.playerId = null;
  socket.data.dominoRoomId = null;
  socket.data.dominoPlayerId = null;
  socket.data.lastThrow = 0;
  socket.data.lastChat = 0;

  socket.emit('serverInfo', { tester: TESTER_ENABLED, phrases: QUICK_PHRASES });
  socket.emit('shopCatalog', SHOP_ITEMS);
  socket.emit('lobbyTables', lobbyData());
  socket.emit('dominoLobbyTables', dominoLobbyData());
  socket.emit('tournaments', tournamentData());
  io.emit('liveCount', liveCount());

  /* ---------------- REGISTER ---------------- */

  socket.on('register', async function (data) {
    try {
      data = data || {};

      const username = clean(data.username);
      const password = String(data.password || '');

      if (username.length < 3) {
        socket.emit('authError', 'მომხმარებლის სახელი მინიმუმ 3 სიმბოლო უნდა იყოს.');
        return;
      }

      if (/[<>"'&]/.test(username)) {
        socket.emit('authError', 'სახელში დაუშვებელი სიმბოლოებია.');
        return;
      }

      if (password.length < 6) {
        socket.emit('authError', 'პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს.');
        return;
      }

      if (findUser(username) || lower(username) === TESTER_NAME) {
        socket.emit('authError', 'ეს სახელი უკვე დაკავებულია.');
        return;
      }

      const passwordData = await makePassword(password);

      const user = defaults({
        id: uid('user'),
        username: username,
        passwordSalt: passwordData.salt,
        passwordHash: passwordData.hash,
        avatar: validAvatar(data.avatar),
        xp: 0,
        wins: 0,
        balance: START_BALANCE,
        achievements: [],
        quests: defaultQuests()
      });

      users.set(user.id, user);

      const token = newSession(user);
      await saveUsersNow();

      completeLogin(socket, user, token);
    } catch (error) {
      console.error('[REGISTER]', error);
      socket.emit('authError', 'რეგისტრაცია ვერ შესრულდა.');
    }
  });

  /* ---------------- LOGIN ---------------- */

  socket.on('login', async function (data) {
    data = data || {};

    const user = findUser(data.username);

    if (!user || !(await checkPassword(data.password || '', user))) {
      socket.emit('authError', 'სახელი ან პაროლი არასწორია.');
      return;
    }

    if (isExcluded(user)) {
      socket.emit(
        'authError',
        'ანგარიში დროებით შეჩერებულია შენივე მოთხოვნით. ' +
        (user.selfExcludedUntil === 'forever'
          ? 'ეს გადაწყვეტილება მუდმივია.'
          : 'შესვლა შესაძლებელი იქნება: ' + new Date(user.selfExcludedUntil).toLocaleString('ka-GE'))
      );
      return;
    }

    completeLogin(socket, user, newSession(user));
  });

  /* ---------------- TESTER ---------------- */

  socket.on('testerLogin', function () {
    if (!TESTER_ENABLED) {
      socket.emit('authError', 'სატესტო რეჟიმი გამორთულია.');
      return;
    }

    let user = findUser(TESTER_NAME);

    if (!user) {
      user = defaults({
        id: uid('tester'),
        username: TESTER_NAME,
        passwordSalt: '',
        passwordHash: '',
        avatar: '🧙',
        xp: 999,
        wins: 10,
        coins: 5000,
        balance: START_BALANCE,
        achievements: [],
        quests: defaultQuests(),
        tester: true
      });

      users.set(user.id, user);
    }

    if (isExcluded(user)) {
      socket.emit('authError', 'ეს ანგარიში შეჩერებულია.');
      return;
    }

    user.tester = true;
    completeLogin(socket, user, newSession(user));
    saveLater();
  });

  /* ---------------- SESSION ---------------- */

  socket.on('restoreSession', function (data) {
    data = data || {};

    const token = String(data.token || '');
    const session = sessions.get(token);
    const user = session ? users.get(session.userId) : null;

    if (!user || isExcluded(user)) {
      socket.emit('sessionInvalid');
      return;
    }

    completeLogin(socket, user, token);
  });

  socket.on('logout', function (data) {
    data = data || {};
    sessions.delete(String(data.token || ''));

    const user = users.get(socket.data.userId);
    if (user && user.socketId === socket.id) user.socketId = null;

    socket.data.userId = null;
    socket.emit('loggedOut');
  });

  /* ---------------- JOIN ---------------- */

  socket.on('joinTable', function (data) {
    joinRoom(socket, data || {});
  });

  /* ---------------- PLAY ---------------- */

  socket.on('playCards', function (data) {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.game) return;

    const player = room.players.find(function (item) { return item.id === socket.data.playerId; });
    if (!player) return;

    const active = room.players[room.game.current];

    if (!active || active.id !== player.id) {
      socket.emit('errorMessage', 'ახლა შენი სვლა არ არის.');
      return;
    }

    data = data || {};
    playCards(room, player, data.cardIndices || data.indexes || []);
  });

  /* ---------------- REACTIONS ---------------- */

  socket.on('quickMessage', function (data) {
    const room = rooms.get(socket.data.roomId) || dominoRooms.get(socket.data.dominoRoomId);
    if (!room) return;

    const now = Date.now();
    if (now - socket.data.lastChat < 1200) return;
    socket.data.lastChat = now;

    const message = String((data && data.text) || '');
    if (!QUICK_PHRASES.includes(message)) return;

    const isDomino = dominoRooms.has(room.id);

    io.to(isDomino ? 'domino:' + room.id : room.id).emit('quickMessage', {
      playerId: isDomino ? socket.data.dominoPlayerId : socket.data.playerId,
      text: message
    });
  });

  /* ---------------- THROWABLES ---------------- */

  socket.on('throwable', function (data) {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    data = data || {};

    const type = String(data.type || '');
    const catalogItem = shopItem('throwable', type);
    if (!catalogItem) return;

    if (catalogItem.price > 0) {
      const user = users.get(socket.data.userId);

      if (!user || defaults(user).inventory.throwable.indexOf(type) < 0) {
        socket.emit('errorMessage', 'ეს ნივთი ჯერ მაღაზიაში უნდა იყიდო.');
        return;
      }
    }

    const now = Date.now();

    if (now - socket.data.lastThrow < 1500) {
      socket.emit('errorMessage', 'ცოტა მოიცადე 🙂');
      return;
    }

    socket.data.lastThrow = now;

    const targetExists = room.players.some(function (player) {
      return player.id === data.targetPlayerId && player.id !== socket.data.playerId;
    });

    if (!targetExists) return;

    io.to(room.id).emit('throwableEvent', {
      fromPlayerId: socket.data.playerId,
      targetPlayerId: data.targetPlayerId,
      type: type
    });
  });

  /* ---------------- LEAVE TABLE ---------------- */

  socket.on('leaveTable', function () {
    const room = rooms.get(socket.data.roomId);

    if (!room) {
      socket.emit('leftTable');
      return;
    }

    const player = room.players.find(function (item) { return item.id === socket.data.playerId; });
    const user = users.get(socket.data.userId);

    socket.leave(room.id);
    socket.data.roomId = null;
    socket.data.playerId = null;

    if (user) user.roomId = null;

    if (!player) {
      socket.emit('leftTable');
      return;
    }

    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }

    if (room.game && !room.game.gameOver) {
      player.left = true;
      botTakeover(room, player, scheduleBot, broadcastGame);
    } else {
      const index = room.players.indexOf(player);
      if (index >= 0) room.players.splice(index, 1);

      if (room.players.length === 0 || (room.game && room.game.gameOver && room.players.every(function (p) { return p.isBot || !p.connected; }))) {
        cleanupRoom(room);
        rooms.delete(room.id);
      } else if (!room.game) {
        io.to(room.id).emit('waitingForPlayers', {
          roomId: room.id,
          roomName: room.name,
          current: room.players.length,
          max: room.capacity,
          players: room.players.map(function (p) { return { name: p.name, avatar: p.avatar }; })
        });
      }

      broadcastLobby();
    }

    socket.emit('leftTable');
  });

  /* ---------------- TOURNAMENT ---------------- */

  socket.on('registerTournament', function (data) {
    const user = users.get(socket.data.userId);
    if (!user) return;

    data = data || {};

    const tournament = tournaments.find(function (t) { return t.id === data.id; });
    if (!tournament || tournament.status !== 'registration') return;

    const idx = tournament.registered.indexOf(user.id);

    if (idx >= 0) {
      tournament.registered.splice(idx, 1);
    } else if (tournament.registered.length < tournament.maxPlayers) {
      tournament.registered.push(user.id);
    }

    io.emit('tournaments', tournamentData());
  });

  /* ---------------- LEADERBOARD ---------------- */

  socket.on('getLeaderboard', function () {
    const top = Array.from(users.values())
      .map(function (user) { return defaults(user); })
      .filter(function (user) { return !user.tester; })
      .sort(function (a, b) { return b.rating - a.rating; })
      .slice(0, 50)
      .map(friendSummary);

    socket.emit('leaderboardData', top);
  });

  /* ---------------- FRIENDS ---------------- */

  socket.on('getFriends', function () {
    const user = users.get(socket.data.userId);
    if (!user) return;
    defaults(user);
    sendFriends(socket, user);
  });

  socket.on('addFriend', function (data) {
    const user = users.get(socket.data.userId);
    if (!user) return;

    defaults(user);
    data = data || {};

    const target = findUser(data.username);

    if (!target || target.id === user.id) {
      socket.emit('errorMessage', 'მომხმარებელი ვერ მოიძებნა.');
      return;
    }

    if (user.friends.indexOf(target.id) < 0) {
      user.friends.push(target.id);
      saveLater();
    }

    sendFriends(socket, user);
  });

  socket.on('removeFriend', function (data) {
    const user = users.get(socket.data.userId);
    if (!user) return;

    defaults(user);
    data = data || {};

    user.friends = user.friends.filter(function (id) { return id !== data.id; });
    saveLater();
    sendFriends(socket, user);
  });

  socket.on('inviteFriend', function (data) {
    const user = users.get(socket.data.userId);
    if (!user || !socket.data.roomId) return;

    data = data || {};

    const friend = users.get(data.id);
    if (!friend || !friend.socketId) {
      socket.emit('errorMessage', 'მეგობარი ახლა ოფლაინ არის.');
      return;
    }

    io.to(friend.socketId).emit('tableInvite', { from: user.username, roomId: socket.data.roomId });
    socket.emit('toast', '📨 მოწვევა გაიგზავნა');
  });

  /* ---------------- SHOP / COSMETICS ---------------- */

  socket.on('buyItem', function (data) {
    const user = users.get(socket.data.userId);
    if (!user) return;

    defaults(user);
    data = data || {};

    const catalogItem = SHOP_ITEMS.find(function (candidate) { return candidate.id === data.itemId; });
    if (!catalogItem) return;

    const owned = user.inventory[catalogItem.type];

    if (owned.indexOf(catalogItem.key) >= 0) {
      socket.emit('errorMessage', 'ეს ნივთი უკვე გაქვს.');
      return;
    }

    if (user.coins < catalogItem.price) {
      socket.emit('errorMessage', 'მონეტები არ გყოფნის.');
      return;
    }

    user.coins -= catalogItem.price;
    owned.push(catalogItem.key);

    saveLater();

    socket.emit('profileUpdate', profile(user));
    socket.emit('purchaseSuccess', { itemId: catalogItem.id });
  });

  socket.on('equipCosmetic', function (data) {
    const user = users.get(socket.data.userId);
    if (!user) return;

    defaults(user);
    data = data || {};

    const slot = String(data.slot || '');
    const value = String(data.value || '');
    const catalogItem = shopItem(slot, value);

    if (!catalogItem || user.inventory[slot].indexOf(value) < 0) return;

    if (slot === 'avatar') {
      user.avatar = catalogItem.emoji;

      const room = rooms.get(socket.data.roomId);
      const player = room && room.players.find(function (p) { return p.userId === user.id; });

      if (player && !player.isBot) {
        player.avatar = user.avatar;
        broadcastGame(room);
      }
    } else if (slot !== 'throwable') {
      user.equipped[slot] = value;

      const room = rooms.get(socket.data.roomId);
      if (room) broadcastGame(room);
    }

    saveLater();
    socket.emit('profileUpdate', profile(user));
  });

  socket.on('updateAvatar', function (data) {
    const user = users.get(socket.data.userId);
    if (!user) return;

    user.avatar = validAvatar(data && data.avatar);
    saveLater();
    socket.emit('profileUpdate', profile(user));
  });

  /* ---------------- DAILY CHEST ---------------- */

  socket.on('claimChest', function () {
    const user = users.get(socket.data.userId);
    if (!user) return;

    defaults(user);

    if (user.lastChest === today()) {
      socket.emit('errorMessage', 'დღევანდელი ყუთი უკვე გახსნილია. ხვალ ისევ მოდი!');
      return;
    }

    const roll = Math.random();
    const reward = roll < 0.05 ? rand(300, 500) : roll < 0.3 ? rand(120, 250) : rand(40, 110);

    user.lastChest = today();
    user.coins += reward;

    saveLater();

    socket.emit('chestResult', { reward: reward });
    socket.emit('profileUpdate', profile(user));
  });

  /* ---------------- RESPONSIBLE GAMING ---------------- */

  socket.on('selfExclude', function (data) {
    const user = users.get(socket.data.userId);
    if (!user) return;

    data = data || {};

    const durations = { '24h': 24, '7d': 7 * 24, '30d': 30 * 24 };
    const duration = String(data.duration || '');

    if (durations[duration]) {
      user.selfExcludedUntil = new Date(Date.now() + durations[duration] * 3600 * 1000).toISOString();
    } else if (duration === 'forever') {
      user.selfExcludedUntil = 'forever';
    } else {
      return;
    }

    sessions.forEach(function (session, token) {
      if (session.userId === user.id) sessions.delete(token);
    });

    saveUsersNow().catch(console.error);
    socket.emit('selfExcluded', { until: user.selfExcludedUntil });
  });

  /* ---------------- DOMINO ---------------- */

  socket.on('dominoJoinTable', function (data) {
    joinDominoRoom(socket, data || {});
  });

  socket.on('dominoPlayTile', function (data) {
    data = data || {};

    const room = dominoRooms.get(socket.data.dominoRoomId);
    if (!room || !room.game) return;

    const player = room.players.find(function (p) { return p.id === socket.data.dominoPlayerId; });
    if (!player) return;

    const active = room.players[room.game.current];

    if (!active || active.id !== player.id) {
      socket.emit('dominoError', 'ახლა შენი სვლა არ არის.');
      return;
    }

    dominoPlaceTile(room, player, data.tileId, data.side);
  });

  socket.on('dominoLeaveTable', function () {
    const room = dominoRooms.get(socket.data.dominoRoomId);

    if (!room) {
      socket.emit('dominoLeftTable');
      return;
    }

    const player = room.players.find(function (p) { return p.id === socket.data.dominoPlayerId; });

    socket.leave('domino:' + room.id);
    socket.data.dominoRoomId = null;
    socket.data.dominoPlayerId = null;

    if (!player) {
      socket.emit('dominoLeftTable');
      return;
    }

    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }

    if (room.game && !room.game.gameOver) {
      player.left = true;
      botTakeover(room, player, scheduleDominoBot, broadcastDominoGame);
    } else {
      const index = room.players.indexOf(player);
      if (index >= 0) room.players.splice(index, 1);

      if (room.players.length === 0) {
        dominoCleanupRoom(room);
        dominoRooms.delete(room.id);
      }

      broadcastDominoLobby();
    }

    socket.emit('dominoLeftTable');
  });

  /* ---------------- DISCONNECT ---------------- */

  socket.on('disconnect', function () {
    io.emit('liveCount', liveCount());

    const dominoRoom = dominoRooms.get(socket.data.dominoRoomId);

    if (dominoRoom) {
      const dominoPlayer = dominoRoom.players.find(function (p) { return p.id === socket.data.dominoPlayerId; });

      if (dominoPlayer) {
        dominoPlayer.connected = false;
        dominoPlayer.socketId = null;

        broadcastDominoGame(dominoRoom);

        if (dominoPlayer.reconnectTimer) clearTimeout(dominoPlayer.reconnectTimer);

        dominoPlayer.reconnectTimer = setTimeout(function () {
          dominoPlayer.reconnectTimer = null;
          if (dominoPlayer.connected) return;

          if (dominoRoom.game && !dominoRoom.game.gameOver) {
            botTakeover(dominoRoom, dominoPlayer, scheduleDominoBot, broadcastDominoGame);
            return;
          }

          const index = dominoRoom.players.indexOf(dominoPlayer);
          if (index >= 0) dominoRoom.players.splice(index, 1);

          if (dominoRoom.players.length === 0) {
            dominoCleanupRoom(dominoRoom);
            dominoRooms.delete(dominoRoom.id);
          }

          broadcastDominoLobby();
        }, RECONNECT_MS);
      }
    }

    const room = rooms.get(socket.data.roomId);
    const user = users.get(socket.data.userId);

    if (user && user.socketId === socket.id) user.socketId = null;

    if (!room) return;

    const player = room.players.find(function (item) { return item.id === socket.data.playerId; });
    if (!player) return;

    player.connected = false;
    player.socketId = null;

    broadcastGame(room);

    if (player.reconnectTimer) clearTimeout(player.reconnectTimer);

    player.reconnectTimer = setTimeout(function () {
      player.reconnectTimer = null;
      if (player.connected) return;

      if (room.game && !room.game.gameOver) {
        botTakeover(room, player, scheduleBot, broadcastGame);
        return;
      }

      const index = room.players.indexOf(player);
      if (index >= 0) room.players.splice(index, 1);

      if (room.players.length === 0) {
        cleanupRoom(room);
        rooms.delete(room.id);
      }

      broadcastLobby();
    }, RECONNECT_MS);
  });
});

setInterval(function () {
  dominoRooms.forEach(function (room, id) {
    const connectedHumans = room.players.filter(function (p) { return !p.isBot && p.connected; });

    if ((room.game && room.game.gameOver && connectedHumans.length === 0) || (!room.game && room.players.length === 0)) {
      dominoCleanupRoom(room);
      dominoRooms.delete(id);
    }
  });

  broadcastDominoLobby();
}, 60000);


/* ============================================================
   MONOLITHIC PAGE (HTML + CSS + client JS)
   ============================================================ */

const PAGE = String.raw`<!doctype html>
<html lang="ka">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07130e">
<title>წერითი ბურა — Written Bura</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%83%8F%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Georgian:wght@400;600;700;800&family=Noto+Serif+Georgian:wght@600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
:root{
 --night:#07130e;
 --night-2:#0c1e17;
 --panel:rgba(14,32,25,.72);
 --line:rgba(214,168,73,.18);
 --line-soft:rgba(255,255,255,.08);
 --brass:#d6a849;
 --brass-hi:#f3d690;
 --brass-deep:#8a6420;
 --cream:#f6f0e1;
 --muted:#9fb3a8;
 --cherry:#c0303c;
 --good:#43c98a;
 --walnut:#4a2a17;
 --felt-a:#12704a;
 --felt-b:#063623;
 --serif:"Noto Serif Georgian",Georgia,"Times New Roman",serif;
 --sans:"Noto Sans Georgian","Segoe UI",system-ui,sans-serif;
 --ease-pop:cubic-bezier(.34,1.56,.64,1);
 --noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")
}
html,body{margin:0;min-height:100%;background:var(--night);color:var(--cream);font-family:var(--sans);-webkit-tap-highlight-color:transparent}
body{overflow-x:hidden}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--brass-hi);outline-offset:2px}
.hidden{display:none!important}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}

/* ---------- room background ---------- */
.room-bg{position:fixed;inset:0;z-index:-2;
 background:
  radial-gradient(ellipse 60% 45% at 50% 18%,rgba(255,196,110,.13),transparent 70%),
  radial-gradient(ellipse 90% 70% at 50% 110%,rgba(10,70,45,.55),transparent 70%),
  linear-gradient(180deg,#0a1813,#050d0a)}
.room-bg:after{content:"";position:absolute;inset:0;background-image:var(--noise);opacity:.18;mix-blend-mode:overlay}
#fx{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:900}

/* ---------- shared controls ---------- */
.btn{border:1px solid var(--line);background:linear-gradient(180deg,#183a2d,#0e251c);color:var(--cream);border-radius:12px;padding:10px 14px;font-weight:600;transition:transform .15s,box-shadow .15s,background .15s;display:inline-flex;align-items:center;gap:7px;justify-content:center}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.35)}
.btn:active{transform:translateY(1px)}
.btn.small{padding:7px 11px;font-size:13px;border-radius:10px}
.btn.danger{background:linear-gradient(180deg,#5a1720,#3a0c13);border-color:rgba(255,120,130,.35)}
.btn.ghost{background:rgba(255,255,255,.04);border-color:var(--line-soft)}
.btn-brass{border:0;border-radius:14px;padding:13px 20px;font-weight:800;color:#2a1c05;letter-spacing:.2px;
 background:linear-gradient(180deg,#f7dc93 0%,#d6a849 45%,#a87a26 100%);
 box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -2px 0 rgba(0,0,0,.2),0 8px 22px rgba(214,168,73,.28);
 transition:transform .15s,box-shadow .15s,filter .15s}
.btn-brass:hover{transform:translateY(-2px);filter:brightness(1.05)}
.btn-brass:disabled{filter:grayscale(.9) brightness(.55);box-shadow:none;cursor:not-allowed;transform:none}
.field{width:100%;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(3,12,9,.7);color:var(--cream);transition:border-color .15s,box-shadow .15s}
.field:focus{outline:none;border-color:var(--brass);box-shadow:0 0 0 3px rgba(214,168,73,.18)}
select.field{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--brass) 50%),linear-gradient(135deg,var(--brass) 50%,transparent 50%);background-position:calc(100% - 18px) 55%,calc(100% - 13px) 55%;background-size:5px 5px;background-repeat:no-repeat}
.seg{display:flex;gap:4px;padding:4px;border-radius:13px;background:rgba(0,0,0,.28);border:1px solid var(--line-soft)}
.seg button{flex:1;border:0;background:transparent;border-radius:9px;padding:9px 8px;color:var(--muted);font-weight:700;transition:background .15s,color .15s}
.seg button.on{background:linear-gradient(180deg,#f7dc93,#c89a3c);color:#2a1c05;box-shadow:0 3px 10px rgba(214,168,73,.3)}
.panel{background:var(--panel);border:1px solid var(--line-soft);border-radius:20px;padding:18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 20px 50px rgba(0,0,0,.3)}
.panel h2{font-family:var(--serif);font-weight:700;font-size:19px;margin:0 0 14px;color:var(--brass-hi)}
.label{font-size:12.5px;color:var(--muted);margin:14px 0 6px;display:block}
.error{color:#ff9aa4;min-height:20px;margin:8px 0;font-size:14px}
.muted{color:var(--muted)}

/* ---------- toasts ---------- */
#toasts{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:1200;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.toast{padding:11px 18px;border-radius:14px;background:rgba(12,26,20,.95);border:1px solid var(--line);box-shadow:0 14px 40px rgba(0,0,0,.5);font-size:14px;animation:toastIn .35s var(--ease-pop);max-width:90vw;text-align:center}
.toast.gold{background:linear-gradient(180deg,#2d2108,#171004);border-color:var(--brass)}
@keyframes toastIn{from{transform:translateY(-16px) scale(.96);opacity:0}}

/* ---------- avatars ---------- */
.av{--as:64px;position:relative;width:var(--as);height:var(--as);flex:none}
.av-core{position:absolute;inset:0;border-radius:50%;overflow:hidden;display:grid;place-items:center;
 background:radial-gradient(circle at 34% 28%,hsl(var(--hue,150) 42% 44%),hsl(var(--hue,150) 48% 16%) 72%,hsl(var(--hue,150) 50% 8%));
 box-shadow:inset 0 -8px 16px rgba(0,0,0,.55),inset 0 3px 6px rgba(255,255,255,.2),0 8px 20px rgba(0,0,0,.55)}
.av-core .emo{font-size:calc(var(--as)*.56);line-height:1;transform:translateY(5%);filter:drop-shadow(0 5px 4px rgba(0,0,0,.45))}
.av-core img{width:100%;height:100%;object-fit:cover}
.av-core:after{content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none;background:radial-gradient(ellipse 60% 38% at 42% 16%,rgba(255,255,255,.38),transparent 70%)}
.av-ring{position:absolute;inset:calc(var(--as)*-.08);border-radius:50%;pointer-events:none;
 -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));
 mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 4px));
 filter:drop-shadow(0 0 5px var(--glow,transparent))}
.av-ring.anim{animation:spin 3.5s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.av-timer{position:absolute;inset:calc(var(--as)*-.17);width:calc(100% + var(--as)*.34);height:calc(100% + var(--as)*.34);transform:rotate(-90deg);pointer-events:none;opacity:0;transition:opacity .2s}
.av-timer circle{fill:none;stroke-width:4;stroke-linecap:round;stroke:var(--good);filter:drop-shadow(0 0 4px currentColor)}
.av.turn .av-timer{opacity:1}
.av-lvl{position:absolute;right:-6px;bottom:-2px;min-width:24px;height:22px;border-radius:11px;padding:0 6px;display:grid;place-items:center;font-size:10.5px;font-weight:800;color:#2a1c05;background:linear-gradient(180deg,#f7dc93,#b8862d);box-shadow:0 3px 8px rgba(0,0,0,.5);z-index:2}
.av.off .av-core{filter:grayscale(1) brightness(.55)}
.av.sooty .av-core{filter:brightness(.35) sepia(.6) contrast(1.2)}
.av.frozen .av-core{filter:hue-rotate(160deg) saturate(.5) brightness(1.3)}
.av.shocked .av-core{animation:shock .12s steps(2) infinite}
@keyframes shock{0%{filter:brightness(2) contrast(1.5);transform:translate(-1px,1px)}100%{filter:invert(1);transform:translate(1px,-1px)}}
.av.hit{animation:hit .45s ease}
@keyframes hit{0%,100%{transform:none}20%{transform:translate(-5px,2px) rotate(-7deg) scale(.95)}45%{transform:translate(5px,-2px) rotate(6deg)}70%{transform:translate(-2px,1px) rotate(-3deg)}}

/* ---------- AUTH ---------- */
.auth-wrap{min-height:100vh;display:grid;grid-template-columns:1.15fr .85fr;align-items:center;gap:40px;width:min(1180px,94vw);margin:0 auto;padding:40px 0}
.auth-hero{position:relative}
.logo{font-family:var(--serif);font-weight:800;line-height:.95;margin:0;font-size:clamp(46px,7vw,92px);letter-spacing:-1px;
 background:linear-gradient(180deg,#fff3cf 0%,#e8c26c 45%,#9a6b1c 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 18px rgba(0,0,0,.6))}
.logo small{display:block;font-size:.34em;letter-spacing:6px;font-family:var(--sans);font-weight:600;margin-top:10px;color:var(--muted);-webkit-text-fill-color:var(--muted)}
.hero-fan{position:relative;height:230px;margin:10px 0 26px 20px}
.hero-fan .card{position:absolute;left:0;top:30px;--cw:112px;transform-origin:50% 120%;animation:heroIn 1s var(--ease-pop) backwards}
@keyframes heroIn{from{transform:translateY(80px) rotate(0) scale(.7);opacity:0}}
.hero-copy{font-size:17px;line-height:1.6;color:#d7e2dc;max-width:470px;margin:0 0 22px}
.feat{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;max-width:520px}
.feat li{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#cfdad4;line-height:1.45}
.feat li span{font-size:19px}
.auth-card{padding:30px;border-radius:24px}
.auth-card .logo{display:none;font-size:48px;text-align:center;margin-bottom:6px}
.auth-card .fieldset{display:flex;flex-direction:column;gap:10px;margin:18px 0 6px}
.avatar-pick{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
.avatar-pick .av{--as:46px;cursor:pointer;opacity:.6;transition:opacity .15s,transform .15s}
.avatar-pick .av.on{opacity:1;transform:scale(1.08)}
.avatar-pick .av.on .av-ring{inset:-4px;background:var(--brass)!important}
.upload{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px;margin-top:4px}
.upload input{max-width:210px;font-size:12px}
.tester{width:100%;margin-top:10px}
@media(max-width:900px){
 .auth-wrap{grid-template-columns:1fr;padding:24px 0}
 .auth-hero{display:none}
 .auth-card .logo{display:block}
}

/* ---------- LOBBY ---------- */
.topbar{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:14px;padding:12px max(3vw,14px);background:linear-gradient(180deg,rgba(6,16,12,.95),rgba(6,16,12,.75));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line-soft)}
.topbar .logo{font-size:28px;letter-spacing:0;filter:none}
.nav{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.nav .btn{font-size:13px;padding:8px 11px}
.wallet{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:rgba(0,0,0,.35);border:1px solid var(--line);font-weight:800;color:var(--brass-hi)}
.coin{display:inline-block;width:18px;height:18px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff3c2,#e0ae3c 45%,#8a5d12);box-shadow:inset 0 -2px 2px rgba(0,0,0,.35),0 1px 3px rgba(0,0,0,.5);vertical-align:-3px}
.live{font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
.live i{width:8px;height:8px;border-radius:50%;background:var(--good);box-shadow:0 0 8px var(--good);animation:blink 2s infinite}
@keyframes blink{50%{opacity:.35}}
.lobby-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px;width:min(1240px,94vw);margin:22px auto 50px}
.col-main,.col-side{display:flex;flex-direction:column;gap:18px}
.mode-tabs{display:flex;gap:10px}
.mode-tab{flex:1;display:flex;align-items:center;gap:14px;padding:16px 18px;border-radius:18px;border:1px solid var(--line-soft);background:rgba(10,26,20,.6);text-align:left;transition:border-color .2s,background .2s}
.mode-tab b{font-family:var(--serif);font-size:20px;display:block}
.mode-tab small{color:var(--muted)}
.mode-tab .ico{font-size:34px}
.mode-tab.on{border-color:var(--brass);background:linear-gradient(135deg,rgba(214,168,73,.16),rgba(10,26,20,.7));box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 0 0 1px rgba(214,168,73,.25)}
.create-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
.create-actions{display:flex;gap:10px;margin-top:18px}
.create-actions .btn-brass{flex:1}
.table-list{display:flex;flex-direction:column;gap:8px}
.table-row{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:14px;background:rgba(0,0,0,.2);border:1px solid var(--line-soft);transition:background .15s}
.table-row:hover{background:rgba(214,168,73,.07)}
.table-row .mini-felt{width:54px;height:36px;border-radius:50%;background:radial-gradient(ellipse at 50% 40%,#1b8a5c,#07402a);box-shadow:inset 0 0 0 3px #5a341c,0 3px 8px rgba(0,0,0,.4);display:grid;place-items:center;font-size:13px;flex:none}
.table-row .info{flex:1;min-width:0}
.table-row .info b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.table-row .info small{color:var(--muted)}
.seated{display:flex}
.seated span{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#15392b;border:2px solid #0c2019;margin-left:-7px;font-size:14px}
.seated span.empty{background:transparent;border:2px dashed rgba(255,255,255,.18)}
.empty-state{padding:22px;text-align:center;color:var(--muted);border:1px dashed var(--line-soft);border-radius:14px}

.profile-card{text-align:center;position:relative;overflow:hidden}
.profile-card:before{content:"";position:absolute;inset:0 0 auto;height:90px;background:radial-gradient(ellipse at 50% 0,rgba(214,168,73,.28),transparent 70%)}
.profile-card .av{--as:92px;margin:6px auto 10px}
.profile-card .pname{font-family:var(--serif);font-size:22px;font-weight:700}
.title-plate{display:inline-block;margin-top:4px;padding:2px 10px;border-radius:6px;font-size:11.5px;font-weight:700;color:#2a1c05;background:linear-gradient(180deg,#f7dc93,#b8862d);box-shadow:0 2px 6px rgba(0,0,0,.4)}
.rank-line{display:flex;justify-content:center;gap:8px;margin:10px 0 12px;flex-wrap:wrap}
.chip{font-size:12.5px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid var(--line-soft)}
.xpbar{height:9px;border-radius:9px;background:rgba(0,0,0,.4);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
.xpbar i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#9a6b1c,#f3d690);box-shadow:0 0 10px rgba(243,214,144,.6);transition:width .6s}
.xp-meta{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:5px}
.mini-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.mini-stats div{padding:9px 4px;border-radius:12px;background:rgba(0,0,0,.22)}
.mini-stats b{display:block;font-size:18px;color:var(--brass-hi)}
.mini-stats small{font-size:11px;color:var(--muted)}
.chest{display:flex;align-items:center;gap:14px}
.chest-box{font-size:44px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.5));transition:transform .3s}
.chest.ready .chest-box{animation:wobble 2.4s ease-in-out infinite}
@keyframes wobble{0%,70%,100%{transform:rotate(0)}75%{transform:rotate(-9deg) scale(1.06)}82%{transform:rotate(8deg) scale(1.06)}90%{transform:rotate(-4deg)}}
.chest .txt{flex:1}
.chest .txt b{display:block}
.chest .txt small{color:var(--muted)}
.quest{padding:12px;border-radius:14px;background:rgba(0,0,0,.22);margin-bottom:8px}
.quest.done{border:1px solid rgba(67,201,138,.4)}
.quest-top{display:flex;justify-content:space-between;gap:8px;font-size:14px}
.quest-top small{color:var(--brass-hi);white-space:nowrap}
.quest .xpbar{height:7px;margin-top:8px}
.tour-row{display:flex;align-items:center;gap:12px}
.tour-row .trophy{font-size:34px}
.tour-row .info{flex:1}
.tour-row small{color:var(--muted);display:block}
@media(max-width:980px){
 .lobby-grid{grid-template-columns:1fr}
 .nav .lbl{display:none}
 .topbar .logo{font-size:22px}
 .live{display:none}
}
@media(max-width:560px){
 .create-grid{grid-template-columns:1fr}
 .mode-tab small{display:none}
 .topbar{gap:8px;flex-wrap:wrap}
}

/* ---------- CARDS ---------- */
.card{--cw:76px;width:var(--cw);height:calc(var(--cw)*1.4);border-radius:calc(var(--cw)*.085);position:relative;flex:none;user-select:none;-webkit-user-select:none;
 background:linear-gradient(165deg,#fffdf6 0%,#f6efdd 60%,#ebe2cb 100%);
 box-shadow:inset 0 0 0 1px rgba(255,255,255,.9),0 0 0 1px rgba(40,30,10,.22),0 calc(var(--cw)*.06) calc(var(--cw)*.14) rgba(0,0,0,.45);
 font-family:var(--serif);color:#151515;will-change:transform}
.card:before{content:"";position:absolute;inset:0;border-radius:inherit;background-image:var(--noise);opacity:.12;mix-blend-mode:multiply;pointer-events:none}
.card:after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(125deg,rgba(255,255,255,.55),transparent 32%,transparent 70%,rgba(0,0,0,.05))}
.card.hearts{color:#c1121f}.card.diamonds{color:#1d5fb3}.card.clubs{color:#1e7a4f}.card.spades{color:#141414}
.corner{position:absolute;display:flex;flex-direction:column;align-items:center;line-height:.9;font-weight:700;z-index:1}
.corner.tl{top:5%;left:6%}
.corner.br{bottom:5%;right:6%;transform:rotate(180deg)}
.corner b{font-size:calc(var(--cw)*.22);letter-spacing:-1px}
.corner i{font-style:normal;font-size:calc(var(--cw)*.17)}
.pips{position:absolute;inset:14% 20%}
.pip{position:absolute;transform:translate(-50%,-50%);font-size:calc(var(--cw)*.2);line-height:1}
.pip.flip{transform:translate(-50%,-50%) rotate(180deg)}
.ace-pip{position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--cw)*.58);filter:drop-shadow(0 2px 1px rgba(0,0,0,.18))}
.court{position:absolute;inset:15% 19%;border-radius:calc(var(--cw)*.04);border:1.5px solid currentColor;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;
 background:linear-gradient(180deg,rgba(214,168,73,.28),rgba(214,168,73,.08) 50%,rgba(214,168,73,.28))}
.court:before{content:"";position:absolute;left:0;right:0;top:50%;border-top:1px dashed currentColor;opacity:.35}
.court .fig{font-size:calc(var(--cw)*.36);line-height:1;filter:drop-shadow(0 1px 0 rgba(255,255,255,.7))}
.court .lt{font-size:calc(var(--cw)*.16);font-weight:800;opacity:.85}
.card.back{background:var(--back,linear-gradient(145deg,#1e428f,#0b1c4a));background-size:var(--backsize,auto);border:calc(var(--cw)*.055) solid #f5eedc;box-shadow:0 0 0 1px rgba(0,0,0,.25),0 calc(var(--cw)*.05) calc(var(--cw)*.12) rgba(0,0,0,.45)}
.card.back:after{background:linear-gradient(125deg,rgba(255,255,255,.25),transparent 35%)}
.card.back .emb{position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--cw)*.34);color:rgba(243,214,144,.9);text-shadow:0 1px 2px rgba(0,0,0,.6)}
.card.back .emb:before{content:"";position:absolute;width:calc(var(--cw)*.5);height:calc(var(--cw)*.5);border-radius:50%;border:1.5px solid rgba(243,214,144,.55);box-shadow:0 0 0 3px rgba(0,0,0,.18)}
.card.back.dark .emb{color:#5b4a2a}

/* ---------- GAME LAYOUT ---------- */
#game{height:100vh;height:100dvh;display:grid;grid-template-rows:auto 1fr auto;overflow:hidden}
.game-top{display:flex;align-items:center;gap:10px;padding:10px 14px;flex-wrap:wrap}
.hud{display:flex;gap:6px;flex-wrap:wrap}
.pill{display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(0,0,0,.4);border:1px solid var(--line-soft);font-size:13px;color:var(--muted)}
.pill b{color:var(--cream);font-size:14px}
.pill .suit-red{color:#ff5a64}
.tools{display:flex;gap:6px;margin-left:auto;align-items:center;flex-wrap:wrap}
.vol{width:80px;accent-color:var(--brass)}
.arena{position:relative;display:grid;place-items:center;min-height:0;padding:40px 80px 6px}
@media(min-width:1321px){.arena{padding-right:300px;padding-left:90px}}
.table-outer{position:relative;width:min(1080px,100%,calc((100dvh - 360px)*1.9));aspect-ratio:1.9/1;border-radius:50%/50%;
 background:
  linear-gradient(180deg,rgba(255,255,255,.12),transparent 30%,rgba(0,0,0,.35)),
  repeating-linear-gradient(97deg,rgba(0,0,0,.14) 0 2px,transparent 2px 9px,rgba(255,220,180,.05) 9px 11px,transparent 11px 19px),
  linear-gradient(180deg,#6a3d22,#3c2011);
 box-shadow:0 50px 90px rgba(0,0,0,.75),0 14px 30px rgba(0,0,0,.5),inset 0 2px 1px rgba(255,220,180,.35),inset 0 -4px 10px rgba(0,0,0,.5);
 padding:2.4%}
.table-rail{width:100%;height:100%;border-radius:50%;padding:2.2%;
 background:radial-gradient(ellipse at 50% 30%,#3a2a22,#1a110c 70%);
 box-shadow:inset 0 3px 6px rgba(255,255,255,.12),inset 0 -6px 14px rgba(0,0,0,.7),0 0 0 2px rgba(0,0,0,.5)}
.table-rail:before{content:"";position:absolute;inset:3.4%;border-radius:50%;border:1px dashed rgba(214,168,73,.28);pointer-events:none}
.table-felt{position:relative;width:100%;height:100%;border-radius:50%;overflow:hidden;
 background-color:var(--felt-b);
 box-shadow:inset 0 0 0 2px rgba(0,0,0,.4),inset 0 12px 40px rgba(0,0,0,.55),inset 0 -10px 60px rgba(0,0,0,.45)}
.table-felt:before{content:"";position:absolute;inset:0;background-image:var(--noise);opacity:.35;mix-blend-mode:overlay;pointer-events:none}
.table-felt:after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 55% 60% at 50% 42%,rgba(255,236,190,.16),transparent 70%),radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,.45))}
.felt-print{position:absolute;inset:9% 12%;border-radius:50%;border:2px solid rgba(243,214,144,.14);pointer-events:none}
.felt-print span{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);font-family:var(--serif);font-size:clamp(12px,1.6vw,20px);color:rgba(243,214,144,.14);white-space:nowrap;letter-spacing:4px}
.trump-mark{position:absolute;left:50%;top:21%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;z-index:1}
.trump-mark .sym{font-size:clamp(40px,6vw,76px);line-height:1;color:rgba(255,255,255,.1);text-shadow:0 2px 0 rgba(0,0,0,.35),0 -1px 0 rgba(255,255,255,.08)}
.trump-mark.red .sym{color:rgba(255,120,120,.14)}
.trump-mark small{display:block;font-size:12px;color:rgba(243,214,144,.45);margin-top:-4px}
.deck-stack{position:absolute;left:14%;top:50%;transform:translate(-50%,-50%) rotate(-8deg);z-index:2}
.deck-stack .card{--cw:clamp(40px,4.8vw,62px);position:absolute;left:0;top:0}
.deck-stack .count{position:absolute;left:50%;top:calc(clamp(40px,4.8vw,62px)*1.4 + 10px);transform:translateX(-50%) rotate(8deg);font-size:12px;font-weight:800;color:var(--brass-hi);background:rgba(0,0,0,.5);padding:2px 8px;border-radius:9px;white-space:nowrap}
.deck-stack.empty{opacity:0;transition:opacity .4s}
.center-cards{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);display:flex;gap:clamp(8px,1.6vw,22px);align-items:flex-start;justify-content:center;flex-wrap:wrap;width:78%;z-index:5}
.play-group{display:flex;flex-direction:column;align-items:center;gap:5px}
.play-group .cards{display:flex}
.play-group .card{--cw:clamp(40px,5vw,64px);margin-left:calc(var(--cw)*-.42)}
.play-group .card:first-child{margin-left:0}
.play-group .who{font-size:11px;color:rgba(246,240,225,.75);background:rgba(0,0,0,.35);padding:2px 8px;border-radius:8px;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis}
.play-group.win .card{box-shadow:0 0 0 2px #f3d690,0 0 22px rgba(243,214,144,.85),0 8px 16px rgba(0,0,0,.45)}
.play-group.win .who{background:linear-gradient(180deg,#f7dc93,#b8862d);color:#2a1c05;font-weight:800}
.play-group.cut .cards{animation:cutFlash .5s ease}
@keyframes cutFlash{0%{filter:brightness(2.2)}100%{filter:none}}
.maliutka-banner{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;font-family:var(--serif);font-weight:800;font-size:clamp(34px,6vw,72px);white-space:nowrap;pointer-events:none;
 background:linear-gradient(180deg,#fff3cf,#e8a63c 60%,#b3261e);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 14px rgba(0,0,0,.7));animation:banner 1.8s ease forwards}
@keyframes banner{0%{transform:translate(-50%,-50%) scale(.3);opacity:0}15%{transform:translate(-50%,-50%) scale(1.15);opacity:1}25%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{transform:translate(-50%,-60%) scale(1.05);opacity:0}}

/* ---------- SEATS ---------- */
.seat{position:absolute;transform:translate(-50%,-50%);z-index:10;display:flex;flex-direction:column;align-items:center;gap:4px;transition:left .3s,top .3s}
.seat .av{--as:clamp(50px,5.6vw,72px);cursor:default}
.seat.opp .av{cursor:pointer}
.seat .plate{display:flex;flex-direction:column;align-items:center;padding:3px 10px 4px;border-radius:9px;min-width:92px;max-width:150px;
 background:linear-gradient(180deg,rgba(20,14,8,.92),rgba(8,6,3,.92));border:1px solid rgba(214,168,73,.35);box-shadow:0 6px 14px rgba(0,0,0,.5)}
.seat .plate .nm{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px}
.seat .plate .tt{font-size:10px;color:var(--brass-hi)}
.seat .plate .sc{font-size:11.5px;color:var(--muted);display:flex;gap:8px}
.seat .plate .sc b{color:var(--brass-hi)}
.seat .plate .sc b.neg{color:#ff8e98}
.seat.active .plate{border-color:var(--brass);box-shadow:0 0 18px rgba(214,168,73,.45),0 6px 14px rgba(0,0,0,.5)}
.seat .mini-hand{display:flex;height:34px;margin-top:2px}
.seat .mini-hand .card{--cw:24px;margin-left:-15px;box-shadow:0 2px 4px rgba(0,0,0,.5)}
.seat .mini-hand .card:first-child{margin-left:0}
.seat .bubble{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);background:#fffaf0;color:#1c1408;padding:8px 12px;border-radius:14px;font-size:13px;font-weight:700;white-space:nowrap;box-shadow:0 8px 20px rgba(0,0,0,.45);animation:bubble .35s var(--ease-pop);z-index:40;pointer-events:none}
.seat .bubble:after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:7px solid transparent;border-top-color:#fffaf0}
@keyframes bubble{from{transform:translateX(-50%) scale(.4);opacity:0}}
.seat .thinking{position:absolute;top:-6px;right:-10px;background:rgba(0,0,0,.7);border-radius:10px;padding:2px 7px;font-size:12px;letter-spacing:2px;animation:blink 1s infinite}

/* ---------- MY HAND ---------- */
.hand-zone{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:0 12px 22px;z-index:20}
.action-bar{display:flex;align-items:center;gap:14px;min-height:48px}
.status{font-size:14px;color:var(--muted);text-align:right;min-width:170px}
.status.mine{color:var(--brass-hi);font-weight:700}
.turn-clock{font-variant-numeric:tabular-nums;font-weight:800;padding:4px 10px;border-radius:9px;background:rgba(0,0,0,.4);min-width:44px;text-align:center}
.turn-clock.low{color:#ff8e98;animation:blink .5s infinite}
.hand{--hcw:clamp(70px,6.4vw,92px);display:flex;justify-content:center;align-items:flex-start;height:calc(var(--hcw)*1.4 + 34px);padding-top:26px}
.hand .card{--cw:var(--hcw,96px);margin-left:calc(var(--cw)*-.2);cursor:pointer;transform-origin:50% 130%;transition:transform .22s var(--ease-pop),box-shadow .2s}
.hand .card:first-child{margin-left:0}
.hand.myturn .card:hover{transform:var(--fan) translateY(-14px)}
.hand .card.sel{transform:var(--fan) translateY(-28px)!important;box-shadow:0 0 0 3px var(--brass-hi),0 0 26px rgba(243,214,144,.7),0 16px 24px rgba(0,0,0,.5)}
.hand .card.trumpc .corner.tl:after{content:"";position:absolute;left:50%;top:calc(100% + 3px);transform:translateX(-50%);width:6px;height:6px;border-radius:50%;background:var(--brass);box-shadow:0 0 5px var(--brass)}
.hand.dim .card{filter:brightness(.82)}
.me-seat{position:absolute;left:max(12px,calc(50% - 480px));bottom:26px;display:flex;align-items:center;gap:10px}
.me-seat .av{--as:64px}

/* ---------- SIDE PANEL ---------- */
.side{position:fixed;right:12px;top:64px;width:250px;max-height:calc(100dvh - 90px);overflow:auto;z-index:60;display:flex;flex-direction:column;gap:10px}
.side .panel{padding:14px;border-radius:16px}
.side h3{margin:0 0 8px;font-family:var(--serif);font-size:15px;color:var(--brass-hi);font-weight:700}
.score-row{display:flex;align-items:center;gap:8px;padding:6px 6px;border-radius:9px;font-size:13px}
.score-row.lead{background:rgba(214,168,73,.12)}
.score-row .n{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.score-row .t{font-weight:800;color:var(--brass-hi);font-size:15px}
.score-row .t.neg{color:#ff8e98}
.score-row .cap{font-size:11px;color:var(--muted)}
.hist{font-size:11.5px;color:#c6d3cc;padding:7px 4px;border-top:1px solid var(--line-soft)}
.hist b{color:var(--brass-hi)}
.hist .z{color:#ff8e98}
.phrases{display:flex;flex-wrap:wrap;gap:5px}
.phrases button{border:1px solid var(--line-soft);background:rgba(255,255,255,.05);border-radius:9px;padding:6px 8px;font-size:11.5px}
.fair{font-size:10.5px;color:var(--muted);word-break:break-all}
.side-toggle{display:none}
@media(max-width:1320px){
 .side{transform:translateX(calc(100% + 20px));transition:transform .3s}
 .side.open{transform:none}
 .side-toggle{display:inline-flex}
}
@media(max-width:1100px){.me-seat{left:10px;bottom:auto;top:-6px}.me-seat .av{--as:46px}.me-seat .plate{display:none!important}}
@media(max-width:760px){
 .arena{padding:30px 8px 4px}
 .table-outer{aspect-ratio:1.25/1;width:min(100%,calc((100dvh - 300px)*1.25))}
 .hand{--hcw:62px}
 .hand .card{margin-left:calc(var(--cw)*-.12)}
 .seat .plate{min-width:70px;padding:2px 6px}
 .seat .plate .nm{font-size:11.5px;max-width:86px}
 .seat .mini-hand{display:none}
 .pill{font-size:11px;padding:5px 9px}
 .tools .vol,.tools .lbl{display:none}
 .status{min-width:0;font-size:12.5px}
 .action-bar{padding-left:60px;gap:8px}
 .seat .av{--as:46px}
 .deck-stack{left:12%}
}

/* ---------- MENUS & MODALS ---------- */
.pop{position:fixed;z-index:1000;background:rgba(10,22,17,.97);border:1px solid var(--line);border-radius:18px;padding:10px;box-shadow:0 20px 60px rgba(0,0,0,.6);animation:toastIn .25s var(--ease-pop)}
.throw-grid{display:grid;grid-template-columns:repeat(6,46px);gap:6px}
.throw-grid button{width:46px;height:46px;border-radius:12px;border:1px solid var(--line-soft);background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.1),rgba(0,0,0,.2));font-size:24px;position:relative;transition:transform .12s}
.throw-grid button:hover{transform:scale(1.12) rotate(-6deg)}
.throw-grid button.locked{opacity:.35}
.throw-grid button.locked:after{content:"🔒";position:absolute;right:-3px;bottom:-3px;font-size:12px}
.pop h4{margin:2px 4px 8px;font-size:13px;color:var(--muted);font-weight:600}
.felt-grid{display:grid;grid-template-columns:repeat(5,40px);gap:8px}
.felt-grid button{width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,255,255,.25);position:relative}
.felt-grid button.on{border-color:var(--brass-hi);box-shadow:0 0 12px rgba(243,214,144,.7)}
.felt-grid button.locked{opacity:.35}
.modal{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:16px;background:rgba(2,6,4,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.modal-box{width:min(820px,96vw);max-height:88dvh;overflow:auto;border-radius:24px;padding:24px;background:linear-gradient(180deg,#10261d,#0a1813);border:1px solid var(--line);box-shadow:0 30px 90px rgba(0,0,0,.7);animation:toastIn .3s var(--ease-pop);position:relative}
.modal-box h2{font-family:var(--serif);color:var(--brass-hi);margin:0 0 16px;font-size:24px;padding-right:40px}
.modal-x{position:absolute;right:16px;top:16px;width:36px;height:36px;border-radius:50%;border:1px solid var(--line-soft);background:rgba(255,255,255,.05);font-size:16px}
.rule{background:rgba(255,255,255,.04);border-radius:14px;padding:13px 15px;margin:8px 0;line-height:1.6;font-size:14.5px}
.rule b{color:var(--brass-hi)}
.lb-row{display:flex;align-items:center;gap:12px;padding:9px 6px;border-bottom:1px solid var(--line-soft)}
.lb-row .pos{width:28px;text-align:center;font-weight:800;color:var(--muted)}
.lb-row:nth-child(1) .pos{color:#ffd75e;font-size:18px}
.lb-row:nth-child(2) .pos{color:#dcdce6}
.lb-row:nth-child(3) .pos{color:#d8965e}
.lb-row .av{--as:38px}
.lb-row .who{flex:1;min-width:0}
.lb-row .who b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-row .who small{color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;background:#3a4a44;display:inline-block}
.dot.on{background:var(--good);box-shadow:0 0 6px var(--good)}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stat-grid div{background:rgba(0,0,0,.25);border-radius:14px;padding:14px 8px;text-align:center}
.stat-grid b{display:block;font-size:24px;color:var(--brass-hi);font-family:var(--serif)}
.stat-grid small{color:var(--muted);font-size:12px}
.spark{display:flex;align-items:flex-end;gap:3px;height:70px;margin-top:10px;padding:6px;border-radius:12px;background:rgba(0,0,0,.2)}
.spark i{flex:1;border-radius:3px 3px 0 0;min-height:4px}
.spark i.w{background:linear-gradient(180deg,#6be3a9,#1f8a57)}
.spark i.l{background:linear-gradient(180deg,#ff8e98,#8a1f2b)}
.friend-add{display:flex;gap:8px;margin-bottom:12px}
.podium{display:flex;align-items:flex-end;justify-content:center;gap:12px;margin:10px 0 20px;min-height:220px}
.podium .step{display:flex;flex-direction:column;align-items:center;gap:6px;width:130px}
.podium .block{width:100%;border-radius:12px 12px 0 0;display:grid;place-items:center;font-family:var(--serif);font-size:30px;font-weight:800;color:#2a1c05;background:linear-gradient(180deg,#f7dc93,#9a6b1c);box-shadow:inset 0 2px 0 rgba(255,255,255,.5)}
.podium .p2 .block{background:linear-gradient(180deg,#f4f4fa,#8e8e9c)}
.podium .p3 .block{background:linear-gradient(180deg,#f0b27a,#7a4a20)}
.podium .av{--as:64px}
.podium .nm{font-weight:700;font-size:14px;text-align:center;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.podium .pts{color:var(--brass-hi);font-weight:800}
.waiting{text-align:center}
.waiting .seats-row{display:flex;justify-content:center;gap:14px;margin:18px 0}
.waiting .av{--as:64px}
.waiting .slot{width:64px;height:64px;border-radius:50%;border:2px dashed rgba(255,255,255,.2);display:grid;place-items:center;color:var(--muted);animation:blink 1.6s infinite}
.invite-box{display:flex;gap:8px;margin:12px 0}
.invite-box input{flex:1;font-size:12.5px}

/* ---------- SHOP ---------- */
.shop-head{display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-wrap:wrap}
.shop-head .dummy{display:flex;align-items:center;gap:10px;padding:8px 14px 8px 8px;border-radius:999px;background:rgba(0,0,0,.28);border:1px solid var(--line-soft)}
.shop-head .dummy .av{--as:48px}
.shop-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px;scrollbar-width:thin}
.shop-tabs button{flex:none;border:1px solid var(--line-soft);background:rgba(255,255,255,.04);border-radius:11px;padding:8px 12px;font-size:13px;font-weight:700;color:var(--muted)}
.shop-tabs button.on{background:linear-gradient(180deg,#f7dc93,#c89a3c);color:#2a1c05;border-color:transparent}
.shop-tabs small{opacity:.7;font-weight:600}
.shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.shop-item{position:relative;display:flex;flex-direction:column;gap:9px;padding:12px;border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(0,0,0,.18));border:1px solid var(--line-soft);transition:transform .2s,border-color .2s}
.shop-item:hover{transform:translateY(-3px)}
.shop-item.r-rare{border-color:rgba(90,160,255,.4)}
.shop-item.r-epic{border-color:rgba(190,110,255,.5);box-shadow:0 0 22px rgba(190,110,255,.12)}
.shop-item.r-legendary{border-color:rgba(243,214,144,.7);box-shadow:0 0 26px rgba(243,214,144,.18)}
.shop-item.r-legendary:before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(115deg,transparent 30%,rgba(255,240,200,.14) 45%,transparent 60%);background-size:250% 100%;animation:shine 3.5s linear infinite}
@keyframes shine{from{background-position:120% 0}to{background-position:-120% 0}}
.rar{position:absolute;top:10px;right:10px;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;z-index:2}
.rar.common{background:#3b4a44;color:#cfd8d3}
.rar.rare{background:#1d4f9b;color:#d4e6ff}
.rar.epic{background:#6a2bb0;color:#f0dcff}
.rar.legendary{background:linear-gradient(180deg,#f7dc93,#b8862d);color:#2a1c05}
.preview{height:104px;border-radius:12px;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 30%,rgba(255,255,255,.07),rgba(0,0,0,.25));overflow:hidden;position:relative}
.preview .mini-table{width:84%;height:74%;border-radius:50%;box-shadow:0 0 0 5px #5a341c,0 0 0 7px #2a170c,0 10px 20px rgba(0,0,0,.5);position:relative;overflow:hidden}
.preview .mini-table:after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,rgba(255,236,190,.18),transparent 65%)}
.preview .card{--cw:56px}
.preview .av{--as:62px}
.preview .big{font-size:56px;filter:drop-shadow(0 8px 8px rgba(0,0,0,.5))}
.preview .title-plate{font-size:13px;padding:5px 12px}
.shop-item .nm{font-weight:700;font-size:14px}
.shop-item .acts{display:flex;gap:6px}
.shop-item .acts button{flex:1}
.buy{border:0;border-radius:10px;padding:8px;font-weight:800;background:linear-gradient(180deg,#f7dc93,#c89a3c);color:#2a1c05;display:flex;align-items:center;justify-content:center;gap:6px}
.buy.cant{background:#2b3431;color:#7d8c86}
.buy.own{background:#1b3d2d;color:#8fe0b4}
.buy.eq{background:transparent;border:1px solid rgba(67,201,138,.5);color:#8fe0b4;cursor:default}
.try{border:1px solid var(--line-soft);background:rgba(255,255,255,.05);border-radius:10px;padding:8px;font-size:12px;flex:0 0 auto!important}

/* ---------- DOMINO ---------- */
#dominoGame{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.domino-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 12px 20px}
.domino-board{width:min(1120px,96vw);border-radius:30px;padding:22px;position:relative;
 background:linear-gradient(180deg,rgba(255,255,255,.1),transparent 20%,rgba(0,0,0,.3)),repeating-linear-gradient(97deg,rgba(0,0,0,.14) 0 2px,transparent 2px 9px),linear-gradient(180deg,#6a3d22,#3c2011);
 box-shadow:0 40px 80px rgba(0,0,0,.7)}
.domino-felt{border-radius:20px;padding:18px;min-height:360px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 50% 40%,var(--felt-a),var(--felt-b));box-shadow:inset 0 10px 40px rgba(0,0,0,.55)}
.domino-felt:before{content:"";position:absolute;inset:0;background-image:var(--noise);opacity:.35;mix-blend-mode:overlay;pointer-events:none}
.d-seats{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;position:relative}
.d-seat{display:flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;border-radius:999px;background:rgba(0,0,0,.35);border:1px solid var(--line-soft)}
.d-seat.active{border-color:var(--brass);box-shadow:0 0 16px rgba(214,168,73,.4)}
.d-seat .av{--as:40px}
.d-seat small{color:var(--muted)}
.d-chain-scroll{overflow-x:auto;padding:30px 6px;position:relative}
.d-chain{display:flex;align-items:center;gap:3px;width:max-content;margin:0 auto}
.tile{display:flex;border-radius:7px;flex:none;position:relative;background:linear-gradient(160deg,#fffdf6,#e8dfc8);box-shadow:inset 0 0 0 1px rgba(255,255,255,.9),0 0 0 1px rgba(0,0,0,.25),0 5px 10px rgba(0,0,0,.5)}
.tile.h{width:66px;height:33px}
.tile.v{width:50px;height:96px;flex-direction:column;cursor:pointer;transition:transform .2s var(--ease-pop)}
.tile .half{flex:1;position:relative}
.tile.h .half+.half{border-left:1.5px solid #9a8f78}
.tile.v .half+.half{border-top:1.5px solid #9a8f78}
.tile .pd{position:absolute;width:6px;height:6px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#555,#0d0d0d);transform:translate(-50%,-50%)}
.tile.v .pd{width:8px;height:8px}
.tile.v:hover{transform:translateY(-8px)}
.tile.v.sel{transform:translateY(-14px);box-shadow:0 0 0 3px var(--brass-hi),0 0 22px rgba(243,214,144,.7)}
.tile.v.dim{filter:brightness(.6)}
.d-end{flex:none;width:52px;height:60px;border-radius:12px;border:2px dashed rgba(255,255,255,.22);display:grid;place-items:center;color:var(--muted);font-weight:800;cursor:pointer}
.d-end.hl{border-color:var(--brass-hi);background:rgba(214,168,73,.15);color:var(--brass-hi);animation:blink 1s infinite}
.d-hand{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin-top:6px}
.d-status{text-align:center;color:var(--muted);margin:6px 0}
.d-status.mine{color:var(--brass-hi);font-weight:700}
.d-scores{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.d-scores div{padding:10px 16px;border-radius:14px;background:rgba(0,0,0,.3);text-align:center;min-width:110px}
.d-scores b{display:block;font-size:22px;color:var(--brass-hi);font-family:var(--serif)}
</style>
</head>
<body>
<div class="room-bg"></div>
<canvas id="fx"></canvas>
<div id="toasts"></div>

<!-- ======================= AUTH ======================= -->
<section id="auth">
 <div class="auth-wrap">
  <div class="auth-hero">
   <h1 class="logo">წერითი ბურა<small>WRITTEN BURA · ONLINE</small></h1>
   <div class="hero-fan" id="heroFan"></div>
   <p class="hero-copy">ქართული ბურა ცოცხალ მოწინააღმდეგეებთან — ჭრა, კოზირი, მალიუტკა და გახიშტვა, ზუსტად ისე, როგორც ეზოში თამაშობდით.</p>
   <ul class="feat">
    <li><span>🔒</span>ყოველი არევა გადამოწმებადია (Provably Fair)</li>
    <li><span>🏆</span>რეიტინგი, ლიგები და დღიური დავალებები</li>
    <li><span>🍅</span>პომიდვრით, კვერცხით და ჩუსტით „მიმართვა"</li>
    <li><span>🛍️</span>100-მდე კოსმეტიკური ნივთი მაღაზიაში</li>
   </ul>
  </div>

  <div class="auth-card panel">
   <h1 class="logo">წერითი ბურა</h1>
   <div class="seg" role="tablist">
    <button id="loginTab" class="on" data-i18n="login">შესვლა</button>
    <button id="registerTab" data-i18n="register">რეგისტრაცია</button>
   </div>
   <div class="fieldset">
    <input id="username" class="field" placeholder="მომხმარებლის სახელი" autocomplete="username">
    <input id="password" class="field" type="password" placeholder="პაროლი" autocomplete="current-password">
   </div>
   <div id="avatarBox" class="hidden">
    <span class="label">აირჩიე ავატარი</span>
    <div class="avatar-pick" id="avatarPick"></div>
    <label class="upload">ან ატვირთე ფოტო <input id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp"></label>
   </div>
   <div id="authError" class="error"></div>
   <button id="authBtn" class="btn-brass" style="width:100%" data-i18n="login">შესვლა</button>
   <button id="testerBtn" class="btn ghost tester hidden">🧪 saba123 — სატესტო რეჟიმი</button>
  </div>
 </div>
</section>

<!-- ======================= LOBBY ======================= -->
<section id="lobby" class="hidden">
 <header class="topbar">
  <div class="logo">წერითი ბურა</div>
  <div class="live" id="liveCount"><i></i><span>ონლაინ</span></div>
  <nav class="nav">
   <button class="btn" id="shopBtn">🛍️ <span class="lbl" data-i18n="shop">მაღაზია</span></button>
   <button class="btn" id="leaderboardBtn">🏆 <span class="lbl" data-i18n="leaderboard">რეიტინგი</span></button>
   <button class="btn" id="friendsBtn">👥 <span class="lbl" data-i18n="friends">მეგობრები</span></button>
   <button class="btn" id="statsBtn">📊 <span class="lbl" data-i18n="stats">სტატისტიკა</span></button>
   <button class="btn" id="infoBtn">ℹ️ <span class="lbl" data-i18n="info">ინფო</span></button>
   <select id="langSelect" class="btn" aria-label="ენა">
    <option value="ka">🇬🇪 KA</option>
    <option value="en">🇬🇧 EN</option>
    <option value="ru">🇷🇺 RU</option>
   </select>
  </nav>
  <div class="wallet" id="walletBtn" title="მონეტები"><span class="coin"></span><span id="coinsLbl">0</span></div>
 </header>

 <main class="lobby-grid">
  <div class="col-main">
   <div class="mode-tabs">
    <button class="mode-tab on" id="modeBuraTab"><span class="ico">🎴</span><span><b data-i18n="bura">ბურა</b><small>36 კარტი · 3–4 მოთამაშე</small></span></button>
    <button class="mode-tab" id="modeDominoTab"><span class="ico">🁫</span><span><b data-i18n="domino">დომინო</b><small>28 ქვა · 2–4 მოთამაშე</small></span></button>
   </div>

   <div id="buraLobbyPanels" class="col-main">
    <div class="panel">
     <h2 data-i18n="newTable">ახალი მაგიდა</h2>
     <input id="tableName" class="field" value="Written Bura" maxlength="24" placeholder="მაგიდის სახელი">
     <div class="create-grid">
      <div><span class="label">ფსონი (ვირტუალური)</span>
       <div class="seg" id="stakeSeg">
        <button data-v="5" class="on">5</button><button data-v="10">10</button><button data-v="25">25</button><button data-v="50">50</button><button data-v="100">100</button>
       </div></div>
      <div><span class="label">მოთამაშეები</span>
       <div class="seg" id="capSeg"><button data-v="3">3</button><button data-v="4" class="on">4</button></div></div>
      <div><span class="label">პარტიები (1 პარტია = 5 ხელი)</span>
       <div class="seg" id="partySeg"><button data-v="1" class="on">1</button><button data-v="2">2</button><button data-v="3">3</button><button data-v="4">4</button></div></div>
     </div>
     <div class="create-actions">
      <button id="createBtn" class="btn-brass" data-i18n="create">მაგიდის გახსნა</button>
      <button id="botsBtn" class="btn" title="ცარიელ ადგილებს ბოტები დაიკავებენ">🤖 <span data-i18n="vsBots">ბოტებთან</span></button>
     </div>
    </div>

    <div class="panel">
     <h2 data-i18n="activeTables">ღია მაგიდები</h2>
     <div id="tables" class="table-list"></div>
    </div>
   </div>

   <div id="dominoLobbyPanels" class="col-main hidden">
    <div class="panel">
     <h2>ახალი დომინოს მაგიდა</h2>
     <input id="dominoTableName" class="field" value="Domino Table" maxlength="24" placeholder="მაგიდის სახელი">
     <div class="create-grid">
      <div><span class="label">მოთამაშეები</span>
       <div class="seg" id="dCapSeg"><button data-v="2">2</button><button data-v="3">3</button><button data-v="4" class="on">4</button></div></div>
      <div><span class="label">რაუნდები</span>
       <div class="seg" id="dRoundSeg"><button data-v="1" class="on">1</button><button data-v="2">2</button><button data-v="3">3</button><button data-v="4">4</button></div></div>
     </div>
     <div class="create-actions">
      <button id="dominoCreateBtn" class="btn-brass">მაგიდის გახსნა</button>
      <button id="dominoBotsBtn" class="btn">🤖 ბოტებთან</button>
     </div>
    </div>
    <div class="panel">
     <h2>ღია დომინოს მაგიდები</h2>
     <div id="dominoTables" class="table-list"></div>
    </div>
   </div>
  </div>

  <aside class="col-side">
   <div class="panel profile-card">
    <div id="profileAv"></div>
    <div class="pname" id="profileName">Player</div>
    <div id="profileTitle"></div>
    <div class="rank-line">
     <span class="chip" id="profileRank">🥉 Bronze</span>
     <span class="chip" id="profileLevel">დონე 1</span>
    </div>
    <div class="xpbar"><i id="xpFill" style="width:0"></i></div>
    <div class="xp-meta"><span id="xpText">0 / 100 XP</span><span id="streakText"></span></div>
    <div class="mini-stats">
     <div><b id="msWins">0</b><small>მოგება</small></div>
     <div><b id="msRate">0%</b><small>მოგების %</small></div>
     <div><b id="msStreak">0</b><small>სერია</small></div>
    </div>
   </div>

   <div class="panel chest" id="chestPanel">
    <div class="chest-box">🎁</div>
    <div class="txt"><b>დღიური ყუთი</b><small id="chestText">გახსენი და მიიღე მონეტები</small></div>
    <button class="btn-brass" id="chestBtn" style="padding:10px 14px">გახსნა</button>
   </div>

   <div class="panel">
    <h2 data-i18n="quests">დღიური დავალებები</h2>
    <div id="quests"></div>
   </div>

   <div class="panel">
    <h2 data-i18n="tournaments">ტურნირები</h2>
    <div id="tournaments"></div>
   </div>
  </aside>
 </main>
</section>

<!-- ======================= BURA GAME ======================= -->
<section id="game" class="hidden">
 <div class="game-top">
  <div class="hud">
   <div class="pill">პარტია <b id="hudParty">1</b></div>
   <div class="pill">ხელი <b id="hudHand">1/5</b></div>
   <div class="pill">კოზირი <b id="hudTrump">♠</b></div>
   <div class="pill">დასტა <b id="hudDeck">0</b></div>
   <div class="pill">ფსონი <b id="hudStake">5</b></div>
  </div>
  <div class="tools">
   <button id="sortBtn" class="btn small" title="კარტების დალაგება">↕ <span class="lbl">დალაგება</span></button>
   <button id="feltBtn" class="btn small" title="მაგიდის ფერი">🎨</button>
   <button id="rulesBtn" class="btn small" title="წესები">📖</button>
   <button id="muteBtn" class="btn small" title="ხმა">🔊</button>
   <input id="volumeSlider" class="vol" type="range" min="0" max="100" value="80" aria-label="ხმის დონე">
   <button id="sideToggle" class="btn small side-toggle" title="ქულები">📋</button>
   <button id="leaveBtn" class="btn small danger">🚪 <span class="lbl">გასვლა</span></button>
  </div>
 </div>

 <div class="arena" id="arena">
  <div class="table-outer" id="tableOuter">
   <div class="table-rail">
    <div class="table-felt" id="tableFelt">
     <div class="felt-print"><span>WRITTEN BURA</span></div>
     <div class="trump-mark" id="trumpMark"><div class="sym" id="trumpSymbol">♠</div><small>კოზირი</small></div>
     <div class="deck-stack" id="deck"></div>
     <div class="center-cards" id="centerCards"></div>
    </div>
   </div>
   <div id="seats"></div>
  </div>
 </div>

 <div class="hand-zone">
  <div class="me-seat" id="meSeat"></div>
  <div class="action-bar">
   <div class="status" id="status">...</div>
   <span class="turn-clock hidden" id="turnClock">20</span>
   <button id="playBtn" class="btn-brass" disabled>სვლა</button>
  </div>
  <div id="hand" class="hand"></div>
 </div>

 <aside class="side" id="side">
  <div class="panel">
   <h3>ანგარიში</h3>
   <div id="scorePlayers"></div>
  </div>
  <div class="panel">
   <h3>სწრაფი ფრაზები</h3>
   <div class="phrases" id="phrases"></div>
  </div>
  <div class="panel">
   <h3>ხელების ისტორია</h3>
   <div id="history"><small class="muted">ჯერ არცერთი ხელი არ დასრულებულა.</small></div>
   <div class="fair" id="fairNow"></div>
  </div>
 </aside>
</section>

<!-- ======================= DOMINO GAME ======================= -->
<section id="dominoGame" class="hidden">
 <div class="game-top">
  <div class="hud">
   <div class="pill">რაუნდი <b id="dHudRound">1</b>/<b id="dHudTotalRounds">1</b></div>
   <div class="pill">ბანკი <b id="dHudBoneyard">0</b></div>
  </div>
  <div class="tools">
   <button id="dominoLeaveBtn" class="btn small danger">🚪 გასვლა</button>
  </div>
 </div>
 <div class="domino-wrap">
  <div class="domino-board">
   <div class="domino-felt">
    <div id="dominoSeats" class="d-seats"></div>
    <div class="d-chain-scroll" id="dChainScroll"><div id="dominoChain" class="d-chain"></div></div>
    <div id="dominoStatus" class="d-status">...</div>
    <div id="dominoHand" class="d-hand"></div>
   </div>
  </div>
  <div id="dominoScorePanel" class="d-scores"></div>
 </div>
</section>

<!-- ======================= POPOVERS ======================= -->
<div id="throwMenu" class="pop hidden"><h4 id="throwTitle">გაუგზავნე</h4><div class="throw-grid" id="throwGrid"></div></div>
<div id="feltMenu" class="pop hidden"><h4>მაგიდის ქსოვილი</h4><div class="felt-grid" id="feltGrid"></div></div>

<!-- ======================= MODALS ======================= -->
<div id="rulesModal" class="modal hidden"><div class="modal-box">
 <button class="modal-x" data-close="rulesModal">✕</button>
 <h2>წერითი ბურას წესები</h2>
 <div class="rule"><b>დასტა.</b> 36 კარტი: 6, 7, 8, 9, J, Q, K, 10, A. თითოეულს ურიგდება 5 კარტი; ყოველი ხელის შემდეგ ყველა ავსებს ხელს 5-მდე (ჯერ წაღების მომგები).</div>
 <div class="rule"><b>ქულები.</b> J=2, Q=3, K=4, 10=10, A=11, 6–9 = 0. თუ ხელში ერთი ქულაც ვერ აიღე — ეწერება −120 (გახიშტვა).</div>
 <div class="rule"><b>სვლა.</b> ვინც იწყებს, შეუძლია ჩამოვიდეს 1-დან 4-მდე <u>ერთი მასტის</u> კარტით. დანარჩენები პასუხობენ <u>ზუსტად იმდენივე</u> კარტით — <b>ნებისმიერი მასტით</b>, შერეულადაც.</div>
 <div class="rule"><b>ჭრა.</b> იმავე მასტის უფროსი კარტი ჭრის უმცროსს, კოზირი ჭრის არაკოზირს. რამდენიმე კარტზე თითოეული შენი კარტი ცალკე უნდა ჭრიდეს თითო კარტს — თუ ერთი მაინც ვერ ჭრის, წაღება არ გამოდის.</div>
 <div class="rule"><b>მალიუტკა.</b> 5 ერთი მასტის კარტი ერთად. პასუხად ყველა ჩადის მთელ დარჩენილ ხელს.</div>
 <div class="rule"><b>კოზირი</b> ყოველ ხელზე იცვლება: ♠ → ♣ → ♦ → ♥ → უკოზირო.</div>
 <div class="rule"><b>შემდეგი ხელი.</b> იწყებს წინა ხელში ყველაზე ნაკლები ქულის მქონის მომდევნო. თუ ნულზე ორი ან მეტია — ბოლო წაღებაში ბოლო ნულიანის მომდევნო.</div>
</div></div>

<div id="leaderboardModal" class="modal hidden"><div class="modal-box">
 <button class="modal-x" data-close="leaderboardModal">✕</button>
 <h2>გლობალური რეიტინგი</h2>
 <div id="leaderboardList"></div>
</div></div>

<div id="friendsModal" class="modal hidden"><div class="modal-box">
 <button class="modal-x" data-close="friendsModal">✕</button>
 <h2>მეგობრები</h2>
 <div class="friend-add"><input id="friendUsername" class="field" placeholder="მომხმარებლის სახელი"><button id="addFriendBtn" class="btn-brass">დამატება</button></div>
 <div id="friendsList"></div>
</div></div>

<div id="statsModal" class="modal hidden"><div class="modal-box">
 <button class="modal-x" data-close="statsModal">✕</button>
 <h2>ჩემი სტატისტიკა</h2>
 <div id="statGrid" class="stat-grid"></div>
 <h3 style="font-family:var(--serif);margin:18px 0 4px">ბოლო 20 პარტია</h3>
 <div id="sparkRow" class="spark"></div>
 <h3 style="font-family:var(--serif);margin:18px 0 4px">სამართლიანობის ჟურნალი</h3>
 <div id="fairnessLog" class="fair">ჯერ ცარიელია — ყოველი ხელის შემდეგ აქ გამოჩნდება seed და hash.</div>
</div></div>

<div id="shopModal" class="modal hidden"><div class="modal-box" style="width:min(1020px,96vw)">
 <button class="modal-x" data-close="shopModal">✕</button>
 <h2>მაღაზია</h2>
 <div class="shop-head">
  <div class="dummy"><div id="shopDummy"></div><div><b id="shopName">—</b><br><small class="muted">▶ ღილაკით სცადე ნებისმიერი სასროლი</small></div></div>
  <div class="wallet" style="margin-left:auto"><span class="coin"></span><span id="shopCoins">0</span></div>
 </div>
 <div class="shop-tabs" id="shopTabs"></div>
 <div class="shop-grid" id="shopGrid"></div>
 <p class="muted" style="font-size:12.5px;margin-top:16px">მხოლოდ კოსმეტიკური ნივთებია. მონეტები არ იყიდება რეალური ფულით და არ გადაიცვლება.</p>
</div></div>

<div id="infoModal" class="modal hidden"><div class="modal-box">
 <button class="modal-x" data-close="infoModal">✕</button>
 <h2>ინფორმაცია</h2>
 <div class="rule"><b>18+.</b> პლატფორმა განკუთვნილია სრულწლოვანთათვის. ბალანსი და მონეტები ვირტუალურია და რეალურ ფულში არ იცვლება.</div>
 <div class="rule"><b>წესები.</b> ითამაშე სამართლიანად, ნუ გამოიყენებ ავტომატიზაციას და პატივი ეცი სხვებს.</div>
 <div class="rule"><b>კონფიდენციალურობა.</b> ვინახავთ მხოლოდ სახელს და თამაშის სტატისტიკას. პაროლი ინახება დაშიფრული (scrypt) სახით.</div>
 <div class="rule"><b>პაუზა.</b> თუ თამაში ზედმეტ დროს გართმევს, დაბლოკე შესვლა არჩეული ვადით — მოქმედებს მაშინვე.
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
   <button class="btn small selfExcludeBtn" data-duration="24h">24 საათი</button>
   <button class="btn small selfExcludeBtn" data-duration="7d">7 დღე</button>
   <button class="btn small selfExcludeBtn" data-duration="30d">30 დღე</button>
   <button class="btn small danger selfExcludeBtn" data-duration="forever">სამუდამოდ</button>
  </div>
 </div>
 <button id="logoutBtn" class="btn" style="margin-top:10px">გამოსვლა ანგარიშიდან</button>
</div></div>

<div id="waitModal" class="modal hidden"><div class="modal-box waiting" style="width:min(520px,96vw)">
 <h2 id="waitTitle">ველოდებით მოთამაშეებს</h2>
 <div class="seats-row" id="waitSeats"></div>
 <p class="muted" id="waitText">0 / 4</p>
 <div class="invite-box"><input id="inviteLink" class="field" readonly><button id="copyInvite" class="btn">კოპირება</button></div>
 <div id="waitFriends" style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center"></div>
 <button id="waitLeave" class="btn danger" style="margin-top:14px">მაგიდის დატოვება</button>
</div></div>

<div id="overModal" class="modal hidden"><div class="modal-box" style="width:min(620px,96vw);text-align:center">
 <h2 id="overTitle" style="padding:0">თამაში დასრულდა</h2>
 <div class="podium" id="podium"></div>
 <div id="overRest" class="muted"></div>
 <button id="overBack" class="btn-brass" style="margin-top:16px">ლობიში დაბრუნება</button>
</div></div>

<script src="/socket.io/socket.io.js"></script>
<script>
(function () {
'use strict';

var socket = io();

var S = {
 profile: null, catalog: [], serverInfo: { tester: true, phrases: [] },
 current: null, selected: [], handIds: [], sortHand: true, prevGroups: [], lastHandIndex: 0,
 muted: false, volume: 0.8, authMode: 'login', chosenAvatar: '🦊', stake: 5, capacity: 4, parties: 1,
 dCapacity: 4, dRounds: 1, giftTarget: null, fairness: [], shopTab: 'felt', pendingInvite: null,
 skew: 0, lastTick: -1, collecting: false, token: null, waitingRoom: null, friends: [], lang: 'ka',
 domino: null, dSel: null, tournaments: []
};

function $(id) { return document.getElementById(id); }
function esc(v) {
 return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
  return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
 });
}
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hueOf(str) { var h = 0; str = String(str || ''); for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }
function cat(type, key) { for (var i = 0; i < S.catalog.length; i++) { var it = S.catalog[i]; if (it.type === type && it.key === key) return it; } return null; }
function owns(type, key) { var inv = S.profile && S.profile.inventory; return !!(inv && inv[type] && inv[type].indexOf(key) >= 0); }
function equipped(slot) { return (S.profile && S.profile.equipped && S.profile.equipped[slot]) || null; }

/* ============================================================
   TOASTS
   ============================================================ */
function toast(text, opts) {
 opts = opts || {};
 var node = document.createElement('div');
 node.className = 'toast' + (opts.gold ? ' gold' : '');
 node.textContent = text;
 if (opts.action) {
  node.style.pointerEvents = 'auto';
  var b = document.createElement('button');
  b.className = 'btn small'; b.style.marginLeft = '10px'; b.textContent = opts.action;
  b.onclick = function () { node.remove(); opts.onClick(); };
  node.appendChild(b);
 }
 $('toasts').appendChild(node);
 setTimeout(function () { node.style.transition = 'opacity .4s'; node.style.opacity = '0'; setTimeout(function () { node.remove(); }, 400); }, opts.ms || 2800);
}

/* ============================================================
   AUDIO (synthesised — no files needed)
   ============================================================ */
var AC = null, master = null, noiseBuf = null;
function ac() {
 if (!AC) {
  var C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  AC = new C();
  master = AC.createGain(); master.connect(AC.destination);
  var len = AC.sampleRate;
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
  var d = noiseBuf.getChannelData(0);
  for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
 }
 if (AC.state === 'suspended') AC.resume();
 master.gain.value = S.muted ? 0 : S.volume;
 return AC;
}
document.addEventListener('pointerdown', function () { ac(); }, { once: true });

function tone(f, dur, type, vol, delay, f2) {
 if (S.muted || S.volume <= 0) return;
 var a = ac(); if (!a) return;
 var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + (delay || 0);
 o.type = type || 'sine';
 o.frequency.setValueAtTime(f, t);
 if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
 g.gain.setValueAtTime(0.0001, t);
 g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.008);
 g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
 o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, ftype, freq, vol, delay, freq2, q) {
 if (S.muted || S.volume <= 0) return;
 var a = ac(); if (!a) return;
 var t = a.currentTime + (delay || 0);
 var src = a.createBufferSource(); src.buffer = noiseBuf;
 var f = a.createBiquadFilter(); f.type = ftype || 'lowpass'; f.Q.value = q || 1;
 f.frequency.setValueAtTime(freq, t);
 if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
 var g = a.createGain();
 g.gain.setValueAtTime(0.0001, t);
 g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.005);
 g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
 src.connect(f); f.connect(g); g.connect(master);
 src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.05);
}
var SFX = {
 deal: function (d) { noise(0.07, 'highpass', 2500, 0.07, d || 0); },
 place: function () { noise(0.05, 'bandpass', 1900, 0.16); tone(150, 0.07, 'triangle', 0.05); },
 cut: function () { noise(0.07, 'highpass', 3000, 0.18); tone(880, 0.12, 'triangle', 0.06, 0, 1400); },
 collect: function () { noise(0.3, 'bandpass', 1500, 0.08, 0, 400, 0.8); },
 tick: function () { tone(1150, 0.035, 'square', 0.03); },
 select: function () { tone(620, 0.04, 'triangle', 0.035); },
 win: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.28, 'triangle', 0.06, i * 0.12); }); },
 lose: function () { tone(330, 0.2, 'sine', 0.05); tone(247, 0.35, 'sine', 0.05, 0.18); },
 whoosh: function (d) { noise(d || 0.45, 'bandpass', 350, 0.08, 0, 2200, 1.5); },
 splat: function () { noise(0.22, 'lowpass', 1000, 0.4, 0, 180); tone(95, 0.14, 'sine', 0.14, 0, 50); noise(0.08, 'highpass', 2500, 0.1, 0.02); },
 crack: function () { noise(0.025, 'highpass', 4200, 0.35); noise(0.03, 'highpass', 3000, 0.25, 0.03); noise(0.18, 'lowpass', 800, 0.25, 0.05, 200); },
 paper: function () { noise(0.5, 'bandpass', 2600, 0.08, 0, 1100, 0.7); noise(0.15, 'lowpass', 500, 0.12, 0.05); },
 boom: function () { noise(1.1, 'lowpass', 1400, 0.7, 0, 50); tone(70, 0.7, 'sine', 0.45, 0, 28); noise(0.2, 'highpass', 1800, 0.25); },
 clink: function () { tone(2600, 0.2, 'sine', 0.05); tone(3350, 0.16, 'sine', 0.04, 0.02); noise(0.35, 'bandpass', 900, 0.2, 0.05, 300, 0.8); },
 ice: function () { tone(2900, 0.1, 'triangle', 0.05); tone(3700, 0.08, 'triangle', 0.04, 0.05); noise(0.14, 'highpass', 5000, 0.25); },
 chime: function () { [880, 1175, 1568].forEach(function (f, i) { tone(f, 0.5, 'sine', 0.04, i * 0.09); }); },
 zap: function () { noise(0.45, 'highpass', 1400, 0.5); tone(55, 0.5, 'sawtooth', 0.18, 0, 35); noise(0.9, 'lowpass', 300, 0.4, 0.1, 60); },
 slap: function () { noise(0.07, 'bandpass', 1500, 0.55, 0, 800, 2); tone(210, 0.07, 'square', 0.07); },
 pop: function (d) { noise(0.12, 'highpass', 700, 0.3, d || 0); for (var i = 0; i < 6; i++) noise(0.03, 'highpass', 4000, 0.08, (d || 0) + 0.15 + i * 0.06); },
 coins: function () { for (var i = 0; i < 7; i++) tone(1800 + Math.random() * 1400, 0.07, 'triangle', 0.035, i * 0.07); },
 kiss: function () { tone(1300, 0.09, 'sine', 0.05, 0, 500); noise(0.05, 'bandpass', 3000, 0.1, 0.05); },
 splash: function () { noise(0.45, 'lowpass', 2200, 0.35, 0, 300); noise(0.2, 'highpass', 3000, 0.12, 0.05); },
 fanfare: function () { [523, 659, 784, 1046, 784, 1046].forEach(function (f, i) { tone(f, 0.22, 'square', 0.03, i * 0.1); }); }
};
function speak(text) {
 if (S.muted || S.volume <= 0 || !('speechSynthesis' in window)) { tone(520, 0.08, 'square', 0.025); return; }
 try {
  var voices = speechSynthesis.getVoices();
  var ka = voices.find(function (v) { return String(v.lang).toLowerCase().indexOf('ka') === 0; });
  if (!ka) { tone(520, 0.08, 'triangle', 0.03); tone(690, 0.1, 'triangle', 0.025, 0.1); return; }
  var u = new SpeechSynthesisUtterance(text.replace(/[^\u10A0-\u10FF\s!?,.]/g, ''));
  u.voice = ka; u.lang = 'ka-GE'; u.volume = S.volume; u.rate = 1.05;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
 } catch (e) {}
}

/* ============================================================
   RENDER HELPERS — avatars, cards, felts
   ============================================================ */
var SYM = { spades: '\u2660\uFE0E', hearts: '\u2665\uFE0E', diamonds: '\u2666\uFE0E', clubs: '\u2663\uFE0E', no_trump: '\u2605' };
var PIP6 = [[28, 14], [72, 14], [28, 50], [72, 50], [28, 86], [72, 86]];
var PIPS = {
 '6': PIP6,
 '7': PIP6.concat([[50, 32]]),
 '8': PIP6.concat([[50, 32], [50, 68]]),
 '9': [[28, 10], [72, 10], [28, 36], [72, 36], [28, 64], [72, 64], [28, 90], [72, 90], [50, 50]],
 '10': [[28, 10], [72, 10], [28, 36], [72, 36], [28, 64], [72, 64], [28, 90], [72, 90], [50, 23], [50, 77]]
};
var COURT = { J: '\u265E\uFE0E', Q: '\u265B\uFE0E', K: '\u265A\uFE0E' };
var COURT_NAME = { J: 'ვალეტი', Q: 'დამა', K: 'მეფე' };

function cardHtml(card, cls) {
 var s = SYM[card.suit] || '';
 var body = '';
 if (card.rank === 'A') body = '<div class="ace-pip">' + s + '</div>';
 else if (COURT[card.rank]) body = '<div class="court"><span class="fig">' + COURT[card.rank] + '</span><span class="lt">' + s + '</span></div>';
 else {
  body = '<div class="pips">' + (PIPS[card.rank] || []).map(function (p) {
   return '<span class="pip' + (p[1] > 50 ? ' flip' : '') + '" style="left:' + p[0] + '%;top:' + p[1] + '%">' + s + '</span>';
  }).join('') + '</div>';
 }
 return '<div class="card ' + esc(card.suit) + ' ' + (cls || '') + '" data-id="' + esc(card.id) + '" title="' + esc(card.rank) + ' ' + (COURT_NAME[card.rank] || '') + '">' +
  '<div class="corner tl"><b>' + esc(card.rank) + '</b><i>' + s + '</i></div>' + body +
  '<div class="corner br"><b>' + esc(card.rank) + '</b><i>' + s + '</i></div></div>';
}

function patternLayers(p, pc) {
 pc = pc || 'rgba(255,255,255,.09)';
 switch (p) {
  case 'diamond': return [['repeating-linear-gradient(45deg,' + pc + ' 0 1.5px,transparent 1.5px 11px)', 'auto'], ['repeating-linear-gradient(-45deg,' + pc + ' 0 1.5px,transparent 1.5px 11px)', 'auto']];
  case 'grid': return [['linear-gradient(' + pc + ' 1px,transparent 1px)', '18px 18px'], ['linear-gradient(90deg,' + pc + ' 1px,transparent 1px)', '18px 18px']];
  case 'dots': return [['radial-gradient(' + pc + ' 1.6px,transparent 2.2px)', '14px 14px']];
  case 'stripes': return [['repeating-linear-gradient(90deg,' + pc + ' 0 1px,transparent 1px 5px)', 'auto'], ['repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 1px,transparent 1px 5px)', 'auto']];
  case 'waves': return [['repeating-radial-gradient(circle at 0 100%,transparent 0 9px,' + pc + ' 9px 10px)', '36px 36px']];
  case 'hex': return [['repeating-linear-gradient(60deg,' + pc + ' 0 1px,transparent 1px 16px)', 'auto'], ['repeating-linear-gradient(-60deg,' + pc + ' 0 1px,transparent 1px 16px)', 'auto'], ['repeating-linear-gradient(0deg,' + pc + ' 0 1px,transparent 1px 16px)', 'auto']];
  case 'tartan': return [['repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 6px,transparent 6px 18px)', 'auto'], ['repeating-linear-gradient(90deg,rgba(255,255,255,.12) 0 3px,transparent 3px 18px)', 'auto'], ['repeating-linear-gradient(90deg,rgba(0,0,0,.25) 0 6px,transparent 6px 18px)', 'auto']];
  case 'ornament': return [['radial-gradient(circle,transparent 4px,' + pc + ' 5px,transparent 6px)', '22px 22px'], ['repeating-linear-gradient(45deg,' + pc + ' 0 1px,transparent 1px 11px)', 'auto'], ['repeating-linear-gradient(-45deg,' + pc + ' 0 1px,transparent 1px 11px)', 'auto']];
  case 'scales': return [['radial-gradient(circle at 50% 0,transparent 8px,' + pc + ' 9px,transparent 10.5px)', '20px 12px']];
  case 'damask': return [['radial-gradient(circle,' + pc + ' 2px,transparent 3px)', '26px 26px'], ['radial-gradient(circle,' + pc + ' 1px,transparent 1.8px)', '13px 13px']];
  case 'stars': return [['radial-gradient(1.4px 1.4px at 20% 30%,#fff,transparent)', '90px 90px'], ['radial-gradient(1px 1px at 70% 80%,#fffc,transparent)', '90px 90px'], ['radial-gradient(1.2px 1.2px at 45% 65%,#cfe,transparent)', '70px 70px'], ['radial-gradient(1px 1px at 85% 15%,#fff,transparent)', '110px 110px'], ['radial-gradient(ellipse at 30% 40%,rgba(160,90,255,.25),transparent 55%)', 'auto']];
  case 'lava': return [['radial-gradient(ellipse at 30% 40%,rgba(255,120,0,.35),transparent 40%)', 'auto'], ['radial-gradient(ellipse at 72% 70%,rgba(255,60,0,.3),transparent 35%)', 'auto'], ['repeating-linear-gradient(115deg,rgba(255,90,0,.12) 0 1px,transparent 1px 23px)', 'auto']];
  case 'aurora': return [['radial-gradient(ellipse 70% 40% at 30% 30%,rgba(60,255,170,.28),transparent 70%)', 'auto'], ['radial-gradient(ellipse 60% 35% at 70% 55%,rgba(120,90,255,.3),transparent 70%)', 'auto'], ['radial-gradient(1px 1px at 50% 50%,#fff,transparent)', '60px 60px']];
  default: return [];
 }
}
function bgFrom(item, base) {
 var layers = patternLayers(item.pattern, item.pc);
 var imgs = layers.map(function (l) { return l[0]; });
 var sizes = layers.map(function (l) { return l[1]; });
 imgs.push(base); sizes.push('100% 100%');
 return { image: imgs.join(','), size: sizes.join(',') };
}
function backHtml(key, cls) {
 var it = cat('cardback', key) || cat('cardback', 'blue') || { colors: ['#1e428f', '#0b1c4a'], emblem: '♠' };
 var bg = bgFrom(it, 'linear-gradient(145deg,' + it.colors[0] + ',' + it.colors[1] + ')');
 return '<div class="card back ' + (it.dark ? 'dark ' : '') + (cls || '') + '" style="--back:' + esc(bg.image) + ';--backsize:' + esc(bg.size) + '"><div class="emb">' + esc(it.emblem || '♠') + '</div></div>';
}
function feltCss(key) {
 var it = cat('felt', key) || { colors: ['#12704a', '#063623'] };
 return bgFrom(it, 'radial-gradient(ellipse at 50% 45%,' + it.colors[0] + ' 0%,' + it.colors[1] + ' 100%)');
}
function ringStyle(frameKey) {
 var it = cat('frame', frameKey || 'none') || { colors: ['#b8923f', '#6e5220', '#b8923f'] };
 var cols = it.colors.slice();
 if (cols[cols.length - 1] !== cols[0]) cols.push(cols[0]);
 return { style: 'background:conic-gradient(' + cols.join(',') + ');--glow:' + (frameKey && frameKey !== 'none' ? cols[1] : 'transparent'), anim: !!it.anim };
}
function avatarHtml(value, o) {
 o = o || {};
 var v = String(value || '🦊');
 var inner = v.indexOf('data:image/') === 0 ? '<img alt="" src="' + esc(v) + '">' : '<span class="emo">' + esc(v) + '</span>';
 var ring = ringStyle(o.frame);
 return '<div class="av' + (o.cls ? ' ' + o.cls : '') + '"' + (o.id ? ' data-av="' + esc(o.id) + '"' : '') +
  ' style="' + (o.size ? '--as:' + o.size + 'px;' : '') + '--hue:' + hueOf(o.name || v) + '">' +
  '<div class="av-core">' + inner + '</div>' +
  '<div class="av-ring' + (ring.anim ? ' anim' : '') + '" style="' + ring.style + '"></div>' +
  (o.timer ? '<svg class="av-timer" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>' : '') +
  (o.level ? '<div class="av-lvl">' + esc(o.level) + '</div>' : '') + '</div>';
}
function titleHtml(key) {
 var it = cat('title', key);
 return it && it.text ? '<span class="title-plate">' + esc(it.text) + '</span>' : '';
}

/* ============================================================
   FX ENGINE — canvas particles, projectiles and stains
   ============================================================ */
var FX = { cv: null, ctx: null, w: 0, h: 0, parts: [], projs: [], decals: [], run: false, last: 0 };
var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function fxResize() {
 var dpr = Math.min(2, window.devicePixelRatio || 1);
 FX.w = window.innerWidth; FX.h = window.innerHeight;
 FX.cv.width = FX.w * dpr; FX.cv.height = FX.h * dpr;
 FX.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function fxInit() { FX.cv = $('fx'); FX.ctx = FX.cv.getContext('2d'); fxResize(); window.addEventListener('resize', fxResize); }
function fxKick() { if (!FX.run) { FX.run = true; FX.last = performance.now(); requestAnimationFrame(fxFrame); } }

function P(o) {
 var p = { x: 0, y: 0, vx: 0, vy: 0, g: 900, drag: 0.985, life: 1, age: 0, size: 4, color: '#fff', shape: 'circle', rot: Math.random() * 6.28, vr: 0, alpha: 1, fade: true, grow: 0, flip: rnd(6, 14), ph: Math.random() * 6.28 };
 for (var k in o) p[k] = o[k];
 if ((p.shape === 'blob' || p.shape === 'shard') && !p.pts) p.pts = rndBlob(p.shape === 'shard' ? 3 : 7, 0.35);
 FX.parts.push(p); fxKick(); return p;
}
function rndBlob(n, j) { var a = []; for (var i = 0; i < n; i++) a.push(1 - j + Math.random() * j * 2); return a; }
function blobPath(c, pts, R) {
 var n = pts.length, P2 = [];
 for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; P2.push([Math.cos(a) * R * pts[i], Math.sin(a) * R * pts[i]]); }
 c.beginPath();
 c.moveTo((P2[n - 1][0] + P2[0][0]) / 2, (P2[n - 1][1] + P2[0][1]) / 2);
 for (var k = 0; k < n; k++) { var nx = P2[(k + 1) % n]; c.quadraticCurveTo(P2[k][0], P2[k][1], (P2[k][0] + nx[0]) / 2, (P2[k][1] + nx[1]) / 2); }
 c.closePath();
}
function emoji(c, ch, size) { c.font = size + 'px ' + EMOJI_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 0, 0); }

function drawPart(c, p) {
 var k = p.age / p.life;
 var a = p.fade ? (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3) : 1;
 c.save();
 c.globalAlpha = clamp(a * p.alpha, 0, 1);
 c.translate(p.x, p.y);
 if (p.add) c.globalCompositeOperation = 'lighter';
 var sp;
 switch (p.shape) {
  case 'circle': c.fillStyle = p.color; c.beginPath(); c.arc(0, 0, p.size * (1 + p.grow * p.age), 0, 6.283); c.fill(); break;
  case 'drop':
   sp = Math.hypot(p.vx, p.vy);
   c.rotate(Math.atan2(p.vy, p.vx));
   c.fillStyle = p.color; c.beginPath(); c.ellipse(0, 0, p.size * Math.min(3, 1 + sp / 380), p.size, 0, 0, 6.283); c.fill();
   c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(p.size * 0.4, -p.size * 0.3, p.size * 0.28, 0, 6.283); c.fill();
   break;
  case 'blob': c.rotate(p.rot); c.fillStyle = p.color; blobPath(c, p.pts, p.size); c.fill(); break;
  case 'shard':
   c.rotate(p.rot); c.fillStyle = p.color; c.beginPath();
   c.moveTo(0, -p.size * p.pts[0]); c.lineTo(p.size * p.pts[1], p.size * 0.6); c.lineTo(-p.size * p.pts[2], p.size * 0.5); c.closePath(); c.fill();
   c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 0.8; c.stroke(); break;
  case 'confetti': c.rotate(p.rot); c.scale(1, Math.cos(p.age * p.flip + p.ph)); c.fillStyle = p.color; c.fillRect(-p.size / 2, -p.size, p.size, p.size * 2); break;
  case 'bill':
   c.rotate(p.rot); c.scale(Math.cos(p.age * p.flip + p.ph), 1);
   c.fillStyle = '#3d9a5c'; c.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
   c.strokeStyle = '#1f5e36'; c.lineWidth = 1; c.strokeRect(-p.size + 2, -p.size / 2 + 2, p.size * 2 - 4, p.size - 4);
   c.fillStyle = '#b8e6c4'; c.beginPath(); c.arc(0, 0, p.size * 0.28, 0, 6.283); c.fill(); break;
  case 'text': c.rotate(p.rot); emoji(c, p.text, p.size); break;
  case 'ring': c.strokeStyle = p.color; c.lineWidth = Math.max(0.5, p.lw * (1 - k)); c.beginPath(); c.arc(0, 0, p.size + p.age * p.grow, 0, 6.283); c.stroke(); break;
  case 'smoke':
   var rr = p.size + p.age * p.grow;
   var g = c.createRadialGradient(0, 0, 0, 0, 0, rr);
   g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
   c.fillStyle = g; c.beginPath(); c.arc(0, 0, rr, 0, 6.283); c.fill(); break;
  case 'spark':
   sp = Math.hypot(p.vx, p.vy);
   c.rotate(Math.atan2(p.vy, p.vx)); c.globalCompositeOperation = 'lighter';
   c.strokeStyle = p.color; c.lineWidth = p.size; c.lineCap = 'round';
   c.beginPath(); c.moveTo(0, 0); c.lineTo(-Math.min(34, 4 + sp * 0.05), 0); c.stroke(); break;
  case 'petal':
   c.rotate(p.rot); c.scale(1, 0.35 + Math.abs(Math.cos(p.age * p.flip)) * 0.65);
   var pg = c.createLinearGradient(-p.size, 0, p.size, 0); pg.addColorStop(0, p.color); pg.addColorStop(1, 'rgba(255,255,255,.45)');
   c.fillStyle = pg; c.beginPath(); c.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, 6.283); c.fill(); break;
  case 'star4':
   c.rotate(p.rot); c.fillStyle = p.color; c.beginPath();
   for (var i = 0; i < 8; i++) { var r2 = i % 2 ? p.size * 0.3 : p.size; var an = i * Math.PI / 4; c.lineTo(Math.cos(an) * r2, Math.sin(an) * r2); }
   c.closePath(); c.fill(); break;
 }
 c.restore();
}

function avEl(pid) {
 if (!pid) return null;
 var list = document.querySelectorAll('[data-av="' + CSS.escape(pid) + '"]');
 for (var i = 0; i < list.length; i++) { var r = list[i].getBoundingClientRect(); if (r.width > 0) return list[i]; }
 return null;
}
function anchorFor(pid) {
 var el = avEl(pid);
 if (!el) return null;
 var r = el.getBoundingClientRect();
 return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
}
function fallbackPoint() { return { x: FX.w / 2, y: FX.h - 120, r: 30 }; }

function fxFrame(now) {
 var dt = Math.min(0.05, (now - FX.last) / 1000); FX.last = now;
 var c = FX.ctx;
 c.clearRect(0, 0, FX.w, FX.h);
 var i;
 for (i = FX.decals.length - 1; i >= 0; i--) {
  var d = FX.decals[i];
  d.age += dt;
  if (d.age >= d.life) { FX.decals.splice(i, 1); continue; }
  var an = anchorFor(d.pid);
  if (an) { d.cx = an.x; d.cy = an.y; d.r = an.r; }
  c.save();
  c.globalAlpha = d.age > d.life - 0.8 ? (d.life - d.age) / 0.8 : 1;
  DECALS[d.type](c, d, dt);
  c.restore();
 }
 for (i = FX.projs.length - 1; i >= 0; i--) {
  var pr = FX.projs[i];
  pr.t += dt * 1000 / pr.dur;
  if (pr.t >= 1) { FX.projs.splice(i, 1); landProjectile(pr); continue; }
  drawProjectile(c, pr, dt);
 }
 for (i = FX.parts.length - 1; i >= 0; i--) {
  var p = FX.parts[i];
  p.age += dt;
  if (p.age >= p.life) { FX.parts.splice(i, 1); continue; }
  var dr = Math.pow(p.drag, dt * 60);
  p.vx *= dr; p.vy *= dr; p.vy += p.g * dt;
  p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  if (p.sway) p.x += Math.sin(p.age * p.sway + p.ph) * p.swayAmp * dt;
  if (p.floor && p.y > p.floor) { p.y = p.floor; p.vy *= -(p.bounce || 0.3); p.vx *= 0.6; p.vr *= 0.5; }
  drawPart(c, p);
 }
 if (FX.parts.length || FX.projs.length || FX.decals.length) requestAnimationFrame(fxFrame);
 else { FX.run = false; c.clearRect(0, 0, FX.w, FX.h); }
}

function decal(type, pid, fb, data) {
 var an = anchorFor(pid) || fb || fallbackPoint();
 var d = { type: type, pid: pid, age: 0, life: 4, cx: an.x, cy: an.y, r: an.r };
 for (var k in data) d[k] = data[k];
 FX.decals.push(d); fxKick(); return d;
}
function drips(n, spread, lenMin, lenMax, w) {
 var a = [];
 for (var i = 0; i < n; i++) a.push({ x: rnd(-spread, spread), y: rnd(0.2, 0.45), len: rnd(lenMin, lenMax), dur: rnd(1.4, 3), w: rnd(w * 0.6, w) });
 return a;
}
function drawDrips(c, d, list, color, r) {
 c.fillStyle = color;
 list.forEach(function (dr) {
  var k = Math.min(1, d.age / dr.dur);
  var L = dr.len * r * (1 - Math.pow(1 - k, 2));
  var x = dr.x * r, y0 = dr.y * r, w = dr.w * r;
  c.beginPath(); c.moveTo(x - w / 2, y0); c.lineTo(x - w * 0.35, y0 + L); c.arc(x, y0 + L, w * 0.5, Math.PI, 0, true); c.lineTo(x + w / 2, y0); c.closePath(); c.fill();
 });
}
function popIn(d, dur) { var k = Math.min(1, d.age / (dur || 0.12)); return 0.35 + 0.65 * (1 - Math.pow(1 - k, 3)); }
function gloss(c, r, x, y, a) { c.fillStyle = 'rgba(255,255,255,' + (a || 0.35) + ')'; c.beginPath(); c.ellipse(x * r, y * r, r * 0.16, r * 0.07, -0.5, 0, 6.283); c.fill(); }

var DECALS = {
 tomato: function (c, d) {
  var r = d.r; c.translate(d.cx + d.ox * r, d.cy + d.oy * r);
  drawDrips(c, d, d.drips, '#a8141a', r);
  var s = popIn(d); c.scale(s, s);
  d.spots.forEach(function (sp) { c.fillStyle = '#c21b18'; c.beginPath(); c.arc(sp.x * r, sp.y * r, sp.s * r, 0, 6.283); c.fill(); });
  var g = c.createRadialGradient(-r * 0.15, -r * 0.2, r * 0.05, 0, 0, r * 0.7);
  g.addColorStop(0, '#ff6a52'); g.addColorStop(0.45, '#d9281e'); g.addColorStop(1, '#8a0e10');
  c.fillStyle = g; blobPath(c, d.pts, r * 0.6); c.fill();
  c.fillStyle = 'rgba(255,170,140,.45)'; blobPath(c, d.pulp, r * 0.28); c.fill();
  d.seeds.forEach(function (sd) { c.save(); c.translate(sd.x * r, sd.y * r); c.rotate(sd.a); c.fillStyle = '#f5e3a0'; c.beginPath(); c.ellipse(0, 0, r * 0.055, r * 0.032, 0, 0, 6.283); c.fill(); c.restore(); });
  c.fillStyle = '#2f7a24'; c.save(); c.translate(d.stem.x * r, d.stem.y * r); c.rotate(d.stem.a);
  for (var i = 0; i < 5; i++) { c.rotate(1.256); c.beginPath(); c.ellipse(r * 0.08, 0, r * 0.09, r * 0.025, 0, 0, 6.283); c.fill(); }
  c.restore();
  gloss(c, r, -0.2, -0.25, 0.4);
 },
 egg: function (c, d) {
  var r = d.r; c.translate(d.cx + d.ox * r, d.cy + d.oy * r);
  drawDrips(c, d, d.drips, 'rgba(255,255,245,.72)', r);
  drawDrips(c, d, d.ydrip, 'rgba(250,170,20,.95)', r);
  var s = popIn(d); c.scale(s, s);
  c.fillStyle = 'rgba(255,255,248,.8)'; blobPath(c, d.pts, r * 0.7); c.fill();
  c.strokeStyle = 'rgba(200,190,160,.35)'; c.lineWidth = 1.2; c.stroke();
  gloss(c, r, -0.3, -0.3, 0.5);
  var yx = d.yx * r, yy = d.yy * r;
  var g = c.createRadialGradient(yx - r * 0.07, yy - r * 0.08, r * 0.02, yx, yy, r * 0.27);
  g.addColorStop(0, '#fff2a8'); g.addColorStop(0.35, '#ffc21a'); g.addColorStop(1, '#e07b00');
  c.fillStyle = g; c.beginPath(); c.arc(yx, yy, r * 0.25, 0, 6.283); c.fill();
  c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(yx - r * 0.08, yy - r * 0.09, r * 0.07, r * 0.04, -0.6, 0, 6.283); c.fill();
  d.shells.forEach(function (sh) { c.save(); c.translate(sh.x * r, sh.y * r); c.rotate(sh.a); c.fillStyle = '#f3e7d0'; c.beginPath(); c.moveTo(0, -r * 0.08); c.lineTo(r * 0.07, r * 0.05); c.lineTo(-r * 0.06, r * 0.04); c.closePath(); c.fill(); c.strokeStyle = 'rgba(120,90,40,.3)'; c.stroke(); c.restore(); });
 },
 pie: function (c, d) {
  var r = d.r; c.translate(d.cx, d.cy + r * 0.05);
  drawDrips(c, d, d.drips, '#fff6e4', r);
  var s = popIn(d, 0.1); c.scale(s, s);
  var g = c.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r * 0.9);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#fbeed6'); g.addColorStop(1, '#e8cfa6');
  c.fillStyle = g; blobPath(c, d.pts, r * 0.82); c.fill();
  d.cherries.forEach(function (ch) { var cg = c.createRadialGradient(ch.x * r - 2, ch.y * r - 2, 1, ch.x * r, ch.y * r, r * 0.1); cg.addColorStop(0, '#ff6b7a'); cg.addColorStop(1, '#8a0a1c'); c.fillStyle = cg; c.beginPath(); c.arc(ch.x * r, ch.y * r, r * 0.09, 0, 6.283); c.fill(); });
  d.crumbs.forEach(function (cr) { c.fillStyle = '#c48742'; c.beginPath(); c.arc(cr.x * r, cr.y * r, cr.s * r, 0, 6.283); c.fill(); });
  gloss(c, r, -0.3, -0.35, 0.6);
 },
 beer: function (c, d) {
  var r = d.r; c.translate(d.cx, d.cy);
  drawDrips(c, d, d.drips, 'rgba(230,160,30,.7)', r);
  c.fillStyle = 'rgba(242,176,40,.45)'; blobPath(c, d.pts, r * 0.95); c.fill();
  gloss(c, r, -0.35, -0.35, 0.45); gloss(c, r, 0.3, 0.2, 0.25);
  d.foam.forEach(function (f) {
   var rr = f.s * r * Math.max(0, 1 - d.age / (f.popAt));
   if (rr <= 0.5) return;
   c.fillStyle = 'rgba(255,253,240,.95)'; c.beginPath(); c.arc(f.x * r, f.y * r, rr, 0, 6.283); c.fill();
   c.strokeStyle = 'rgba(210,190,140,.5)'; c.lineWidth = 0.7; c.stroke();
  });
 },
 wet: function (c, d) {
  var r = d.r; c.translate(d.cx, d.cy);
  drawDrips(c, d, d.drips, 'rgba(110,190,255,.55)', r);
  c.fillStyle = 'rgba(120,200,255,.28)'; blobPath(c, d.pts, r * 1.05); c.fill();
  gloss(c, r, -0.3, -0.4, 0.6); gloss(c, r, 0.35, 0.1, 0.35);
 },
 broth: function (c, d) {
  var r = d.r; c.translate(d.cx, d.cy);
  drawDrips(c, d, d.drips, 'rgba(205,150,70,.7)', r);
  c.fillStyle = 'rgba(214,160,80,.45)'; blobPath(c, d.pts, r * 0.8); c.fill();
  gloss(c, r, -0.25, -0.3, 0.45);
  c.save(); c.translate(r * 0.1, -r * 0.1 + Math.min(1, d.age / 3.5) * r * 0.9); c.rotate(0.3 + d.age * 0.15); emoji(c, '🥟', r * 0.75); c.restore();
 },
 soot: function (c, d, dt) {
  var r = d.r; c.translate(d.cx, d.cy);
  d.blots.forEach(function (b) { c.fillStyle = 'rgba(18,14,10,' + b.a + ')'; blobPath(c, b.pts, b.s * r); c.save(); c.translate(b.x * r, b.y * r); c.restore(); c.fill(); });
  if (d.age < d.life - 1 && Math.random() < dt * 7) P({ x: d.cx + rnd(-r * 0.5, r * 0.5), y: d.cy - r * 0.8, vx: rnd(-10, 10), vy: rnd(-50, -30), g: -10, drag: 0.99, life: 1.6, size: r * 0.18, grow: r * 0.3, color: 'rgba(70,70,70,.5)', shape: 'smoke' });
 },
 frost: function (c, d) {
  var r = d.r; c.translate(d.cx, d.cy);
  var g = c.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.15);
  g.addColorStop(0, 'rgba(230,248,255,.55)'); g.addColorStop(0.75, 'rgba(160,215,245,.35)'); g.addColorStop(1, 'rgba(160,215,245,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, r * 1.15, 0, 6.283); c.fill();
  var grow = Math.min(1, d.age / 0.6);
  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.3; c.lineCap = 'round';
  d.lines.forEach(function (ln) {
   var L = ln.len * r * grow, ca = Math.cos(ln.a), sa = Math.sin(ln.a);
   c.beginPath(); c.moveTo(ca * r * 0.25, sa * r * 0.25); c.lineTo(ca * (r * 0.25 + L), sa * (r * 0.25 + L)); c.stroke();
   [0.45, 0.7].forEach(function (f) {
    var bx = ca * (r * 0.25 + L * f), by = sa * (r * 0.25 + L * f), bl = L * 0.22;
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(ln.a + 0.7) * bl, by + Math.sin(ln.a + 0.7) * bl);
    c.moveTo(bx, by); c.lineTo(bx + Math.cos(ln.a - 0.7) * bl, by + Math.sin(ln.a - 0.7) * bl); c.stroke();
   });
  });
  d.tw.forEach(function (t) {
   c.save(); c.translate(t.x * r, t.y * r); c.globalAlpha *= 0.5 + 0.5 * Math.sin(d.age * 6 + t.p);
   c.fillStyle = '#fff'; c.beginPath();
   for (var i = 0; i < 8; i++) { var rr = i % 2 ? 1.2 : 5; c.lineTo(Math.cos(i * 0.785) * rr, Math.sin(i * 0.785) * rr); }
   c.fill(); c.restore();
  });
 },
 paper: function (c, d) {
  var r = d.r; c.translate(d.cx, d.cy);
  var un = Math.min(1, d.age / 0.55);
  d.strips.forEach(function (s) {
   var sway = Math.sin(d.age * 2.2 + s.p) * r * 0.08;
   var x0 = s.x0 * r, y0 = -r * 0.95, x1 = s.x1 * r + sway, y1 = -r + (r * (2.1 + s.len)) * un;
   var cx = (x0 + x1) / 2 + s.bend * r, cy = (y0 + y1) / 2;
   c.lineCap = 'butt';
   c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = r * 0.22; c.beginPath(); c.moveTo(x0 + 2, y0 + 3); c.quadraticCurveTo(cx + 2, cy + 3, x1 + 2, y1 + 3); c.stroke();
   c.strokeStyle = '#fbfaf4'; c.lineWidth = r * 0.2; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1); c.stroke();
   c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = r * 0.05; c.beginPath(); c.moveTo(x0 + r * 0.06, y0); c.quadraticCurveTo(cx + r * 0.06, cy, x1 + r * 0.06, y1); c.stroke();
   c.strokeStyle = 'rgba(0,0,0,.14)'; c.lineWidth = 1;
   for (var t = 0.12; t < 1; t += 0.14) {
    var it = 1 - t, px = it * it * x0 + 2 * it * t * cx + t * t * x1, py = it * it * y0 + 2 * it * t * cy + t * t * y1;
    c.beginPath(); c.moveTo(px - r * 0.09, py); c.lineTo(px + r * 0.09, py); c.stroke();
   }
  });
 },
 kiss: function (c, d) {
  var r = d.r, k = Math.min(1, d.age / 0.45);
  var s = 1 + Math.sin(k * Math.PI * 3) * (1 - k) * 0.5;
  c.translate(d.cx + r * 0.2, d.cy + r * 0.15); c.rotate(-0.35); c.scale(s, s); emoji(c, '💋', r * 0.95);
 },
 rose: function (c, d) {
  var r = d.r, k = Math.min(1, d.age / 0.5);
  c.translate(d.cx + r * 0.6, d.cy + r * 0.75 - (1 - k) * r * 0.6); c.rotate(1.1 + (1 - k) * 2); emoji(c, '🌹', r * 0.9);
 },
 crown: function (c, d) {
  var r = d.r, k = Math.min(1, d.age / 0.8);
  var b = Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * r * 0.6;
  c.translate(d.cx, d.cy - r * 1.12 - b); c.rotate(Math.sin(d.age * 2) * 0.08); emoji(c, '👑', r * 1.05);
  if (Math.random() < 0.25) P({ x: d.cx + rnd(-r * 0.5, r * 0.5), y: d.cy - r * 1.2 + rnd(-r * 0.3, r * 0.3), g: 0, life: 0.6, size: rnd(3, 6), color: '#fff3b0', shape: 'star4', add: true });
 },
 dizzy: function (c, d) {
  var r = d.r;
  for (var i = 0; i < 3; i++) {
   var a = d.age * 5 + i * 2.094;
   c.save(); c.translate(d.cx + Math.cos(a) * r * 0.85, d.cy - r * 0.95 + Math.sin(a) * r * 0.22); emoji(c, '⭐', r * 0.36); c.restore();
  }
 },
 glow: function (c, d) {
  var r = d.r, pulse = 1 + Math.sin(d.age * 7) * 0.08;
  c.globalCompositeOperation = 'lighter'; c.translate(d.cx, d.cy);
  var g = c.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.7 * pulse);
  g.addColorStop(0, 'rgba(255,90,160,.45)'); g.addColorStop(1, 'rgba(255,90,160,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, r * 1.7 * pulse, 0, 6.283); c.fill();
 },
 bolt: function (c, d) {
  if (d.age < 0.1) { c.fillStyle = 'rgba(210,235,255,' + (0.55 * (1 - d.age / 0.1)) + ')'; c.fillRect(0, 0, FX.w, FX.h); }
  if (d.age > 0.6 || Math.floor(d.age * 24) % 3 === 2) return;
  var pts = d.path;
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.shadowColor = '#8fd3ff'; c.shadowBlur = 28;
  c.strokeStyle = 'rgba(140,200,255,.7)'; c.lineWidth = 9; c.beginPath();
  pts.forEach(function (p, i) { var x = p[0] + (d.cx - d.x1) * (i / (pts.length - 1)); var y = p[1] + (d.cy - d.y1) * (i / (pts.length - 1)); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
  c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 3; c.stroke();
 },
 flash: function (c, d) { c.fillStyle = d.color || '#fff'; c.globalAlpha *= Math.max(0, 1 - d.age / d.life) * 0.7; c.fillRect(0, 0, FX.w, FX.h); }
};

/* ---------- screen shake & avatar status ---------- */
function shake(power) {
 var el = !$('game').classList.contains('hidden') ? $('arena') : document.body;
 var a = power || 8;
 try {
  el.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(' + a + 'px,' + (-a * 0.6) + 'px)' }, { transform: 'translate(' + (-a * 0.8) + 'px,' + (a * 0.5) + 'px)' }, { transform: 'translate(' + (a * 0.4) + 'px,' + (-a * 0.3) + 'px)' }, { transform: 'translate(0,0)' }], { duration: 400, easing: 'cubic-bezier(.36,.07,.19,.97)' });
 } catch (e) {}
}
function status(pid, cls, ms) {
 var list = document.querySelectorAll('[data-av="' + CSS.escape(pid) + '"]');
 list.forEach(function (el) {
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  setTimeout(function () { el.classList.remove(cls); }, ms);
 });
}

/* ---------- burst helpers ---------- */
function splash(x, y, n, colors, opt) {
 opt = opt || {};
 for (var i = 0; i < n; i++) {
  var a = rnd(-Math.PI, 0) + rnd(-0.4, 0.4), sp = rnd(opt.min || 120, opt.max || 420);
  P({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: opt.g || 1300, drag: 0.99, life: rnd(0.5, 1), size: rnd(opt.s0 || 2.5, opt.s1 || 6), color: pick(colors), shape: opt.shape || 'drop', floor: opt.floor });
 }
}
function radial(x, y, n, colors, opt) {
 opt = opt || {};
 for (var i = 0; i < n; i++) {
  var a = Math.random() * 6.283, sp = rnd(opt.min || 100, opt.max || 380);
  P({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: opt.g == null ? 200 : opt.g, drag: opt.drag || 0.96, life: rnd(opt.l0 || 0.8, opt.l1 || 1.5), size: rnd(opt.s0 || 1.5, opt.s1 || 3), color: pick(colors), shape: opt.shape || 'spark', add: opt.add });
 }
}

/* ---------- throwable impacts ---------- */
var IMPACT = {
 tomato: function (pid, b) {
  SFX.splat(); shake(7); status(pid, 'hit', 450);
  splash(b.x, b.y, 22, ['#e3241c', '#b3161a', '#ff4a3a']);
  for (var i = 0; i < 6; i++) P({ x: b.x, y: b.y, vx: rnd(-260, 260), vy: rnd(-300, -80), g: 1300, life: 0.9, size: rnd(4, 8), color: '#c81d1a', shape: 'blob', vr: rnd(-8, 8), floor: b.y + b.r * 1.6 });
  for (var j = 0; j < 8; j++) P({ x: b.x, y: b.y, vx: rnd(-200, 200), vy: rnd(-260, -60), g: 1100, life: 0.8, size: rnd(2, 3), color: '#f5e3a0', shape: 'blob', vr: 5 });
  var spots = [], seeds = [];
  for (var k = 0; k < 7; k++) { var a = Math.random() * 6.28; spots.push({ x: Math.cos(a) * rnd(0.55, 0.85), y: Math.sin(a) * rnd(0.5, 0.8), s: rnd(0.04, 0.1) }); }
  for (var m = 0; m < 9; m++) seeds.push({ x: rnd(-0.3, 0.3), y: rnd(-0.25, 0.3), a: Math.random() * 3 });
  decal('tomato', pid, b, { life: 4.8, ox: rnd(-0.15, 0.15), oy: rnd(-0.2, 0.05), pts: rndBlob(12, 0.3), pulp: rndBlob(7, 0.35), spots: spots, seeds: seeds, stem: { x: rnd(-0.3, 0.3), y: rnd(-0.4, -0.2), a: Math.random() * 3 }, drips: drips(4, 0.45, 0.4, 1.1, 0.1) });
 },
 egg: function (pid, b) {
  SFX.crack(); shake(5); status(pid, 'hit', 450);
  for (var i = 0; i < 12; i++) P({ x: b.x, y: b.y, vx: rnd(-280, 280), vy: rnd(-360, -80), g: 1400, life: 1.3, size: rnd(4, 8), color: pick(['#f6ecd8', '#eadbbb', '#fff8ea']), shape: 'shard', vr: rnd(-14, 14), floor: b.y + b.r * 1.7, bounce: 0.35 });
  splash(b.x, b.y, 10, ['#ffc21a', '#ffd75a', 'rgba(255,255,245,.8)'], { max: 280 });
  var shells = [];
  for (var k = 0; k < 4; k++) shells.push({ x: rnd(-0.55, 0.55), y: rnd(-0.55, 0.4), a: Math.random() * 6 });
  decal('egg', pid, b, { life: 5.2, ox: rnd(-0.12, 0.12), oy: rnd(-0.25, 0), pts: rndBlob(10, 0.3), yx: rnd(-0.12, 0.12), yy: rnd(-0.1, 0.1), shells: shells, drips: drips(4, 0.5, 0.5, 1.2, 0.12), ydrip: [{ x: rnd(-0.1, 0.1), y: 0.2, len: rnd(0.7, 1.1), dur: 3.5, w: 0.1 }] });
 },
 paper: function (pid, b) {
  SFX.paper(); status(pid, 'hit', 450);
  for (var i = 0; i < 10; i++) P({ x: b.x, y: b.y, vx: rnd(-200, 200), vy: rnd(-260, -60), g: 180, drag: 0.96, life: 2.2, size: rnd(4, 7), color: '#fbfaf4', shape: 'confetti', sway: 3, swayAmp: 40 });
  var strips = [];
  for (var k = 0; k < 5; k++) var sx = rnd(-0.85, 0.85); strips.push({ x0: sx, x1: sx * 1.25 + rnd(-0.25, 0.25), len: rnd(0.1, 0.8), bend: rnd(-0.3, 0.3), p: Math.random() * 6 });
  decal('paper', pid, b, { life: 5.5, strips: strips });
 },
 beer: function (pid, b) {
  SFX.clink(); shake(5); status(pid, 'hit', 450);
  splash(b.x, b.y, 26, ['#f2b233', '#e09a1b', '#ffd36b'], { max: 460 });
  for (var i = 0; i < 16; i++) P({ x: b.x + rnd(-10, 10), y: b.y, vx: rnd(-160, 160), vy: rnd(-260, -60), g: 250, drag: 0.95, life: rnd(0.8, 1.5), size: rnd(3, 7), color: 'rgba(255,253,240,.95)', shape: 'circle' });
  var foam = [];
  for (var k = 0; k < 16; k++) foam.push({ x: rnd(-0.55, 0.55), y: rnd(-0.75, -0.2), s: rnd(0.06, 0.14), popAt: rnd(2, 4.5) });
  decal('beer', pid, b, { life: 4.6, pts: rndBlob(10, 0.25), foam: foam, drips: drips(5, 0.6, 0.6, 1.4, 0.09) });
 },
 rose: function (pid, b) {
  SFX.chime();
  for (var i = 0; i < 20; i++) P({ x: b.x + rnd(-20, 20), y: b.y - 20, vx: rnd(-90, 90), vy: rnd(-160, -40), g: 70, drag: 0.97, life: rnd(2, 3.2), size: rnd(5, 9), color: pick(['#c9184a', '#ff4d6d', '#a4133c', '#ff758f']), shape: 'petal', sway: 3, swayAmp: 45, vr: rnd(-3, 3) });
  for (var j = 0; j < 5; j++) P({ x: b.x + rnd(-20, 20), y: b.y, vx: rnd(-30, 30), vy: rnd(-90, -60), g: -20, life: 1.8, size: rnd(14, 22), text: '❤️', shape: 'text' });
  decal('rose', pid, b, { life: 4.5 });
 },
 ice: function (pid, b) {
  SFX.ice(); shake(4); status(pid, 'frozen', 3600);
  for (var i = 0; i < 16; i++) P({ x: b.x, y: b.y, vx: rnd(-300, 300), vy: rnd(-340, -60), g: 1300, life: 1.2, size: rnd(4, 9), color: pick(['#e8f9ff', '#a9e2f7', '#7fcfee']), shape: 'shard', vr: rnd(-10, 10), floor: b.y + b.r * 1.7 });
  radial(b.x, b.y, 18, ['#ffffff', '#cdefff'], { g: 40, shape: 'circle', s0: 1.5, s1: 3, max: 160 });
  var lines = [], tw = [];
  for (var k = 0; k < 12; k++) lines.push({ a: k / 12 * 6.283 + rnd(-0.15, 0.15), len: rnd(0.45, 0.8) });
  for (var m = 0; m < 6; m++) tw.push({ x: rnd(-0.8, 0.8), y: rnd(-0.8, 0.8), p: Math.random() * 6 });
  decal('frost', pid, b, { life: 3.8, lines: lines, tw: tw });
 },
 bomb: function (pid, b) {
  SFX.boom(); shake(18); status(pid, 'sooty', 4200); status(pid, 'hit', 450);
  decal('flash', null, b, { life: 0.25, color: '#fff6d8' });
  P({ x: b.x, y: b.y, g: 0, life: 0.5, size: b.r * 0.6, grow: b.r * 7, lw: 10, color: 'rgba(255,230,180,.8)', shape: 'ring' });
  for (var i = 0; i < 14; i++) P({ x: b.x + rnd(-15, 15), y: b.y + rnd(-15, 15), vx: rnd(-140, 140), vy: rnd(-140, 80), g: -40, drag: 0.93, life: rnd(0.35, 0.6), size: b.r * rnd(0.3, 0.6), grow: b.r * 1.6, color: pick(['rgba(255,220,120,.95)', 'rgba(255,140,40,.9)', 'rgba(255,80,20,.85)']), shape: 'smoke', add: true });
  for (var j = 0; j < 16; j++) P({ x: b.x, y: b.y, vx: rnd(-90, 90), vy: rnd(-120, -20), g: -30, drag: 0.97, life: rnd(1.4, 2.6), size: b.r * rnd(0.3, 0.5), grow: b.r * 0.9, color: 'rgba(60,55,50,.55)', shape: 'smoke' });
  radial(b.x, b.y, 40, ['#ffd75e', '#ff8a3d', '#fff3b0'], { min: 200, max: 650, g: 500 });
  var blots = [];
  for (var k = 0; k < 4; k++) blots.push({ pts: rndBlob(8, 0.35), s: rnd(0.3, 0.55), a: rnd(0.35, 0.55), x: 0, y: 0 });
  decal('soot', pid, b, { life: 4.2, blots: blots });
 },
 pie: function (pid, b) {
  SFX.splat(); shake(8); status(pid, 'hit', 450);
  splash(b.x, b.y, 20, ['#fffaf0', '#fbeed6', '#ff6b7a'], { max: 380, s0: 3, s1: 7 });
  for (var i = 0; i < 12; i++) P({ x: b.x, y: b.y, vx: rnd(-260, 260), vy: rnd(-300, -60), g: 1300, life: 1, size: rnd(2, 4), color: '#c48742', shape: 'blob', floor: b.y + b.r * 1.7 });
  var cherries = [], crumbs = [];
  for (var k = 0; k < 3; k++) cherries.push({ x: rnd(-0.4, 0.4), y: rnd(-0.35, 0.35) });
  for (var m = 0; m < 12; m++) { var a = Math.random() * 6.28; crumbs.push({ x: Math.cos(a) * rnd(0.7, 1), y: Math.sin(a) * rnd(0.7, 1), s: rnd(0.03, 0.07) }); }
  decal('pie', pid, b, { life: 5, pts: rndBlob(12, 0.2), cherries: cherries, crumbs: crumbs, drips: drips(5, 0.6, 0.4, 1, 0.13) });
 },
 kiss: function (pid, b) {
  SFX.kiss();
  radial(b.x, b.y, 16, ['#ff8fb3', '#ffd1e0', '#ff4d8d'], { g: -30, shape: 'star4', s0: 3, s1: 6, max: 160 });
  for (var i = 0; i < 4; i++) P({ x: b.x + rnd(-20, 20), y: b.y, vx: rnd(-30, 30), vy: rnd(-80, -50), g: -10, life: 1.6, size: rnd(12, 18), text: '💕', shape: 'text' });
  decal('kiss', pid, b, { life: 3.6 });
 },
 balloon: function (pid, b) {
  SFX.pop(); SFX.splash(); shake(6); status(pid, 'hit', 450);
  for (var i = 0; i < 6; i++) P({ x: b.x, y: b.y, vx: rnd(-220, 220), vy: rnd(-260, -40), g: 900, life: 0.9, size: rnd(4, 7), color: '#e3243a', shape: 'shard', vr: rnd(-12, 12) });
  radial(b.x, b.y, 40, ['#8fd8ff', '#4aa8e8', '#d9f3ff'], { shape: 'drop', g: 1200, min: 150, max: 520, s0: 2.5, s1: 5.5, drag: 0.99 });
  decal('wet', pid, b, { life: 4.5, pts: rndBlob(10, 0.2), drips: drips(7, 0.8, 0.6, 1.6, 0.08) });
 },
 khinkali: function (pid, b) {
  SFX.splat(); shake(5); status(pid, 'hit', 450);
  splash(b.x, b.y, 20, ['#d9a55b', '#f0c47a', '#b98434'], { max: 360 });
  decal('broth', pid, b, { life: 4.8, pts: rndBlob(10, 0.3), drips: drips(5, 0.5, 0.5, 1.2, 0.1) });
 },
 slipper: function (pid, b) {
  SFX.slap(); shake(11); status(pid, 'hit', 450);
  P({ x: b.x, y: b.y, vx: rnd(-120, 120), vy: -260, g: 1300, life: 1.4, size: b.r * 0.9, text: '🩴', shape: 'text', vr: rnd(-10, 10), floor: b.y + b.r * 1.5, bounce: 0.35 });
  radial(b.x, b.y - b.r * 0.4, 10, ['#fff3b0', '#ffd75e'], { shape: 'star4', g: 0, s0: 3, s1: 6, max: 200 });
  decal('dizzy', pid, b, { life: 3.4 });
 },
 fish: function (pid, b) {
  SFX.slap(); SFX.splash(); shake(9); status(pid, 'hit', 450);
  P({ x: b.x, y: b.y, vx: rnd(-80, 80), vy: -220, g: 1200, life: 1.6, size: b.r * 0.95, text: '🐟', shape: 'text', vr: rnd(-16, 16), floor: b.y + b.r * 1.5, bounce: 0.5 });
  radial(b.x, b.y, 26, ['#9fdcf5', '#d9f3ff'], { shape: 'drop', g: 1100, min: 120, max: 400, s0: 2, s1: 4.5, drag: 0.99 });
  decal('wet', pid, b, { life: 3.5, pts: rndBlob(9, 0.3), drips: drips(3, 0.5, 0.3, 0.9, 0.07) });
 },
 heart: function (pid, b) {
  SFX.chime();
  for (var i = 0; i < 14; i++) P({ x: b.x + rnd(-b.r, b.r), y: b.y + rnd(-10, 20), vx: rnd(-40, 40), vy: rnd(-140, -60), g: -20, drag: 0.98, life: rnd(1.6, 2.6), size: rnd(14, 26), text: pick(['💖', '💕', '❤️', '💗']), shape: 'text', sway: 3, swayAmp: 30 });
  decal('glow', pid, b, { life: 3 });
 },
 money: function (pid, b) {
  SFX.coins();
  for (var i = 0; i < 26; i++) P({ x: b.x + rnd(-b.r * 2, b.r * 2), y: b.y - b.r * rnd(2, 4), vx: rnd(-40, 40), vy: rnd(20, 90), g: 90, drag: 0.97, life: rnd(2, 3), size: rnd(10, 15), shape: 'bill', vr: rnd(-3, 3), sway: 3, swayAmp: 40 });
  for (var j = 0; j < 10; j++) P({ x: b.x, y: b.y, vx: rnd(-240, 240), vy: rnd(-340, -120), g: 1100, life: 1.3, size: rnd(14, 20), text: '🪙', shape: 'text', vr: rnd(-10, 10), floor: b.y + b.r * 1.6, bounce: 0.45 });
 },
 lightning: function (pid, b) {
  SFX.zap(); shake(14); status(pid, 'shocked', 2200);
  var x0 = b.x + rnd(-120, 120), pts = [], n = 12;
  for (var i = 0; i <= n; i++) { var t = i / n; pts.push([x0 + (b.x - x0) * t + (i && i < n ? rnd(-35, 35) : 0), b.y * t]); }
  decal('bolt', pid, b, { life: 0.7, path: pts, x1: b.x, y1: b.y });
  radial(b.x, b.y, 30, ['#ffffff', '#9cd8ff', '#fff3b0'], { min: 150, max: 520, g: 400, add: true });
  for (var j = 0; j < 8; j++) P({ x: b.x, y: b.y - b.r * 0.6, vx: rnd(-30, 30), vy: rnd(-60, -30), g: -20, life: 1.6, size: b.r * 0.2, grow: b.r * 0.5, color: 'rgba(90,90,100,.45)', shape: 'smoke' });
 },
 fireworks: function (pid, b) {
  var colorsets = [['#ff4d6d', '#ffd1dc'], ['#ffd75e', '#fff3b0'], ['#4dd8ff', '#d9f6ff'], ['#9d6bff', '#e6d9ff'], ['#43c98a', '#c8ffe2']];
  [0, 280, 560].forEach(function (d, i) {
   setTimeout(function () {
    var x = b.x + rnd(-b.r * 1.5, b.r * 1.5), y = b.y - b.r * rnd(0.8, 2);
    SFX.pop();
    P({ x: x, y: y, g: 0, life: 0.35, size: 4, grow: 160, lw: 3, color: 'rgba(255,255,255,.7)', shape: 'ring' });
    radial(x, y, 60, colorsets[(i + Math.floor(Math.random() * 5)) % 5], { min: 60, max: 300, g: 160, drag: 0.955, l0: 0.9, l1: 1.6, s0: 1.5, s1: 2.8, add: true });
   }, d);
  });
 },
 crown: function (pid, b) {
  SFX.fanfare();
  radial(b.x, b.y - b.r, 30, ['#fff3b0', '#ffd75e', '#ffffff'], { shape: 'star4', g: 60, s0: 2, s1: 5, max: 220, add: true });
  decal('crown', pid, b, { life: 5.5 });
 }
};

var PROJ = {
 tomato: { e: '🍅', spin: 7 }, egg: { e: '🥚', spin: 9 }, paper: { e: '🧻', spin: 11, trail: 'paper' },
 beer: { e: '🍺', spin: 5 }, rose: { e: '🌹', spin: 1.2, slow: 1.35, arc: 1.4 }, ice: { e: '🧊', spin: 12 },
 bomb: { e: '💣', spin: 4, trail: 'fuse' }, pie: { e: '🥧', spin: 3 }, kiss: { e: '💋', spin: 0.5, slow: 1.2 },
 balloon: { e: '🎈', spin: 2, slow: 1.15 }, khinkali: { e: '🥟', spin: 8 }, slipper: { e: '🩴', spin: 16 },
 fish: { e: '🐟', spin: 10 }, heart: { e: '💖', spin: 0.5, slow: 1.3, arc: 1.3 }, money: { e: '💸', spin: 2, slow: 1.1 },
 fireworks: { e: '🎆', spin: 0, trail: 'sparks' }, crown: { e: '👑', spin: 0.6, slow: 1.5, arc: 1.5 }
};

function throwAt(fromPid, toPid, type) {
 var b = anchorFor(toPid) || fallbackPoint();
 if (type === 'lightning') { IMPACT.lightning(toPid, b); return; }
 var cfg = PROJ[type] || PROJ.tomato;
 var a = anchorFor(fromPid) || { x: FX.w / 2, y: FX.h - 60, r: 30 };
 var dist = Math.hypot(b.x - a.x, b.y - a.y);
 var dur = clamp(420 + dist * 0.55, 500, 1000) * (cfg.slow || 1);
 FX.projs.push({ type: type, cfg: cfg, pid: toPid, a: a, b: b, t: 0, dur: dur, arc: Math.max(70, dist * 0.32) * (cfg.arc || 1), size: clamp(a.r * 0.9, 26, 44), trail: [] });
 SFX.whoosh(dur / 1000);
 fxKick();
}
function drawProjectile(c, p) {
 var t = p.t, x = p.a.x + (p.b.x - p.a.x) * t, gy = p.a.y + (p.b.y - p.a.y) * t;
 var h = Math.sin(Math.PI * t) * p.arc, y = gy - h, hk = h / p.arc;
 c.save();
 c.fillStyle = 'rgba(0,0,0,' + (0.3 * (1 - hk * 0.6)) + ')';
 c.beginPath(); c.ellipse(x, gy + p.size * 0.55, p.size * 0.55 * (1 - hk * 0.4), p.size * 0.18 * (1 - hk * 0.4), 0, 0, 6.283); c.fill();
 c.restore();
 p.trail.push([x, y]); if (p.trail.length > 40) p.trail.shift();
 if (p.cfg.trail === 'paper' && p.trail.length > 2) {
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = 'rgba(0,0,0,.2)'; c.lineWidth = 9; c.beginPath();
  p.trail.forEach(function (q, i) { var w = Math.sin(i * 0.6 + t * 20) * 4; if (i) c.lineTo(q[0] + w + 2, q[1] + 3); else c.moveTo(q[0] + 2, q[1] + 3); }); c.stroke();
  c.strokeStyle = '#fbfaf4'; c.lineWidth = 8; c.beginPath();
  p.trail.forEach(function (q, i) { var w = Math.sin(i * 0.6 + t * 20) * 4; if (i) c.lineTo(q[0] + w, q[1]); else c.moveTo(q[0], q[1]); }); c.stroke();
  c.restore();
 }
 if (p.cfg.trail === 'fuse') P({ x: x + p.size * 0.3, y: y - p.size * 0.45, vx: rnd(-80, 80), vy: rnd(-120, -20), g: 300, life: 0.3, size: 1.6, color: pick(['#ffd75e', '#ff8a3d', '#fff']), shape: 'spark' });
 if (p.cfg.trail === 'sparks') P({ x: x, y: y, vx: rnd(-40, 40), vy: rnd(20, 80), g: 200, life: 0.5, size: 1.8, color: pick(['#ffd75e', '#ff4d6d', '#4dd8ff']), shape: 'spark' });
 for (var gI = 3; gI >= 1; gI--) {
  var q = p.trail[p.trail.length - 1 - gI * 2];
  if (!q) continue;
  c.save(); c.globalAlpha = 0.12 / gI; c.translate(q[0], q[1]); emoji(c, p.cfg.e, p.size); c.restore();
 }
 c.save(); c.translate(x, y); c.rotate(p.cfg.spin * t * (p.b.x < p.a.x ? -1 : 1)); c.scale(1 + hk * 0.3, 1 + hk * 0.3);
 c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 8; c.shadowOffsetY = 4;
 emoji(c, p.cfg.e, p.size); c.restore();
}
function landProjectile(p) {
 var b = anchorFor(p.pid) || p.b;
 (IMPACT[p.type] || IMPACT.tomato)(p.pid, b);
}

/* ---------- victory effects ---------- */
var WIN = {
 confetti: function () {
  var cols = ['#f3d690', '#43c98a', '#ff5a64', '#4dd8ff', '#b58cff', '#ffffff'];
  for (var i = 0; i < 200; i++) P({ x: rnd(0, FX.w), y: rnd(-FX.h * 0.6, -10), vx: rnd(-60, 60), vy: rnd(80, 260), g: 120, drag: 0.99, life: rnd(3, 5), size: rnd(4, 7), color: pick(cols), shape: 'confetti', vr: rnd(-6, 6), sway: 2, swayAmp: 50 });
 },
 fireworks: function () {
  for (var k = 0; k < 7; k++) (function (k) {
   setTimeout(function () {
    var x = rnd(FX.w * 0.15, FX.w * 0.85), y = rnd(FX.h * 0.12, FX.h * 0.45), hue = Math.floor(rnd(0, 360));
    SFX.pop();
    P({ x: x, y: y, g: 0, life: 0.4, size: 4, grow: 260, lw: 4, color: 'hsla(' + hue + ',100%,80%,.7)', shape: 'ring' });
    radial(x, y, 90, ['hsl(' + hue + ',100%,65%)', 'hsl(' + ((hue + 40) % 360) + ',100%,75%)', '#fff'], { min: 80, max: 420, g: 150, drag: 0.955, l0: 1, l1: 1.8, s0: 1.5, s1: 3, add: true });
   }, k * 380);
  })(k);
 },
 coinrain: function () {
  SFX.coins(); setTimeout(SFX.coins, 600); setTimeout(SFX.coins, 1200);
  for (var i = 0; i < 90; i++) P({ x: rnd(0, FX.w), y: rnd(-FX.h * 0.8, -20), vx: rnd(-30, 30), vy: rnd(100, 300), g: 420, life: rnd(3, 4.5), size: rnd(18, 30), text: '🪙', shape: 'text', vr: rnd(-6, 6) });
 },
 petals: function () {
  for (var i = 0; i < 130; i++) P({ x: rnd(0, FX.w), y: rnd(-FX.h * 0.6, -10), vx: rnd(-40, 40), vy: rnd(40, 120), g: 40, drag: 0.99, life: rnd(4, 6), size: rnd(6, 10), color: pick(['#ffb3c7', '#ff8fab', '#ffc8dd', '#ffe5ec']), shape: 'petal', vr: rnd(-3, 3), sway: 2, swayAmp: 60 });
 },
 stars: function () {
  var x = FX.w / 2, y = FX.h / 2;
  for (var i = 0; i < 110; i++) { var a = Math.random() * 6.283, sp = rnd(150, 700); P({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 200, drag: 0.97, life: rnd(1.5, 2.8), size: rnd(12, 26), text: pick(['✨', '⭐', '🌟']), shape: 'text', vr: rnd(-4, 4) }); }
 }
};
function winEffect(key) { (WIN[key] || WIN.confetti)(); SFX.win(); }

/* ============================================================
   SCREENS
   ============================================================ */
function screen(name) {
 ['auth', 'lobby', 'game', 'dominoGame'].forEach(function (id) { $(id).classList.toggle('hidden', id !== name); });
 $('side').classList.remove('open');
}
function openModal(id) { show(id); }
document.addEventListener('click', function (e) {
 var x = e.target.closest('[data-close]');
 if (x) hide(x.dataset.close);
 if (e.target.classList && e.target.classList.contains('modal') && e.target.id !== 'waitModal' && e.target.id !== 'overModal') e.target.classList.add('hidden');
 if (!e.target.closest('#throwMenu') && !e.target.closest('.seat.opp .av')) hide('throwMenu');
 if (!e.target.closest('#feltMenu') && !e.target.closest('#feltBtn')) hide('feltMenu');
});
document.addEventListener('keydown', function (e) {
 if (e.key === 'Escape') document.querySelectorAll('.modal:not(.hidden)').forEach(function (m) { if (m.id !== 'waitModal' && m.id !== 'overModal') m.classList.add('hidden'); });
});
function segBind(id, cb) {
 $(id).querySelectorAll('button').forEach(function (b) {
  b.onclick = function () {
   $(id).querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
   b.classList.add('on'); cb(Number(b.dataset.v)); SFX.select();
  };
 });
}

/* ============================================================
   AUTH
   ============================================================ */
function renderHeroFan() {
 var cards = [{ suit: 'spades', rank: 'A' }, { suit: 'hearts', rank: '10' }, { suit: 'diamonds', rank: 'K' }, { suit: 'clubs', rank: 'Q' }, { suit: 'hearts', rank: 'J' }];
 $('heroFan').innerHTML = cards.map(function (c, i) {
  return cardHtml({ id: 'h' + i, suit: c.suit, rank: c.rank }).replace('class="card', 'style="left:' + (i * 58) + 'px;transform:rotate(' + ((i - 2) * 9) + 'deg) translateY(' + (Math.abs(i - 2) * 8) + 'px);animation-delay:' + (i * 0.09) + 's" class="card');
 }).join('');
}
function renderAvatarPick() {
 var list = S.catalog.filter(function (i) { return i.type === 'avatar' && i.price === 0; }).map(function (i) { return i.emoji; });
 if (!list.length) list = ['🦊', '😎', '🦁', '🐺', '👑', '🧙'];
 $('avatarPick').innerHTML = list.map(function (e) { return '<div data-e="' + esc(e) + '">' + avatarHtml(e, { name: e, cls: e === S.chosenAvatar ? 'on' : '' }) + '</div>'; }).join('');
 $('avatarPick').querySelectorAll('[data-e]').forEach(function (n) {
  n.onclick = function () { S.chosenAvatar = n.dataset.e; renderAvatarPick(); };
 });
}
function setAuthMode(m) {
 S.authMode = m;
 $('loginTab').classList.toggle('on', m === 'login');
 $('registerTab').classList.toggle('on', m === 'register');
 $('avatarBox').classList.toggle('hidden', m !== 'register');
 $('authBtn').dataset.i18n = m;
 $('authBtn').textContent = t(m);
 $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
}
$('loginTab').onclick = function () { setAuthMode('login'); };
$('registerTab').onclick = function () { setAuthMode('register'); };
$('avatarFile').onchange = function () {
 var file = this.files && this.files[0];
 if (!file) return;
 if (file.size > 500000) { $('authError').textContent = 'ფოტო მაქსიმუმ 500 KB უნდა იყოს.'; return; }
 var reader = new FileReader();
 reader.onload = function () { S.chosenAvatar = reader.result; renderAvatarPick(); toast('📷 ფოტო არჩეულია'); };
 reader.readAsDataURL(file);
};
function submitAuth() {
 $('authError').textContent = '';
 socket.emit(S.authMode, { username: $('username').value, password: $('password').value, avatar: S.chosenAvatar });
}
$('authBtn').onclick = submitAuth;
$('password').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitAuth(); });
$('testerBtn').onclick = function () { socket.emit('testerLogin'); };

socket.on('serverInfo', function (info) {
 S.serverInfo = info || S.serverInfo;
 $('testerBtn').classList.toggle('hidden', !S.serverInfo.tester);
 renderPhrases();
});
socket.on('shopCatalog', function (list) {
 S.catalog = list || [];
 renderAvatarPick();
 if (S.profile) renderProfile();
 if (!$('shopModal').classList.contains('hidden')) renderShop();
});
socket.on('authSuccess', function (data) {
 S.profile = data.profile;
 if (data.token) { S.token = data.token; try { localStorage.setItem('buraToken', data.token); } catch (e) {} }
 if (!$('game').classList.contains('hidden') || !$('dominoGame').classList.contains('hidden')) { renderProfile(); return; }
 screen('lobby');
 renderProfile();
 if (data.streakBonus > 0) toast('🔥 ' + data.loginStreak + ' დღიანი სერია — +' + data.streakBonus + ' მონეტა', { gold: true, ms: 4000 });
 if (S.pendingInvite) { var inv = S.pendingInvite; S.pendingInvite = null; socket.emit(inv.indexOf('droom') === 0 ? 'dominoJoinTable' : 'joinTable', { roomId: inv }); }
});
socket.on('authError', function (m) { $('authError').textContent = m; });
socket.on('sessionInvalid', function () { try { localStorage.removeItem('buraToken'); } catch (e) {} });
socket.on('sessionRecovered', function () { toast('🔄 თამაში აღდგენილია'); });
socket.on('loggedOut', function () { try { localStorage.removeItem('buraToken'); } catch (e) {} location.href = '/'; });
socket.on('toast', function (m) { toast(m); });
socket.on('errorMessage', function (m) { toast('⚠️ ' + m); });

/* ============================================================
   PROFILE / LOBBY
   ============================================================ */
function renderProfile() {
 var p = S.profile; if (!p) return;
 $('profileAv').innerHTML = avatarHtml(p.avatar, { id: p.id, name: p.username, frame: p.equipped.frame, level: p.level });
 $('profileName').textContent = p.username;
 $('profileTitle').innerHTML = titleHtml(p.equipped.title);
 $('profileRank').textContent = p.rank.icon + ' ' + p.rank.name + ' · ' + p.rating;
 $('profileLevel').textContent = 'დონე ' + p.level;
 var into = p.xp % 100;
 $('xpFill').style.width = into + '%';
 $('xpText').textContent = into + ' / 100 XP';
 $('streakText').textContent = p.loginStreak ? '🔥 ' + p.loginStreak + ' დღე' : '';
 var st = p.stats || {};
 $('msWins').textContent = st.partiesWon || 0;
 $('msRate').textContent = (st.partiesPlayed ? Math.round(st.partiesWon / st.partiesPlayed * 100) : 0) + '%';
 $('msStreak').textContent = st.winStreak || 0;
 $('coinsLbl').textContent = p.coins;
 $('shopCoins').textContent = p.coins;
 $('chestPanel').classList.toggle('ready', !!p.chestReady);
 $('chestBtn').disabled = !p.chestReady;
 $('chestText').textContent = p.chestReady ? 'გახსენი და მიიღე 40–500 მონეტა' : 'ხვალ ისევ მოდი';
 renderQuests();
 applyFelt(equipped('felt') || 'classic');
 renderFeltMenu();
 if (!$('shopModal').classList.contains('hidden')) renderShop();
}
socket.on('profileUpdate', function (np) {
 var before = S.profile ? S.profile.coins : null;
 S.profile = np; renderProfile();
 if (before != null && np.coins > before && $('shopModal').classList.contains('hidden')) {
  var el = $('walletBtn').getBoundingClientRect();
  if (el.width) for (var i = 0; i < 8; i++) P({ x: el.left + 20, y: el.top + 16, vx: rnd(-120, 120), vy: rnd(-200, -60), g: 600, life: 0.9, size: 16, text: '🪙', shape: 'text', vr: rnd(-8, 8) });
 }
});
function renderQuests() {
 var q = S.profile.quests || {}, r = q.rewards || {};
 var items = [['მოიგე 3 პარტია', q.wins || 0, 3, '+100 XP · 50 🪙', r.wins], ['ჩამოდი მალიუტკით', q.maliutka || 0, 1, '+250 XP · 125 🪙', r.maliutka], ['ითამაშე 5 მაგიდაზე', q.tables || 0, 5, '+50 XP · 25 🪙', r.tables]];
 $('quests').innerHTML = items.map(function (it) {
  var pct = Math.min(100, it[1] / it[2] * 100);
  return '<div class="quest' + (it[4] ? ' done' : '') + '"><div class="quest-top"><b>' + (it[4] ? '✅ ' : '') + esc(it[0]) + '</b><small>' + it[3] + '</small></div>' +
   '<div class="xpbar"><i style="width:' + pct + '%"></i></div><div class="xp-meta"><span>' + Math.min(it[1], it[2]) + ' / ' + it[2] + '</span></div></div>';
 }).join('');
}
$('chestBtn').onclick = function () { socket.emit('claimChest'); };
socket.on('chestResult', function (d) {
 var r = $('chestBtn').getBoundingClientRect();
 SFX.coins(); SFX.chime();
 radial(r.left + r.width / 2, r.top, 30, ['#fff3b0', '#ffd75e', '#ffffff'], { shape: 'star4', g: 200, s0: 3, s1: 6, max: 300, add: true });
 for (var i = 0; i < 18; i++) P({ x: r.left + r.width / 2, y: r.top, vx: rnd(-260, 260), vy: rnd(-520, -200), g: 1000, life: 1.4, size: rnd(16, 24), text: '🪙', shape: 'text', vr: rnd(-8, 8) });
 toast('🎁 ყუთიდან ამოვიდა ' + d.reward + ' მონეტა!', { gold: true, ms: 3500 });
});

segBind('stakeSeg', function (v) { S.stake = v; });
segBind('capSeg', function (v) { S.capacity = v; });
segBind('partySeg', function (v) { S.parties = v; });
segBind('dCapSeg', function (v) { S.dCapacity = v; });
segBind('dRoundSeg', function (v) { S.dRounds = v; });
function createTable(withBots) {
 socket.emit('joinTable', { tableName: $('tableName').value, capacity: S.capacity, parties: S.parties, stake: S.stake, withBots: !!withBots });
}
$('createBtn').onclick = function () { createTable(false); };
$('botsBtn').onclick = function () { createTable(true); };
$('dominoCreateBtn').onclick = function () { socket.emit('dominoJoinTable', { tableName: $('dominoTableName').value, capacity: S.dCapacity, rounds: S.dRounds }); };
$('dominoBotsBtn').onclick = function () { socket.emit('dominoJoinTable', { tableName: $('dominoTableName').value, capacity: S.dCapacity, rounds: S.dRounds, withBots: true }); };
$('modeBuraTab').onclick = function () { this.classList.add('on'); $('modeDominoTab').classList.remove('on'); show('buraLobbyPanels'); hide('dominoLobbyPanels'); };
$('modeDominoTab').onclick = function () { this.classList.add('on'); $('modeBuraTab').classList.remove('on'); hide('buraLobbyPanels'); show('dominoLobbyPanels'); };

socket.on('liveCount', function (d) { $('liveCount').querySelector('span').textContent = d.online + ' ონლაინ · ' + d.playing + ' თამაშობს'; });
socket.on('lobbyTables', function (list) {
 if (!list.length) { $('tables').innerHTML = '<div class="empty-state">ღია მაგიდა ჯერ არ არის — გახსენი პირველი და მოიწვიე მეგობრები.</div>'; return; }
 $('tables').innerHTML = list.map(function (tb) {
  var seats = '';
  for (var i = 0; i < tb.capacity; i++) seats += tb.seated && tb.seated[i] ? '<span>' + esc(tb.seated[i]) + '</span>' : '<span class="empty"></span>';
  return '<div class="table-row"><div class="mini-felt">' + tb.stake + '</div><div class="info"><b>' + esc(tb.name) + '</b><small>' + tb.players + '/' + tb.capacity + ' მოთამაშე · ' + tb.parties + ' პარტია</small></div>' +
   '<div class="seated">' + seats + '</div><button class="btn-brass joinRoom" data-id="' + esc(tb.id) + '" style="padding:9px 16px">შესვლა</button></div>';
 }).join('');
 document.querySelectorAll('.joinRoom').forEach(function (b) { b.onclick = function () { socket.emit('joinTable', { roomId: b.dataset.id }); }; });
});
socket.on('tournaments', function (list) {
 S.tournaments = list;
 var me = S.profile && S.profile.id;
 $('tournaments').innerHTML = list.map(function (tr) {
  var reg = me && tr.registeredIds && tr.registeredIds.indexOf(me) >= 0;
  return '<div class="tour-row"><div class="trophy">🏆</div><div class="info"><b>' + esc(tr.name) + '</b><small>პრიზი: ' + esc(tr.prize) + ' · ' + tr.registered + '/' + tr.maxPlayers + '</small><small class="countdown" data-time="' + tr.startAt + '"></small></div>' +
   '<button class="btn small regTour" data-id="' + esc(tr.id) + '">' + (reg ? '✓ გაუქმება' : 'რეგისტრაცია') + '</button></div>';
 }).join('');
 document.querySelectorAll('.regTour').forEach(function (b) { b.onclick = function () { socket.emit('registerTournament', { id: b.dataset.id }); }; });
 tickCountdowns();
});
function tickCountdowns() {
 document.querySelectorAll('.countdown').forEach(function (n) {
  var ms = Math.max(0, Number(n.dataset.time) - Date.now());
  n.textContent = 'დაწყებამდე ' + Math.floor(ms / 3600000) + 'სთ ' + Math.floor(ms % 3600000 / 60000) + 'წთ ' + Math.floor(ms % 60000 / 1000) + 'წმ';
 });
}
setInterval(tickCountdowns, 1000);

/* ---------- waiting room ---------- */
socket.on('waitingForPlayers', function (d) {
 S.waitingRoom = d.roomId;
 $('waitTitle').textContent = d.roomName || 'ველოდებით მოთამაშეებს';
 var html = '';
 for (var i = 0; i < d.max; i++) {
  var pl = d.players && d.players[i];
  html += pl ? avatarHtml(pl.avatar, { name: pl.name }) : '<div class="slot">?</div>';
 }
 $('waitSeats').innerHTML = html;
 $('waitText').textContent = d.current + ' / ' + d.max + ' — მაგიდა ავტომატურად დაიწყება, როცა ყველა დაჯდება';
 $('inviteLink').value = location.origin + '/?invite=' + encodeURIComponent(d.roomId);
 socket.emit('getFriends');
 openModal('waitModal');
});
$('copyInvite').onclick = function () {
 var v = $('inviteLink').value;
 if (navigator.clipboard) navigator.clipboard.writeText(v).then(function () { toast('🔗 ბმული დაკოპირდა'); });
 else { $('inviteLink').select(); document.execCommand('copy'); toast('🔗 ბმული დაკოპირდა'); }
};
$('waitLeave').onclick = function () { socket.emit('leaveTable'); hide('waitModal'); };
socket.on('tableInvite', function (d) {
 toast('📨 ' + d.from + ' გეპატიჟება მაგიდაზე', { action: 'შესვლა', ms: 9000, onClick: function () { socket.emit('joinTable', { roomId: d.roomId }); } });
});

/* ============================================================
   MODALS: leaderboard, friends, stats, info
   ============================================================ */
$('leaderboardBtn').onclick = function () { socket.emit('getLeaderboard'); $('leaderboardList').innerHTML = '<p class="muted">იტვირთება…</p>'; openModal('leaderboardModal'); };
socket.on('leaderboardData', function (list) {
 $('leaderboardList').innerHTML = list.map(function (p, i) {
  return '<div class="lb-row"><span class="pos">' + (i + 1) + '</span>' + avatarHtml(p.avatar, { name: p.username, frame: p.frame }) +
   '<div class="who"><b><span class="dot' + (p.online ? ' on' : '') + '"></span> ' + esc(p.username) + '</b><small>დონე ' + p.level + ' ' + titleHtml(p.title) + '</small></div>' +
   '<span class="chip">' + p.rank.icon + ' ' + p.rating + '</span></div>';
 }).join('') || '<div class="empty-state">რეიტინგში ჯერ არავინ არის — იყავი პირველი.</div>';
});
$('friendsBtn').onclick = function () { socket.emit('getFriends'); openModal('friendsModal'); };
$('addFriendBtn').onclick = function () { var v = $('friendUsername').value.trim(); if (v) socket.emit('addFriend', { username: v }); $('friendUsername').value = ''; };
socket.on('friendsList', function (list) {
 S.friends = list;
 $('friendsList').innerHTML = list.length ? list.map(function (f) {
  return '<div class="lb-row">' + avatarHtml(f.avatar, { name: f.username, frame: f.frame }) +
   '<div class="who"><b><span class="dot' + (f.online ? ' on' : '') + '"></span> ' + esc(f.username) + '</b><small>' + f.rank.icon + ' ' + f.rating + ' · დონე ' + f.level + '</small></div>' +
   '<button class="btn small rmFriend" data-id="' + esc(f.id) + '">წაშლა</button></div>';
 }).join('') : '<div class="empty-state">დაამატე მეგობარი სახელით — ნახავ, როდის არის ონლაინ და მოიწვევ მაგიდაზე.</div>';
 document.querySelectorAll('.rmFriend').forEach(function (b) { b.onclick = function () { socket.emit('removeFriend', { id: b.dataset.id }); }; });
 $('waitFriends').innerHTML = list.filter(function (f) { return f.online; }).map(function (f) {
  return '<button class="btn small invF" data-id="' + esc(f.id) + '">📨 ' + esc(f.username) + '</button>';
 }).join('');
 document.querySelectorAll('.invF').forEach(function (b) { b.onclick = function () { socket.emit('inviteFriend', { id: b.dataset.id }); }; });
});
$('statsBtn').onclick = function () { renderStats(); openModal('statsModal'); };
function renderStats() {
 var st = (S.profile && S.profile.stats) || {};
 var rate = st.partiesPlayed ? Math.round(st.partiesWon / st.partiesPlayed * 100) : 0;
 $('statGrid').innerHTML = [['მოგებული პარტია', st.partiesWon || 0], ['ნათამაშები პარტია', st.partiesPlayed || 0], ['მოგების %', rate + '%'], ['საუკეთესო სერია', st.bestWinStreak || 0], ['დიდი მოგება', st.biggestWin || 0], ['მალიუტკა', st.maliutkas || 0], ['ნათამაშები ხელი', st.handsPlayed || 0], ['მოგებული ხელი', st.handsWon || 0], ['რეიტინგი', S.profile ? S.profile.rating : 1000]].map(function (r) {
  return '<div><b>' + r[1] + '</b><small>' + r[0] + '</small></div>';
 }).join('');
 var rec = st.recentParties || [];
 $('sparkRow').innerHTML = rec.length ? rec.map(function (p) {
  return '<i class="' + (p.won ? 'w' : 'l') + '" style="height:' + Math.min(100, 12 + Math.abs(p.delta || 1) / 3) + '%" title="' + (p.won ? 'მოგება' : 'წაგება') + ' (' + p.delta + ')"></i>';
 }).join('') : '<small class="muted" style="margin:auto">ჯერ არცერთი პარტია არ დასრულებულა.</small>';
}
$('infoBtn').onclick = function () { openModal('infoModal'); };
$('logoutBtn').onclick = function () { socket.emit('logout', { token: S.token }); };
document.querySelectorAll('.selfExcludeBtn').forEach(function (b) {
 b.onclick = function () {
  var label = { '24h': '24 საათით', '7d': '7 დღით', '30d': '30 დღით', forever: 'სამუდამოდ' }[b.dataset.duration];
  if (!confirm('ნამდვილად გინდა ანგარიშის დაბლოკვა ' + label + '? ეს მაშინვე გამოგიყვანს სისტემიდან.')) return;
  socket.emit('selfExclude', { duration: b.dataset.duration });
 };
});
socket.on('selfExcluded', function () {
 toast('⏸ ანგარიში დაბლოკილია. დაისვენე — თამაში დაგელოდება.', { ms: 3000 });
 setTimeout(function () { try { localStorage.removeItem('buraToken'); } catch (e) {} location.href = '/'; }, 2600);
});

/* ============================================================
   SHOP
   ============================================================ */
var SHOP_TABS = [['felt', '🟢 მაგიდები'], ['cardback', '🂠 კარტის ზურგი'], ['frame', '⭕ ჩარჩოები'], ['avatar', '🦊 ავატარები'], ['throwable', '🍅 სასროლები'], ['title', '🏷️ ტიტულები'], ['effect', '🎆 მოგების ეფექტი']];
$('shopBtn').onclick = function () { renderShop(); openModal('shopModal'); };
$('walletBtn').onclick = function () { renderShop(); openModal('shopModal'); };
function previewHtml(it) {
 switch (it.type) {
  case 'felt': var f = feltCss(it.key); return '<div class="mini-table" style="background-image:' + esc(f.image) + ';background-size:' + esc(f.size) + '"></div>';
  case 'cardback': return backHtml(it.key);
  case 'frame': return avatarHtml(S.profile ? S.profile.avatar : '🦊', { frame: it.key, name: S.profile && S.profile.username });
  case 'avatar': return avatarHtml(it.emoji, { name: it.key });
  case 'title': return it.text ? '<span class="title-plate">' + esc(it.text) + '</span>' : '<span class="muted">ტიტულის გარეშე</span>';
  default: return '<span class="big">' + esc(it.emoji || '') + '</span>';
 }
}
function renderShop() {
 if (!S.profile) return;
 $('shopDummy').innerHTML = avatarHtml(S.profile.avatar, { id: '__dummy', name: S.profile.username, frame: equipped('frame') });
 $('shopName').textContent = S.profile.username;
 $('shopCoins').textContent = S.profile.coins;
 $('shopTabs').innerHTML = SHOP_TABS.map(function (tb) {
  var all = S.catalog.filter(function (i) { return i.type === tb[0]; });
  var own = all.filter(function (i) { return owns(i.type, i.key); }).length;
  return '<button data-t="' + tb[0] + '" class="' + (S.shopTab === tb[0] ? 'on' : '') + '">' + tb[1] + ' <small>' + own + '/' + all.length + '</small></button>';
 }).join('');
 $('shopTabs').querySelectorAll('button').forEach(function (b) { b.onclick = function () { S.shopTab = b.dataset.t; renderShop(); }; });
 var items = S.catalog.filter(function (i) { return i.type === S.shopTab; }).sort(function (a, b) { return a.price - b.price; });
 var eqSlot = S.shopTab === 'avatar' ? null : equipped(S.shopTab);
 $('shopGrid').innerHTML = items.map(function (it) {
  var own = owns(it.type, it.key);
  var isEq = it.type === 'avatar' ? S.profile.avatar === it.emoji : eqSlot === it.key;
  var btn;
  if (it.type === 'throwable') btn = own ? '<button class="buy eq">✓ ხელმისაწვდომია</button>' : '<button class="buy ' + (S.profile.coins < it.price ? 'cant' : '') + '" data-buy="' + esc(it.id) + '"><span class="coin"></span>' + it.price + '</button>';
  else if (isEq) btn = '<button class="buy eq">✓ აქტიურია</button>';
  else if (own) btn = '<button class="buy own" data-eq="' + esc(it.key) + '">გააქტიურება</button>';
  else btn = '<button class="buy ' + (S.profile.coins < it.price ? 'cant' : '') + '" data-buy="' + esc(it.id) + '"><span class="coin"></span>' + it.price + '</button>';
  var tryBtn = it.type === 'throwable' || it.type === 'effect' ? '<button class="try" data-try="' + esc(it.key) + '" title="სცადე">▶</button>' : '';
  return '<div class="shop-item r-' + it.rarity + '"><span class="rar ' + it.rarity + '">' + { common: 'ჩვეულებრივი', rare: 'იშვიათი', epic: 'ეპიკური', legendary: 'ლეგენდარული' }[it.rarity] + '</span>' +
   '<div class="preview">' + previewHtml(it) + '</div><div class="nm">' + esc(it.name) + '</div><div class="acts">' + btn + tryBtn + '</div></div>';
 }).join('');
 $('shopGrid').querySelectorAll('[data-buy]').forEach(function (b) {
  b.onclick = function () {
   var it = S.catalog.find(function (i) { return i.id === b.dataset.buy; });
   if (it && S.profile.coins < it.price) { toast('მონეტები არ გყოფნის — გახსენი დღიური ყუთი ან მოიგე პარტია.'); return; }
   socket.emit('buyItem', { itemId: b.dataset.buy });
  };
 });
 $('shopGrid').querySelectorAll('[data-eq]').forEach(function (b) { b.onclick = function () { socket.emit('equipCosmetic', { slot: S.shopTab, value: b.dataset.eq }); SFX.select(); }; });
 $('shopGrid').querySelectorAll('[data-try]').forEach(function (b) {
  b.onclick = function () {
   if (S.shopTab === 'effect') { winEffect(b.dataset.try); return; }
   var r = b.getBoundingClientRect(), src = '__src' + Math.random();
   var ghost = document.createElement('div');
   ghost.setAttribute('data-av', src);
   ghost.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;pointer-events:none';
   document.body.appendChild(ghost);
   throwAt(src, '__dummy', b.dataset.try);
   setTimeout(function () { ghost.remove(); }, 100);
  };
 });
}
socket.on('purchaseSuccess', function (d) {
 var it = S.catalog.find(function (i) { return i.id === d.itemId; });
 SFX.coins(); toast('🛍️ შეძენილია: ' + (it ? it.name : ''), { gold: true });
 if (it && it.type !== 'throwable') socket.emit('equipCosmetic', { slot: it.type, value: it.key });
});

/* ============================================================
   FELT
   ============================================================ */
function applyFelt(key) {
 var f = feltCss(key);
 var el = $('tableFelt');
 el.style.backgroundImage = f.image; el.style.backgroundSize = f.size;
 var it = cat('felt', key);
 if (it) { document.documentElement.style.setProperty('--felt-a', it.colors[0]); document.documentElement.style.setProperty('--felt-b', it.colors[1]); }
}
function renderFeltMenu() {
 var felts = S.catalog.filter(function (i) { return i.type === 'felt'; });
 $('feltGrid').innerHTML = felts.map(function (it) {
  var f = feltCss(it.key), own = owns('felt', it.key);
  return '<button title="' + esc(it.name) + '" data-k="' + esc(it.key) + '" class="' + (own ? '' : 'locked ') + (equipped('felt') === it.key ? 'on' : '') + '" style="background-image:' + esc(f.image) + ';background-size:' + esc(f.size) + '"></button>';
 }).join('');
 $('feltGrid').querySelectorAll('button').forEach(function (b) {
  b.onclick = function () {
   if (b.classList.contains('locked')) { hide('feltMenu'); S.shopTab = 'felt'; renderShop(); openModal('shopModal'); return; }
   socket.emit('equipCosmetic', { slot: 'felt', value: b.dataset.k }); applyFelt(b.dataset.k);
  };
 });
}
$('feltBtn').onclick = function () {
 var m = $('feltMenu');
 if (!m.classList.contains('hidden')) { hide('feltMenu'); return; }
 var r = this.getBoundingClientRect();
 m.style.left = Math.max(8, Math.min(window.innerWidth - 260, r.left - 100)) + 'px';
 m.style.top = (r.bottom + 8) + 'px';
 show('feltMenu');
};

/* ============================================================
   BURA GAME
   ============================================================ */
var seatEls = {};
var POS4 = { 1: [4, 48], 2: [50, 5], 3: [96, 48] };
var POS3 = { 1: [16, 12], 2: [84, 12] };

function myIndex() { return S.current ? S.current.players.findIndex(function (p) { return p.id === S.current.viewerId; }) : -1; }
function myHand() { return S.current ? (S.current.playersCards[S.current.viewerId] || []) : []; }
function isMyTurn() { var c = S.current; return !!c && myIndex() === c.currentTurnIndex && !c.processing && !c.gameOver; }

socket.on('gameStateUpdate', function (state) {
 var first = !S.current || S.current.roomId !== state.roomId;
 S.skew = state.serverNow - Date.now();
 S.current = state;
 hide('waitModal');
 if (first) { seatEls = {}; $('seats').innerHTML = ''; S.prevGroups = []; S.handIds = []; screen('game'); }
 else if ($('game').classList.contains('hidden')) screen('game');
 renderGame();
});

function renderGame() {
 var c = S.current;
 $('hudParty').textContent = c.partyIndex + '/' + c.parties;
 $('hudHand').textContent = c.handIndex + '/' + c.totalHands;
 $('hudTrump').innerHTML = '<span class="' + (c.trump === 'hearts' || c.trump === 'diamonds' ? 'suit-red' : '') + '">' + SYM[c.trump] + '</span>';
 $('hudDeck').textContent = c.deckCount;
 $('hudStake').textContent = c.stake;
 $('trumpSymbol').textContent = SYM[c.trump];
 $('trumpMark').classList.toggle('red', c.trump === 'hearts' || c.trump === 'diamonds');
 $('trumpMark').querySelector('small').textContent = c.trump === 'no_trump' ? 'უკოზირო' : 'კოზირი';
 renderDeck(); renderSeats(); renderCenter(); renderHand(); renderScore(); updateAction();
 if (c.handIndex !== S.lastHandIndex) { S.lastHandIndex = c.handIndex; S.selected = []; }
}

function renderDeck() {
 var c = S.current, n = c.deckCount, key = equipped('cardback') || 'blue';
 var layers = Math.min(6, Math.ceil(n / 4)), html = '';
 for (var i = 0; i < layers; i++) html += backHtml(key).replace('class="card', 'style="transform:translate(' + (-i * 1.2) + 'px,' + (-i * 1.5) + 'px)" class="card');
 $('deck').innerHTML = html + (n ? '<div class="count">' + n + '</div>' : '');
 $('deck').classList.toggle('empty', !n);
}

function renderSeats() {
 var c = S.current, me = myIndex(), total = c.players.length, alive = {};
 c.players.forEach(function (p, i) {
  alive[p.id] = true;
  var rel = (i - me + total) % total;
  if (rel === 0) { renderMeSeat(p); return; }
  var el = seatEls[p.id];
  if (!el) {
   el = document.createElement('div');
   el.className = 'seat opp';
   el.innerHTML = '<div class="avhold"></div><div class="plate"><div class="nm"></div><div class="tt"></div><div class="sc"></div></div><div class="mini-hand"></div>';
   $('seats').appendChild(el); seatEls[p.id] = el;
   el.querySelector('.avhold').onclick = function (e) { openThrowMenu(p.id, p.name, e); };
  }
  var narrow = window.innerWidth < 760;
  var pos = (total === 3 ? (narrow ? { 1: [15, 13], 2: [85, 13] } : POS3) : (narrow ? { 1: [11, 46], 2: [50, 5], 3: [89, 46] } : POS4))[rel];
  el.style.left = pos[0] + '%'; el.style.top = pos[1] + '%';
  el.classList.toggle('active', p.isCurrent && !c.gameOver);
  var sig = [p.avatar, p.frame, p.level, p.connected].join('|');
  if (el.dataset.sig !== sig) {
   el.dataset.sig = sig;
   el.querySelector('.avhold').innerHTML = avatarHtml(p.avatar, { id: p.id, name: p.name, frame: p.frame, level: p.level, timer: true, cls: p.connected ? '' : 'off' });
  }
  el.querySelector('.av').classList.toggle('turn', p.isCurrent && !c.gameOver);
  el.querySelector('.nm').textContent = p.name;
  el.querySelector('.tt').innerHTML = p.title && p.title !== 'none' ? esc((cat('title', p.title) || {}).text || '') : (p.connected ? '' : '⚠ კავშირი გაწყდა');
  el.querySelector('.sc').innerHTML = '<span>' + p.cardCount + ' 🂠</span><b class="' + (p.totalPoints < 0 ? 'neg' : '') + '">' + p.totalPoints + '</b><span title="ამ ხელში აღებული">+' + p.capturedPoints + '</span>';
  var mh = '';
  var cards = c.playersCards[p.id];
  for (var k = 0; k < p.cardCount; k++) mh += cards && cards[k] ? cardHtml(cards[k]) : backHtml(p.cardback);
  var mhEl = el.querySelector('.mini-hand');
  if (mhEl.dataset.n !== String(p.cardCount) + (cards ? 'v' : '')) { mhEl.innerHTML = mh; mhEl.dataset.n = String(p.cardCount) + (cards ? 'v' : ''); }
 });
 Object.keys(seatEls).forEach(function (id) { if (!alive[id]) { seatEls[id].remove(); delete seatEls[id]; } });
}
function renderMeSeat(p) {
 var el = $('meSeat');
 var sig = [p.avatar, p.frame, p.level].join('|');
 if (el.dataset.sig !== sig) {
  el.dataset.sig = sig;
  el.innerHTML = avatarHtml(p.avatar, { id: p.id, name: p.name, frame: p.frame, level: p.level, timer: true }) + '<div class="plate" style="display:flex;flex-direction:column"><b class="nm"></b><small class="muted sc"></small></div>';
 }
 el.querySelector('.av').classList.toggle('turn', p.isCurrent && !S.current.gameOver);
 el.querySelector('.nm').textContent = p.name;
 el.querySelector('.sc').textContent = 'ჯამი ' + p.totalPoints + ' · ხელში +' + p.capturedPoints;
}

function seatPoint(pid) {
 var a = anchorFor(pid);
 if (a) return a;
 var h = $('hand').getBoundingClientRect();
 return { x: h.left + h.width / 2, y: h.top + h.height / 2, r: 30 };
}
function renderCenter() {
 var c = S.current, box = $('centerCards');
 if (S.collecting && c.table.length) return;
 S.collecting = false;
 var keys = c.table.map(function (pl) { return pl.playerId + ':' + pl.cards.map(function (x) { return x.id; }).join(','); });
 box.innerHTML = c.table.map(function (pl) {
  return '<div class="play-group' + (pl.isWinning ? ' win' : '') + '" data-pid="' + esc(pl.playerId) + '"><div class="cards">' + pl.cards.map(function (cd) { return cardHtml(cd); }).join('') + '</div><div class="who">' + (pl.cuts ? '✂ ' : '') + esc(pl.playerName) + '</div></div>';
 }).join('');
 var groups = box.querySelectorAll('.play-group');
 keys.forEach(function (k, i) {
  if (S.prevGroups.indexOf(k) >= 0) return;
  var g = groups[i], from = seatPoint(c.table[i].playerId), r = g.getBoundingClientRect();
  var dx = from.x - (r.left + r.width / 2), dy = from.y - (r.top + r.height / 2);
  try {
   g.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.45) rotate(' + rnd(-25, 25) + 'deg)', opacity: 0.4 }, { transform: 'translate(0,-8px) scale(1.06) rotate(0)', opacity: 1, offset: 0.8 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' });
  } catch (e) {}
  if (c.table[i].cuts) g.classList.add('cut');
 });
 S.prevGroups = keys;
}
function collectTrick(winnerId) {
 var to = seatPoint(winnerId);
 S.collecting = true;
 SFX.collect();
 $('centerCards').querySelectorAll('.play-group').forEach(function (g, i) {
  var r = g.getBoundingClientRect();
  var dx = to.x - (r.left + r.width / 2), dy = to.y - (r.top + r.height / 2);
  try { g.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.25) rotate(' + (i * 12 - 10) + 'deg)', opacity: 0 }], { duration: 520, delay: i * 40, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }); } catch (e) {}
 });
}

var SUIT_ORDER = ['spades', 'clubs', 'diamonds', 'hearts'];
var RANK_ORDER = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
function displayOrder(hand) {
 var idx = hand.map(function (_, i) { return i; });
 if (!S.sortHand) return idx;
 var tr = S.current.trump;
 return idx.sort(function (a, b) {
  var A = hand[a], B = hand[b];
  var sa = SUIT_ORDER.indexOf(A.suit) + (A.suit === tr ? 10 : 0), sb = SUIT_ORDER.indexOf(B.suit) + (B.suit === tr ? 10 : 0);
  return sa !== sb ? sa - sb : RANK_ORDER.indexOf(A.rank) - RANK_ORDER.indexOf(B.rank);
 });
}
function renderHand() {
 var hand = myHand(), ids = hand.map(function (c) { return c.id; });
 var changed = ids.join() !== S.handIds.join();
 var fresh = ids.filter(function (id) { return S.handIds.indexOf(id) < 0; });
 if (changed) S.selected = S.selected.filter(function (i) { return hand[i] && S.handIds[i] === hand[i].id; });
 S.handIds = ids;
 var order = displayOrder(hand), mid = (order.length - 1) / 2, tr = S.current.trump;
 var el = $('hand');
 el.classList.toggle('myturn', isMyTurn());
 el.classList.toggle('dim', !isMyTurn() && !S.current.gameOver);
 el.innerHTML = order.map(function (hi, pos) {
  var cd = hand[hi], rot = (pos - mid) * 4.5, ty = Math.abs(pos - mid) * Math.abs(pos - mid) * 1.6;
  var fan = 'rotate(' + rot + 'deg) translateY(' + ty + 'px)';
  return cardHtml(cd, (S.selected.indexOf(hi) >= 0 ? 'sel ' : '') + (cd.suit === tr ? 'trumpc' : '')).replace('class="card', 'data-hi="' + hi + '" style="--fan:' + fan + ';transform:' + fan + '" class="card');
 }).join('');
 el.querySelectorAll('.card').forEach(function (n) { n.onclick = function () { toggleCard(Number(n.dataset.hi)); }; });
 if (fresh.length && fresh.length <= 5) {
  var d = $('deck').getBoundingClientRect(), k = 0;
  el.querySelectorAll('.card').forEach(function (n) {
   if (fresh.indexOf(n.dataset.id) < 0) return;
   var r = n.getBoundingClientRect(), dl = k++ * 110;
   var dx = (d.left + d.width / 2) - (r.left + r.width / 2), dy = (d.top + d.height / 2) - (r.top + r.height / 2);
   try { n.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(-30deg) scale(.6)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: n.style.getPropertyValue('--fan') }], { duration: 520, delay: dl, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }); } catch (e) {}
   SFX.deal(dl / 1000);
  });
 }
}
function toggleCard(i) {
 if (!isMyTurn()) { toast('დაელოდე შენს სვლას'); return; }
 var p = S.selected.indexOf(i);
 if (p >= 0) S.selected.splice(p, 1);
 else if (S.current.leadWasMaliutka) S.selected = myHand().map(function (_, k) { return k; });
 else if (S.current.table.length && S.current.leadCount === 1) S.selected = [i];
 else if (S.selected.length < 5) S.selected.push(i);
 SFX.select(); renderHand(); updateAction();
}
function selectionValid() {
 var c = S.current, hand = myHand();
 var cards = S.selected.map(function (i) { return hand[i]; }).filter(Boolean);
 if (!cards.length || cards.length !== S.selected.length) return false;
 var same = cards.every(function (x) { return x.suit === cards[0].suit; });
 if (!c.table.length) {
  if (!same) return false;
  if (cards.length === 5) return true;
  var others = c.players.filter(function (p) { return p.id !== c.viewerId; }).map(function (p) { return p.cardCount; });
  return cards.length <= (others.length ? Math.min.apply(null, others) : 5);
 }
 if (c.leadWasMaliutka) return cards.length === hand.length;
 return cards.length === c.leadCount;
}
function updateAction() {
 var c = S.current, mine = isMyTurn(), valid = mine && selectionValid(), btn = $('playBtn'), n = S.selected.length;
 btn.disabled = !valid;
 var hand = myHand(), sel = S.selected.map(function (i) { return hand[i]; }).filter(Boolean);
 if (!c.table.length && sel.length === 5 && sel.every(function (x) { return x.suit === sel[0].suit; })) btn.textContent = '🔥 მალიუტკა!';
 else btn.textContent = n ? 'ჩამოსვლა (' + n + ')' : 'სვლა';
 var st = $('status');
 st.classList.toggle('mine', mine);
 if (c.gameOver) st.textContent = 'თამაში დასრულდა';
 else if (c.processing) st.textContent = 'წაღება…';
 else if (mine) {
  if (!c.table.length) st.textContent = 'შენი სვლაა — ჩამოდი 1–4 ერთი მასტის კარტით';
  else if (c.leadWasMaliutka) st.textContent = 'მალიუტკა! ჩამოდი მთელი ხელით';
  else st.textContent = 'უპასუხე ' + c.leadCount + ' კარტით (ნებისმიერი მასტით)';
 } else {
  var a = c.players[c.currentTurnIndex];
  st.textContent = (a ? a.name : '') + ' ფიქრობს…';
 }
}
$('playBtn').onclick = function () {
 if (!selectionValid()) return;
 socket.emit('playCards', { cardIndices: S.selected.slice() });
 S.selected = [];
};
$('sortBtn').onclick = function () { S.sortHand = !S.sortHand; toast(S.sortHand ? 'კარტები დალაგებულია მასტის მიხედვით' : 'კარტები მიღების რიგით'); if (S.current) renderHand(); };
document.addEventListener('keydown', function (e) {
 if ($('game').classList.contains('hidden') || e.target.tagName === 'INPUT') return;
 if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('playBtn').click(); }
 var n = Number(e.key);
 if (n >= 1 && n <= 5 && S.current) { var order = displayOrder(myHand()); if (order[n - 1] != null) toggleCard(order[n - 1]); }
});

function renderScore() {
 var c = S.current, best = Math.max.apply(null, c.players.map(function (p) { return p.totalPoints; }));
 var hasLead = c.history.length > 0 && c.players.filter(function (p) { return p.totalPoints === best; }).length < c.players.length;
 $('scorePlayers').innerHTML = c.players.slice().sort(function (a, b) { return b.totalPoints - a.totalPoints; }).map(function (p) {
  var lead = hasLead && p.totalPoints === best;
  return '<div class="score-row' + (lead ? ' lead' : '') + '">' + avatarHtml(p.avatar, { name: p.name, size: 26 }) +
   '<span class="n">' + (lead ? '👑 ' : '') + esc(p.name) + '</span><span class="cap">+' + p.capturedPoints + '</span><span class="t' + (p.totalPoints < 0 ? ' neg' : '') + '">' + p.totalPoints + '</span></div>';
 }).join('');
 if (c.history.length) $('history').innerHTML = c.history.slice().reverse().map(function (h) {
  return '<div class="hist"><b>ხელი ' + h.hand + '</b> · პარტია ' + h.party + ' · ' + SYM[h.trump] + '<br>' + c.players.map(function (p) {
   var raw = h.rawScores[p.id] || 0;
   return '<span class="' + (raw === 0 ? 'z' : '') + '">' + esc(p.name) + ': ' + (raw === 0 ? '−120' : raw) + '</span>';
  }).join(' · ') + '</div>';
 }).join('');
 $('fairNow').textContent = c.fairnessHash ? '🔒 მიმდინარე ხელის hash: ' + c.fairnessHash.slice(0, 24) + '…' : '';
}
$('sideToggle').onclick = function () { $('side').classList.toggle('open'); };

/* ---------- phrases, bubbles ---------- */
function renderPhrases() {
 $('phrases').innerHTML = (S.serverInfo.phrases || []).map(function (p) { return '<button data-ph="' + esc(p) + '">' + esc(p) + '</button>'; }).join('');
 $('phrases').querySelectorAll('button').forEach(function (b) { b.onclick = function () { socket.emit('quickMessage', { text: b.dataset.ph }); }; });
}
function bubble(pid, text) {
 var host = seatEls[pid] || (S.current && pid === S.current.viewerId ? $('meSeat') : null);
 if (!host) { toast(text); return; }
 var old = host.querySelector('.bubble'); if (old) old.remove();
 var b = document.createElement('div'); b.className = 'bubble'; b.textContent = text;
 if (host.id === 'meSeat') { b.style.position = 'absolute'; b.style.bottom = '100%'; b.style.left = '32px'; }
 host.appendChild(b);
 setTimeout(function () { b.remove(); }, 3200);
}
socket.on('quickMessage', function (d) {
 if (!$('dominoGame').classList.contains('hidden')) { toast('💬 ' + d.text); speak(d.text); return; }
 bubble(d.playerId, d.text); speak(d.text);
});

/* ---------- throw menu ---------- */
function openThrowMenu(pid, name, e) {
 if (!S.profile) { toast('სასროლებისთვის საჭიროა ანგარიში'); return; }
 S.giftTarget = pid;
 $('throwTitle').textContent = 'გაუგზავნე — ' + name;
 var list = S.catalog.filter(function (i) { return i.type === 'throwable'; }).sort(function (a, b) { return a.price - b.price; });
 $('throwGrid').innerHTML = list.map(function (it) {
  return '<button title="' + esc(it.name) + (owns('throwable', it.key) ? '' : ' — მაღაზიაში') + '" data-k="' + esc(it.key) + '" class="' + (owns('throwable', it.key) ? '' : 'locked') + '">' + esc(it.emoji) + '</button>';
 }).join('');
 $('throwGrid').querySelectorAll('button').forEach(function (b) {
  b.onclick = function () {
   hide('throwMenu');
   if (b.classList.contains('locked')) { S.shopTab = 'throwable'; renderShop(); openModal('shopModal'); return; }
   socket.emit('throwable', { targetPlayerId: S.giftTarget, type: b.dataset.k });
  };
 });
 var m = $('throwMenu'); show('throwMenu');
 var w = m.offsetWidth, h = m.offsetHeight;
 m.style.left = clamp(e.clientX - w / 2, 8, window.innerWidth - w - 8) + 'px';
 m.style.top = clamp(e.clientY + 20, 8, window.innerHeight - h - 8) + 'px';
}
socket.on('throwableEvent', function (d) { throwAt(d.fromPlayerId, d.targetPlayerId, d.type); });
window.addEventListener('resize', function () { if (S.current && !$('game').classList.contains('hidden')) renderSeats(); });

/* ---------- game events ---------- */
socket.on('dealAnimation', function () { SFX.deal(); SFX.deal(0.1); SFX.deal(0.2); });
socket.on('playFX', function (d) {
 if (d.cuts) { SFX.cut(); var t = $('tableFelt'); t.style.filter = 'brightness(1.25)'; setTimeout(function () { t.style.filter = ''; }, 140); }
 else SFX.place();
});
socket.on('trickWon', function (d) {
 setTimeout(function () { collectTrick(d.winnerId); }, 1050);
 if (S.current && d.winnerId === S.current.viewerId && d.points >= 10) setTimeout(function () { toast('+' + d.points + ' ქულა'); }, 1100);
});
socket.on('maliutka', function (d) {
 var b = document.createElement('div'); b.className = 'maliutka-banner'; b.textContent = 'მალიუტკა!';
 $('tableFelt').appendChild(b); setTimeout(function () { b.remove(); }, 1900);
 SFX.fanfare(); shake(8);
 var r = $('tableFelt').getBoundingClientRect();
 radial(r.left + r.width / 2, r.top + r.height / 2, 60, ['#fff3b0', '#ff8a3d', '#ffd75e'], { min: 150, max: 500, add: true });
});
socket.on('botThinking', function (d) {
 var el = seatEls[d.playerId];
 if (!el || el.querySelector('.thinking')) return;
 var t = document.createElement('div'); t.className = 'thinking'; t.textContent = '•••';
 el.querySelector('.avhold').style.position = 'relative';
 el.querySelector('.avhold').appendChild(t);
 setTimeout(function () { t.remove(); }, 1800);
});
socket.on('achievement', function (d) { toast('🏆 მიღწევა: ' + d.title, { gold: true }); });
socket.on('handSummary', function (d) {
 var me = S.current && d.players.find(function (p) { return p.id === S.current.viewerId; });
 if (me) toast(me.raw === 0 ? '💀 გახიშტვა — −120' : 'ხელი ' + d.hand + ': +' + me.raw + ' ქულა', { gold: me.raw > 0, ms: 3000 });
});
socket.on('partyWinner', function (d) { toast('🏆 პარტია ' + d.party + ' მოიგო: ' + d.winners.map(function (w) { return w.name; }).join(', '), { gold: true, ms: 3500 }); });
socket.on('fairnessReveal', function (d) {
 S.fairness.unshift(d); S.fairness = S.fairness.slice(0, 12);
 $('fairnessLog').innerHTML = S.fairness.map(function (f) {
  return '<div style="margin:6px 0"><b>' + esc(f.hand) + '</b> — seed input: ' + esc(f.seedInput || f.seed) + '<br>SHA-256: ' + esc(f.hash) + '</div>';
 }).join('') + '<small>შემოწმება: SHA-256(seed input) უნდა ემთხვეოდეს ხელის დაწყებისას ნაჩვენებ hash-ს.</small>';
});
function showGameOver(d, isDomino) {
 var st = d.standings || [];
 var order = [st[1], st[0], st[2]];
 $('podium').innerHTML = order.map(function (p, i) {
  if (!p) return '';
  var cls = ['p2', 'p1', 'p3'][i], h = [120, 160, 90][i], place = [2, 1, 3][i];
  return '<div class="step ' + cls + '">' + (place === 1 ? '<div style="font-size:30px">👑</div>' : '') + avatarHtml(p.avatar, { name: p.name }) + '<div class="nm">' + esc(p.name) + '</div><div class="pts">' + p.total + '</div><div class="block" style="height:' + h + 'px">' + place + '</div></div>';
 }).join('');
 $('overRest').innerHTML = st.slice(3).map(function (p, i) { return (i + 4) + '. ' + esc(p.name) + ' — ' + p.total; }).join('<br>');
 var meId = isDomino ? (S.domino && S.domino.viewerId) : (S.current && S.current.viewerId);
 var won = d.winnerId === meId || d.playerId === meId;
 $('overTitle').textContent = won ? 'შენ მოიგე! 🎉' : 'თამაში დასრულდა';
 $('overBack').dataset.domino = isDomino ? '1' : '';
 setTimeout(function () { openModal('overModal'); }, 900);
 if (won) winEffect(d.effect || 'confetti'); else { SFX.lose(); WIN.confetti(); }
}
socket.on('gameWinner', function (d) { showGameOver(d, false); });
$('overBack').onclick = function () {
 hide('overModal');
 socket.emit(this.dataset.domino ? 'dominoLeaveTable' : 'leaveTable');
};
$('leaveBtn').onclick = function () {
 if (S.current && !S.current.gameOver && !confirm('ნამდვილად გინდა გასვლა? მიმდინარე თამაშში შენს ადგილს ბოტი დაიკავებს.')) return;
 socket.emit('leaveTable');
};
socket.on('leftTable', function () {
 S.current = null; S.selected = []; seatEls = {}; $('seats').innerHTML = ''; $('meSeat').innerHTML = ''; $('meSeat').dataset.sig = '';
 hide('waitModal'); hide('overModal');
 screen('lobby'); renderProfile();
});

/* ---------- timers ---------- */
setInterval(function () {
 var c = S.current;
 var clock = $('turnClock');
 if (!c || c.gameOver || c.processing || $('game').classList.contains('hidden')) { clock.classList.add('hidden'); return; }
 var left = Math.max(0, c.turnEndsAt - (Date.now() + S.skew));
 var frac = left / (c.turnSeconds * 1000), secs = Math.ceil(left / 1000);
 var active = c.players[c.currentTurnIndex];
 if (active) {
  var av = avEl(active.id), circ = av && av.querySelector('.av-timer circle');
  if (circ) {
   circ.setAttribute('stroke-dashoffset', String(100 * (1 - frac)));
   circ.style.stroke = frac > 0.5 ? '#43c98a' : frac > 0.25 ? '#f3c14b' : '#ff5a64';
  }
 }
 var mine = isMyTurn();
 clock.classList.toggle('hidden', !mine);
 clock.textContent = secs;
 clock.classList.toggle('low', secs <= 5);
 if (mine && secs <= 5 && secs !== S.lastTick && secs > 0) { S.lastTick = secs; SFX.tick(); }
}, 100);

/* ---------- sound controls ---------- */
function syncMute() { $('muteBtn').textContent = S.muted ? '🔇' : '🔊'; if (master) master.gain.value = S.muted ? 0 : S.volume; }
$('muteBtn').onclick = function () { S.muted = !S.muted; syncMute(); try { localStorage.setItem('buraMuted', S.muted ? '1' : '0'); } catch (e) {} };
$('volumeSlider').oninput = function () { S.volume = Number(this.value) / 100; S.muted = S.volume <= 0; syncMute(); try { localStorage.setItem('buraVolume', this.value); } catch (e) {} };
$('rulesBtn').onclick = function () { openModal('rulesModal'); };

/* ============================================================
   DOMINO
   ============================================================ */
var DOTS = { 0: [], 1: [[50, 50]], 2: [[27, 27], [73, 73]], 3: [[27, 27], [50, 50], [73, 73]], 4: [[27, 27], [73, 27], [27, 73], [73, 73]], 5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]], 6: [[27, 22], [73, 22], [27, 50], [73, 50], [27, 78], [73, 78]] };
function halfHtml(v) { return '<div class="half">' + (DOTS[v] || []).map(function (p) { return '<i class="pd" style="left:' + p[0] + '%;top:' + p[1] + '%"></i>'; }).join('') + '</div>'; }
function tileHtml(a, b, vertical, cls, id) { return '<div class="tile ' + (vertical ? 'v' : 'h') + ' ' + (cls || '') + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + halfHtml(a) + halfHtml(b) + '</div>'; }
socket.on('dominoStateUpdate', function (st) {
 S.domino = st; S.dSel = null; S.skew = st.serverNow - Date.now();
 hide('waitModal');
 if ($('dominoGame').classList.contains('hidden')) screen('dominoGame');
 renderDomino();
});
function renderDomino() {
 var d = S.domino; if (!d) return;
 $('dHudRound').textContent = d.roundIndex; $('dHudTotalRounds').textContent = d.totalRounds; $('dHudBoneyard').textContent = d.boneyardCount;
 $('dominoSeats').innerHTML = d.players.map(function (p) {
  return '<div class="d-seat' + (p.isCurrent && !d.gameOver ? ' active' : '') + '">' + avatarHtml(p.avatar, { id: p.id, name: p.name, frame: p.frame, cls: p.connected ? '' : 'off' }) + '<div><b>' + esc(p.name) + '</b><br><small>' + p.tileCount + ' ქვა · ' + p.matchScore + ' ქულა</small></div></div>';
 }).join('');
 var me = d.players.findIndex(function (p) { return p.id === d.viewerId; });
 var mine = me === d.currentTurnIndex && !d.processing && !d.gameOver;
 var sel = S.dSel;
 var lm = sel && (sel.a === d.leftEnd || sel.b === d.leftEnd), rm = sel && (sel.a === d.rightEnd || sel.b === d.rightEnd);
 if (d.chain.length) {
  $('dominoChain').innerHTML = '<div class="d-end' + (lm ? ' hl' : '') + '" id="dLeft">' + d.leftEnd + '</div>' + d.chain.map(function (t) { return t.left === t.right ? tileHtml(t.left, t.right, true) : tileHtml(t.left, t.right, false); }).join('') + '<div class="d-end' + (rm ? ' hl' : '') + '" id="dRight">' + d.rightEnd + '</div>';
  $('dLeft').onclick = function () { if (S.dSel && lm) { socket.emit('dominoPlayTile', { tileId: S.dSel.id, side: 'left' }); S.dSel = null; } };
  $('dRight').onclick = function () { if (S.dSel && rm) { socket.emit('dominoPlayTile', { tileId: S.dSel.id, side: 'right' }); S.dSel = null; } };
 } else $('dominoChain').innerHTML = '<div class="empty-state">დაფა ცარიელია — პირველი ქვა დადებს თამაშის დასაწყისს.</div>';
 var hand = (d.hands && d.hands[d.viewerId]) || [];
 $('dominoHand').innerHTML = hand.map(function (t) {
  var fits = !d.chain.length || t.a === d.leftEnd || t.b === d.leftEnd || t.a === d.rightEnd || t.b === d.rightEnd;
  return tileHtml(t.a, t.b, true, (sel && sel.id === t.id ? 'sel ' : '') + (mine && !fits ? 'dim' : ''), t.id);
 }).join('');
 $('dominoHand').querySelectorAll('.tile').forEach(function (n) {
  n.onclick = function () {
   if (!mine) return;
   var t = hand.find(function (x) { return x.id === n.dataset.id; }); if (!t) return;
   if (!d.chain.length) { socket.emit('dominoPlayTile', { tileId: t.id, side: 'right' }); return; }
   var L = t.a === d.leftEnd || t.b === d.leftEnd, R = t.a === d.rightEnd || t.b === d.rightEnd;
   if (L && R && d.leftEnd !== d.rightEnd) { S.dSel = S.dSel && S.dSel.id === t.id ? null : t; renderDomino(); toast('აირჩიე მხარე — მარცხენა ან მარჯვენა ბოლო'); }
   else if (L) socket.emit('dominoPlayTile', { tileId: t.id, side: 'left' });
   else if (R) socket.emit('dominoPlayTile', { tileId: t.id, side: 'right' });
   else toast('ეს ქვა დაფას არ ერგება');
  };
 });
 var stEl = $('dominoStatus'); stEl.classList.toggle('mine', mine);
 stEl.textContent = d.gameOver ? 'მატჩი დასრულდა' : mine ? 'შენი სვლაა — აირჩიე ქვა' : ((d.players[d.currentTurnIndex] || {}).name || '') + ' ფიქრობს…';
 $('dominoScorePanel').innerHTML = d.players.slice().sort(function (a, b) { return b.matchScore - a.matchScore; }).map(function (p) { return '<div><b>' + p.matchScore + '</b><small>' + esc(p.name) + '</small></div>'; }).join('');
 var sc = $('dChainScroll'); sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
}
$('dominoLeaveBtn').onclick = function () {
 if (S.domino && !S.domino.gameOver && !confirm('ნამდვილად გინდა გასვლა? შენს ადგილს ბოტი დაიკავებს.')) return;
 socket.emit('dominoLeaveTable');
};
socket.on('dominoLeftTable', function () { S.domino = null; hide('overModal'); hide('waitModal'); screen('lobby'); renderProfile(); });
socket.on('dominoLobbyTables', function (list) {
 $('dominoTables').innerHTML = list.length ? list.map(function (tb) {
  return '<div class="table-row"><div class="mini-felt">🁫</div><div class="info"><b>' + esc(tb.name) + '</b><small>' + tb.players + '/' + tb.capacity + ' მოთამაშე · ' + tb.rounds + ' რაუნდი</small></div><button class="btn-brass joinD" data-id="' + esc(tb.id) + '" style="padding:9px 16px">შესვლა</button></div>';
 }).join('') : '<div class="empty-state">ღია დომინოს მაგიდა ჯერ არ არის.</div>';
 document.querySelectorAll('.joinD').forEach(function (b) { b.onclick = function () { socket.emit('dominoJoinTable', { roomId: b.dataset.id }); }; });
});
socket.on('dominoWaiting', function (d) {
 $('waitTitle').textContent = 'დომინო — ველოდებით მოთამაშეებს';
 var html = ''; for (var i = 0; i < d.max; i++) html += i < d.current ? '<div class="slot" style="animation:none">✓</div>' : '<div class="slot">?</div>';
 $('waitSeats').innerHTML = html;
 $('waitText').textContent = d.current + ' / ' + d.max;
 $('inviteLink').value = location.origin + '/?invite=' + encodeURIComponent(d.roomId);
 $('waitLeave').onclick = function () { socket.emit('dominoLeaveTable'); hide('waitModal'); $('waitLeave').onclick = function () { socket.emit('leaveTable'); hide('waitModal'); }; };
 openModal('waitModal');
});
socket.on('dominoError', function (m) { toast('⚠️ ' + m); });
socket.on('dominoDealAnimation', function () { SFX.deal(); SFX.deal(0.1); });
socket.on('dominoPlayFX', function () { noise(0.06, 'bandpass', 1200, 0.25); tone(180, 0.08, 'triangle', 0.08); });
socket.on('dominoRoundEnd', function (d) { toast('🁫 ' + d.winnerName + ' — ' + (d.reason === 'out' ? 'ქვები ამოიწურა' : 'დაბლოკილი რაუნდი') + ' (+' + d.awarded + ')', { gold: true }); SFX.cut(); });
socket.on('dominoFairnessReveal', function (d) { S.fairness.unshift({ hand: 'დომინო რაუნდი ' + d.round, seed: d.seed, seedInput: d.seedInput, hash: d.hash }); });
socket.on('dominoMatchEnd', function (d) { showGameOver(d, true); });

/* ============================================================
   LANGUAGE
   ============================================================ */
var I18N = {
 ka: { login: 'შესვლა', register: 'რეგისტრაცია', shop: 'მაღაზია', leaderboard: 'რეიტინგი', friends: 'მეგობრები', stats: 'სტატისტიკა', info: 'ინფო', bura: 'ბურა', domino: 'დომინო', newTable: 'ახალი მაგიდა', create: 'მაგიდის გახსნა', vsBots: 'ბოტებთან', activeTables: 'ღია მაგიდები', quests: 'დღიური დავალებები', tournaments: 'ტურნირები' },
 en: { login: 'Log in', register: 'Sign up', shop: 'Shop', leaderboard: 'Leaderboard', friends: 'Friends', stats: 'Stats', info: 'Info', bura: 'Bura', domino: 'Domino', newTable: 'New table', create: 'Open table', vsBots: 'Vs bots', activeTables: 'Open tables', quests: 'Daily quests', tournaments: 'Tournaments' },
 ru: { login: 'Вход', register: 'Регистрация', shop: 'Магазин', leaderboard: 'Рейтинг', friends: 'Друзья', stats: 'Статистика', info: 'Инфо', bura: 'Бура', domino: 'Домино', newTable: 'Новый стол', create: 'Открыть стол', vsBots: 'С ботами', activeTables: 'Открытые столы', quests: 'Задания дня', tournaments: 'Турниры' }
};
function t(k) { return (I18N[S.lang] || I18N.ka)[k] || I18N.ka[k] || k; }
function applyLanguage(lang) {
 S.lang = I18N[lang] ? lang : 'ka';
 document.documentElement.lang = S.lang;
 document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.dataset.i18n); });
 try { localStorage.setItem('buraLang', S.lang); } catch (e) {}
}
$('langSelect').onchange = function () { applyLanguage(this.value); };

/* ============================================================
   BOOT
   ============================================================ */
fxInit();
renderHeroFan();
renderAvatarPick();
try {
 var sv = localStorage.getItem('buraVolume');
 if (sv !== null) { $('volumeSlider').value = sv; S.volume = Number(sv) / 100; }
 S.muted = localStorage.getItem('buraMuted') === '1' || S.volume <= 0;
 syncMute();
 var sl = localStorage.getItem('buraLang');
 if (sl) { $('langSelect').value = sl; applyLanguage(sl); }
} catch (e) {}
(function () {
 var inv = new URLSearchParams(location.search).get('invite');
 if (inv) { S.pendingInvite = inv; history.replaceState(null, '', '/'); }
})();
socket.on('connect', function () {
 var tok = null;
 try { tok = localStorage.getItem('buraToken'); } catch (e) {}
 if (tok) { S.token = tok; socket.emit('restoreSession', { token: tok }); }
});
})();
</script>
</body>
</html>`;

/* ============================================================
   EXPRESS ROUTES — EXPRESS 5 SAFE (no wildcard paths)
   ============================================================ */

app.get('/', function (req, res) {
  res.status(200).type('html').send(PAGE);
});

app.get('/health', function (req, res) {
  res.status(200).json({
    ok: true,
    service: 'Written Bura',
    version: 'v2-monolithic-express5',
    rooms: rooms.size,
    dominoRooms: dominoRooms.size,
    users: users.size,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.use(function (req, res) {
  res.status(404).type('html').send(
    '<!doctype html><html lang="ka"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>404 — Written Bura</title></head>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07130e;color:#f6f0e1;font-family:Georgia,serif;text-align:center">' +
    '<div><div style="font-size:70px">🃏</div><h1 style="color:#d6a849">404</h1>' +
    '<p>გვერდი ვერ მოიძებნა.</p><p><a href="/" style="color:#d6a849">მთავარზე დაბრუნება</a></p></div>' +
    '</body></html>'
  );
});

/* ============================================================
   PERIODIC CLEANUP
   ============================================================ */

setInterval(function () {
  rooms.forEach(function (room, id) {
    const connectedHumans = room.players.filter(function (player) {
      return !player.isBot && player.connected;
    });

    if ((room.game && room.game.gameOver && connectedHumans.length === 0) || (!room.game && room.players.length === 0)) {
      cleanupRoom(room);
      rooms.delete(id);
    }
  });

  broadcastLobby();
}, 60000);

/* ============================================================
   SHUTDOWN
   ============================================================ */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('[SHUTDOWN]', signal || '');

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  rooms.forEach(cleanupRoom);
  dominoRooms.forEach(dominoCleanupRoom);

  try {
    await saveUsersNow();
  } catch (error) {
    console.error('[SHUTDOWN SAVE]', error);
  }

  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 5000).unref();
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });
process.on('unhandledRejection', function (error) { console.error('[UNHANDLED REJECTION]', error); });
process.on('uncaughtException', function (error) { console.error('[UNCAUGHT EXCEPTION]', error); });

/* ============================================================
   BOOT
   ============================================================ */

async function boot() {
  await loadUsers();

  server.listen(PORT, '0.0.0.0', function () {
    console.log('==========================================');
    console.log(' WRITTEN BURA v2 ONLINE');
    console.log(' PORT:', PORT);
    console.log(' TESTER MODE:', TESTER_ENABLED ? 'on (' + TESTER_NAME + ')' : 'off');
    console.log(' USERS:', users.size);
    console.log(' SHOP ITEMS:', SHOP_ITEMS.length);
    console.log('==========================================');
  });
}

if (require.main === module) {
  boot().catch(function (error) {
    console.error('[BOOT ERROR]', error);
    process.exit(1);
  });
}

module.exports = { validatePlay: validatePlay, canBeatSet: canBeatSet, server: server, boot: boot };
