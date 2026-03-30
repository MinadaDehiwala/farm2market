import * as Dialog from "@radix-ui/react-dialog";
import { Outlet, NavLink, Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../state/authStore";
import { useRuntimeConfig } from "../state/runtimeConfigStore";
import NotificationInbox from "../components/ui/NotificationInbox";
import Chatbot from "../components/ai/Chatbot";
import MaintenanceShell from "../components/system/MaintenanceShell";

import "../styles/layout.css";
import "../styles/components/mobile-drawer.css";

const COMPACT_QUERY = "(max-width: 1024px)";

/**
 * DashboardLayout
 * - Owns layout + navigation chrome only
 * - Role-aware sidebar
 * - Common dashboard for buyer + transporter
 */
export default function DashboardLayout() {
  const { role, loading, user, isAdmin } = useAuth();
  const { features, site } = useRuntimeConfig();
  const location = useLocation();
  const dashboardHome = role === "transporter" ? "/dashboard/transporter" : "/dashboard";
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(COMPACT_QUERY).matches;
  });
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(COMPACT_QUERY);
    const onMediaChange = (event) => setIsCompact(event.matches);

    setIsCompact(mediaQuery.matches);
    mediaQuery.addEventListener("change", onMediaChange);
    return () => mediaQuery.removeEventListener("change", onMediaChange);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isCompact) {
      setNavOpen(false);
    }
  }, [isCompact]);

  useEffect(() => {
    if (!isCompact || !navOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCompact, navOpen]);

  const navItems = useMemo(() => {
    const items = [];

    if (role === "buyer" || role === "transporter") {
      items.push({ to: dashboardHome, label: "Dashboard", end: true });

      if (features.orderThreadsEnabled) {
        items.push({ to: "/dashboard/orders", label: "Orders" });
      }

      if (features.predictionsEnabled) {
        items.push({
          to: "/dashboard/predictions",
          label: "Market Predictions",
        });
      }
    }

    if (role === "farmer") {
      items.push({ to: "/dashboard/farmer", label: "Farmer Dashboard" });
      items.push({ to: "/dashboard/stock", label: "Submit Stock" });

      if (features.predictionsEnabled) {
        items.push({
          to: "/dashboard/predictions",
          label: "Market Predictions",
        });
      }

      if (features.orderThreadsEnabled) {
        items.push({ to: "/dashboard/orders", label: "Orders" });
      }
    }

    return items;
  }, [dashboardHome, features.orderThreadsEnabled, features.predictionsEnabled, role]);

  const dashboardLabel =
    role === "farmer"
      ? "Farmer workspace"
      : role === "transporter"
        ? "Transport workspace"
        : role === "buyer"
          ? "Buyer workspace"
          : "Workspace";

  const navContent = (
    <>
      {features.orderThreadsEnabled && <NotificationInbox />}

      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          {item.label}
        </NavLink>
      ))}

      {user && !role && (
        <span className="dashboard-empty-state">No dashboard available</span>
      )}
    </>
  );

  if (loading) {
    return (
      <div className="dashboard-shell">
        <aside className="dashboard-sidebar" />
        <main className="dashboard-content">
          Loading dashboard…
        </main>
      </div>
    );
  }

  if (site.maintenanceEnabled && !isAdmin) {
    return (
      <MaintenanceShell
        title={site.maintenanceTitle}
        message={site.maintenanceMessage}
      />
    );
  }

  return (
    <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
      <div className="dashboard-shell">
        {!isCompact && (
          <aside className="dashboard-sidebar">
            <div className="dashboard-sidebar-head">
              <Link to="/" className="dashboard-home-link">
                Farm2Market
              </Link>
              <span className="dashboard-sidebar-caption">{dashboardLabel}</span>
            </div>
            {navContent}
          </aside>
        )}

        <div className="dashboard-main">
          {isCompact && (
            <div className="dashboard-mobile-bar">
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="drawer-menu-button dashboard-menu-button"
                  aria-label="Open dashboard navigation"
                >
                  <span className="drawer-menu-icon" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="drawer-menu-label">Menu</span>
                </button>
              </Dialog.Trigger>

              <div className="dashboard-mobile-brand">
                <span>Farm2Market</span>
                <strong>{dashboardLabel}</strong>
              </div>

              <Link to="/" className="dashboard-mobile-home">
                Home
              </Link>
            </div>
          )}

          <main className="dashboard-content">
            <Outlet />
          </main>
        </div>

        {features.aiChatEnabled && <Chatbot />}
      </div>

      {isCompact && (
        <Dialog.Portal>
          <Dialog.Overlay className="mobile-drawer-overlay" />
          <Dialog.Content
            className="mobile-drawer-content dashboard-drawer"
            data-side="left"
          >
            <div className="mobile-drawer-header">
              <div>
                <Dialog.Title className="mobile-drawer-title">
                  Dashboard menu
                </Dialog.Title>
                <p className="mobile-drawer-subtitle">
                  Jump between dashboard tools and current notifications.
                </p>
              </div>

              <Dialog.Close asChild>
                <button
                  type="button"
                  className="mobile-drawer-close"
                  aria-label="Close dashboard navigation"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>

            <div className="dashboard-drawer-home">
              <Link to="/" className="dashboard-home-link" onClick={() => setNavOpen(false)}>
                Farm2Market
              </Link>
              <span className="dashboard-sidebar-caption">{dashboardLabel}</span>
            </div>

            <nav className="dashboard-drawer-nav">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `mobile-drawer-link dashboard-drawer-link${isActive ? " active" : ""}`
                  }
                  onClick={() => setNavOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="dashboard-drawer-rail">
              {features.orderThreadsEnabled && <NotificationInbox />}
              {user && !role && (
                <span className="dashboard-empty-state">No dashboard available</span>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}
