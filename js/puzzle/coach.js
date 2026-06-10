// ============================================================================
// SECTION 13 — Coach (Ask + Hint + Auto-explanation)
// ============================================================================
import { TRAINING_COMPONENTS, DEFAULT_RATING, RATING_TARGET } from './config.js';
import { state } from './state.js';
import { $, appendCoachMessage, appendCoachReview, parseReviewMessage } from './dom.js';
import { summaryAsText, evalAsHuman } from './engine.js';
import { getCurrentPuzzle } from './queue.js';

const STYLE_RULES = [
  'WRITING STYLE — read carefully:',
  '- Conversational. Talk like a friendly coach sitting next to the player, not a textbook.',
  '- Brief. Default to 1 to 3 short sentences. Never pad.',
  '- Use piece names (rook, knight, etc.). Square coordinates only when needed for precision.',
  '- Replace symbols: "with check" not "+", "checkmate" not "#".',
  '- Never use UCI like e2e4.',
  '- NO em dashes (—) or en dashes (–). Use commas, full stops, or parentheses instead.',
  '- NO markdown formatting. NO ** for bold, NO * for emphasis, NO bullet lists, NO headers. Plain prose only.',
  '- NO filler openers like "Great job!" or "Let me explain". Just say the thing.',
  '- Address the player as "you", in second person.',
].join('\n');

// Calibration block — included in every coach system prompt so the coach
// speaks to the actual level of the student.
export function calibrationBlock() {
  const r = state.userRating || DEFAULT_RATING;
  // Profile-aware target (v0.80): the student's own onboarding goal, plus the
  // one-line profile context (time control, seriousness) when present.
  const target = (typeof KPProfile !== 'undefined') ? KPProfile.targetElo() : RATING_TARGET;
  const profileLine = (typeof KPProfile !== 'undefined') ? KPProfile.promptLine() : '';
  return [
    'PLAYER LEVEL — CALIBRATE TO THIS:',
    `- The student is rated approximately ${r} ELO on Chess.com (rapid). Target: ${target}.${profileLine}`,
    `- Pitch feedback at the ${r}-rated band: concrete patterns, basic tactical motifs (pins, forks, skewers, removing defenders, back-rank), simple king-safety ideas, fundamental endgame technique.`,
    '- AVOID jargon and concepts that don\'t pay off below 1500: minority attack, Carlsbad structure, prophylactic restraint, Maroczy bind, prophylaxis as a labelled concept, deep strategic plans more than 3 moves long.',
    '- Use plain English over chess vocabulary when both work. "Trade off the active piece" beats "exchange the protagonist".',
    '- One-move-ahead and two-move-ahead reasoning is the sweet spot. Avoid showing off long calculation that a player at this level wouldn\'t reproduce.',
  ].join('\n');
}

const COACHING_RULES = [
  'ABSOLUTE RULES while the puzzle is unresolved (no exceptions):',
  '1. NEVER name a move in ANY notation — no SAN ("Bd3", "Nf6+"), no UCI ("e2e4"), no plain-English equivalent ("play the knight to f6", "develop the bishop forward").',
  '2. NEVER name a destination square anywhere in your reply ("targets d3", "goes to e8", "the right square is f7" — all forbidden).',
  '3. NEVER name the piece that should move ("your dark-squared bishop should go forward" is forbidden).',
  '4. NEVER state an evaluation in centipawns or pawns ("+1.5", "winning", "losing by a piece") — the player has not earned that information yet.',
  '5. NEVER name the tactical motif of the position ("there is a fork here", "it is a pin", "back-rank weakness") — even if the player asks. Asking is normal; revealing the motif IS the answer for tactics puzzles.',
  '6. NEVER list candidates or rank moves.',
  '7. If asked "what should I play?", "what is the best move?", "is there a fork/pin/skewer here?", "which piece do I move?", or any variant — refuse the answer and turn the question back. Ask THEM what they see, not the other way round.',
  '',
  'WHAT YOU CAN DO (Socratic prompts that help thinking without spoiling):',
  '- "Which of your pieces is doing the least?"',
  '- "What did your opponent just threaten?"',
  '- "If you had a free move, what would you improve?"',
  '- "Which of your pieces is undefended right now?"',
  '- "What does the position look like in 1 move, if you do nothing?"',
  '- "Walk me through every check and capture you can find."',
  'Make the player think. You are a tutor, not an oracle.',
].join('\n');

export function gateAnswersAsText() {
  const a = state.gateAnswers;
  if (!a) return '(no questionnaire answers)';
  return [
    `Student's CCTO from THEIR pieces (Checks/Captures/Threats/Optimisations):`,
    a.myCcto || '(blank)',
    '',
    `Student's CCTO from OPPONENT'S pieces:`,
    a.oppCcto || '(blank)',
    '',
    `Student's plan (how they intend to put insights into practice):`,
    a.plan || '(blank)',
  ].join('\n');
}
export function linesAsText(lines) {
  if (!lines || !lines.length) return '(no lines available)';
  return lines.map((line, i) => `${i + 1}. ${line.san} (eval: ${evalAsHuman(line.eval)})  —  line: ${line.pvSan.slice(0, 8).join(' ')}`).join('\n');
}
export function attemptHistoryAsText() {
  if (!state.attemptHistory.length) return '(no moves yet)';
  return state.attemptHistory.map((h, i) => {
    if (h.mover === 'user') return `${i + 1}. ${h.san} (you)${h.grade ? ' — grade ' + h.grade.tier : ''}`;
    if (h.mover === 'engine') return `${i + 1}. ${h.san} (engine reply)`;
    return `${i + 1}. ${h.san} (engine continuation)`;
  }).join('\n');
}

export function buildLiveSystemPrompt(/* puzzle */) {
  // CRITICAL: this function builds the system prompt for the IN-PROGRESS coach.
  // What goes in here is the entire information the LLM has about the puzzle.
  //
  // SAFE to include: POSITION SUMMARY (material, piece locations, side to move,
  // check status, castling rights — all computed from the current FEN), the
  // STYLE_RULES, the COACHING_RULES, and the player's rating band (calibration).
  //
  // FORBIDDEN to include (any of these spoil the puzzle):
  //   - puzzle.brief        — its template includes "engine prefers {san}". DO NOT inject.
  //   - puzzle.bestMoveSan  — direct answer.
  //   - puzzle.bestMoveUci  — direct answer in uci.
  //   - puzzle.engineLines  — top-5 lines with evals and SAN.
  //   - puzzle.cpLoss       — eval delta vs best.
  //   - puzzle.motif        — Spec-02 tactical tag. For tactics puzzles the
  //                           motif IS the answer ("there is a pin here").
  //   - puzzle.severity     — engine-derived ranking.
  //   - puzzle.userMoveSan  — what the player played in the original game; the
  //                           puzzle was built to drill avoiding it, so naming
  //                           it primes them away from the very mistake we want
  //                           them to spot.
  //
  // The function takes `puzzle` so future calls can decide grounding from
  // puzzle metadata if needed, but it intentionally does NOT read any of the
  // forbidden fields. Argument kept parenthesised + commented as a tripwire:
  // if a future edit re-reads `puzzle.<field>` here, it's adding a leak.
  // The coach's per-user memory (js/coach-memory.js window global): student-
  // level observations only ("rushes recaptures"), never position facts — so
  // it cannot leak an answer and is safe on the live-solve surface.
  let memoryNote = '';
  try { if (typeof CoachMemory !== 'undefined') memoryNote = CoachMemory.promptBlock(CoachMemory.read()); } catch { /* optional */ }
  return [
    'You are a chess coach helping a student work through an unresolved puzzle.',
    'Your job is to help them think. You do not give the answer.',
    '', COACHING_RULES, '', STYLE_RULES, '', calibrationBlock(), '',
    'GROUNDING: every factual claim about the position (material counts, what is on what square, who is in check, which castling rights remain) must come from the POSITION SUMMARY below. Never enumerate from the FEN string yourself. If a claim is not supported by the summary, say "I cannot see that from here" rather than guessing.',
    '', 'POSITION SUMMARY:',
    summaryAsText(state.positionSummary),
  ].join('\n') + memoryNote;
}
export function buildExplanationPrompt({ grade, played, terminal }) {
  // v0.13 (Spec 05 §"Per-puzzle multi-move review — corrected"): the review
  // compares the user's WHOLE line vs the engine's WHOLE line, not just the
  // last decision. Engine PV from the start lives in state.engineLineFromStart;
  // per-user-move evalBeforeCp / userEvalAfterCp live on attemptHistory.
  const puzzle = getCurrentPuzzle() || {};
  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
  const isFirstUserMove = userMoves.length === 1;

  // Compose the per-user-move trace (each line carries the rank, cp-loss, and
  // before/after eval the model can ground the verdict on — never quoted).
  const userTrace = userMoves.map((h, i) => {
    const g = h.grade;
    const rankStr = g && g.rank ? `engine's #${g.rank}` : 'OUTSIDE engine top 5';
    const cpStr = g && typeof g.cpLoss === 'number' && g.cpLoss > 0 ? `, ${g.cpLoss}cp lost vs best` : '';
    const before = (typeof h.evalBeforeCp === 'number') ? `${h.evalBeforeCp}cp` : '?';
    const after = (typeof h.userEvalAfterCp === 'number') ? `${h.userEvalAfterCp}cp` : '?';
    return `  user move ${i + 1}: ${h.san} (${rankStr}${cpStr}; eval ${before}→${after} from your side)`;
  });

  // Line-vs-line outcome numbers (Spec 05 spelling): user line end eval is the
  // LAST user move's userEvalAfterCp; engine line end eval comes from the
  // engineLineFromStart snapshot; netCp = how much the user's whole line cost
  // vs best play, in centipawns.
  const userLineEndEvalCp = userMoves.length
    ? userMoves[userMoves.length - 1].userEvalAfterCp
    : null;
  const engineEndEvalCp = state.engineLineFromStart?.endEvalCp ?? null;
  const netCp = (typeof userLineEndEvalCp === 'number' && typeof engineEndEvalCp === 'number')
    ? (engineEndEvalCp - userLineEndEvalCp)
    : null;
  const engineLineFromStartSan = (state.engineLineFromStart?.pvSan || []).slice(0, 6);
  const engineBestSanFirst = engineLineFromStartSan[0] || state.engineLines[0]?.san || '(unknown)';

  // FORBIDDEN-MOVE LIST — Spec 05 §12: the prompt now carries the engine's
  // WHOLE PV from start + the per-step engine PVs. The model must not quote
  // any of these at any ply. Build the deduped, comma-joined list so the
  // model sees exactly which strings are off-limits.
  const forbiddenSet = new Set();
  for (const s of engineLineFromStartSan) if (s) forbiddenSet.add(s);
  for (const h of userMoves) {
    const pv = (h.engineBestAtPoint && h.engineBestAtPoint.pvSan) || [];
    for (const s of pv) if (s) forbiddenSet.add(s);
  }
  const forbiddenSans = Array.from(forbiddenSet).join(', ') || '(none recorded)';

  const outcomeWord = grade.tier === 'outside' ? 'FAILED (outside engine top 5)' : 'COMPLETED (stayed within engine top 5)';
  const playerMoveSan = played ? played.san : '(no move played)';

  const repeated = isFirstUserMove && puzzle.userMoveSan && played && played.san === puzzle.userMoveSan;
  const attemptsRec = state.attempts[puzzle.id] || {};
  const failedAttempts = attemptsRec.failedAttempts || 0;
  const sessionFails = state.sessionFailures[puzzle.id] || 0;
  // Reveal gate is per-session; the prompt still surfaces the historical count.
  const revealMode = sessionFails >= 3 && grade.tier === 'outside';

  const gameContextLine = (isFirstUserMove && puzzle.userMoveSan)
    ? (repeated
        ? `In the original game the player ALSO played ${puzzle.userMoveSan} as their first move here — this is the exact mistake the puzzle was built to drill. Call that out explicitly.`
        : `For context, in the original game the player played ${puzzle.userMoveSan} as their first move at this starting position (that was the original mistake). In this attempt they played ${playerMoveSan} instead.`)
    : '';

  // Line-level outcome summary line — fed into OUTPUT FORMAT below.
  const outcomeLine = (() => {
    const parts = [`Outcome: ${outcomeWord}.`];
    if (userMoves.length > 1) parts.push(`The user played a ${userMoves.length}-move continuation.`);
    if (typeof userLineEndEvalCp === 'number') parts.push(`User line end eval: ${userLineEndEvalCp}cp.`);
    if (typeof engineEndEvalCp === 'number') parts.push(`Engine line end eval: ${engineEndEvalCp}cp.`);
    if (typeof netCp === 'number') parts.push(`Net: ${netCp >= 0 ? '+' : ''}${netCp}cp cost vs best play.`);
    return parts.join(' ');
  })();

  return [
    'A puzzle attempt has just resolved. Review the WHOLE attempt — the user\'s line vs the engine\'s line — not just the last move.',
    '',
    '=== WHAT HAPPENED (authoritative; for grounding only — do NOT quote moves) ===',
    `Total user moves played: ${userMoves.length}.`,
    outcomeLine,
    '',
    'User\'s full continuation (in order):',
    ...userTrace,
    '',
    'Engine\'s WHOLE line from the puzzle start (top PV at the first decision):',
    `  ${engineLineFromStartSan.join(' ') || '(unavailable)'}` + (typeof engineEndEvalCp === 'number' ? `  → end eval ${engineEndEvalCp}cp` : ''),
    '',
    '=== NAMING RULES — extended for whole-line review (Spec 05 §12) ===',
    revealMode
      ? `REVEAL MODE: the player has failed this puzzle ${failedAttempts} times. The naming rules are SUSPENDED ONLY in the headline (`+ '"`lead`"' + `) so you MAY name the FIRST move of the engine's line (${engineBestSanFirst}) there exactly once. The other engine PV moves (${engineLineFromStartSan.slice(1).join(', ') || 'rest of the line'}) stay conceptual — no SAN/squares/pieces — even in reveal mode. Bullets and the question stay fully conceptual.`
      : [
          `- You MAY say "your move", "your first move", "your continuation". You MAY name the user's own moves explicitly: ${userMoves.map((h) => h.san).join(', ') || '(none)'}.`,
          `- You MUST NOT name ANY move in the engine's line at ANY ply, in ANY form:`,
          `    · Algebraic / UCI: NO "Bd3", "Nf6", "Rxe5+", "e2e4".`,
          `    · Plain-English equivalent of the move: NO "develop the bishop to d3", "the rook goes to e8", "play the knight to f6".`,
          `    · Destination square: NO "targets d3" / "lands on e8" for any engine move.`,
          `    · Piece+square: NO "your dark-squared bishop should go to b4".`,
          `  This extends the previous rule from "engine's #1 at last decision" to EVERY move in the engine's whole PV from the start, AND every ply of any per-step engine PV. The full forbidden-move list (do not quote any of these): ${forbiddenSans}.`,
          `- You MAY describe the engine's PLAN conceptually: "the engine line removes the defender", "the engine doubles rooks on the open file", "the engine breaks the pin and then re-routes the knight".`,
          `- If a conceptual description requires naming a piece + square to be coherent, describe the THEME or PATTERN instead (piece activity, king safety, tactical motif, calculation depth).`,
        ].join('\n'),
    '',
    '=== GROUNDING ===',
    '- Piece-location claims come ONLY from POSITION SUMMARY below.',
    '- Move-quality claims come ONLY from the engine numbers above (rank/cpLoss/eval).',
    '- Never enumerate the position from the FEN string.',
    '- Never invent pieces or moves not present in the data.',
    '',
    STYLE_RULES,
    '',
    calibrationBlock(),
    '',
    'TRAINING COMPONENTS — invoke one explicitly:',
    TRAINING_COMPONENTS.map((c) => `· ${c}`).join('\n'),
    '',
    '=== POSITION SUMMARY (starting position of the puzzle) ===',
    summaryAsText(state.positionSummary),
    '',
    '=== PLAYER CCTO ANSWERS (their pre-move analysis: Checks, Captures, Threats, Optimisations) ===',
    gateAnswersAsText(),
    'When relevant, surface a specific gap between the player\'s CCTO and engine truth — but conceptually, never by quoting the engine\'s line.',
    '',
    gameContextLine,
    '',
    revealMode
      ? `REVEAL MODE: the player has failed this puzzle ${failedAttempts} times. The lead may name ${engineBestSanFirst} exactly once; the rest of the response stays conceptual.`
      : '',
    '',
    '=== OUTPUT FORMAT — STRICT JSON (mandatory) ===',
    'Reply with ONE JSON object and nothing else. No markdown fences, no prose preamble, no trailing commentary. The renderer parses your JSON directly; any text outside the object falls back to a plain bubble.',
    '',
    'Schema (per redesign-spec §17 "per-puzzle"). Labels are line-level — the bullets describe WHOLE-LINE themes across all ' + userMoves.length + ' user move' + (userMoves.length === 1 ? '' : 's') + ', not per-move chatter:',
    '{',
    '  "lead":     string  — headline verdict, ≤ 90 chars, plain English' + (revealMode ? `. REVEAL: lead MUST follow the form "After ${failedAttempts} tries: ${engineBestSanFirst} — <one-clause concept of what the WHOLE engine line achieves>".` : '. NEVER name any engine move/square/piece/eval at any ply.'),
    '  "points":   array of THREE objects in this exact order:',
    '              [',
    '                {"label": "What you played", "text": "<one short clause; the THEME of the user\'s whole line — the pattern across all ' + userMoves.length + ' user moves, what their plan accomplished or where it drifted; no SAN, no square names>"},',
    '                {"label": "Better idea",     "text": "<one short clause; what the engine\'s WHOLE line achieves CONCEPTUALLY (e.g. \\"trades into a winning endgame\\", \\"removes the defender then doubles rooks\\", \\"breaks the pin and re-routes\\"); NEVER name any engine piece/square/SAN at any ply' + (revealMode ? ' EXCEPT the lead already named the first move' : '') + '>"},',
    '                {"label": "Pattern",         "text": "<one short clause; the recurring lesson — what to ask yourself next time you see this kind of position>"}',
    '              ]',
    '  "question": string  — ONE reflective question, ≤ 80 chars, ends with ?',
    '}',
    '',
    'Word budget across lead + 3 point.text + question: 60–80 words total. Clauses are short — not sentence chains.',
    'The move-by-move comparison table is rendered on screen next to your review — do NOT re-list engine moves or evaluations in your prose.',
    '',
    'Before writing: re-read the WHAT HAPPENED + NAMING RULES sections. The forbidden-move list above must not appear anywhere in your output (except the FIRST engine SAN in the reveal-mode lead). Refer to user moves by ordinal ("your first move") and never invent moves the player did not play.',
  ].filter(Boolean).join('\n');
}
export async function callCoach({ system, messages, maxTokens = 400 }) {
  const r = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return (data.content && data.content[0] && data.content[0].text) || '(empty response)';
}
export async function fireCoachExplanation({ grade, played, terminal }) {
  const puzzle = getCurrentPuzzle() || {};
  const failedAttempts = state.attempts[puzzle.id]?.failedAttempts || 0;
  const sessionFails = state.sessionFailures[puzzle.id] || 0;
  // Reveal gate uses session-only counter to avoid auto-firing for puzzles
  // previously failed in older sessions.
  const inRevealMode = sessionFails >= 3 && grade.tier !== 'best' && grade.tier !== 'good';
  const userMoves = state.attemptHistory.filter((h) => h.mover === 'user');
  const isMultiMove = userMoves.length > 1;
  appendCoachMessage('system', inRevealMode ? `Coach showing the answer (${sessionFails} failed attempts this session)…` : 'Coach reviewing the attempt…');
  appendCoachMessage('typing');
  try {
    const text = await callCoach({
      // The structured OUTPUT FORMAT block lives in the user prompt; the system
      // role is the voice + the no-spoiler stance. Same voice across single,
      // multi-move, and reveal — only the prompt body branches.
      system: 'You are a chess coach. Output the structured review format the user prompt specifies — headline + bullets + one reflective question, 60-80 words total. Never name the engine\'s preferred move, piece, or destination square in your prose (the comparison table next to your review already shows the moves visually). Reveal mode is the only exception, and only in the headline.',
      messages: [{ role: 'user', content: buildExplanationPrompt({ grade, played, terminal }) }],
      // Tight cap matches the 60-80 word output; reveal mode has slightly more
      // headroom because the headline carries the named move.
      maxTokens: inRevealMode ? 280 : 220,
    });
    const log = $('coach-log');
    const systems = log.querySelectorAll('.msg.system');
    if (systems.length) systems[systems.length - 1].remove();
    // v0.9 §17: try the structured review render first. If the model returned
    // valid JSON matching the schema, render the labelled-bullet component;
    // otherwise fall back to a plain coach bubble so a malformed response
    // never breaks the surface. coachHistory always stores the raw text so
    // follow-up questions retain context.
    const parsed = parseReviewMessage(text);
    if (parsed) {
      appendCoachReview(parsed);
    } else {
      appendCoachMessage('coach', text);
    }
    state.coachHistory.push({ role: 'assistant', content: text });
  } catch (err) {
    appendCoachMessage('error', 'Auto-explanation error: ' + err.message);
  }
}

// Ask + Hint buttons
// (Ask-a-question button removed — the chat input is always visible now.)
// The category-level Hint button was removed — the coach chat input is the
// always-on equivalent if the user wants nudges. "Show piece" remains as the
// concrete visual hint.

export async function sendCoachMessage(userText) {
  if (state.coachSending) return;
  if (!userText.trim()) return;
  const puzzle = getCurrentPuzzle();
  state.coachHistory.push({ role: 'user', content: userText });
  appendCoachMessage('user', userText);
  appendCoachMessage('typing');
  state.coachSending = true; $('coach-send').disabled = true;
  try {
    const system = state.phase === 'resolved'
      ? [
          'You are a chess coach. The current puzzle is resolved; you may discuss moves freely.',
          '', STYLE_RULES, '', calibrationBlock(), '',
          'GROUNDING: use ONLY POSITION SUMMARY and ENGINE ANALYSIS below for facts.',
          '', 'POSITION SUMMARY:', summaryAsText(state.positionSummary),
          '', 'ENGINE ANALYSIS:', linesAsText(state.engineLines),
        ].join('\n')
      : buildLiveSystemPrompt(puzzle);
    const reply = await callCoach({ system, messages: state.coachHistory.map((m) => ({ role: m.role, content: m.content })) });
    state.coachHistory.push({ role: 'assistant', content: reply });
    appendCoachMessage('coach', reply);
  } catch (err) {
    appendCoachMessage('error', 'Coach error: ' + err.message);
  } finally {
    state.coachSending = false; $('coach-send').disabled = false; $('coach-input').focus();
  }
}
