// Workers cannot start processes. The browser-automation and external-bot features that
// spawn processes report themselves as unavailable instead of crashing.
export function spawn() {
  throw new Error("process_spawn_unavailable_on_cloudflare_workers");
}
export default { spawn };
