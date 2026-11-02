// Upload offline captures to GALLERY_URL (.env.local): pnpm sync
import { getSettings } from '../bridge/api'
import { syncAll } from '../bridge/sync'

console.log(`syncing to ${getSettings().galleryUrl}`)
const { synced, failed } = await syncAll(console.log)
console.log(`${synced} synced, ${failed.length} failed`)
if (failed.length) process.exitCode = 1
