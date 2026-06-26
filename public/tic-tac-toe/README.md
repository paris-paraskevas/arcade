# Tic-Tac-Toe

The classic 3x3 game, drawn procedurally on an HTML5 canvas. Two modes: **1 player vs CPU** (the computer plays a perfect minimax game — you can draw it but never beat it) and **2 player hotseat** (share the mouse, X then O). Just double-click `index.html`.

## Controls
- **1** — start a game vs the CPU (you are X, you move first)
- **2** — start a 2-player hotseat game
- **Click** a cell to place your mark
- **R** — reset the running scoreboard
- **Click** during the result pause to skip straight to the next round

## How it works
The board is a flat 9-cell array of `''`/`'X'`/`'O'`. A click places the current player's mark, then the 8 winning lines are checked for a win or a full-board draw; the winning line gets a pulsing green highlight. In vs-CPU mode the computer (O) runs **minimax** over every possible continuation, scoring wins/losses by depth so it grabs the fastest win and the most stubborn defence — which makes it unbeatable. The scoreboard (X wins / O wins / draws) persists in `localStorage` and rounds auto-advance after a short pause.

## Tweak ideas
- Change `CPU_THINK` / `AUTO_RESTART` to speed up or slow down the pacing.
- Make the CPU beatable by occasionally picking a random legal move instead of `bestCpuMove()`.
- Recolour via the `C` palette, or grow the board geometry with `BOARD` / `OY`.
