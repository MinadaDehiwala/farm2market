import { Link } from "react-router-dom";

import "../../styles/maintenance-shell.css";

export default function MaintenanceShell({
  title,
  message,
  showAdminLink = true,
}) {
  return (
    <div className="maintenance-shell">
      <div className="maintenance-orbit maintenance-orbit-a" aria-hidden="true" />
      <div className="maintenance-orbit maintenance-orbit-b" aria-hidden="true" />

      <section className="maintenance-card">
        <p className="maintenance-eyebrow">Control Lock</p>
        <h1>{title}</h1>
        <p>{message}</p>

        {showAdminLink && (
          <div className="maintenance-actions">
            <Link className="maintenance-link" to="/admin">
              Open Admin Control Center
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
