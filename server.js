const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

const CARD_VALUES = {
    '7': 0, '8': 0, '9': 0, 'J': 2, 'Q': 3, 'K': 4, '10': 10, 'A': 11
};

const RANKS_ORDER = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const SUITS = ['spades', 'clubs', 'hearts', 'diamonds'];
const TRUMP_ROTATION = ['spades', 'clubs', 'hearts', 'diamonds', 'no_trump'];

let rooms = {};

function createDeck() {
    let deck = [];

    for (let suit of SUITS) {
        for (let rank of RANKS_ORDER) {
            deck.push({
                rank,
                suit,
                value: CARD_VALUES[rank]
            });
        }
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
}

function createRoom(roomId, maxPlayers, targetParties, stake) {
    return {
        id: roomId,
        maxPlayers: parseInt(maxPlayers),
        targetParties: parseInt(targetParties),
        stake: parseFloat(stake),
        players: [],
        gameState: null
    };
}

function startNewHand(room, previousGame = null) {
    let deck = createDeck();
    let playersCards = {};
    let takenCards = {};
    let totalScores = {};

    room.players.forEach((p) => {
        playersCards[p.id] = deck.splice(0, 5);
        takenCards[p.id] = [];

        totalScores[p.id] = previousGame
            ? (previousGame.totalScores[p.id] || 0)
            : 0;
    });

    let handIndex = previousGame
        ? previousGame.handIndex + 1
        : 1;

    let partyNum = Math.ceil(handIndex / 5);

    let trumpIndex = (handIndex - 1) % 5;
    let currentTrump = TRUMP_ROTATION[trumpIndex];

    let startLeaderIndex = 0;

    if (
        previousGame &&
        previousGame.nextRoundLeaderIndex !== undefined
    ) {
        startLeaderIndex = previousGame.nextRoundLeaderIndex;
    }

    let roundHistory = previousGame
        ? previousGame.roundHistory
        : [];

    return {
        deck,
        playersCards,
        takenCards,
        totalScores,

        currentTurnIndex: startLeaderIndex,

        table: [],

        trump: currentTrump,

        partyNum,
        handIndex,

        roundHistory,

        leadCardCount: null,

        isProcessing: false,

        gameOver: false
    };
}

function cardBeatsCard(leadCard, challengeCard, trump) {
    let isChallengeTrump =
        trump !== 'no_trump' &&
        challengeCard.suit === trump;

    let isLeadTrump =
        trump !== 'no_trump' &&
        leadCard.suit === trump;

    if (isChallengeTrump && !isLeadTrump) {
        return true;
    }

    if (!isChallengeTrump && isLeadTrump) {
        return false;
    }

    if (challengeCard.suit === leadCard.suit) {
        return (
            RANKS_ORDER.indexOf(challengeCard.rank) >
            RANKS_ORDER.indexOf(leadCard.rank)
        );
    }

    return false;
}

function beatsPlay(leadPlay, challengePlay, trump) {
    let leadCards = leadPlay.cards;
    let challengeCards = challengePlay.cards;

    if (
        challengeCards.length === 5 &&
        challengeCards.every(
            c => c.suit === challengeCards[0].suit
        )
    ) {
        if (leadCards.length < 5) {
            return true;
        }
    }

    if (leadCards.length !== challengeCards.length) {
        return false;
    }

    let sortedLead = [...leadCards].sort(
        (a, b) =>
            RANKS_ORDER.indexOf(b.rank) -
            RANKS_ORDER.indexOf(a.rank)
    );

    let sortedChallenge = [...challengeCards].sort(
        (a, b) =>
            RANKS_ORDER.indexOf(b.rank) -
            RANKS_ORDER.indexOf(a.rank)
    );

    for (let i = 0; i < sortedLead.length; i++) {
        if (
            !cardBeatsCard(
                sortedLead[i],
                sortedChallenge[i],
                trump
            )
        ) {
            return false;
        }
    }

    return true;
}

function getWinningPlayIndex(table, trump) {
    if (table.length === 0) {
        return -1;
    }

    let winningIdx = 0;

    for (let i = 1; i < table.length; i++) {
        if (
            beatsPlay(
                table[winningIdx],
                table[i],
                trump
            )
        ) {
            winningIdx = i;
        }
    }

    return winningIdx;
}

io.on('connection', (socket) => {

    socket.on(
        'joinTable',
        ({ name, capacity, parties, stake }) => {

            let maxP = parseInt(capacity) || 2;

            let targetParties =
                parseInt(parties) || 1;

            let tableStake =
                parseFloat(stake) || 1;

            let playerName =
                String(name || '').trim() ||
                'მოთამაშე';

            let availableRoom =
                Object.values(rooms).find(r =>
                    r.maxPlayers === maxP &&
                    r.targetParties === targetParties &&
                    r.stake === tableStake &&
                    r.players.length < maxP &&
                    !r.gameState
                );

            if (!availableRoom) {

                let roomId =
                    'room_' +
                    Date.now() +
                    '_' +
                    Math.floor(Math.random() * 1000);

                availableRoom = createRoom(
                    roomId,
                    maxP,
                    targetParties,
                    tableStake
                );

                rooms[roomId] = availableRoom;
            }

            socket.roomId = availableRoom.id;

            let isTester =
                playerName === 'საბა123';

            availableRoom.players.push({
                id: socket.id,
                name: playerName,
                balance: 100 - tableStake,
                isTester: isTester
            });

            socket.join(availableRoom.id);

            /*
             * TESTER MODE
             *
             * საბა123-ს ავტომატურად ვუსვამთ ბოტებს,
             * რათა თამაშის დიზაინი/ლოგიკა მარტივად დატესტოს.
             */
            if (isTester) {

                let botCount = 1;

                while (
                    availableRoom.players.length <
                    availableRoom.maxPlayers
                ) {

                    let botId =
                        'bot_' +
                        botCount +
                        '_' +
                        Date.now();

                    availableRoom.players.push({
                        id: botId,
                        name: 'ბოტი ' + botCount,
                        balance: 100,
                        isTester: false,
                        isBot: true
                    });

                    botCount++;
                }
            }

            if (
                availableRoom.players.length ===
                availableRoom.maxPlayers
            ) {

                availableRoom.gameState =
                    startNewHand(availableRoom);

                io.to(availableRoom.id).emit(
                    'gameStateUpdate',
                    getClientGameState(availableRoom)
                );

            } else {

                io.to(availableRoom.id).emit(
                    'waitingForPlayers',
                    {
                        current:
                            availableRoom.players.length,

                        max:
                            availableRoom.maxPlayers
                    }
                );
            }
        }
    );

    socket.on(
        'switchControlledPlayer',
        ({ targetPlayerId }) => {

            if (
                !socket.roomId ||
                !rooms[socket.roomId]
            ) {
                return;
            }

            let room =
                rooms[socket.roomId];

            let sender =
                room.players.find(
                    p => p.id === socket.id
                );

            if (
                sender &&
                sender.isTester &&
                room.gameState
            ) {

                socket.emit(
                    'gameStateUpdate',
                    getClientGameState(
                        room,
                        targetPlayerId
                    )
                );
            }
        }
    );

    socket.on(
        'playCards',
        ({ cardIndices, targetPlayerId }) => {

            if (
                !socket.roomId ||
                !rooms[socket.roomId]
            ) {
                return;
            }

            let room =
                rooms[socket.roomId];

            let gs =
                room.gameState;

            if (
                !gs ||
                gs.isProcessing ||
                gs.gameOver
            ) {
                return;
            }

            let activePlayer =
                room.players[
                    gs.currentTurnIndex
                ];

            let senderPlayer =
                room.players.find(
                    p => p.id === socket.id
                );

            if (!activePlayer) {
                return;
            }

            let actingPlayerId =
                activePlayer.id;

            /*
             * Tester can control any player,
             * but only when it is actually that player's turn.
             */
            if (
                senderPlayer &&
                senderPlayer.isTester &&
                targetPlayerId
            ) {

                if (
                    targetPlayerId !==
                    activePlayer.id
                ) {

                    socket.emit(
                        'errorMessage',
                        'ახლა ' +
                        activePlayer.name +
                        '-ის სვლაა! გადართეთ მასზე.'
                    );

                    return;
                }

                actingPlayerId =
                    targetPlayerId;

            } else if (
                activePlayer.id !== socket.id
            ) {
                return;
            }

            let playerCards =
                gs.playersCards[
                    actingPlayerId
                ];

            if (!playerCards) {
                return;
            }

            if (!Array.isArray(cardIndices)) {
                return;
            }

            let selectedCards =
                cardIndices
                    .map(i => playerCards[i])
                    .filter(Boolean);

            if (
                selectedCards.length === 0 ||
                selectedCards.length !==
                cardIndices.length
            ) {
                return;
            }

            let isMaliutka =
                selectedCards.length === 5 &&
                selectedCards.every(
                    c =>
                        c.suit ===
                        selectedCards[0].suit
                );

            /*
             * FIRST PLAYER
             */
            if (gs.table.length === 0) {

                let firstSuit =
                    selectedCards[0].suit;

                let isSameSuit =
                    selectedCards.every(
                        c =>
                            c.suit ===
                            firstSuit
                    );

                if (!isSameSuit) {

                    socket.emit(
                        'errorMessage',
                        'ჩამომსვლელს შეუძლია მხოლოდ ერთი ცვეტის კარტების დადება!'
                    );

                    return;
                }

                gs.leadCardCount =
                    selectedCards.length;

                gs.playersCards[
                    actingPlayerId
                ] =
                    playerCards.filter(
                        (_, i) =>
                            !cardIndices.includes(i)
                    );

                let player =
                    room.players.find(
                        p =>
                            p.id ===
                            actingPlayerId
                    );

                gs.table.push({
                    playerId:
                        actingPlayerId,

                    playerName:
                        player
                            ? player.name
                            : 'მოთამაშე',

                    cards:
                        selectedCards
                });

                gs.currentTurnIndex =
                    (
                        gs.currentTurnIndex + 1
                    ) %
                    room.players.length;

                broadcastGameState(room);

            } else {

                /*
                 * NORMAL PLAY
                 */
                if (
                    !isMaliutka &&
                    selectedCards.length !==
                    gs.leadCardCount
                ) {

                    socket.emit(
                        'errorMessage',
                        'უნდა ჩამოხვიდეთ ზუსტად ' +
                        gs.leadCardCount +
                        ' კარტი (ან მალიუტკა)!'
                    );

                    return;
                }

                if (isMaliutka) {
                    gs.leadCardCount = 5;
                }

                gs.playersCards[
                    actingPlayerId
                ] =
                    playerCards.filter(
                        (_, i) =>
                            !cardIndices.includes(i)
                    );

                let player =
                    room.players.find(
                        p =>
                            p.id ===
                            actingPlayerId
                    );

                gs.table.push({
                    playerId:
                        actingPlayerId,

                    playerName:
                        player
                            ? player.name
                            : 'მოთამაშე',

                    cards:
                        selectedCards
                });

                /*
                 * Not everyone has played yet.
                 */
                if (
                    gs.table.length <
                    room.players.length
                ) {

                    gs.currentTurnIndex =
                        (
                            gs.currentTurnIndex + 1
                        ) %
                        room.players.length;

                    broadcastGameState(room);

                } else {

                    /*
                     * Determine winner.
                     */
                    let winIdx =
                        getWinningPlayIndex(
                            gs.table,
                            gs.trump
                        );

                    let winningPlay =
                        gs.table[winIdx];

                    let winnerId =
                        winningPlay.playerId;

                    let allTableCards = [];

                    gs.table.forEach(
                        p =>
                            allTableCards.push(
                                ...p.cards
                            )
                    );

                    gs.takenCards[
                        winnerId
                    ].push(
                        ...allTableCards
                    );

                    let winnerIndex =
                        room.players.findIndex(
                            p =>
                                p.id ===
                                winnerId
                        );

                    gs.currentTurnIndex =
                        winnerIndex;

                    gs.isProcessing =
                        true;

                    broadcastGameState(room);

                    setTimeout(() => {

                        gs.table = [];

                        gs.leadCardCount =
                            null;

                        /*
                         * Deal cards until every player
                         * has up to five cards.
                         */
                        while (
                            gs.deck.length > 0
                        ) {

                            let anyPlayerNeedsCard =
                                room.players.some(
                                    p =>
                                        gs.playersCards[
                                            p.id
                                        ].length < 5
                                );

                            if (
                                !anyPlayerNeedsCard
                            ) {
                                break;
                            }

                            for (
                                let step = 0;
                                step <
                                room.players.length;
                                step++
                            ) {

                                let pIdx =
                                    (
                                        winnerIndex +
                                        step
                                    ) %
                                    room.players.length;

                                let pId =
                                    room.players[
                                        pIdx
                                    ].id;

                                if (
                                    gs.playersCards[
                                        pId
                                    ].length < 5 &&
                                    gs.deck.length > 0
                                ) {

                                    gs.playersCards[
                                        pId
                                    ].push(
                                        gs.deck.pop()
                                    );
                                }
                            }
                        }

                        let allHandsEmpty =
                            room.players.every(
                                p =>
                                    gs.playersCards[
                                        p.id
                                    ].length === 0
                            );

                        gs.isProcessing =
                            false;

                        if (allHandsEmpty) {
                            finishHand(room);
                        } else {
                            broadcastGameState(room);
                        }

                    }, 2000);
                }
            }
        }
    );

    socket.on('disconnect', () => {

        if (
            socket.roomId &&
            rooms[socket.roomId]
        ) {

            let room =
                rooms[socket.roomId];

            room.players =
                room.players.filter(
                    p =>
                        p.id !== socket.id
                );

            io.to(room.id).emit(
                'playerLeft'
            );

            delete rooms[
                socket.roomId
            ];
        }
    });
});

function broadcastGameState(room) {

    room.players.forEach(p => {

        /*
         * Bots don't have sockets.
         */
        if (p.id.startsWith('bot_')) {
            return;
        }

        io.to(p.id).emit(
            'gameStateUpdate',
            getClientGameState(
                room,
                p.id
            )
        );
    });
}

function finishHand(room) {

    let gs =
        room.gameState;

    let handScores = {};

    let minScore =
        Infinity;

    let minPlayerIndex =
        0;

    room.players.forEach(
        (p, idx) => {

            let pts =
                gs.takenCards[
                    p.id
                ].reduce(
                    (sum, c) =>
                        sum + c.value,
                    0
                );

            handScores[p.id] =
                pts;

            gs.totalScores[p.id] =
                (
                    gs.totalScores[p.id] ||
                    0
                ) +
                (
                    pts === 0
                        ? -120
                        : pts
                );

            if (pts < minScore) {

                minScore =
                    pts;

                minPlayerIndex =
                    idx;
            }
        }
    );

    gs.roundHistory.push({
        handIndex:
            gs.handIndex,

        trump:
            gs.trump,

        scores:
            handScores
    });

    let totalMaxHands =
        room.targetParties * 5;

    if (
        gs.handIndex >=
        totalMaxHands
    ) {

        gs.gameOver =
            true;

        let sorted =
            [...room.players].sort(
                (a, b) =>
                    (
                        gs.totalScores[b.id] ||
                        0
                    ) -
                    (
                        gs.totalScores[a.id] ||
                        0
                    )
            );

        let winner =
            sorted[0];

        let totalPrize =
            room.stake *
            room.players.length;

        winner.balance +=
            totalPrize;

        broadcastGameState(room);

    } else {

        let nextLeaderIndex =
            (
                minPlayerIndex + 1
            ) %
            room.players.length;

        gs.nextRoundLeaderIndex =
            nextLeaderIndex;

        room.gameState =
            startNewHand(
                room,
                gs
            );

        broadcastGameState(room);
    }
}

/*
 * IMPORTANT:
 *
 * Normal players receive only their own cards.
 *
 * Tester "საბა123" can see all cards
 * because this is needed for testing.
 */
function getClientGameState(
    room,
    forPlayerId
) {

    let gs =
        room.gameState;

    let winningIndex =
        getWinningPlayIndex(
            gs.table,
            gs.trump
        );

    let viewer =
        room.players.find(
            p =>
                p.id ===
                forPlayerId
        );

    let isTester =
        !!(
            viewer &&
            viewer.isTester
        );

    let playersSummary =
        room.players.map(
            (p, idx) => ({

                id:
                    p.id,

                name:
                    p.name,

                balance:
                    p.balance,

                isTester:
                    p.isTester,

                cardCount:
                    gs.playersCards[p.id]
                        ? gs.playersCards[p.id].length
                        : 0,

                takenCount:
                    gs.takenCards[p.id]
                        ? gs.takenCards[p.id].length
                        : 0,

                handPoints:
                    gs.takenCards[p.id]
                        ? gs.takenCards[p.id].reduce(
                            (a, b) =>
                                a + b.value,
                            0
                        )
                        : 0,

                totalPoints:
                    gs.totalScores[p.id] ||
                    0,

                isCurrent:
                    idx ===
                    gs.currentTurnIndex
            })
        );

    let visibleCards = {};

    if (isTester) {

        visibleCards =
            gs.playersCards;

    } else if (
        forPlayerId &&
        gs.playersCards[
            forPlayerId
        ]
    ) {

        visibleCards[
            forPlayerId
        ] =
            gs.playersCards[
                forPlayerId
            ];
    }

    return {

        table:
            gs.table.map(
                (play, idx) => ({

                    ...play,

                    isWinning:
                        idx ===
                        winningIndex
                })
            ),

        trump:
            gs.trump,

        partyNum:
            gs.partyNum,

        targetParties:
            room.targetParties,

        handIndex:
            gs.handIndex,

        stake:
            room.stake,

        players:
            playersSummary,

        playersCards:
            visibleCards,

        viewingPlayerId:
            forPlayerId,

        currentTurnIndex:
            gs.currentTurnIndex,

        isProcessing:
            gs.isProcessing,

        deckCount:
            gs.deck.length,

        roundHistory:
            gs.roundHistory,

        gameOver:
            gs.gameOver
    };
}

app.get('/', (req, res) => {

    res.send(`
<!DOCTYPE html>

<html lang="ka">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>BURA VIP CLUB</title>

<script src="/socket.io/socket.io.js"></script>

<style>

/* =========================================================
   GLOBAL
========================================================= */

* {
    box-sizing: border-box;
    font-family:
        Inter,
        Segoe UI,
        system-ui,
        -apple-system,
        sans-serif;
}

:root {

    --bg:
        #08090d;

    --panel:
        #101217;

    --panel2:
        #151820;

    --gold:
        #f4c542;

    --gold2:
        #ff9d00;

    --muted:
        #8e96a8;

    --line:
        rgba(255,255,255,.08);

    --green:
        #16743f;

    --green2:
        #0b4e2c;
}

html,
body {

    margin: 0;

    min-height: 100%;

    background:

        radial-gradient(
            circle at 50% 0%,
            rgba(79,48,10,.22),
            transparent 32%
        ),

        radial-gradient(
            circle at 10% 90%,
            rgba(28,91,55,.16),
            transparent 35%
        ),

        var(--bg);

    color:
        #fff;
}

body {

    min-height:
        100vh;
}

button,
input,
select {

    font:
        inherit;
}

button {

    cursor:
        pointer;
}

.hidden {

    display:
        none !important;
}

/* =========================================================
   LOBBY / HOME
========================================================= */

#lobby {

    min-height:
        100vh;

    display:
        flex;

    flex-direction:
        column;

    background:

        linear-gradient(
            rgba(8,9,13,.72),
            rgba(8,9,13,.96)
        ),

        radial-gradient(
            circle at 50% 35%,
            #2b2414 0%,
            transparent 38%
        ),

        repeating-linear-gradient(
            45deg,
            rgba(255,255,255,.012) 0 2px,
            transparent 2px 8px
        );
}

/* =========================================================
   NAVBAR
========================================================= */

.navbar {

    height:
        82px;

    border-bottom:
        1px solid var(--line);

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    padding:
        0 28px;

    background:
        rgba(7,8,12,.86);

    backdrop-filter:
        blur(18px);

    position:
        sticky;

    top:
        0;

    z-index:
        20;
}

.brand {

    font-size:
        22px;

    font-weight:
        900;

    letter-spacing:
        .8px;

    color:
        var(--gold);
}

.brand span {

    color:
        #fff;
}

.nav-left,
.nav-right {

    display:
        flex;

    align-items:
        center;

    gap:
        22px;
}

.nav-link {

    font-size:
        13px;

    color:
        #aeb5c2;

    text-transform:
        uppercase;

    font-weight:
        700;
}

.nav-link.active,
.nav-link:hover {

    color:
        #fff;
}

.nav-pill {

    border:
        1px solid rgba(244,197,66,.3);

    padding:
        10px 14px;

    border-radius:
        10px;

    color:
        var(--gold);

    background:
        rgba(244,197,66,.06);
}

.profile-mini {

    display:
        flex;

    align-items:
        center;

    gap:
        10px;

    padding:
        8px 12px;

    border:
        1px solid var(--line);

    border-radius:
        11px;

    background:
        #12151c;
}

.avatar {

    width:
        34px;

    height:
        34px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        linear-gradient(
            145deg,
            #525967,
            #20252e
        );

    border:
        1px solid rgba(255,255,255,.18);

    font-weight:
        800;
}

/* =========================================================
   LOBBY GRID
========================================================= */

.lobby-main {

    width:
        min(1500px,100%);

    margin:
        0 auto;

    padding:
        28px;

    display:
        grid;

    grid-template-columns:
        260px
        minmax(0,1fr)
        300px;

    gap:
        24px;
}

.side-card,
.right-card,
.center-card {

    background:
        linear-gradient(
            145deg,
            rgba(22,24,31,.96),
            rgba(12,14,19,.96)
        );

    border:
        1px solid var(--line);

    box-shadow:
        0 24px 70px rgba(0,0,0,.28);

    border-radius:
        18px;
}

.side-card,
.right-card {

    padding:
        18px;
}

.section-title {

    font-size:
        13px;

    text-transform:
        uppercase;

    color:
        #c2c8d4;

    font-weight:
        800;

    letter-spacing:
        .5px;

    margin:
        0 0 16px;
}

.feed {

    display:
        flex;

    flex-direction:
        column;

    gap:
        14px;
}

.feed-row {

    display:
        flex;

    gap:
        10px;

    align-items:
        center;

    padding-bottom:
        12px;

    border-bottom:
        1px solid var(--line);
}

.feed-row:last-child {

    border-bottom:
        0;
}

.feed-text {

    font-size:
        12px;

    color:
        #b5bbc7;

    line-height:
        1.35;
}

.feed-text b {

    color:
        #fff;
}

.feed-dot {

    width:
        30px;

    height:
        30px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        #242933;

    font-size:
        13px;

    flex:
        none;
}

/* =========================================================
   CENTER LOBBY CARD
========================================================= */

.center-card {

    min-height:
        590px;

    position:
        relative;

    overflow:
        hidden;

    padding:
        26px;
}

.center-card:before {

    content:
        "";

    position:
        absolute;

    inset:
        0;

    opacity:
        .24;

    background:

        radial-gradient(
            circle at 50% 40%,
            rgba(244,197,66,.18),
            transparent 30%
        ),

        linear-gradient(
            135deg,
            transparent 0 48%,
            rgba(255,255,255,.018) 49% 51%,
            transparent 52% 100%
        );

    pointer-events:
        none;
}

.center-content {

    position:
        relative;

    z-index:
        1;

    max-width:
        700px;

    margin:
        0 auto;
}

.hero-title {

    text-align:
        center;

    font-size:
        30px;

    margin:
        8px 0 4px;

    color:
        var(--gold);

    font-weight:
        900;
}

.hero-sub {

    text-align:
        center;

    color:
        #858d9c;

    font-size:
        13px;

    margin-bottom:
        25px;
}

.field {

    margin:
        14px 0;
}

.field label {

    display:
        block;

    font-size:
        11px;

    text-transform:
        uppercase;

    color:
        #9ea6b4;

    font-weight:
        800;

    margin:
        0 0 7px;
}

.field input,
.field select {

    width:
        100%;

    height:
        46px;

    border-radius:
        10px;

    border:
        1px solid #2b303a;

    background:
        #0b0d12;

    color:
        #fff;

    padding:
        0 14px;

    outline:
        none;
}

.field input:focus,
.field select:focus {

    border-color:
        rgba(244,197,66,.55);

    box-shadow:
        0 0 0 3px
        rgba(244,197,66,.08);
}

.gold-btn {

    width:
        100%;

    height:
        48px;

    border:
        0;

    border-radius:
        10px;

    background:
        linear-gradient(
            135deg,
            #ffd84d,
            #ff9700
        );

    color:
        #15100a;

    font-weight:
        900;

    box-shadow:
        0 10px 28px
        rgba(255,157,0,.18);
}

/* =========================================================
   TABLE LOBBY
========================================================= */

.table-grid {

    display:
        grid;

    grid-template-columns:
        repeat(
            2,
            minmax(0,1fr)
        );

    gap:
        12px;

    margin-top:
        20px;
}

.lobby-table {

    border:
        1px solid var(--line);

    background:
        linear-gradient(
            145deg,
            #151920,
            #0e1015
        );

    border-radius:
        14px;

    padding:
        16px;

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;

    transition:
        .18s;
}

.lobby-table:hover {

    transform:
        translateY(-2px);

    border-color:
        rgba(244,197,66,.35);
}

.stake {

    font-size:
        22px;

    font-weight:
        900;

    color:
        var(--gold);
}

.table-meta {

    font-size:
        11px;

    color:
        #7f8796;

    margin-top:
        4px;
}

.join-circle {

    width:
        38px;

    height:
        38px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        linear-gradient(
            135deg,
            #ffd84d,
            #ff9700
        );

    color:
        #111;

    font-size:
        22px;

    font-weight:
        900;
}

.waiting {

    margin-top:
        15px;

    text-align:
        center;

    color:
        var(--gold);

    font-weight:
        800;

    font-size:
        13px;
}

/* =========================================================
   PROFILE
========================================================= */

.right-profile {

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;

    text-align:
        center;

    padding:
        10px 0 20px;

    border-bottom:
        1px solid var(--line);
}

.big-avatar {

    width:
        74px;

    height:
        74px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        linear-gradient(
            145deg,
            #565d68,
            #1e222a
        );

    border:
        2px solid
        rgba(244,197,66,.45);

    font-size:
        25px;

    font-weight:
        900;
}

.profile-name {

    font-weight:
        900;

    margin-top:
        10px;
}

.vip-level {

    font-size:
        11px;

    color:
        var(--gold);

    margin-top:
        4px;
}

.stat-row {

    display:
        grid;

    grid-template-columns:
        repeat(
            3,
            1fr
        );

    gap:
        7px;

    margin-top:
        15px;

    width:
        100%;
}

.stat {

    background:
        #0d0f14;

    border:
        1px solid var(--line);

    border-radius:
        9px;

    padding:
        9px 4px;
}

.stat b {

    display:
        block;

    color:
        var(--gold);

    font-size:
        14px;
}

.stat span {

    font-size:
        9px;

    color:
        #777f8d;
}

.reg-title {

    font-size:
        12px;

    font-weight:
        900;

    margin:
        18px 0 12px;

    color:
        #d8dce5;
}

.small-btn {

    height:
        38px;

    border:
        0;

    border-radius:
        9px;

    background:
        #232832;

    color:
        #fff;

    font-weight:
        800;

    width:
        100%;
}

.small-btn:hover {

    background:
        #2d333e;
}

/* =========================================================
   GAME CONTAINER
========================================================= */

#game-container {

    display:
        none;

    min-height:
        100vh;

    padding:
        18px 18px 30px;

    background:

        radial-gradient(
            circle at 50% 45%,
            rgba(31,120,66,.13),
            transparent 42%
        ),

        #08090c;
}

.game-top {

    width:
        min(1200px,100%);

    margin:
        0 auto 12px;

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;

    gap:
        10px;

    flex-wrap:
        wrap;

    background:
        rgba(15,17,22,.94);

    border:
        1px solid var(--line);

    border-radius:
        14px;

    padding:
        10px 14px;
}

.game-brand {

    font-weight:
        900;

    color:
        var(--gold);

    letter-spacing:
        .4px;
}

.info-wrap {

    display:
        flex;

    gap:
        7px;

    flex-wrap:
        wrap;
}

.info-badge {

    font-size:
        11px;

    color:
        #b8bfca;

    background:
        #0b0d11;

    border:
        1px solid var(--line);

    border-radius:
        9px;

    padding:
        7px 10px;
}

.info-badge b {

    color:
        #fff;
}

/* =========================================================
   TESTER CONTROL
========================================================= */

#tester-control {

    width:
        min(1200px,100%);

    margin:
        0 auto 10px;

    background:
        #17101d;

    border:
        1px solid #7546a3;

    border-radius:
        11px;

    padding:
        9px 12px;

    color:
        #caa6eb;

    font-size:
        12px;
}

#tester-control select {

    background:
        #0d0d12;

    color:
        #fff;

    border:
        1px solid #7546a3;

    border-radius:
        7px;

    padding:
        5px 8px;
}

#status-msg {

    width:
        min(1200px,100%);

    margin:
        8px auto;

    text-align:
        center;

    min-height:
        24px;

    color:
        var(--gold);

    font-weight:
        900;

    font-size:
        14px;
}

/* =========================================================
   BURA TABLE
========================================================= */

.game-board {

    width:
        min(1200px,100%);

    height:
        620px;

    margin:
        0 auto;

    position:
        relative;

    border-radius:
        50% / 38%;

    background:

        radial-gradient(
            ellipse at 50% 48%,
            rgba(33,137,76,.95),
            rgba(10,78,42,.98) 62%,
            #06351d 100%
        );

    border:
        18px solid #2a1b11;

    box-shadow:

        0 25px 70px
        rgba(0,0,0,.65),

        inset 0 0 0 4px
        rgba(255,220,150,.09),

        inset 0 0 80px
        rgba(0,0,0,.65);

    overflow:
        hidden;
}

.game-board:before {

    content:
        "";

    position:
        absolute;

    inset:
        15px;

    border-radius:
        50% / 38%;

    border:
        1px solid
        rgba(255,255,255,.09);

    box-shadow:
        inset 0 0 50px
        rgba(0,0,0,.18);

    pointer-events:
        none;
}

.board-logo {

    position:
        absolute;

    left:
        50%;

    top:
        50%;

    transform:
        translate(
            -50%,
            -50%
        );

    color:
        rgba(255,255,255,.06);

    font-size:
        30px;

    font-weight:
        900;

    letter-spacing:
        4px;

    pointer-events:
        none;
}

.board-trump {

    position:
        absolute;

    left:
        50%;

    top:
        50%;

    transform:
        translate(
            -50%,
            52px
        );

    font-size:
        12px;

    color:
        rgba(255,255,255,.34);

    font-weight:
        800;
}

/* =========================================================
   PLAYER SEATS
========================================================= */

.seat {

    position:
        absolute;

    width:
        150px;

    min-height:
        78px;

    transform:
        translate(
            -50%,
            -50%
        );

    z-index:
        5;

    text-align:
        center;
}

.seat.bottom {

    left:
        50%;

    top:
        88%;
}

.seat.top {

    left:
        50%;

    top:
        12%;
}

.seat.top-left {

    left:
        22%;

    top:
        18%;
}

.seat.top-right {

    left:
        78%;

    top:
        18%;
}

.seat.left {

    left:
        8%;

    top:
        50%;
}

.seat.right {

    left:
        92%;

    top:
        50%;
}

.seat.active .seat-card {

    border-color:
        rgba(244,197,66,.9);

    box-shadow:
        0 0 22px
        rgba(244,197,66,.25);
}

.seat-card {

    background:
        rgba(8,10,13,.86);

    border:
        1px solid
        rgba(255,255,255,.12);

    border-radius:
        12px;

    padding:
        8px;

    backdrop-filter:
        blur(8px);

    box-shadow:
        0 8px 24px
        rgba(0,0,0,.35);
}

.seat-head {

    display:
        flex;

    align-items:
        center;

    justify-content:
        center;

    gap:
        7px;
}

.seat-avatar {

    width:
        34px;

    height:
        34px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        linear-gradient(
            145deg,
            #59606c,
            #20242b
        );

    border:
        1px solid
        rgba(255,255,255,.18);

    font-size:
        12px;

    font-weight:
        900;
}

.seat-name {

    font-size:
        12px;

    font-weight:
        900;

    max-width:
        80px;

    overflow:
        hidden;

    text-overflow:
        ellipsis;

    white-space:
        nowrap;
}

.seat-balance {

    font-size:
        10px;

    color:
        #8d96a4;

    margin-top:
        2px;
}

.turn-dot {

    width:
        7px;

    height:
        7px;

    border-radius:
        50%;

    background:
        var(--gold);

    box-shadow:
        0 0 10px
        var(--gold);

    display:
        inline-block;
}

/* =========================================================
   OPPONENT CARD BACKS
========================================================= */

.opponent-cards {

    display:
        flex;

    justify-content:
        center;

    margin-top:
        6px;

    min-height:
        32px;
}

.back-card {

    width:
        23px;

    height:
        32px;

    border-radius:
        4px;

    margin-left:
        -8px;

    border:
        1px solid #d8b75a;

    background:

        radial-gradient(
            circle at 50% 50%,
            rgba(255,215,0,.25) 0 2px,
            transparent 3px
        ),

        repeating-linear-gradient(
            45deg,
            #263038 0 3px,
            #131b21 3px 6px
        );

    box-shadow:
        0 3px 7px
        rgba(0,0,0,.45);
}

.back-card:first-child {

    margin-left:
        0;
}

/* =========================================================
   CENTER PLAY AREA
========================================================= */

.play-area {

    position:
        absolute;

    left:
        50%;

    top:
        50%;

    transform:
        translate(
            -50%,
            -50%
        );

    width:
        48%;

    min-height:
        135px;

    display:
        flex;

    justify-content:
        center;

    align-items:
        center;

    gap:
        16px;

    z-index:
        3;
}

.play-group {

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;

    min-width:
        75px;
}

.play-player {

    font-size:
        10px;

    color:
        #c9ced7;

    margin-bottom:
        4px;

    font-weight:
        800;
}

.play-cards {

    display:
        flex;

    justify-content:
        center;
}

/* =========================================================
   CARDS
========================================================= */

.card {

    width:
        58px;

    height:
        84px;

    border-radius:
        7px;

    background:
        #f8f8f5;

    color:
        #151515;

    border:
        1px solid #ddd;

    box-shadow:
        0 5px 12px
        rgba(0,0,0,.55);

    padding:
        5px;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        space-between;

    font-weight:
        900;
}

.card .rank-top {

    font-size:
        12px;

    line-height:
        1;
}

.card .suit-center {

    text-align:
        center;

    font-size:
        25px;

    line-height:
        1;

    margin:
        auto;
}

.card .rank-bottom {

    text-align:
        right;

    font-size:
        12px;

    line-height:
        1;
}

.card.suit-spades,
.card.suit-clubs {

    color:
        #121212;
}

.card.suit-hearts,
.card.suit-diamonds {

    color:
        #a00;
}

.play-group.winning-play .card {

    box-shadow:
        0 0 18px
        rgba(244,197,66,.8);

    border:
        2px solid
        var(--gold);
}

/* =========================================================
   PLAYER HAND
========================================================= */

.hand-panel {

    width:
        min(1100px,100%);

    margin:
        12px auto 0;

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;
}

#cards-owner-title {

    font-size:
        12px;

    color:
        #aeb5c2;

    margin:
        4px 0 7px;
}

#my-cards {

    display:
        flex;

    justify-content:
        center;

    gap:
        8px;

    min-height:
        95px;

    flex-wrap:
        wrap;
}

#my-cards .card {

    width:
        64px;

    height:
        92px;

    cursor:
        pointer;

    transition:
        .12s;
}

#my-cards .card:hover {

    transform:
        translateY(-7px);
}

#my-cards .card.selected {

    transform:
        translateY(-14px);

    border:
        3px solid
        var(--gold);

    box-shadow:
        0 0 20px
        rgba(244,197,66,.55);
}

.action-container {

    margin:
        7px 0 14px;
}

.play-btn {

    height:
        40px;

    padding:
        0 34px;

    border:
        0;

    border-radius:
        10px;

    background:
        linear-gradient(
            135deg,
            #ffd84d,
            #ff9700
        );

    color:
        #111;

    font-weight:
        900;
}

.play-btn:disabled {

    background:
        #303641;

    color:
        #737b88;

    cursor:
        not-allowed;
}

/* =========================================================
   LEADERBOARD
========================================================= */

.leaderboard-box {

    width:
        min(1100px,100%);

    margin:
        0 auto;

    background:
        #0e1116;

    border:
        1px solid var(--line);

    border-radius:
        13px;

    overflow:
        auto;
}

.lb-table {

    width:
        100%;

    border-collapse:
        collapse;

    text-align:
        center;

    font-size:
        11px;
}

.lb-table th {

    padding:
        9px;

    color:
        #818998;

    border-bottom:
        1px solid var(--line);

    font-weight:
        800;
}

.lb-table td {

    padding:
        9px;

    border-bottom:
        1px solid
        rgba(255,255,255,.05);

    color:
        #dfe3ea;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:1000px) {

    .lobby-main {

        grid-template-columns:
            1fr;
    }

    .side-card,
    .right-card {

        display:
            none;
    }

    .center-card {

        min-height:
            600px;
    }

    .game-board {

        height:
            560px;
    }

    .seat {

        width:
            125px;
    }

    .play-area {

        width:
            58%;
    }
}

@media(max-width:650px) {

    .navbar {

        height:
            auto;

        min-height:
            70px;

        padding:
            10px 14px;

        gap:
            8px;
    }

    .nav-left {

        gap:
            10px;
    }

    .nav-right .nav-link {

        display:
            none;
    }

    .brand {

        font-size:
            17px;
    }

    .nav-pill {

        display:
            none;
    }

    .lobby-main {

        padding:
            12px;
    }

    .center-card {

        padding:
            18px;
    }

    .table-grid {

        grid-template-columns:
            1fr;
    }

    #game-container {

        padding:
            8px;
    }

    .game-board {

        height:
            470px;

        border-width:
            11px;

        border-radius:
            48% / 30%;
    }

    .seat {

        width:
            105px;
    }

    .seat-avatar {

        width:
            28px;

        height:
            28px;
    }

    .seat-name {

        font-size:
            10px;
    }

    .seat.left {

        left:
            10%;
    }

    .seat.right {

        left:
            90%;
    }

    .seat.top-left {

        left:
            24%;
    }

    .seat.top-right {

        left:
            76%;
    }

    .play-area {

        width:
            65%;

        gap:
            5px;
    }

    .play-group {

        min-width:
            48px;
    }

    .card {

        width:
            43px;

        height:
            63px;

        padding:
            4px;
    }

    .card .suit-center {

        font-size:
            18px;
    }

    .card .rank-top,
    .card .rank-bottom {

        font-size:
            9px;
    }

    #my-cards .card {

        width:
            52px;

        height:
            75px;
    }

    .game-top {

        padding:
            8px;
    }

    .info-badge {

        font-size:
            9px;

        padding:
            6px;
    }
}

</style>

</head>

<body>

<!-- ======================================================
     HOME / TABLE LOBBY
======================================================= -->

<section id="lobby">

    <header class="navbar">

        <div class="nav-left">

            <div class="brand">
                ♠ <span>BURA</span> VIP CLUB ♣
            </div>

            <div class="nav-link active">
                HOME
            </div>

            <div class="nav-link">
                VIP PERKS
            </div>

            <div class="nav-link">
                LEADERBOARDS
            </div>

            <div class="nav-link">
                GAME HISTORY
            </div>

            <div class="nav-link">
                STORE
            </div>

        </div>

        <div class="nav-right">

            <div class="nav-link">
                ✉ MESSAGES
            </div>

            <div class="nav-pill">
                ♛ BANK <b>12,500</b> ●
            </div>

            <div class="nav-link">
                ◉ SUPPORT
            </div>

            <div class="profile-mini">

                <div class="avatar">
                    S
                </div>

                <span
                    style="
                        font-size:12px;
                        font-weight:800
                    "
                >
                    SABA123
                </span>

            </div>

        </div>

    </header>


    <main class="lobby-main">

        <!-- LEFT -->
        <aside class="side-card">

            <h3 class="section-title">
                VIP MEMBERS ACTIVITY FEED
            </h3>

            <div class="feed">

                <div class="feed-row">

                    <div class="feed-dot">
                        ♛
                    </div>

                    <div class="feed-text">
                        <b>User X</b>
                        joined a high-stakes table
                    </div>

                </div>

                <div class="feed-row">

                    <div class="feed-dot">
                        ★
                    </div>

                    <div class="feed-text">
                        <b>User Y</b>
                        unlocked a badge
                    </div>

                </div>

                <div class="feed-row">

                    <div class="feed-dot">
                        ♠
                    </div>

                    <div class="feed-text">
                        <b>User X</b>
                        joined a badge table
                    </div>

                </div>

                <div class="feed-row">

                    <div class="feed-dot">
                        ●
                    </div>

                    <div class="feed-text">
                        <b>Player 77</b>
                        won a VIP hand
                    </div>

                </div>

                <div class="feed-row">

                    <div class="feed-dot">
                        ♦
                    </div>

                    <div class="feed-text">
                        <b>Dealer</b>
                        opened a new table
                    </div>

                </div>

            </div>

        </aside>


        <!-- CENTER -->
        <section class="center-card">

            <div class="center-content">

                <div class="hero-title">
                    ♠ BURA VIP CLUB ♣
                </div>

                <div class="hero-sub">
                    აირჩიე თამაშის პარამეტრები და შემდეგ მაგიდა,
                    რომელზეც გინდა შესვლა
                </div>


                <!-- SETUP -->
                <div id="setup-form">

                    <div class="field">

                        <label>
                            მოთამაშის სახელი
                        </label>

                        <input
                            type="text"
                            id="player-name"
                            value="საბა123"
                            maxlength="16"
                        >

                    </div>


                    <div class="field">

                        <label>
                            მოთამაშეების რაოდენობა
                        </label>

                        <select id="player-capacity">

                            <option value="2">
                                2 მოთამაშე
                            </option>

                            <option
                                value="3"
                                selected
                            >
                                3 მოთამაშე
                            </option>

                            <option value="4">
                                4 მოთამაშე
                            </option>

                            <option value="5">
                                5 მოთამაშე
                            </option>

                            <option value="6">
                                6 მოთამაშე
                            </option>

                        </select>

                    </div>


                    <div class="field">

                        <label>
                            პარტიები
                        </label>

                        <select id="player-parties">

                            <option value="1">
                                1 პარტია · 5 ხელი
                            </option>

                            <option value="2">
                                2 პარტია · 10 ხელი
                            </option>

                        </select>

                    </div>


                    <button
                        class="gold-btn"
                        onclick="showTablesLobby()"
                    >
                        მაგიდის არჩევა ›
                    </button>

                </div>


                <!-- TABLE SELECTION -->
                <div
                    id="tables-lobby"
                    class="hidden"
                >

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            align-items:center;
                            margin-top:10px
                        "
                    >

                        <div>

                            <div
                                style="
                                    font-weight:900;
                                    color:#fff
                                "
                            >
                                აირჩიე მაგიდა
                            </div>

                            <div
                                style="
                                    font-size:11px;
                                    color:#777f8d;
                                    margin-top:3px
                                "
                            >
                                შენი არჩევანი გახსნის შესაბამის თამაშის ოთახს
                            </div>

                        </div>


                        <button
                            class="small-btn"
                            style="
                                width:auto;
                                padding:0 12px
                            "
                            onclick="backToSetup()"
                        >
                            უკან
                        </button>

                    </div>


                    <div class="table-grid">

                        <div
                            class="lobby-table"
                            onclick="joinSelectedTable(1)"
                        >

                            <div>

                                <div class="stake">
                                    $1
                                </div>

                                <div class="table-meta">
                                    მოგება ·
                                    <b>1,000 $</b>
                                </div>

                            </div>

                            <div class="join-circle">
                                ›
                            </div>

                        </div>


                        <div
                            class="lobby-table"
                            onclick="joinSelectedTable(2)"
                        >

                            <div>

                                <div class="stake">
                                    $2
                                </div>

                                <div class="table-meta">
                                    მოგება ·
                                    <b>2,000 $</b>
                                </div>

                            </div>

                            <div class="join-circle">
                                ›
                            </div>

                        </div>


                        <div
                            class="lobby-table"
                            onclick="joinSelectedTable(5)"
                        >

                            <div>

                                <div class="stake">
                                    $5
                                </div>

                                <div class="table-meta">
                                    მოგება ·
                                    <b>5,000 $</b>
                                </div>

                            </div>

                            <div class="join-circle">
                                ›
                            </div>

                        </div>


                        <div
                            class="lobby-table"
                            onclick="joinSelectedTable(10)"
                        >

                            <div>

                                <div class="stake">
                                    $10
                                </div>

                                <div class="table-meta">
                                    მოგება ·
                                    <b>10,000 $</b>
                                </div>

                            </div>

                            <div class="join-circle">
                                ›
                            </div>

                        </div>

                    </div>


                    <div
                        id="lobby-wait-msg"
                        class="waiting hidden"
                    ></div>

                </div>

            </div>

        </section>


        <!-- RIGHT -->
        <aside class="right-card">

            <h3 class="section-title">
                PROFILE SUMMARY
            </h3>


            <div class="right-profile">

                <div class="big-avatar">
                    S
                </div>

                <div class="profile-name">
                    SABA123 ♠
                </div>

                <div class="vip-level">
                    VIP LEVEL 3
                </div>


                <div class="stat-row">

                    <div class="stat">
                        <b>12,500</b>
                        <span>COINS</span>
                    </div>

                    <div class="stat">
                        <b>8</b>
                        <span>WINS</span>
                    </div>

                    <div class="stat">
                        <b>3</b>
                        <span>BADGES</span>
                    </div>

                </div>

            </div>


            <div class="reg-title">
                QUICK REGISTRATION
            </div>


            <div class="field">

                <label>
                    Email
                </label>

                <input
                    type="email"
                    placeholder="your@email.com"
                >

            </div>


            <div class="field">

                <label>
                    Password
                </label>

                <input
                    type="password"
                    placeholder="••••••••"
                >

            </div>


            <button
                class="gold-btn"
                onclick="
                    alert(
                        'რეგისტრაციის დემო ფორმა'
                    )
                "
            >
                რეგისტრაცია
            </button>

        </aside>

    </main>

</section>


<!-- ======================================================
     GAME
======================================================= -->

<section id="game-container">


    <div class="game-top">

        <div class="game-brand">
            ♠ BURA VIP CLUB ♣
        </div>


        <div class="info-wrap">

            <div class="info-badge">
                სტავკა:
                <b>
                    $<span id="table-stake-disp">
                        1
                    </span>
                </b>
            </div>


            <div class="info-badge">
                პარტია:
                <b id="party-num">
                    1
                </b>
                /
                <span id="target-parties">
                    1
                </span>
            </div>


            <div class="info-badge">
                ხელი:
                <b id="hand-num">
                    1
                </b>
            </div>


            <div class="info-badge">
                კოზირი:
                <b id="trump-display">
                    -
                </b>
            </div>


            <div class="info-badge">
                დასტა:
                <b id="deck-count">
                    -
                </b>
            </div>

        </div>


        <button
            class="small-btn"
            style="
                width:auto;
                padding:0 14px
            "
            onclick="location.reload()"
        >
            გასვლა
        </button>

    </div>


    <!-- TESTER -->
    <div id="tester-control">

        <b>
            🧪 ტესტერის რეჟიმი
        </b>

        · მართე მოთამაშე:

        <select
            id="active-player-select"
            onchange="switchTesterPlayer()"
        ></select>

    </div>


    <div id="status-msg">
        ველით მოთამაშეებს...
    </div>


    <!-- TABLE -->
    <div
        id="game-board"
        class="game-board"
    >

        <div class="board-logo">
            BURA VIP
        </div>

        <div
            class="board-trump"
            id="board-trump"
        >
            ♠
        </div>

        <div id="seats"></div>

        <div
            id="play-area"
            class="play-area"
        ></div>

    </div>


    <!-- HAND -->
    <div class="hand-panel">

        <div id="cards-owner-title">
            ჩემი კარტები
        </div>

        <div id="my-cards"></div>


        <div class="action-container">

            <button
                id="play-btn"
                class="play-btn"
                onclick="playSelectedCards()"
                disabled
            >
                ჩამოსვლა
            </button>

        </div>

    </div>


    <!-- LEADERBOARD -->
    <div class="leaderboard-box">

        <table class="lb-table">

            <thead>

                <tr id="lb-head">

                    <th>
                        ხელი
                    </th>

                </tr>

            </thead>

            <tbody id="lb-body"></tbody>

        </table>

    </div>

</section>


<script>

/* =========================================================
   CLIENT
========================================================= */

const socket = io();

let myCards = [];

let selectedIndices = [];

let myId = null;

let controlledPlayerId = null;


/* =========================================================
   SUITS
========================================================= */

const SUIT_SYMBOLS = {

    spades:
        '♠',

    clubs:
        '♣',

    hearts:
        '♥',

    diamonds:
        '♦',

    no_trump:
        'ბეზი'
};


/* =========================================================
   SEAT POSITIONS
========================================================= */

const SEAT_LAYOUTS = {

    2: [
        'bottom',
        'top'
    ],

    3: [
        'bottom',
        'top-left',
        'top-right'
    ],

    4: [
        'bottom',
        'left',
        'top',
        'right'
    ],

    5: [
        'bottom',
        'left',
        'top-left',
        'top-right',
        'right'
    ],

    6: [
        'bottom',
        'left',
        'top-left',
        'top',
        'top-right',
        'right'
    ]
};


/* =========================================================
   SOCKET
========================================================= */

socket.on(
    'connect',
    function() {

        myId =
            socket.id;
    }
);


socket.on(
    'errorMessage',
    function(msg) {

        alert(msg);
    }
);


socket.on(
    'playerLeft',
    function() {

        alert(
            'მოთამაშე გავიდა.'
        );

        location.reload();
    }
);


/* =========================================================
   SETUP -> TABLE LOBBY
========================================================= */

function showTablesLobby() {

    document
        .getElementById(
            'setup-form'
        )
        .classList
        .add('hidden');

    document
        .getElementById(
            'tables-lobby'
        )
        .classList
        .remove('hidden');
}


function backToSetup() {

    document
        .getElementById(
            'tables-lobby'
        )
        .classList
        .add('hidden');

    document
        .getElementById(
            'setup-form'
        )
        .classList
        .remove('hidden');
}


/* =========================================================
   JOIN TABLE
========================================================= */

function joinSelectedTable(stake) {

    const name =
        document
            .getElementById(
                'player-name'
            )
            .value
            .trim() ||
        'მოთამაშე';

    const capacity =
        document
            .getElementById(
                'player-capacity'
            )
            .value;

    const parties =
        document
            .getElementById(
                'player-parties'
            )
            .value;


    socket.emit(
        'joinTable',
        {
            name:
                name,

            capacity:
                capacity,

            parties:
                parties,

            stake:
                stake
        }
    );


    const wait =
        document.getElementById(
            'lobby-wait-msg'
        );

    wait.classList.remove(
        'hidden'
    );

    wait.innerText =
        'ველით სხვა მოთამაშეებს...';
}


/* =========================================================
   WAITING
========================================================= */

socket.on(
    'waitingForPlayers',
    function(data) {

        const wait =
            document.getElementById(
                'lobby-wait-msg'
            );

        if (wait) {

            wait.classList.remove(
                'hidden'
            );

            wait.innerText =
                'ველით მოთამაშეებს: ' +
                data.current +
                ' / ' +
                data.max;
        }
    }
);


/* =========================================================
   GAME STATE
========================================================= */

socket.on(
    'gameStateUpdate',
    function(gs) {

        document
            .getElementById(
                'lobby'
            )
            .style
            .display =
            'none';


        document
            .getElementById(
                'game-container'
            )
            .style
            .display =
            'block';


        document
            .getElementById(
                'table-stake-disp'
            )
            .innerText =
            gs.stake;


        document
            .getElementById(
                'party-num'
            )
            .innerText =
            gs.partyNum;


        document
            .getElementById(
                'target-parties'
            )
            .innerText =
            gs.targetParties;


        document
            .getElementById(
                'hand-num'
            )
            .innerText =
            gs.handIndex;


        document
            .getElementById(
                'deck-count'
            )
            .innerText =
            gs.deckCount;


        document
            .getElementById(
                'trump-display'
            )
            .innerText =
            SUIT_SYMBOLS[
                gs.trump
            ] ||
            gs.trump;


        document
            .getElementById(
                'board-trump'
            )
            .innerText =
            SUIT_SYMBOLS[
                gs.trump
            ] ||
            '';


        const meObj =
            gs.players.find(
                function(p) {

                    return p.id ===
                        myId;
                }
            );


        /*
         * TESTER
         */
        if (
            meObj &&
            meObj.isTester
        ) {

            document
                .getElementById(
                    'tester-control'
                )
                .style
                .display =
                'block';


            const select =
                document
                    .getElementById(
                        'active-player-select'
                    );


            select.innerHTML =
                '';


            gs.players.forEach(
                function(p) {

                    const opt =
                        document.createElement(
                            'option'
                        );

                    opt.value =
                        p.id;

                    opt.innerText =
                        p.name;


                    if (
                        p.id ===
                        (
                            controlledPlayerId ||
                            myId
                        )
                    ) {

                        opt.selected =
                            true;
                    }

                    select.appendChild(
                        opt
                    );
                }
            );


            if (
                !controlledPlayerId
            ) {

                controlledPlayerId =
                    myId;
            }
        }


        const activeTargetId =
            controlledPlayerId ||
            myId;


        const activePlayer =
            gs.players[
                gs.currentTurnIndex
            ];


        const isTargetTurn =
            activePlayer &&
            activePlayer.id ===
            activeTargetId &&
            !gs.isProcessing &&
            !gs.gameOver;


        /*
         * STATUS
         */
        if (gs.gameOver) {

            const winner =
                [...gs.players]
                    .sort(
                        function(a,b) {

                            return (
                                b.totalPoints -
                                a.totalPoints
                            );
                        }
                    )[0];


            document
                .getElementById(
                    'status-msg'
                )
                .innerText =
                '🏆 თამაში დასრულდა · გამარჯვებულია: ' +
                winner.name;

        } else if (
            gs.isProcessing
        ) {

            document
                .getElementById(
                    'status-msg'
                )
                .innerText =
                'ითვლება სლიკი...';

        } else if (
            isTargetTurn
        ) {

            document
                .getElementById(
                    'status-msg'
                )
                .innerText =
                '🟡 სვლა ეკუთვნის: ' +
                activePlayer.name;

        } else {

            document
                .getElementById(
                    'status-msg'
                )
                .innerText =
                (
                    activePlayer
                        ? activePlayer.name
                        : ''
                ) +
                '-ის სვლაა...';
        }


        document
            .getElementById(
                'play-btn'
            )
            .disabled =
            !isTargetTurn;


        renderSeats(gs);

        renderPlayArea(gs);


        myCards =
            gs.playersCards[
                activeTargetId
            ] ||
            [];


        selectedIndices =
            selectedIndices.filter(
                function(i) {

                    return i <
                        myCards.length;
                }
            );


        const targetPlayerObj =
            gs.players.find(
                function(p) {

                    return p.id ===
                        activeTargetId;
                }
            );


        document
            .getElementById(
                'cards-owner-title'
            )
            .innerText =
            (
                targetPlayerObj
                    ? targetPlayerObj.name
                    : 'ჩემი'
            ) +
            '-ს კარტები';


        renderMyCards();

        renderLeaderboardTable(gs);
    }
);


/* =========================================================
   PLAYER SEATS
========================================================= */

function renderSeats(gs) {

    const wrap =
        document.getElementById(
            'seats'
        );

    wrap.innerHTML =
        '';


    const layout =
        SEAT_LAYOUTS[
            gs.players.length
        ] ||
        SEAT_LAYOUTS[6];


    gs.players.forEach(
        function(p,index) {

            const seat =
                document.createElement(
                    'div'
                );

            seat.className =
                'seat ' +
                (
                    layout[index] ||
                    'top'
                );


            if (p.isCurrent) {

                seat.classList.add(
                    'active'
                );
            }


            const card =
                document.createElement(
                    'div'
                );

            card.className =
                'seat-card';


            const head =
                document.createElement(
                    'div'
                );

            head.className =
                'seat-head';


            const av =
                document.createElement(
                    'div'
                );

            av.className =
                'seat-avatar';

            av.innerText =
                (
                    p.name ||
                    '?'
                )
                .charAt(0)
                .toUpperCase();


            const nameBox =
                document.createElement(
                    'div'
                );


            nameBox.innerHTML =

                '<div class="seat-name">' +
                escapeHtml(p.name) +
                '</div>' +

                '<div class="seat-balance">' +
                Math.round(p.balance) +
                ' coins ' +

                (
                    p.isCurrent
                        ? '<span class="turn-dot"></span>'
                        : ''
                ) +

                '</div>';


            head.appendChild(
                av
            );

            head.appendChild(
                nameBox
            );

            card.appendChild(
                head
            );


            const backs =
                document.createElement(
                    'div'
                );

            backs.className =
                'opponent-cards';


            const isViewing =
                p.id ===
                (
                    controlledPlayerId ||
                    myId
                );


            const hand =
                gs.playersCards[
                    p.id
                ];


            /*
             * The controlled player's
             * actual hand is shown below
             * the table.
             */
            if (
                isViewing &&
                hand
            ) {

                // Do not duplicate hand.

            } else {

                const count =
                    Math.min(
                        p.cardCount,
                        5
                    );


                for (
                    let i = 0;
                    i < count;
                    i++
                ) {

                    const back =
                        document.createElement(
                            'div'
                        );

                    back.className =
                        'back-card';

                    backs.appendChild(
                        back
                    );
                }
            }


            card.appendChild(
                backs
            );

            seat.appendChild(
                card
            );

            wrap.appendChild(
                seat
            );
        }
    );
}


/* =========================================================
   CENTER PLAY AREA
========================================================= */

function renderPlayArea(gs) {

    const area =
        document.getElementById(
            'play-area'
        );

    area.innerHTML =
        '';


    gs.table.forEach(
        function(play) {

            const group =
                document.createElement(
                    'div'
                );

            group.className =
                'play-group ' +
                (
                    play.isWinning
                        ? 'winning-play'
                        : ''
                );


            const who =
                document.createElement(
                    'div'
                );

            who.className =
                'play-player';

            who.innerText =
                play.playerName +
                (
                    play.isWinning
                        ? ' ⭐'
                        : ''
                );


            const cards =
                document.createElement(
                    'div'
                );

            cards.className =
                'play-cards';


            play.cards.forEach(
                function(c) {

                    cards.appendChild(
                        renderCardUI(
                            c,
                            false,
                            -1
                        )
                    );
                }
            );


            group.appendChild(
                who
            );

            group.appendChild(
                cards
            );

            area.appendChild(
                group
            );
        }
    );
}


/* =========================================================
   CARD UI
========================================================= */

function renderCardUI(
    card,
    isSelectable,
    index
) {

    const div =
        document.createElement(
            'div'
        );

    div.className =
        'card suit-' +
        card.suit;


    if (
        selectedIndices.includes(
            index
        )
    ) {

        div.classList.add(
            'selected'
        );
    }


    const symbol =
        SUIT_SYMBOLS[
            card.suit
        ] ||
        '';


    div.innerHTML =

        '<div class="rank-top">' +
        card.rank +
        '</div>' +

        '<div class="suit-center">' +
        symbol +
        '</div>' +

        '<div class="rank-bottom">' +
        card.rank +
        '</div>';


    if (isSelectable) {

        div.onclick =
            function() {

                if (
                    selectedIndices.includes(
                        index
                    )
                ) {

                    selectedIndices =
                        selectedIndices.filter(
                            function(i) {

                                return i !==
                                    index;
                            }
                        );

                } else {

                    selectedIndices.push(
                        index
                    );
                }


                renderMyCards();
            };
    }


    return div;
}


/* =========================================================
   MY CARDS
========================================================= */

function renderMyCards() {

    const cardsDiv =
        document.getElementById(
            'my-cards'
        );

    cardsDiv.innerHTML =
        '';


    myCards.forEach(
        function(c,i) {

            cardsDiv.appendChild(
                renderCardUI(
                    c,
                    true,
                    i
                )
            );
        }
    );
}


/* =========================================================
   TESTER PLAYER SWITCH
========================================================= */

function switchTesterPlayer() {

    controlledPlayerId =
        document
            .getElementById(
                'active-player-select'
            )
            .value;


    selectedIndices =
        [];


    socket.emit(
        'switchControlledPlayer',
        {
            targetPlayerId:
                controlledPlayerId
        }
    );
}


/* =========================================================
   PLAY
========================================================= */

function playSelectedCards() {

    if (
        selectedIndices.length ===
        0
    ) {
        return;
    }


    socket.emit(
        'playCards',
        {

            cardIndices:
                selectedIndices,

            targetPlayerId:
                controlledPlayerId ||
                myId
        }
    );


    selectedIndices =
        [];
}


/* =========================================================
   LEADERBOARD
========================================================= */

function renderLeaderboardTable(gs) {

    const head =
        document.getElementById(
            'lb-head'
        );

    const body =
        document.getElementById(
            'lb-body'
        );


    head.innerHTML =
        '<th>ხელი</th>';


    gs.players.forEach(
        function(p) {

            const th =
                document.createElement(
                    'th'
                );

            th.innerText =
                p.name;

            head.appendChild(
                th
            );
        }
    );


    body.innerHTML =
        '';


    gs.roundHistory.forEach(
        function(row) {

            const tr =
                document.createElement(
                    'tr'
                );


            tr.innerHTML =
                '<td style="' +
                'color:#f4c542;' +
                'font-weight:900' +
                '">' +
                '#' +
                row.handIndex +
                '</td>';


            gs.players.forEach(
                function(p) {

                    const td =
                        document.createElement(
                            'td'
                        );


                    const pts =
                        row.scores[p.id] !==
                        undefined
                            ? row.scores[p.id]
                            : 0;


                    td.innerText =
                        pts === 0
                            ? '-120'
                            : pts;


                    tr.appendChild(
                        td
                    );
                }
            );


            body.appendChild(
                tr
            );
        }
    );


    const sum =
        document.createElement(
            'tr'
        );


    sum.innerHTML =
        '<td style="' +
        'color:#f4c542;' +
        'font-weight:900' +
        '">' +
        'ჯამი' +
        '</td>';


    gs.players.forEach(
        function(p) {

            const td =
                document.createElement(
                    'td'
                );

            td.innerText =
                p.totalPoints;

            td.style.fontWeight =
                '900';

            sum.appendChild(
                td
            );
        }
    );


    body.appendChild(
        sum
    );
}


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(value) {

    return String(value)
        .replace(
            /[&<>"']/g,
            function(c) {

                return {

                    '&':
                        '&amp;',

                    '<':
                        '&lt;',

                    '>':
                        '&gt;',

                    '"':
                        '&quot;',

                    "'":
                        '&#039;'

                }[c];
            }
        );
}

</script>

</body>

</html>
    `);
});


server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            'Server running on port ' +
            PORT
        );
    }
);
