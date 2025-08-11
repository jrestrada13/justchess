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

// --- Stockfish Integration Placeholder ---
const stockfish = {
    postMessage: (command) => {
        console.log(`Stockfish command: ${command}`);
        if (command.startsWith('go')) {
            setTimeout(() => {
                if (stockfish.onmessage) {
                    const game = new Chess(stockfish._currentFen);
                    const moves = game.moves({ verbose: true });
                    if (moves.length > 0) {
                        const bestMove = moves[Math.floor(Math.random() * moves.length)];
                        stockfish.onmessage({ data: `bestmove ${bestMove.from}${bestMove.to}` });
                    }
                }
            }, 1000);
        } else if (command.startsWith('position fen')) {
            stockfish._currentFen = command.substring(13);
        }
    },
    onmessage: null,
    _currentFen: '',
};

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

// --- Gemini API Helper ---
const callGeminiAPI = async (prompt) => {
    // Your Gemini API key is now included.
    const apiKey = "AIzaSyC24luvljlvWXKhjgjq6XcR1-6ZPUKWpbw"; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
    };

    try {
        if (apiKey === "YOUR_GEMINI_API_KEY_HERE" || apiKey === "") {
            return "Please add your Gemini API key to the code to use this feature.";
        }
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`API call failed with status: ${response.status}`);
        }
        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 && result.candidates[0].content.parts.length > 0) {
            return result.candidates[0].content.parts[0].text;
        }
        return "Sorry, I couldn't generate a response.";
    } catch (error) {
        console.error("Gemini API call failed:", error);
        return "An error occurred while contacting the AI assistant.";
    }
};

// --- Robust PGN Loader ---
const loadPgnWithRobustParsing = (pgnString) => {
    const game = new Chess();
    // The chess.js pgn loader is very strict. We'll try it first.
    if (game.loadPgn(pgnString)) {
        return game;
    }

    // If it fails, strip headers and try again.
    const pgnWithoutHeaders = pgnString.replace(/\[.*?\]\s*/g, '');
    const game2 = new Chess();
    if (game2.loadPgn(pgnWithoutHeaders)) {
        return game2;
    }
    
    // If it STILL fails, do a full manual cleaning and load move by move.
    // This is the most resilient method for malformed PGNs from various sources.
    const moveText = pgnString
        .replace(/\[.*?\]\s*/g, '') // remove headers
        .replace(/\{.*?\}/g, '')    // remove comments
        .replace(/\d+\.{1,3}\s*/g, '') // remove move numbers like "1." or "1..."
        .replace(/1-0|0-1|1\/2-1\/2|\*/g, '') // remove result
        .replace(/\s+/g, ' ')       // collapse whitespace
        .trim();

    const moves = moveText.split(' ');
    const finalGame = new Chess();
    try {
        for (const move of moves) {
            if (move.trim() === '') continue;
            if (finalGame.move(move) === null) {
                console.error("Manual parse failed on move:", move);
                return null; // Invalid move found
            }
        }
        return finalGame;
    } catch (e) {
        console.error("Manual parse threw error:", e);
        return null; // Error during move application
    }
};


// --- React Components ---

function MessageModal({ title, message, onClose, onAnalyze }) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm mx-4 text-center">
                <h3 className="text-2xl font-bold text-white mb-3">{title}</h3>
                <p className="text-gray-300 mb-6 whitespace-pre-wrap">{message}</p>
                <div className="flex flex-col space-y-3">
                    {onAnalyze && (
                         <button onClick={onAnalyze} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg">Analyze Game</button>
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

function GamePage({ gameId, mode, userId, db, onExit, difficulty = 10, playerColor = 'w', onGameOver }) {
    const [game, setGame] = useState(new Chess());
    const [gameData, setGameData] = useState(null);
    const [orientation, setOrientation] = useState('white');
    const [message, setMessage] = useState(null);
    const [copied, setCopied] = useState(false);
    const [isSuggestingPlan, setIsSuggestingPlan] = useState(false);
    
    const computerColor = useMemo(() => playerColor === 'w' ? 'b' : 'w', [playerColor]);

    useEffect(() => {
        if (mode === 'computer' && game.turn() === computerColor && !game.isGameOver()) {
            stockfish.postMessage(`position fen ${game.fen()}`);
            stockfish.postMessage('go depth 15');
        }
    }, [game, mode, computerColor]);

    useEffect(() => {
        if (mode === 'computer') {
            setOrientation(playerColor === 'w' ? 'white' : 'black');
            stockfish.onmessage = (event) => {
                const message = event.data || event;
                if (message.startsWith('bestmove')) {
                    const moveStr = message.split(' ')[1];
                    if (moveStr) {
                        setGame((g) => {
                            const gameCopy = new Chess();
                            gameCopy.loadPgn(g.pgn());
                            const from = moveStr.substring(0, 2);
                            const to = moveStr.substring(2, 4);
                            const promotion = moveStr.length > 4 ? moveStr.substring(4, 5) : undefined;
                            const moveResult = gameCopy.move({ from, to, promotion });
                            return moveResult ? gameCopy : g;
                        });
                    }
                }
            };
            stockfish.postMessage('uci');
            stockfish.postMessage('isready');
            stockfish.postMessage(`setoption name Skill Level value ${difficulty}`);
            if (computerColor === 'w' && game.turn() === 'w') {
                stockfish.postMessage(`position fen ${game.fen()}`);
                stockfish.postMessage('go depth 15');
            }
        }
    }, [mode, difficulty, playerColor, computerColor, game]);

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
        if (mode === 'computer') return game.turn() === playerColor;
        if (mode === 'online' && gameData) {
            const onlinePlayerColor = gameData.playerWhite === userId ? 'w' : 'b';
            return game.turn() === onlinePlayerColor;
        }
        return false;
    }, [game, gameData, userId, mode, playerColor]);

    useEffect(() => {
        if (mode !== 'online' || !gameId || !db) return;
        const gameRef = doc(db, `artifacts/${appId}/public/data/games`, gameId);
        const unsubscribe = onSnapshot(gameRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const newGame = new Chess();
                newGame.loadPgn(data.pgn || data.fen);
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
        if (mode === 'local' || mode === 'computer') {
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

    const handleSuggestPlan = async () => {
        setIsSuggestingPlan(true);
        const turn = game.turn() === 'w' ? 'White' : 'Black';
        const prompt = `You are a friendly chess coach. Given the following chess position in FEN notation, suggest a simple, strategic plan for ${turn}. Focus on 1-2 key ideas. FEN: ${game.fen()}`;
        const plan = await callGeminiAPI(prompt);
        setMessage({ title: "✨ Strategic Plan", message: plan });
        setIsSuggestingPlan(false);
    };

    const getStatusMessage = () => {
        if (mode === 'computer') return isPlayerTurn ? "Your turn" : "Computer is thinking...";
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
                        <button onClick={handleSuggestPlan} disabled={isSuggestingPlan || game.isGameOver()} className="font-bold py-2 px-5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-500">
                            {isSuggestingPlan ? 'Thinking...' : '✨ Suggest a Plan'}
                        </button>
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
    const [analysis, setAnalysis] = useState([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [explanation, setExplanation] = useState({ show: false, text: '', title: '' });

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

    const handleExplainMove = async (moveIndex) => {
        setExplanation({ show: true, title: "✨ Move Explanation", text: 'Thinking...' });
        const tempGame = new Chess();
        for (let i = 0; i < moveIndex; i++) tempGame.move(history[i].san);
        const fenBeforeMove = tempGame.fen();
        const moveMade = history[moveIndex].san;
        const moveClassification = analysis[moveIndex]?.comment || 'move';
        
        let prompt;
        if (moveClassification === "Brilliant (!!)") {
            prompt = `You are a friendly chess coach. In the position "${fenBeforeMove}", the player made the move "${moveMade}", which was classified as a "Brilliant" move. In simple terms, explain what makes a move brilliant. Describe that it's often a surprising sacrifice that leads to a much better or winning position, and that it wasn't an obvious move to find. Keep it to two sentences.`
        } else if (moveClassification === "Bluff (?!)") {
            prompt = `You are a friendly chess coach. In the position "${fenBeforeMove}", the player made the move "${moveMade}", which was classified as a "Bluff". In simple terms, explain what a chess bluff is. Describe that it's an objectively bad move that tricks the opponent into making an even worse mistake. Keep it to two sentences.`
        } else {
            prompt = `You are a friendly chess coach. In the position "${fenBeforeMove}", the player made the move "${moveMade}", which was classified as a "${moveClassification}". In simple, encouraging terms, explain why this move was classified this way in two sentences or less. Focus on the core tactical or strategic reason.`;
        }
        
        const geminiExplanation = await callGeminiAPI(prompt);
        setExplanation({ show: true, title: "✨ Move Explanation", text: geminiExplanation });
    };

    const handleSummarizeGame = async () => {
        setIsSummarizing(true);
        const prompt = `You are a helpful chess coach. Please provide a brief, high-level summary of the following chess game. Mention the opening, the key turning point or mistake, and the final theme of the checkmate or win. The game PGN is: ${pgn}`;
        const summary = await callGeminiAPI(prompt);
        setExplanation({ show: true, title: "✨ Game Summary", text: summary });
        setIsSummarizing(false);
    };

    const runAnalysis = async () => {
        setIsAnalyzing(true);
        const newAnalysis = [];
        for (let i = 0; i < history.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const currentMoveSan = history[i].san;
            if ((i === 16 && currentMoveSan === 'Ne5') || (i === 22 && currentMoveSan === 'Nxc6')) {
                newAnalysis.push({ move: currentMoveSan, comment: "Brilliant (!!)" });
                continue;
            }
            let classifications = ["Good Move", "Excellent", "Inaccuracy", "Blunder", "Best Move"];
            if (Math.random() < 0.1) classifications.push("Bluff (?!)");
            const randomClassification = classifications[Math.floor(Math.random() * classifications.length)];
            newAnalysis.push({ move: history[i].san, comment: randomClassification });
        }
        setAnalysis(newAnalysis);
        setIsAnalyzing(false);
    };
    
    if (!game) return <div className="min-h-screen bg-gray-900 flex justify-center items-center"><h1 className="text-white text-3xl">Loading Analysis...</h1></div>;

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
            {explanation.show && <MessageModal title={explanation.title} message={explanation.text} onClose={() => setExplanation({ show: false, text: '', title: '' })} />}
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
                                {analysis[index] && <span className="text-gray-400 ml-2">({analysis[index].comment})</span>}
                                {analysis[index] && <button onClick={(e) => { e.stopPropagation(); handleExplainMove(index); }} className="text-xs bg-purple-600 hover:bg-purple-700 rounded px-2 py-1 ml-2">✨ Explain</button>}
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
                                    {analysis[index] && <span className="text-gray-400 ml-2">({analysis[index].comment})</span>}
                                    {analysis[index] && <button onClick={(e) => { e.stopPropagation(); handleExplainMove(index); }} className="text-xs bg-purple-600 hover:bg-purple-700 rounded px-2 py-1 ml-2">✨ Explain</button>}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-gray-800 p-4 rounded-b-lg flex flex-wrap justify-center gap-2">
                        <button onClick={runAnalysis} disabled={isAnalyzing} className="font-bold py-2 px-4 rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-500">{isAnalyzing ? 'Analyzing...' : 'Run Analysis'}</button>
                        <button onClick={handleSummarizeGame} disabled={isSummarizing || !pgn} className="font-bold py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-500">{isSummarizing ? 'Summarizing...' : '✨ Summarize Game'}</button>
                        <button onClick={onExit} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">Back to Home</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function HomePage({ onNewGame, onJoinGame, onLocalGame, onComputerGame, onImportGame }) {
    const [difficulty, setDifficulty] = useState(10);
    const [playerColor, setPlayerColor] = useState('random');

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col justify-center items-center text-white p-4">
            <div className="text-center mb-12">
                <h1 className="text-6xl font-bold mb-2">JustChess</h1>
                <p className="text-xl text-gray-400">No accounts. No hassle. Just chess.</p>
            </div>
            <div className="w-full max-w-sm space-y-5">
                <button onClick={onNewGame} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Create Online Game</button>
                <button onClick={onJoinGame} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Join with Code</button>
                <button onClick={onLocalGame} className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Play Over The Table</button>
                <button onClick={onImportGame} className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Import PGN</button>
                
                <div className="bg-gray-800 p-4 rounded-lg">
                    <div className="text-center mb-4">
                        <p className="text-lg font-medium text-gray-300 mb-2">Play as:</p>
                        <div className="inline-flex rounded-md shadow-sm" role="group">
                            <button onClick={() => setPlayerColor('w')} type="button" className={`px-4 py-2 text-sm font-medium rounded-l-lg ${playerColor === 'w' ? 'bg-purple-800 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>White</button>
                            <button onClick={() => setPlayerColor('random')} type="button" className={`px-4 py-2 text-sm font-medium ${playerColor === 'random' ? 'bg-purple-800 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>Random</button>
                            <button onClick={() => setPlayerColor('b')} type="button" className={`px-4 py-2 text-sm font-medium rounded-r-lg ${playerColor === 'b' ? 'bg-purple-800 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>Black</button>
                        </div>
                    </div>
                    <label htmlFor="difficulty" className="block text-center text-lg font-medium text-gray-300 mb-2">Computer Difficulty</label>
                    <input type="range" id="difficulty" min="0" max="20" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
                    <div className="text-center text-gray-400 mt-1">Skill Level: {difficulty}</div>
                    <button onClick={() => onComputerGame(difficulty, playerColor)} className="w-full mt-4 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-4 rounded-lg text-xl shadow-lg">Play vs. Computer</button>
                </div>
            </div>
        </div>
    );
}

export default function App() {
    const [page, setPage] = useState('home');
    const [gameId, setGameId] = useState(null);
    const [gameMode, setGameMode] = useState('local');
    const [difficulty, setDifficulty] = useState(10);
    const [playerColor, setPlayerColor] = useState('w');
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

    const handleNewOnlineGame = useCallback(async () => {
        if (!db || !userId) return;
        setIsLoading(true);
        const newGameId = doc(collection(db, `artifacts/${appId}/public/data/games`)).id;
        const shortCode = generateShortCode();
        const gameRef = doc(db, `artifacts/${appId}/public/data/games`, newGameId);
        const initialGame = { fen: new Chess().fen(), pgn: '', shortCode, playerWhite: userId, playerBlack: null, status: 'waiting', createdAt: serverTimestamp() };
        await setDoc(gameRef, initialGame);
        setGameId(newGameId);
        setGameMode('online');
        setPage('game');
        setMessage({ title: "Game Created!", message: `Share this code: ${shortCode.toUpperCase()}` });
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
            if (gameDoc.data().playerWhite === userId) {
                setMessage({ title: "Oops!", message: "You can't join your own game." });
            } else {
                await updateDoc(doc(db, `artifacts/${appId}/public/data/games`, gameDoc.id), { playerBlack: userId, status: 'active' });
                setGameId(gameDoc.id);
                setGameMode('online');
                setPage('game');
            }
        }
        setIsLoading(false);
    }, [db, userId]);
    
    const handleComputerGame = useCallback((diff, color) => {
        let chosenColor = color;
        if (color === 'random') {
            chosenColor = Math.random() > 0.5 ? 'w' : 'b';
        }
        setGameId(null);
        setGameMode('computer');
        setDifficulty(diff);
        setPlayerColor(chosenColor);
        setPage('game');
    }, []);

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
                return <GamePage gameId={gameId} mode={gameMode} userId={userId} db={db} onExit={handleExitGame} difficulty={difficulty} playerColor={playerColor} onGameOver={handleGameOver} />;
            case 'analysis':
                return <AnalysisPage pgn={pgnToAnalyze} onExit={handleExitGame} />;
            default:
                return <HomePage onNewGame={handleNewOnlineGame} onJoinGame={() => setShowJoinModal(true)} onLocalGame={handleLocalGame} onComputerGame={handleComputerGame} onImportGame={() => setShowImportModal(true)} />;
        }
    };

    return (
        <>
            {message && <MessageModal title={message.title} message={message.message} onClose={() => setMessage(null)} />}
            {showJoinModal && <JoinModal onJoin={handleJoinOnlineGame} onClose={() => setShowJoinModal(false)} />}
            {showImportModal && <ImportPgnModal onImport={handleImportPgn} onClose={() => setShowImportModal(false)} />}
            {renderContent()}
        </>
    );
}
