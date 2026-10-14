import "server-only";

// What .env.local has, as booleans only. Values never leave the server.

export type SetupStatus = {
  deepgram: boolean;
  connect: { clientId: boolean; clientSecret: boolean; redirectUri: boolean };
  oneSecret: boolean;
  /** Deepgram plus either a complete Connect app or a One key. */
  ready: boolean;
};

const set = (name: string) => Boolean(process.env[name]?.trim());

export function setupStatus(): SetupStatus {
  const connect = { clientId: set("ONE_CLIENT_ID"), clientSecret: set("ONE_CLIENT_SECRET"), redirectUri: set("ONE_REDIRECT_URI") };
  const connectReady = connect.clientId && connect.clientSecret && connect.redirectUri;
  const deepgram = set("DEEPGRAM_API_KEY");
  const oneSecret = set("ONE_SECRET");
  return { deepgram, connect, oneSecret, ready: deepgram && (connectReady || oneSecret) };
}
