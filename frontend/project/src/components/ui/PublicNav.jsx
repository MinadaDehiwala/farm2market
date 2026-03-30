import * as Dialog from "@radix-ui/react-dialog";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "../../styles/components/public-nav.css";
import "../../styles/components/mobile-drawer.css";

const MOBILE_QUERY = "(max-width: 900px)";

const NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

export default function PublicNav({
  loading,
  user,
  isAdmin,
  allowSignup = true,
  onLogin,
  onSignup,
  onViewProfile,
  onAdmin,
  onLogout,
}) {
  const location = useLocation();
  const navRef = useRef(null);
  const bubbleRef = useRef(null);
  const base = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const onMediaChange = (event) => setIsMobile(event.matches);

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", onMediaChange);
    return () => mediaQuery.removeEventListener("change", onMediaChange);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, mobileOpen]);

  // Anchor bubble to active route
  useEffect(() => {
    if (isMobile) return undefined;

    const nav = navRef.current;
    const bubble = bubbleRef.current;
    if (!nav || !bubble) return;

    const padX = 12;
    const padY = 6;
    const syncBubble = () => {
      const active = nav.querySelector(".nav-link.active");
      if (!active) {
        bubble.style.opacity = "0";
        return;
      }

      const rect = active.getBoundingClientRect();
      const parent = nav.getBoundingClientRect();

      base.current = {
        w: rect.width + padX * 2,
        h: rect.height + padY * 2,
        x: rect.left - parent.left - padX,
        y: rect.top - parent.top - padY,
      };

      bubble.style.opacity = "1";
      bubble.style.width = `${base.current.w}px`;
      bubble.style.height = `${base.current.h}px`;
      bubble.style.transform = `translate(${base.current.x}px, ${base.current.y}px)`;
    };

    syncBubble();
    window.addEventListener("resize", syncBubble);
    return () => window.removeEventListener("resize", syncBubble);
  }, [isMobile, location.pathname]);

  // Hover snap behavior (THIS was missing)
  useEffect(() => {
    if (isMobile) return undefined;

    const nav = navRef.current;
    const bubble = bubbleRef.current;
    if (!nav || !bubble) return;

    const padX = 12;
    const padY = 6;

    const moveTo = (el) => {
      const rect = el.getBoundingClientRect();
      const parent = nav.getBoundingClientRect();

      bubble.style.width = `${rect.width + padX * 2}px`;
      bubble.style.height = `${rect.height + padY * 2}px`;
      bubble.style.transform = `translate(
        ${rect.left - parent.left - padX}px,
        ${rect.top - parent.top - padY}px
      )`;
    };

    const links = Array.from(nav.querySelectorAll(".nav-link"));
    const cleanups = [];

    links.forEach((link) => {
      const handler = () => moveTo(link);
      link.addEventListener("mouseenter", handler);
      cleanups.push(() => link.removeEventListener("mouseenter", handler));
    });

    const reset = () => {
      bubble.style.opacity = "1";
      bubble.style.width = `${base.current.w}px`;
      bubble.style.height = `${base.current.h}px`;
      bubble.style.transform = `translate(${base.current.x}px, ${base.current.y}px)`;
    };

    nav.addEventListener("mouseleave", reset);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      nav.removeEventListener("mouseleave", reset);
    };
  }, [isMobile, location.pathname]);

  const runDrawerAction = async (callback) => {
    setMobileOpen(false);
    if (typeof callback === "function") {
      await callback();
    }
  };

  return (
    <>
      <nav className="nav nav-desktop" aria-label="Primary">
        <div className="nav-glass" ref={navRef}>
          <div className="nav-bubble" ref={bubbleRef} />

          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className="nav-link"
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <div className="nav-mobile">
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="drawer-menu-button public-nav-menu-button"
              aria-label="Open navigation menu"
            >
              <span className="drawer-menu-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="drawer-menu-label">Menu</span>
            </button>
          </Dialog.Trigger>
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="mobile-drawer-overlay" />

          <Dialog.Content
            className="mobile-drawer-content public-nav-drawer"
            data-side="right"
          >
            <div className="mobile-drawer-header">
              <div>
                <Dialog.Title className="mobile-drawer-title">
                  Navigation
                </Dialog.Title>
                <p className="mobile-drawer-subtitle">
                  Explore Farm2Market and your account options.
                </p>
              </div>

              <Dialog.Close asChild>
                <button
                  type="button"
                  className="mobile-drawer-close"
                  aria-label="Close navigation menu"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>

            <nav className="mobile-drawer-nav" aria-label="Mobile navigation">
              {NAV_LINKS.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `mobile-drawer-link${isActive ? " active" : ""}`
                  }
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>

            <div className="public-nav-drawer-footer">
              {loading && (
                <button
                  type="button"
                  className="mobile-drawer-action public-nav-action"
                  disabled
                >
                  Loading account...
                </button>
              )}

              {!loading && !user && (
                <>
                  <button
                    type="button"
                    className="mobile-drawer-action public-nav-action"
                    onClick={() => runDrawerAction(onLogin)}
                  >
                    Login
                  </button>

                  {allowSignup && typeof onSignup === "function" && (
                    <button
                      type="button"
                      className="mobile-drawer-action public-nav-action secondary"
                      onClick={() => runDrawerAction(onSignup)}
                    >
                      Sign Up
                    </button>
                  )}
                </>
              )}

              {!loading && user && (
                <>
                  <div className="public-nav-account-card">
                    <span className="public-nav-account-label">Signed in as</span>
                    <strong>{user.displayName || user.email || "Account"}</strong>
                    {user.email && <span>{user.email}</span>}
                  </div>

                  <button
                    type="button"
                    className="mobile-drawer-action public-nav-action"
                    onClick={() => runDrawerAction(onViewProfile)}
                  >
                    View Profile
                  </button>

                  {isAdmin && typeof onAdmin === "function" && (
                    <button
                      type="button"
                      className="mobile-drawer-action public-nav-action secondary"
                      onClick={() => runDrawerAction(onAdmin)}
                    >
                      Admin Center
                    </button>
                  )}

                  <button
                    type="button"
                    className="mobile-drawer-action public-nav-action danger"
                    onClick={() => runDrawerAction(onLogout)}
                  >
                    Logout
                  </button>
                </>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
