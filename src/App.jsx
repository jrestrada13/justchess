import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
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
const firebaseConfig = {
  apiKey: "AIzaSyD6gCgxx3NpDCr_4iqQfRg9jNNTljOcIq4",
  authDomain: "justchess-6afd3.firebaseapp.com",
  projectId: "justchess-6afd3",
  storageBucket: "justchess-6afd3.appspot.com",
  messagingSenderId: "890708766145",
  appId: "1:890708766145:web:d9140f62a58068d8181340"
};
const appId = 'justchess-6afd3';

// --- Helper Functions ---
const generateShortCode = (length = 6) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
};

// --- Robust PGN Loader ---
const loadPgnWithRobustParsing = (pgnString) => {
    const game = new Chess();
    if (game.loadPgn(pgnString)) {
        return game;
    }
    const pgnWithoutHeaders = pgnString.replace(/\[.*?\]\s*/g, '');
    const game2 = new Chess();
    if (game2.loadPgn(pgnWithoutHeaders)) {
        return game2;
    }
    const moveText = pgnString
        .replace(/\[.*?\]\s*|\{.*?\}|\(.*?\)|1-0|0-1|1\/2-1\/2|\*|\d+\.{1,3}\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const moves = moveText.split(' ');
    const finalGame = new Chess();
    try {
        for (const move of moves) {
            if (move.trim() === '') continue;
            if (finalGame.move(move) === null) return null;
        }
        return finalGame;
    } catch (e) {
        return null;
    }
};


// --- React Components ---

function MessageModal({ title, message, onClose, onAnalyze, onShare, shareData }) {
    const [copied, setCopied] = useState(false);

    const handleShare = () => {
        onShare(shareData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm mx-4 text-center">
                <h3 className="text-2xl font-bold text-white mb-3">{title}</h3>
                <p className="text-gray-300 mb-6 whitespace-pre-wrap">{message}</p>
                <div className="flex flex-col space-y-3">
                    {onAnalyze && (
                         <button onClick={onAnalyze} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg">Analyze Game</button>
                    )}
                    {onShare && (
                        <button onClick={handleShare} className={`w-full font-bold py-3 px-4 rounded-lg transition-colors ${copied ? 'bg-green-600' : 'bg-purple-600 hover:bg-purple-700'} text-white`}>
                            {copied ? 'Link Copied!' : 'Copy Game Link'}
                        </button>
                    )}
                    <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg">Close</button>
                </div>
            </div>
        </div>
    );
}

function JoinModal({ onJoin, onClose }) {
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const handleJoin = () => {
        if (code.trim().length === 6) onJoin(code.trim().toLowerCase());
        else setError('Code must be 6 characters long.');
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
                <h3 className="text-2xl font-bold text-white mb-4 text-center">Join Game</h3>
                <input type="text" value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} placeholder="Enter 6-character code" maxLength="6" className="w-full bg-gray-700 text-white border-2 border-gray-600 rounded-lg p-3 text-center text-lg tracking-widest font-mono uppercase" />
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                <div className="flex gap-4 mt-6">
                    <button onClick={onClose} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded-lg">Cancel</button>
                    <button onClick={handleJoin} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg">Join</button>
                </div>
            </div>
        </div>
    );
}

function ImportPgnModal({ onImport, onClose }) {
    const [pgn, setPgn] = useState('');
    const [error, setError] = useState('');
    const handleImport = () => {
        if (pgn.trim() === '') {
            setError('Please paste a PGN string.');
            return;
        }
        onImport(pgn);
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
                <h3 className="text-2xl font-bold text-white mb-4 text-center">Import PGN</h3>
                <textarea value={pgn} onChange={(e) => { setPgn(e.target.value); setError(''); }} placeholder="[Event &quot;?&quot;]..." className="w-full bg-gray-700 text-white border-2 border-gray-600 rounded-lg p-3 h-48 font-mono text-sm" />
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                <div className="flex gap-4 mt-6">
                    <button onClick={onClose} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded-lg">Cancel</button>
                    <button onClick={handleImport} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg">Load & Analyze</button>
                </div>
            </div>
        </div>
    );
}

function GamePage({ gameId, mode, userId, db, onExit, onGameOver }) {
    const [game, setGame] = useState(new Chess());
    const [gameData, setGameData] = useState(null);
    const [orientation, setOrientation] = useState('white');
    const [message, setMessage] = useState(null);
    const [copied, setCopied] = useState(false);
    
    useEffect(() => {
        if (game.isGameOver()) {
            let title = "Game Over";
            let msg = "The game has ended.";
            if (game.isCheckmate()) msg = `Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
            else if (game.isDraw()) msg = "It's a draw!";
            setMessage({ title, message: msg });
            onGameOver(game.pgn());
        }
    }, [game, onGameOver]);

    const isPlayerTurn = useMemo(() => {
        if (game.isGameOver()) return false;
        if (mode === 'local') return true;
        if (mode === 'online' && gameData) {
            const onlinePlayerColor = gameData.playerWhite === userId ? 'w' : 'b';
            return game.turn() === onlinePlayerColor;
        }
        return false;
    }, [game, gameData, userId, mode]);

    useEffect(() => {
        if (mode !== 'online' || !gameId || !db) return;
        const gameRef = doc(db, `artifacts/${appId}/public/data/games`, gameId);
        const unsubscribe = onSnapshot(gameRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const newGame = new Chess();
                // Correctly load from PGN if it exists, otherwise load from FEN
                if (data.pgn && data.pgn.trim() !== '') {
                    newGame.loadPgn(data.pgn);
                } else {
                    newGame.load(data.fen); // Use .load() for FEN strings
                }
                setGameData(data);
                setGame(newGame);
                if (data.playerWhite === userId) setOrientation('white');
                else if (data.playerBlack === userId) setOrientation('black');
            } else {
                setMessage({ title: "Error", message: "Game not found." });
            }
        });
        return () => unsubscribe();
    }, [gameId, mode, db, userId]);

    useEffect(() => {
        if (mode === 'local') {
            setGameData({ status: 'active' });
        }
    }, [mode]);

    const onPieceDrop = useCallback((sourceSquare, targetSquare) => {
        if (!isPlayerTurn) return false;
        const gameCopy = new Chess();
        gameCopy.loadPgn(game.pgn());
        const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
        if (move === null) return false;
        setGame(gameCopy);
        if (mode === 'local') {
            setTimeout(() => setOrientation(gameCopy.turn() === 'w' ? 'white' : 'black'), 50);
        } else if (mode === 'online' && db) {
            const gameRef = doc(db, `artifacts/${appId}/public/data/games`, gameId);
            updateDoc(gameRef, { fen: gameCopy.fen(), pgn: gameCopy.pgn() });
        }
        return true;
    }, [game, isPlayerTurn, mode, db, gameId]);
    
    const handleCopyPgn = () => {
        const pgn = game.pgn();
        const textArea = document.createElement('textarea');
        textArea.value = pgn;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy PGN: ', err);
        }
        document.body.removeChild(textArea);
    };

    const getStatusMessage = () => {
        if (!gameData) return "Loading...";
        if (mode === 'local') return `Turn: ${game.turn() === 'w' ? 'White' : 'Black'}`;
        if (gameData.status === 'waiting') return `Waiting for opponent... Code: ${gameData.shortCode.toUpperCase()}`;
        if (game.isGameOver()) return "Game Over";
        if (isPlayerTurn) return "Your turn";
        return "Opponent's turn";
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
            {message && <MessageModal title={message.title} message={message.message} onClose={() => setMessage(null)} onAnalyze={game.isGameOver() ? () => onGameOver(game.pgn(), true) : null} />}
            
            <div className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-4">
                {/* PGN Tracker - Side (Desktop) */}
                <div className="hidden lg:block w-72 bg-gray-800 p-4 rounded-lg">
                    <h3 className="text-white text-lg font-bold mb-2">Moves</h3>
                    <div className="bg-gray-900 rounded-lg p-3 h-[calc(100vh-12rem)] max-h-[600px] overflow-y-auto">
                        <p className="text-white font-mono text-sm whitespace-pre-wrap break-words">{game.pgn() || "No moves yet."}</p>
                    </div>
                </div>

                {/* Main Board and Controls */}
                <div className="flex-1 flex flex-col">
                    <div className="bg-gray-800 text-white p-3 rounded-t-lg text-center font-semibold text-lg">{getStatusMessage()}</div>
                    
                    {/* PGN Tracker - Ticker (Mobile) */}
                    <div className="lg:hidden bg-gray-800 p-2">
                        <div className="bg-gray-900 rounded-lg p-2 overflow-x-auto whitespace-nowrap">
                            <p className="text-white font-mono text-sm">{game.pgn() || "No moves yet."}</p>
                        </div>
                    </div>

                    <div className="w-full">
                        <Chessboard position={game.fen()} onPieceDrop={onPieceDrop} boardOrientation={orientation} />
                    </div>

                    <div className="bg-gray-800 p-4 rounded-b-lg flex justify-between items-center">
                        <button onClick={handleCopyPgn} className={`font-bold py-2 px-5 rounded-lg transition duration-300 ${copied ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>{copied ? 'Copied!' : 'Copy PGN'}</button>
                        <button onClick={onExit} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-5 rounded-lg">Exit Game</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AnalysisPage({ pgn, onExit }) {
    const [game, setGame] = useState(null);
    const [history, setHistory] = useState([]);
    const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
    const [displayFen, setDisplayFen] = useState('start');

    useEffect(() => {
        const loadedGame = loadPgnWithRobustParsing(pgn);
        if (loadedGame) {
            setGame(loadedGame);
            setHistory(loadedGame.history({ verbose: true }));
            setCurrentMoveIndex(loadedGame.history().length - 1);
        }
    }, [pgn]);

    useEffect(() => {
        if (!game) return;
        if (currentMoveIndex < 0) {
            setDisplayFen(new Chess().fen());
            return;
        }
        const tempGame = new Chess();
        for (let i = 0; i <= currentMoveIndex; i++) {
            tempGame.move(history[i].san);
        }
        setDisplayFen(tempGame.fen());
    }, [currentMoveIndex, game, history]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'ArrowRight') {
                setCurrentMoveIndex(prev => Math.min(prev + 1, history.length - 1));
            } else if (event.key === 'ArrowLeft') {
                setCurrentMoveIndex(prev => Math.max(prev - 1, -1));
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [history.length]);
    
    if (!game) return <div className="min-h-screen bg-gray-900 flex justify-center items-center"><h1 className="text-white text-3xl">Loading Analysis...</h1></div>;

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
            <div className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-4">
                {/* PGN Tracker - Side (Desktop) */}
                <div className="hidden lg:block w-72 bg-gray-800 p-4 rounded-lg">
                    <h3 className="text-white text-lg font-bold mb-2">Analysis</h3>
                    <div className="bg-gray-900 rounded-lg p-3 h-[calc(100vh-16rem)] max-h-[600px] overflow-y-auto">
                        {history.map((move, index) => (
                            <div key={index} className={`p-1 rounded cursor-pointer ${currentMoveIndex === index ? 'bg-purple-800' : ''}`} onClick={() => setCurrentMoveIndex(index)}>
                                <span className="text-white font-mono text-sm">
                                    {index % 2 === 0 && `${Math.floor(index/2) + 1}. `}
                                    {move.san}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
                
                {/* Main Board and Controls */}
                <div className="flex-1 flex flex-col">
                    <div className="bg-gray-800 text-white p-3 rounded-t-lg text-center font-semibold text-lg">Game Analysis</div>
                    <Chessboard position={displayFen} boardOrientation="white" />
                    <div className="bg-gray-800 p-4 flex justify-center space-x-2">
                        <button onClick={() => setCurrentMoveIndex(-1)} className="font-bold py-2 px-4 rounded-lg bg-gray-600 hover:bg-gray-700 text-white">« First</button>
                        <button onClick={() => setCurrentMoveIndex(p => Math.max(p - 1, -1))} className="font-bold py-2 px-4 rounded-lg bg-gray-600 hover:bg-gray-700 text-white">‹ Prev</button>
                        <button onClick={() => setCurrentMoveIndex(p => Math.min(p + 1, history.length - 1))} className="font-bold py-2 px-4 rounded-lg bg-gray-600 hover:bg-gray-700 text-white">Next ›</button>
                        <button onClick={() => setCurrentMoveIndex(history.length - 1)} className="font-bold py-2 px-4 rounded-lg bg-gray-600 hover:bg-gray-700 text-white">Last »</button>
                    </div>
                    {/* PGN Tracker - Ticker (Mobile) */}
                    <div className="lg:hidden bg-gray-800 p-4">
                        <div className="bg-gray-900 rounded-lg p-3 h-48 overflow-y-auto">
                           {history.map((move, index) => (
                                <div key={index} className={`p-1 rounded cursor-pointer ${currentMoveIndex === index ? 'bg-purple-800' : ''}`} onClick={() => setCurrentMoveIndex(index)}>
                                    <span className="text-white font-mono text-sm">
                                        {index % 2 === 0 && `${Math.floor(index/2) + 1}. `}
                                        {move.san}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-gray-800 p-4 rounded-b-lg flex flex-wrap justify-center gap-2">
                        <button onClick={onExit} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">Back to Home</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function HomePage({ onNewGame, onJoinGame, onLocalGame, onImportGame }) {
    const [onlinePlayerColor, setOnlinePlayerColor] = useState('random');

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col justify-center items-center text-white p-4">
            <div className="text-center mb-12">
                <h1 className="text-6xl font-bold mb-2">JustChess</h1>
                <p className="text-xl text-gray-400">No accounts. No hassle. Just chess.</p>
            </div>
            <div className="w-full max-w-sm space-y-5">
                <div className="bg-gray-800 p-4 rounded-lg">
                    <div className="text-center mb-4">
                        <p className="text-lg font-medium text-gray-300 mb-2">Play as:</p>
                        <div className="inline-flex rounded-md shadow-sm" role="group">
                            <button onClick={() => setOnlinePlayerColor('w')} type="button" className={`px-4 py-2 text-sm font-medium rounded-l-lg ${onlinePlayerColor === 'w' ? 'bg-blue-800 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>White</button>
                            <button onClick={() => setOnlinePlayerColor('random')} type="button" className={`px-4 py-2 text-sm font-medium ${onlinePlayerColor === 'random' ? 'bg-blue-800 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>Random</button>
                            <button onClick={() => setOnlinePlayerColor('b')} type="button" className={`px-4 py-2 text-sm font-medium rounded-r-lg ${onlinePlayerColor === 'b' ? 'bg-blue-800 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>Black</button>
                        </div>
                    </div>
                    <button onClick={() => onNewGame(onlinePlayerColor)} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Create Online Game</button>
                </div>
                <button onClick={onJoinGame} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Join with Code</button>
                <button onClick={onLocalGame} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Play Over The Table</button>
                <button onClick={onImportGame} className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Import PGN</button>
            </div>
        </div>
    );
}

export default function App() {
    const [page, setPage] = useState('home');
    const [gameId, setGameId] = useState(null);
    const [gameMode, setGameMode] = useState('local');
    const [pgnToAnalyze, setPgnToAnalyze] = useState('');
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [message, setMessage] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            setDb(getFirestore(app));
            setAuth(getAuth(app));
        } catch (e) { setIsLoading(false); }
    }, []);

    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                try { await signInAnonymously(auth); } catch (error) { setMessage({ title: "Auth Error", message: "Could not sign in." }); }
            } else {
                setUserId(user.uid);
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [auth]);

    const handleGameOver = useCallback((pgn, analyze = false) => {
        setPgnToAnalyze(pgn);
        if (analyze) {
            setPage('analysis');
        }
    }, []);

    const handleNewOnlineGame = useCallback(async (color) => {
        if (!db || !userId) return;
        setIsLoading(true);
        const newGameId = doc(collection(db, `artifacts/${appId}/public/data/games`)).id;
        const shortCode = generateShortCode();
        const gameRef = doc(db, `artifacts/${appId}/public/data/games`, newGameId);
        
        let chosenColor = color;
        if (color === 'random') {
            chosenColor = Math.random() > 0.5 ? 'w' : 'b';
        }

        const initialGame = { 
            fen: new Chess().fen(), 
            pgn: '', 
            shortCode, 
            playerWhite: chosenColor === 'w' ? userId : null, 
            playerBlack: chosenColor === 'b' ? userId : null, 
            status: 'waiting', 
            createdAt: serverTimestamp() 
        };
        await setDoc(gameRef, initialGame);
        setGameId(newGameId);
        setGameMode('online');
        setPage('game');
        setMessage({ title: "Game Created!", message: `Share this code: ${shortCode.toUpperCase()}`, onShare: (data) => {
            const url = `${window.location.origin}?gameId=${data.gameId}`;
            navigator.clipboard.writeText(url);
        }, shareData: { gameId: newGameId } });
        setIsLoading(false);
    }, [db, userId]);

    const handleJoinOnlineGame = useCallback(async (code) => {
        if (!db || !userId) return;
        setIsLoading(true);
        setShowJoinModal(false);
        const gamesRef = collection(db, `artifacts/${appId}/public/data/games`);
        const q = query(gamesRef, where("shortCode", "==", code), where("status", "==", "waiting"));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            setMessage({ title: "Not Found", message: "No waiting game with that code." });
        } else {
            const gameDoc = querySnapshot.docs[0];
            const gameData = gameDoc.data();
            if (gameData.playerWhite === userId || gameData.playerBlack === userId) {
                setMessage({ title: "Oops!", message: "You can't join your own game." });
            } else {
                const updates = { status: 'active' };
                if (gameData.playerWhite === null) {
                    updates.playerWhite = userId;
                } else {
                    updates.playerBlack = userId;
                }
                await updateDoc(doc(db, `artifacts/${appId}/public/data/games`, gameDoc.id), updates);
                setGameId(gameDoc.id);
                setGameMode('online');
                setPage('game');
            }
        }
        setIsLoading(false);
    }, [db, userId]);
    
    const handleLocalGame = useCallback(() => {
        setGameId(null);
        setGameMode('local');
        setPage('game');
    }, []);

    const handleImportPgn = useCallback((pgn) => {
        setShowImportModal(false);
        const loadedGame = loadPgnWithRobustParsing(pgn);

        if (!loadedGame) {
            setMessage({ title: "Invalid PGN", message: "Could not load the PGN. Please check the format and moves." });
            return;
        }
        
        setPgnToAnalyze(pgn);
        setPage('analysis');
    }, []);

    const handleExitGame = useCallback(() => {
        setPage('home');
        setGameId(null);
    }, []);

    const renderContent = () => {
        if (isLoading) return <div className="min-h-screen bg-gray-900 flex justify-center items-center"><h1 className="text-white text-3xl">Loading...</h1></div>;
        switch (page) {
            case 'game':
                return <GamePage gameId={gameId} mode={gameMode} userId={userId} db={db} onExit={handleExitGame} onGameOver={handleGameOver} />;
            case 'analysis':
                return <AnalysisPage pgn={pgnToAnalyze} onExit={handleExitGame} />;
            default:
                return <HomePage onNewGame={handleNewOnlineGame} onJoinGame={() => setShowJoinModal(true)} onLocalGame={handleLocalGame} onImportGame={() => setShowImportModal(true)} />;
        }
    };

    return (
        <>
            {message && <MessageModal title={message.title} message={message.message} onClose={() => setMessage(null)} onShare={message.onShare} shareData={message.shareData} />}
            {showJoinModal && <JoinModal onJoin={handleJoinOnlineGame} onClose={() => setShowJoinModal(false)} />}
            {showImportModal && <ImportPgnModal onImport={handleImportPgn} onClose={() => setShowImportModal(false)} />}
            {renderContent()}
        </>
    );
}
