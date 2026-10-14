import type { CustomTool } from "./types";

/** Look a person up in Attio by name, email, company domain or phone. */
export const searchPeople: CustomTool = {
  name: "search_people",
  platform: "attio",
  description: "Search the user's Attio CRM for people by name, email, company domain or phone number. Use it whenever they ask about a contact or need someone's email address.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "A name, email, domain or phone number. Part of a name works too." },
      limit: { type: "number", description: "How many people to return, 1 to 10. Defaults to 5." },
    },
    required: ["query"],
  },
  action: {
    id: "conn_mod_def::GJ0CbY6VDMk::bN2lStzmS0admyNa4K83hg",
    title: "Search Records Across Objects",
    method: "POST",
    path: "/objects/records/search",
  },
  changesSomething: false,
  request: (args) => ({
    body: {
      query: String(args.query ?? "").slice(0, 256),
      objects: ["people"],
      request_as: { type: "workspace" },
      limit: Math.min(Math.max(Number(args.limit) || 5, 1), 10),
    },
  }),
  result: (data) => {
    const people = (data?.data ?? []).map((p: any) => ({
      name: p.record_text,
      emails: p.email_addresses?.length ? p.email_addresses : undefined,
      phones: p.phone_numbers?.length ? p.phone_numbers : undefined,
      record_id: p.id?.record_id,
    }));
    return people.length ? { people } : { people: [], note: "Nobody matched. Try part of the name or another spelling." };
  },
};
