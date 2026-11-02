# art.commons-hub.at

Digitalize and sell Felix Fritsch's dad's paintings (~100, located in Austria).
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
cp .dev.vars.example .dev.vars   # admins for the local Worker
cp .env.example .env.local       # bridge/scripts → which gallery + admin login
pnpm db:migrate                  # local D1
pnpm dev                         # app + Worker on :5173
pnpm bridge                      # capture bridge on :5174 (proxied at /bridge)
```

Capture screen: http://localhost:5173/capture (dev builds only, never deployed).

## Capture

Camera: Sony α6400 via USB. Menu: **Network → Ctrl w/ Smartphone → Off** (otherwise USB Connection is greyed out),
**Setup → USB Connection → PC Remote**, and file format **JPEG**.
Check with `gphoto2 --auto-detect`. If the camera is "busy", the desktop's gvfs automounter
grabbed it: `pkill -f gvfs-gphoto2-volume-monitor`.

1. Fixed camera position (tripod), painting placed at a marked spot.
2. Remote capture → type title → select 4 corners → perspective warp to a rectangle.
3. Calibration: the first painting of a session asks for measured width/height in cm.
   Later sessions ask "Same distance from camera to painting as before? (reuse calibration)".
   Calibration lives in `captures/calibration.json`.
4. Paintings are stored offline in `captures/paintings/<id>/` (archive, thumb, metadata).
   Upload them with the **Sync** button or `pnpm sync` (to `GALLERY_URL` in `.env.local`; safe to rerun).

## Images

The **archive** (rectified, full resolution, JPEG q90) is the private master in R2 (plus the local copy in
`captures/paintings/`). Web variants (`detail` 2560/q80, `normal` 1280/q75, `thumb` 384/q70) are derived
from it, as configured in `shared/image-variants.ts`. After changing that config:

```sh
pnpm images:regen           # paintings whose variants are outdated (config version changed)
pnpm images:regen --force   # all
```

Point `GALLERY_URL` in `.env.local` at `https://art.commons-hub.at` to regenerate production.

## Deploy (Commons Hub Cloudflare account)

One-time setup:

```sh
pnpm wrangler d1 create art-commons-hub          # put the id into wrangler.jsonc env.commons
pnpm wrangler r2 bucket create art-commons-hub-images
pnpm db:migrate:commons
pnpm wrangler secret put ADMINS --env commons    # "name:password,name:password"
```

Then `pnpm deploy:commons`.
