/**
 * How to say a platform's name. One's platform ids are kebab-case
 * ("google-calendar"); anything not listed here is title-cased, so a newly
 * connected app reads fine without a code change.
 */

const NAMES: Record<string, string> = {
  "google-calendar": "Google Calendar",
  "google-drive": "Google Drive",
  "google-sheets": "Google Sheets",
  "google-docs": "Google Docs",
  "outlook-mail": "Outlook",
  "microsoft-teams": "Microsoft Teams",
  hubspot: "HubSpot",
  github: "GitHub",
  gitlab: "GitLab",
  clickup: "ClickUp",
  quickbooks: "QuickBooks",
};

export function platformName(platform?: string): string {
  if (!platform) return "your apps";
  return NAMES[platform] ?? platform.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export const logo = (platform?: string) => `https://assets.withone.ai/connectors/${platform || "one"}.svg`;
