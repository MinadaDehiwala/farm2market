import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { toast } from "sonner";

import {
  archiveAdminEntity,
  fetchAdminAuditLog,
  fetchAdminOverview,
  searchAdminEntities,
  toAdminMessage,
  updateAdminEntity,
  updateAdminRuntimeConfig,
  verifyAdminAccess,
} from "../../js/adminApi";
import { auth } from "../../js/firebase";
import { mergeRuntimeConfig } from "../../js/runtime-config";
import { ORDER_STATUS_LABELS } from "../../js/orders";
import { useAuth } from "../../state/authStore";
import { useRuntimeConfig } from "../../state/runtimeConfigStore";

import "../../styles/admin.css";

const TABS = [
  { id: "system", label: "System" },
  { id: "users", label: "Users" },
  { id: "stocks", label: "Stocks" },
  { id: "orders", label: "Orders" },
  { id: "transport_requests", label: "Transport" },
];

const USER_ROLE_OPTIONS = ["buyer", "farmer", "transporter"];
const STOCK_TRANSPORT_OPTIONS = [
  "available",
  "reserved",
  "awaiting_transporter",
  "in_delivery",
  "delivered",
];
const TRANSPORT_STATUS_OPTIONS = [
  "open",
  "accepted",
  "paused",
  "completed",
  "cancelled",
];
const TRANSPORT_STAGE_OPTIONS = [
  "queued",
  "accepted",
  "paused",
  "resumed",
  "picked_up",
  "completed",
  "cancelled",
];
const ENTITY_SEARCH_LIMIT = 18;

function createSystemDraft(config) {
  return mergeRuntimeConfig(config);
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function patchItemField(items, id, field, value) {
  return items.map((item) =>
    item.id === id
      ? {
          ...item,
          [field]: value,
        }
      : item
  );
}

function SectionHeader({ title, body }) {
  return (
    <header className="admin-section-header">
      <div>
        <p className="admin-eyebrow">{title}</p>
        <h2>{body}</h2>
      </div>
    </header>
  );
}

function StatCard({ title, value, tone = "default", detail }) {
  return (
    <article className={`admin-stat-card ${tone}`}>
      <p>{title}</p>
      <h3>{value}</h3>
      <span>{detail}</span>
    </article>
  );
}

function EmptyState({ message }) {
  return <p className="admin-empty-state">{message}</p>;
}

export default function AdminControlCenter() {
  const { user, loading, isAdmin, logout, profile } = useAuth();
  const { config: liveConfig } = useRuntimeConfig();

  const [activeTab, setActiveTab] = useState("system");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [verifiedPassword, setVerifiedPassword] = useState("");

  const [unlocking, setUnlocking] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [panelLoading, setPanelLoading] = useState(false);
  const [systemSaving, setSystemSaving] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [systemDirty, setSystemDirty] = useState(false);

  const [overview, setOverview] = useState(null);
  const [auditItems, setAuditItems] = useState([]);
  const [queries, setQueries] = useState({
    users: "",
    stocks: "",
    orders: "",
    transport_requests: "",
  });
  const [sectionLoading, setSectionLoading] = useState({
    users: false,
    stocks: false,
    orders: false,
    transport_requests: false,
  });
  const [entities, setEntities] = useState({
    users: [],
    stocks: [],
    orders: [],
    transport_requests: [],
  });
  const [systemDraft, setSystemDraft] = useState(() =>
    createSystemDraft(liveConfig)
  );

  const hasVerifiedSession = Boolean(verifiedPassword);

  useEffect(() => {
    if (!systemDirty) {
      setSystemDraft(createSystemDraft(liveConfig));
    }
  }, [liveConfig, systemDirty]);

  const refreshAudit = async (secret = verifiedPassword) => {
    const audit = await fetchAdminAuditLog(secret, 18);
    setAuditItems(Array.isArray(audit.items) ? audit.items : []);
  };

  const refreshOverview = async (secret = verifiedPassword) => {
    const response = await fetchAdminOverview(secret);
    setOverview(response.overview || null);
    if (!systemDirty && response.runtimeConfig) {
      setSystemDraft(createSystemDraft(response.runtimeConfig));
    }
    if (Array.isArray(response.recentAudit) && response.recentAudit.length > 0) {
      setAuditItems(response.recentAudit);
    }
  };

  const loadEntitySection = async (entityType, secret = verifiedPassword) => {
    setSectionLoading((prev) => ({ ...prev, [entityType]: true }));

    try {
      const response = await searchAdminEntities(
        secret,
        entityType,
        queries[entityType],
        {
          limit: ENTITY_SEARCH_LIMIT,
          includeArchived: true,
        }
      );

      setEntities((prev) => ({
        ...prev,
        [entityType]: Array.isArray(response.items) ? response.items : [],
      }));
    } finally {
      setSectionLoading((prev) => ({ ...prev, [entityType]: false }));
    }
  };

  const loadAllPanels = async (secret) => {
    setPanelLoading(true);

    try {
      await Promise.all([
        refreshOverview(secret),
        refreshAudit(secret),
        loadEntitySection("users", secret),
        loadEntitySection("stocks", secret),
        loadEntitySection("orders", secret),
        loadEntitySection("transport_requests", secret),
      ]);
    } finally {
      setPanelLoading(false);
    }
  };

  const handleOwnerSignIn = async (event) => {
    event.preventDefault();
    if (loggingIn) return;

    try {
      setLoggingIn(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      toast.success("Owner account signed in.");
      setPassword("");
    } catch (error) {
      toast.error(toAdminMessage(error, "Unable to sign in as admin."));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleUnlock = async (event) => {
    event.preventDefault();
    if (unlocking) return;

    try {
      setUnlocking(true);
      await verifyAdminAccess(adminPassword);
      setVerifiedPassword(adminPassword);
      toast.success("Admin controls unlocked.");
      await loadAllPanels(adminPassword);
    } catch (error) {
      toast.error(toAdminMessage(error, "Unable to unlock admin controls."));
    } finally {
      setUnlocking(false);
    }
  };

  const handleSearchSubmit = async (event, entityType) => {
    event.preventDefault();
    try {
      await loadEntitySection(entityType);
    } catch (error) {
      toast.error(toAdminMessage(error, `Unable to load ${entityType}.`));
    }
  };

  const handleSystemToggle = (key, value) => {
    setSystemDirty(true);
    setSystemDraft((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        [key]: value,
      },
    }));
  };

  const handleSystemTextChange = (key, value) => {
    setSystemDirty(true);
    setSystemDraft((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        [key]: value,
      },
    }));
  };

  const handleSaveSystem = async () => {
    if (!hasVerifiedSession) return;

    try {
      setSystemSaving(true);
      const response = await updateAdminRuntimeConfig(
        verifiedPassword,
        systemDraft
      );
      if (response.runtimeConfig) {
        setSystemDraft(createSystemDraft(response.runtimeConfig));
      }
      setSystemDirty(false);
      await Promise.all([refreshOverview(), refreshAudit()]);
      toast.success("System controls updated.");
    } catch (error) {
      toast.error(toAdminMessage(error, "Unable to save system controls."));
    } finally {
      setSystemSaving(false);
    }
  };

  const handleItemField = (entityType, id, field, value) => {
    setEntities((prev) => ({
      ...prev,
      [entityType]: patchItemField(prev[entityType], id, field, value),
    }));
  };

  const handleSaveEntity = async (entityType, item) => {
    const actionKey = `${entityType}:${item.id}:save`;
    setBusyKey(actionKey);

    try {
      let updates = {};

      if (entityType === "users") {
        updates = {
          firstName: item.firstName || "",
          lastName: item.lastName || "",
          phone: item.phone || "",
          role: item.role,
          isAdmin: item.isAdmin === true,
          accountStatus: item.accountStatus || "active",
        };
      } else if (entityType === "stocks") {
        updates = {
          vegetable: item.vegetable || "",
          market: item.market || "",
          pickupLocation: item.pickupLocation || "",
          quality: item.quality || "",
          quantity: Number(item.quantity || 0),
          availableQtyKg: Number(item.availableQtyKg || 0),
          reservedQtyKg: Number(item.reservedQtyKg || 0),
          price: Number(item.price || 0),
          phone: item.phone || "",
          transportStatus: item.transportStatus || "available",
        };
      } else if (entityType === "orders") {
        updates = {
          status: item.status,
          transporterId: item.transporterId || null,
          market: item.market || "",
          requestedQtyKg: Number(item.requestedQtyKg || 0),
          pricePerKg: Number(item.pricePerKg || 0),
        };
      } else {
        updates = {
          status: item.status,
          deliveryStage: item.deliveryStage,
          transporterId: item.transporterId || null,
          requestedQtyKg: Number(item.requestedQtyKg || 0),
          pickupLocation: item.pickupLocation || "",
          market: item.market || "",
          phone: item.phone || "",
          vegetable: item.vegetable || "",
        };
      }

      const response = await updateAdminEntity(
        verifiedPassword,
        entityType,
        item.id,
        updates
      );

      setEntities((prev) => ({
        ...prev,
        [entityType]: prev[entityType].map((entry) =>
          entry.id === item.id ? response.item || entry : entry
        ),
      }));

      await Promise.all([refreshOverview(), refreshAudit()]);
      toast.success(`${labelize(entityType)} updated.`);
    } catch (error) {
      toast.error(toAdminMessage(error, `Unable to save ${entityType}.`));
    } finally {
      setBusyKey("");
    }
  };

  const handleArchiveToggle = async (entityType, item) => {
    const actionKey = `${entityType}:${item.id}:archive`;
    setBusyKey(actionKey);

    try {
      const response = await archiveAdminEntity(
        verifiedPassword,
        entityType,
        item.id,
        !item.archivedAt
      );

      setEntities((prev) => ({
        ...prev,
        [entityType]: prev[entityType].map((entry) =>
          entry.id === item.id ? response.item || entry : entry
        ),
      }));

      await Promise.all([refreshOverview(), refreshAudit()]);
      toast.success(item.archivedAt ? "Record restored." : "Record archived.");
    } catch (error) {
      toast.error(toAdminMessage(error, "Unable to update archive state."));
    } finally {
      setBusyKey("");
    }
  };

  const headlineStats = useMemo(() => {
    if (!overview) {
      return [
        { title: "Admins", value: "-", detail: "Loading owner state" },
        { title: "Users", value: "-", detail: "Loading account state" },
        { title: "Orders", value: "-", detail: "Loading live operations" },
        { title: "Maintenance", value: "-", detail: "Loading platform mode" },
      ];
    }

    return [
      {
        title: "Admins",
        value: overview.users?.admins ?? 0,
        detail: `${overview.users?.disabled ?? 0} disabled accounts`,
      },
      {
        title: "Users",
        value: overview.users?.total ?? 0,
        detail: "Profiles in the workspace",
      },
      {
        title: "Orders",
        value: overview.orders?.total ?? 0,
        detail: `${overview.orders?.archived ?? 0} archived`,
      },
      {
        title: "Maintenance",
        value: systemDraft.site.maintenanceEnabled ? "On" : "Off",
        detail: systemDraft.site.maintenanceEnabled
          ? "Public routes are paused"
          : "Platform is live",
      },
    ];
  }, [overview, systemDraft.site.maintenanceEnabled]);

  if (loading) {
    return (
      <div className="admin-shell">
        <div className="admin-auth-card">
          <p className="admin-eyebrow">Admin Control Center</p>
          <h1>Loading owner session...</h1>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin-shell">
        <div className="admin-auth-card">
          <p className="admin-eyebrow">Admin Control Center</p>
          <h1>Sign in as the owner</h1>
          <p>
            This route stays available even during maintenance mode so the owner
            can recover the platform, update live switches, and manage records.
          </p>

          <form className="admin-auth-form" onSubmit={handleOwnerSignIn}>
            <label>
              Owner email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="owner@farm2market.lk"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your account password"
                required
              />
            </label>

            <button className="admin-primary-btn" type="submit" disabled={loggingIn}>
              {loggingIn ? "Signing In..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="admin-shell">
        <div className="admin-auth-card">
          <p className="admin-eyebrow">Restricted Route</p>
          <h1>This account is not an admin</h1>
          <p>
            You are signed in as {profile?.email || user.email}, but this control
            center is limited to accounts flagged with admin access.
          </p>

          <div className="admin-inline-actions">
            <button className="admin-primary-btn" onClick={logout}>
              Sign Out
            </button>
            <Link className="admin-secondary-link" to="/">
              Return Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!hasVerifiedSession) {
    return (
      <div className="admin-shell">
        <div className="admin-auth-card">
          <p className="admin-eyebrow">Second Step</p>
          <h1>Unlock sensitive controls</h1>
          <p>
            Signed in as {profile?.email || user.email}. Enter the admin control
            password to open live switches, mutation tools, and audit history.
          </p>

          <form className="admin-auth-form" onSubmit={handleUnlock}>
            <label>
              Admin password
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="Enter the admin control password"
                required
              />
            </label>

            <button className="admin-primary-btn" type="submit" disabled={unlocking}>
              {unlocking ? "Unlocking..." : "Unlock Control Center"}
            </button>
          </form>

          <div className="admin-inline-actions">
            <button className="admin-ghost-btn" onClick={logout}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderSystemSection = () => (
    <section className="admin-panel">
      <SectionHeader
        title="System"
        body="Live runtime switches"
      />

      <div className="admin-toggle-grid">
        {[
          ["aiChatEnabled", "AI Chat"],
          ["orderThreadsEnabled", "Order Threads"],
          ["predictionsEnabled", "Predictions"],
          ["signupEnabled", "Signup"],
          ["contactFormEnabled", "Contact Form"],
        ].map(([key, label]) => (
          <label key={key} className="admin-toggle-card">
            <div>
              <strong>{label}</strong>
              <span>
                {systemDraft.features[key] ? "Live for users now" : "Disabled now"}
              </span>
            </div>
            <input
              type="checkbox"
              checked={systemDraft.features[key]}
              onChange={(event) => handleSystemToggle(key, event.target.checked)}
            />
          </label>
        ))}
      </div>

      <div className="admin-maintenance-card">
        <div className="admin-maintenance-head">
          <div>
            <p className="admin-eyebrow">Maintenance Mode</p>
            <h3>Platform access kill switch</h3>
          </div>

          <label className="admin-switch">
            <input
              type="checkbox"
              checked={systemDraft.site.maintenanceEnabled}
              onChange={(event) =>
                handleSystemTextChange("maintenanceEnabled", event.target.checked)
              }
            />
            <span>{systemDraft.site.maintenanceEnabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>

        <div className="admin-form-grid two-col">
          <label>
            Maintenance title
            <input
              type="text"
              value={systemDraft.site.maintenanceTitle}
              onChange={(event) =>
                handleSystemTextChange("maintenanceTitle", event.target.value)
              }
            />
          </label>

          <label>
            Updated
            <input
              type="text"
              value={formatDateTime(systemDraft.updatedAt)}
              readOnly
            />
          </label>

          <label className="wide">
            Maintenance message
            <textarea
              rows="4"
              value={systemDraft.site.maintenanceMessage}
              onChange={(event) =>
                handleSystemTextChange("maintenanceMessage", event.target.value)
              }
            />
          </label>
        </div>

        <div className="admin-sticky-actions">
          <button
            className="admin-primary-btn"
            onClick={handleSaveSystem}
            disabled={systemSaving || !systemDirty}
          >
            {systemSaving ? "Saving..." : "Save System Controls"}
          </button>
        </div>
      </div>
    </section>
  );

  const renderUserSection = () => (
    <section className="admin-panel">
      <SectionHeader title="Users" body="Search, promote, disable, and recover accounts" />

      <form className="admin-toolbar" onSubmit={(event) => handleSearchSubmit(event, "users")}>
        <input
          type="search"
          value={queries.users}
          onChange={(event) =>
            setQueries((prev) => ({ ...prev, users: event.target.value }))
          }
          placeholder="Search by name, email, role, or status"
        />
        <button className="admin-primary-btn" type="submit" disabled={sectionLoading.users}>
          {sectionLoading.users ? "Searching..." : "Search Users"}
        </button>
      </form>

      {entities.users.length === 0 && !sectionLoading.users && (
        <EmptyState message="No matching users yet." />
      )}

      <div className="admin-entity-list">
        {entities.users.map((item) => (
          <article key={item.id} className="admin-entity-card">
            <div className="admin-entity-head">
              <div>
                <h3>
                  {`${item.firstName || ""} ${item.lastName || ""}`.trim() || "Unnamed user"}
                </h3>
                <p>{item.email || item.id}</p>
              </div>
              <span className={`admin-badge ${item.accountStatus || "active"}`}>
                {labelize(item.accountStatus || "active")}
              </span>
            </div>

            <div className="admin-form-grid">
              <label>
                First name
                <input
                  type="text"
                  value={item.firstName || ""}
                  onChange={(event) =>
                    handleItemField("users", item.id, "firstName", event.target.value)
                  }
                />
              </label>

              <label>
                Last name
                <input
                  type="text"
                  value={item.lastName || ""}
                  onChange={(event) =>
                    handleItemField("users", item.id, "lastName", event.target.value)
                  }
                />
              </label>

              <label>
                Phone
                <input
                  type="text"
                  value={item.phone || ""}
                  onChange={(event) =>
                    handleItemField("users", item.id, "phone", event.target.value)
                  }
                />
              </label>

              <label>
                Role
                <select
                  value={item.role || "buyer"}
                  onChange={(event) =>
                    handleItemField("users", item.id, "role", event.target.value)
                  }
                >
                  {USER_ROLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {labelize(option)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Account status
                <select
                  value={item.accountStatus || "active"}
                  onChange={(event) =>
                    handleItemField("users", item.id, "accountStatus", event.target.value)
                  }
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>

              <label className="admin-checkbox-field">
                <span>Admin access</span>
                <input
                  type="checkbox"
                  checked={item.isAdmin === true}
                  onChange={(event) =>
                    handleItemField("users", item.id, "isAdmin", event.target.checked)
                  }
                />
              </label>
            </div>

            <div className="admin-card-meta">
              <span>ID: {item.id}</span>
              <span>Created: {formatDateTime(item.createdAt)}</span>
            </div>

            <div className="admin-card-actions">
              <button
                className="admin-primary-btn"
                onClick={() => handleSaveEntity("users", item)}
                disabled={busyKey === `users:${item.id}:save`}
              >
                {busyKey === `users:${item.id}:save` ? "Saving..." : "Save User"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const renderStocksSection = () => (
    <section className="admin-panel">
      <SectionHeader title="Stocks" body="Tune operational inventory without leaving the console" />

      <form className="admin-toolbar" onSubmit={(event) => handleSearchSubmit(event, "stocks")}>
        <input
          type="search"
          value={queries.stocks}
          onChange={(event) =>
            setQueries((prev) => ({ ...prev, stocks: event.target.value }))
          }
          placeholder="Search by vegetable, market, farmer, phone, or status"
        />
        <button className="admin-primary-btn" type="submit" disabled={sectionLoading.stocks}>
          {sectionLoading.stocks ? "Searching..." : "Search Stocks"}
        </button>
      </form>

      {entities.stocks.length === 0 && !sectionLoading.stocks && (
        <EmptyState message="No matching stock records yet." />
      )}

      <div className="admin-entity-list">
        {entities.stocks.map((item) => (
          <article key={item.id} className="admin-entity-card">
            <div className="admin-entity-head">
              <div>
                <h3>{item.vegetable || "Unknown produce"}</h3>
                <p>{item.market || "No market"} · Farmer {item.farmerId || "-"}</p>
              </div>
              <span className={`admin-badge ${item.archivedAt ? "archived" : "live"}`}>
                {item.archivedAt ? "Archived" : "Live"}
              </span>
            </div>

            <div className="admin-form-grid">
              <label>
                Vegetable
                <input
                  type="text"
                  value={item.vegetable || ""}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "vegetable", event.target.value)
                  }
                />
              </label>

              <label>
                Market
                <input
                  type="text"
                  value={item.market || ""}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "market", event.target.value)
                  }
                />
              </label>

              <label>
                Quantity
                <input
                  type="number"
                  min="0"
                  value={item.quantity ?? 0}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "quantity", event.target.value)
                  }
                />
              </label>

              <label>
                Available
                <input
                  type="number"
                  min="0"
                  value={item.availableQtyKg ?? 0}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "availableQtyKg", event.target.value)
                  }
                />
              </label>

              <label>
                Reserved
                <input
                  type="number"
                  min="0"
                  value={item.reservedQtyKg ?? 0}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "reservedQtyKg", event.target.value)
                  }
                />
              </label>

              <label>
                Price
                <input
                  type="number"
                  min="0"
                  value={item.price ?? 0}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "price", event.target.value)
                  }
                />
              </label>

              <label>
                Pickup location
                <input
                  type="text"
                  value={item.pickupLocation || ""}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "pickupLocation", event.target.value)
                  }
                />
              </label>

              <label>
                Phone
                <input
                  type="text"
                  value={item.phone || ""}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "phone", event.target.value)
                  }
                />
              </label>

              <label>
                Quality
                <input
                  type="text"
                  value={item.quality || ""}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "quality", event.target.value)
                  }
                />
              </label>

              <label>
                Transport status
                <select
                  value={item.transportStatus || "available"}
                  onChange={(event) =>
                    handleItemField("stocks", item.id, "transportStatus", event.target.value)
                  }
                >
                  {STOCK_TRANSPORT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {labelize(option)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="admin-card-meta">
              <span>ID: {item.id}</span>
              <span>Updated: {formatDateTime(item.updatedAt || item.createdAt)}</span>
            </div>

            <div className="admin-card-actions">
              <button
                className="admin-primary-btn"
                onClick={() => handleSaveEntity("stocks", item)}
                disabled={busyKey === `stocks:${item.id}:save`}
              >
                {busyKey === `stocks:${item.id}:save` ? "Saving..." : "Save Stock"}
              </button>
              <button
                className="admin-ghost-btn"
                onClick={() => handleArchiveToggle("stocks", item)}
                disabled={busyKey === `stocks:${item.id}:archive`}
              >
                {busyKey === `stocks:${item.id}:archive`
                  ? "Updating..."
                  : item.archivedAt
                  ? "Restore"
                  : "Archive"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const renderOrdersSection = () => (
    <section className="admin-panel">
      <SectionHeader title="Orders" body="Override delivery flow, pricing, and assignment state" />

      <form className="admin-toolbar" onSubmit={(event) => handleSearchSubmit(event, "orders")}>
        <input
          type="search"
          value={queries.orders}
          onChange={(event) =>
            setQueries((prev) => ({ ...prev, orders: event.target.value }))
          }
          placeholder="Search by order id, market, buyer, farmer, or status"
        />
        <button className="admin-primary-btn" type="submit" disabled={sectionLoading.orders}>
          {sectionLoading.orders ? "Searching..." : "Search Orders"}
        </button>
      </form>

      {entities.orders.length === 0 && !sectionLoading.orders && (
        <EmptyState message="No matching orders yet." />
      )}

      <div className="admin-entity-list">
        {entities.orders.map((item) => (
          <article key={item.id} className="admin-entity-card">
            <div className="admin-entity-head">
              <div>
                <h3>Order {item.id.slice(0, 8).toUpperCase()}</h3>
                <p>
                  Buyer {item.buyerId || "-"} · Farmer {item.farmerId || "-"}
                </p>
              </div>
              <span className={`admin-badge ${item.archivedAt ? "archived" : "live"}`}>
                {item.archivedAt ? "Archived" : ORDER_STATUS_LABELS[item.status] || labelize(item.status)}
              </span>
            </div>

            <div className="admin-form-grid">
              <label>
                Status
                <select
                  value={item.status || "requested"}
                  onChange={(event) =>
                    handleItemField("orders", item.id, "status", event.target.value)
                  }
                >
                  {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Transporter ID
                <input
                  type="text"
                  value={item.transporterId || ""}
                  onChange={(event) =>
                    handleItemField("orders", item.id, "transporterId", event.target.value)
                  }
                />
              </label>

              <label>
                Market
                <input
                  type="text"
                  value={item.market || ""}
                  onChange={(event) =>
                    handleItemField("orders", item.id, "market", event.target.value)
                  }
                />
              </label>

              <label>
                Requested quantity
                <input
                  type="number"
                  min="1"
                  value={item.requestedQtyKg ?? 1}
                  onChange={(event) =>
                    handleItemField("orders", item.id, "requestedQtyKg", event.target.value)
                  }
                />
              </label>

              <label>
                Price per kg
                <input
                  type="number"
                  min="0"
                  value={item.pricePerKg ?? 0}
                  onChange={(event) =>
                    handleItemField("orders", item.id, "pricePerKg", event.target.value)
                  }
                />
              </label>

              <label>
                Reservation expires
                <input type="text" value={formatDateTime(item.reservationExpiresAt)} readOnly />
              </label>
            </div>

            <div className="admin-card-meta">
              <span>Stock: {item.stockId || "-"}</span>
              <span>Created: {formatDateTime(item.createdAt)}</span>
            </div>

            <div className="admin-card-actions">
              <button
                className="admin-primary-btn"
                onClick={() => handleSaveEntity("orders", item)}
                disabled={busyKey === `orders:${item.id}:save`}
              >
                {busyKey === `orders:${item.id}:save` ? "Saving..." : "Save Order"}
              </button>
              <button
                className="admin-ghost-btn"
                onClick={() => handleArchiveToggle("orders", item)}
                disabled={busyKey === `orders:${item.id}:archive`}
              >
                {busyKey === `orders:${item.id}:archive`
                  ? "Updating..."
                  : item.archivedAt
                  ? "Restore"
                  : "Archive"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const renderTransportSection = () => (
    <section className="admin-panel">
      <SectionHeader title="Transport" body="Manage transport jobs, stages, and assignments" />

      <form
        className="admin-toolbar"
        onSubmit={(event) => handleSearchSubmit(event, "transport_requests")}
      >
        <input
          type="search"
          value={queries.transport_requests}
          onChange={(event) =>
            setQueries((prev) => ({
              ...prev,
              transport_requests: event.target.value,
            }))
          }
          placeholder="Search by transport id, order id, market, or transporter"
        />
        <button
          className="admin-primary-btn"
          type="submit"
          disabled={sectionLoading.transport_requests}
        >
          {sectionLoading.transport_requests ? "Searching..." : "Search Transport"}
        </button>
      </form>

      {entities.transport_requests.length === 0 &&
        !sectionLoading.transport_requests && (
          <EmptyState message="No matching transport jobs yet." />
        )}

      <div className="admin-entity-list">
        {entities.transport_requests.map((item) => (
          <article key={item.id} className="admin-entity-card">
            <div className="admin-entity-head">
              <div>
                <h3>Transport {item.id.slice(0, 8).toUpperCase()}</h3>
                <p>Order {item.orderId || "-"} · Stock {item.stockId || "-"}</p>
              </div>
              <span className={`admin-badge ${item.archivedAt ? "archived" : "live"}`}>
                {item.archivedAt ? "Archived" : labelize(item.status || "open")}
              </span>
            </div>

            <div className="admin-form-grid">
              <label>
                Status
                <select
                  value={item.status || "open"}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "status",
                      event.target.value
                    )
                  }
                >
                  {TRANSPORT_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {labelize(option)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Delivery stage
                <select
                  value={item.deliveryStage || "queued"}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "deliveryStage",
                      event.target.value
                    )
                  }
                >
                  {TRANSPORT_STAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {labelize(option)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Transporter ID
                <input
                  type="text"
                  value={item.transporterId || ""}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "transporterId",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Requested quantity
                <input
                  type="number"
                  min="1"
                  value={item.requestedQtyKg ?? 1}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "requestedQtyKg",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Pickup location
                <input
                  type="text"
                  value={item.pickupLocation || ""}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "pickupLocation",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Market
                <input
                  type="text"
                  value={item.market || ""}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "market",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Phone
                <input
                  type="text"
                  value={item.phone || ""}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "phone",
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Vegetable
                <input
                  type="text"
                  value={item.vegetable || ""}
                  onChange={(event) =>
                    handleItemField(
                      "transport_requests",
                      item.id,
                      "vegetable",
                      event.target.value
                    )
                  }
                />
              </label>
            </div>

            <div className="admin-card-meta">
              <span>Buyer: {item.buyerId || "-"}</span>
              <span>Farmer: {item.farmerId || "-"}</span>
            </div>

            <div className="admin-card-actions">
              <button
                className="admin-primary-btn"
                onClick={() => handleSaveEntity("transport_requests", item)}
                disabled={busyKey === `transport_requests:${item.id}:save`}
              >
                {busyKey === `transport_requests:${item.id}:save`
                  ? "Saving..."
                  : "Save Transport"}
              </button>
              <button
                className="admin-ghost-btn"
                onClick={() => handleArchiveToggle("transport_requests", item)}
                disabled={busyKey === `transport_requests:${item.id}:archive`}
              >
                {busyKey === `transport_requests:${item.id}:archive`
                  ? "Updating..."
                  : item.archivedAt
                  ? "Restore"
                  : "Archive"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const activePanel = {
    system: renderSystemSection(),
    users: renderUserSection(),
    stocks: renderStocksSection(),
    orders: renderOrdersSection(),
    transport_requests: renderTransportSection(),
  }[activeTab];

  return (
    <div className="admin-page">
      <div className="admin-glow admin-glow-a" aria-hidden="true" />
      <div className="admin-glow admin-glow-b" aria-hidden="true" />

      <header className="admin-hero">
        <div className="admin-hero-copy">
          <p className="admin-eyebrow">Farm2Market Command Deck</p>
          <h1>Admin Control Center</h1>
          <p>
            Runtime switches, live support overrides, transactional recovery, and
            the audit stream all in one route.
          </p>
        </div>

        <div className="admin-hero-actions">
          <button className="admin-ghost-btn" onClick={() => loadAllPanels(verifiedPassword)}>
            {panelLoading ? "Refreshing..." : "Refresh All"}
          </button>
          <button
            className="admin-primary-btn"
            onClick={async () => {
              setVerifiedPassword("");
              setAdminPassword("");
              toast.success("Admin controls locked.");
            }}
          >
            Lock Controls
          </button>
          <button className="admin-ghost-btn" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <section className="admin-stats-grid">
        {headlineStats.map((card, index) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            detail={card.detail}
            tone={index === 3 && systemDraft.site.maintenanceEnabled ? "danger" : "default"}
          />
        ))}
      </section>

      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="admin-workspace">
        <div className="admin-main-column">{activePanel}</div>

        <aside className="admin-audit-rail">
          <SectionHeader title="Audit" body="Recent admin changes" />

          {auditItems.length === 0 ? (
            <EmptyState message="No audit entries yet." />
          ) : (
            <div className="admin-audit-list">
              {auditItems.map((item) => (
                <article key={item.id} className="admin-audit-card">
                  <div className="admin-audit-head">
                    <strong>{labelize(item.action || "update")}</strong>
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                  <p>
                    {labelize(item.entityType || "entity")} · {item.entityId || item.id}
                  </p>
                  <p className="admin-audit-actor">
                    Actor: {item.actorId || "Unknown"}
                  </p>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
