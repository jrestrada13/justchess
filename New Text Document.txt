import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    onSnapshot, 
    collection, 
    query, 
    where, 
    getDocs,
    serverTimestamp
} from 'firebase/firestore';

// --- Firebase Configuration ---
// This configuration is provided by the environment.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'just-chess-default';

// --- Helper Functions ---
const generateShortCode = (length = 6) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// --- React Components ---

// Displays a message modal for game over, etc.
function MessageModal({ title, message, onClose }) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm mx-4 text-center">
                <h3 className="text-2xl font-bold text-white mb-3">{title}</h3>
                <p className="text-gray-300 mb-6">{message}</p>
                <button
                    onClick={onClose}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105"
                >
                    Close
                </button>
            </div>
        </div>
    );
}

// Modal for entering a game code to join
function JoinModal({ onJoin, onClose }) {
    const [code, setCode] = useState('');
    const [error, setError] = useState('');

    const handleJoin = () => {
        if (code.trim().length === 6) {
            onJoin(code.trim().toLowerCase());
        } else {
            setError('Code must be 6 characters long.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
                <h3 className="text-2xl font-bold text-white mb-4 text-center">Join Game</h3>
                <input
                    type="text"
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value);
                        setError('');
                    }}
                    placeholder="Enter 6-character code"
                    maxLength="6"
                    className="w-full bg-gray-700 text-white border-2 border-gray-600 rounded-lg p-3 text-center text-lg tracking-widest font-mono uppercase"
                />
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                <div className="flex gap-4 mt-6">
                    <button
                        onClick={onClose}
                        className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleJoin}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300"
                    >
                        Join
                    </button>
                </div>
            </div>
        </div>
    );
}


// Main Game Page Component
function GamePage({ gameId, mode, userId, db, onExit }) {
    const [game, setGame] = useState(new Chess());
    const [gameData, setGameData] = useState(null);
    const [orientation, setOrientation] = useState('white');
    const [message, setMessage] = useState(null);

    const isPlayerTurn = useMemo(() => {
        if (!gameData) return false;
        if (mode === 'local') return true;
        const playerColor = gameData.playerWhite === userId ? 'w' : 'b';
        return game.turn() === playerColor;
    }, [game, gameData, userId, mode]);

    // Effect for handling online game state with Firestore
    useEffect(() => {
        if (mode !== 'online' || !gameId || !db) return;

        const gameRef = doc(db, `artifacts/${appId}/public/data/games`, gameId);
        const unsubscribe = onSnapshot(gameRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setGameData(data);
                setGame(new Chess(data.fen));
                
                if (data.playerWhite === userId) {
                    setOrientation('white');
                } else if (data.playerBlack === userId) {
                    setOrientation('black');
                }
            } else {
                setMessage({ title: "Error", message: "Game not found." });
            }
        });

        return () => unsubscribe();
    }, [gameId, mode, db, userId]);
    
    // Effect for handling local game state
    useEffect(() => {
        if (mode === 'local') {
            setGameData({ status: 'active' });
        }
    }, [mode]);

    // Effect to check for game over conditions
    useEffect(() => {
        if (game.isGameOver()) {
            let title = "Game Over";
            let msg = "The game has ended.";
            if (game.isCheckmate()) {
                msg = `Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
            } else if (game.isDraw()) {
                msg = "It's a draw!";
            } else if (game.isStalemate()) {
                msg = "Stalemate!";
            } else if (game.isThreefoldRepetition()) {
                msg = "Draw by threefold repetition.";
            }
            setMessage({ title, message: msg });
            
            if (mode === 'online' && gameData && gameData.status === 'active' && db) {
                const gameRef = doc(db, `artifacts/${appId}/public/data/games`, gameId);
                updateDoc(gameRef, {
                    status: 'completed',
                    winner: game.turn() === 'w' ? 'black' : 'white',
                });
            }
        }
    }, [game, gameId, mode, db, gameData]);


    const onPieceDrop = useCallback((sourceSquare, targetSquare) => {
        if (!isPlayerTurn && mode === 'online') return false;
        if (game.isGameOver()) return false;

        const gameCopy = new Chess(game.fen());
        const move = gameCopy.move({
            from: sourceSquare,
            to: targetSquare,
            promotion: 'q', // Always promote to a queen
        });

        if (move === null) {
            return false; // Illegal move
        }

        // Update the game state for all modes since the move is valid
        setGame(gameCopy);

        // Handle mode-specific logic
        if (mode === 'local') {
            // Introduce a tiny delay to prevent a rendering glitch on flip.
            // This gives React a moment to update the piece positions before flipping the board.
            setTimeout(() => {
                setOrientation(gameCopy.turn() === 'w' ? 'white' : 'black');
            }, 50);
        } else if (mode === 'online' && db) {
            // For online games, push the new state to Firestore
            const gameRef = doc(db, `artifacts/${appId}/public/data/games`, gameId);
            updateDoc(gameRef, { fen: gameCopy.fen(), pgn: gameCopy.pgn() })
                .catch(err => console.error("Failed to update move:", err));
        }
        
        return true;
    }, [game, gameId, isPlayerTurn, mode, db]);

    const getStatusMessage = () => {
        if (!gameData) return "Loading...";
        if (mode === 'local') {
            return `Turn: ${game.turn() === 'w' ? 'White' : 'Black'}`;
        }
        if (gameData.status === 'waiting') return `Waiting for opponent... Code: ${gameData.shortCode.toUpperCase()}`;
        if (gameData.status === 'completed') return "Game Over";
        if (isPlayerTurn) return "Your turn";
        return "Opponent's turn";
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
            {message && <MessageModal title={message.title} message={message.message} onClose={() => setMessage(null)} />}
            <div className="w-full max-w-lg md:max-w-xl lg:max-w-2xl">
                <div className="bg-gray-800 text-white p-3 rounded-t-lg text-center font-semibold text-lg">
                    {getStatusMessage()}
                </div>
                <Chessboard
                    position={game.fen()}
                    onPieceDrop={onPieceDrop}
                    boardOrientation={orientation}
                    customBoardStyle={{
                        borderRadius: '0',
                        boxShadow: '0 5px 15px rgba(0, 0, 0, 0.5)',
                    }}
                    customDarkSquareStyle={{ backgroundColor: '#779556' }}
                    customLightSquareStyle={{ backgroundColor: '#EBECD0' }}
                />
                <div className="bg-gray-800 p-4 rounded-b-lg flex justify-between items-center">
                    <h1 className="text-xl font-bold text-white">JustChess</h1>
                    <button
                        onClick={onExit}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-5 rounded-lg transition duration-300"
                    >
                        Exit Game
                    </button>
                </div>
            </div>
        </div>
    );
}

// Home Page Component
function HomePage({ onNewGame, onJoinGame, onLocalGame }) {
    return (
        <div className="min-h-screen bg-gray-900 flex flex-col justify-center items-center text-white p-4">
            <div className="text-center mb-12">
                <h1 className="text-6xl font-bold mb-2">JustChess</h1>
                <p className="text-xl text-gray-400">No accounts. No hassle. Just chess.</p>
            </div>
            <div className="w-full max-w-sm space-y-5">
                <button
                    onClick={onNewGame}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-lg text-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-lg"
                >
                    Create Online Game
                </button>
                <button
                    onClick={onJoinGame}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-4 rounded-lg text-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-lg"
                >
                    Join with Code
                </button>
                <button
                    onClick={onLocalGame}
                    className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-4 px-4 rounded-lg text-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-lg"
                >
                    Play Over The Table
                </button>
            </div>
        </div>
    );
}

// Main App Component
export default function App() {
    const [page, setPage] = useState('home');
    const [gameId, setGameId] = useState(null);
    const [gameMode, setGameMode] = useState('local'); // 'local' or 'online'
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [message, setMessage] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // Firebase state
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);

    useEffect(() => {
        if (firebaseConfig && Object.keys(firebaseConfig).length > 0) {
            try {
                const app = initializeApp(firebaseConfig);
                const firestoreDb = getFirestore(app);
                const firestoreAuth = getAuth(app);
                setDb(firestoreDb);
                setAuth(firestoreAuth);

                onAuthStateChanged(firestoreAuth, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        try {
                            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                                await signInWithCustomToken(firestoreAuth, __initial_auth_token);
                            } else {
                                await signInAnonymously(firestoreAuth);
                            }
                        } catch (error) {
                            console.error("Authentication failed:", error);
                            setMessage({ title: "Auth Error", message: "Could not sign in." });
                        }
                    }
                    setIsLoading(false);
                });
            } catch (e) {
                console.error("Firebase initialization failed:", e);
                setMessage({ title: "Init Error", message: "Failed to initialize services."});
                setIsLoading(false);
            }
        } else {
            console.log("No Firebase config found, running in local-only mode.");
            setIsLoading(false); // No firebase config, run in local-only mode
        }
    }, []);

    const handleNewOnlineGame = async () => {
        if (!db || !userId) {
            setMessage({ title: "Connection Error", message: "Cannot connect to the server. Please try again." });
            return;
        }
        setIsLoading(true);
        const newGameId = doc(collection(db, `artifacts/${appId}/public/data/games`)).id;
        const shortCode = generateShortCode();
        const gameRef = doc(db, `artifacts/${appId}/public/data/games`, newGameId);
        
        const initialGame = {
            fen: new Chess().fen(),
            pgn: '',
            shortCode: shortCode,
            playerWhite: userId,
            playerBlack: null,
            status: 'waiting', // waiting, active, completed
            createdAt: serverTimestamp(),
        };

        try {
            await setDoc(gameRef, initialGame);
            setGameId(newGameId);
            setGameMode('online');
            setPage('game');
            setMessage({
                title: "Game Created!",
                message: `Share this code with your friend: ${shortCode.toUpperCase()}`
            });
        } catch (error) {
            console.error("Error creating game:", error);
            setMessage({ title: "Error", message: "Could not create the game." });
        } finally {
            setIsLoading(false);
        }
    };

    const handleJoinOnlineGame = async (code) => {
        if (!db || !userId) {
            setMessage({ title: "Connection Error", message: "Cannot connect to the server." });
            return;
        }
        setIsLoading(true);
        setShowJoinModal(false);
        const gamesRef = collection(db, `artifacts/${appId}/public/data/games`);
        const q = query(gamesRef, where("shortCode", "==", code), where("status", "==", "waiting"));

        try {
            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) {
                setMessage({ title: "Not Found", message: "No waiting game found with that code." });
            } else {
                const gameDoc = querySnapshot.docs[0];
                const gameToJoinId = gameDoc.id;
                const gameData = gameDoc.data();

                if(gameData.playerWhite === userId) {
                     setMessage({ title: "Oops!", message: "You can't join your own game." });
                     setIsLoading(false);
                     return;
                }

                await updateDoc(doc(db, `artifacts/${appId}/public/data/games`, gameToJoinId), {
                    playerBlack: userId,
                    status: 'active',
                });
                setGameId(gameToJoinId);
                setGameMode('online');
                setPage('game');
            }
        } catch (error) {
            console.error("Error joining game:", error);
            setMessage({ title: "Error", message: "Could not join the game." });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLocalGame = () => {
        setGameId(null);
        setGameMode('local');
        setPage('game');
    };

    const handleExitGame = () => {
        setPage('home');
        setGameId(null);
    };

    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="min-h-screen bg-gray-900 flex justify-center items-center">
                    <h1 className="text-white text-3xl">Loading JustChess...</h1>
                </div>
            );
        }

        switch (page) {
            case 'game':
                return <GamePage gameId={gameId} mode={gameMode} userId={userId} db={db} onExit={handleExitGame} />;
            default:
                return <HomePage onNewGame={handleNewOnlineGame} onJoinGame={() => setShowJoinModal(true)} onLocalGame={handleLocalGame} />;
        }
    };

    return (
        <>
            {message && <MessageModal title={message.title} message={message.message} onClose={() => setMessage(null)} />}
            {showJoinModal && <JoinModal onJoin={handleJoinOnlineGame} onClose={() => setShowJoinModal(false)} />}
            {renderContent()}
        </>
    );
}
