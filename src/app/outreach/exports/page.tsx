import type { Metadata } from "next";
import { ExportTemplatesView } from "@/components/templates/export-templates-view";

export const metadata: Metadata = { title: "Export templates" };

export default function ExportTemplatesPage() {
  return <ExportTemplatesView />;
}
