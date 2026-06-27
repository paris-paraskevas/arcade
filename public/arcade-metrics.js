// arcade-metrics.js — the single source of each game's leaderboard metric.
// Loaded as a classic <script> on every game page AND on the /leaderboard page,
// so both the submitter (arcade-client.js) and the board renderer agree.
//
//   dir : 'hi' = higher is better (points/rounds)
//         'lo' = lower is better (time/moves) — stored encoded as BASE - value
//                (see arcade-client.js) so ONE higher-is-better leaderboard view
//                ranks both kinds; the board decodes 'lo' rows for display.
//   unit: how the board formats the (decoded) value —
//         'pts'    integer points        'rounds' integer + " rounds"
//         'moves'  integer + " moves"    'cs'     centiseconds -> seconds (12.34s)
//
// Games not listed here default to { dir: 'hi', unit: 'pts' }. The six win/lose
// or couch-2-player games (tic-tac-toe, connect-four, pong, air-hockey, tron,
// snake-duel) have no single-player score and are intentionally absent.
window.ARCADE_METRICS = {
  // higher-is-better (points)
  '2048':            { dir: 'hi', unit: 'pts' },
  snake:             { dir: 'hi', unit: 'pts' },
  tetris:            { dir: 'hi', unit: 'pts' },
  breakout:          { dir: 'hi', unit: 'pts' },
  'space-invaders':  { dir: 'hi', unit: 'pts' },
  asteroids:         { dir: 'hi', unit: 'pts' },
  flappy:            { dir: 'hi', unit: 'pts' },
  'dino-runner':     { dir: 'hi', unit: 'pts' },
  'whack-a-mole':    { dir: 'hi', unit: 'pts' },
  'doodle-jump':     { dir: 'hi', unit: 'pts' },
  helicopter:        { dir: 'hi', unit: 'pts' },
  'stack-tower':     { dir: 'hi', unit: 'pts' },
  'missile-command': { dir: 'hi', unit: 'pts' },
  'bubble-shooter':  { dir: 'hi', unit: 'pts' },
  'match-three':     { dir: 'hi', unit: 'pts' },
  frogger:           { dir: 'hi', unit: 'pts' },
  'weekend-racer':   { dir: 'hi', unit: 'pts' }, // distance/points racer on a 60s clock, not lap-time
  simon:             { dir: 'hi', unit: 'rounds' },
  // lower-is-better (time / moves) — confirmed per game during wiring
  minesweeper:       { dir: 'lo', unit: 'cs' },
  sokoban:           { dir: 'lo', unit: 'moves' },
  'lights-out':      { dir: 'lo', unit: 'moves' },
  'fifteen-puzzle':  { dir: 'lo', unit: 'moves' },
  memory:            { dir: 'lo', unit: 'moves' },
};
