/**
 * Prints the exact agent.think.functions the app sends Deepgram, for a user
 * connected to the given platforms (default: attio, gmail, google-calendar).
 *
 *   npm run print-tools
 *   npm run print-tools -- linear slack
 */
import { generalToolDefinitions } from "../lib/tools/one-tools";
import { customToolDefinitions } from "../lib/tools/custom";
import type { Connection } from "../lib/one";

const platforms = process.argv.slice(2).length ? process.argv.slice(2) : ["attio", "gmail", "google-calendar"];
const connections: Connection[] = platforms.map((platform) => ({ key: "", platform, access: { policy: "full" } }));
console.log(JSON.stringify([...customToolDefinitions(connections), ...generalToolDefinitions(connections)], null, 2));
