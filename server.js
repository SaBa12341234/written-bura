const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;

const CAPACITIES = [3, 4];
const STAKES = [5, 10, 25, 50, 100];
const MAX_PARTIES = 4;

const CARD_VALUES = {
    '6': 0,
    '7': 0,
    '8': 0,
    '9': 0,
    J: 2,
    Q: 3,
    K: 4,
    '10': 10,
    A: 11
};

const RANKS = [
    '6',
    '7',
    '8',
    '9',
    'J',
    'Q',
    'K',
    '10',
    'A'
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

const rooms = new Map();

/* =========================================================
   HELPERS
========================================================= */

function cleanName(value) {
    return String(value || '')
        .trim()
        .slice(0, 20);
}

function isTesterName(value) {
    return cleanName(value).toLowerCase() === TESTER_NAME;
}

function makeId(prefix) {
    return (
        prefix +
        '_' +
        Date.now() +
        '_' +
        Math.floor(Math.random() * 1000000)
    );
}

/* =========================================================
   DECK
========================================================= */

function createDeck() {
    const deck = [];

    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({
                suit,
                rank,
                value: CARD_VALUES[rank]
            });
        }
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(
            Math.random() * (i + 1)
        );

        [deck[i], deck[j]] = [
            deck[j],
            deck[i]
        ];
    }

    return deck;
}

/* =========================================================
   ROOM
========================================================= */

function createRoom(
    capacity,
    parties,
    stake
) {
    const room = {
        id: makeId('room'),
        capacity,
        parties,
        stake,
        players: [],
        game: null
    };

    rooms.set(
        room.id,
        room
    );

    return room;
}

/* =========================================================
   START HAND
========================================================= */

function startHand(
    room,
    previous = null
) {
    const deck = createDeck();

    const hands = {};
    const taken = {};
    const totals = {};

    for (const player of room.players) {
        hands[player.id] =
            deck.splice(
                0,
                5
            );

        taken[player.id] = [];

        totals[player.id] =
            previous
                ? (
                    previous.totals[player.id] ||
                    0
                )
                : 0;
    }

    const handIndex =
        previous
            ? previous.handIndex + 1
            : 1;

    const leaderIndex =
        (
            previous &&
            Number.isInteger(
                previous.nextLeaderIndex
            )
        )
            ? previous.nextLeaderIndex
            : 0;

    return {
        deck,
        hands,
        taken,
        totals,

        table: [],

        handIndex,

        partyIndex:
            Math.ceil(
                handIndex / 5
            ),

        trump:
            TRUMPS[
                (
                    handIndex - 1
                ) %
                TRUMPS.length
            ],

        currentTurnIndex:
            leaderIndex,

        nextLeaderIndex:
            leaderIndex,

        leadCount:
            null,

        processing:
            false,

        gameOver:
            false,

        lastHandScores:
            previous
                ? (
                    previous.lastHandScores ||
                    {}
                )
                : {},

        history:
            previous
                ? previous.history
                : []
    };
}

/* =========================================================
   CARD RULES
========================================================= */

function rankIndex(card) {
    return RANKS.indexOf(
        card.rank
    );
}

function isTrump(
    card,
    trump
) {
    return (
        trump !== 'no_trump' &&
        card.suit === trump
    );
}

function cardBeats(
    lead,
    challenge,
    trump
) {
    const leadTrump =
        isTrump(
            lead,
            trump
        );

    const challengeTrump =
        isTrump(
            challenge,
            trump
        );

    if (
        challengeTrump &&
        !leadTrump
    ) {
        return true;
    }

    if (
        !challengeTrump &&
        leadTrump
    ) {
        return false;
    }

    if (
        lead.suit !==
        challenge.suit
    ) {
        return false;
    }

    return (
        rankIndex(
            challenge
        )
        >
        rankIndex(
            lead
        )
    );
}

function isMaliutka(cards) {
    return (
        cards.length === 5 &&
        cards.every(
            card =>
                card.suit ===
                cards[0].suit
        )
    );
}

function playBeats(
    leadPlay,
    challengePlay,
    trump
) {
    if (
        isMaliutka(
            challengePlay.cards
        )
        &&
        leadPlay.cards.length <
        5
    ) {
        return true;
    }

    if (
        leadPlay.cards.length !==
        challengePlay.cards.length
    ) {
        return false;
    }

    const leadCards =
        leadPlay.cards
            .slice()
            .sort(
                (a, b) =>
                    rankIndex(b) -
                    rankIndex(a)
            );

    const challengeCards =
        challengePlay.cards
            .slice()
            .sort(
                (a, b) =>
                    rankIndex(b) -
                    rankIndex(a)
            );

    for (
        let i = 0;
        i < leadCards.length;
        i++
    ) {
        if (
            !cardBeats(
                leadCards[i],
                challengeCards[i],
                trump
            )
        ) {
            return false;
        }
    }

    return true;
}

function winningPlayIndex(game) {
    if (
        !game.table.length
    ) {
        return -1;
    }

    let winner = 0;

    for (
        let i = 1;
        i < game.table.length;
        i++
    ) {
        if (
            playBeats(
                game.table[winner],
                game.table[i],
                game.trump
            )
        ) {
            winner = i;
        }
    }

    return winner;
}

/* =========================================================
   CLIENT STATE
========================================================= */

function clientState(
    room,
    viewerId,
    revealAll = false
) {
    const game = room.game;

    if (
        !game
    ) {
        return null;
    }

    const winnerIndex =
        winningPlayIndex(
            game
        );

    const visible = {};

    /*
        TEST MODE:
        saba123 ხედავს
        ყველა მოთამაშის კარტს
    */

    if (
        revealAll
    ) {
        for (
            const player of
            room.players
        ) {
            visible[player.id] =
                game.hands[player.id] ||
                [];
        }
    } else if (
        viewerId &&
        game.hands[viewerId]
    ) {
        visible[viewerId] =
            game.hands[viewerId];
    }

    return {
        roomId:
            room.id,

        stake:
            room.stake,

        capacity:
            room.capacity,

        parties:
            room.parties,

        totalHands:
            room.parties * 5,

        handIndex:
            game.handIndex,

        partyIndex:
            game.partyIndex,

        trump:
            game.trump,

        deckCount:
            game.deck.length,

        currentTurnIndex:
            game.currentTurnIndex,

        processing:
            game.processing,

        gameOver:
            game.gameOver,

        viewingPlayerId:
            viewerId,

        revealAll:
            !!revealAll,

        lastHandScores:
            game.lastHandScores,

        playersCards:
            visible,

        table:
            game.table.map(
                (
                    play,
                    index
                ) => ({
                    ...play,

                    isWinning:
                        index ===
                        winnerIndex
                })
            ),

        players:
            room.players.map(
                (
                    player,
                    index
                ) => ({
                    id:
                        player.id,

                    name:
                        player.name,

                    isBot:
                        player.isBot,

                    isTester:
                        player.isTester,

                    balance:
                        player.balance,

                    cardCount:
                        (
                            game.hands[
                                player.id
                            ] ||
                            []
                        ).length,

                    handPoints:
                        (
                            game.taken[
                                player.id
                            ] ||
                            []
                        ).reduce(
                            (
                                sum,
                                card
                            ) =>
                                sum +
                                card.value,
                            0
                        ),

                    totalPoints:
                        game.totals[
                            player.id
                        ] ||
                        0,

                    isCurrent:
                        index ===
                        game.currentTurnIndex
                })
            )
    };
}

/* =========================================================
   BROADCAST
========================================================= */

function broadcast(room) {
    for (
        const player of
        room.players
    ) {
        if (
            player.isBot
        ) {
            continue;
        }

        io.to(
            player.id
        ).emit(
            'gameStateUpdate',
            clientState(
                room,
                player.id,
                player.isTester
            )
        );
    }
}

/* =========================================================
   REFILL
========================================================= */

function refill(
    room,
    winnerIndex
) {
    const game =
        room.game;

    while (
        game.deck.length
    ) {
        let dealt =
            false;

        for (
            let step = 0;
            step <
            room.players.length;
            step++
        ) {
            const player =
                room.players[
                    (
                        winnerIndex +
                        step
                    ) %
                    room.players.length
                ];

            const hand =
                game.hands[
                    player.id
                ];

            if (
                hand.length < 5 &&
                game.deck.length
            ) {
                hand.push(
                    game.deck.pop()
                );

                dealt =
                    true;
            }
        }

        if (
            !dealt
        ) {
            break;
        }
    }
}

/* =========================================================
   FINISH HAND
========================================================= */

function finishHand(room) {
    const game =
        room.game;

    const scores = {};

    let minRaw =
        Infinity;

    let minIndex =
        0;

    room.players.forEach(
        (
            player,
            index
        ) => {
            const raw =
                (
                    game.taken[
                        player.id
                    ] ||
                    []
                )
                .reduce(
                    (
                        sum,
                        card
                    ) =>
                        sum +
                        card.value,
                    0
                );

            /*
                მიმდინარე სატესტო წესი:
                0 ქულა = -120
            */

            const score =
                raw === 0
                    ? -120
                    : raw;

            scores[
                player.id
            ] =
                score;

            game.totals[
                player.id
            ] =
                (
                    game.totals[
                        player.id
                    ] ||
                    0
                )
                +
                score;

            if (
                raw <
                minRaw
            ) {
                minRaw =
                    raw;

                minIndex =
                    index;
            }
        }
    );

    game.lastHandScores =
        {
            ...scores
        };

    game.history.push({
        hand:
            game.handIndex,

        scores:
            {
                ...scores
            },

        totals:
            {
                ...game.totals
            }
    });

    /*
        GAME OVER
    */

    if (
        game.handIndex >=
        room.parties * 5
    ) {
        game.gameOver =
            true;

        broadcast(
            room
        );

        return;
    }

    /*
        NEXT HAND
    */

    game.nextLeaderIndex =
        (
            minIndex + 1
        ) %
        room.players.length;

    room.game =
        startHand(
            room,
            game
        );

    room.game
        .lastHandScores =
        {
            ...scores
        };

    broadcast(
        room
    );

    scheduleBot(
        room
    );
}

/* =========================================================
   COMPLETE TRICK
========================================================= */

function completeTrick(room) {
    const game =
        room.game;

    const winnerPlayIndex =
        winningPlayIndex(
            game
        );

    const winnerPlay =
        game.table[
            winnerPlayIndex
        ];

    if (
        !winnerPlay
    ) {
        return;
    }

    const allCards =
        game.table.flatMap(
            play =>
                play.cards
        );

    game.taken[
        winnerPlay.playerId
    ].push(
        ...allCards
    );

    const winnerIndex =
        room.players.findIndex(
            player =>
                player.id ===
                winnerPlay.playerId
        );

    game.currentTurnIndex =
        winnerIndex;

    game.processing =
        true;

    broadcast(
        room
    );

    setTimeout(
        () => {
            if (
                !rooms.has(
                    room.id
                )
                ||
                room.game !==
                game
            ) {
                return;
            }

            game.table = [];

            game.leadCount =
                null;

            refill(
                room,
                winnerIndex
            );

            game.processing =
                false;

            const allEmpty =
                room.players.every(
                    player =>
                        (
                            game.hands[
                                player.id
                            ] ||
                            []
                        ).length ===
                        0
                );

            if (
                allEmpty
            ) {
                finishHand(
                    room
                );
            } else {
                broadcast(
                    room
                );

                scheduleBot(
                    room
                );
            }
        },
        950
    );
}

/* =========================================================
   BOT
========================================================= */

function botChoice(
    room,
    bot
) {
    const game =
        room.game;

    const hand =
        game.hands[
            bot.id
        ] ||
        [];

    if (
        !hand.length
    ) {
        return [];
    }

    if (
        !game.table.length
    ) {
        return [0];
    }

    const required =
        Math.min(
            game.leadCount ||
            1,
            hand.length
        );

    return Array.from(
        {
            length:
                required
        },
        (
            _,
            index
        ) =>
            index
    );
}

function scheduleBot(room) {
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
            room.game
                .currentTurnIndex
        ];

    if (
        !player ||
        !player.isBot
    ) {
        return;
    }

    setTimeout(
        () => {
            botTurn(
                room,
                player
            );
        },
        650
    );
}

function botTurn(
    room,
    bot
) {
    if (
        !rooms.has(
            room.id
        )
        ||
        !room.game
    ) {
        return;
    }

    const game =
        room.game;

    if (
        game.processing ||
        game.gameOver
    ) {
        return;
    }

    const active =
        room.players[
            game.currentTurnIndex
        ];

    if (
        !active ||
        active.id !== bot.id ||
        !active.isBot
    ) {
        return;
    }

    const hand =
        game.hands[
            bot.id
        ] ||
        [];

    const indexes =
        botChoice(
            room,
            bot
        );

    const cards =
        indexes
            .map(
                index =>
                    hand[index]
            )
            .filter(Boolean);

    if (
        !cards.length
    ) {
        return;
    }

    if (
        !game.table.length
    ) {
        game.leadCount =
            cards.length;
    }

    game.hands[
        bot.id
    ] =
        hand.filter(
            (
                _,
                index
            ) =>
                !indexes.includes(
                    index
                )
        );

    game.table.push({
        playerId:
            bot.id,

        playerName:
            bot.name,

        cards
    });

    if (
        game.table.length ===
        room.players.length
    ) {
        completeTrick(
            room
        );
    } else {
        game.currentTurnIndex =
            (
                game.currentTurnIndex +
                1
            ) %
            room.players.length;

        broadcast(
            room
        );

        scheduleBot(
            room
        );
    }
}

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    'connection',
    socket => {

        socket.on(
            'joinTable',
            data => {

                const name =
                    cleanName(
                        data &&
                        data.name
                    );

                if (
                    !name
                ) {
                    return socket.emit(
                        'errorMessage',
                        'შეიყვანე მოთამაშის სახელი.'
                    );
                }

                if (
                    socket.roomId
                ) {
                    return socket.emit(
                        'errorMessage',
                        'უკვე მაგიდაზე ხარ.'
                    );
                }

                let capacity =
                    parseInt(
                        data.capacity,
                        10
                    );

                if (
                    !CAPACITIES.includes(
                        capacity
                    )
                ) {
                    capacity = 3;
                }

                let parties =
                    parseInt(
                        data.parties,
                        10
                    );

                if (
                    !Number.isInteger(
                        parties
                    )
                ) {
                    parties = 1;
                }

                parties =
                    Math.max(
                        1,
                        Math.min(
                            MAX_PARTIES,
                            parties
                        )
                    );

                let stake =
                    Number(
                        data.stake
                    );

                if (
                    !STAKES.includes(
                        stake
                    )
                ) {
                    stake = 5;
                }

                const tester =
                    isTesterName(
                        name
                    );

                let room =
                    Array.from(
                        rooms.values()
                    )
                    .find(
                        item =>
                            !item.game
                            &&
                            item.capacity ===
                            capacity
                            &&
                            item.parties ===
                            parties
                            &&
                            item.stake ===
                            stake
                            &&
                            item.players.length <
                            item.capacity
                    );

                if (
                    !room
                ) {
                    room =
                        createRoom(
                            capacity,
                            parties,
                            stake
                        );
                }

                socket.roomId =
                    room.id;

                socket.join(
                    room.id
                );

                room.players.push({
                    id:
                        socket.id,

                    name,

                    isBot:
                        false,

                    isTester:
                        tester,

                    balance:
                        START_BALANCE
                });

                /*
                    TEST MODE:
                    saba123 -> fill bots
                */

                if (
                    tester
                ) {
                    let botNumber =
                        1;

                    while (
                        room.players.length <
                        room.capacity
                    ) {
                        const botId =
                            makeId(
                                'bot'
                            );

                        room.players.push({
                            id:
                                botId,

                            name:
                                'BOT ' +
                                botNumber,

                            isBot:
                                true,

                            isTester:
                                false,

                            balance:
                                START_BALANCE
                        });

                        botNumber++;
                    }
                }

                if (
                    room.players.length ===
                    room.capacity
                ) {
                    room.game =
                        startHand(
                            room,
                            null
                        );

                    broadcast(
                        room
                    );

                    scheduleBot(
                        room
                    );
                } else {
                    io.to(
                        room.id
                    ).emit(
                        'waitingForPlayers',
                        {
                            current:
                                room.players.length,

                            max:
                                room.capacity,

                            stake:
                                room.stake
                        }
                    );
                }
            }
        );

        /* =================================================
           PLAY CARDS
        ================================================= */

        socket.on(
            'playCards',
            data => {

                const room =
                    socket.roomId
                        ? rooms.get(
                            socket.roomId
                        )
                        : null;

                if (
                    !room ||
                    !room.game
                ) {
                    return;
                }

                const game =
                    room.game;

                if (
                    game.processing ||
                    game.gameOver
                ) {
                    return;
                }

                const active =
                    room.players[
                        game.currentTurnIndex
                    ];

                if (
                    !active ||
                    active.id !==
                    socket.id
                ) {
                    return socket.emit(
                        'errorMessage',
                        'ახლა შენი სვლა არ არის.'
                    );
                }

                const hand =
                    game.hands[
                        socket.id
                    ] ||
                    [];

                let indexes =
                    Array.isArray(
                        data &&
                        data.cardIndices
                    )
                        ? [
                            ...new Set(
                                data.cardIndices
                            )
                        ]
                        : [];

                indexes =
                    indexes.filter(
                        index =>
                            Number.isInteger(
                                index
                            )
                            &&
                            index >= 0
                            &&
                            index <
                            hand.length
                    );

                if (
                    !indexes.length
                ) {
                    return socket.emit(
                        'errorMessage',
                        'აირჩიე კარტი.'
                    );
                }

                const cards =
                    indexes.map(
                        index =>
                            hand[
                                index
                            ]
                    );

                /*
                    FIRST PLAY
                */

                if (
                    !game.table.length
                ) {
                    const sameSuit =
                        cards.every(
                            card =>
                                card.suit ===
                                cards[
                                    0
                                ].suit
                        );

                    if (
                        !sameSuit
                    ) {
                        return socket.emit(
                            'errorMessage',
                            'პირველი ჩამოსვლა ერთი ცვეტის კარტებით უნდა იყოს.'
                        );
                    }

                    game.leadCount =
                        cards.length;
                } else {
                    const required =
                        Math.min(
                            game.leadCount ||
                            1,
                            hand.length
                        );

                    if (
                        !isMaliutka(
                            cards
                        )
                        &&
                        cards.length !==
                        required
                    ) {
                        return socket.emit(
                            'errorMessage',
                            'უნდა ჩამოხვიდე ' +
                            required +
                            ' კარტი ან მალიუტკა.'
                        );
                    }
                }

                game.hands[
                    socket.id
                ] =
                    hand.filter(
                        (
                            _,
                            index
                        ) =>
                            !indexes.includes(
                                index
                            )
                    );

                game.table.push({
                    playerId:
                        socket.id,

                    playerName:
                        active.name,

                    cards
                });

                if (
                    game.table.length ===
                    room.players.length
                ) {
                    completeTrick(
                        room
                    );
                } else {
                    game.currentTurnIndex =
                        (
                            game.currentTurnIndex +
                            1
                        ) %
                        room.players.length;

                    broadcast(
                        room
                    );

                    scheduleBot(
                        room
                    );
                }
            }
        );

        socket.on(
            'disconnect',
            () => {

                const room =
                    socket.roomId
                        ? rooms.get(
                            socket.roomId
                        )
                        : null;

                if (
                    !room
                ) {
                    return;
                }

                room.players =
                    room.players.filter(
                        player =>
                            player.id !==
                            socket.id
                    );

                const humans =
                    room.players.filter(
                        player =>
                            !player.isBot
                    );

                if (
                    humans.length ===
                    0
                ) {
                    rooms.delete(
                        room.id
                    );
                } else {
                    io.to(
                        room.id
                    ).emit(
                        'errorMessage',
                        'ერთ-ერთმა მოთამაშემ დატოვა მაგიდა.'
                    );
                }
            }
        );
    }
);

/* =========================================================
   FRONTEND
========================================================= */

const PAGE =
String.raw`
<!doctype html>

<html lang="ka">

<head>

<meta charset="utf-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1,viewport-fit=cover"
>

<title>
    Written Bura
</title>

<script src="/socket.io/socket.io.js"></script>

<style>

@import url(
'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Georgian:wght@400;500;600;700;800&display=swap'
);

* {
    box-sizing:
        border-box;
}

html,
body {

    margin:
        0;

    min-height:
        100%;

    font-family:
        'Noto Sans Georgian',
        Inter,
        sans-serif;

    background:
        #07100e;

    color:
        #eef7f2;
}

button,
input,
select {

    font:
        inherit;
}

.hidden {

    display:
        none !important;
}

:root {

    --bg:
        #07100e;

    --glass:
        rgba(16,28,25,.72);

    --glass2:
        rgba(11,20,18,.88);

    --line:
        rgba(255,255,255,.10);

    --gold:
        #e9c46a;

    --gold2:
        #ffdc86;

    --green:
        #34d399;

    --green2:
        #10b981;

    --text:
        #f4fbf7;

    --muted:
        #9fb2aa;

    --danger:
        #ff6b6b;

    --wood:
        #5f3b25;

    --felt:
        #0f5d46;

    --felt2:
        #0b3e32;
}

body {

    background:

        radial-gradient(
            circle at 50% -10%,
            rgba(52,211,153,.16),
            transparent 36%
        ),

        radial-gradient(
            circle at 100% 10%,
            rgba(233,196,106,.12),
            transparent 28%
        ),

        linear-gradient(
            160deg,
            #050a09,
            #091412 52%,
            #07100e
        );

    overflow-x:
        hidden;
}

.glass {

    background:
        linear-gradient(
            145deg,
            rgba(255,255,255,.06),
            rgba(255,255,255,.02)
        );

    border:
        1px solid
        var(--line);

    box-shadow:
        0 20px 60px
        rgba(0,0,0,.28);

    backdrop-filter:
        blur(18px);

    -webkit-backdrop-filter:
        blur(18px);
}

/* =========================================================
   LOBBY
========================================================= */

#lobby {

    min-height:
        100vh;

    padding:
        24px;
}

.shell {

    width:
        min(1160px,100%);

    margin:
        auto;
}

.top {

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    gap:
        16px;

    margin-bottom:
        24px;
}

.brand {

    font-size:
        24px;

    font-weight:
        800;

    letter-spacing:
        .3px;
}

.brand span {

    color:
        var(--gold);
}

.testerHint {

    font-size:
        12px;

    color:
        var(--muted);
}

.hero {

    display:
        grid;

    grid-template-columns:
        1.2fr .8fr;

    gap:
        18px;
}

.heroCard,
.joinCard {

    border-radius:
        24px;

    padding:
        28px;
}

.heroCard {

    min-height:
        330px;

    position:
        relative;

    overflow:
        hidden;
}

.heroCard:after {

    content:
        "♠  ♣  ♦  ♥";

    position:
        absolute;

    right:
        28px;

    bottom:
        28px;

    font-size:
        64px;

    color:
        rgba(255,255,255,.06);

    transform:
        rotate(-6deg);
}

.eyebrow {

    display:
        inline-flex;

    padding:
        7px 11px;

    border-radius:
        999px;

    background:
        rgba(52,211,153,.10);

    border:
        1px solid
        rgba(52,211,153,.24);

    color:
        #86efc2;

    font-size:
        11px;

    font-weight:
        700;
}

.heroCard h1 {

    font-size:
        46px;

    line-height:
        1.05;

    margin:
        20px 0 12px;

    max-width:
        640px;
}

.heroCard p {

    max-width:
        620px;

    color:
        var(--muted);

    line-height:
        1.7;

    font-size:
        14px;
}

.features {

    display:
        flex;

    flex-wrap:
        wrap;

    gap:
        8px;

    margin-top:
        18px;
}

.chip {

    padding:
        7px 10px;

    border-radius:
        999px;

    background:
        rgba(255,255,255,.05);

    border:
        1px solid
        var(--line);

    font-size:
        11px;

    color:
        #cfe0d8;
}

.joinCard h2 {

    margin:
        0 0 18px;

    font-size:
        22px;
}

.field {

    margin:
        12px 0;
}

.field label {

    display:
        block;

    margin-bottom:
        7px;

    color:
        #b9cbc3;

    font-size:
        11px;

    font-weight:
        700;
}

.field input,
.field select {

    width:
        100%;

    height:
        44px;

    border-radius:
        12px;

    border:
        1px solid
        var(--line);

    background:
        rgba(3,9,8,.65);

    color:
        var(--text);

    padding:
        0 12px;

    outline:
        none;
}

.field input:focus,
.field select:focus {

    border-color:
        rgba(52,211,153,.65);

    box-shadow:
        0 0 0 4px
        rgba(52,211,153,.08);
}

.row2 {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        10px;
}

.primary {

    width:
        100%;

    height:
        46px;

    border:
        0;

    border-radius:
        13px;

    background:
        linear-gradient(
            135deg,
            var(--green),
            var(--green2)
        );

    color:
        #04271b;

    font-weight:
        800;

    box-shadow:
        0 14px 28px
        rgba(16,185,129,.24);

    cursor:
        pointer;

    transition:
        .18s;
}

.primary:hover {

    transform:
        translateY(-1px);

    filter:
        brightness(1.05);
}

.wait {

    min-height:
        20px;

    margin-top:
        10px;

    color:
        var(--gold2);

    font-size:
        12px;
}

.stakes {

    display:
        grid;

    grid-template-columns:
        repeat(5,1fr);

    gap:
        10px;

    margin-top:
        18px;
}

.stake {

    padding:
        16px;

    border-radius:
        16px;

    border:
        1px solid
        var(--line);

    background:
        rgba(255,255,255,.035);

    color:
        var(--muted);

    cursor:
        pointer;

    transition:
        .18s;
}

.stake:hover,
.stake.active {

    border-color:
        rgba(233,196,106,.55);

    background:
        rgba(233,196,106,.08);

    color:
        var(--gold2);

    transform:
        translateY(-2px);
}

.stake b {

    display:
        block;

    font-size:
        20px;

    color:
        inherit;
}

.stake span {

    font-size:
        10px;
}

/* =========================================================
   GAME TOP
========================================================= */

#game {

    display:
        none;

    min-height:
        100vh;

    padding:
        14px;
}

.gameShell {

    width:
        min(1500px,100%);

    margin:
        auto;
}

.gameTop {

    display:
        grid;

    grid-template-columns:
        1fr auto auto;

    gap:
        12px;

    align-items:
        center;

    margin-bottom:
        10px;
}

.titleBlock {

    padding:
        14px 16px;

    border-radius:
        16px;
}

.titleBlock b {

    font-size:
        18px;
}

.titleBlock span {

    display:
        block;

    color:
        var(--muted);

    font-size:
        11px;

    margin-top:
        2px;
}

.hud {

    display:
        flex;

    gap:
        8px;

    flex-wrap:
        wrap;

    justify-content:
        flex-end;
}

.hudBox {

    min-width:
        84px;

    padding:
        10px 12px;

    border-radius:
        14px;

    text-align:
        center;
}

.hudBox small {

    display:
        block;

    color:
        var(--muted);

    font-size:
        9px;
}

.hudBox b {

    display:
        block;

    color:
        var(--gold2);

    font-size:
        14px;

    margin-top:
        2px;
}

.sfxBtn,
.exitBtn {

    height:
        42px;

    padding:
        0 14px;

    border-radius:
        12px;

    border:
        1px solid
        var(--line);

    background:
        rgba(255,255,255,.05);

    color:
        var(--text);

    cursor:
        pointer;
}

.status {

    text-align:
        center;

    min-height:
        28px;

    color:
        var(--gold2);

    font-weight:
        800;

    font-size:
        13px;
}

/* =========================================================
   GAME LAYOUT
========================================================= */

.layout {

    display:
        grid;

    grid-template-columns:
        minmax(0,1fr)
        300px;

    gap:
        14px;
}

.tableStage {

    position:
        relative;

    height:
        700px;

    border-radius:
        28px;

    overflow:
        hidden;

    background:

        radial-gradient(
            circle at 50% 20%,
            rgba(255,255,255,.05),
            transparent 25%
        ),

        linear-gradient(
            145deg,
            #17110d,
            #0a0c0b
        );

    border:
        1px solid
        var(--line);

    box-shadow:
        0 28px 90px
        rgba(0,0,0,.46);
}

.tableWood {

    position:
        absolute;

    inset:
        45px 70px 80px;

    border-radius:
        50% / 38%;

    background:
        linear-gradient(
            145deg,
            #8b5a36,
            #4f2e1d 62%,
            #2f1b12
        );

    box-shadow:

        inset 0 0 0 14px
        rgba(45,24,14,.65),

        inset 0 0 70px
        rgba(0,0,0,.45),

        0 25px 45px
        rgba(0,0,0,.38);
}

.felt {

    position:
        absolute;

    inset:
        82px 110px 118px;

    border-radius:
        50% / 38%;

    background:
        radial-gradient(
            ellipse at center,
            var(--felt),
            var(--felt2) 72%
        );

    border:
        3px solid
        rgba(255,255,255,.07);

    box-shadow:
        inset 0 0 55px
        rgba(0,0,0,.38);
}

.felt:after {

    content:
        "WRITTEN BURA";

    position:
        absolute;

    left:
        50%;

    top:
        50%;

    transform:
        translate(-50%,-50%);

    font-weight:
        800;

    letter-spacing:
        8px;

    color:
        rgba(255,255,255,.05);

    white-space:
        nowrap;
}

/* =========================================================
   DECK + TRUMP
========================================================= */

.deckZone {

    position:
        absolute;

    left:
        50%;

    top:
        45%;

    transform:
        translate(-50%,-50%);

    display:
        flex;

    gap:
        18px;

    align-items:
        center;

    z-index:
        4;
}

.deckStack {

    width:
        58px;

    height:
        82px;

    border-radius:
        7px;

    border:
        2px solid
        rgba(255,255,255,.8);

    background:
        repeating-linear-gradient(
            45deg,
            #24384d 0 4px,
            #152335 4px 8px
        );

    box-shadow:

        5px 5px 0
        rgba(255,255,255,.16),

        0 8px 20px
        rgba(0,0,0,.35);
}

.deckLabel {

    text-align:
        center;

    font-size:
        10px;

    color:
        #d7e7df;

    margin-top:
        4px;
}

.trumpSlot {

    width:
        58px;

    height:
        82px;
}

/* =========================================================
   TABLE CARDS
========================================================= */

.tableCards {

    position:
        absolute;

    left:
        50%;

    top:
        56%;

    transform:
        translate(-50%,-50%);

    z-index:
        6;

    display:
        flex;

    gap:
        10px;

    align-items:
        center;

    justify-content:
        center;

    max-width:
        62%;
}

.playGroup {

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;
}

.playName {

    font-size:
        8px;

    padding:
        3px 7px;

    border-radius:
        999px;

    background:
        rgba(0,0,0,.38);

    margin-bottom:
        4px;
}

.playGroup.winner
.card {

    box-shadow:
        0 0 28px
        rgba(255,220,134,.95);

    border-color:
        var(--gold2);
}

/* =========================================================
   PLAYERS
========================================================= */

.seat {

    position:
        absolute;

    transform:
        translate(-50%,-50%);

    width:
        160px;

    text-align:
        center;

    z-index:
        8;
}

.seatBox {

    padding:
        8px;

    border-radius:
        16px;

    background:
        rgba(7,13,11,.80);

    border:
        1px solid
        var(--line);

    backdrop-filter:
        blur(10px);

    transition:
        .2s;
}

.avatar {

    width:
        54px;

    height:
        54px;

    border-radius:
        50%;

    margin:
        auto;

    background:
        radial-gradient(
            circle at 40% 30%,
            #d6b79f,
            #8c6048 48%,
            #2b1d17 49%
        );

    border:
        3px solid
        rgba(233,196,106,.65);

    box-shadow:
        0 8px 20px
        rgba(0,0,0,.35);
}

.seat.current
.seatBox {

    border-color:
        var(--gold2);

    box-shadow:

        0 0 0 3px
        rgba(233,196,106,.10),

        0 0 26px
        rgba(233,196,106,.28);
}

.seat.current
.avatar {

    animation:
        pulseRing
        1.35s
        infinite;
}

.seatName {

    margin-top:
        5px;

    font-size:
        11px;

    font-weight:
        800;
}

.seatInfo {

    margin-top:
        2px;

    font-size:
        9px;

    color:
        var(--muted);
}

.backs {

    display:
        flex;

    justify-content:
        center;

    margin-top:
        5px;
}

.back {

    width:
        17px;

    height:
        25px;

    margin-left:
        -6px;

    border-radius:
        3px;

    border:
        1px solid
        rgba(255,255,255,.65);

    background:
        repeating-linear-gradient(
            45deg,
            #25384d 0 3px,
            #132133 3px 6px
        );
}

.back:first-child {

    margin-left:
        0;
}

.turnBar {

    height:
        3px;

    border-radius:
        99px;

    background:
        rgba(255,255,255,.08);

    overflow:
        hidden;

    margin-top:
        6px;
}

.seat.current
.turnBar:after {

    content:
        "";

    display:
        block;

    height:
        100%;

    background:
        linear-gradient(
            90deg,
            var(--green),
            var(--gold)
        );

    animation:
        turnTimer
        7s
        linear
        infinite;
}

/* =========================================================
   HAND
========================================================= */

.handZone {

    position:
        absolute;

    left:
        50%;

    bottom:
        18px;

    transform:
        translateX(-50%);

    z-index:
        10;

    width:
        min(820px,94%);

    text-align:
        center;
}

.hand {

    position:
        relative;

    height:
        130px;

    display:
        flex;

    justify-content:
        center;

    align-items:
        flex-end;
}

.hand
.card {

    position:
        relative;

    margin-left:
        -18px;

    transform-origin:
        50% 110%;

    transition:

        transform .2s ease,

        filter .2s ease,

        box-shadow .2s ease;
}

.hand
.card:first-child {

    margin-left:
        0;
}

.hand
.card:hover {

    transform:
        translateY(-18px)
        scale(1.05) !important;

    z-index:
        50;
}

.hand
.card.selected {

    transform:
        translateY(-26px)
        scale(1.06) !important;

    box-shadow:

        0 0 0 3px
        rgba(52,211,153,.6),

        0 16px 30px
        rgba(0,0,0,.35);

    z-index:
        60;
}

.playBtn {

    margin-top:
        6px;

    min-width:
        190px;

    height:
        44px;

    border:
        0;

    border-radius:
        999px;

    background:
        linear-gradient(
            135deg,
            var(--green),
            var(--green2)
        );

    color:
        #02261a;

    font-weight:
        800;

    cursor:
        pointer;

    box-shadow:
        0 12px 28px
        rgba(16,185,129,.25);
}

.playBtn:disabled {

    background:
        #2b3431;

    color:
        #72837d;

    box-shadow:
        none;

    cursor:
        not-allowed;
}

/* =========================================================
   CARDS
========================================================= */

.card {

    width:
        70px;

    height:
        102px;

    border-radius:
        10px;

    padding:
        6px;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        space-between;

    font-weight:
        900;

    background:
        #fff;

    box-shadow:
        0 8px 22px
        rgba(0,0,0,.38);

    border:
        1px solid
        rgba(0,0,0,.18);

    user-select:
        none;

    touch-action:
        none;
}

.cardTop,
.cardBottom {

    display:
        flex;

    align-items:
        center;

    gap:
        3px;

    font-size:
        13px;

    line-height:
        1;
}

.cardCenter {

    font-size:
        34px;

    text-align:
        center;

    line-height:
        1;
}

.cardBottom {

    transform:
        rotate(180deg);
}

/* ♠ */

.suit-spades {

    color:
        #0a0a0a;
}

/* ♣ */

.suit-clubs {

    color:
        #007a58;

    background:
        linear-gradient(
            #fff,
            #f0fbf6
        );
}

/* ♦ */

.suit-diamonds {

    color:
        #0a2a66;

    background:
        linear-gradient(
            #fff,
            #f1f5ff
        );
}

/* ♥ */

.suit-hearts {

    color:
        #74152c;

    background:
        linear-gradient(
            #fff,
            #fff2f5
        );
}

/* =========================================================
   ANIMATIONS
========================================================= */

@keyframes cardFly {

    0% {

        opacity:
            0;

        transform:
            translateY(70px)
            scale(.72)
            rotate(-10deg);
    }

    60% {

        opacity:
            1;

        transform:
            translateY(-8px)
            scale(1.06)
            rotate(2deg);
    }

    100% {

        transform:
            translateY(0)
            scale(1)
            rotate(0);
    }
}

.playGroup
.card {

    animation:
        cardFly
        .48s
        cubic-bezier(
            .2,
            .8,
            .2,
            1
        );
}

@keyframes pulseRing {

    0%,
    100% {

        box-shadow:
            0 0 0 0
            rgba(233,196,106,.4);
    }

    50% {

        box-shadow:
            0 0 0 10px
            rgba(233,196,106,0);
    }
}

@keyframes turnTimer {

    from {

        width:
            100%;
    }

    to {

        width:
            0%;
    }
}

/* =========================================================
   SCOREBOARD
========================================================= */

.scorePanel {

    border-radius:
        20px;

    padding:
        14px;

    height:
        fit-content;

    position:
        sticky;

    top:
        14px;
}

.scoreHead {

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    margin-bottom:
        10px;
}

.scoreHead b {

    font-size:
        15px;
}

.scoreHead span {

    font-size:
        10px;

    color:
        var(--muted);
}

.scoreRow {

    display:
        grid;

    grid-template-columns:
        42px 1fr 64px 64px;

    align-items:
        center;

    gap:
        6px;

    padding:
        10px 6px;

    border-top:
        1px solid
        var(--line);

    font-size:
        10px;
}

.scoreRow:first-child {

    border-top:
        0;
}

.scoreRow
.name {

    font-weight:
        700;
}

.scoreRow
.last {

    color:
        #a9b9b2;

    text-align:
        right;
}

.scoreRow
.total {

    text-align:
        right;

    color:
        var(--gold2);

    font-weight:
        800;

    font-size:
        13px;
}

.scoreRow.first {

    background:
        rgba(233,196,106,.06);

    border-radius:
        10px;
}

/* =========================================================
   TESTER PANEL
========================================================= */

.testerPanel {

    margin-top:
        12px;

    border-radius:
        16px;

    padding:
        12px;

    display:
        none;
}

.testerPanel.show {

    display:
        block;
}

.testerGrid {

    display:
        grid;

    grid-template-columns:
        1fr;

    gap:
        8px;

    margin-top:
        8px;
}

.testerHand {

    padding:
        8px;

    border-radius:
        10px;

    background:
        rgba(255,255,255,.04);

    border:
        1px solid
        var(--line);
}

.mini {

    display:
        flex;

    gap:
        4px;

    flex-wrap:
        wrap;

    margin-top:
        5px;
}

.mini span {

    padding:
        3px 6px;

    border-radius:
        6px;

    background:
        #edf4f0;

    color:
        #142019;

    font-size:
        10px;
}

/* =========================================================
   DRAG
========================================================= */

.dragGhost {

    position:
        fixed;

    pointer-events:
        none;

    z-index:
        9999;

    transform:
        translate(-50%,-50%)
        scale(1.05);

    filter:
        drop-shadow(
            0 14px 28px
            rgba(0,0,0,.45)
        );

    opacity:
        .94;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(
    max-width:1100px
) {

    .layout {

        grid-template-columns:
            1fr;
    }

    .scorePanel {

        position:
            static;
    }

    .tableStage {

        height:
            650px;
    }

    .testerGrid {

        grid-template-columns:
            repeat(2,1fr);
    }
}

@media(
    max-width:800px
) {

    #lobby {

        padding:
            14px;
    }

    .hero {

        grid-template-columns:
            1fr;
    }

    .heroCard h1 {

        font-size:
            36px;
    }

    .stakes {

        grid-template-columns:
            repeat(3,1fr);
    }

    .gameTop {

        grid-template-columns:
            1fr;
    }

    .hud {

        justify-content:
            flex-start;
    }

    .tableStage {

        height:
            590px;
    }

    .tableWood {

        inset:
            40px 25px 70px;
    }

    .felt {

        inset:
            78px 55px 115px;
    }

    .seat {

        width:
            120px;
    }

    .avatar {

        width:
            44px;

        height:
            44px;
    }

    .card {

        width:
            58px;

        height:
            86px;
    }

    .cardCenter {

        font-size:
            28px;
    }

    .tableCards {

        max-width:
            72%;
    }

    .hand {

        height:
            118px;
    }
}

@media(
    max-width:520px
) {

    .heroCard,
    .joinCard {

        padding:
            20px;
    }

    .heroCard h1 {

        font-size:
            30px;
    }

    .row2 {

        grid-template-columns:
            1fr;
    }

    .stakes {

        grid-template-columns:
            1fr 1fr;
    }

    .tableStage {

        height:
            540px;

        border-radius:
            18px;
    }

    .tableWood {

        inset:
            32px 8px 66px;
    }

    .felt {

        inset:
            72px 28px 120px;
    }

    .seat {

        width:
            96px;
    }

    .seatName {

        font-size:
            9px;
    }

    .seatInfo {

        font-size:
            7px;
    }

    .avatar {

        width:
            38px;

        height:
            38px;
    }

    .tableCards {

        top:
            54%;

        max-width:
            78%;

        gap:
            5px;
    }

    .card {

        width:
            50px;

        height:
            74px;

        padding:
            4px;
    }

    .cardCenter {

        font-size:
            22px;
    }

    .cardTop,
    .cardBottom {

        font-size:
            10px;
    }

    .handZone {

        bottom:
            8px;
    }

    .hand {

        height:
            100px;
    }

    .hand
    .card {

        margin-left:
            -16px;
    }

    .deckZone {

        top:
            43%;

        gap:
            10px;
    }

    .deckStack,
    .trumpSlot {

        width:
            48px;

        height:
            68px;
    }

    .testerGrid {

        grid-template-columns:
            1fr;
    }
}

</style>

</head>

<body>

<!-- ======================================================
     LOBBY
======================================================= -->

<section id="lobby">

    <div class="shell">

        <div class="top">

            <div class="brand">

                WRITTEN

                <span>
                    BURA
                </span>

            </div>

            <div class="testerHint">

                TEST MODE:

                <b>
                    saba123
                </b>

                — პაროლი/რეგისტრაცია არ სჭირდება

            </div>

        </div>

        <div class="hero">

            <div class="heroCard glass">

                <div class="eyebrow">
                    LIVE CARD ROOM
                </div>

                <h1>
                    კლასიკური ბურა თანამედროვე სათამაშო მაგიდაზე
                </h1>

                <p>

                    შეიყვანე სახელი, აირჩიე 3 ან 4 მოთამაშე,
                    1–4 პარტია და ფსონი.

                    ჩვეულებრივი მოთამაშე დაელოდება სხვებს,
                    ხოლო

                    <b>
                        saba123
                    </b>

                    TEST MODE-ში მაგიდა ავტომატურად შეივსება ბოტებით.

                </p>

                <div class="features">

                    <span class="chip">
                        36 კარტი
                    </span>

                    <span class="chip">
                        3 / 4 მოთამაშე
                    </span>

                    <span class="chip">
                        Live Score
                    </span>

                    <span class="chip">
                        Drag & Drop
                    </span>

                    <span class="chip">
                        SFX
                    </span>

                </div>

            </div>

            <div class="joinCard glass">

                <h2>
                    მაგიდაზე შესვლა
                </h2>

                <div class="field">

                    <label>
                        მოთამაშის სახელი
                    </label>

                    <input
                        id="playerName"
                        value="saba123"
                        maxlength="20"
                        autocomplete="off"
                    >

                </div>

                <div class="row2">

                    <div class="field">

                        <label>
                            მოთამაშეები
                        </label>

                        <select id="capacity">

                            <option value="3">
                                3 მოთამაშე
                            </option>

                            <option value="4">
                                4 მოთამაშე
                            </option>

                        </select>

                    </div>

                    <div class="field">

                        <label>
                            პარტიები
                        </label>

                        <select id="parties">

                            <option value="1">
                                1 პარტია
                            </option>

                            <option value="2">
                                2 პარტია
                            </option>

                            <option value="3">
                                3 პარტია
                            </option>

                            <option value="4">
                                4 პარტია
                            </option>

                        </select>

                    </div>

                </div>

                <input
                    type="hidden"
                    id="stake"
                    value="5"
                >

                <button
                    class="primary"
                    onclick="joinGame()"
                >
                    თამაშში შესვლა
                </button>

                <div
                    id="wait"
                    class="wait"
                ></div>

            </div>

        </div>

        <div class="stakes">

            <button
                class="stake active"
                onclick="chooseStake(5,this)"
            >

                <b>
                    $5
                </b>

                <span>
                    CLASSIC
                </span>

            </button>

            <button
                class="stake"
                onclick="chooseStake(10,this)"
            >

                <b>
                    $10
                </b>

                <span>
                    STANDARD
                </span>

            </button>

            <button
                class="stake"
                onclick="chooseStake(25,this)"
            >

                <b>
                    $25
                </b>

                <span>
                    PREMIUM
                </span>

            </button>

            <button
                class="stake"
                onclick="chooseStake(50,this)"
            >

                <b>
                    $50
                </b>

                <span>
                    VIP
                </span>

            </button>

            <button
                class="stake"
                onclick="chooseStake(100,this)"
            >

                <b>
                    $100
                </b>

                <span>
                    ELITE
                </span>

            </button>

        </div>

    </div>

</section>

<!-- ======================================================
     GAME
======================================================= -->

<section id="game">

    <div class="gameShell">

        <div class="gameTop">

            <div class="titleBlock glass">

                <b>
                    WRITTEN BURA
                </b>

                <span id="tableSub">
                    Live table
                </span>

            </div>

            <div class="hud">

                <div class="hudBox glass">

                    <small>
                        პარტია
                    </small>

                    <b id="hudParty">
                        -
                    </b>

                </div>

                <div class="hudBox glass">

                    <small>
                        ხელი
                    </small>

                    <b id="hudHand">
                        -
                    </b>

                </div>

                <div class="hudBox glass">

                    <small>
                        კოზირი
                    </small>

                    <b id="hudTrump">
                        -
                    </b>

                </div>

                <div class="hudBox glass">

                    <small>
                        დასტა
                    </small>

                    <b id="hudDeck">
                        -
                    </b>

                </div>

                <div class="hudBox glass">

                    <small>
                        ფსონი
                    </small>

                    <b id="hudStake">
                        -
                    </b>

                </div>

            </div>

            <div>

                <button
                    id="sfxBtn"
                    class="sfxBtn"
                    onclick="toggleSfx()"
                >
                    🔊 SFX
                </button>

                <button
                    class="exitBtn"
                    onclick="location.reload()"
                >
                    გასვლა
                </button>

            </div>

        </div>

        <div
            id="status"
            class="status"
        ></div>

        <div class="layout">

            <div>

                <div class="tableStage">

                    <div class="tableWood"></div>

                    <div class="felt"></div>

                    <div class="deckZone">

                        <div>

                            <div class="deckStack"></div>

                            <div class="deckLabel">

                                Deck

                                <span id="centerDeck">
                                    36
                                </span>

                            </div>

                        </div>

                        <div>

                            <div
                                id="trumpSlot"
                                class="trumpSlot"
                            ></div>

                            <div class="deckLabel">
                                კოზირი
                            </div>

                        </div>

                    </div>

                    <div id="players"></div>

                    <div
                        id="tableCards"
                        class="tableCards"
                    ></div>

                    <div class="handZone">

                        <div
                            id="myCards"
                            class="hand"
                        ></div>

                        <button
                            id="playBtn"
                            class="playBtn"
                            disabled
                            onclick="playSelected()"
                        >
                            სვლის გაკეთება
                        </button>

                    </div>

                </div>

            </div>

            <aside>

                <div class="scorePanel glass">

                    <div class="scoreHead">

                        <b>
                            🏆 LIVE SCORE
                        </b>

                        <span>
                            ხელის ბოლოს განახლდება
                        </span>

                    </div>

                    <div id="score"></div>

                </div>

                <div
                    id="testerPanel"
                    class="testerPanel glass"
                >

                    <b>
                        🧪 TEST MODE — ყველა მოთამაშის კარტი
                    </b>

                    <div
                        id="testerGrid"
                        class="testerGrid"
                    ></div>

                </div>

            </aside>

        </div>

    </div>

</section>

<script>

const socket =
    io();

let current =
    null;

let selected =
    [];

let sfxEnabled =
    true;

let dragIndex =
    null;

let dragGhost =
    null;

/* =========================================================
   LOBBY
========================================================= */

function chooseStake(
    value,
    element
) {

    document
        .getElementById(
            'stake'
        )
        .value =
            value;

    document
        .querySelectorAll(
            '.stake'
        )
        .forEach(
            item =>
                item
                    .classList
                    .remove(
                        'active'
                    )
        );

    element
        .classList
        .add(
            'active'
        );
}

function joinGame() {

    const name =
        document
            .getElementById(
                'playerName'
            )
            .value
            .trim();

    if (
        !name
    ) {

        alert(
            'შეიყვანე მოთამაშის სახელი'
        );

        return;
    }

    document
        .getElementById(
            'wait'
        )
        .textContent =
            name.toLowerCase() ===
            'saba123'
                ?
                'TEST მაგიდა მზადდება...'
                :
                'ვეძებთ მოთამაშეებს...';

    socket.emit(
        'joinTable',
        {

            name,

            capacity:
                document
                    .getElementById(
                        'capacity'
                    )
                    .value,

            parties:
                document
                    .getElementById(
                        'parties'
                    )
                    .value,

            stake:
                Number(
                    document
                        .getElementById(
                            'stake'
                        )
                        .value
                )
        }
    );
}

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
    'waitingForPlayers',
    data => {

        document
            .getElementById(
                'wait'
            )
            .textContent =
                'ველოდებით მოთამაშეებს: '
                +
                data.current
                +
                ' / '
                +
                data.max;
    }
);

socket.on(
    'errorMessage',
    message => {

        alert(
            message
        );

        const status =
            document
                .getElementById(
                    'status'
                );

        if (
            status
        ) {

            status.textContent =
                message;
        }
    }
);

socket.on(
    'gameStateUpdate',
    state => {

        current =
            state;

        selected =
            [];

        document
            .getElementById(
                'lobby'
            )
            .style
            .display =
                'none';

        document
            .getElementById(
                'game'
            )
            .style
            .display =
                'block';

        render(
            state
        );

        if (
            state.processing
        ) {

            playSfx(
                'take'
            );
        }
    }
);

/* =========================================================
   HELPERS
========================================================= */

function suitSymbol(
    suit
) {

    return {

        spades:
            '♠',

        clubs:
            '♣',

        diamonds:
            '♦',

        hearts:
            '♥'

    }[
        suit
    ] ||
    '';
}

function trumpText(
    trump
) {

    return (
        trump ===
        'no_trump'
            ?
            'უკოზირო'
            :
            suitSymbol(
                trump
            )
    );
}

function escapeHtml(
    value
) {

    return String(
        value == null
            ?
            ''
            :
            value
    )
        .replace(
            /&/g,
            '&amp;'
        )
        .replace(
            /</g,
            '&lt;'
        )
        .replace(
            />/g,
            '&gt;'
        )
        .replace(
            /"/g,
            '&quot;'
        )
        .replace(
            /'/g,
            '&#039;'
        );
}

/* =========================================================
   CARD
========================================================= */

function cardElement(
    card
) {

    const element =
        document
            .createElement(
                'div'
            );

    element.className =
        'card suit-'
        +
        card.suit;

    const symbol =
        suitSymbol(
            card.suit
        );

    element.innerHTML =
        '<div class="cardTop">'
        +
        '<span>'
        +
        escapeHtml(
            card.rank
        )
        +
        '</span>'
        +
        '<span>'
        +
        symbol
        +
        '</span>'
        +
        '</div>'
        +
        '<div class="cardCenter">'
        +
        symbol
        +
        '</div>'
        +
        '<div class="cardBottom">'
        +
        '<span>'
        +
        escapeHtml(
            card.rank
        )
        +
        '</span>'
        +
        '<span>'
        +
        symbol
        +
        '</span>'
        +
        '</div>';

    return element;
}

/* =========================================================
   RENDER
========================================================= */

function render(
    state
) {

    document
        .getElementById(
            'tableSub'
        )
        .textContent =
            state.capacity
            +
            ' players · $'
            +
            state.stake
            +
            ' table';

    document
        .getElementById(
            'hudParty'
        )
        .textContent =
            state.partyIndex
            +
            ' / '
            +
            state.parties;

    document
        .getElementById(
            'hudHand'
        )
        .textContent =
            state.handIndex
            +
            ' / '
            +
            state.totalHands;

    document
        .getElementById(
            'hudTrump'
        )
        .textContent =
            trumpText(
                state.trump
            );

    document
        .getElementById(
            'hudDeck'
        )
        .textContent =
            state.deckCount;

    document
        .getElementById(
            'centerDeck'
        )
        .textContent =
            state.deckCount;

    document
        .getElementById(
            'hudStake'
        )
        .textContent =
            '$'
            +
            state.stake;

    renderTrump(
        state.trump
    );

    renderPlayers(
        state
    );

    renderTable(
        state
    );

    renderHand(
        state
    );

    renderScore(
        state
    );

    renderTester(
        state
    );

    updateStatus(
        state
    );
}

/* =========================================================
   TRUMP
========================================================= */

function renderTrump(
    trump
) {

    const slot =
        document
            .getElementById(
                'trumpSlot'
            );

    slot.innerHTML =
        '';

    if (
        trump ===
        'no_trump'
    ) {

        const element =
            document
                .createElement(
                    'div'
                );

        element.className =
            'card';

        element.style.cssText =
            'display:grid;place-items:center;color:#333;font-size:26px';

        element.textContent =
            'Ø';

        slot.appendChild(
            element
        );

        return;
    }

    slot.appendChild(
        cardElement({
            rank:
                'K',

            suit:
                trump
        })
    );
}

/* =========================================================
   PLAYER POSITION
========================================================= */

function seatPosition(
    index,
    count,
    myId,
    players
) {

    let myIndex =
        players.findIndex(
            player =>
                player.id ===
                myId
        );

    if (
        myIndex <
        0
    ) {

        myIndex =
            0;
    }

    const relative =
        (
            index -
            myIndex +
            count
        )
        %
        count;

    const positions3 = [

        {
            left:
                50,

            top:
                83
        },

        {
            left:
                18,

            top:
                28
        },

        {
            left:
                82,

            top:
                28
        }
    ];

    const positions4 = [

        {
            left:
                50,

            top:
                83
        },

        {
            left:
                14,

            top:
                50
        },

        {
            left:
                50,

            top:
                16
        },

        {
            left:
                86,

            top:
                50
        }
    ];

    return (
        count ===
        4
            ?
            positions4
            :
            positions3
    )[
        relative
    ];
}

/* =========================================================
   PLAYERS
========================================================= */

function renderPlayers(
    state
) {

    const root =
        document
            .getElementById(
                'players'
            );

    root.innerHTML =
        '';

    state.players.forEach(
        (
            player,
            index
        ) => {

            const position =
                seatPosition(
                    index,
                    state.players.length,
                    state.viewingPlayerId,
                    state.players
                );

            const element =
                document
                    .createElement(
                        'div'
                    );

            element.className =
                'seat'
                +
                (
                    player.isCurrent
                        ?
                        ' current'
                        :
                        ''
                );

            element.style.left =
                position.left
                +
                '%';

            element.style.top =
                position.top
                +
                '%';

            let backs =
                '';

            if (
                player.id !==
                state.viewingPlayerId
            ) {

                for (
                    let i =
                        0;

                    i <
                    player.cardCount;

                    i++
                ) {

                    backs +=
                        '<div class="back"></div>';
                }
            }

            element.innerHTML =
                '<div class="seatBox">'
                +
                '<div class="avatar"></div>'
                +
                '<div class="seatName">'
                +
                escapeHtml(
                    player.name
                )
                +
                (
                    player.isBot
                        ?
                        ' 🤖'
                        :
                        ''
                )
                +
                '</div>'
                +
                '<div class="seatInfo">'
                +
                '💰 '
                +
                player.balance
                +
                ' · hand '
                +
                player.handPoints
                +
                ' · total '
                +
                player.totalPoints
                +
                '</div>'
                +
                '<div class="backs">'
                +
                backs
                +
                '</div>'
                +
                '<div class="turnBar"></div>'
                +
                '</div>';

            root.appendChild(
                element
            );
        }
    );
}

/* =========================================================
   TABLE CARDS
========================================================= */

function renderTable(
    state
) {

    const root =
        document
            .getElementById(
                'tableCards'
            );

    root.innerHTML =
        '';

    state.table.forEach(
        play => {

            const group =
                document
                    .createElement(
                        'div'
                    );

            group.className =
                'playGroup'
                +
                (
                    play.isWinning
                        ?
                        ' winner'
                        :
                        ''
                );

            const name =
                document
                    .createElement(
                        'div'
                    );

            name.className =
                'playName';

            name.textContent =
                play.playerName;

            group.appendChild(
                name
            );

            play.cards.forEach(
                card => {

                    group.appendChild(
                        cardElement(
                            card
                        )
                    );
                }
            );

            root.appendChild(
                group
            );
        }
    );
}

/* =========================================================
   HAND
========================================================= */

function renderHand(
    state
) {

    const root =
        document
            .getElementById(
                'myCards'
            );

    root.innerHTML =
        '';

    const cards =
        state.playersCards[
            state.viewingPlayerId
        ]
        ||
        [];

    const middle =
        (
            cards.length -
            1
        )
        /
        2;

    cards.forEach(
        (
            card,
            index
        ) => {

            const element =
                cardElement(
                    card
                );

            const delta =
                index -
                middle;

            element.style.transform =
                'rotate('
                +
                (
                    delta *
                    3.5
                )
                +
                'deg) translateY('
                +
                (
                    Math.abs(
                        delta
                    )
                    *
                    1.7
                )
                +
                'px)';

            element.addEventListener(
                'click',
                () => {

                    toggleCard(
                        index,
                        element
                    );
                }
            );

            element.addEventListener(
                'pointerdown',
                event => {

                    startDrag(
                        event,
                        index,
                        element
                    );
                }
            );

            root.appendChild(
                element
            );
        }
    );

    updatePlayButton(
        state
    );
}

/* =========================================================
   SELECT
========================================================= */

function toggleCard(
    index,
    element
) {

    const found =
        selected.indexOf(
            index
        );

    if (
        found >=
        0
    ) {

        selected.splice(
            found,
            1
        );

        element
            .classList
            .remove(
                'selected'
            );

    } else {

        selected.push(
            index
        );

        element
            .classList
            .add(
                'selected'
            );
    }

    updatePlayButton(
        current
    );
}

/* =========================================================
   PLAY
========================================================= */

function updatePlayButton(
    state
) {

    const button =
        document
            .getElementById(
                'playBtn'
            );

    const active =
        state
            ?
            state.players[
                state.currentTurnIndex
            ]
            :
            null;

    button.disabled =
        !state
        ||
        !active
        ||
        active.id !==
        state.viewingPlayerId
        ||
        selected.length ===
        0
        ||
        state.processing
        ||
        state.gameOver;
}

function playSelected() {

    if (
        !selected.length
    ) {

        return;
    }

    playSfx(
        'play'
    );

    socket.emit(
        'playCards',
        {

            cardIndices:
                selected.slice()
        }
    );

    selected =
        [];
}

/* =========================================================
   STATUS
========================================================= */

function updateStatus(
    state
) {

    const element =
        document
            .getElementById(
                'status'
            );

    if (
        state.gameOver
    ) {

        element.textContent =
            '🏆 თამაში დასრულებულია';

        playSfx(
            'win'
        );

        return;
    }

    if (
        state.processing
    ) {

        element.textContent =
            '✨ კარტები ითვლება...';

        return;
    }

    const player =
        state.players[
            state.currentTurnIndex
        ];

    if (
        !player
    ) {

        return;
    }

    if (
        player.id ===
        state.viewingPlayerId
    ) {

        element.textContent =
            '🎯 შენი სვლაა';

    } else if (
        player.isBot
    ) {

        element.textContent =
            '🤖 '
            +
            player.name
            +
            ' თამაშობს...';

    } else {

        element.textContent =
            player.name
            +
            '-ის სვლაა';
    }
}

/* =========================================================
   SCORE
========================================================= */

function renderScore(
    state
) {

    const root =
        document
            .getElementById(
                'score'
            );

    const last =
        state.lastHandScores ||
        {};

    const players =
        state.players
            .slice()
            .sort(
                (
                    a,
                    b
                ) =>
                    (
                        b.totalPoints ||
                        0
                    )
                    -
                    (
                        a.totalPoints ||
                        0
                    )
            );

    let html =
        '';

    players.forEach(
        (
            player,
            index
        ) => {

            const place =
                index === 0
                    ?
                    '🥇'
                    :
                    (
                        index === 1
                            ?
                            '🥈'
                            :
                            (
                                index === 2
                                    ?
                                    '🥉'
                                    :
                                    '#' +
                                    (
                                        index +
                                        1
                                    )
                            )
                    );

            const lastScore =
                typeof last[
                    player.id
                ] ===
                'number'
                    ?
                    last[
                        player.id
                    ]
                    :
                    '-';

            html +=
                '<div class="scoreRow '
                +
                (
                    index ===
                    0
                        ?
                        'first'
                        :
                        ''
                )
                +
                '">'
                +
                '<div>'
                +
                place
                +
                '</div>'
                +
                '<div class="name">'
                +
                escapeHtml(
                    player.name
                )
                +
                (
                    player.id ===
                    state.viewingPlayerId
                        ?
                        ' · YOU'
                        :
                        ''
                )
                +
                '</div>'
                +
                '<div class="last">'
                +
                lastScore
                +
                '</div>'
                +
                '<div class="total">'
                +
                player.totalPoints
                +
                '</div>'
                +
                '</div>';
        }
    );

    root.innerHTML =
        html;
}

/* =========================================================
   TESTER
========================================================= */

function renderTester(
    state
) {

    const panel =
        document
            .getElementById(
                'testerPanel'
            );

    const grid =
        document
            .getElementById(
                'testerGrid'
            );

    if (
        !state.revealAll
    ) {

        panel
            .classList
            .remove(
                'show'
            );

        grid.innerHTML =
            '';

        return;
    }

    panel
        .classList
        .add(
            'show'
        );

    let html =
        '';

    state.players.forEach(
        player => {

            const cards =
                state.playersCards[
                    player.id
                ] ||
                [];

            html +=
                '<div class="testerHand">'
                +
                '<b>'
                +
                escapeHtml(
                    player.name
                )
                +
                '</b>'
                +
                '<div class="mini">';

            cards.forEach(
                card => {

                    html +=
                        '<span>'
                        +
                        escapeHtml(
                            card.rank
                        )
                        +
                        suitSymbol(
                            card.suit
                        )
                        +
                        '</span>';
                }
            );

            html +=
                '</div>'
                +
                '</div>';
        }
    );

    grid.innerHTML =
        html;
}

/* =========================================================
   DRAG & DROP
========================================================= */

function startDrag(
    event,
    index,
    source
) {

    if (
        event.pointerType ===
        'mouse'
        &&
        event.button !==
        0
    ) {

        return;
    }

    dragIndex =
        index;

    dragGhost =
        source.cloneNode(
            true
        );

    dragGhost
        .classList
        .add(
            'dragGhost'
        );

    dragGhost.style.left =
        event.clientX
        +
        'px';

    dragGhost.style.top =
        event.clientY
        +
        'px';

    document.body
        .appendChild(
            dragGhost
        );

    const move =
        e => {

            if (
                dragGhost
            ) {

                dragGhost.style.left =
                    e.clientX
                    +
                    'px';

                dragGhost.style.top =
                    e.clientY
                    +
                    'px';
            }
        };

    const up =
        e => {

            document
                .removeEventListener(
                    'pointermove',
                    move
                );

            document
                .removeEventListener(
                    'pointerup',
                    up
                );

            if (
                dragGhost
            ) {

                dragGhost.remove();

                dragGhost =
                    null;
            }

            const felt =
                document
                    .querySelector(
                        '.felt'
                    )
                    .getBoundingClientRect();

            const inside =
                e.clientX >=
                felt.left
                &&
                e.clientX <=
                felt.right
                &&
                e.clientY >=
                felt.top
                &&
                e.clientY <=
                felt.bottom;

            if (
                inside
            ) {

                if (
                    !selected.includes(
                        dragIndex
                    )
                ) {

                    selected =
                        [
                            dragIndex
                        ];
                }

                playSelected();
            }

            dragIndex =
                null;
        };

    document
        .addEventListener(
            'pointermove',
            move
        );

    document
        .addEventListener(
            'pointerup',
            up,
            {
                once:
                    true
            }
        );
}

/* =========================================================
   SFX
========================================================= */

function toggleSfx() {

    sfxEnabled =
        !sfxEnabled;

    document
        .getElementById(
            'sfxBtn'
        )
        .textContent =
            sfxEnabled
                ?
                '🔊 SFX'
                :
                '🔇 SFX';
}

function playSfx(
    type
) {

    if (
        !sfxEnabled
    ) {

        return;
    }

    try {

        const AudioContextClass =
            window.AudioContext
            ||
            window.webkitAudioContext;

        const context =
            new AudioContextClass();

        const oscillator =
            context
                .createOscillator();

        const gain =
            context
                .createGain();

        oscillator.connect(
            gain
        );

        gain.connect(
            context.destination
        );

        let frequency =
            420;

        let duration =
            .06;

        if (
            type ===
            'play'
        ) {

            frequency =
                520;

            duration =
                .05;

        } else if (
            type ===
            'take'
        ) {

            frequency =
                280;

            duration =
                .08;

        } else if (
            type ===
            'win'
        ) {

            frequency =
                760;

            duration =
                .16;
        }

        oscillator
            .frequency
            .value =
                frequency;

        gain.gain
            .setValueAtTime(
                .035,
                context.currentTime
            );

        gain.gain
            .exponentialRampToValueAtTime(
                .001,
                context.currentTime
                +
                duration
            );

        oscillator.start();

        oscillator.stop(
            context.currentTime
            +
            duration
        );

    } catch (
        error
    ) {
        // ignore unsupported audio
    }
}

</script>

</body>

</html>
`;

/* =========================================================
   ROUTES
========================================================= */

app.get(
    '/',
    (
        req,
        res
    ) => {

        res
            .type(
                'html'
            )
            .send(
                PAGE
            );
    }
);

app.get(
    '/health',
    (
        req,
        res
    ) => {

        res.json({
            ok:
                true,

            cards:
                createDeck().length,

            tester:
                TESTER_NAME
        });
    }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            'WRITTEN BURA running on port',
            PORT
        );

        console.log(
            'Deck:',
            createDeck().length
        );

        console.log(
            'Tester:',
            TESTER_NAME
        );
    }
);
