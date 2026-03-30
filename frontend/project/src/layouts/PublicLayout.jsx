import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

import "../styles/components/public-header.css";
import "../styles/layout.css";
import "../styles/components/liquid-glass.css";

import LoginModal from "../components/modals/LoginModal";
import SignupModal from "../components/modals/SignupModal";
import { useAuth } from "../state/authStore";
import { useRuntimeConfig } from "../state/runtimeConfigStore";

import Logo from "../components/ui/Logo";
import PublicNav from "../components/ui/PublicNav";
import Avatar from "../components/ui/Avatar";
import ProfileDropdown from "../components/ui/ProfileDropdown";
import Chatbot from "../components/ai/Chatbot";
import MaintenanceShell from "../components/system/MaintenanceShell";

export default function PublicLayout() {
  const [authModal, setAuthModal] = useState(null);
  const {
    user,
    loading,
    isAdmin,
    logout,
    justLoggedOut,
    clearJustLoggedOut,
  } = useAuth();
  const { features, site } = useRuntimeConfig();

  const navigate = useNavigate();
  const location = useLocation();
  const showChatbot = location.pathname !== "/test";

  // Pages that use transparent + glass header
  const overlayHeaderPages = ["/", "/about", "/contact", "/profile"];
  const useOverlayHeader = overlayHeaderPages.includes(location.pathname);
  const handleLoginOpen = () => setAuthModal("login");
  const handleSignupOpen = () => setAuthModal("signup");
  const handleViewProfile = () => navigate("/profile");
  const handleAdminOpen = () => navigate("/admin");
  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  // 🔹 NEW: react to logout signal
  useEffect(() => {
    if (justLoggedOut) {
      setAuthModal("login");
      navigate("/", { replace: true });
      clearJustLoggedOut();
    }
  }, [justLoggedOut, navigate, clearJustLoggedOut]);

  if (site.maintenanceEnabled && !isAdmin) {
    return (
      <MaintenanceShell
        title={site.maintenanceTitle}
        message={site.maintenanceMessage}
      />
    );
  }

  return (
    <>
      <header className={`header ${useOverlayHeader ? "header-overlay" : ""}`}>
        <div className="header-inner">
          <Logo />
          <PublicNav
            loading={loading}
            user={user}
            isAdmin={isAdmin}
            allowSignup={features.signupEnabled}
            onLogin={handleLoginOpen}
            onSignup={features.signupEnabled ? handleSignupOpen : undefined}
            onViewProfile={handleViewProfile}
            onAdmin={isAdmin ? handleAdminOpen : undefined}
            onLogout={handleLogout}
          />

          <div className="header-actions">
            {loading && (
              <button className="header-profile-button" disabled>
                <Avatar loading />
              </button>
            )}

            {!loading && !user && (
              <button className="header-auth-button" onClick={handleLoginOpen}>
                Login
              </button>
            )}

            {!loading && user && (
              <ProfileDropdown
                trigger={
                  <button className="header-profile-button">
                    <Avatar name={user.displayName || user.email} />
                  </button>
                }
                onViewProfile={handleViewProfile}
                onAdmin={isAdmin ? handleAdminOpen : undefined}
                onLogout={handleLogout}
              />
            )}
          </div>
        </div>
      </header>

      <Outlet />

      {authModal === "login" && (
        <LoginModal
          onClose={() => setAuthModal(null)}
          onSignup={features.signupEnabled ? () => setAuthModal("signup") : undefined}
          allowSignup={features.signupEnabled}
        />
      )}

      {authModal === "signup" && features.signupEnabled && (
        <SignupModal
          onClose={() => setAuthModal(null)}
          onLogin={() => setAuthModal("login")}
        />
      )}
      {showChatbot && features.aiChatEnabled && <Chatbot />}
    </>
  );
}
