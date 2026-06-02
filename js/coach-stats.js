/* ============================================================================
 * coach-stats.js — the shared compute-on-read stats module for Chess Coach.
 *
 * ONE module behind three surfaces:
 *   spec 06 MEASURES  -> scoreAttributes()  (7 attribute scores, secondary to the Chess.com rating)
 *   spec 04 DISPLAYS  -> computeCoachView().attributes/overall  (Insights tiers, sparklines)
 *   spec 05 ACTS      -> computeCoachView().focus/session + buildDigest()  (conductor)
 *
 * Dependency-free. Works in the browser (window.CoachStats) and in node (module.exports).
 * Pure functions: inputs are the localStorage stores; output is a view model. Nothing
 * is persisted here — recompute from the stores so scores can never go stale.
 *
 * All chess facts come from Stockfish/chess.js at ingest; this module only aggregates
 * and scores. The LLM (conductor narration) consumes buildDigest() output and never
 * sets a score or a priority here.
 * ==========================================================================*/
(function (root) {
  'use strict';

  // ---- tunables, all in one place (calibrate ACPL anchors on real data) ----
  var CONFIG = {
    HALF_LIFE_DAYS: 30,      // recency decay
    SHRINK_K: 6,             // empirical-Bayes pseudo-observations toward PRIOR
    PRIOR: 50,               // neutral score for an unknown attribute
    CONF_FLOOR: 4,           // below this effective-N -> "calibrating", no tier
    ACPL_ANCHORS: [[18,88],[22,75],[37,58],[62,44],[112,30],[160,18]], // calibrated 2026-05-31 on 33 real opening+middlegame phase-ACPL samples (20 games, median ACPL 37->score 58); tail [160,18] + endgame PROVISIONAL. Re-fit via research/calibrate_anchors.py.
    TIERS: [[85,'Queen'],[70,'Rook'],[55,'Bishop'],[40,'Knight'],[0,'Pawn']],
    SEVERITY_PENALTY: { inaccuracy: 12, mistake: 22, blunder: 38 },
    ACPL_TO_ELO: [[10,2000],[20,1800],[30,1600],[50,1400],[70,1250],[100,1100],[150,950],[200,850]] // empirical ACPL→ELO checkpoints (Lichess/Chess.com data); piecewise-linear, clamped at endpoints. Source: specs/04 §"Rating impact formula v2".
  };

  var ATTRS = ['tactical_patterns','king_safety','endgame_technique','opening_principles',
               'calculation','piece_activity','pawn_structure'];

  var MOTIF_ATTR = {
    fork:'tactical_patterns', pin:'tactical_patterns', skewer:'tactical_patterns',
    'discovered-attack':'tactical_patterns', 'removing-defender':'tactical_patterns',
    overload:'tactical_patterns', decoy:'tactical_patterns', deflection:'tactical_patterns',
    zwischenzug:'tactical_patterns', 'mating-net':'tactical_patterns',
    'king-attack':'king_safety', 'back-rank':'king_safety',
    'pawn-promotion':'endgame_technique', simplification:'endgame_technique',
    'pawn-structure':'pawn_structure', prophylaxis:'calculation', 'none-tactical':'piece_activity'
  };
  var PHASE_ATTR = { opening:'opening_principles', endgame:'endgame_technique' };

  // ---------- small maths ----------
  function recencyW(ageDays) { return Math.pow(0.5, ageDays / CONFIG.HALF_LIFE_DAYS); }
  function acplToScore(acpl) {
    var p = CONFIG.ACPL_ANCHORS;
    if (acpl <= p[0][0]) return p[0][1];
    if (acpl >= p[p.length-1][0]) return p[p.length-1][1];
    for (var i=0;i<p.length-1;i++){ var a=p[i],b=p[i+1];
      if (acpl>=a[0]&&acpl<=b[0]) return a[1]+(b[1]-a[1])*(acpl-a[0])/(b[0]-a[0]); }
    return CONFIG.PRIOR;
  }
  // Piecewise-linear interpolation on CONFIG.ACPL_TO_ELO checkpoints.
  // Clamps at endpoints: ACPL ≤ 10 → 2000, ACPL ≥ 200 → 850.
  function acplToElo(acpl) {
    var p = CONFIG.ACPL_TO_ELO;
    if (acpl <= p[0][0]) return p[0][1];
    if (acpl >= p[p.length-1][0]) return p[p.length-1][1];
    for (var i=0; i<p.length-1; i++) {
      var a=p[i], b=p[i+1];
      if (acpl>=a[0] && acpl<=b[0]) return Math.round(a[1]+(b[1]-a[1])*(acpl-a[0])/(b[0]-a[0]));
    }
    return 1000;
  }
  function shrink(obs, n) { return (n*obs + CONFIG.SHRINK_K*CONFIG.PRIOR)/(n + CONFIG.SHRINK_K); }
  function tier(score){ for (var i=0;i<CONFIG.TIERS.length;i++){ if (score>=CONFIG.TIERS[i][0]) return CONFIG.TIERS[i][1]; } return 'Pawn'; }
  function median(arr){ if(!arr.length) return null; var s=arr.slice().sort(function(a,b){return a-b;}); var m=Math.floor(s.length/2);
    return s.length%2 ? s[m] : (s[m-1]+s[m])/2; }
  function round1(x){ return Math.round(x*10)/10; }

  // ===========================================================================
  // SCORING (spec 06). puzzleObs: [{motif, success(0/1), age_days}]
  //                    gameObs:   [{age_days, phase_acpl:{}, mistakes:[{motif,phase,sev}], eval_swing}]
  // Faithful port of research/scoring_prototype.py (oracle-tested).
  // ===========================================================================
  function scoreAttributes(puzzleObs, gameObs) {
    var pz = {}, gm = {};
    ATTRS.forEach(function(a){ pz[a]={w:0,succ:0}; gm[a]={w:0,score:0}; });

    puzzleObs.forEach(function(p){
      var a = MOTIF_ATTR[p.motif]; if (!a) return;
      var w = recencyW(p.age_days);
      pz[a].w += w; pz[a].succ += w*p.success;
    });

    gameObs.forEach(function(g){
      var w = recencyW(g.age_days);
      for (var phase in PHASE_ATTR){ var attr=PHASE_ATTR[phase];
        var ac = g.phase_acpl ? g.phase_acpl[phase] : undefined;
        if (ac !== undefined && ac !== null){ gm[attr].w += w; gm[attr].score += w*acplToScore(ac); }
      }
      if (g.eval_swing==='winning_then_drawn_in_endgame' || g.eval_swing==='winning_then_lost_in_endgame'){
        gm.endgame_technique.w += w; gm.endgame_technique.score += w*30;
      }
      var acMid = g.phase_acpl ? g.phase_acpl.middlegame : undefined;
      if (acMid !== undefined && acMid !== null){ gm.piece_activity.w += w; gm.piece_activity.score += w*acplToScore(acMid); }
      (g.mistakes||[]).forEach(function(m){
        var a = MOTIF_ATTR[m.motif];
        if (a==='tactical_patterns'||a==='king_safety'||a==='calculation'){
          var pen = CONFIG.SEVERITY_PENALTY[m.sev]; gm[a].w += w; gm[a].score += w*(100-pen);
        }
      });
      var deepBl = (g.mistakes||[]).filter(function(m){ return m.sev==='blunder' && m.phase!=='opening'; }).length;
      gm.calculation.w += w; gm.calculation.score += w*acplToScore(20 + deepBl*45);
    });

    var out = {};
    ATTRS.forEach(function(a){
      var comps = [], conf = 0;
      if (pz[a].w>0){ var acc=100*pz[a].succ/pz[a].w; comps.push([acc, pz[a].w]); conf+=pz[a].w; }
      if (gm[a].w>0){ var gs=gm[a].score/gm[a].w; comps.push([gs, gm[a].w]); conf+=gm[a].w; }
      if (!comps.length){ out[a]={score:null,tier:'—',conf:0,status:'no data'}; return; }
      var num=0, den=0; comps.forEach(function(c){ num+=c[0]*c[1]; den+=c[1]; });
      var blended = num/den, score = shrink(blended, conf);
      var status = conf>=CONFIG.CONF_FLOOR ? 'ok' : 'calibrating';
      out[a]={ score:round1(score), tier: status==='ok'?tier(score):'—', conf:round1(conf), status:status };
    });
    return out;
  }

  function overallTier(attributes){
    var vals=[]; for (var a in attributes){ var v=attributes[a]; if (v.status==='ok' && v.score!=null) vals.push(v.score); }
    var m = median(vals); return m==null?null:{ score: round1(m), tier: tier(m) };
  }

  // ===========================================================================
  // INGEST-TIME per-game scorecard (spec 06 Part A). Slots into the existing
  // games.html per-user-move loop — feed each analysed user move, then finalize.
  // ===========================================================================
  function newScorecard(meta){
    var phases = { opening:{moves:0,cpl:0}, middlegame:{moves:0,cpl:0}, endgame:{moves:0,cpl:0} };
    var traj = [], mistakes = [], entering = {};
    return {
      // call once per analysed USER move
      addUserMove: function(o){ // {fullmove, phase, cpLoss, bestEvalCp, motif?, severity?}
        var ph = phases[o.phase] || phases.middlegame;
        ph.moves++; ph.cpl += Math.max(0, o.cpLoss||0);
        traj.push({ fullmove:o.fullmove, phase:o.phase, cpBest:o.bestEvalCp, cpLoss:Math.max(0, o.cpLoss||0) }); // cpLoss kept (raw, pre-thinning) for the exposure-corrected Insights heatmap
        if (o.severity){ mistakes.push({ fullmove:o.fullmove, phase:o.phase, motif:o.motif||null, severity:o.severity, cpLoss:o.cpLoss }); }
      },
      markPhaseEntry: function(phase, cp){ entering[phase]=cp; },
      finalize: function(result){
        function acpl(p){ return p.moves ? round1(p.cpl/p.moves) : null; }
        var egEnter = entering.endgame;
        var swing = 'held';
        if (egEnter!=null && egEnter>=150){ // was clearly winning entering the endgame
          if (result==='loss') swing='winning_then_lost_in_endgame';
          else if (result==='draw') swing='winning_then_drawn_in_endgame';
        }
        return {
          opp:meta.opp, colour:meta.colour, result:result, eco:meta.eco||null, openingName:meta.openingName||null,
          userMoveCount: phases.opening.moves+phases.middlegame.moves+phases.endgame.moves,
          phase: { opening:{moves:phases.opening.moves,acpl:acpl(phases.opening)},
                   middlegame:{moves:phases.middlegame.moves,acpl:acpl(phases.middlegame)},
                   endgame:{moves:phases.endgame.moves,acpl:acpl(phases.endgame)} },
          phase_acpl: { opening:acpl(phases.opening), middlegame:acpl(phases.middlegame), endgame:acpl(phases.endgame) },
          evalTrajectory: traj, entering: entering, eval_swing: swing,
          mistakes: mistakes, analysedAt: new Date().toISOString()
        };
      }
    };
  }

  // ===========================================================================
  // READ-TIME view assembly. Transforms the live stores into obs, scores them,
  // ranks weaknesses, assembles a session, and emits the LLM digest.
  // stores = { mistakes:[], attempts:{}, scorecards:{}, lichessIndex:{id:{motif,cat}}, rating, nowMs }
  // ===========================================================================
  function toAgeDays(iso, nowMs){ if(!iso) return 9999; var t=Date.parse(iso); return isNaN(t)?9999:Math.max(0,(nowMs-t)/86400000); }

  function buildObs(stores){
    var now = stores.nowMs || Date.now();
    var mistakesById = {}; (stores.mistakes||[]).forEach(function(m){ mistakesById[m.id]=m; });
    var lichess = stores.lichessIndex || {};
    // puzzle observations: first-attempt success per puzzle, tagged by motif
    var puzzleObs = [];
    var attempts = stores.attempts || {};
    Object.keys(attempts).forEach(function(pid){
      var a = attempts[pid]; if(!a) return;
      var src = mistakesById[pid] || lichess[pid] || lichess[pid && pid.replace(/^lichess:/,'')];
      var motif = src && src.motif; if(!motif) return; // need a motif to attribute
      var firstAt = (a.attemptLog && a.attemptLog[0] && a.attemptLog[0].at) || a.lastAt;
      var success = ((a.firstGrade==='best'||a.firstGrade==='good') && !a.shownPieceUsed) ? 1 : 0;
      puzzleObs.push({ motif:motif, success:success, age_days:toAgeDays(firstAt, now) });
    });
    // game observations: prefer scorecards; degrade to mistakes-only if absent
    var gameObs = [];
    var scorecards = stores.scorecards || {};
    var scKeys = Object.keys(scorecards);
    if (scKeys.length){
      scKeys.forEach(function(k){ var s=scorecards[k];
        gameObs.push({ age_days:toAgeDays(s.analysedAt, now), phase_acpl:s.phase_acpl||{},
                       mistakes:(s.mistakes||[]).map(function(m){return {motif:m.motif,phase:m.phase,sev:m.severity};}),
                       eval_swing:s.eval_swing||'held' }); });
    } else {
      // degraded: group flagged mistakes by game; no phase_acpl, frequency signal only
      var byGame = {}; (stores.mistakes||[]).forEach(function(m){ (byGame[m.gameUrl]=byGame[m.gameUrl]||[]).push(m); });
      Object.keys(byGame).forEach(function(g){ var arr=byGame[g];
        gameObs.push({ age_days:toAgeDays(arr[0].createdAt, now), phase_acpl:{},
                       mistakes:arr.map(function(m){return {motif:m.motif,phase:m.category,sev:m.severity};}), eval_swing:'held' }); });
    }
    return { puzzleObs:puzzleObs, gameObs:gameObs };
  }

  function focusRanking(attributes){
    // weakest-first among confident attributes; "calibrating"/"no data" excluded from the pick
    var items=[]; for (var a in attributes){ var v=attributes[a];
      if (v.status==='ok') items.push({ attribute:a, score:v.score, tier:v.tier }); }
    items.sort(function(x,y){ return x.score-y.score; });
    return items;
  }

  var PILLAR_OF = { tactical_patterns:'Tactics', king_safety:'Tactics', endgame_technique:'Endgames',
    opening_principles:'Openings', calculation:'Calculation', piece_activity:'Tactics', pawn_structure:'Tactics' };
  function buildSession(top){
    if(!top) return null;
    var pillar = PILLAR_OF[top.attribute] || 'Tactics';
    if (pillar==='Endgames') return { title:'Endgames → conversion & technique', count:4, blocks:[
      {source:'curated', what:'3 curriculum positions (opposition, key squares)'},
      {source:'your games', what:'1 endgame you slipped, play it out vs engine'}] };
    if (pillar==='Openings') return { title:'Openings → repertoire + your slips', count:5, blocks:[
      {source:'curated', what:'Vienna recall drills'},{source:'your games', what:'opening positions where you gave back the edge'}] };
    if (pillar==='Calculation') return { title:'Calculation → visualisation', count:5, blocks:[
      {source:'trained', what:'visualisation drill set matched to recent depth errors'}] };
    return { title:'Tactics → '+top.attribute.replace('_',' ')+' weakest', count:6, blocks:[
      {source:'your games', what:'your weakest-motif mistakes'},{source:'curated', what:'Lichess puzzles to top up'}] };
  }

  function computeCoachView(stores){
    var obs = buildObs(stores);
    var attributes = scoreAttributes(obs.puzzleObs, obs.gameObs);
    var overall = overallTier(attributes);
    var focus = focusRanking(attributes);
    var session = buildSession(focus[0]);
    return { rating: stores.rating || null, attributes:attributes, overall:overall,
             focus:focus, session:session,
             counts:{ puzzles:obs.puzzleObs.length, games:obs.gameObs.length } };
  }

  // Compact digest for the conductor's one LLM narration call (spec 05). Numbers only.
  function buildDigest(view){
    return { rating: view.rating, target: 1500,
      overall: view.overall, games: view.counts.games, puzzles: view.counts.puzzles,
      focus_ranked: view.focus.map(function(f){ return {attribute:f.attribute, score:f.score, tier:f.tier}; }),
      session: view.session };
  }

  // ===========================================================================
  // PHASE SCORES (Insights headers — opening/middlegame/endgame). Pure games-side:
  // MEDIAN of per-game phase ACPL (robust to blow-out games) -> the calibrated
  // acplToScore curve -> tier. Confidence floor on phase exposure (games + moves
  // reaching the phase) so endgame honestly reads "calibrating" until ~6 games.
  //   phaseScores(scorecards) -> { opening:{score,tier,acpl,moves,games,status}, middlegame:{...}, endgame:{...} }
  // ===========================================================================
  function phaseScores(scorecards){
    var cards = scorecards ? (Array.isArray(scorecards) ? scorecards : Object.keys(scorecards).map(function(k){return scorecards[k];})) : [];
    var PH = ['opening','middlegame','endgame'];
    var out = {};
    PH.forEach(function(ph){
      var vals=[], moves=0;
      cards.forEach(function(s){
        var p = s && s.phase && s.phase[ph];
        if (p && p.moves>0 && typeof p.acpl==='number'){ vals.push(p.acpl); moves += p.moves; }
      });
      var games = vals.length;
      if (games===0){ out[ph]={score:null,tier:'\u2014',acpl:null,moves:0,games:0,status:'no data'}; return; }
      var medAcpl = median(vals);
      var score = round1(acplToScore(medAcpl));
      var status = (games>=6 && moves>=30) ? 'ok' : 'calibrating';
      out[ph]={ score:score, tier:(status==='ok'?tier(score):'\u2014'), acpl:round1(medAcpl), moves:moves, games:games, status:status };
    });
    return out;
  }

  // ===========================================================================
  // RATING IMPACT v2 (spec 04 §"Rating impact formula v2").
  // Converts per-phase ACPL to an approximate ELO equivalent via ACPL_TO_ELO,
  // then expresses each phase as a gap vs the best phase.
  //
  // Input:  phases object from phaseScores()
  // Output: { opening: {eloEquivalent, isBest, ratingImpact} | null, ... }
  //   • null  → status !== 'ok' — show nothing on the card
  //   • isBest → "your {phase} plays like a ~{eloEquivalent} player"
  //   • !isBest → "~{ratingImpact} rating points behind your best phase"
  // ===========================================================================
  function perPhaseRatingImpact(phases) {
    var PH = ['opening','middlegame','endgame'];
    var eloOf = {};
    PH.forEach(function(ph) {
      var p = phases && phases[ph];
      if (p && p.status === 'ok' && typeof p.acpl === 'number') eloOf[ph] = acplToElo(p.acpl);
    });
    var vals = Object.keys(eloOf).map(function(k){ return eloOf[k]; });
    if (!vals.length) return { opening:null, middlegame:null, endgame:null };
    var bestElo = Math.max.apply(null, vals);
    var out = {};
    PH.forEach(function(ph) {
      if (eloOf[ph] === undefined) { out[ph] = null; return; }
      var e = eloOf[ph];
      out[ph] = { eloEquivalent: e, isBest: e === bestElo, ratingImpact: Math.max(0, bestElo - e) };
    });
    return out;
  }

  var API = { CONFIG:CONFIG, ATTRS:ATTRS, MOTIF_ATTR:MOTIF_ATTR, PHASE_ATTR:PHASE_ATTR,
    recencyW:recencyW, acplToScore:acplToScore, acplToElo:acplToElo, shrink:shrink, tier:tier, median:median,
    scoreAttributes:scoreAttributes, overallTier:overallTier, newScorecard:newScorecard,
    buildObs:buildObs, focusRanking:focusRanking, buildSession:buildSession,
    computeCoachView:computeCoachView, buildDigest:buildDigest,
    phaseScores:phaseScores, perPhaseRatingImpact:perPhaseRatingImpact };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CoachStats = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
