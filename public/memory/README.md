# Memory Match

A classic concentration / pairs game. A 4x4 grid hides 8 pairs of cards, each pair a distinct procedurally-drawn symbol in its own colour. Flip two cards a turn: matches stay up, mismatches flip back. Find every pair to win.

## Controls
- **Click / tap** a card to flip it.
- **R** or **Enter** — start / new game (also begins from the title screen).

## How it works
Each game shuffles 8 symbol pairs (Fisher–Yates) onto the board, and every variable the renderer reads is initialized at load so the title screen draws a real board. The flip is faked by scaling each card horizontally toward zero at the halfway point and swapping the back design for the symbol face. The timer starts on your first flip; clicks are ignored while a mismatched pair is resolving, so you can't out-click the animation. Best score (fewest moves, fastest time as the tie-break) is saved to `localStorage`.

## Tweak ideas
- Change `COLS` / `ROWS` near the top for a harder 6x6 board (add a few more entries to `SYMBOLS`).
- Adjust `MISMATCH_HOLD` to give more or less time to memorize a missed pair.
- Add a move/time penalty or a star rating on the win screen for extra challenge.
