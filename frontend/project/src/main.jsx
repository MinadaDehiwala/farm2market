import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";

import router from "./app/router.jsx";
import { AuthProvider } from "./state/authStore.jsx";
import { RuntimeConfigProvider } from "./state/runtimeConfigStore.jsx";
import AccountSetupGate from "./components/ui/AccountSetupGate.jsx";
import "./styles/base.css";
import "./styles/account-setup.css";


function RootFallback() {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Something went wrong</h2>
      <p>Please refresh the page.</p>
    </div>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuthProvider>
      <RuntimeConfigProvider>
        <AccountSetupGate>
          <React.Suspense fallback={<RootFallback />}>
            <RouterProvider router={router} />
          </React.Suspense>
        </AccountSetupGate>
      </RuntimeConfigProvider>

      <Toaster richColors position="top-right" closeButton duration={4000} />
    </AuthProvider>
  </React.StrictMode>
);
