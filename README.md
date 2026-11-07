# paintings.commons-hub.at

Digitalize and sell Felix Fritsch's dad's paintings (~500, located in Austria).
Ideas and their status: `.bowman/` (Aimparency).

## Parts

| Path | What | Runs on |
|---|---|---|
| `src/` | Vue app: public gallery/shop, admin views | browser |
| `server/` | Hono API: paintings, ratings, images (D1 + R2) | Cloudflare Worker |
| `bridge/` | Capture bridge: gphoto2 remote capture, perspective warp, image variants, upload | laptop with the camera |
| `shared/` | Image variant config, size/calibration geometry | both |
| `scripts/` | `images:regen` | laptop |

## Development

```sh
cp .dev.vars.example .dev.vars   # website users (name:password[:role]) for the local Worker
cp .env.example .env.local       # bridge/scripts fallback (normally set in the capture UI)
pnpm db:migrate                  # local D1
pnpm dev                         # app + Worker on :5173
```

Capture tool (separate from the website): `pnpm capture` → http://localhost:5174.
Projects live in `captures/projects/<name>/` (photos, paintings, calibration, sync target + upload key).

## Capture

Camera: Sony α6400 via USB. Menu: **Network → Ctrl w/ Smartphone → Off** (otherwise USB Connection is greyed out),
**Setup → USB Connection → PC Remote**, and the **mode dial on M** (the other settings can't be changed over USB otherwise).
Aperture, file format (RAW+JPEG) and DRO off are set by the bridge (`fixedSettings` in `bridge/tether.ts`); ISO is chosen when calibrating colour.
Check with `gphoto2 --auto-detect`. If the camera is "busy", the desktop's gvfs automounter
grabbed it: `pkill -f gvfs-gphoto2-volume-monitor`.

1. Fixed camera position (tripod), painting placed at a marked spot.
2. Colour calibration, at the start of a session or whenever the light changes (**Calibrate colour**): photograph a painting
   with a clean white area and mark it. It sets the shutter (white at a chosen level, by default 242/255) and the white balance for all following
   paintings alike, so a painting's own colour bias stays. Recalibrate with the same painting and area. The saved
   `archive` has the white balance applied, `original` doesn't. Details: `bridge/color.ts`; result: `<project>/color/`.
3. Remote capture → type title → select 4 corners → perspective warp to a rectangle.
4. Distance calibration: the first painting of a session asks for measured width/height in cm.
   Later sessions ask "Same distance from camera to painting as before? (reuse calibration)".
   Calibration lives in `captures/calibration.json`.
5. Paintings are stored offline in `captures/projects/<name>/paintings/<id>/` (archive, thumb, metadata).
   Upload them with the **Sync** button or `pnpm sync` (to `GALLERY_URL` in `.env.local`; safe to rerun).

## Stacks

Paintings lie in physical stacks. "Keller #3" is a painting's **stack index**: its position in the stack, so it can be found.
When a painting leaves (**Take out of stack** on `/admin`), the index of every painting after it goes down by one. **Put back
into stack** returns it to its old place. Selling doesn't take a painting out: it stays findable until someone gets it.
The index is counted rather than stored, from `stack_order` (set at capture, never changes, can have gaps) and what's still
there, so the capture laptop and the gallery can't overwrite each other. Deleted paintings don't count.

## Images

The **archive** (rectified, full resolution, JPEG q90) is the private master in R2 (plus the local copy in
`captures/paintings/`). Web variants (`detail` 2560/q80, `normal` 1280/q75, `thumb` 384/q70) are derived
from it, as configured in `shared/image-variants.ts`. After changing that config:

```sh
pnpm images:regen           # paintings whose variants are outdated (config version changed)
pnpm images:regen --force   # all
```

Regeneration uses the gallery URL + upload key from the capture settings (`captures/settings.json`).

## Deploy (Commons Hub Cloudflare account)

One-time setup:

```sh
pnpm wrangler d1 create paintings                # id is in wrangler.jsonc env.commons
pnpm wrangler r2 bucket create paintings-images  # R2 must be enabled in the dashboard first
pnpm db:migrate:commons
pnpm wrangler secret put USERS --env commons     # "name:password[:admin],…" (others: rater)
```

Then `pnpm run deploy`.
