import { MIN_CPLOSS_TO_RECORD, THINNING_WINDOW } from './config.js';
import { Chess } from './lib.js';
import { loadIngestedGameUrls } from './storage.js';
import { fetchRecentRapidGames } from './chesscom.js';
import { analyzePositionMultiPV, normalizeEval } from './analysis.js';
import { categorize, severityFor, thinMistakesByWindow } from './categorize.js';
import { classifyMotifsBatch } from './classify.js';
import { setProgress } from './dom.js';
// ============================================================================
// SECTION 8 — INGESTION PIPELINE
// ----------------------------------------------------------------------------
// For each game:
//   - Identify whether the user was White or Black.
//   - Replay moves; at each user move, analyse the position BEFORE the move
//     with MultiPV=5.
//   - If the user's move matches line 1, skip (no mistake).
//   - If it matches line 2..5, compute cpLoss vs line 1. Record if >=30cp.
//   - If it's outside the top 5, record as a mistake with cpLoss estimated as
//     line-5-eval-to-line-1-eval gap (lower bound for "this move is worse").
// ============================================================================

async function ingest(username, numGames, depth, onProgress) {
  const alreadyIngested = loadIngestedGameUrls();
  const fetched = await fetchRecentRapidGames(username, numGames, alreadyIngested);
  const games = fetched.games;
  if (!games.length) {
    const msg = fetched.skipped > 0
      ? `No new rapid games found (${fetched.skipped} most recent already ingested). Try a larger batch or play more games.`
      : 'No rapid games found in the latest archives.';
    throw new Error(msg);
  }
  if (fetched.skipped > 0) {
    onProgress(0, 1, `Skipped ${fetched.skipped} games already ingested. Walking back further to find ${games.length} new game(s).`);
  }

  // Count user moves up front for the progress bar.
  let totalUserMoves = 0;
  const parsedGames = games.map((g) => {
    const c = new Chess();
    c.loadPgn(g.pgn);
    const headers = c.header();
    const userIsWhite = (headers.White || '').toLowerCase() === username.toLowerCase();
    const userIsBlack = (headers.Black || '').toLowerCase() === username.toLowerCase();
    if (!userIsWhite && !userIsBlack) return null;
    const history = c.history({ verbose: true });
    const userMoves = history.filter((m) => (m.color === 'w') === userIsWhite).length;
    totalUserMoves += userMoves;
    return { game: g, headers, userIsWhite, history };
  }).filter(Boolean);

  let analysedMoves = 0;
  const freshMistakes = [];
  const perGameSummary = [];
  // Spec 06 per-game scorecards collected during this ingest; persisted after
  // the loop. Keyed by gameUrl. Reuses the existing Stockfish pass — 0 extra
  // engine cost. The shared CoachStats module turns these into attribute
  // scores at read-time on Insights / Practice.
  const newScorecards = {};
  const gameMoves = {}; // Spec 11 — SAN move lists for the game-review replay
  let gameIndex = 0;

  for (const { game, headers, userIsWhite, history } of parsedGames) {
    gameIndex++;
    const opponent = userIsWhite ? (headers.Black || 'opponent') : (headers.White || 'opponent');
    const dateStr = (headers.Date || '').replace(/\./g, '-');
    const result = headers.Result || '';
    const userColorName = userIsWhite ? 'White' : 'Black';
    const userMovesInGame = history.filter((m) => (m.color === 'w') === userIsWhite).length;
    // Map Chess.com's "1-0" / "0-1" / "1/2-1/2" result to win|loss|draw from
    // the user's perspective, for the scorecard's eval_swing derivation.
    let resultForUser = 'draw';
    if (result === '1-0') resultForUser = userIsWhite ? 'win' : 'loss';
    else if (result === '0-1') resultForUser = userIsWhite ? 'loss' : 'win';
    else if (result === '1/2-1/2') resultForUser = 'draw';
    // Spec 06 — per-game scorecard. The phase-ACPL + endgame conversion
    // signals feed the attribute scores; opening + ECO support the Vienna
    // pillar later.
    const eco = headers.ECO || headers.Eco || null;
    const openingName = headers.Opening || null;
    const scorecard = (typeof CoachStats !== 'undefined')
      ? CoachStats.newScorecard({ opp: opponent, colour: userColorName, eco, openingName })
      : null;
    let phaseEndgameRecorded = false;
    // Collect candidate mistakes for THIS game; thin them after the loop so we
    // can apply the 5-move-window rule across the whole game.
    const gameCandidates = [];

    const replay = new Chess();
    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      const userToMove = (move.color === 'w') === userIsWhite;
      if (userToMove) {
        const fenBefore = replay.fen();
        const userUci = move.from + move.to + (move.promotion || '');
        const userKey = userUci.slice(0, 4);

        const lines = await analyzePositionMultiPV(fenBefore, depth);
        analysedMoves++;
        onProgress(analysedMoves, totalUserMoves, `Game ${gameIndex}/${parsedGames.length} vs ${opponent} — analysing your ${userColorName.toLowerCase()} moves`);

        if (!lines.length) {
          replay.move(move);
          continue;
        }

        const idx = lines.findIndex((l) => l.uci.slice(0, 4) === userKey);
        const bestEval = normalizeEval(lines[0].eval);
        let cpLoss = 0;
        let isMistake = false;

        if (idx === 0) {
          // Best move played — not a mistake.
        } else if (idx === -1) {
          // Outside top 5. Treat the gap between best and 5th as a *lower bound*.
          const fifthEval = normalizeEval(lines[lines.length - 1].eval);
          cpLoss = Math.max(MIN_CPLOSS_TO_RECORD, bestEval - fifthEval);
          isMistake = true;
        } else {
          const userEval = normalizeEval(lines[idx].eval);
          cpLoss = Math.max(0, bestEval - userEval);
          if (cpLoss >= MIN_CPLOSS_TO_RECORD) isMistake = true;
        }

        const fullmoveAll = parseInt(fenBefore.split(' ')[5], 10) || 1;
        const phaseAll = categorize(fullmoveAll, fenBefore);
        // Spec 06 — feed EVERY analysed user move into the scorecard (not just
        // flagged mistakes) so the phase-ACPL aggregates honestly. The motif
        // and severity get back-filled below if this move turns out to be a
        // mistake.
        if (scorecard) {
          scorecard.addUserMove({
            fullmove: fullmoveAll,
            phase: phaseAll,
            cpLoss,
            bestEvalCp: bestEval,
          });
          // Phase-entry: record the eval the user is entering the endgame on,
          // once per game. This drives the eval_swing "winning_then_drawn"
          // signal that flags conversion failures.
          if (!phaseEndgameRecorded && phaseAll === 'endgame') {
            scorecard.markPhaseEntry('endgame', bestEval);
            phaseEndgameRecorded = true;
          }
        }
        if (isMistake) {
          // Skip positions that are already decided before the user's move:
          // forced mate in either direction, or worse than -800cp for the
          // side to move. Those don't make useful training puzzles.
          const startEval = lines[0].eval;
          const isAlreadyMate = startEval && startEval.mate != null;
          const isHopelessLoss = startEval && typeof startEval.cp === 'number' && startEval.cp < -800;
          if (isAlreadyMate || isHopelessLoss) {
            replay.move(move);
            continue;
          }
          const fullmove = fullmoveAll;
          const category = phaseAll;
          const severity = severityFor(cpLoss);
          const rankText = idx === -1 ? 'outside engine top 5' : `engine line #${idx + 1}`;
          // Capture what the player ACTUALLY played in the original game from
          // this position forward, for the post-puzzle move-by-move comparison
          // view. Up to 6 plies (3 user moves + 3 opponent replies).
          const actualContinuation = [];
          for (let j = i; j < Math.min(i + 6, history.length); j++) {
            actualContinuation.push({ san: history[j].san, color: history[j].color, ply: j - i });
          }

          gameCandidates.push({
            id: `${game.url || game.uuid || 'game'}|${i}`,
            type: 'mistake', // unified puzzle schema (phase 1a) — puzzle.html pins this type
            fen: fenBefore,
            category,
            brief: `From your ${userColorName.toLowerCase()} game vs ${opponent} (${dateStr}, result ${result}). At move ${fullmove}, you played ${move.san} (${rankText}); engine prefers ${lines[0].san}.`,
            source: `vs ${opponent} — ${dateStr} — move ${fullmove} (${userColorName})`,
            gameUrl: game.url || '',
            userColorName,
            opponent,
            dateStr,
            userMoveSan: move.san,
            userMoveUci: userUci,
            bestMoveSan: lines[0].san,
            bestMoveUci: lines[0].uci,
            cpLoss,
            severity,
            fullmove, // used by thinMistakesByWindow()
            actualContinuation, // up to 6 plies of what was actually played in the game (for move-by-move comparison)
            engineLines: lines.map((l) => ({
              san: l.san, eval: l.eval, pvSan: l.pvSan.slice(0, 6),
            })),
            createdAt: new Date().toISOString(),
          });
        }
      }
      replay.move(move);
    }
    // Thin: 5-move window, blunders always kept.
    const thinned = thinMistakesByWindow(gameCandidates, THINNING_WINDOW);
    // Spec 02 — motif classifier. One Claude call per surviving mistake,
    // tags stored on the record + powers Drill this theme on the Puzzles page.
    if (thinned.length) {
      setProgress(`Tagging motifs for ${thinned.length} mistake${thinned.length === 1 ? '' : 's'}…`, null, '');
      await classifyMotifsBatch(thinned, (done, total) => {
        setProgress(`Tagging motifs… ${done}/${total}`, null, '');
      });
    }
    freshMistakes.push(...thinned);
    // Spec 06 — finalize this game's scorecard now that we know the result
    // and have walked all the user's moves. eval_swing derives from the
    // markPhaseEntry('endgame') reading + the result.
    if (scorecard) {
      const finalCard = scorecard.finalize(resultForUser);
      const gameKey = game.url || game.uuid || `game-${gameIndex}-${Date.now()}`;
      newScorecards[gameKey] = finalCard;
    }
    const userRatingForGame = userIsWhite ? (game.white && game.white.rating) : (game.black && game.black.rating);
    perGameSummary.push({
      gameUrl: game.url || game.uuid || '',
      opponent,
      dateStr,
      result,
      userColorName,
      userMoves: userMovesInGame,
      analysed: userMovesInGame, // every user move was analysed
      candidates: gameCandidates.length,
      mistakes: thinned.length,
      rating: (typeof userRatingForGame === 'number') ? userRatingForGame : null,
      endTime: game.end_time || null,
    });
    // Spec 11 — capture the full SAN move list (already in memory) for the
    // game-review replay. Keyed to match the mistake-record join in review.js.
    const movesKey = game.url || game.uuid || ('game-' + gameIndex);
    gameMoves[movesKey] = { moves: history.map((h) => h.san), userIsWhite, result, opponent, dateStr };
  }

  return { mistakes: freshMistakes, perGameSummary, scorecards: newScorecards, moves: gameMoves };
}
export { ingest };
