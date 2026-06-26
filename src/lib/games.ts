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
  tagline: 'a homemade collection — built one weekend at a time',
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

  { id: 'top-down-racer', title: 'Top-Down Racer', path: '', emoji: '🏁', blurb: 'Lap a circuit seen from above. A future build.', tags: ['racing', 'arcade'], gradient: 'linear-gradient(160deg, #2bb673 0%, #1d8f33 60%, #0f2747 100%)', status: 'planned' },
  { id: 'adventure', title: 'The Adventure', path: '', emoji: '🗺️', blurb: 'The story game. The real reason we’re here. Years out — and that’s fine.', tags: ['story', 'adventure'], gradient: 'linear-gradient(160deg, #6a5acd 0%, #34306b 55%, #0b0e14 100%)', status: 'dream' },
];
