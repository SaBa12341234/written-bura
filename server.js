const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

const PORT = process.env.PORT || 10000;

app.use(express.json());

const TESTER_USERNAME = 'saba123';
const STARTING_BALANCE = 1000;

const USERS_FILE = path.join(
    __dirname,
    'users.json'
);

const ALLOWED_CAPACITIES = [
    3,
    4
];

const ALLOWED_STAKES = [
    5,
    10,
    25,
    50,
    100
];

const MAX_PARTIES = 4;

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

    users = [];
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
                        'რეგისტრაციისთვის მონიშნე წესებსა და პირობებზე თანხმობა.'
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

            deck:
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
            Date.now()
    });

    if (
        liveFeed.length >
        10
    ) {

        liveFeed.length =
            10;
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
   NEW HAND
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
   RULES
========================================================= */

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
   CLIENT STATE
========================================================= */

function getClientGameState(
    room,
    forPlayerId,
    revealAll =
        false
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

    const visibleCards =
        {};

    /*
        TESTER ხედავს ყველას კარტს.
    */

    if (
        revealAll
    ) {

        for (
            const player of
            room.players
        ) {

            visibleCards[
                player.id
            ] =
                gs.playersCards[
                    player.id
                ] ||
                [];
        }

    } else if (
        forPlayerId
        &&
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

        lastHandScores:
            gs.lastHandScores ||
            {},

        gameOver:
            gs.gameOver,

        testerRevealAll:
            revealAll
    };
}

/* =========================================================
   BROADCAST
========================================================= */

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

        const revealAll =
            !!player.isTester;

        io.to(
            player.id
        ).emit(
            'gameStateUpdate',
            getClientGameState(
                room,
                player.id,
                revealAll
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
            room.players.length;

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

            /*
                სატესტო მიმდინარე წესი:
                0 ქულა = -120
            */

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
   TRICK
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

            const allEmpty =
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
                allEmpty
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
        1100
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
        600
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

            const waitingRooms =
                Object.values(
                    rooms
                )
                .filter(
                    room =>
                        !room.gameState
                        &&
                        room.stake ===
                        stake
                        &&
                        room.maxPlayers ===
                        capacity
                );

            tables.push({

                id:
                    stake +
                    '-' +
                    capacity,

                stake,

                capacity,

                waiting:
                    waitingRooms.reduce(
                        (
                            sum,
                            room
                        ) =>
                            sum +
                            room.players.length,
                        0
                    ),

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
                                'CLASSIC TABLE'
                        )
            });
        }
    }

    return {

        online:
            io.engine
                .clientsCount,

        tables,

        feed:
            liveFeed,

        tournaments: [

            {

                id:
                    1,

                name:
                    'Autumn Crown',

                date:
                    '22.09.2026',

                prize:
                    1500,

                players:
                    32
            },

            {

                id:
                    2,

                name:
                    'Royal Four',

                date:
                    '29.09.2026',

                prize:
                    3000,

                players:
                    64
            },

            {

                id:
                    3,

                name:
                    'Written Bura Cup',

                date:
                    '06.10.2026',

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

        /* =================================================
           JOIN
        ================================================= */

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
                            MAX_PARTIES,
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
                    )
                    .find(
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
                    TEST MODE:
                    დარჩენილი ადგილები
                    ავტომატურად შეივსება.
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

        /* =================================================
           PLAY
        ================================================= */

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

        /* =================================================
           DISCONNECT
        ================================================= */

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
<!doctype html>

<html lang="ka">

<head>

<meta charset="utf-8">

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
        Inter,
        Arial,
        sans-serif;

    background:
        #100307;

    color:
        #f6eadc;
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
        #2a0710;

    --wine2:
        #420b18;

    --gold:
        #d8ae62;

    --gold2:
        #f0cf88;

    --cream:
        #efe2cf;

    --muted:
        #aa9684;

    --line:
        rgba(216,174,98,.28);
}

body {

    background:

        radial-gradient(
            circle at 50% 10%,
            rgba(109,25,42,.45),
            transparent 32%
        ),

        linear-gradient(
            135deg,
            #100307,
            #270710 48%,
            #100307
        );

    min-height:
        100vh;
}

.shell {

    width:
        min(1180px,96vw);

    margin:
        auto;

    padding-bottom:
        35px;
}

/* =========================================================
   HEADER
========================================================= */

.topbar {

    display:
        flex;

    align-items:
        center;

    gap:
        12px;

    min-height:
        70px;
}

.brand {

    font-family:
        Georgia,
        serif;

    font-size:
        22px;

    line-height:
        .9;

    color:
        var(--cream);

    min-width:
        170px;
}

.brand b {

    display:
        block;

    font-size:
        34px;

    color:
        var(--gold2);
}

.search {

    margin-left:
        auto;
}

.search input {

    width:
        210px;

    height:
        34px;

    background:
        #2a2022;

    border:
        1px solid
        #4b3538;

    color:
        white;

    border-radius:
        5px;

    padding:
        0 10px;
}

.topbtn {

    border:
        1px solid
        var(--gold);

    color:
        #e9dbc8;

    background:
        transparent;

    border-radius:
        5px;

    padding:
        8px 12px;

    font-size:
        11px;
}

.topbtn.gold {

    background:
        linear-gradient(
            #efcc89,
            #b88740
        );

    color:
        #2d170d;
}

.subnav {

    display:
        flex;

    gap:
        20px;

    margin-left:
        210px;

    border-top:
        1px solid
        rgba(255,255,255,.04);

    border-bottom:
        1px solid
        var(--line);

    padding:
        9px 0;
}

.subnav button {

    background:
        none;

    border:
        0;

    color:
        #b49c89;

    font-size:
        11px;
}

.userPill {

    display:
        none;

    padding:
        6px 10px;

    border:
        1px solid
        var(--line);

    border-radius:
        20px;

    font-size:
        11px;

    color:
        #e8d6c2;
}

.userPill.show {

    display:
        block;
}

/* =========================================================
   HERO
========================================================= */

.heroRow {

    display:
        grid;

    grid-template-columns:
        1fr 280px;

    gap:
        14px;

    margin-top:
        14px;
}

.hero {

    height:
        290px;

    border:
        1px solid
        var(--gold);

    border-radius:
        6px;

    position:
        relative;

    overflow:
        hidden;

    background:

        linear-gradient(
            90deg,
            rgba(28,6,11,.95),
            rgba(91,43,36,.72)
        ),

        radial-gradient(
            circle at 72% 48%,
            #b47d60 0 15%,
            transparent 16%
        ),

        linear-gradient(
            135deg,
            #43141b,
            #171012
        );
}

.hero:after {

    content:
        "♠  ♥  ♦  ♣";

    position:
        absolute;

    right:
        24px;

    bottom:
        25px;

    font-size:
        56px;

    letter-spacing:
        8px;

    color:
        rgba(245,220,177,.14);

    transform:
        rotate(-7deg);
}

.heroCopy {

    position:
        absolute;

    left:
        34px;

    top:
        55px;

    width:
        390px;
}

.heroCopy h1 {

    font-family:
        Georgia,
        serif;

    color:
        #e5c69d;

    font-size:
        29px;

    line-height:
        1.03;

    margin:
        0 0 14px;
}

.heroCopy p {

    color:
        #c2aa98;

    font-size:
        13px;

    line-height:
        1.6;
}

.heroCopy button {

    margin-top:
        10px;

    width:
        130px;

    height:
        38px;

    border:
        0;

    border-radius:
        5px;

    background:
        linear-gradient(
            #efca81,
            #bd873b
        );

    font-weight:
        800;

    color:
        #2b170d;
}

/* =========================================================
   REGISTER
========================================================= */

.regCard {

    background:
        linear-gradient(
            #eadfd3,
            #cdbbaa
        );

    color:
        #584738;

    border:
        1px solid
        #c5a66d;

    border-radius:
        10px;

    padding:
        18px;

    box-shadow:
        0 20px 35px
        rgba(0,0,0,.35);

    position:
        relative;
}

.regCard h3 {

    font-family:
        Georgia,
        serif;

    color:
        #8d6b47;

    font-size:
        16px;

    margin:
        0 0 4px;
}

.regCard h3 b {

    display:
        block;

    color:
        #4a382e;

    font-size:
        17px;
}

.regCard input {

    width:
        100%;

    height:
        34px;

    margin:
        6px 0;

    background:
        #f2ebe4;

    border:
        1px solid
        #d5c7bb;

    border-radius:
        5px;

    padding:
        0 10px;
}

.terms {

    font-size:
        10px;

    display:
        flex;

    gap:
        6px;

    align-items:
        center;

    margin:
        8px 0;
}

.regCard .sign {

    width:
        100%;

    height:
        34px;

    border:
        0;

    border-radius:
        5px;

    background:
        linear-gradient(
            #e9c477,
            #c08a3c
        );

    color:
        #321d11;

    font-weight:
        800;
}

.msg {

    font-size:
        10px;

    min-height:
        16px;

    margin-top:
        8px;
}

/* =========================================================
   LOBBY
========================================================= */

.sectionTitle {

    font-family:
        Georgia,
        serif;

    color:
        #c6a98e;

    font-size:
        18px;

    margin:
        26px 0 10px;
}

.lobbyGrid {

    display:
        grid;

    grid-template-columns:
        repeat(3,1fr)
        1.1fr;

    gap:
        12px;
}

.tableCard,
.feedCard {

    border:
        1px solid
        rgba(216,174,98,.4);

    background:
        linear-gradient(
            #371018,
            #1b090d
        );

    border-radius:
        6px;

    overflow:
        hidden;
}

.tableVisual {

    height:
        90px;

    background:

        radial-gradient(
            ellipse at 50% 58%,
            #215b45 0 29%,
            #1e3c31 30% 42%,
            transparent 43%
        ),

        linear-gradient(
            135deg,
            #714636,
            #281015
        );

    position:
        relative;
}

.tableVisual:before {

    content:
        "♠  ♥  ♣";

    position:
        absolute;

    left:
        50%;

    top:
        48%;

    transform:
        translate(-50%,-50%);

    font-size:
        19px;

    color:
        #e7dbc8;
}

.tableBody {

    padding:
        9px;
}

.tableTitle {

    color:
        #e1c8ae;

    font-size:
        13px;
}

.tableMeta {

    color:
        #9d8370;

    font-size:
        10px;

    line-height:
        1.45;

    margin-top:
        4px;
}

.joinBtn {

    float:
        right;

    margin-top:
        -30px;

    width:
        62px;

    height:
        24px;

    border:
        0;

    border-radius:
        4px;

    background:
        linear-gradient(
            #eac478,
            #bb873d
        );

    color:
        #2a170d;

    font-size:
        10px;
}

.feedCard {

    padding:
        12px;
}

.feedCard h3 {

    margin:
        0 0 9px;

    color:
        #ddc0a1;
}

.feedItem {

    font-size:
        10px;

    color:
        #bda998;

    padding:
        7px 0;

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
        rgba(0,0,0,.75);

    display:
        none;

    align-items:
        center;

    justify-content:
        center;

    z-index:
        1000;

    padding:
        20px;
}

.modal.open {

    display:
        flex;
}

.modalBox {

    width:
        min(620px,96vw);

    max-height:
        86vh;

    overflow:
        auto;

    background:
        linear-gradient(
            #301018,
            #16070b
        );

    border:
        1px solid
        var(--gold);

    border-radius:
        10px;

    padding:
        20px;
}

.modalHead {

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;
}

.modalHead h2 {

    color:
        var(--gold2);

    font-family:
        Georgia,
        serif;
}

.closeBtn {

    background:
        none;

    border:
        0;

    color:
        white;

    font-size:
        24px;
}

.modalBox p,
.modalBox li {

    font-size:
        13px;

    color:
        #cfbbab;

    line-height:
        1.6;
}

.loginForm input {

    width:
        100%;

    height:
        40px;

    margin:
        6px 0;

    background:
        #1b1113;

    border:
        1px solid
        #5c373b;

    color:
        white;

    padding:
        0 10px;

    border-radius:
        5px;
}

.loginForm button {

    width:
        100%;

    height:
        40px;

    margin-top:
        8px;

    border:
        0;

    border-radius:
        5px;

    background:
        linear-gradient(
            #efc97f,
            #b8843b
        );

    font-weight:
        800;
}

.profileStat {

    padding:
        10px;

    border-bottom:
        1px solid
        rgba(255,255,255,.06);

    font-size:
        13px;
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
        900;
}

.chatBtn {

    width:
        48px;

    height:
        48px;

    border-radius:
        50%;

    border:
        0;

    background:
        linear-gradient(
            #dfbd74,
            #a17130
        );

    font-size:
        20px;
}

.chatBox {

    position:
        absolute;

    right:
        0;

    bottom:
        58px;

    width:
        290px;

    background:
        #221015;

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

.chatBox.open {

    display:
        block;
}

.chatLog {

    height:
        150px;

    overflow:
        auto;

    background:
        #12090b;

    padding:
        8px;

    font-size:
        10px;

    color:
        #baa796;
}

.chatSend {

    display:
        flex;

    gap:
        5px;

    margin-top:
        6px;
}

.chatSend input {

    flex:
        1;

    background:
        #130a0c;

    border:
        1px solid
        #4e2d31;

    color:
        white;

    padding:
        7px;
}

.chatSend button {

    background:
        #c99545;

    border:
        0;
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
        #070405;
}

.gameTop {

    width:
        min(1120px,96vw);

    margin:
        auto;

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
}

.gameBrand {

    font-family:
        Georgia,
        serif;

    color:
        var(--gold2);

    font-size:
        20px;
}

.gameStats {

    display:
        flex;

    gap:
        7px;

    flex-wrap:
        wrap;
}

.stat {

    min-width:
        90px;

    padding:
        8px 10px;

    border:
        1px solid
        var(--line);

    border-radius:
        8px;

    background:
        linear-gradient(
            #291015,
            #15080b
        );

    font-size:
        9px;

    color:
        #a99483;
}

.stat b {

    display:
        block;

    color:
        #f2d493;

    font-size:
        14px;

    margin-top:
        2px;
}

.status {

    text-align:
        center;

    color:
        #f0ce8e;

    font-weight:
        800;

    margin:
        9px;
}

/* =========================================================
   TABLE
========================================================= */

.tableBoard {

    width:
        min(1040px,96vw);

    height:
        530px;

    margin:
        auto;

    position:
        relative;

    border-radius:
        50% / 38%;

    border:
        15px solid
        #321a0d;

    background:
        radial-gradient(
            ellipse,
            #227657,
            #124933 62%,
            #09291f
        );

    box-shadow:

        0 28px 75px
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
        145px;

    text-align:
        center;
}

.seatBox {

    background:
        rgba(18,7,9,.9);

    border:
        1px solid
        rgba(216,174,98,.3);

    padding:
        7px;

    border-radius:
        9px;
}

.seat.current
.seatBox {

    border-color:
        var(--gold2);

    box-shadow:
        0 0 20px
        rgba(216,174,98,.45);
}

.seatName {

    font-size:
        10px;

    font-weight:
        800;
}

.seatInfo {

    font-size:
        8px;

    color:
        #9f8875;

    margin-top:
        2px;
}

.cardBacks {

    display:
        flex;

    justify-content:
        center;

    margin-top:
        4px;
}

.cardBack {

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

.cardBack:first-child {

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

    max-width:
        65%;
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

    margin-bottom:
        4px;

    background:
        #130809;

    padding:
        3px 7px;

    border-radius:
        20px;
}

/* =========================================================
   CARDS
========================================================= */

.card {

    width:
        62px;

    height:
        90px;

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
        800;

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

.cardCenter {

    text-align:
        center;

    font-size:
        28px;
}

.cardBottom {

    transform:
        rotate(180deg);
}

/* =========================================================
   ANIMATION
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

.playGroup
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

.playGroup.winner
.card {

    box-shadow:
        0 0 26px
        var(--gold2);

    border:
        2px solid
        var(--gold2);
}

/* =========================================================
   HAND
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

.playBtn {

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
        800;
}

.playBtn:disabled {

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
        min(900px,96vw);

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

.scoreHead {

    padding:
        12px;

    color:
        var(--gold2);

    font-weight:
        800;

    border-bottom:
        1px solid
        var(--line);
}

.scoreRow {

    display:
        grid;

    grid-template-columns:
        60px
        1.4fr
        1fr
        1fr;

    align-items:
        center;

    min-height:
        48px;

    border-bottom:
        1px solid
        rgba(255,255,255,.05);

    font-size:
        10px;
}

.scoreRow > div {

    text-align:
        center;

    padding:
        7px;
}

.scoreRow.first {

    background:
        rgba(216,174,98,.08);
}

/* =========================================================
   TESTER PANEL
========================================================= */

.testerPanel {

    width:
        min(900px,96vw);

    margin:
        12px auto;

    padding:
        10px;

    border:
        1px solid
        rgba(168,105,220,.35);

    background:
        rgba(92,35,126,.12);

    border-radius:
        8px;

    display:
        none;
}

.testerPanel.show {

    display:
        block;
}

.testerPanel h3 {

    margin:
        0 0 7px;

    color:
        #d9b7f2;

    font-size:
        12px;
}

.testerCards {

    display:
        grid;

    grid-template-columns:
        repeat(3,1fr);

    gap:
        8px;
}

.testerHand {

    background:
        #120b14;

    border:
        1px solid
        rgba(255,255,255,.07);

    border-radius:
        6px;

    padding:
        8px;
}

.testerHand b {

    font-size:
        10px;

    color:
        #d8c6df;
}

.miniCards {

    display:
        flex;

    gap:
        3px;

    flex-wrap:
        wrap;

    margin-top:
        5px;
}

.miniCard {

    font-size:
        10px;

    background:
        #f3eee7;

    color:
        #17100e;

    border-radius:
        3px;

    padding:
        2px 4px;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(
    max-width:900px
) {

    .heroRow {

        grid-template-columns:
            1fr;
    }

    .lobbyGrid {

        grid-template-columns:
            1fr 1fr;
    }

    .subnav {

        margin-left:
            0;

        overflow:
            auto;
    }

    .topbar {

        flex-wrap:
            wrap;
    }

    .search {

        margin-left:
            0;
    }

    .testerCards {

        grid-template-columns:
            1fr 1fr;
    }

    .tableBoard {

        height:
            470px;
    }
}

@media(
    max-width:560px
) {

    .lobbyGrid {

        grid-template-columns:
            1fr;
    }

    .heroCopy {

        left:
            20px;

        top:
            40px;

        width:
            72%;
    }

    .heroCopy h1 {

        font-size:
            22px;
    }

    .tableBoard {

        height:
            410px;

        border-width:
            9px;
    }

    .card {

        width:
            47px;

        height:
            69px;
    }

    .cardCenter {

        font-size:
            20px;
    }

    .seat {

        width:
            92px;
    }

    .scoreRow {

        grid-template-columns:
            45px
            1.2fr
            .8fr
            .8fr;
    }

    .testerCards {

        grid-template-columns:
            1fr;
    }

    .search input {

        width:
            155px;
    }
}

</style>

</head>

<body>

<!-- ======================================================
     LOBBY
======================================================= -->

<div id="lobby">

<div class="shell">

    <div class="topbar">

        <div class="brand">

            WRITTEN

            <b>
                BURA
            </b>

        </div>

        <div class="search">

            <input
                id="searchInput"
                placeholder="SEARCH TABLES"
                oninput="renderLobby()"
            >

        </div>

        <button
            class="topbtn"
            onclick="openModal('rulesModal')"
        >
            RULES
        </button>

        <button
            class="topbtn"
            onclick="openModal('tournamentsModal')"
        >
            TOURNAMENTS
        </button>

        <button
            class="topbtn"
            onclick="openProfile()"
        >
            PROFILE
        </button>

        <button
            class="topbtn"
            onclick="openModal('supportModal')"
        >
            SUPPORT
        </button>

        <button
            class="topbtn"
            onclick="openModal('loginModal')"
        >
            LOGIN
        </button>

        <button
            class="topbtn gold"
            onclick="focusRegister()"
        >
            REGISTRATION
        </button>

        <div
            id="userPill"
            class="userPill"
        ></div>

    </div>

    <div class="subnav">

        <button
            onclick="scrollToTables()"
        >
            POPULAR TABLES
        </button>

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

    </div>

    <div class="heroRow">

        <div class="hero">

            <div class="heroCopy">

                <h1>

                    WRITTEN BURA'S

                    <br>

                    EXCLUSIVE TABLES

                </h1>

                <p>

                    აირჩიე 3 ან 4 კაციანი მაგიდა,
                    ფსონი და პარტიების რაოდენობა.

                    TEST MODE-ში saba123-ით
                    თამაში მაშინვე დაიწყება ბოტებთან.

                </p>

                <button
                    onclick="scrollToTables()"
                >
                    PLAY NOW
                </button>

            </div>

        </div>

        <!-- REGISTER -->

        <div
            class="regCard"
            id="registerCard"
        >

            <h3>

                REGISTRATION:

                <b>
                    BECOME A MEMBER
                </b>

            </h3>

            <input
                id="regEmail"
                type="email"
                placeholder="Email"
            >

            <input
                id="regUsername"
                placeholder="Username"
            >

            <input
                id="regPassword"
                type="password"
                placeholder="Password"
            >

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
                class="msg"
            ></div>

        </div>

    </div>

    <h2
        id="tablesSection"
        class="sectionTitle"
    >
        POPULAR TABLES
    </h2>

    <div
        id="lobbyGrid"
        class="lobbyGrid"
    ></div>

</div>

</div>

<!-- ======================================================
     GAME
======================================================= -->

<div id="game">

    <div class="gameTop">

        <div class="gameBrand">
            WRITTEN BURA
        </div>

        <div class="gameStats">

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

        <button
            class="topbtn"
            onclick="location.reload()"
        >
            EXIT
        </button>

    </div>

    <div
        id="status"
        class="status"
    ></div>

    <!-- TEST MODE -->

    <div
        id="testerPanel"
        class="testerPanel"
    >

        <h3>
            🧪 TEST MODE — ყველა მოთამაშის კარტი
        </h3>

        <div
            id="testerCards"
            class="testerCards"
        ></div>

    </div>

    <div class="tableBoard">

        <div id="players"></div>

        <div id="table-cards"></div>

    </div>

    <div class="hand">

        <div id="my-cards"></div>

        <button
            id="playBtn"
            class="playBtn"
            disabled
            onclick="playSelected()"
        >
            ჩამოსვლა
        </button>

    </div>

    <div class="score">

        <div class="scoreHead">
            🏆 LIVE STANDINGS
        </div>

        <div id="scoreContent"></div>

    </div>

</div>

<!-- ======================================================
     LOGIN
======================================================= -->

<div
    id="loginModal"
    class="modal"
>

    <div class="modalBox">

        <div class="modalHead">

            <h2>
                LOGIN
            </h2>

            <button
                class="closeBtn"
                onclick="closeModal('loginModal')"
            >
                ×
            </button>

        </div>

        <div class="loginForm">

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
                class="msg"
            ></div>

            <p>

                🧪 TEST MODE:

                Username

                <b>
                    saba123
                </b>

                , პაროლი არ სჭირდება.

            </p>

        </div>

    </div>

</div>

<!-- ======================================================
     RULES
======================================================= -->

<div
    id="rulesModal"
    class="modal"
>

    <div class="modalBox">

        <div class="modalHead">

            <h2>
                BURA RULES
            </h2>

            <button
                class="closeBtn"
                onclick="closeModal('rulesModal')"
            >
                ×
            </button>

        </div>

        <p>

            36 კარტი:
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
                პირველი მოთამაშე ერთი ცვეტის კარტებით ჩამოდის.
            </li>

            <li>
                კოზირი სცემს უკოზიროს.
            </li>

            <li>
                5 ერთი ცვეტის კარტი მალიუტკაა.
            </li>

            <li>
                საერთო ქულა ემატება სრული ხელის დასრულების შემდეგ.
            </li>

            <li>
                0 ქულა მიმდინარე სატესტო წესით -120-ად ითვლება.
            </li>

        </ul>

    </div>

</div>

<!-- ======================================================
     TOURNAMENTS
======================================================= -->

<div
    id="tournamentsModal"
    class="modal"
>

    <div class="modalBox">

        <div class="modalHead">

            <h2>
                TOURNAMENTS
            </h2>

            <button
                class="closeBtn"
                onclick="closeModal('tournamentsModal')"
            >
                ×
            </button>

        </div>

        <div id="tournamentsContent"></div>

    </div>

</div>

<!-- ======================================================
     PROFILE
======================================================= -->

<div
    id="profileModal"
    class="modal"
>

    <div class="modalBox">

        <div class="modalHead">

            <h2>
                MY PROFILE
            </h2>

            <button
                class="closeBtn"
                onclick="closeModal('profileModal')"
            >
                ×
            </button>

        </div>

        <div id="profileContent"></div>

    </div>

</div>

<!-- ======================================================
     SUPPORT
======================================================= -->

<div
    id="supportModal"
    class="modal"
>

    <div class="modalBox">

        <div class="modalHead">

            <h2>
                SUPPORT
            </h2>

            <button
                class="closeBtn"
                onclick="closeModal('supportModal')"
            >
                ×
            </button>

        </div>

        <p>

            თუ დაგჭირდება დახმარება თამაშის წესებში,
            ანგარიშში ან მაგიდაზე შესვლაში,
            გახსენი ქვედა ჩატი.

        </p>

        <button
            class="topbtn gold"
            onclick="
                closeModal('supportModal');
                toggleChat();
            "
        >
            OPEN CHAT
        </button>

    </div>

</div>

<!-- ======================================================
     CHAT
======================================================= -->

<div class="chat">

    <button
        class="chatBtn"
        onclick="toggleChat()"
    >
        💬
    </button>

    <div
        id="chatBox"
        class="chatBox"
    >

        <div
            id="chatLog"
            class="chatLog"
        >
            Support:
            მოგესალმებით WRITTEN BURA-ში.
            როგორ დაგეხმაროთ?
        </div>

        <div class="chatSend">

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

/* =========================================================
   CLIENT STATE
========================================================= */

const socket =
    io();

let token =
    localStorage.getItem(
        'bura_token'
    );

let username =
    localStorage.getItem(
        'bura_username'
    ) ||
    '';

let email =
    localStorage.getItem(
        'bura_email'
    ) ||
    '';

let balance =
    Number(
        localStorage.getItem(
            'bura_balance'
        ) ||
        0
    );

let isTester =
    localStorage.getItem(
        'bura_tester'
    ) ===
    'true';

let lobbyState = {

    tables:
        [],

    feed:
        [],

    tournaments:
        [],

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
            'registerCard'
        )
        .scrollIntoView({

            behavior:
                'smooth',

            block:
                'center'
        });

    document
        .getElementById(
            'regEmail'
        )
        .focus();
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
   REGISTER CLIENT
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
            '✓ რეგისტრაცია დასრულდა. ბალანსი $1,000';

        updateUserPill();

    } catch (
        error
    ) {

        message.textContent =
            'Server connection failed.';
    }
}

/* =========================================================
   LOGIN CLIENT
========================================================= */

async function loginUser() {

    const loginUsername =
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
                                loginUsername,

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
                '🧪 TEST MODE აქტიურია'
                :
                '✓ Login successful';

        updateUserPill();

        setTimeout(
            function() {

                closeModal(
                    'loginModal'
                );

            },
            400
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

function logoutUser() {

    [
        'bura_token',
        'bura_username',
        'bura_email',
        'bura_balance',
        'bura_tester'

    ].forEach(
        function(
            key
        ) {

            localStorage
                .removeItem(
                    key
                );
        }
    );

    token =
        '';

    username =
        '';

    email =
        '';

    balance =
        0;

    isTester =
        false;

    updateUserPill();

    closeModal(
        'profileModal'
    );
}

function updateUserPill() {

    const pill =
        document
            .getElementById(
                'userPill'
            );

    if (
        token
        &&
        username
    ) {

        pill.textContent =
            username
            +
            (
                isTester
                    ?
                    ' · TEST'
                    :
                    ' · $' +
                    balance
            );

        pill.classList
            .add(
                'show'
            );

    } else {

        pill.textContent =
            '';

        pill.classList
            .remove(
                'show'
            );
    }
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
            '<button class="topbtn gold" '
            +
            'onclick="closeModal(\\'profileModal\\');openModal(\\'loginModal\\')">'
            +
            'LOGIN'
            +
            '</button>';

    } else {

        content.innerHTML =
            '<div class="profileStat"><b>Username:</b> '
            +
            escapeHtml(
                username
            )
            +
            '</div>'
            +
            '<div class="profileStat"><b>Email:</b> '
            +
            escapeHtml(
                email ||
                '-'
            )
            +
            '</div>'
            +
            '<div class="profileStat"><b>Balance:</b> $'
            +
            balance
            +
            '</div>'
            +
            '<div class="profileStat"><b>Mode:</b> '
            +
            (
                isTester
                    ?
                    'TESTER'
                    :
                    'PLAYER'
            )
            +
            '</div>'
            +
            '<div style="margin-top:12px">'
            +
            '<button class="topbtn" onclick="logoutUser()">'
            +
            'LOGOUT'
            +
            '</button>'
            +
            '</div>';
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
    function(
        state
    ) {

        lobbyState =
            state ||
            lobbyState;

        renderLobby();

        renderTournaments();
    }
);

/* =========================================================
   RENDER LOBBY
========================================================= */

function renderLobby() {

    const grid =
        document
            .getElementById(
                'lobbyGrid'
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
            function(
                table
            ) {

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
                    )
                    .includes(
                        query
                    )
                    ||
                    String(
                        table.capacity
                    )
                    .includes(
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
            function(
                table
            ) {

                html +=

                    '<div class="tableCard">'

                    +

                    '<div class="tableVisual"></div>'

                    +

                    '<div class="tableBody">'

                    +

                    '<div class="tableTitle">'

                    +

                    escapeHtml(
                        table.label
                    )

                    +

                    '</div>'

                    +

                    '<div class="tableMeta">'

                    +

                    'Stake: $'

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

                    '<button class="joinBtn" onclick="openJoin('

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

    html +=

        '<div class="feedCard">'

        +

        '<h3>LIVE FEED · ONLINE '

        +

        (
            lobbyState.online ||
            0
        )

        +

        '</h3>';

    const feed =
        (
            lobbyState.feed ||
            []
        )
        .slice(
            0,
            5
        );

    if (
        feed.length
    ) {

        feed.forEach(
            function(
                item
            ) {

                html +=

                    '<div class="feedItem">'

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

            '<div class="feedItem">'

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

    let html =
        '';

    (
        lobbyState.tournaments ||
        []
    )
    .forEach(
        function(
            tournament
        ) {

            html +=

                '<div class="profileStat">'

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

                tournament.date

                +

                ' · '

                +

                tournament.players

                +

                ' players · Prize $'

                +

                tournament.prize

                +

                '</div>';
        }
    );

    content.innerHTML =
        html ||
        '<p>No tournaments.</p>';
}

/* =========================================================
   JOIN TABLE
========================================================= */

function openJoin(
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

    const parties =
        prompt(
            'რამდენი პარტია? 1-4',
            '1'
        );

    if (
        parties ===
        null
    ) {

        return;
    }

    socket.emit(
        'joinTable',
        {

            token:
                token,

            stake:
                stake,

            capacity:
                capacity,

            parties:
                Number(
                    parties
                )
        }
    );
}

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
    'waitingForPlayers',
    function(
        data
    ) {

        alert(
            'ველოდებით მოთამაშეებს: '
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
    function(
        message
    ) {

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
    function() {

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

socket.on(
    'gameStateUpdate',
    function(
        state
    ) {

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

/* =========================================================
   GAME RENDER
========================================================= */

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

    renderTesterPanel(
        state
    );

    updateStatus(
        state
    );
}

/* =========================================================
   POSITIONS
========================================================= */

function seatPosition(
    index,
    count,
    myId,
    players
) {

    let myIndex =
        players.findIndex(
            function(
                player
            ) {

                return (
                    player.id ===
                    myId
                );
            }
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

    const positions4 = [

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

    const container =
        document
            .getElementById(
                'players'
            );

    container.innerHTML =
        '';

    state.players
        .forEach(
            function(
                player,
                index
            ) {

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
                            '<div class="cardBack"></div>';
                    }
                }

                seat.innerHTML =

                    '<div class="seatBox">'

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

                    '<div class="cardBacks">'

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
            function(
                play
            ) {

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

                play.cards
                    .forEach(
                        function(
                            card
                        ) {

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
        function(
            card,
            index
        ) {

            const element =
                createCard(
                    card
                );

            element.onclick =
                function() {

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

/* =========================================================
   CARD
========================================================= */

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

    const symbol =
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

        symbol

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

        escapeHtml(
            card.rank
        )

        +

        ' '

        +

        symbol

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
                function(
                    a,
                    b
                ) {

                    return (
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
                }
            );

    let html =

        '<div class="scoreRow">'

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
        function(
            player,
            index
        ) {

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
   TESTER VIEW
========================================================= */

function renderTesterPanel(
    state
) {

    const panel =
        document
            .getElementById(
                'testerPanel'
            );

    const container =
        document
            .getElementById(
                'testerCards'
            );

    if (
        !isTester
        ||
        !state.testerRevealAll
    ) {

        panel.classList
            .remove(
                'show'
            );

        container.innerHTML =
            '';

        return;
    }

    panel.classList
        .add(
            'show'
        );

    let html =
        '';

    state.players.forEach(
        function(
            player
        ) {

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

                '<div class="miniCards">';

            cards.forEach(
                function(
                    card
                ) {

                    html +=

                        '<span class="miniCard">'

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

        '<br><br>You: '

        +

        escapeHtml(
            value
        )

        +

        '<br>Support: შეტყობინება მიღებულია. სატესტო ჩატი ავტომატურია.';

    log.scrollTop =
        log.scrollHeight;

    input.value =
        '';
}

/* =========================================================
   INIT
========================================================= */

updateUserPill();

renderLobby();

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
            'WRITTEN BURA running on port',
            PORT
        );

        console.log(
            'Deck:',
            createDeck().length
        );

        console.log(
            'Tester:',
            TESTER_USERNAME
        );
    }
);
