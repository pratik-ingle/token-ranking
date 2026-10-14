import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CsvImport } from "@/components/csv-import";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Import CSV" };

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/import");
  return (
    <div className="mx-auto max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Import usage from a CSV</CardTitle>
          <CardDescription>For Cursor individual plans (dashboard export) or any tool you can export as our generic CSV. Imported data is marked self-reported.</CardDescription>
        </CardHeader>
        <CardContent>
          <CsvImport timeZone={user.timezone} />
        </CardContent>
      </Card>
    </div>
  );
}
