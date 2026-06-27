# Stack Tower

A timing stacker. A block slides back and forth across the top of the screen — press **Space** (or click / tap) to drop it onto the stack below.

## Controls
- **Space** / **Click** / **Tap** — drop the block
- **Space** / **Enter** — start & restart

## How it works
Each dropped block keeps only the part that overlaps the block beneath it; any overhang is sliced off and tumbles away, so the playable width shrinks with every sloppy drop. Land a pixel-perfect drop (within a few px) and you keep the full width plus a rising **combo** chime. The camera pans down as the tower grows and the slide speed ramps with height; the run ends the moment a drop misses the stack completely.

## Tweak ideas
- Edit `PERFECT_TOL` to make perfect drops more/less forgiving.
- Raise `SPEED_PER_BLOCK` / `MAX_SPEED` for a faster, nastier ramp.
- Change `hueForLevel()` to recolor the tower gradient.
