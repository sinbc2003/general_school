"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default function OnboardingPage() {
  const router = useRouter();
  const [show, setShow] = useState(true);

  const close = () => {
    setShow(false);
    router.push("/dashboard");
  };

  if (!show) return null;
  return <OnboardingWizard onClose={close} forceShow />;
}
