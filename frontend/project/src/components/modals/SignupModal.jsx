import "../../styles/loginsignup.css";
import { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../js/firebase";
import { toast } from "sonner";
import { useRuntimeConfig } from "../../state/runtimeConfigStore";

/* =========================
   HELPERS
========================= */

// retry helper for safe operations
async function retry(fn, retries = 3, delay = 500) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
  throw lastError;
}

// firebase error → user message
function firebaseErrorMessage(err) {
  if (!err || !err.code) {
    return "Something went wrong. Please try again.";
  }

  switch (err.code) {
    case "auth/email-already-in-use":
      return "This email is already registered";
    case "auth/invalid-email":
      return "Invalid email address";
    case "auth/weak-password":
      return "Password is too weak";
    case "auth/network-request-failed":
      return "Network error. Check your connection";
    case "permission-denied":
      return "Permission denied. Please contact support";
    default:
      return err.message || "Signup failed";
  }
}

export default function SignupModal({ onClose, onLogin }) {
  const [loading, setLoading] = useState(false);
  const { features } = useRuntimeConfig();

  // This is where signup happens. We break it into 3 parts:
  // 1) AUTH - create user in Firebase Auth (no retry, critical)
  // 2) PROFILE - update display name (non-critical, best effort)
  // 3) FIRESTORE - create user doc (retry safe, critical for app functionality)
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    if (!features.signupEnabled) {
      toast.error("Signup is currently disabled.");
      return;
    }

    const form = e.target;
    const firstName = form.firstName.value.trim();
    const lastName = form.lastName.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const role = form.role.value;
    const phone = form.phone.value.trim();

    if (!firstName || !lastName || !email || !password || !role || !phone) {
      toast.error("All fields are required");
      return;
    }

    setLoading(true);
    let user;

    /* =========================
       AUTH (NO RETRY)
    ========================== */
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      user = cred.user;
    } catch (err) {
      toast.error(firebaseErrorMessage(err));
      setLoading(false);
      return;
    }

    /* =========================
       PROFILE (NON-CRITICAL)
    ========================== */
    try {
      await updateProfile(user, {
        displayName: `${firstName} ${lastName}`,
      });
    } catch (err) {
      console.warn("Profile update failed", err);
    }

    /* =========================
       FIRESTORE (RETRY SAFE)
    ========================== */
    try {
      await retry(() =>
        setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          firstName,
          lastName,
          email: user.email,
          phone,
          role,
          isAdmin: false,
          accountStatus: "active",
          avatarUrl: "",
          avgResponseMin: role === "farmer" ? 10 : role === "transporter" ? 12 : 8,
          completedDeliveries: 0,
          lastSeenAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        })
      );
    } catch (err) {
      toast.error(firebaseErrorMessage(err));
      setLoading(false);
      return;
    }

    /* =========================
       UI (ISOLATED)
    ========================== */
    try {
      toast.success("Account created successfully");
      onClose();
    } catch (err) {
      console.error("UI cleanup error", err);
    }

    setLoading(false);
  };

  return (
    <div className="auth-overlay show" onClick={onClose}>
      <div className="login-container" onClick={(e) => e.stopPropagation()}>
        <div className="login-card">
          <div className="login-header">
            <h2>Create an Account</h2>
            <p>Select your role carefully</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <div className="input-wrapper">
                <input name="firstName" type="text" required />
                <label>First Name</label>
              </div>
            </div>

            <div className="form-group">
              <div className="input-wrapper">
                <input name="lastName" type="text" required />
                <label>Last Name</label>
              </div>
            </div>

            <div className="form-group">
              <div className="input-wrapper">
                <input name="email" type="email" required />
                <label>Email</label>
              </div>
            </div>

            <div className="form-group">
              <div className="input-wrapper">
                <input name="phone" type="tel" required />
                <label>Phone Number</label>
              </div>
            </div>

            <div className="form-group">
              <div className="input-wrapper">
                <input name="password" type="password" required />
                <label>Password</label>
              </div>
            </div>

            <div className="form-group">
              <div className="input-wrapper">
                <select name="role" defaultValue="" required>
                  <option value="" disabled>
                    Select role
                  </option>
                  <option value="farmer">Farmer</option>
                  <option value="buyer">Buyer</option>
                  <option value="transporter">Transporter</option>
                </select>
                <label>Role</label>
              </div>
            </div>

            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Sign Up"}
            </button>
          </form>

          <div className="signup-link">
            <p>
              Already have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onLogin();
                }}
              >
                Login
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
