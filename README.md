# art.commons-hub.at

Digitalize and sell Felix Fritsch's dad's paintings (~100, located in Austria).

## Parts

- **Public shop**: paintings with real size and price, Stripe checkout, pick-up (0 €) or size-based shipping.
- **Admin** (manually shared credentials, no emails): capture tool, aesthetic rating 1–10 per admin (size is a separate price factor), list of unrated paintings.
- **Camera bridge** (local Linux): drives the camera over USB via gphoto2 for remote capture.

## Capture flow

1. Fixed camera position (tripod), painting placed at a marked spot.
2. Remote capture → type title → select 4 corners (magnifier loupe) → perspective warp to a rectangle.
3. Calibration: the first painting of a session asks for measured width/height in cm. Later sessions ask
   "Same distance from camera to painting as before? (reuse calibration)".

## Stack (proposed)

Vue (Vite) + Cloudflare Worker API (Hono) + D1 (SQLite) + R2 (images), deployed to `art.commons-hub.at`
via `wrangler deploy --env commons`.
