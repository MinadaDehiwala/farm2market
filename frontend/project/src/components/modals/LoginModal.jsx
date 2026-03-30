import "../../styles/loginsignup.css";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../js/firebase";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useState } from "react";

export default function LoginModal({ onClose, onSignup, allowSignup = true }) {
  const navigate = useNavigate();
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    const form = e.target;
    const email = form.email.value;
    const password = form.password.value;

    try {
      const { user } = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        toast.error("User profile not found");
        return;
      }

      const { role, accountStatus } = snap.data();

      if (accountStatus === "disabled") {
        toast.error("This account has been disabled by an admin");
        return;
      }

      if (role === "farmer") {
        navigate("/dashboard/farmer", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }

      toast.success("Login successful");
      onClose();
    } catch {
      toast.error("Invalid email or password");
    }
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();

    if (!resetEmail) {
      toast.error("Email is required");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, resetEmail);
      toast.success("Password reset email sent");
      setShowReset(false);
      setResetEmail("");
    } catch {
      toast.error("Failed to send reset email");
    }
  };

  return (
    <>
      <div className="auth-overlay show" onClick={onClose}>
        <div className="login-container" onClick={(e) => e.stopPropagation()}>
          <div className="login-card">
            <div className="login-header">
              <h2>Hello, Welcome Back</h2>
              <p>Login to manage your account.</p>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <div className="input-wrapper">
                  <input name="email" type="email" required />
                  <label>Email</label>
                </div>
              </div>

              <div className="form-group">
                <div className="input-wrapper">
                  <input name="password" type="password" required />
                  <label>Password</label>
                </div>
              </div>

              <div className="forgot-password">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowReset(true);
                  }}
                >
                  Forgot password?
                </a>
              </div>

              <button className="btn" type="submit">
                Login
              </button>
            </form>

            {allowSignup && typeof onSignup === "function" && (
              <div className="signup-link">
                <p>
                  Don&apos;t have an account?{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onSignup();
                    }}
                  >
                    Signup
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showReset && (
        <div className="auth-overlay show" onClick={() => setShowReset(false)}>
          <div
            className="login-container"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="login-card">
              <div className="login-header">
                <h2>Reset Password</h2>
                <p>Enter your email to receive reset link.</p>
              </div>

              <form className="login-form" onSubmit={handlePasswordReset}>
                <div className="form-group">
                  <div className="input-wrapper">
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                    />
                    <label>Email</label>
                  </div>
                </div>

                <button className="btn" type="submit">
                  Send Reset Email
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
