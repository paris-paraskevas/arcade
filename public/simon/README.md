# Simon

The classic memory game. Watch the machine flash a growing sequence of colored pads, then repeat it back from memory. Each round adds one more step and speeds the playback up a little — how far can you get?

## Controls
- **Click** a pad to play it back during the REPEAT phase.
- **Keys 1-4** also trigger pads (green, red, yellow, blue).
- **Space / Enter** to start, and to restart after a game over.

## How it works
The board is four colored quadrant pads drawn procedurally on a 520x560 canvas, each with its own sustained WebAudio tone. Every round appends a random pad to the sequence and plays it back (lit + sounded); input is locked out during playback so early clicks don't register. Repeat the whole sequence correctly to advance; one wrong press triggers a buzzer and ends the run. The best round reached is stored in `localStorage`.

## Tweak ideas
- Change difficulty curve in `nextRound()` — adjust the `speedup` cap or the `pbOn`/`pbOff` floors.
- Retune the pads by editing each entry's `freq` in the `PADS` table.
- Add a "strict mode" where a single mistake restarts the whole sequence instead of ending the game.
