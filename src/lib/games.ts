// The arcade catalog. One entry per game; the shelf (src/pages/index.astro)
// renders from this. Games themselves are static folders under public/<slug>/,
// served at /<slug>/index.html. To add a game: drop the folder in public/ and
// add an entry here.

export type GameStatus = 'playable' | 'planned' | 'dream';

export interface Game {
  id: string;
  title: string;
  path: string; // '' for non-playable roadmap cards
  emoji: string;
  blurb: string;
  tags: string[];
  gradient: string;
  status: GameStatus;
}

export const ARCADE = {
  name: 'ARCADE',
  tagline: 'a homemade collection — 30 games and counting',
};

export const GAMES: Game[] = [
  { id: 'weekend-racer', title: 'Weekend Racer', path: '/weekend-racer/index.html', emoji: '🏎️', blurb: 'Pseudo-3D arcade racing. Dodge traffic, beat the clock.', tags: ['racing', 'arcade'], gradient: 'linear-gradient(160deg, #ff9e57 0%, #d65a8f 45%, #3a2a6b 100%)', status: 'playable' },
  { id: 'snake', title: 'Snake', path: '/snake/index.html', emoji: '🐍', blurb: 'Eat, grow, don’t bite yourself. The one everyone knows.', tags: ['arcade', 'classic'], gradient: 'linear-gradient(160deg, #3ddc84 0%, #1d8f33 60%, #0f2747 100%)', status: 'playable' },
  { id: 'breakout', title: 'Breakout', path: '/breakout/index.html', emoji: '🧱', blurb: 'Bounce the ball, smash every brick, don’t drop it.', tags: ['arcade', 'classic'], gradient: 'linear-gradient(160deg, #48c6ef 0%, #2b6aa0 55%, #10142a 100%)', status: 'playable' },
  { id: 'asteroids', title: 'Asteroids', path: '/asteroids/index.html', emoji: '🚀', blurb: 'Drift, thrust, shoot. Vector-art space survival.', tags: ['arcade', 'shooter', 'classic'], gradient: 'linear-gradient(160deg, #3a3f55 0%, #171a2b 60%, #05060a 100%)', status: 'playable' },
  { id: 'tetris', title: 'Tetris', path: '/tetris/index.html', emoji: '🧩', blurb: 'Stack the falling blocks, clear the lines, chase the level.', tags: ['puzzle', 'classic'], gradient: 'linear-gradient(160deg, #a06bff 0%, #5a3fb0 55%, #10142a 100%)', status: 'playable' },
  { id: 'pong', title: 'Pong', path: '/pong/index.html', emoji: '🏓', blurb: 'The original. 1P vs a tough CPU, or 2P on one keyboard.', tags: ['arcade', 'classic', '2-player'], gradient: 'linear-gradient(160deg, #5a7bff 0%, #2b3f8f 55%, #0b0e14 100%)', status: 'playable' },
  { id: 'space-invaders', title: 'Space Invaders', path: '/space-invaders/index.html', emoji: '👾', blurb: 'Hold the line as the swarm speeds up. Mind the bunkers.', tags: ['arcade', 'shooter', 'classic'], gradient: 'linear-gradient(160deg, #56d364 0%, #1d8f33 55%, #05060a 100%)', status: 'playable' },
  { id: 'flappy', title: 'Flappy', path: '/flappy/index.html', emoji: '🐤', blurb: 'One button. Endless pipes. Rage guaranteed.', tags: ['arcade', 'classic'], gradient: 'linear-gradient(160deg, #7ec8f0 0%, #3a8fd0 50%, #1a3a5b 100%)', status: 'playable' },
  { id: '2048', title: '2048', path: '/2048/index.html', emoji: '🔢', blurb: 'Slide and merge tiles. Chase the 2048 — then keep going.', tags: ['puzzle', 'classic'], gradient: 'linear-gradient(160deg, #f5b045 0%, #d6772e 55%, #3a2410 100%)', status: 'playable' },
  { id: 'minesweeper', title: 'Minesweeper', path: '/minesweeper/index.html', emoji: '💣', blurb: 'Read the numbers, flag the bombs, clear the field.', tags: ['puzzle', 'logic', 'classic'], gradient: 'linear-gradient(160deg, #9aa4b2 0%, #5a6577 50%, #1a1f2a 100%)', status: 'playable' },
  { id: 'memory', title: 'Memory Match', path: '/memory/index.html', emoji: '🃏', blurb: 'Flip, remember, pair them all in the fewest moves.', tags: ['puzzle', 'memory'], gradient: 'linear-gradient(160deg, #c98bff 0%, #6a4ba0 55%, #16122a 100%)', status: 'playable' },
  { id: 'tic-tac-toe', title: 'Tic-Tac-Toe', path: '/tic-tac-toe/index.html', emoji: '⭕', blurb: 'Beat the unbeatable minimax CPU — or a friend.', tags: ['puzzle', 'classic', '2-player'], gradient: 'linear-gradient(160deg, #2bd6c0 0%, #1d8f8f 55%, #0b1e22 100%)', status: 'playable' },
  { id: 'connect-four', title: 'Connect Four', path: '/connect-four/index.html', emoji: '🔴', blurb: 'Four in a row. The CPU thinks six moves ahead.', tags: ['puzzle', 'classic', '2-player'], gradient: 'linear-gradient(160deg, #f0556a 0%, #d6a02e 55%, #1a1430 100%)', status: 'playable' },
  { id: 'simon', title: 'Simon', path: '/simon/index.html', emoji: '🎵', blurb: 'Watch the colors, repeat the tune, push your memory.', tags: ['memory', 'classic'], gradient: 'linear-gradient(160deg, #56d364 0%, #f0556a 50%, #5a7bff 100%)', status: 'playable' },
  { id: 'lights-out', title: 'Lights Out', path: '/lights-out/index.html', emoji: '💡', blurb: 'Toggle the grid to darkness. Always solvable, never easy.', tags: ['puzzle', 'logic'], gradient: 'linear-gradient(160deg, #ffd24d 0%, #b07a1e 50%, #0b0e14 100%)', status: 'playable' },
  { id: 'whack-a-mole', title: 'Whack-a-Mole', path: '/whack-a-mole/index.html', emoji: '🔨', blurb: 'Sixty seconds, fast moles, and bombs you must NOT hit.', tags: ['arcade', 'reaction'], gradient: 'linear-gradient(160deg, #8bd450 0%, #4a8f2e 55%, #2a1a0e 100%)', status: 'playable' },
  { id: 'dino-runner', title: 'Dino Runner', path: '/dino-runner/index.html', emoji: '🦖', blurb: 'Jump and duck through an endless, accelerating desert.', tags: ['arcade', 'runner'], gradient: 'linear-gradient(160deg, #8a93a5 0%, #4a5263 55%, #14171f 100%)', status: 'playable' },
  { id: 'snake-duel', title: 'Snake Duel', path: '/snake-duel/index.html', emoji: '🆚', blurb: 'Two snakes, one grid, best of three. Couch rivalry.', tags: ['arcade', '2-player'], gradient: 'linear-gradient(160deg, #36c5e0 0%, #e0a836 55%, #0b0e14 100%)', status: 'playable' },

  // ---- Wave 2 ----
  { id: 'frogger', title: 'Frogger', path: '/frogger/index.html', emoji: '🐸', blurb: 'Hop across traffic and a river of logs. Don’t get squished.', tags: ['arcade', 'classic'], gradient: 'linear-gradient(160deg, #3ddc84 0%, #1d8f33 55%, #14110a 100%)', status: 'playable' },
  { id: 'missile-command', title: 'Missile Command', path: '/missile-command/index.html', emoji: '🎯', blurb: 'Defend six cities. Intercept the incoming rain.', tags: ['arcade', 'shooter', 'classic'], gradient: 'linear-gradient(160deg, #ff6b5a 0%, #8f2d2d 55%, #0b0e14 100%)', status: 'playable' },
  { id: 'doodle-jump', title: 'Doodle Jump', path: '/doodle-jump/index.html', emoji: '🦘', blurb: 'Bounce ever upward. Don’t miss the next platform.', tags: ['arcade'], gradient: 'linear-gradient(160deg, #7ec8f0 0%, #4a9f6a 55%, #1a3a2a 100%)', status: 'playable' },
  { id: 'tron', title: 'Tron Light-Cycles', path: '/tron/index.html', emoji: '🏍️', blurb: 'Light-cycle duel — wall the other player in. Couch 2P.', tags: ['arcade', '2-player'], gradient: 'linear-gradient(160deg, #36e0e0 0%, #1d6f8f 50%, #0b0e14 100%)', status: 'playable' },
  { id: 'helicopter', title: 'Helicopter', path: '/helicopter/index.html', emoji: '🚁', blurb: 'Hold to fly, release to fall. Thread the cave.', tags: ['arcade'], gradient: 'linear-gradient(160deg, #9aa4b2 0%, #4a6577 55%, #0b1620 100%)', status: 'playable' },
  { id: 'sokoban', title: 'Sokoban', path: '/sokoban/index.html', emoji: '📦', blurb: 'Push every box onto a target. No takebacks (well, undo).', tags: ['puzzle', 'logic'], gradient: 'linear-gradient(160deg, #d6a05a 0%, #8f5a2e 55%, #2a1a10 100%)', status: 'playable' },
  { id: 'fifteen-puzzle', title: '15-Puzzle', path: '/fifteen-puzzle/index.html', emoji: '🧮', blurb: 'Slide the tiles into order. A classic time-killer.', tags: ['puzzle', 'classic'], gradient: 'linear-gradient(160deg, #6aa0ff 0%, #3a4f9f 55%, #10142a 100%)', status: 'playable' },
  { id: 'match-three', title: 'Match-3', path: '/match-three/index.html', emoji: '💎', blurb: 'Swap gems, line up three, chain the cascades.', tags: ['puzzle'], gradient: 'linear-gradient(160deg, #ff6bd6 0%, #a03fb0 50%, #2a1030 100%)', status: 'playable' },
  { id: 'bubble-shooter', title: 'Bubble Shooter', path: '/bubble-shooter/index.html', emoji: '🫧', blurb: 'Aim, shoot, pop clusters before they reach the bottom.', tags: ['puzzle', 'arcade'], gradient: 'linear-gradient(160deg, #48d0ef 0%, #6a5acd 55%, #16122a 100%)', status: 'playable' },
  { id: 'air-hockey', title: 'Air Hockey', path: '/air-hockey/index.html', emoji: '🏒', blurb: 'Fast 1v1 on one keyboard (or vs CPU). First to seven.', tags: ['arcade', '2-player'], gradient: 'linear-gradient(160deg, #48c6ef 0%, #2b6aa0 55%, #0b1020 100%)', status: 'playable' },
  { id: 'artillery', title: 'Artillery Duel', path: '/artillery/index.html', emoji: '🪖', blurb: 'Angle, power, fire. Turn-based tank duel with wind.', tags: ['strategy', '2-player'], gradient: 'linear-gradient(160deg, #c2a05a 0%, #6a5a2e 55%, #1a160a 100%)', status: 'playable' },
  { id: 'stack-tower', title: 'Stack Tower', path: '/stack-tower/index.html', emoji: '🏗️', blurb: 'Drop blocks dead-center. Every miss shrinks the tower.', tags: ['arcade', 'reaction'], gradient: 'linear-gradient(160deg, #ffb04d 0%, #d6772e 50%, #2a1810 100%)', status: 'playable' },
];
