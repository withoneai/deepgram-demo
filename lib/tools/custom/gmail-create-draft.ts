import type { CustomTool } from "./types";

/** Save an email as a draft in Gmail. Nothing is sent. */
export const draftEmail: CustomTool = {
  name: "draft_email",
  platform: "gmail",
  description: "Save an email as a draft in the user's Gmail. It is not sent: they review and send it themselves. Write the full body yourself from what they asked for. If you only have a name, look up the email address first (for example with search_people).",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address. Several are comma-separated." },
      subject: { type: "string", description: "A short subject line." },
      body: { type: "string", description: "The full message in plain text, with a greeting and a sign-off." },
      cc: { type: "string", description: "CC addresses, comma-separated." },
      confirmed: { type: "boolean", description: "True only after the user agreed to this draft out loud." },
    },
    required: ["to", "subject", "body"],
  },
  action: {
    id: "conn_mod_def::GGZUe0SIuk8::nhwEKp2cQ6uARsH3513VeQ",
    title: "Create Draft",
    method: "POST",
    path: "/v1/gmail/create-draft",
    servedByOne: true,
  },
  // A draft writes to the mailbox, so the user hears it first. Set this to
  // false to skip the yes for drafts, since nothing leaves until they send it.
  changesSomething: true,
  request: (args) => ({
    body: {
      to: String(args.to ?? ""),
      subject: String(args.subject ?? ""),
      body: String(args.body ?? ""),
      ...(args.cc ? { cc: String(args.cc) } : {}),
    },
  }),
  result: (data) => ({ saved: Boolean(data?.draftId), draft_id: data?.draftId, preview: data?.snippet }),
};
