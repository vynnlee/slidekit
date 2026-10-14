import { createRoot } from "react-dom/client";
import { IconProvider } from "@/lib/icon-context";
import { SizeProvider } from "@/lib/size-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { ConnectionStatus } from "./ConnectionStatus";
import { Toaster } from "./Toaster";

createRoot(document.getElementById("root")!).render(
  <IconProvider>
    <SizeProvider size="compact">
      <TooltipProvider>
        <ErrorBoundary>
          <ConnectionStatus />
          <Toaster />
          <App />
        </ErrorBoundary>
      </TooltipProvider>
    </SizeProvider>
  </IconProvider>,
);
