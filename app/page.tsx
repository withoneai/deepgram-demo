import { Demo } from "@/components/demo";
import { SetupGuide } from "@/components/setup-guide";
import { setupStatus } from "@/lib/setup";

// Read .env.local on every request, so the guide disappears once it's filled in.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const status = setupStatus();
  // `/?setup` shows the guide even when everything is set.
  if (!status.ready || (await searchParams).setup !== undefined) return <SetupGuide status={status} />;
  return <Demo />;
}
