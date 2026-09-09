const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;

app.use(express.json());

const TESTER_USERNAME = 'saba123';
const STARTING_BALANCE = 1000;

const USERS_FILE = path.join(__dirname, 'users.json');

const ALLOWED_STAKES = [
    5,
    10,
    25,
    50,
    100
];

const ALLOWED_CAPACITIES = [
    3,
    4
];

/* =========================================================
   USERS
========================================================= */

let users = [];

try {

    if (
        fs.existsSync(
            USERS_FILE
        )
    ) {

        const parsed =
            JSON.parse(
                fs.readFileSync(
                    USERS_FILE,
                    'utf8'
                )
            );

        users =
            Array.isArray(parsed)
                ?
                parsed
                :
                [];
    }

} catch (e) {

    console.error(
        'users.json read error:',
        e
    );
}

function saveUsers() {

    try {

        fs.writeFileSync(
            USERS_FILE,
            JSON.stringify(
                users,
                null,
                2
            )
        );

    } catch (e) {

        console.error(
            'users.json save error:',
            e
        );
    }
}

/* =========================================================
   AUTH
========================================================= */

const sessions =
    new Map();

const testerSessions =
    new Set();

function normalizeUsername(
    value
) {

    return String(
        value || ''
    ).trim();
}

function normalizeEmail(
    value
) {

    return String(
        value || ''
    )
        .trim()
        .toLowerCase();
}

function isTesterUsername(
    value
) {

    return (
        normalizeUsername(
            value
        ).toLowerCase()
        ===
        TESTER_USERNAME
            .toLowerCase()
    );
}

function createToken() {

    return crypto
        .randomBytes(
            32
        )
        .toString(
            'hex'
        );
}

function hashPassword(
    password,
    salt
) {

    return crypto
        .scryptSync(
            String(
                password
            ),
            salt,
            64
        )
        .toString(
            'hex'
        );
}

function getUserByToken(
    token
) {

    if (
        !token
    ) {

        return null;
    }

    if (
        testerSessions.has(
            token
        )
    ) {

        return {

            id:
                'tester_saba123',

            username:
                TESTER_USERNAME,

            email:
                '',

            balance:
                STARTING_BALANCE,

            isTester:
                true
        };
    }

    const userId =
        sessions.get(
            token
        );

    if (
        !userId
    ) {

        return null;
    }

    const user =
        users.find(
            item =>
                item.id ===
                userId
        );

    if (
        !user
    ) {

        return null;
    }

    return {

        ...user,

        isTester:
            false
    };
}

/* =========================================================
   REGISTER
========================================================= */

app.post(
    '/api/register',
    (
        req,
        res
    ) => {

        const username =
            normalizeUsername(
                req.body.username
            );

        const email =
            normalizeEmail(
                req.body.email
            );

        const password =
            String(
                req.body.password ||
                ''
            );

        const acceptedTerms =
            !!req.body.acceptedTerms;

        if (
            !acceptedTerms
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'რეგისტრაციისთვის საჭიროა წესებსა და პირობებზე თანხმობა.'
                });
        }

        if (
            isTesterUsername(
                username
            )
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'saba123 დაცულია სატესტო რეჟიმისთვის.'
                });
        }

        if (
            username.length <
            3
            ||
            username.length >
            20
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'Username უნდა იყოს 3-20 სიმბოლო.'
                });
        }

        if (
            !/^[a-zA-Z0-9_\u10A0-\u10FF]+$/u
                .test(
                    username
                )
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'Username-ში გამოიყენე ასოები, ციფრები ან _.'
                });
        }

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(
                    email
                )
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'შეიყვანე სწორი Email.'
                });
        }

        if (
            password.length <
            6
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს.'
                });
        }

        if (
            users.some(
                user =>
                    user.username
                        .toLowerCase()
                    ===
                    username
                        .toLowerCase()
            )
        ) {

            return res
                .status(409)
                .json({

                    ok:
                        false,

                    message:
                        'ეს Username უკვე დაკავებულია.'
                });
        }

        if (
            users.some(
                user =>
                    user.email ===
                    email
            )
        ) {

            return res
                .status(409)
                .json({

                    ok:
                        false,

                    message:
                        'ეს Email უკვე რეგისტრირებულია.'
                });
        }

        const salt =
            crypto
                .randomBytes(
                    16
                )
                .toString(
                    'hex'
                );

        const user = {

            id:
                'user_' +
                Date.now() +
                '_' +
                Math.floor(
                    Math.random() *
                    100000
                ),

            username,

            email,

            salt,

            passwordHash:
                hashPassword(
                    password,
                    salt
                ),

            balance:
                STARTING_BALANCE,

            createdAt:
                new Date()
                    .toISOString()
        };

        users.push(
            user
        );

        saveUsers();

        const token =
            createToken();

        sessions.set(
            token,
            user.id
        );

        res.json({

            ok:
                true,

            token,

            username:
                user.username,

            email:
                user.email,

            balance:
                user.balance,

            isTester:
                false
        });
    }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
    '/api/login',
    (
        req,
        res
    ) => {

        const username =
            normalizeUsername(
                req.body.username
            );

        const password =
            String(
                req.body.password ||
                ''
            );

        /*
            TEST MODE
        */

        if (
            isTesterUsername(
                username
            )
        ) {

            const token =
                createToken();

            testerSessions.add(
                token
            );

            return res.json({

                ok:
                    true,

                token,

                username:
                    TESTER_USERNAME,

                email:
                    '',

                balance:
                    STARTING_BALANCE,

                isTester:
                    true
            });
        }

        const user =
            users.find(
                item =>
                    item.username
                        .toLowerCase()
                    ===
                    username
                        .toLowerCase()
            );

        if (
            !user
            ||
            hashPassword(
                password,
                user.salt
            )
            !==
            user.passwordHash
        ) {

            return res
                .status(401)
                .json({

                    ok:
                        false,

                    message:
                        'Username ან პაროლი არასწორია.'
                });
        }

        const token =
            createToken();

        sessions.set(
            token,
            user.id
        );

        res.json({

            ok:
                true,

            token,

            username:
                user.username,

            email:
                user.email,

            balance:
                user.balance,

            isTester:
                false
        });
    }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
    '/health',
    (
        req,
        res
    ) => {

        res.json({

            ok:
                true,

            service:
                'written-bura',

            cards:
                36
        });
    }
);

/* =========================================================
   CARDS
========================================================= */

const CARD_VALUES = {

    '6':
        0,

    '7':
        0,

    '8':
        0,

    '9':
        0,

    J:
        2,

    Q:
        3,

    K:
        4,

    '10':
        10,

    A:
        11
};

const RANKS_ORDER = [

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

    'hearts',

    'diamonds'
];

const TRUMP_ROTATION = [

    'spades',

    'clubs',

    'hearts',

    'diamonds',

    'no_trump'
];

const rooms =
    {};

const liveFeed =
    [];

/* =========================================================
   LIVE FEED
========================================================= */

function pushFeed(
    text
) {

    liveFeed.unshift({

        text,

        time:
            new Date()
                .toISOString()
    });

    if (
        liveFeed.length >
        12
    ) {

        liveFeed.length =
            12;
    }

    io.emit(
        'lobbyUpdate',
        getLobbyState()
    );
}

/* =========================================================
   DECK
========================================================= */

function createDeck() {

    const deck =
        [];

    for (
        const suit of
        SUITS
    ) {

        for (
            const rank of
            RANKS_ORDER
        ) {

            deck.push({

                id:
                    crypto
                        .randomUUID(),

                rank,

                suit,

                value:
                    CARD_VALUES[
                        rank
                    ]
            });
        }
    }

    for (
        let i =
            deck.length -
            1;

        i >
        0;

        i--
    ) {

        const j =
            Math.floor(
                Math.random() *
                (
                    i +
                    1
                )
            );

        [
            deck[i],
            deck[j]
        ] =
        [
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
    id,
    maxPlayers,
    targetParties,
    stake
) {

    return {

        id,

        maxPlayers,

        targetParties,

        stake,

        players:
            [],

        gameState:
            null,

        createdAt:
            Date.now()
    };
}

/* =========================================================
   HAND
========================================================= */

function startNewHand(
    room,
    previousGame = null
) {

    const deck =
        createDeck();

    const playersCards =
        {};

    const takenCards =
        {};

    const totalScores =
        {};

    for (
        const player of
        room.players
    ) {

        playersCards[
            player.id
        ] =
            deck.splice(
                0,
                5
            );

        takenCards[
            player.id
        ] =
            [];

        totalScores[
            player.id
        ] =
            previousGame
                ?
                (
                    previousGame
                        .totalScores[
                            player.id
                        ] ||
                    0
                )
                :
                0;
    }

    const handIndex =
        previousGame
            ?
            previousGame
                .handIndex +
            1
            :
            1;

    const startLeaderIndex =
        previousGame
        &&
        Number.isInteger(
            previousGame
                .nextRoundLeaderIndex
        )
            ?
            previousGame
                .nextRoundLeaderIndex
            :
            0;

    return {

        deck,

        playersCards,

        takenCards,

        totalScores,

        currentTurnIndex:
            startLeaderIndex,

        table:
            [],

        trump:
            TRUMP_ROTATION[
                (
                    handIndex -
                    1
                )
                %
                TRUMP_ROTATION
                    .length
            ],

        partyNum:
            Math.ceil(
                handIndex /
                5
            ),

        handIndex,

        roundHistory:
            previousGame
                ?
                previousGame
                    .roundHistory
                :
                [],

        lastHandScores:
            previousGame
                ?
                (
                    previousGame
                        .lastHandScores ||
                    {}
                )
                :
                {},

        nextRoundLeaderIndex:
            startLeaderIndex,

        leadCardCount:
            null,

        isProcessing:
            false,

        gameOver:
            false
    };
}

/* =========================================================
   CARD RULES
========================================================= */

function cardBeatsCard(
    lead,
    challenge,
    trump
) {

    const challengeTrump =
        trump !==
        'no_trump'
        &&
        challenge.suit ===
        trump;

    const leadTrump =
        trump !==
        'no_trump'
        &&
        lead.suit ===
        trump;

    if (
        challengeTrump
        &&
        !leadTrump
    ) {

        return true;
    }

    if (
        !challengeTrump
        &&
        leadTrump
    ) {

        return false;
    }

    if (
        challenge.suit !==
        lead.suit
    ) {

        return false;
    }

    return (
        RANKS_ORDER.indexOf(
            challenge.rank
        )
        >
        RANKS_ORDER.indexOf(
            lead.rank
        )
    );
}

function isMaliutka(
    cards
) {

    return (
        cards.length ===
        5
        &&
        cards.every(
            card =>
                card.suit ===
                cards[
                    0
                ].suit
        )
    );
}

function beatsPlay(
    leadPlay,
    challengePlay,
    trump
) {

    const leadCards =
        leadPlay.cards;

    const challengeCards =
        challengePlay.cards;

    if (
        isMaliutka(
            challengeCards
        )
        &&
        leadCards.length <
        5
    ) {

        return true;
    }

    if (
        leadCards.length !==
        challengeCards.length
    ) {

        return false;
    }

    const leadSorted =
        [
            ...leadCards
        ].sort(
            (
                a,
                b
            ) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    const challengeSorted =
        [
            ...challengeCards
        ].sort(
            (
                a,
                b
            ) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    for (
        let i =
            0;

        i <
        leadSorted.length;

        i++
    ) {

        if (
            !cardBeatsCard(
                leadSorted[i],
                challengeSorted[i],
                trump
            )
        ) {

            return false;
        }
    }

    return true;
}

function getWinningPlayIndex(
    table,
    trump
) {

    if (
        !table.length
    ) {

        return -1;
    }

    let winner =
        0;

    for (
        let i =
            1;

        i <
        table.length;

        i++
    ) {

        if (
            beatsPlay(
                table[
                    winner
                ],
                table[i],
                trump
            )
        ) {

            winner =
                i;
        }
    }

    return winner;
}

/* =========================================================
   CLIENT GAME STATE
========================================================= */

function getClientGameState(
    room,
    forPlayerId
) {

    const gs =
        room.gameState;

    if (
        !gs
    ) {

        return null;
    }

    const winningIndex =
        getWinningPlayIndex(
            gs.table,
            gs.trump
        );

    const players =
        room.players.map(
            (
                player,
                index
            ) => {

                const taken =
                    gs.takenCards[
                        player.id
                    ] ||
                    [];

                return {

                    id:
                        player.id,

                    name:
                        player.name,

                    balance:
                        player.balance,

                    isBot:
                        !!player.isBot,

                    isTester:
                        !!player.isTester,

                    cardCount:
                        (
                            gs.playersCards[
                                player.id
                            ] ||
                            []
                        ).length,

                    takenCount:
                        taken.length,

                    handPoints:
                        taken.reduce(
                            (
                                sum,
                                card
                            ) =>
                                sum +
                                card.value,
                            0
                        ),

                    totalPoints:
                        gs.totalScores[
                            player.id
                        ] ||
                        0,

                    isCurrent:
                        index ===
                        gs.currentTurnIndex
                };
            }
        );

    const visible =
        {};

    if (
        forPlayerId
        &&
        gs.playersCards[
            forPlayerId
        ]
    ) {

        visible[
            forPlayerId
        ] =
            gs.playersCards[
                forPlayerId
            ];
    }

    return {

        table:
            gs.table.map(
                (
                    play,
                    index
                ) => ({

                    ...play,

                    isWinning:
                        index ===
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

        totalHands:
            room.targetParties *
            5,

        stake:
            room.stake,

        players,

        playersCards:
            visible,

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

        lastHandScores:
            gs.lastHandScores ||
            {},

        gameOver:
            gs.gameOver
    };
}

function broadcastGameState(
    room
) {

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
            getClientGameState(
                room,
                player.id
            )
        );
    }

    io.emit(
        'lobbyUpdate',
        getLobbyState()
    );
}

/* =========================================================
   REFILL
========================================================= */

function refillHands(
    room,
    winnerIndex
) {

    const gs =
        room.gameState;

    while (
        gs.deck.length >
        0
    ) {

        let dealt =
            false;

        for (
            let step =
                0;

            step <
            room.players
                .length;

            step++
        ) {

            const player =
                room.players[
                    (
                        winnerIndex +
                        step
                    )
                    %
                    room.players
                        .length
                ];

            const hand =
                gs.playersCards[
                    player.id
                ];

            if (
                hand.length <
                5
                &&
                gs.deck.length >
                0
            ) {

                hand.push(
                    gs.deck.pop()
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

function finishHand(
    room
) {

    const gs =
        room.gameState;

    const handScores =
        {};

    let minRaw =
        Infinity;

    let minPlayerIndex =
        0;

    room.players.forEach(
        (
            player,
            index
        ) => {

            const raw =
                (
                    gs.takenCards[
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
                );

            const finalPoints =
                raw ===
                0
                    ?
                    -120
                    :
                    raw;

            handScores[
                player.id
            ] =
                finalPoints;

            gs.totalScores[
                player.id
            ] =
                (
                    gs.totalScores[
                        player.id
                    ] ||
                    0
                )
                +
                finalPoints;

            if (
                raw <
                minRaw
            ) {

                minRaw =
                    raw;

                minPlayerIndex =
                    index;
            }
        }
    );

    gs.lastHandScores =
        {
            ...handScores
        };

    gs.roundHistory.push({

        handIndex:
            gs.handIndex,

        trump:
            gs.trump,

        scores:
            {
                ...handScores
            },

        totals:
            {
                ...gs.totalScores
            }
    });

    if (
        gs.handIndex >=
        room.targetParties *
        5
    ) {

        gs.gameOver =
            true;

        pushFeed(
            '🏆 დასრულდა $' +
            room.stake +
            ' მაგიდის თამაში.'
        );

        broadcastGameState(
            room
        );

        return;
    }

    gs.nextRoundLeaderIndex =
        (
            minPlayerIndex +
            1
        )
        %
        room.players.length;

    room.gameState =
        startNewHand(
            room,
            gs
        );

    room.gameState
        .lastHandScores =
        {
            ...handScores
        };

    broadcastGameState(
        room
    );

    scheduleBotTurn(
        room
    );
}

/* =========================================================
   COMPLETE TRICK
========================================================= */

function completeTrick(
    room
) {

    const gs =
        room.gameState;

    const winningIndex =
        getWinningPlayIndex(
            gs.table,
            gs.trump
        );

    const winningPlay =
        gs.table[
            winningIndex
        ];

    if (
        !winningPlay
    ) {

        return;
    }

    const allCards =
        gs.table.flatMap(
            play =>
                play.cards
        );

    gs.takenCards[
        winningPlay.playerId
    ].push(
        ...allCards
    );

    const winnerIndex =
        room.players
            .findIndex(
                player =>
                    player.id ===
                    winningPlay.playerId
            );

    gs.currentTurnIndex =
        winnerIndex;

    gs.isProcessing =
        true;

    broadcastGameState(
        room
    );

    setTimeout(
        () => {

            if (
                !rooms[
                    room.id
                ]
                ||
                room.gameState !==
                gs
            ) {

                return;
            }

            gs.table =
                [];

            gs.leadCardCount =
                null;

            refillHands(
                room,
                winnerIndex
            );

            gs.isProcessing =
                false;

            const empty =
                room.players
                    .every(
                        player =>
                            (
                                gs.playersCards[
                                    player.id
                                ] ||
                                []
                            ).length ===
                            0
                    );

            if (
                empty
            ) {

                finishHand(
                    room
                );

            } else {

                broadcastGameState(
                    room
                );

                scheduleBotTurn(
                    room
                );
            }

        },
        1250
    );
}

/* =========================================================
   BOT
========================================================= */

function chooseBotIndices(
    room,
    bot
) {

    const gs =
        room.gameState;

    const cards =
        gs.playersCards[
            bot.id
        ] ||
        [];

    if (
        !cards.length
    ) {

        return [];
    }

    if (
        gs.table.length ===
        0
    ) {

        return [

            Math.floor(
                Math.random() *
                cards.length
            )
        ];
    }

    const required =
        Math.min(
            gs.leadCardCount ||
            1,
            cards.length
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

function scheduleBotTurn(
    room
) {

    if (
        !room
        ||
        !room.gameState
    ) {

        return;
    }

    const gs =
        room.gameState;

    if (
        gs.gameOver
        ||
        gs.isProcessing
    ) {

        return;
    }

    const active =
        room.players[
            gs.currentTurnIndex
        ];

    if (
        !active
        ||
        !active.isBot
    ) {

        return;
    }

    setTimeout(
        () => {

            playBotTurn(
                room,
                active
            );

        },
        650
    );
}

function playBotTurn(
    room,
    bot
) {

    if (
        !rooms[
            room.id
        ]
        ||
        !room.gameState
    ) {

        return;
    }

    const gs =
        room.gameState;

    if (
        gs.gameOver
        ||
        gs.isProcessing
    ) {

        return;
    }

    const active =
        room.players[
            gs.currentTurnIndex
        ];

    if (
        !active
        ||
        active.id !==
        bot.id
        ||
        !active.isBot
    ) {

        return;
    }

    const hand =
        gs.playersCards[
            bot.id
        ] ||
        [];

    const indexes =
        chooseBotIndices(
            room,
            bot
        );

    const cards =
        indexes
            .map(
                index =>
                    hand[
                        index
                    ]
            )
            .filter(
                Boolean
            );

    if (
        !cards.length
    ) {

        return;
    }

    if (
        gs.table.length ===
        0
    ) {

        gs.leadCardCount =
            cards.length;
    }

    gs.playersCards[
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

    gs.table.push({

        playerId:
            bot.id,

        playerName:
            bot.name,

        cards
    });

    if (
        gs.table.length <
        room.players.length
    ) {

        gs.currentTurnIndex =
            (
                gs.currentTurnIndex +
                1
            )
            %
            room.players.length;

        broadcastGameState(
            room
        );

        scheduleBotTurn(
            room
        );

    } else {

        completeTrick(
            room
        );
    }
}

/* =========================================================
   LOBBY STATE
========================================================= */

function getLobbyState() {

    const tables =
        [];

    for (
        const stake of
        ALLOWED_STAKES
    ) {

        for (
            const capacity of
            ALLOWED_CAPACITIES
        ) {

            const matching =
                Object.values(
                    rooms
                ).filter(
                    room =>
                        room.stake ===
                        stake
                        &&
                        room.maxPlayers ===
                        capacity
                        &&
                        !room.gameState
                );

            tables.push({

                id:
                    stake +
                    '-' +
                    capacity,

                stake,

                capacity,

                waiting:
                    matching.reduce(
                        (
                            sum,
                            room
                        ) =>
                            sum +
                            room.players.length,
                        0
                    ),

                roomCount:
                    matching.length,

                label:
                    stake >=
                    50
                        ?
                        'VIP TABLE'
                        :
                        (
                            stake >=
                            25
                                ?
                                'PREMIUM TABLE'
                                :
                                'CLASSIC GAME'
                        )
            });
        }
    }

    return {

        tables,

        online:
            io.engine.clientsCount,

        feed:
            liveFeed,

        tournaments: [

            {
                id:
                    1,

                date:
                    '22.09.2026',

                name:
                    'Autumn Crown',

                prize:
                    1500,

                players:
                    32
            },

            {
                id:
                    2,

                date:
                    '29.09.2026',

                name:
                    'Royal Four',

                prize:
                    3000,

                players:
                    64
            },

            {
                id:
                    3,

                date:
                    '06.10.2026',

                name:
                    'Written Bura Cup',

                prize:
                    5000,

                players:
                    96
            }
        ]
    };
}

/* =========================================================
   SOCKET
========================================================= */

io.on(
    'connection',
    socket => {

        socket.emit(
            'lobbyUpdate',
            getLobbyState()
        );

        socket.on(
            'joinTable',
            (
                data = {}
            ) => {

                const user =
                    getUserByToken(
                        data.token
                    );

                if (
                    !user
                ) {

                    return socket.emit(
                        'errorMessage',
                        'სესია აღარ არის აქტიური. თავიდან შედი ანგარიშზე.'
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
                    !ALLOWED_CAPACITIES
                        .includes(
                            capacity
                        )
                ) {

                    capacity =
                        3;
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

                    parties =
                        1;
                }

                parties =
                    Math.max(
                        1,
                        Math.min(
                            4,
                            parties
                        )
                    );

                let stake =
                    parseFloat(
                        data.stake
                    );

                if (
                    !ALLOWED_STAKES
                        .includes(
                            stake
                        )
                ) {

                    stake =
                        5;
                }

                if (
                    !user.isTester
                    &&
                    user.balance <
                    stake
                ) {

                    return socket.emit(
                        'errorMessage',
                        'არ გაქვს საკმარისი ბალანსი.'
                    );
                }

                let room =
                    Object.values(
                        rooms
                    ).find(
                        item =>
                            !item.gameState
                            &&
                            item.maxPlayers ===
                            capacity
                            &&
                            item.targetParties ===
                            parties
                            &&
                            item.stake ===
                            stake
                            &&
                            item.players.length <
                            item.maxPlayers
                    );

                if (
                    !room
                ) {

                    const roomId =
                        'room_' +
                        Date.now() +
                        '_' +
                        Math.floor(
                            Math.random() *
                            100000
                        );

                    room =
                        createRoom(
                            roomId,
                            capacity,
                            parties,
                            stake
                        );

                    rooms[
                        roomId
                    ] =
                        room;
                }

                let playerBalance =
                    user.isTester
                        ?
                        STARTING_BALANCE
                        :
                        user.balance;

                if (
                    !user.isTester
                ) {

                    const realUser =
                        users.find(
                            item =>
                                item.id ===
                                user.id
                        );

                    if (
                        !realUser
                    ) {

                        return socket.emit(
                            'errorMessage',
                            'მომხმარებელი ვერ მოიძებნა.'
                        );
                    }

                    realUser.balance -=
                        stake;

                    playerBalance =
                        realUser.balance;

                    saveUsers();
                }

                socket.roomId =
                    room.id;

                socket.userId =
                    user.id;

                socket.isTester =
                    !!user.isTester;

                socket.join(
                    room.id
                );

                room.players.push({

                    id:
                        socket.id,

                    userId:
                        user.id,

                    name:
                        user.username,

                    balance:
                        playerBalance,

                    isBot:
                        false,

                    isTester:
                        !!user.isTester
                });

                pushFeed(
                    '♠ ' +
                    user.username +
                    ' შეუერთდა $' +
                    stake +
                    ' მაგიდას.'
                );

                /*
                    TEST MODE
                */

                if (
                    user.isTester
                ) {

                    let botNumber =
                        1;

                    while (
                        room.players.length <
                        room.maxPlayers
                    ) {

                        const botId =
                            'bot_' +
                            Date.now() +
                            '_' +
                            botNumber +
                            '_' +
                            Math.floor(
                                Math.random() *
                                10000
                            );

                        room.players.push({

                            id:
                                botId,

                            userId:
                                botId,

                            name:
                                'BOT ' +
                                botNumber,

                            balance:
                                STARTING_BALANCE,

                            isBot:
                                true,

                            isTester:
                                false
                        });

                        botNumber++;
                    }
                }

                if (
                    room.players.length ===
                    room.maxPlayers
                ) {

                    room.gameState =
                        startNewHand(
                            room
                        );

                    pushFeed(
                        '♦ დაიწყო ' +
                        room.maxPlayers +
                        '-კაციანი $' +
                        room.stake +
                        ' თამაში.'
                    );

                    broadcastGameState(
                        room
                    );

                    scheduleBotTurn(
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
                                room.maxPlayers,

                            stake:
                                room.stake
                        }
                    );

                    io.emit(
                        'lobbyUpdate',
                        getLobbyState()
                    );
                }
            }
        );

        socket.on(
            'playCards',
            (
                data = {}
            ) => {

                const room =
                    socket.roomId
                        ?
                        rooms[
                            socket.roomId
                        ]
                        :
                        null;

                if (
                    !room
                    ||
                    !room.gameState
                ) {

                    return;
                }

                const gs =
                    room.gameState;

                if (
                    gs.isProcessing
                    ||
                    gs.gameOver
                ) {

                    return;
                }

                const active =
                    room.players[
                        gs.currentTurnIndex
                    ];

                if (
                    !active
                    ||
                    active.id !==
                    socket.id
                ) {

                    return socket.emit(
                        'errorMessage',
                        'ახლა შენი სვლა არ არის.'
                    );
                }

                const hand =
                    gs.playersCards[
                        socket.id
                    ] ||
                    [];

                let indexes =
                    Array.isArray(
                        data.cardIndices
                    )
                        ?
                        [
                            ...new Set(
                                data.cardIndices
                            )
                        ]
                        :
                        [];

                indexes =
                    indexes.filter(
                        index =>
                            Number.isInteger(
                                index
                            )
                            &&
                            index >=
                            0
                            &&
                            index <
                            hand.length
                    );

                if (
                    !indexes.length
                ) {

                    return socket.emit(
                        'errorMessage',
                        'აირჩიე მინიმუმ ერთი კარტი.'
                    );
                }

                const cards =
                    indexes.map(
                        index =>
                            hand[
                                index
                            ]
                    );

                if (
                    gs.table.length ===
                    0
                ) {

                    if (
                        !cards.every(
                            card =>
                                card.suit ===
                                cards[
                                    0
                                ].suit
                        )
                    ) {

                        return socket.emit(
                            'errorMessage',
                            'პირველი ჩამოსვლა ერთი ცვეტის კარტებით უნდა იყოს.'
                        );
                    }

                    gs.leadCardCount =
                        cards.length;

                } else {

                    const required =
                        Math.min(
                            gs.leadCardCount ||
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

                gs.playersCards[
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

                gs.table.push({

                    playerId:
                        socket.id,

                    playerName:
                        active.name,

                    cards
                });

                if (
                    gs.table.length <
                    room.players.length
                ) {

                    gs.currentTurnIndex =
                        (
                            gs.currentTurnIndex +
                            1
                        )
                        %
                        room.players.length;

                    broadcastGameState(
                        room
                    );

                    scheduleBotTurn(
                        room
                    );

                } else {

                    completeTrick(
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
                        ?
                        rooms[
                            socket.roomId
                        ]
                        :
                        null;

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

                io.to(
                    room.id
                ).emit(
                    'playerLeft'
                );

                if (
                    room.players.filter(
                        player =>
                            !player.isBot
                    ).length ===
                    0
                ) {

                    delete rooms[
                        room.id
                    ];
                }

                io.emit(
                    'lobbyUpdate',
                    getLobbyState()
                );
            }
        );
    }
);

/* =========================================================
   FRONTEND
========================================================= */

const PAGE =
String.raw`
<!DOCTYPE html>

<html lang="ka">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
>

<title>
    WRITTEN BURA
</title>

<script src="/socket.io/socket.io.js"></script>

<style>

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
        Georgia,
        "Times New Roman",
        serif;

    background:
        #100306;

    color:
        #f4eadc;
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

:root {

    --wine:
        #26070d;

    --wine2:
        #3a0d16;

    --gold:
        #d7aa59;

    --gold2:
        #f1cd83;

    --cream:
        #eadcc8;

    --line:
        rgba(215,170,89,.30);
}

body {

    background:

        radial-gradient(
            circle at 50% 20%,
            rgba(92,18,31,.5),
            transparent 38%
        ),

        linear-gradient(
            135deg,
            #100306,
            #25060d 45%,
            #130306
        );

    min-height:
        100vh;

    overflow-x:
        hidden;
}

body:before {

    content:
        "";

    position:
        fixed;

    inset:
        0;

    pointer-events:
        none;

    opacity:
        .18;

    background:
        repeating-linear-gradient(
            135deg,
            transparent 0 22px,
            rgba(255,255,255,.018)
            22px 24px
        );
}

.shell {

    width:
        min(1180px,96vw);

    margin:
        0 auto;

    padding-bottom:
        30px;
}

/* =========================================================
   TOP
========================================================= */

.top {

    min-height:
        58px;

    display:
        flex;

    align-items:
        center;

    gap:
        16px;
}

.brand {

    font-size:
        25px;

    line-height:
        .85;

    color:
        var(--cream);

    font-weight:
        700;

    min-width:
        190px;
}

.brand span {

    display:
        block;

    color:
        var(--gold2);

    font-size:
        34px;
}

.search {

    margin-left:
        auto;

    position:
        relative;
}

.search input {

    width:
        210px;

    height:
        32px;

    border:
        1px solid
        rgba(255,255,255,.08);

    border-radius:
        4px;

    background:
        #2b2224;

    color:
        #fff;

    padding:
        0 12px 0 30px;

    font-size:
        11px;
}

.search:before {

    content:
        "⌕";

    position:
        absolute;

    left:
        9px;

    top:
        5px;

    color:
        #847679;
}

.top-link,
.top-btn {

    color:
        #d9cabb;

    background:
        none;

    border:
        0;

    font-size:
        10px;

    text-transform:
        uppercase;
}

.top-btn {

    padding:
        8px 14px;

    border:
        1px solid
        var(--gold);

    border-radius:
        5px;
}

.top-btn.gold {

    background:
        linear-gradient(
            #e7c27e,
            #b8863f
        );

    color:
        #241208;

    border-color:
        #e4be78;
}

.subnav {

    margin-left:
        260px;

    height:
        34px;

    border-top:
        1px solid
        rgba(255,255,255,.05);

    border-bottom:
        1px solid
        rgba(215,170,89,.16);

    display:
        flex;

    align-items:
        center;

    gap:
        25px;
}

.subnav button {

    background:
        none;

    border:
        0;

    color:
        #ad9583;

    font-size:
        10px;

    text-transform:
        uppercase;
}

.subnav button:hover {

    color:
        var(--gold2);
}

/* =========================================================
   HERO
========================================================= */

.hero-row {

    display:
        grid;

    grid-template-columns:
        1fr 265px;

    gap:
        12px;

    align-items:
        start;

    margin-top:
        8px;
}

.hero {

    height:
        255px;

    border:
        1px solid
        var(--gold);

    position:
        relative;

    overflow:
        hidden;

    background:

        linear-gradient(
            90deg,
            rgba(30,7,10,.96),
            rgba(63,25,28,.78)
        ),

        radial-gradient(
            circle at 70% 45%,
            #9e694c 0 12%,
            transparent 13%
        ),

        linear-gradient(
            135deg,
            #391216,
            #181015
        );

    box-shadow:
        inset 0 0 0 5px
        rgba(215,170,89,.08);
}

.hero:after {

    content:
        "♠   ♥   ♦   ♣";

    position:
        absolute;

    right:
        25px;

    bottom:
        24px;

    font-size:
        48px;

    letter-spacing:
        12px;

    color:
        rgba(241,205,131,.15);

    transform:
        rotate(-6deg);
}

.hero-copy {

    position:
        absolute;

    left:
        35px;

    top:
        55px;

    width:
        360px;
}

.hero-copy h1 {

    margin:
        0 0 14px;

    font-size:
        26px;

    line-height:
        1;

    color:
        #e2c79d;
}

.hero-copy p {

    font-size:
        12px;

    color:
        #bda797;

    line-height:
        1.6;
}

.hero-copy button {

    margin-top:
        10px;

    width:
        120px;

    height:
        35px;

    border:
        0;

    border-radius:
        4px;

    background:
        linear-gradient(
            #efc87d,
            #bc8435
        );

    color:
        #28150a;

    font-weight:
        700;
}

.dots {

    position:
        absolute;

    left:
        50%;

    bottom:
        8px;

    transform:
        translateX(-50%);

    display:
        flex;

    gap:
        5px;
}

.dots i {

    width:
        22px;

    height:
        5px;

    border-radius:
        8px;

    background:
        #493127;
}

.dots i.active {

    background:
        var(--gold2);
}

/* =========================================================
   REGISTRATION
========================================================= */

.register-card {

    position:
        relative;

    margin-top:
        -62px;

    background:
        linear-gradient(
            #e6d9ca,
            #c9b7a7
        );

    border-radius:
        10px 10px 7px 7px;

    padding:
        17px 18px 44px;

    color:
        #5d4939;

    box-shadow:
        0 18px 30px
        rgba(0,0,0,.35);

    border:
        1px solid
        #c7a86f;
}

.register-card:before {

    content:
        "";

    position:
        absolute;

    top:
        -10px;

    right:
        35px;

    border-left:
        12px solid
        transparent;

    border-right:
        12px solid
        transparent;

    border-bottom:
        10px solid
        #d9c8b8;
}

.register-title {

    font-size:
        14px;

    color:
        #9a774c;

    margin-bottom:
        9px;
}

.register-title b {

    display:
        block;

    color:
        #4e3a2f;

    font-size:
        15px;
}

.reg-field {

    position:
        relative;

    margin:
        8px 0;
}

.reg-field input {

    width:
        100%;

    height:
        31px;

    border:
        1px solid
        #d8cabd;

    border-radius:
        5px;

    background:
        #eee6dd;

    padding:
        0 10px;

    color:
        #3f3129;

    font-size:
        10px;
}

.terms {

    display:
        flex;

    align-items:
        center;

    gap:
        6px;

    font-size:
        9px;

    margin:
        8px 0;
}

.register-card .sign {

    width:
        100%;

    height:
        31px;

    border:
        0;

    border-radius:
        4px;

    background:
        linear-gradient(
            #e7bd70,
            #c9913e
        );

    color:
        #352014;

    font-weight:
        700;
}

.ribbon {

    position:
        absolute;

    left:
        -10px;

    right:
        -10px;

    bottom:
        -14px;

    background:
        linear-gradient(
            #d8b564,
            #a97934
        );

    color:
        #3b260e;

    text-align:
        center;

    padding:
        8px 20px 10px;

    font-size:
        10px;

    clip-path:
        polygon(
            0 0,
            100% 0,
            94% 100%,
            50% 85%,
            6% 100%
        );
}

/* =========================================================
   LOBBY TABLES
========================================================= */

.section-title {

    margin:
        25px 0 9px;

    color:
        #c7a88a;

    font-size:
        17px;

    text-transform:
        uppercase;
}

.content-grid {

    display:
        grid;

    grid-template-columns:
        1fr 1fr 1fr 1.02fr;

    gap:
        12px;
}

.table-card,
.live-card {

    border:
        1px solid
        rgba(215,170,89,.45);

    background:
        linear-gradient(
            #351016,
            #1b090c
        );

    min-height:
        172px;

    border-radius:
        5px;

    overflow:
        hidden;
}

.table-visual {

    height:
        88px;

    position:
        relative;

    background:

        radial-gradient(
            ellipse at 50% 58%,
            #225744 0 28%,
            #1d372f 29% 40%,
            transparent 41%
        ),

        linear-gradient(
            135deg,
            #6f4030,
            #271013
        );
}

.table-visual:before {

    content:
        "♠  ♥  ♣";

    position:
        absolute;

    left:
        50%;

    top:
        47%;

    transform:
        translate(-50%,-50%);

    color:
        #e7dbc8;

    font-size:
        18px;
}

.table-body {

    padding:
        8px 9px;
}

.table-title {

    font-size:
        12px;

    color:
        #d8c3ad;
}

.table-meta {

    font-size:
        9px;

    color:
        #8e7667;

    line-height:
        1.5;
}

.join {

    float:
        right;

    margin-top:
        -28px;

    width:
        60px;

    height:
        22px;

    border:
        0;

    border-radius:
        4px;

    background:
        linear-gradient(
            #e8c276,
            #bd893d
        );

    color:
        #2c180d;

    font-size:
        9px;
}

.live-card {

    padding:
        12px;
}

.live-card h3 {

    margin:
        0 0 10px;

    color:
        #d2b89d;

    font-size:
        13px;
}

.feed-item {

    font-size:
        9px;

    color:
        #baa695;

    padding:
        6px 0;

    border-bottom:
        1px solid
        rgba(255,255,255,.05);
}

/* =========================================================
   MODALS
========================================================= */

.modal {

    position:
        fixed;

    inset:
        0;

    background:
        rgba(0,0,0,.72);

    display:
        none;

    align-items:
        center;

    justify-content:
        center;

    z-index:
        200;

    padding:
        18px;
}

.modal.open {

    display:
        flex;
}

.modal-box {

    width:
        min(600px,96vw);

    max-height:
        82vh;

    overflow:
        auto;

    background:
        linear-gradient(
            #2d0c12,
            #16070a
        );

    border:
        1px solid
        var(--gold);

    border-radius:
        10px;

    padding:
        20px;

    box-shadow:
        0 25px 80px
        #000;
}

.modal-head {

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;
}

.modal-head h2 {

    margin:
        0;

    color:
        var(--gold2);

    font-size:
        18px;
}

.close {

    background:
        none;

    border:
        0;

    color:
        #fff;

    font-size:
        22px;
}

.modal p,
.modal li {

    font-size:
        12px;

    color:
        #cbb9aa;

    line-height:
        1.6;
}

.login-form input {

    width:
        100%;

    height:
        38px;

    margin:
        6px 0;

    background:
        #1d1113;

    border:
        1px solid
        #5a3436;

    color:
        #fff;

    padding:
        0 10px;

    border-radius:
        5px;
}

.login-form button {

    width:
        100%;

    height:
        38px;

    margin-top:
        8px;

    background:
        linear-gradient(
            #e8c278,
            #bb8539
        );

    border:
        0;

    border-radius:
        5px;

    color:
        #2a160c;

    font-weight:
        700;
}

.t-item {

    display:
        grid;

    grid-template-columns:
        1fr auto;

    gap:
        7px;

    padding:
        8px 0;

    border-bottom:
        1px solid
        rgba(255,255,255,.05);

    font-size:
        10px;
}

.t-item b {

    color:
        #dcc69e;
}

.t-item span {

    color:
        #937d6d;
}

/* =========================================================
   CHAT
========================================================= */

.chat {

    position:
        fixed;

    right:
        18px;

    bottom:
        18px;

    z-index:
        150;
}

.chat-btn {

    width:
        46px;

    height:
        46px;

    border-radius:
        50%;

    border:
        0;

    background:
        linear-gradient(
            #d9b16a,
            #9d6c2d
        );

    font-size:
        20px;
}

.chat-box {

    position:
        absolute;

    right:
        0;

    bottom:
        56px;

    width:
        280px;

    background:
        #221014;

    border:
        1px solid
        var(--gold);

    border-radius:
        8px;

    padding:
        10px;

    display:
        none;
}

.chat-box.open {

    display:
        block;
}

.chat-log {

    height:
        150px;

    overflow:
        auto;

    background:
        #13090b;

    border-radius:
        5px;

    padding:
        8px;

    font-size:
        10px;

    color:
        #bca99a;
}

.chat-send {

    display:
        flex;

    gap:
        6px;

    margin-top:
        6px;
}

.chat-send input {

    flex:
        1;

    background:
        #12090b;

    border:
        1px solid
        #4e2e31;

    color:
        #fff;

    padding:
        7px;
}

.chat-send button {

    background:
        #c99443;

    border:
        0;

    padding:
        0 12px;
}

/* =========================================================
   GAME
========================================================= */

#game {

    display:
        none;

    min-height:
        100vh;

    padding:
        16px;

    background:
        #080405;
}

.game-top {

    width:
        min(1100px,96vw);

    margin:
        0 auto 12px;

    display:
        flex;

    flex-wrap:
        wrap;

    gap:
        8px;

    align-items:
        center;

    justify-content:
        space-between;
}

.game-brand {

    color:
        var(--gold2);

    font-size:
        18px;
}

.game-info {

    display:
        flex;

    gap:
        7px;

    flex-wrap:
        wrap;
}

.stat {

    padding:
        8px 10px;

    border:
        1px solid
        var(--line);

    border-radius:
        8px;

    background:
        #241014;

    font-size:
        10px;
}

.stat b {

    display:
        block;

    color:
        var(--gold2);

    font-size:
        13px;
}

.status {

    text-align:
        center;

    color:
        #f0ce8e;

    font-weight:
        700;

    margin:
        8px;
}

/* =========================================================
   GAME TABLE
========================================================= */

.table-board {

    width:
        min(1040px,96vw);

    height:
        520px;

    margin:
        auto;

    position:
        relative;

    border-radius:
        50% / 38%;

    border:
        15px solid
        #321a0c;

    background:
        radial-gradient(
            ellipse,
            #1f7656,
            #114634 62%,
            #09291f
        );

    box-shadow:

        0 25px 70px
        #000,

        inset 0 0 60px
        rgba(0,0,0,.4);
}

.seat {

    position:
        absolute;

    transform:
        translate(-50%,-50%);

    width:
        135px;

    text-align:
        center;
}

.seat-box {

    background:
        rgba(18,7,8,.9);

    border:
        1px solid
        rgba(215,170,89,.3);

    padding:
        7px;

    border-radius:
        8px;
}

.seat.current
.seat-box {

    border-color:
        var(--gold2);

    box-shadow:
        0 0 20px
        rgba(215,170,89,.4);
}

.seat-name {

    font-size:
        10px;
}

.seat-info {

    font-size:
        8px;

    color:
        #9d8675;
}

.card-backs {

    display:
        flex;

    justify-content:
        center;

    margin-top:
        4px;
}

.card-back {

    width:
        17px;

    height:
        25px;

    margin-left:
        -6px;

    border:
        1px solid
        var(--gold);

    border-radius:
        3px;

    background:
        repeating-linear-gradient(
            45deg,
            #311017 0 3px,
            #140709 3px 6px
        );
}

.card-back:first-child {

    margin-left:
        0;
}

#table-cards {

    position:
        absolute;

    left:
        50%;

    top:
        50%;

    transform:
        translate(-50%,-50%);

    display:
        flex;

    gap:
        10px;

    align-items:
        center;
}

.play-group {

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;
}

.play-name {

    font-size:
        8px;

    margin-bottom:
        4px;

    background:
        #130809;

    padding:
        3px 6px;

    border-radius:
        20px;
}

/* =========================================================
   CARDS
========================================================= */

.card {

    width:
        60px;

    height:
        88px;

    border-radius:
        8px;

    padding:
        6px;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        space-between;

    font-weight:
        700;

    box-shadow:
        0 7px 17px
        rgba(0,0,0,.45);

    user-select:
        none;
}

/* ♠ BLACK */

.suit-spades {

    color:
        #050608;

    background:
        linear-gradient(
            #fff,
            #e8e8e8
        );

    border:
        1px solid
        #353535;
}

/* ♣ EMERALD */

.suit-clubs {

    color:
        #006d52;

    background:
        linear-gradient(
            #fbfffd,
            #e1f2eb
        );

    border:
        1px solid
        #3b947e;
}

/* ♦ NAVY */

.suit-diamonds {

    color:
        #071f52;

    background:
        linear-gradient(
            #fbfcff,
            #e4ebf4
        );

    border:
        1px solid
        #536c9a;
}

/* ♥ BURGUNDY */

.suit-hearts {

    color:
        #6f1025;

    background:
        linear-gradient(
            #fffafb,
            #f4e1e6
        );

    border:
        1px solid
        #9b5666;
}

.card-center {

    text-align:
        center;

    font-size:
        28px;
}

.card-bottom {

    transform:
        rotate(180deg);
}

/* =========================================================
   CARD ANIMATION
========================================================= */

@keyframes fly {

    0% {

        opacity:
            0;

        transform:
            translateY(100px)
            scale(.65)
            rotate(-12deg);
    }

    55% {

        opacity:
            1;

        transform:
            translateY(-10px)
            scale(1.06)
            rotate(3deg);
    }

    100% {

        transform:
            none;
    }
}

.play-group
.card {

    animation:
        fly
        .55s
        cubic-bezier(
            .16,
            1,
            .3,
            1
        );
}

.play-group.winner
.card {

    box-shadow:
        0 0 26px
        var(--gold2);

    border:
        2px solid
        var(--gold2);
}

/* =========================================================
   PLAYER HAND
========================================================= */

.hand {

    width:
        min(900px,96vw);

    margin:
        15px auto;

    text-align:
        center;
}

#my-cards {

    display:
        flex;

    justify-content:
        center;

    gap:
        8px;

    flex-wrap:
        wrap;

    min-height:
        100px;

    align-items:
        flex-end;
}

#my-cards
.card {

    cursor:
        pointer;

    transition:
        .15s;
}

#my-cards
.card:hover {

    transform:
        translateY(-8px);
}

#my-cards
.card.selected {

    transform:
        translateY(-16px);

    box-shadow:
        0 0 24px
        var(--gold2);

    border:
        3px solid
        var(--gold2);
}

.play-btn {

    margin-top:
        10px;

    padding:
        10px 35px;

    border:
        0;

    border-radius:
        5px;

    background:
        linear-gradient(
            #e6c075,
            #b98235
        );

    font-weight:
        700;
}

.play-btn:disabled {

    background:
        #41363a;

    color:
        #7e7276;
}

/* =========================================================
   SCORE
========================================================= */

.score {

    width:
        min(860px,96vw);

    margin:
        15px auto;

    background:
        #1c0b0e;

    border:
        1px solid
        var(--line);

    border-radius:
        9px;

    overflow:
        hidden;
}

.score-head {

    padding:
        12px;

    color:
        var(--gold2);

    font-size:
        13px;

    border-bottom:
        1px solid
        var(--line);
}

.score-row {

    display:
        grid;

    grid-template-columns:
        60px
        1.3fr
        1fr
        1fr;

    align-items:
        center;

    min-height:
        46px;

    border-bottom:
        1px solid
        rgba(255,255,255,.05);

    font-size:
        10px;
}

.score-row > div {

    text-align:
        center;

    padding:
        7px;
}

.score-row.first {

    background:
        rgba(215,170,89,.08);
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(
    max-width:900px
) {

    .hero-row {

        grid-template-columns:
            1fr;
    }

    .register-card {

        margin-top:
            0;
    }

    .content-grid {

        grid-template-columns:
            1fr 1fr;
    }

    .subnav {

        margin-left:
            0;

        overflow:
            auto;
    }

    .top {

        flex-wrap:
            wrap;

        height:
            auto;

        padding:
            10px 0;
    }

    .search {

        margin-left:
            0;
    }

    .hero {

        height:
            230px;
    }

    .table-board {

        height:
            460px;
    }
}

@media(
    max-width:560px
) {

    .content-grid {

        grid-template-columns:
            1fr;
    }

    .hero-copy {

        left:
            22px;

        top:
            45px;

        width:
            70%;
    }

    .hero-copy h1 {

        font-size:
            21px;
    }

    .search input {

        width:
            160px;
    }

    .table-board {

        height:
            410px;

        border-width:
            9px;
    }

    .card {

        width:
            46px;

        height:
            68px;
    }

    .card-center {

        font-size:
            20px;
    }

    .seat {

        width:
            90px;
    }

    .score-row {

        grid-template-columns:
            45px
            1.2fr
            .8fr
            .8fr;
    }
}

</style>

</head>

<body>

<div id="lobby">

<div class="shell">

    <!-- TOP -->

    <div class="top">

        <div class="brand">

            WRITTEN

            <span>
                BURA
            </span>

        </div>

        <div class="search">

            <input
                id="searchInput"
                placeholder="SEARCH"
                oninput="renderLobbyTables()"
            >

        </div>

        <select
            id="languageSelect"
            class="top-link"
            onchange="changeLanguage()"
        >

            <option value="ka">
                ქართული
            </option>

            <option value="en">
                English
            </option>

        </select>

        <button
            class="top-link"
            onclick="openModal('supportModal')"
        >
            SUPPORT
        </button>

        <button
            class="top-btn"
            onclick="openModal('loginModal')"
        >
            LOGIN
        </button>

        <button
            class="top-btn gold"
            onclick="focusRegister()"
        >
            REGISTRATION
        </button>

    </div>

    <!-- NAV -->

    <div class="subnav">

        <button
            onclick="openModal('rulesModal')"
        >
            BURA RULES
        </button>

        <button
            onclick="openModal('tournamentsModal')"
        >
            TOURNAMENTS
        </button>

        <button
            onclick="openProfile()"
        >
            MY PROFILE
        </button>

        <button
            onclick="scrollToTables()"
        >
            TABLES
        </button>

    </div>

    <!-- HERO -->

    <div class="hero-row">

        <div class="hero">

            <div class="hero-copy">

                <h1>
                    WRITTEN BURA'S
                    <br>
                    EXCLUSIVE TABLES
                </h1>

                <p>
                    კლასიკური ბურა თანამედროვე ონლაინ მაგიდებზე.
                    აირჩიე ფსონი, მაგიდის ზომა და დაიწყე თამაში.
                </p>

                <button
                    onclick="scrollToTables()"
                >
                    PLAY NOW
                </button>

            </div>

            <div class="dots">

                <i></i>

                <i class="active"></i>

                <i></i>

            </div>

        </div>

        <!-- REGISTER -->

        <div
            class="register-card"
            id="registerCard"
        >

            <div class="register-title">

                REGISTRATION:

                <b>
                    BECOME A MEMBER OF WRITTEN BURA
                </b>

            </div>

            <div class="reg-field">

                <input
                    id="regEmail"
                    type="email"
                    placeholder="Email"
                >

            </div>

            <div class="reg-field">

                <input
                    id="regUsername"
                    placeholder="Username"
                >

            </div>

            <div class="reg-field">

                <input
                    id="regPassword"
                    type="password"
                    placeholder="Password"
                >

            </div>

            <label class="terms">

                <input
                    id="regTerms"
                    type="checkbox"
                >

                I accept the Terms

            </label>

            <button
                class="sign"
                onclick="registerUser()"
            >
                SIGN UP
            </button>

            <div
                id="regMessage"
                style="
                    font-size:9px;
                    margin-top:7px;
                "
            ></div>

            <div class="ribbon">

                Ready for a truly royal and great
                <br>
                Bura duel!

            </div>

        </div>

    </div>

    <!-- TABLES -->

    <h2
        class="section-title"
        id="tablesSection"
    >
        POPULAR TABLES
    </h2>

    <div
        class="content-grid"
        id="contentGrid"
    ></div>

</div>

</div>

<!-- ======================================================
     GAME
======================================================= -->

<div id="game">

    <div class="game-top">

        <div class="game-brand">
            WRITTEN BURA
        </div>

        <div class="game-info">

            <div class="stat">

                კოზირი

                <b id="trump">
                    -
                </b>

            </div>

            <div class="stat">

                პარტია

                <b id="partyNum">
                    -
                </b>

            </div>

            <div class="stat">

                ხელი

                <b id="handIndex">
                    -
                </b>

            </div>

            <div class="stat">

                დასტაში

                <b id="deckCount">
                    -
                </b>

            </div>

            <div class="stat">

                ფსონი

                <b id="gameStake">
                    -
                </b>

            </div>

        </div>

    </div>

    <div
        class="status"
        id="status"
    ></div>

    <div class="table-board">

        <div id="players"></div>

        <div id="table-cards"></div>

    </div>

    <div class="hand">

        <div id="my-cards"></div>

        <button
            id="playBtn"
            class="play-btn"
            disabled
            onclick="playSelected()"
        >
            ჩამოსვლა
        </button>

    </div>

    <div class="score">

        <div class="score-head">
            🏆 LIVE STANDINGS
        </div>

        <div id="scoreContent"></div>

    </div>

</div>

<!-- ======================================================
     LOGIN MODAL
======================================================= -->

<div
    class="modal"
    id="loginModal"
>

    <div class="modal-box">

        <div class="modal-head">

            <h2>
                LOGIN
            </h2>

            <button
                class="close"
                onclick="closeModal('loginModal')"
            >
                ×
            </button>

        </div>

        <div class="login-form">

            <input
                id="loginUsername"
                placeholder="Username"
            >

            <input
                id="loginPassword"
                type="password"
                placeholder="Password"
            >

            <button
                onclick="loginUser()"
            >
                LOGIN
            </button>

            <div
                id="loginMessage"
                style="
                    font-size:10px;
                    margin-top:8px;
                "
            ></div>

            <p>

                TEST MODE:
                username

                <b>
                    saba123
                </b>

                , password არ არის საჭირო.

            </p>

        </div>

    </div>

</div>

<!-- RULES -->

<div
    class="modal"
    id="rulesModal"
>

    <div class="modal-box">

        <div class="modal-head">

            <h2>
                BURA RULES
            </h2>

            <button
                class="close"
                onclick="closeModal('rulesModal')"
            >
                ×
            </button>

        </div>

        <p>
            თამაში მიმდინარეობს 36-კარტიანი დასტით:
            6, 7, 8, 9, J, Q, K, 10, A.
        </p>

        <ul>

            <li>
                J = 2 ქულა
            </li>

            <li>
                Q = 3 ქულა
            </li>

            <li>
                K = 4 ქულა
            </li>

            <li>
                10 = 10 ქულა
            </li>

            <li>
                A = 11 ქულა
            </li>

            <li>
                პირველი მოთამაშე ჩამოდის ერთი ცვეტის კარტებით.
            </li>

            <li>
                კოზირი სცემს უკოზირო ცვეტს.
            </li>

            <li>
                5 ერთი ცვეტის კარტი ითვლება მალიუტკად.
            </li>

            <li>
                საერთო ქულა ახლდება სრული ხელის დასრულების შემდეგ.
            </li>

        </ul>

    </div>

</div>

<!-- TOURNAMENTS -->

<div
    class="modal"
    id="tournamentsModal"
>

    <div class="modal-box">

        <div class="modal-head">

            <h2>
                TOURNAMENTS
            </h2>

            <button
                class="close"
                onclick="closeModal('tournamentsModal')"
            >
                ×
            </button>

        </div>

        <div id="tournamentsContent"></div>

    </div>

</div>

<!-- PROFILE -->

<div
    class="modal"
    id="profileModal"
>

    <div class="modal-box">

        <div class="modal-head">

            <h2>
                MY PROFILE
            </h2>

            <button
                class="close"
                onclick="closeModal('profileModal')"
            >
                ×
            </button>

        </div>

        <div id="profileContent"></div>

    </div>

</div>

<!-- SUPPORT -->

<div
    class="modal"
    id="supportModal"
>

    <div class="modal-box">

        <div class="modal-head">

            <h2>
                SUPPORT
            </h2>

            <button
                class="close"
                onclick="closeModal('supportModal')"
            >
                ×
            </button>

        </div>

        <p>
            დახმარება: თამაშის წესები, ანგარიში,
            მაგიდაზე შესვლა ან ტექნიკური პრობლემა.
        </p>

        <button
            class="top-btn gold"
            onclick="
                toggleChat();
                closeModal('supportModal');
            "
        >
            OPEN CHAT
        </button>

    </div>

</div>

<!-- CHAT -->

<div class="chat">

    <button
        class="chat-btn"
        onclick="toggleChat()"
    >
        💬
    </button>

    <div
        class="chat-box"
        id="chatBox"
    >

        <div
            class="chat-log"
            id="chatLog"
        >
            Support:
            მოგესალმებით WRITTEN BURA-ში.
            როგორ დაგეხმაროთ?
        </div>

        <div class="chat-send">

            <input
                id="chatInput"
                placeholder="Message..."
            >

            <button
                onclick="sendChat()"
            >
                SEND
            </button>

        </div>

    </div>

</div>

<script>

const socket =
    io();

let token =
    localStorage.getItem(
        'bura_token'
    );

let username =
    localStorage.getItem(
        'bura_username'
    );

let email =
    localStorage.getItem(
        'bura_email'
    ) || '';

let balance =
    Number(
        localStorage.getItem(
            'bura_balance'
        ) || 0
    );

let isTester =
    localStorage.getItem(
        'bura_tester'
    ) ===
    'true';

let lobbyState = {

    tables: [],

    feed: [],

    tournaments: [],

    online:
        0
};

let currentState =
    null;

let selectedCards =
    [];

/* =========================================================
   MODALS
========================================================= */

function openModal(
    id
) {

    document
        .getElementById(
            id
        )
        .classList
        .add(
            'open'
        );
}

function closeModal(
    id
) {

    document
        .getElementById(
            id
        )
        .classList
        .remove(
            'open'
        );
}

function focusRegister() {

    document
        .getElementById(
            'regEmail'
        )
        .focus();

    document
        .getElementById(
            'registerCard'
        )
        .scrollIntoView({

            behavior:
                'smooth',

            block:
                'center'
        });
}

function scrollToTables() {

    document
        .getElementById(
            'tablesSection'
        )
        .scrollIntoView({

            behavior:
                'smooth'
        });
}

/* =========================================================
   LANGUAGE
========================================================= */

function changeLanguage() {

    const value =
        document
            .getElementById(
                'languageSelect'
            )
            .value;

    document
        .documentElement
        .lang =
            value;

    if (
        value ===
        'en'
    ) {

        alert(
            'Language switched to English. Full translation can be added next.'
        );

    } else {

        alert(
            'ენა შეიცვალა ქართულზე.'
        );
    }
}

/* =========================================================
   REGISTER
========================================================= */

async function registerUser() {

    const body = {

        email:
            document
                .getElementById(
                    'regEmail'
                )
                .value
                .trim(),

        username:
            document
                .getElementById(
                    'regUsername'
                )
                .value
                .trim(),

        password:
            document
                .getElementById(
                    'regPassword'
                )
                .value,

        acceptedTerms:
            document
                .getElementById(
                    'regTerms'
                )
                .checked
    };

    const message =
        document
            .getElementById(
                'regMessage'
            );

    message.textContent =
        'Registering...';

    try {

        const response =
            await fetch(
                '/api/register',
                {

                    method:
                        'POST',

                    headers: {

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify(
                            body
                        )
                }
            );

        const data =
            await response.json();

        if (
            !response.ok
            ||
            !data.ok
        ) {

            message.textContent =
                data.message ||
                'Registration failed';

            return;
        }

        saveLogin(
            data
        );

        message.textContent =
            '✓ Registration successful. Balance $1,000';

    } catch (
        error
    ) {

        message.textContent =
            'Server connection failed.';
    }
}

/* =========================================================
   LOGIN
========================================================= */

async function loginUser() {

    const user =
        document
            .getElementById(
                'loginUsername'
            )
            .value
            .trim();

    const password =
        document
            .getElementById(
                'loginPassword'
            )
            .value;

    const message =
        document
            .getElementById(
                'loginMessage'
            );

    message.textContent =
        'Logging in...';

    try {

        const response =
            await fetch(
                '/api/login',
                {

                    method:
                        'POST',

                    headers: {

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({

                            username:
                                user,

                            password
                        })
                }
            );

        const data =
            await response.json();

        if (
            !response.ok
            ||
            !data.ok
        ) {

            message.textContent =
                data.message ||
                'Login failed';

            return;
        }

        saveLogin(
            data
        );

        message.textContent =
            data.isTester
                ?
                '🧪 TEST MODE active'
                :
                '✓ Login successful';

        setTimeout(
            () => {

                closeModal(
                    'loginModal'
                );

            },
            500
        );

    } catch (
        error
    ) {

        message.textContent =
            'Server connection failed.';
    }
}

function saveLogin(
    data
) {

    token =
        data.token;

    username =
        data.username;

    email =
        data.email ||
        '';

    balance =
        Number(
            data.balance ||
            0
        );

    isTester =
        !!data.isTester;

    localStorage.setItem(
        'bura_token',
        token
    );

    localStorage.setItem(
        'bura_username',
        username
    );

    localStorage.setItem(
        'bura_email',
        email
    );

    localStorage.setItem(
        'bura_balance',
        String(
            balance
        )
    );

    localStorage.setItem(
        'bura_tester',
        String(
            isTester
        )
    );
}

/* =========================================================
   PROFILE
========================================================= */

function openProfile() {

    const content =
        document
            .getElementById(
                'profileContent'
            );

    if (
        !token
    ) {

        content.innerHTML =
            '<p>ანგარიშში შესული არ ხარ.</p>'
            +
            '<button class="top-btn gold" '
            +
            'onclick="closeModal(\\'profileModal\\');openModal(\\'loginModal\\')">'
            +
            'LOGIN'
            +
            '</button>';

    } else {

        content.innerHTML =
            '<p><b>Username:</b> '
            +
            escapeHtml(
                username
            )
            +
            '</p>'
            +
            '<p><b>Email:</b> '
            +
            escapeHtml(
                email ||
                '-'
            )
            +
            '</p>'
            +
            '<p><b>Balance:</b> $'
            +
            balance
            +
            '</p>'
            +
            '<p><b>Mode:</b> '
            +
            (
                isTester
                    ?
                    'TESTER'
                    :
                    'PLAYER'
            )
            +
            '</p>';
    }

    openModal(
        'profileModal'
    );
}

/* =========================================================
   LOBBY UPDATE
========================================================= */

socket.on(
    'lobbyUpdate',
    state => {

        lobbyState =
            state ||
            lobbyState;

        renderLobbyTables();

        renderTournaments();
    }
);

/* =========================================================
   TABLES
========================================================= */

function renderLobbyTables() {

    const grid =
        document
            .getElementById(
                'contentGrid'
            );

    const query =
        (
            document
                .getElementById(
                    'searchInput'
                )
                .value ||
            ''
        )
        .toLowerCase();

    const tables =
        (
            lobbyState.tables ||
            []
        )
        .filter(
            table => {

                return (
                    !query
                    ||
                    table.label
                        .toLowerCase()
                        .includes(
                            query
                        )
                    ||
                    String(
                        table.stake
                    ).includes(
                        query
                    )
                    ||
                    String(
                        table.capacity
                    ).includes(
                        query
                    )
                );
            }
        );

    let html =
        '';

    tables
        .slice(
            0,
            3
        )
        .forEach(
            table => {

                html +=
                    '<div class="table-card">'
                    +
                    '<div class="table-visual"></div>'
                    +
                    '<div class="table-body">'
                    +
                    '<div class="table-title">'
                    +
                    escapeHtml(
                        table.label
                    )
                    +
                    '</div>'
                    +
                    '<div class="table-meta">'
                    +
                    'Pot: $'
                    +
                    table.stake
                    +
                    '<br>'
                    +
                    table.capacity
                    +
                    ' players · waiting '
                    +
                    table.waiting
                    +
                    '</div>'
                    +
                    '<button class="join" onclick="quickJoin('
                    +
                    table.stake
                    +
                    ','
                    +
                    table.capacity
                    +
                    ')">'
                    +
                    'JOIN'
                    +
                    '</button>'
                    +
                    '</div>'
                    +
                    '</div>';
            }
        );

    const feed =
        (
            lobbyState.feed ||
            []
        )
        .slice(
            0,
            5
        );

    html +=
        '<div class="live-card">'
        +
        '<h3>LIVE FEED</h3>';

    if (
        feed.length
    ) {

        feed.forEach(
            item => {

                html +=
                    '<div class="feed-item">'
                    +
                    escapeHtml(
                        item.text
                    )
                    +
                    '</div>';
            }
        );

    } else {

        html +=
            '<div class="feed-item">'
            +
            'No live activity yet.'
            +
            '</div>';
    }

    html +=
        '</div>';

    grid.innerHTML =
        html;
}

/* =========================================================
   TOURNAMENTS
========================================================= */

function renderTournaments() {

    const content =
        document
            .getElementById(
                'tournamentsContent'
            );

    if (
        !content
    ) {

        return;
    }

    let html =
        '';

    (
        lobbyState.tournaments ||
        []
    )
    .forEach(
        tournament => {

            html +=
                '<div class="t-item">'
                +
                '<div>'
                +
                '<b>'
                +
                escapeHtml(
                    tournament.name
                )
                +
                '</b>'
                +
                '<br>'
                +
                '<span>'
                +
                tournament.date
                +
                ' · '
                +
                tournament.players
                +
                ' players'
                +
                '</span>'
                +
                '</div>'
                +
                '<div>'
                +
                'Prize $'
                +
                tournament.prize
                +
                '</div>'
                +
                '</div>';
        }
    );

    content.innerHTML =
        html ||
        '<p>No tournaments scheduled.</p>';
}

/* =========================================================
   JOIN
========================================================= */

function quickJoin(
    stake,
    capacity
) {

    if (
        !token
    ) {

        openModal(
            'loginModal'
        );

        return;
    }

    socket.emit(
        'joinTable',
        {

            token,

            stake,

            capacity,

            parties:
                1
        }
    );
}

socket.on(
    'waitingForPlayers',
    data => {

        alert(
            'Waiting for players: '
            +
            data.current
            +
            '/'
            +
            data.max
        );
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
    'playerLeft',
    () => {

        const status =
            document
                .getElementById(
                    'status'
                );

        if (
            status
        ) {

            status.textContent =
                'მოთამაშემ მაგიდა დატოვა.';
        }
    }
);

/* =========================================================
   GAME STATE
========================================================= */

socket.on(
    'gameStateUpdate',
    state => {

        if (
            !state
        ) {

            return;
        }

        currentState =
            state;

        selectedCards =
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

        renderGame(
            state
        );
    }
);

function renderGame(
    state
) {

    document
        .getElementById(
            'trump'
        )
        .textContent =
            trumpName(
                state.trump
            );

    document
        .getElementById(
            'partyNum'
        )
        .textContent =
            state.partyNum
            +
            '/'
            +
            state.targetParties;

    document
        .getElementById(
            'handIndex'
        )
        .textContent =
            state.handIndex
            +
            '/'
            +
            state.totalHands;

    document
        .getElementById(
            'deckCount'
        )
        .textContent =
            state.deckCount;

    document
        .getElementById(
            'gameStake'
        )
        .textContent =
            '$'
            +
            state.stake;

    renderPlayers(
        state
    );

    renderTableCards(
        state
    );

    renderMyCards(
        state
    );

    renderScore(
        state
    );

    updateStatus(
        state
    );
}

/* =========================================================
   PLAYER POSITIONS
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

    const three = [

        {
            left:
                50,

            top:
                88
        },

        {
            left:
                20,

            top:
                24
        },

        {
            left:
                80,

            top:
                24
        }
    ];

    const four = [

        {
            left:
                50,

            top:
                88
        },

        {
            left:
                11,

            top:
                50
        },

        {
            left:
                50,

            top:
                12
        },

        {
            left:
                89,

            top:
                50
        }
    ];

    return (
        count ===
        4
            ?
            four
            :
            three
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

    const container =
        document
            .getElementById(
                'players'
            );

    container.innerHTML =
        '';

    state.players
        .forEach(
            (
                player,
                index
            ) => {

                const seat =
                    document
                        .createElement(
                            'div'
                        );

                seat.className =
                    'seat'
                    +
                    (
                        player.isCurrent
                            ?
                            ' current'
                            :
                            ''
                    );

                const position =
                    seatPosition(
                        index,
                        state.players.length,
                        state.viewingPlayerId,
                        state.players
                    );

                seat.style.left =
                    position.left
                    +
                    '%';

                seat.style.top =
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
                            '<div class="card-back"></div>';
                    }
                }

                seat.innerHTML =
                    '<div class="seat-box">'
                    +
                    '<div class="seat-name">'
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
                    '<div class="seat-info">'
                    +
                    'cards '
                    +
                    player.cardCount
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
                    '<div class="card-backs">'
                    +
                    backs
                    +
                    '</div>'
                    +
                    '</div>';

                container.appendChild(
                    seat
                );
            }
        );
}

/* =========================================================
   TABLE CARDS
========================================================= */

function renderTableCards(
    state
) {

    const container =
        document
            .getElementById(
                'table-cards'
            );

    container.innerHTML =
        '';

    state.table
        .forEach(
            play => {

                const group =
                    document
                        .createElement(
                            'div'
                        );

                group.className =
                    'play-group'
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
                    'play-name';

                name.textContent =
                    play.playerName;

                group.appendChild(
                    name
                );

                play.cards
                    .forEach(
                        card => {

                            group.appendChild(
                                createCard(
                                    card
                                )
                            );
                        }
                    );

                container.appendChild(
                    group
                );
            }
        );
}

/* =========================================================
   MY CARDS
========================================================= */

function renderMyCards(
    state
) {

    const container =
        document
            .getElementById(
                'my-cards'
            );

    container.innerHTML =
        '';

    const cards =
        state.playersCards[
            state.viewingPlayerId
        ] ||
        [];

    cards.forEach(
        (
            card,
            index
        ) => {

            const element =
                createCard(
                    card
                );

            element.onclick =
                () => {

                    toggleCard(
                        index,
                        element
                    );
                };

            container.appendChild(
                element
            );
        }
    );

    updatePlayButton(
        state
    );
}

function createCard(
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

    const suit =
        suitSymbol(
            card.suit
        );

    element.innerHTML =
        '<div>'
        +
        escapeHtml(
            card.rank
        )
        +
        ' '
        +
        suit
        +
        '</div>'
        +
        '<div class="card-center">'
        +
        suit
        +
        '</div>'
        +
        '<div class="card-bottom">'
        +
        escapeHtml(
            card.rank
        )
        +
        ' '
        +
        suit
        +
        '</div>';

    return element;
}

/* =========================================================
   SELECT
========================================================= */

function toggleCard(
    index,
    element
) {

    const found =
        selectedCards
            .indexOf(
                index
            );

    if (
        found >=
        0
    ) {

        selectedCards.splice(
            found,
            1
        );

        element
            .classList
            .remove(
                'selected'
            );

    } else {

        selectedCards.push(
            index
        );

        element
            .classList
            .add(
                'selected'
            );
    }

    updatePlayButton(
        currentState
    );
}

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
        selectedCards.length ===
        0
        ||
        state.isProcessing
        ||
        state.gameOver;
}

function playSelected() {

    if (
        !selectedCards.length
    ) {

        return;
    }

    socket.emit(
        'playCards',
        {

            cardIndices:
                selectedCards.slice()
        }
    );

    selectedCards =
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

        return;
    }

    if (
        state.isProcessing
    ) {

        element.textContent =
            '✨ კარტები ითვლება...';

        return;
    }

    const active =
        state.players[
            state.currentTurnIndex
        ];

    if (
        !active
    ) {

        return;
    }

    if (
        active.id ===
        state.viewingPlayerId
    ) {

        element.textContent =
            '🎯 შენი სვლაა';

    } else if (
        active.isBot
    ) {

        element.textContent =
            '🤖 '
            +
            active.name
            +
            ' თამაშობს...';

    } else {

        element.textContent =
            active.name
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

    const container =
        document
            .getElementById(
                'scoreContent'
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
        '<div class="score-row">'
        +
        '<div>#</div>'
        +
        '<div>PLAYER</div>'
        +
        '<div>LAST HAND</div>'
        +
        '<div>TOTAL</div>'
        +
        '</div>';

    players.forEach(
        (
            player,
            index
        ) => {

            const medal =
                index ===
                0
                    ?
                    '🥇'
                    :
                    (
                        index ===
                        1
                            ?
                            '🥈'
                            :
                            (
                                index ===
                                2
                                    ?
                                    '🥉'
                                    :
                                    '#'
                                    +
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
                '<div class="score-row '
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
                medal
                +
                '</div>'
                +
                '<div>'
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
                '<div>'
                +
                lastScore
                +
                '</div>'
                +
                '<div><b>'
                +
                player.totalPoints
                +
                '</b></div>'
                +
                '</div>';
        }
    );

    container.innerHTML =
        html;
}

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

        hearts:
            '♥',

        diamonds:
            '♦'

    }[
        suit
    ] ||
    '';
}

function trumpName(
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
   CHAT
========================================================= */

function toggleChat() {

    document
        .getElementById(
            'chatBox'
        )
        .classList
        .toggle(
            'open'
        );
}

function sendChat() {

    const input =
        document
            .getElementById(
                'chatInput'
            );

    const value =
        input.value
            .trim();

    if (
        !value
    ) {

        return;
    }

    const log =
        document
            .getElementById(
                'chatLog'
            );

    log.innerHTML +=
        '<br><br>'
        +
        'You: '
        +
        escapeHtml(
            value
        )
        +
        '<br>'
        +
        'Support: შეტყობინება მიღებულია. '
        +
        'სატესტო ჩატში პასუხი ავტომატურია.';

    log.scrollTop =
        log.scrollHeight;

    input.value =
        '';
}

renderLobbyTables();

</script>

</body>

</html>
`;

/* =========================================================
   PAGE
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

/* =========================================================
   START
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            'WRITTEN BURA started on port',
            PORT
        );

        console.log(
            'Deck:',
            createDeck().length,
            'cards'
        );

        console.log(
            'Tester:',
            TESTER_USERNAME
        );
    }
);
