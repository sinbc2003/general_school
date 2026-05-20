"use client";

import { useSearchParams } from "next/navigation";
import { MyWorkspaceView, type WorkspaceTab } from "@/components/workspace/MyWorkspaceView";

export default function AdminMyWorkspacePage() {
  const sp = useSearchParams();
  const tab = (sp?.get("tab") || "docs") as WorkspaceTab;
  return <MyWorkspaceView mode="admin" initialTab={tab} />;
}
