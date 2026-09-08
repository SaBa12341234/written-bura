const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 10000;

app.use(express.json());

/* =========================================================
   CONFIG
========================================================= */

const TESTER_USERNAME = "saba123";
const STARTING_BALANCE = 1000;

const USERS_FILE = path.join(__dirname, "users.json");

/* =========================================================
   USERS
========================================================= */

let users = [];

try {
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(
            fs.readFileSync(USERS_FILE, "utf8")
        );
    }
} catch (err) {
    console.error("users.json error:", err);
    users = [];
}

function saveUsers() {
    try {
        fs.writeFileSync(
            USERS_FILE,
            JSON.stringify(users, null, 2)
        );
    } catch (err) {
        console.error("users save error:", err);
    }
}

/*
    ჯერჯერობით ყველას სატესტოდ $1000.
*/
users.forEach(user => {
    user.balance = STARTING_BALANCE;
});

saveUsers();

const sessions = new Map();
const testerSessions = new Set();

function normalizeUsername(username) {
    return String(username || "").trim();
}

function normalizeEmail(email) {
    return String(email || "")
        .trim()
        .toLowerCase();
}

function isTesterUsername(username) {
    return (
        normalizeUsername(username).toLowerCase() ===
        TESTER_USERNAME.toLowerCase()
    );
}

function hashPassword(password, salt) {
    return crypto
        .scryptSync(password, salt, 64)
        .toString("hex");
}

function createToken() {
    return crypto
        .randomBytes(32)
        .toString("hex");
}

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", (req, res) => {

    const username =
        normalizeUsername(req.body.username);

    const email =
        normalizeEmail(req.body.email);

    const password =
        String(req.body.password || "");

    if (isTesterUsername(username)) {
        return res.status(400).json({
            ok: false,
            message:
                "saba123 დაცულია სატესტო რეჟიმისთვის."
        });
    }

    if (
        username.length < 3 ||
        username.length > 20
    ) {
        return res.status(400).json({
            ok: false,
            message:
                "Username უნდა იყოს 3-20 სიმბოლო."
        });
    }

    if (
        !/^[a-zA-Z0-9_\u10A0-\u10FF]+$/u.test(
            username
        )
    ) {
        return res.status(400).json({
            ok: false,
            message:
                "Username-ში გამოიყენე ასოები, ციფრები ან _"
        });
    }

    if (
        !email ||
        !email.includes("@")
    ) {
        return res.status(400).json({
            ok: false,
            message:
                "შეიყვანე სწორი Email."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            ok: false,
            message:
                "პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს."
        });
    }

    const usernameExists =
        users.some(
            u =>
                u.username.toLowerCase() ===
                username.toLowerCase()
        );

    if (usernameExists) {
        return res.status(409).json({
            ok: false,
            message:
                "ეს Username უკვე დაკავებულია."
        });
    }

    const emailExists =
        users.some(
            u =>
                u.email === email
        );

    if (emailExists) {
        return res.status(409).json({
            ok: false,
            message:
                "ეს Email უკვე რეგისტრირებულია."
        });
    }

    const salt =
        crypto
            .randomBytes(16)
            .toString("hex");

    const passwordHash =
        hashPassword(
            password,
            salt
        );

    const user = {
        id:
            "user_" +
            Date.now() +
            "_" +
            Math.floor(
                Math.random() * 100000
            ),

        username,

        email,

        salt,

        passwordHash,

        balance:
            STARTING_BALANCE,

        createdAt:
            new Date().toISOString()
    };

    users.push(user);

    saveUsers();

    const token =
        createToken();

    sessions.set(
        token,
        user.id
    );

    return res.json({
        ok: true,
        token,
        username:
            user.username,
        balance:
            user.balance,
        isTester:
            false
    });
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", (req, res) => {

    const username =
        normalizeUsername(
            req.body.username
        );

    const password =
        String(
            req.body.password || ""
        );

    /*
        TEST MODE:
        saba123-ს არ სჭირდება რეგისტრაცია
        და არც პაროლი.
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
            ok: true,
            token,
            username:
                TESTER_USERNAME,
            balance:
                STARTING_BALANCE,
            isTester:
                true
        });
    }

    const user =
        users.find(
            u =>
                u.username.toLowerCase() ===
                username.toLowerCase()
        );

    if (!user) {
        return res.status(401).json({
            ok: false,
            message:
                "Username ან პაროლი არასწორია."
        });
    }

    const passwordHash =
        hashPassword(
            password,
            user.salt
        );

    if (
        passwordHash !==
        user.passwordHash
    ) {
        return res.status(401).json({
            ok: false,
            message:
                "Username ან პაროლი არასწორია."
        });
    }

    user.balance =
        STARTING_BALANCE;

    saveUsers();

    const token =
        createToken();

    sessions.set(
        token,
        user.id
    );

    return res.json({
        ok: true,
        token,
        username:
            user.username,
        balance:
            user.balance,
        isTester:
            false
    });
});

/* =========================================================
   AUTH
========================================================= */

function getUserByToken(token) {

    if (!token) {
        return null;
    }

    if (
        testerSessions.has(
            token
        )
    ) {
        return {
            id:
                "tester_saba123",
            username:
                TESTER_USERNAME,
            balance:
                STARTING_BALANCE,
            isTester:
                true
        };
    }

    const userId =
        sessions.get(token);

    if (!userId) {
        return null;
    }

    const user =
        users.find(
            u =>
                u.id === userId
        );

    if (!user) {
        return null;
    }

    return {
        ...user,
        isTester:
            false
    };
}

/* =========================================================
   GAME CONFIG

   36 კარტი:
   6,7,8,9,J,Q,K,10,A
========================================================= */

const CARD_VALUES = {

    "6": 0,

    "7": 0,

    "8": 0,

    "9": 0,

    "J": 2,

    "Q": 3,

    "K": 4,

    "10": 10,

    "A": 11
};

const RANKS_ORDER = [

    "6",

    "7",

    "8",

    "9",

    "J",

    "Q",

    "K",

    "10",

    "A"
];

const SUITS = [

    "spades",

    "clubs",

    "hearts",

    "diamonds"
];

const TRUMP_ROTATION = [

    "spades",

    "clubs",

    "hearts",

    "diamonds",

    "no_trump"
];

let rooms = {};

/* =========================================================
   DECK
========================================================= */

function createDeck() {

    const deck = [];

    for (
        const suit of SUITS
    ) {

        for (
            const rank of RANKS_ORDER
        ) {

            deck.push({
                rank,
                suit,
                value:
                    CARD_VALUES[rank]
            });
        }
    }

    /*
        9 × 4 = 36
    */

    for (
        let i =
            deck.length - 1;

        i > 0;

        i--
    ) {

        const j =
            Math.floor(
                Math.random() *
                (i + 1)
            );

        [
            deck[i],
            deck[j]
        ] = [
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
    roomId,
    maxPlayers,
    targetParties,
    stake
) {

    return {

        id:
            roomId,

        maxPlayers:
            Number(
                maxPlayers
            ),

        targetParties:
            Number(
                targetParties
            ),

        stake:
            Number(
                stake
            ),

        players: [],

        gameState:
            null
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

    const playersCards = {};
    const takenCards = {};
    const totalScores = {};

    room.players.forEach(
        player => {

            playersCards[
                player.id
            ] =
                deck.splice(
                    0,
                    5
                );

            takenCards[
                player.id
            ] = [];

            totalScores[
                player.id
            ] =
                previousGame
                    ?
                    (
                        previousGame
                            .totalScores[
                                player.id
                            ] || 0
                    )
                    :
                    0;
        }
    );

    const handIndex =
        previousGame
            ?
            previousGame.handIndex + 1
            :
            1;

    const partyNum =
        Math.ceil(
            handIndex / 5
        );

    const trumpIndex =
        (
            handIndex - 1
        ) % 5;

    const currentTrump =
        TRUMP_ROTATION[
            trumpIndex
        ];

    let startLeaderIndex =
        0;

    if (
        previousGame &&
        previousGame
            .nextRoundLeaderIndex !==
            undefined
    ) {

        startLeaderIndex =
            previousGame
                .nextRoundLeaderIndex;
    }

    return {

        deck,

        playersCards,

        takenCards,

        totalScores,

        currentTurnIndex:
            startLeaderIndex,

        table: [],

        trump:
            currentTrump,

        partyNum,

        handIndex,

        roundHistory:
            previousGame
                ?
                previousGame
                    .roundHistory
                :
                [],

        leadCardCount:
            null,

        isProcessing:
            false,

        gameOver:
            false
    };
}

/* =========================================================
   CARD COMPARISON
========================================================= */

function cardBeatsCard(
    leadCard,
    challengeCard,
    trump
) {

    const challengeTrump =
        trump !== "no_trump" &&
        challengeCard.suit ===
        trump;

    const leadTrump =
        trump !== "no_trump" &&
        leadCard.suit ===
        trump;

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
        challengeCard.suit ===
        leadCard.suit
    ) {

        return (
            RANKS_ORDER.indexOf(
                challengeCard.rank
            )
            >
            RANKS_ORDER.indexOf(
                leadCard.rank
            )
        );
    }

    return false;
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

    const challengeMaliutka =
        challengeCards.length === 5 &&
        challengeCards.every(
            card =>
                card.suit ===
                challengeCards[0].suit
        );

    if (
        challengeMaliutka &&
        leadCards.length < 5
    ) {
        return true;
    }

    if (
        leadCards.length !==
        challengeCards.length
    ) {
        return false;
    }

    const sortedLead =
        [...leadCards].sort(
            (a, b) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    const sortedChallenge =
        [...challengeCards].sort(
            (a, b) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    for (
        let i = 0;

        i <
        sortedLead.length;

        i++
    ) {

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

function getWinningPlayIndex(
    table,
    trump
) {

    if (
        !table ||
        table.length === 0
    ) {
        return -1;
    }

    let winningIndex =
        0;

    for (
        let i = 1;

        i <
        table.length;

        i++
    ) {

        if (
            beatsPlay(
                table[
                    winningIndex
                ],
                table[i],
                trump
            )
        ) {
            winningIndex =
                i;
        }
    }

    return winningIndex;
}

/* =========================================================
   CLIENT STATE
========================================================= */

function getClientGameState(
    room,
    forPlayerId
) {

    const gs =
        room.gameState;

    if (!gs) {
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
            ) => ({
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
                    gs.playersCards[
                        player.id
                    ]
                        ?
                        gs.playersCards[
                            player.id
                        ].length
                        :
                        0,

                takenCount:
                    gs.takenCards[
                        player.id
                    ]
                        ?
                        gs.takenCards[
                            player.id
                        ].length
                        :
                        0,

                handPoints:
                    gs.takenCards[
                        player.id
                    ]
                        ?
                        gs.takenCards[
                            player.id
                        ].reduce(
                            (
                                sum,
                                card
                            ) =>
                                sum +
                                card.value,
                            0
                        )
                        :
                        0,

                totalPoints:
                    gs.totalScores[
                        player.id
                    ] || 0,

                isCurrent:
                    index ===
                    gs.currentTurnIndex
            })
        );

    const visibleCards = {};

    if (
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

        gameOver:
            gs.gameOver
    };
}

function broadcastGameState(
    room
) {

    room.players.forEach(
        player => {

            if (
                player.isBot
            ) {
                return;
            }

            io.to(
                player.id
            ).emit(
                "gameStateUpdate",
                getClientGameState(
                    room,
                    player.id
                )
            );
        }
    );
}

/* =========================================================
   DEAL AFTER TRICK
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
            let step = 0;

            step <
            room.players.length;

            step++
        ) {

            const playerIndex =
                (
                    winnerIndex +
                    step
                )
                %
                room.players.length;

            const player =
                room.players[
                    playerIndex
                ];

            const hand =
                gs.playersCards[
                    player.id
                ];

            if (
                hand.length <
                5 &&
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

        if (!dealt) {
            break;
        }
    }
}

/* =========================================================
   FINISH TRICK
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

    if (!winningPlay) {
        return;
    }

    const winnerId =
        winningPlay.playerId;

    const allCards = [];

    gs.table.forEach(
        play =>
            allCards.push(
                ...play.cards
            )
    );

    gs.takenCards[
        winnerId
    ].push(
        ...allCards
    );

    const winnerPlayerIndex =
        room.players.findIndex(
            player =>
                player.id ===
                winnerId
        );

    gs.currentTurnIndex =
        winnerPlayerIndex;

    gs.isProcessing =
        true;

    broadcastGameState(
        room
    );

    setTimeout(
        () => {

            gs.table = [];

            gs.leadCardCount =
                null;

            refillHands(
                room,
                winnerPlayerIndex
            );

            const allHandsEmpty =
                room.players.every(
                    player =>
                        gs.playersCards[
                            player.id
                        ].length ===
                        0
                );

            gs.isProcessing =
                false;

            if (
                allHandsEmpty
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
   FINISH HAND
========================================================= */

function finishHand(
    room
) {

    const gs =
        room.gameState;

    const handScores = {};

    let minScore =
        Infinity;

    let minPlayerIndex =
        0;

    room.players.forEach(
        (
            player,
            index
        ) => {

            const points =
                gs.takenCards[
                    player.id
                ].reduce(
                    (
                        sum,
                        card
                    ) =>
                        sum +
                        card.value,
                    0
                );

            handScores[
                player.id
            ] =
                points;

            gs.totalScores[
                player.id
            ] =
                (
                    gs.totalScores[
                        player.id
                    ] || 0
                )
                +
                (
                    points === 0
                        ?
                        -120
                        :
                        points
                );

            if (
                points <
                minScore
            ) {

                minScore =
                    points;

                minPlayerIndex =
                    index;
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

    const totalMaxHands =
        room.targetParties *
        5;

    if (
        gs.handIndex >=
        totalMaxHands
    ) {

        gs.gameOver =
            true;

        broadcastGameState(
            room
        );

        return;
    }

    const nextLeaderIndex =
        (
            minPlayerIndex +
            1
        )
        %
        room.players.length;

    gs.nextRoundLeaderIndex =
        nextLeaderIndex;

    room.gameState =
        startNewHand(
            room,
            gs
        );

    broadcastGameState(
        room
    );

    scheduleBotTurn(
        room
    );
}

/* =========================================================
   BOT LOGIC
========================================================= */

function chooseBotCards(
    room,
    bot
) {

    const gs =
        room.gameState;

    const cards =
        gs.playersCards[
            bot.id
        ] || [];

    if (
        cards.length === 0
    ) {
        return [];
    }

    /*
        თუ ბოტი პირველი ჩამოდის,
        ვცდილობთ ერთ კარტს.
    */

    if (
        gs.table.length ===
        0
    ) {

        return [0];
    }

    const required =
        Math.min(
            gs.leadCardCount || 1,
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
        !room ||
        !room.gameState
    ) {
        return;
    }

    const gs =
        room.gameState;

    if (
        gs.gameOver ||
        gs.isProcessing
    ) {
        return;
    }

    const activePlayer =
        room.players[
            gs.currentTurnIndex
        ];

    if (
        !activePlayer ||
        !activePlayer.isBot
    ) {
        return;
    }

    setTimeout(
        () => {

            playBotTurn(
                room,
                activePlayer
            );

        },
        650
    );
}

function playBotTurn(
    room,
    bot
) {

    const gs =
        room.gameState;

    if (
        !gs ||
        gs.gameOver ||
        gs.isProcessing
    ) {
        return;
    }

    const activePlayer =
        room.players[
            gs.currentTurnIndex
        ];

    if (
        !activePlayer ||
        activePlayer.id !==
        bot.id
    ) {
        return;
    }

    const playerCards =
        gs.playersCards[
            bot.id
        ];

    if (
        !playerCards ||
        playerCards.length ===
        0
    ) {
        return;
    }

    const cardIndices =
        chooseBotCards(
            room,
            bot
        );

    const selectedCards =
        cardIndices
            .map(
                index =>
                    playerCards[
                        index
                    ]
            )
            .filter(Boolean);

    if (
        selectedCards.length ===
        0
    ) {
        return;
    }

    if (
        gs.table.length ===
        0
    ) {

        gs.leadCardCount =
            selectedCards.length;
    }

    gs.playersCards[
        bot.id
    ] =
        playerCards.filter(
            (
                _,
                index
            ) =>
                !cardIndices.includes(
                    index
                )
        );

    gs.table.push({
        playerId:
            bot.id,

        playerName:
            bot.name,

        cards:
            selectedCards
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

        return;
    }

    completeTrick(
        room
    );
}

/* =========================================================
   SOCKET
========================================================= */

io.on(
    "connection",
    socket => {

        console.log(
            "Connected:",
            socket.id
        );

        /* =================================================
           JOIN TABLE
        ================================================= */

        socket.on(
            "joinTable",
            data => {

                const user =
                    getUserByToken(
                        data.token
                    );

                if (!user) {

                    socket.emit(
                        "errorMessage",
                        "ჯერ გაიარე რეგისტრაცია ან შედი ანგარიშზე."
                    );

                    return;
                }

                let capacity =
                    parseInt(
                        data.capacity
                    );

                /*
                    მხოლოდ 3 ან 4
                */

                if (
                    capacity !== 3 &&
                    capacity !== 4
                ) {

                    capacity =
                        3;
                }

                const parties =
                    Math.max(
                        1,
                        Math.min(
                            3,
                            parseInt(
                                data.parties
                            ) || 1
                        )
                    );

                const allowedStakes =
                    [
                        5,
                        10,
                        25,
                        50,
                        100
                    ];

                let stake =
                    parseFloat(
                        data.stake
                    );

                if (
                    !allowedStakes.includes(
                        stake
                    )
                ) {
                    stake =
                        5;
                }

                const isTester =
                    !!user.isTester;

                if (
                    !isTester &&
                    user.balance <
                    stake
                ) {

                    socket.emit(
                        "errorMessage",
                        "არ გაქვს საკმარისი ბალანსი."
                    );

                    return;
                }

                if (
                    socket.roomId
                ) {

                    socket.emit(
                        "errorMessage",
                        "უკვე მაგიდაზე ხარ."
                    );

                    return;
                }

                /*
                    შესაბამისი waiting room
                */

                let room =
                    Object.values(
                        rooms
                    ).find(
                        room =>
                            room.maxPlayers ===
                            capacity
                            &&
                            room.targetParties ===
                            parties
                            &&
                            room.stake ===
                            stake
                            &&
                            room.players.length <
                            room.maxPlayers
                            &&
                            !room.gameState
                    );

                if (!room) {

                    const roomId =
                        "room_" +
                        Date.now() +
                        "_" +
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

                socket.roomId =
                    room.id;

                socket.userId =
                    user.id;

                socket.isTester =
                    isTester;

                socket.join(
                    room.id
                );

                let playerBalance =
                    STARTING_BALANCE;

                /*
                    ჩვეულებრივ მოთამაშეს
                    ფსონი აკლდება.
                    სატესტოს არა.
                */

                if (!isTester) {

                    const realUser =
                        users.find(
                            u =>
                                u.id ===
                                user.id
                        );

                    if (realUser) {

                        realUser.balance -=
                            stake;

                        playerBalance =
                            realUser.balance;

                        saveUsers();
                    }
                }

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
                        isTester
                });

                /*
                    TESTER:
                    ცარიელ ადგილებს მაშინვე
                    ავსებს ბოტებით.
                */

                if (isTester) {

                    let botNumber =
                        1;

                    while (
                        room.players.length <
                        room.maxPlayers
                    ) {

                        const botId =
                            "bot_" +
                            Date.now() +
                            "_" +
                            botNumber +
                            "_" +
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
                                "BOT " +
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
                        "waitingForPlayers",
                        {
                            current:
                                room.players.length,

                            max:
                                room.maxPlayers,

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
            "playCards",
            data => {

                if (
                    !socket.roomId ||
                    !rooms[
                        socket.roomId
                    ]
                ) {
                    return;
                }

                const room =
                    rooms[
                        socket.roomId
                    ];

                const gs =
                    room.gameState;

                if (
                    !gs ||
                    gs.isProcessing ||
                    gs.gameOver
                ) {
                    return;
                }

                const activePlayer =
                    room.players[
                        gs.currentTurnIndex
                    ];

                if (
                    !activePlayer ||
                    activePlayer.id !==
                    socket.id
                ) {

                    socket.emit(
                        "errorMessage",
                        "ახლა შენი სვლა არ არის."
                    );

                    return;
                }

                const playerCards =
                    gs.playersCards[
                        socket.id
                    ];

                if (!playerCards) {
                    return;
                }

                let cardIndices =
                    Array.isArray(
                        data.cardIndices
                    )
                        ?
                        data.cardIndices
                        :
                        [];

                /*
                    duplicate index-ები არ გვინდა
                */

                cardIndices =
                    [
                        ...new Set(
                            cardIndices
                        )
                    ];

                const selectedCards =
                    cardIndices
                        .map(
                            index =>
                                playerCards[
                                    index
                                ]
                        )
                        .filter(Boolean);

                if (
                    selectedCards.length ===
                    0
                    ||
                    selectedCards.length !==
                    cardIndices.length
                ) {

                    socket.emit(
                        "errorMessage",
                        "აირჩიე სწორი კარტი."
                    );

                    return;
                }

                const isMaliutka =
                    selectedCards.length ===
                    5
                    &&
                    selectedCards.every(
                        card =>
                            card.suit ===
                            selectedCards[
                                0
                            ].suit
                    );

                /*
                    FIRST PLAYER
                */

                if (
                    gs.table.length ===
                    0
                ) {

                    const firstSuit =
                        selectedCards[
                            0
                        ].suit;

                    const sameSuit =
                        selectedCards.every(
                            card =>
                                card.suit ===
                                firstSuit
                        );

                    if (
                        !sameSuit
                    ) {

                        socket.emit(
                            "errorMessage",
                            "პირველი მოთამაშე მხოლოდ ერთი ფერის კარტებს უნდა ჩამოვიდეს."
                        );

                        return;
                    }

                    gs.leadCardCount =
                        selectedCards.length;

                } else {

                    const required =
                        Math.min(
                            gs.leadCardCount,
                            playerCards.length
                        );

                    if (
                        !isMaliutka &&
                        selectedCards.length !==
                        required
                    ) {

                        socket.emit(
                            "errorMessage",
                            "უნდა ჩამოხვიდე " +
                            required +
                            " კარტი ან მალიუტკა."
                        );

                        return;
                    }
                }

                gs.playersCards[
                    socket.id
                ] =
                    playerCards.filter(
                        (
                            _,
                            index
                        ) =>
                            !cardIndices.includes(
                                index
                            )
                    );

                gs.table.push({
                    playerId:
                        socket.id,

                    playerName:
                        activePlayer.name,

                    cards:
                        selectedCards
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

                    return;
                }

                completeTrick(
                    room
                );
            }
        );

        /* =================================================
           DISCONNECT
        ================================================= */

        socket.on(
            "disconnect",
            () => {

                if (
                    !socket.roomId ||
                    !rooms[
                        socket.roomId
                    ]
                ) {
                    return;
                }

                const room =
                    rooms[
                        socket.roomId
                    ];

                room.players =
                    room.players.filter(
                        player =>
                            player.id !==
                            socket.id
                    );

                io.to(
                    room.id
                ).emit(
                    "playerLeft"
                );

                if (
                    room.players.filter(
                        p =>
                            !p.isBot
                    ).length ===
                    0
                ) {

                    delete rooms[
                        socket.roomId
                    ];
                }
            }
        );
    }
);

/* =========================================================
   FRONTEND
========================================================= */

app.get(
    "/",
    (req, res) => {

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

* {
    box-sizing:
        border-box;
}

:root {

    --bg:
        #06080c;

    --panel:
        #10141b;

    --panel2:
        #181e27;

    --gold:
        #f6c94a;

    --gold2:
        #ff9800;

    --green:
        #11663b;

    --muted:
        #8a94a5;

    --line:
        rgba(255,255,255,.08);
}

html,
body {

    margin:
        0;

    min-height:
        100%;

    font-family:
        Inter,
        Segoe UI,
        Arial,
        sans-serif;

    background:
        #06080c;

    color:
        white;
}

body {

    min-height:
        100vh;

    background:

        radial-gradient(
            circle at 50% 0%,
            rgba(244,197,66,.11),
            transparent 27%
        ),

        radial-gradient(
            circle at 5% 90%,
            rgba(15,100,58,.12),
            transparent 35%
        ),

        #06080c;
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
   NAV
========================================================= */

.navbar {

    height:
        74px;

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    padding:
        0 28px;

    position:
        sticky;

    top:
        0;

    z-index:
        50;

    background:
        rgba(6,8,12,.92);

    backdrop-filter:
        blur(18px);

    border-bottom:
        1px solid
        var(--line);
}

.logo {

    color:
        var(--gold);

    font-size:
        21px;

    font-weight:
        950;

    letter-spacing:
        .8px;
}

.logo span {

    color:
        white;
}

.nav-user {

    display:
        flex;

    align-items:
        center;

    gap:
        10px;

    text-align:
        right;
}

.nav-name {

    font-weight:
        800;

    font-size:
        12px;
}

.nav-balance {

    color:
        var(--muted);

    font-size:
        10px;

    margin-top:
        2px;
}

.avatar {

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

    color:
        var(--gold);

    font-weight:
        950;

    background:
        linear-gradient(
            145deg,
            #3b4350,
            #191e26
        );

    border:
        1px solid
        rgba(244,197,66,.32);
}

/* =========================================================
   LOBBY
========================================================= */

#lobby {

    min-height:
        100vh;
}

.lobby-container {

    width:
        min(1180px,100%);

    margin:
        auto;

    padding:
        42px 20px 70px;
}

.hero {

    text-align:
        center;

    margin-bottom:
        32px;
}

.hero-tag {

    display:
        inline-flex;

    align-items:
        center;

    gap:
        7px;

    color:
        var(--gold);

    font-size:
        10px;

    font-weight:
        900;

    letter-spacing:
        1.4px;

    border:
        1px solid
        rgba(244,197,66,.18);

    background:
        rgba(244,197,66,.05);

    padding:
        7px 12px;

    border-radius:
        30px;

    margin-bottom:
        13px;
}

.hero h1 {

    margin:
        0;

    font-size:
        clamp(
            31px,
            6vw,
            52px
        );

    font-weight:
        950;

    letter-spacing:
        -.6px;

    background:
        linear-gradient(
            135deg,
            #fff8c9,
            #f6c94a,
            #ff9700
        );

    -webkit-background-clip:
        text;

    color:
        transparent;
}

.hero p {

    margin:
        10px auto 0;

    max-width:
        550px;

    color:
        #8f98a8;

    font-size:
        13px;

    line-height:
        1.6;
}

/* =========================================================
   GRID
========================================================= */

.main-grid {

    display:
        grid;

    grid-template-columns:
        .9fr 1.1fr;

    gap:
        22px;
}

.panel {

    border:
        1px solid
        var(--line);

    border-radius:
        20px;

    background:

        radial-gradient(
            circle at 50% 0%,
            rgba(255,255,255,.025),
            transparent 38%
        ),

        linear-gradient(
            145deg,
            #141922,
            #0b0e13
        );

    padding:
        24px;

    box-shadow:
        0 30px 80px
        rgba(0,0,0,.28);
}

.panel-title {

    font-size:
        17px;

    font-weight:
        900;

    margin:
        0;
}

.panel-sub {

    color:
        var(--muted);

    font-size:
        11px;

    margin-top:
        5px;

    margin-bottom:
        18px;
}

/* =========================================================
   AUTH PREMIUM
========================================================= */

.auth-header {

    display:
        flex;

    align-items:
        center;

    gap:
        12px;

    margin-bottom:
        17px;
}

.auth-crown {

    width:
        48px;

    height:
        48px;

    border-radius:
        14px;

    display:
        grid;

    place-items:
        center;

    color:
        #171005;

    font-size:
        24px;

    background:
        linear-gradient(
            145deg,
            #ffe76a,
            #ff9c00
        );

    box-shadow:
        0 10px 30px
        rgba(255,156,0,.18);
}

.auth-header h2 {

    margin:
        0;

    font-size:
        18px;
}

.auth-header p {

    margin:
        3px 0 0;

    color:
        var(--muted);

    font-size:
        10px;
}

.bonus-banner {

    display:
        flex;

    align-items:
        center;

    gap:
        11px;

    padding:
        12px;

    border-radius:
        12px;

    margin-bottom:
        17px;

    border:
        1px solid
        rgba(244,197,66,.14);

    background:
        linear-gradient(
            135deg,
            rgba(244,197,66,.09),
            rgba(244,197,66,.025)
        );
}

.bonus-icon {

    width:
        37px;

    height:
        37px;

    flex:
        none;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    color:
        var(--gold);

    background:
        rgba(244,197,66,.10);

    border:
        1px solid
        rgba(244,197,66,.17);
}

.bonus-banner strong {

    display:
        block;

    font-size:
        11px;
}

.bonus-banner span {

    display:
        block;

    margin-top:
        2px;

    color:
        var(--muted);

    font-size:
        9px;
}

.auth-tabs {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    padding:
        4px;

    border-radius:
        11px;

    background:
        #080b0f;

    border:
        1px solid
        rgba(255,255,255,.05);

    margin-bottom:
        17px;
}

.auth-tab {

    height:
        39px;

    border:
        0;

    border-radius:
        8px;

    background:
        transparent;

    color:
        #818b9b;

    font-size:
        11px;

    font-weight:
        900;
}

.auth-tab.active {

    color:
        #151005;

    background:
        linear-gradient(
            135deg,
            #ffe35d,
            #ff9a00
        );

    box-shadow:
        0 7px 20px
        rgba(255,154,0,.14);
}

/* =========================================================
   INPUT
========================================================= */

.field {

    margin:
        13px 0;
}

.field label {

    display:
        block;

    margin-bottom:
        6px;

    color:
        #9ca5b3;

    font-size:
        9px;

    font-weight:
        900;

    letter-spacing:
        .6px;

    text-transform:
        uppercase;
}

.field input,
.field select {

    width:
        100%;

    height:
        45px;

    padding:
        0 13px;

    color:
        white;

    border:
        1px solid
        #2b323e;

    border-radius:
        10px;

    background:
        #080b10;

    outline:
        none;

    transition:
        .15s;
}

.field input:focus,
.field select:focus {

    border-color:
        rgba(244,197,66,.65);

    box-shadow:
        0 0 0 3px
        rgba(244,197,66,.07);
}

/* =========================================================
   TESTER
========================================================= */

.tester-hint {

    margin:
        10px 0 13px;

    padding:
        10px 11px;

    border-radius:
        10px;

    border:
        1px solid
        rgba(165,98,216,.18);

    background:
        rgba(144,76,194,.06);

    color:
        #a991bb;

    font-size:
        9px;

    line-height:
        1.5;
}

.tester-hint b {

    color:
        #dfc5f2;
}

/* =========================================================
   BUTTON
========================================================= */

.gold-btn {

    width:
        100%;

    height:
        47px;

    border:
        0;

    border-radius:
        11px;

    color:
        #171005;

    font-weight:
        950;

    font-size:
        12px;

    background:
        linear-gradient(
            135deg,
            #ffe35d,
            #ff9700
        );

    box-shadow:
        0 13px 30px
        rgba(255,151,0,.15);

    transition:
        .16s;
}

.gold-btn:hover {

    transform:
        translateY(-2px);

    box-shadow:
        0 17px 35px
        rgba(255,151,0,.24);
}

.message {

    min-height:
        21px;

    margin-top:
        10px;

    text-align:
        center;

    color:
        var(--gold);

    font-size:
        10px;

    font-weight:
        800;
}

.message.error {

    color:
        #ff6666;
}

/* =========================================================
   LOGGED
========================================================= */

.logged-card {

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    gap:
        10px;

    padding:
        12px;

    margin-bottom:
        15px;

    border-radius:
        11px;

    background:
        #080b10;

    border:
        1px solid
        var(--line);

    font-size:
        10px;
}

.logged-card strong {

    color:
        var(--gold);
}

.logout-btn {

    border:
        0;

    background:
        transparent;

    color:
        #ff6767;

    font-size:
        9px;

    font-weight:
        900;
}

/* =========================================================
   CAPACITY
========================================================= */

.capacity-grid {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        9px;

    margin-top:
        8px;
}

.capacity-card {

    height:
        65px;

    border:
        1px solid
        var(--line);

    border-radius:
        11px;

    color:
        #9ca5b3;

    background:
        #090c11;

    font-size:
        11px;

    font-weight:
        900;

    transition:
        .15s;
}

.capacity-card:hover {

    border-color:
        rgba(244,197,66,.35);
}

.capacity-card.active {

    color:
        var(--gold);

    border-color:
        rgba(244,197,66,.65);

    background:
        rgba(244,197,66,.06);
}

/* =========================================================
   STAKE TABLES
========================================================= */

.stake-grid {

    display:
        grid;

    grid-template-columns:
        repeat(2,1fr);

    gap:
        9px;

    margin-top:
        8px;
}

.stake-card {

    min-height:
        87px;

    position:
        relative;

    overflow:
        hidden;

    border:
        1px solid
        var(--line);

    border-radius:
        13px;

    color:
        white;

    background:
        linear-gradient(
            145deg,
            #151a22,
            #090c10
        );

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;

    justify-content:
        center;

    gap:
        2px;

    transition:
        .16s;
}

.stake-card:hover {

    transform:
        translateY(-2px);

    border-color:
        rgba(244,197,66,.34);
}

.stake-card.active {

    border-color:
        var(--gold);

    background:
        linear-gradient(
            145deg,
            rgba(244,197,66,.14),
            #090c10
        );

    box-shadow:
        0 0 0 2px
        rgba(244,197,66,.05);
}

.stake-symbol {

    font-size:
        16px;

    color:
        #d8dde4;
}

.stake-symbol.red {

    color:
        #cc4141;
}

.stake-card strong {

    color:
        var(--gold);

    font-size:
        20px;
}

.stake-card small {

    color:
        #727c8b;

    font-size:
        8px;

    font-weight:
        800;

    letter-spacing:
        .6px;
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
        18px;

    background:

        radial-gradient(
            circle at 50% 45%,
            rgba(24,126,70,.14),
            transparent 42%
        ),

        #06080c;
}

.game-top {

    width:
        min(1150px,100%);

    margin:
        auto;

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;

    gap:
        12px;

    flex-wrap:
        wrap;

    padding:
        11px 14px;

    border-radius:
        13px;

    background:
        #0d1117;

    border:
        1px solid
        var(--line);
}

.game-brand {

    color:
        var(--gold);

    font-weight:
        950;

    font-size:
        13px;
}

.game-info {

    display:
        flex;

    flex-wrap:
        wrap;

    gap:
        6px;
}

.badge {

    padding:
        6px 9px;

    border-radius:
        8px;

    border:
        1px solid
        var(--line);

    background:
        #070a0e;

    color:
        #838d9c;

    font-size:
        9px;
}

.badge b {

    color:
        white;
}

#status {

    min-height:
        27px;

    margin:
        9px;

    text-align:
        center;

    color:
        var(--gold);

    font-size:
        12px;

    font-weight:
        900;
}

/* =========================================================
   TABLE
========================================================= */

.table-board {

    width:
        min(1080px,96vw);

    height:
        560px;

    margin:
        auto;

    position:
        relative;

    overflow:
        hidden;

    border-radius:
        50% / 38%;

    border:
        17px solid
        #2c1c10;

    background:
        radial-gradient(
            ellipse at center,
            #16844b,
            #0a6037 58%,
            #06331e
        );

    box-shadow:

        0 28px 85px
        rgba(0,0,0,.72),

        inset 0 0 80px
        rgba(0,0,0,.35);
}

.table-board:before {

    content:
        "";

    position:
        absolute;

    inset:
        13px;

    border:
        1px solid
        rgba(255,255,255,.10);

    border-radius:
        50% / 38%;

    pointer-events:
        none;
}

.table-logo {

    position:
        absolute;

    left:
        50%;

    top:
        50%;

    transform:
        translate(-50%,-50%);

    color:
        rgba(255,255,255,.055);

    font-size:
        30px;

    font-weight:
        950;

    letter-spacing:
        5px;
}

/* =========================================================
   SEAT
========================================================= */

#players {

    position:
        absolute;

    inset:
        0;
}

.seat {

    position:
        absolute;

    width:
        140px;

    transform:
        translate(-50%,-50%);

    text-align:
        center;

    z-index:
        5;
}

.seat-box {

    padding:
        7px;

    border-radius:
        11px;

    background:
        rgba(5,8,11,.88);

    border:
        1px solid
        rgba(255,255,255,.11);

    box-shadow:
        0 8px 25px
        rgba(0,0,0,.38);
}

.seat.current
.seat-box {

    border-color:
        var(--gold);

    box-shadow:
        0 0 22px
        rgba(244,197,66,.30);
}

.seat-avatar {

    width:
        29px;

    height:
        29px;

    margin:
        auto;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        #2f3843;

    color:
        var(--gold);

    font-size:
        10px;

    font-weight:
        900;
}

.seat-name {

    margin-top:
        3px;

    font-size:
        10px;

    font-weight:
        900;
}

.seat-info {

    margin-top:
        2px;

    color:
        #7f8998;

    font-size:
        8px;
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
        18px;

    height:
        26px;

    border:
        1px solid
        #d0ad48;

    border-radius:
        3px;

    margin-left:
        -6px;

    background:
        repeating-linear-gradient(
            45deg,
            #27313a 0 3px,
            #121920 3px 6px
        );
}

.card-back:first-child {

    margin-left:
        0;
}

/* =========================================================
   CENTER CARDS
========================================================= */

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

    align-items:
        center;

    justify-content:
        center;

    gap:
        13px;

    max-width:
        57%;

    z-index:
        4;
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

    margin-bottom:
        4px;

    color:
        #d6dce5;

    font-size:
        8px;

    font-weight:
        800;
}

.play-group.winner
.card {

    border:
        2px solid
        var(--gold);

    box-shadow:
        0 0 17px
        rgba(244,197,66,.8);
}

/* =========================================================
   CARD
========================================================= */

.card {

    width:
        59px;

    height:
        86px;

    padding:
        5px;

    border-radius:
        7px;

    border:
        1px solid
        #d9d9d4;

    background:
        #fafaf6;

    color:
        #131313;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        space-between;

    font-weight:
        950;

    box-shadow:
        0 6px 14px
        rgba(0,0,0,.50);

    user-select:
        none;
}

.card.red {

    color:
        #ad1616;
}

.card-top,
.card-bottom {

    font-size:
        11px;
}

.card-center {

    text-align:
        center;

    font-size:
        25px;
}

.card-bottom {

    text-align:
        right;

    transform:
        rotate(180deg);
}

/* =========================================================
   HAND
========================================================= */

.hand-panel {

    width:
        min(1000px,100%);

    margin:
        16px auto 0;

    text-align:
        center;
}

.hand-title {

    margin-bottom:
        7px;

    color:
        #87919f;

    font-size:
        10px;
}

#my-cards {

    min-height:
        102px;

    display:
        flex;

    justify-content:
        center;

    align-items:
        flex-end;

    flex-wrap:
        wrap;

    gap:
        7px;
}

#my-cards
.card {

    cursor:
        pointer;

    transition:
        .13s;
}

#my-cards
.card:hover {

    transform:
        translateY(-6px);
}

#my-cards
.card.selected {

    transform:
        translateY(-13px);

    border:
        3px solid
        var(--gold);

    box-shadow:
        0 0 19px
        rgba(244,197,66,.55);
}

.play-btn {

    min-width:
        170px;

    height:
        41px;

    margin-top:
        10px;

    padding:
        0 27px;

    border:
        0;

    border-radius:
        10px;

    color:
        #151005;

    font-weight:
        950;

    background:
        linear-gradient(
            135deg,
            #ffe35d,
            #ff9700
        );
}

.play-btn:disabled {

    color:
        #68717e;

    background:
        #2b323c;

    cursor:
        not-allowed;
}

/* =========================================================
   SCOREBOARD
========================================================= */

.score-board {

    width:
        min(800px,100%);

    margin:
        15px auto 0;

    border:
        1px solid
        var(--line);

    border-radius:
        12px;

    overflow:
        hidden;

    background:
        #0b0e13;
}

.score-title {

    padding:
        9px;

    color:
        var(--gold);

    text-align:
        center;

    font-size:
        9px;

    font-weight:
        900;

    border-bottom:
        1px solid
        var(--line);
}

.score-grid {

    display:
        grid;

    gap:
        0;
}

.score-row {

    display:
        grid;

    grid-template-columns:
        1.2fr .8fr .8fr .8fr;

    border-bottom:
        1px solid
        rgba(255,255,255,.05);

    font-size:
        8px;
}

.score-row:last-child {

    border-bottom:
        0;
}

.score-row div {

    padding:
        7px;

    text-align:
        center;
}

.score-row.header {

    color:
        #727c8b;

    font-weight:
        900;
}

/* =========================================================
   MOBILE
========================================================= */

@media(max-width:800px) {

    .main-grid {

        grid-template-columns:
            1fr;
    }

    .table-board {

        height:
            490px;

        border-width:
            12px;
    }

    .seat {

        width:
            110px;
    }

    .card {

        width:
            50px;

        height:
            74px;
    }

    .card-center {

        font-size:
            20px;
    }
}

@media(max-width:520px) {

    .navbar {

        padding:
            0 13px;
    }

    .logo {

        font-size:
            16px;
    }

    .lobby-container {

        padding:
            25px 11px 50px;
    }

    .panel {

        padding:
            17px;
    }

    #game {

        padding:
            7px;
    }

    .table-board {

        height:
            420px;

        border-radius:
            47% / 31%;

        border-width:
            9px;
    }

    .seat {

        width:
            88px;
    }

    .seat-name {

        font-size:
            8px;
    }

    .seat-info {

        font-size:
            7px;
    }

    .card {

        width:
            45px;

        height:
            66px;

        padding:
            4px;
    }

    .card-center {

        font-size:
            18px;
    }

    .card-top,
    .card-bottom {

        font-size:
            9px;
    }

    #table-cards {

        max-width:
            70%;

        gap:
            6px;
    }

    .stake-card {

        min-height:
            77px;
    }
}

</style>

</head>

<body>

<!-- ======================================================
     LOBBY
======================================================= -->

<div id="lobby">

    <div class="navbar">

        <div class="logo">
            BURA
            <span>
                VIP CLUB
            </span>
        </div>

        <div class="nav-user">

            <div>

                <div
                    class="nav-name"
                    id="nav-username"
                >
                    სტუმარი
                </div>

                <div
                    class="nav-balance"
                    id="nav-balance"
                >
                    გაიარე რეგისტრაცია
                </div>

            </div>

            <div
                class="avatar"
                id="nav-avatar"
            >
                G
            </div>

        </div>

    </div>

    <div
        class="lobby-container"
    >

        <div class="hero">

            <div class="hero-tag">
                ♠ ONLINE CARD ROOM
            </div>

            <h1>
                BURA VIP CLUB
            </h1>

            <p>
                შექმენი ანგარიში, აირჩიე 3 ან 4 კაციანი მაგიდა,
                ფსონი და ითამაშე ბურა ონლაინ.
            </p>

        </div>

        <div class="main-grid">

            <!-- AUTH -->

            <div class="panel">

                <div class="auth-header">

                    <div class="auth-crown">
                        ♛
                    </div>

                    <div>

                        <h2>
                            Player Account
                        </h2>

                        <p>
                            შენი ადგილი BURA VIP CLUB-ში
                        </p>

                    </div>

                </div>

                <div class="bonus-banner">

                    <div class="bonus-icon">
                        ♠
                    </div>

                    <div>

                        <strong>
                            Welcome Bonus
                        </strong>

                        <span>
                            ყველა მოთამაშეს აქვს $1,000 სატესტო ბალანსი
                        </span>

                    </div>

                </div>

                <div class="auth-tabs">

                    <button
                        id="login-tab"
                        class="auth-tab active"
                        onclick="showLogin()"
                    >
                        შესვლა
                    </button>

                    <button
                        id="register-tab"
                        class="auth-tab"
                        onclick="showRegister()"
                    >
                        რეგისტრაცია
                    </button>

                </div>

                <!-- LOGIN -->

                <div id="login-box">

                    <div class="field">

                        <label>
                            Username
                        </label>

                        <input
                            id="login-username"
                            placeholder="შენი username"
                        >

                    </div>

                    <div class="field">

                        <label>
                            პაროლი
                        </label>

                        <input
                            id="login-password"
                            type="password"
                            placeholder="პაროლი"
                        >

                    </div>

                    <div class="tester-hint">
                        🧪 TEST MODE:
                        ჩაწერე
                        <b>saba123</b>
                        — პაროლი და რეგისტრაცია არ გჭირდება.
                        ცარიელი ადგილები ავტომატურად შეივსება ბოტებით.
                    </div>

                    <button
                        class="gold-btn"
                        onclick="loginUser()"
                    >
                        შესვლა
                    </button>

                </div>

                <!-- REGISTER -->

                <div
                    id="register-box"
                    class="hidden"
                >

                    <div class="field">

                        <label>
                            აირჩიე Username
                        </label>

                        <input
                            id="reg-username"
                            maxlength="20"
                            placeholder="მაგ: giorgi99"
                        >

                    </div>

                    <div class="field">

                        <label>
                            Email
                        </label>

                        <input
                            id="reg-email"
                            type="email"
                            placeholder="you@email.com"
                        >

                    </div>

                    <div class="field">

                        <label>
                            პაროლი
                        </label>

                        <input
                            id="reg-password"
                            type="password"
                            placeholder="მინიმუმ 6 სიმბოლო"
                        >

                    </div>

                    <button
                        class="gold-btn"
                        onclick="registerUser()"
                    >
                        ანგარიშის შექმნა
                    </button>

                </div>

                <div
                    id="auth-message"
                    class="message"
                ></div>

            </div>

            <!-- TABLE -->

            <div class="panel">

                <h2 class="panel-title">
                    აირჩიე მაგიდა
                </h2>

                <div class="panel-sub">
                    აირჩიე მოთამაშეების რაოდენობა და სასურველი ფსონი.
                </div>

                <div
                    id="logged-user-card"
                    class="logged-card hidden"
                >

                    <div>
                        მოთამაშე:
                        <strong
                            id="logged-name"
                        ></strong>
                    </div>

                    <button
                        class="logout-btn"
                        onclick="logout()"
                    >
                        გასვლა
                    </button>

                </div>

                <!-- CAPACITY -->

                <div class="field">

                    <label>
                        მოთამაშეების რაოდენობა
                    </label>

                    <input
                        type="hidden"
                        id="capacity"
                        value="3"
                    >

                    <div class="capacity-grid">

                        <button
                            class="capacity-card active"
                            onclick="selectCapacity(3,this)"
                        >
                            👥 3 მოთამაშე
                        </button>

                        <button
                            class="capacity-card"
                            onclick="selectCapacity(4,this)"
                        >
                            👥 4 მოთამაშე
                        </button>

                    </div>

                </div>

                <!-- PARTIES -->

                <div class="field">

                    <label>
                        პარტიების რაოდენობა
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

                    </select>

                </div>

                <!-- STAKES -->

                <div class="field">

                    <label>
                        ფსონი
                    </label>

                    <input
                        type="hidden"
                        id="stake"
                        value="5"
                    >

                    <div class="stake-grid">

                        <button
                            class="stake-card active"
                            onclick="selectStake(5,this)"
                        >

                            <span class="stake-symbol">
                                ♠
                            </span>

                            <strong>
                                $5
                            </strong>

                            <small>
                                LOW TABLE
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(10,this)"
                        >

                            <span class="stake-symbol">
                                ♣
                            </span>

                            <strong>
                                $10
                            </strong>

                            <small>
                                STANDARD
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(25,this)"
                        >

                            <span class="stake-symbol red">
                                ♥
                            </span>

                            <strong>
                                $25
                            </strong>

                            <small>
                                HIGH TABLE
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(50,this)"
                        >

                            <span class="stake-symbol red">
                                ♦
                            </span>

                            <strong>
                                $50
                            </strong>

                            <small>
                                VIP TABLE
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(100,this)"
                            style="
                                grid-column:1 / -1;
                            "
                        >

                            <span class="stake-symbol">
                                ♛
                            </span>

                            <strong>
                                $100
                            </strong>

                            <small>
                                ELITE TABLE
                            </small>

                        </button>

                    </div>

                </div>

                <button
                    class="gold-btn"
                    onclick="joinTable()"
                >
                    მაგიდაზე დაჯდომა
                </button>

                <div
                    id="waiting-message"
                    class="message"
                ></div>

            </div>

        </div>

    </div>

</div>

<!-- ======================================================
     GAME
======================================================= -->

<div id="game">

    <div class="game-top">

        <div class="game-brand">
            BURA VIP CLUB
        </div>

        <div class="game-info">

            <div class="badge">
                კოზირი:
                <b id="trump">
                    -
                </b>
            </div>

            <div class="badge">
                პარტია:
                <b id="party-num">
                    -
                </b>
            </div>

            <div class="badge">
                ხელი:
                <b id="hand-index">
                    -
                </b>
            </div>

            <div class="badge">
                დასტა:
                <b id="deck-count">
                    -
                </b>
            </div>

            <div class="badge">
                ფსონი:
                <b id="game-stake">
                    -
                </b>
            </div>

        </div>

    </div>

    <div id="status"></div>

    <div class="table-board">

        <div class="table-logo">
            BURA
        </div>

        <div id="players"></div>

        <div id="table-cards"></div>

    </div>

    <div class="hand-panel">

        <div class="hand-title">
            შენი კარტები
        </div>

        <div id="my-cards"></div>

        <button
            id="play-button"
            class="play-btn"
            disabled
            onclick="playSelectedCards()"
        >
            ჩამოსვლა
        </button>

    </div>

    <div class="score-board">

        <div class="score-title">
            LIVE SCORE
        </div>

        <div id="score-content"></div>

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
        "bura_token"
    );

let username =
    localStorage.getItem(
        "bura_username"
    );

let balance =
    localStorage.getItem(
        "bura_balance"
    );

let isTester =
    localStorage.getItem(
        "bura_tester"
    ) === "true";

let currentState =
    null;

let selectedCards =
    [];

updateUserUI();

/* =========================================================
   AUTH TABS
========================================================= */

function showLogin() {

    document
        .getElementById(
            "login-box"
        )
        .classList
        .remove(
            "hidden"
        );

    document
        .getElementById(
            "register-box"
        )
        .classList
        .add(
            "hidden"
        );

    document
        .getElementById(
            "login-tab"
        )
        .classList
        .add(
            "active"
        );

    document
        .getElementById(
            "register-tab"
        )
        .classList
        .remove(
            "active"
        );
}

function showRegister() {

    document
        .getElementById(
            "register-box"
        )
        .classList
        .remove(
            "hidden"
        );

    document
        .getElementById(
            "login-box"
        )
        .classList
        .add(
            "hidden"
        );

    document
        .getElementById(
            "register-tab"
        )
        .classList
        .add(
            "active"
        );

    document
        .getElementById(
            "login-tab"
        )
        .classList
        .remove(
            "active"
        );
}

/* =========================================================
   REGISTER
========================================================= */

async function registerUser() {

    const regUsername =
        document
            .getElementById(
                "reg-username"
            )
            .value
            .trim();

    const email =
        document
            .getElementById(
                "reg-email"
            )
            .value
            .trim();

    const password =
        document
            .getElementById(
                "reg-password"
            )
            .value;

    setAuthMessage(
        "ანგარიში იქმნება...",
        false
    );

    try {

        const response =
            await fetch(
                "/api/register",
                {

                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            username:
                                regUsername,

                            email,

                            password
                        })
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.ok
        ) {

            setAuthMessage(
                data.message ||
                "რეგისტრაცია ვერ შესრულდა.",
                true
            );

            return;
        }

        saveLogin(
            data
        );

        setAuthMessage(
            "✓ ანგარიში წარმატებით შეიქმნა. ბალანსი: $1,000",
            false
        );

    } catch (err) {

        console.error(
            err
        );

        setAuthMessage(
            "სერვერთან დაკავშირება ვერ მოხერხდა.",
            true
        );
    }
}

/* =========================================================
   LOGIN
========================================================= */

async function loginUser() {

    const loginUsername =
        document
            .getElementById(
                "login-username"
            )
            .value
            .trim();

    let password =
        document
            .getElementById(
                "login-password"
            )
            .value;

    if (
        loginUsername
            .toLowerCase() ===
        "saba123"
    ) {

        password =
            "";

        setAuthMessage(
            "🧪 TEST MODE იტვირთება...",
            false
        );

    } else {

        setAuthMessage(
            "შესვლა...",
            false
        );
    }

    try {

        const response =
            await fetch(
                "/api/login",
                {

                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
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
            !response.ok ||
            !data.ok
        ) {

            setAuthMessage(
                data.message ||
                "შესვლა ვერ შესრულდა.",
                true
            );

            return;
        }

        saveLogin(
            data
        );

        if (
            data.isTester
        ) {

            setAuthMessage(
                "🧪 TEST MODE აქტიურია — ბოტები ავტომატურად შეავსებენ მაგიდას.",
                false
            );

        } else {

            setAuthMessage(
                "✓ წარმატებით შეხვედით.",
                false
            );
        }

    } catch (err) {

        console.error(
            err
        );

        setAuthMessage(
            "სერვერთან დაკავშირება ვერ მოხერხდა.",
            true
        );
    }
}

/* =========================================================
   LOGIN STORAGE
========================================================= */

function saveLogin(
    data
) {

    token =
        data.token;

    username =
        data.username;

    balance =
        data.balance;

    isTester =
        !!data.isTester;

    localStorage.setItem(
        "bura_token",
        token
    );

    localStorage.setItem(
        "bura_username",
        username
    );

    localStorage.setItem(
        "bura_balance",
        balance
    );

    localStorage.setItem(
        "bura_tester",
        String(
            isTester
        )
    );

    updateUserUI();
}

function logout() {

    token =
        null;

    username =
        null;

    balance =
        null;

    isTester =
        false;

    localStorage.removeItem(
        "bura_token"
    );

    localStorage.removeItem(
        "bura_username"
    );

    localStorage.removeItem(
        "bura_balance"
    );

    localStorage.removeItem(
        "bura_tester"
    );

    updateUserUI();

    setAuthMessage(
        "ანგარიშიდან გამოხვედი.",
        false
    );
}

function setAuthMessage(
    text,
    error
) {

    const el =
        document
            .getElementById(
                "auth-message"
            );

    el.textContent =
        text;

    el.className =
        error
            ?
            "message error"
            :
            "message";
}

/* =========================================================
   USER UI
========================================================= */

function updateUserUI() {

    const navUsername =
        document
            .getElementById(
                "nav-username"
            );

    const navBalance =
        document
            .getElementById(
                "nav-balance"
            );

    const avatar =
        document
            .getElementById(
                "nav-avatar"
            );

    const loggedCard =
        document
            .getElementById(
                "logged-user-card"
            );

    const loggedName =
        document
            .getElementById(
                "logged-name"
            );

    if (
        token &&
        username
    ) {

        navUsername.textContent =
            username +
            (
                isTester
                    ?
                    " 🧪"
                    :
                    ""
            );

        navBalance.textContent =
            isTester
                ?
                "TEST MODE · $1,000"
                :
                "ბალანსი: $" +
                (
                    balance ?? 1000
                );

        avatar.textContent =
            username
                .charAt(0)
                .toUpperCase();

        loggedName.textContent =
            username;

        loggedCard
            .classList
            .remove(
                "hidden"
            );

    } else {

        navUsername.textContent =
            "სტუმარი";

        navBalance.textContent =
            "გაიარე რეგისტრაცია";

        avatar.textContent =
            "G";

        loggedCard
            .classList
            .add(
                "hidden"
            );
    }
}

/* =========================================================
   TABLE SELECT
========================================================= */

function selectCapacity(
    value,
    button
) {

    document
        .getElementById(
            "capacity"
        )
        .value =
            value;

    document
        .querySelectorAll(
            ".capacity-card"
        )
        .forEach(
            element =>
                element
                    .classList
                    .remove(
                        "active"
                    )
        );

    button
        .classList
        .add(
            "active"
        );
}

function selectStake(
    value,
    button
) {

    document
        .getElementById(
            "stake"
        )
        .value =
            value;

    document
        .querySelectorAll(
            ".stake-card"
        )
        .forEach(
            element =>
                element
                    .classList
                    .remove(
                        "active"
                    )
        );

    button
        .classList
        .add(
            "active"
        );
}

/* =========================================================
   JOIN
========================================================= */

function joinTable() {

    if (!token) {

        setAuthMessage(
            "ჯერ გაიარე რეგისტრაცია ან შედი ანგარიშზე.",
            true
        );

        window.scrollTo({
            top:
                0,
            behavior:
                "smooth"
        });

        return;
    }

    const capacity =
        document
            .getElementById(
                "capacity"
            )
            .value;

    const parties =
        document
            .getElementById(
                "parties"
            )
            .value;

    const stake =
        document
            .getElementById(
                "stake"
            )
            .value;

    document
        .getElementById(
            "waiting-message"
        )
        .textContent =
            isTester
                ?
                "🧪 TEST TABLE მზადდება..."
                :
                "ვეძებთ შესაბამის მაგიდას...";

    socket.emit(
        "joinTable",
        {
            token,
            capacity,
            parties,
            stake
        }
    );
}

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
    "waitingForPlayers",
    data => {

        document
            .getElementById(
                "waiting-message"
            )
            .textContent =
                "ველოდებით მოთამაშეებს: " +
                data.current +
                "/" +
                data.max +
                " · ფსონი $" +
                data.stake;
    }
);

socket.on(
    "gameStateUpdate",
    state => {

        if (!state) {
            return;
        }

        currentState =
            state;

        selectedCards =
            [];

        document
            .getElementById(
                "lobby"
            )
            .style
            .display =
                "none";

        document
            .getElementById(
                "game"
            )
            .style
            .display =
                "block";

        renderGame(
            state
        );
    }
);

socket.on(
    "errorMessage",
    message => {

        const status =
            document
                .getElementById(
                    "status"
                );

        status.textContent =
            message;

        document
            .getElementById(
                "waiting-message"
            )
            .textContent =
                message;
    }
);

socket.on(
    "playerLeft",
    () => {

        document
            .getElementById(
                "status"
            )
            .textContent =
                "ერთ-ერთმა მოთამაშემ მაგიდა დატოვა.";
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
            "trump"
        )
        .textContent =
            trumpName(
                state.trump
            );

    document
        .getElementById(
            "party-num"
        )
        .textContent =
            state.partyNum +
            "/" +
            state.targetParties;

    document
        .getElementById(
            "hand-index"
        )
        .textContent =
            state.handIndex;

    document
        .getElementById(
            "deck-count"
        )
        .textContent =
            state.deckCount;

    document
        .getElementById(
            "game-stake"
        )
        .textContent =
            "$" +
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
   PLAYERS
========================================================= */

function renderPlayers(
    state
) {

    const container =
        document
            .getElementById(
                "players"
            );

    container.innerHTML =
        "";

    const count =
        state.players.length;

    state.players.forEach(
        (
            player,
            index
        ) => {

            const seat =
                document
                    .createElement(
                        "div"
                    );

            seat.className =
                "seat" +
                (
                    player.isCurrent
                        ?
                        " current"
                        :
                        ""
                );

            const pos =
                seatPosition(
                    index,
                    count,
                    state.viewingPlayerId,
                    state.players
                );

            seat.style.left =
                pos.left +
                "%";

            seat.style.top =
                pos.top +
                "%";

            let backs =
                "";

            if (
                player.id !==
                state.viewingPlayerId
            ) {

                for (
                    let i = 0;

                    i <
                    player.cardCount;

                    i++
                ) {

                    backs +=
                        '<div class="card-back"></div>';
                }
            }

            seat.innerHTML =
                \`
                <div class="seat-box">

                    <div class="seat-avatar">
                        \${escapeHtml(
                            player.name
                                .charAt(0)
                                .toUpperCase()
                        )}
                    </div>

                    <div class="seat-name">
                        \${escapeHtml(
                            player.name
                        )}
                        \${player.isBot ? " 🤖" : ""}
                    </div>

                    <div class="seat-info">
                        კარტი:
                        \${player.cardCount}
                        · ხელი:
                        \${player.handPoints}
                        · სულ:
                        \${player.totalPoints}
                    </div>

                    <div class="card-backs">
                        \${backs}
                    </div>

                </div>
                \`;

            container.appendChild(
                seat
            );
        }
    );
}

/* =========================================================
   POSITION
========================================================= */

function seatPosition(
    playerIndex,
    playerCount,
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
        myIndex < 0
    ) {
        myIndex =
            0;
    }

    const relative =
        (
            playerIndex -
            myIndex +
            playerCount
        )
        %
        playerCount;

    const positions = {

        3: [

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
        ],

        4: [

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
        ]
    };

    return (
        positions[
            playerCount
        ] || positions[3]
    )[
        relative
    ];
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
                "table-cards"
            );

    container.innerHTML =
        "";

    state.table.forEach(
        play => {

            const group =
                document
                    .createElement(
                        "div"
                    );

            group.className =
                "play-group" +
                (
                    play.isWinning
                        ?
                        " winner"
                        :
                        ""
                );

            const name =
                document
                    .createElement(
                        "div"
                    );

            name.className =
                "play-name";

            name.textContent =
                play.playerName;

            group.appendChild(
                name
            );

            play.cards.forEach(
                card => {

                    group.appendChild(
                        createCardElement(
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
                "my-cards"
            );

    container.innerHTML =
        "";

    const myCards =
        state.playersCards[
            state.viewingPlayerId
        ] || [];

    myCards.forEach(
        (
            card,
            index
        ) => {

            const element =
                createCardElement(
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

/* =========================================================
   CARD
========================================================= */

function createCardElement(
    card
) {

    const element =
        document
            .createElement(
                "div"
            );

    const red =
        card.suit ===
        "hearts"
        ||
        card.suit ===
        "diamonds";

    element.className =
        "card" +
        (
            red
                ?
                " red"
                :
                ""
        );

    const suit =
        suitSymbol(
            card.suit
        );

    element.innerHTML =
        \`
        <div class="card-top">
            \${escapeHtml(card.rank)}
            \${suit}
        </div>

        <div class="card-center">
            \${suit}
        </div>

        <div class="card-bottom">
            \${escapeHtml(card.rank)}
            \${suit}
        </div>
        \`;

    return element;
}

/* =========================================================
   SELECT CARD
========================================================= */

function toggleCard(
    index,
    element
) {

    const existing =
        selectedCards.indexOf(
            index
        );

    if (
        existing !== -1
    ) {

        selectedCards.splice(
            existing,
            1
        );

        element
            .classList
            .remove(
                "selected"
            );

    } else {

        selectedCards.push(
            index
        );

        element
            .classList
            .add(
                "selected"
            );
    }

    updatePlayButton(
        currentState
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
                "play-button"
            );

    if (!state) {

        button.disabled =
            true;

        return;
    }

    const activePlayer =
        state.players[
            state.currentTurnIndex
        ];

    const myTurn =
        activePlayer
        &&
        activePlayer.id ===
        state.viewingPlayerId;

    button.disabled =
        !myTurn
        ||
        selectedCards.length ===
        0
        ||
        state.isProcessing
        ||
        state.gameOver;
}

function playSelectedCards() {

    if (
        selectedCards.length ===
        0
    ) {
        return;
    }

    socket.emit(
        "playCards",
        {
            cardIndices:
                selectedCards
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

    const status =
        document
            .getElementById(
                "status"
            );

    if (
        state.gameOver
    ) {

        status.textContent =
            "🏆 თამაში დასრულებულია";

        return;
    }

    if (
        state.isProcessing
    ) {

        status.textContent =
            "მაგიდის კარტები ითვლება...";

        return;
    }

    const activePlayer =
        state.players[
            state.currentTurnIndex
        ];

    if (!activePlayer) {
        return;
    }

    if (
        activePlayer.id ===
        state.viewingPlayerId
    ) {

        status.textContent =
            "🎯 შენი სვლაა";

    } else if (
        activePlayer.isBot
    ) {

        status.textContent =
            "🤖 " +
            activePlayer.name +
            " თამაშობს...";

    } else {

        status.textContent =
            activePlayer.name +
            "-ის სვლაა";
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
                "score-content"
            );

    let html =
        \`
        <div class="score-row header">

            <div>
                მოთამაშე
            </div>

            <div>
                აღებული
            </div>

            <div>
                ხელის ქულა
            </div>

            <div>
                საერთო
            </div>

        </div>
        \`;

    state.players.forEach(
        player => {

            html +=
                \`
                <div class="score-row">

                    <div>
                        \${escapeHtml(
                            player.name
                        )}
                    </div>

                    <div>
                        \${player.takenCount}
                    </div>

                    <div>
                        \${player.handPoints}
                    </div>

                    <div>
                        \${player.totalPoints}
                    </div>

                </div>
                \`;
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

    const map = {
        spades:
            "♠",
        clubs:
            "♣",
        hearts:
            "♥",
        diamonds:
            "♦"
    };

    return (
        map[suit] ||
        ""
    );
}

function trumpName(
    trump
) {

    if (
        trump ===
        "no_trump"
    ) {
        return "უკოზირო";
    }

    return suitSymbol(
        trump
    );
}

function escapeHtml(
    text
) {

    return String(
        text ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}

</script>

</body>

</html>
        `);
    }
);

/* =========================================================
   SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            "===================================="
        );

        console.log(
            "BURA VIP CLUB STARTED"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "DECK:",
            createDeck().length,
            "cards"
        );

        console.log(
            "TEST USER:",
            TESTER_USERNAME
        );

        console.log(
            "STARTING BALANCE: $",
            STARTING_BALANCE
        );

        console.log(
            "===================================="
        );
    }
);
