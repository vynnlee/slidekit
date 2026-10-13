import { createRoot } from "react-dom/client";
import { IconProvider } from "@/lib/icon-context";
import { SizeProvider } from "@/lib/size-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <IconProvider>
    <SizeProvider size="compact">
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </SizeProvider>
  </IconProvider>,
);
