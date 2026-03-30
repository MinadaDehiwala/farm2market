import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "../../../js/firebase";
import { useAuth } from "../../../state/authStore";
import { useRuntimeConfig } from "../../../state/runtimeConfigStore";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { respondToOrder, toFirebaseCallableMessage } from "../../../js/orderThreadApi";
import { toOrderStatusLabel } from "../../../js/orders";

import "../../../styles/farmer-dashboard.css";

const toModelKey = (value) =>
  (value || "")
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

export default function FarmerDashboard() {
  const { user } = useAuth();
  const { features } = useRuntimeConfig();
  const navigate = useNavigate();

  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [incomingOrders, setIncomingOrders] = useState([]);
  const [busyOrderId, setBusyOrderId] = useState("");

  /* ================= REALTIME STOCKS ================= */
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const q = query(
      collection(db, "stocks"),
      where("farmerId", "==", user.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })).filter((stock) => !stock.archivedAt);
        setStocks(data);
        setLoading(false);
      },
      () => {
        setError("Unable to load your stock listings.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!features.orderThreadsEnabled || !user) {
      setIncomingOrders([]);
      return;
    }

    const q = query(
      collection(db, "orders"),
      where("farmerId", "==", user.uid),
      where("status", "==", "requested"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setIncomingOrders(
          snap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .filter((order) => !order.archivedAt)
        );
      },
      () => {
        setIncomingOrders([]);
      }
    );

    return () => unsub();
  }, [features.orderThreadsEnabled, user]);

  const totalQuantity = stocks.reduce(
    (sum, s) => sum + Number(s.quantity || 0),
    0
  );

  const marketsCovered = new Set(stocks.map((s) => s.market)).size;

  const goToPrediction = (veg, market) => {
    if (!features.predictionsEnabled) return;
    navigate(
      `/dashboard/predictions?veg=${encodeURIComponent(
        toModelKey(veg)
      )}&market=${encodeURIComponent(toModelKey(market))}`
    );
  };

  const handleOrderResponse = async (orderId, action) => {
    try {
      setBusyOrderId(orderId);
      await respondToOrder({ orderId, action });
      toast.success(action === "accept" ? "Order accepted" : "Order rejected");
    } catch (err) {
      toast.error(toFirebaseCallableMessage(err, "Unable to update order"));
    } finally {
      setBusyOrderId("");
    }
  };

  return (
    <div className="dashboard-container farmer-dashboard">
      {/* ================= HEADER ================= */}
      <div className="farmer-header">
        <div>
          <h1 className="dashboard-title">Farmer Dashboard</h1>
          <p className="dashboard-subtitle">
            Manage your stock and track your market presence
          </p>
        </div>

        <button
          className="btn secondary"
          onClick={() => navigate("/")}
        >
          ← Home
        </button>
      </div>

      {/* ================= STATS ================= */}
      <div className="farmer-stats">
        <div className="farmer-stat-card liquid-glass">
          <h3>{stocks.length}</h3>
          <p>Active Listings</p>
        </div>

        <div className="farmer-stat-card liquid-glass">
          <h3>{totalQuantity} kg</h3>
          <p>Total Quantity</p>
        </div>

        <div className="farmer-stat-card liquid-glass">
          <h3>{marketsCovered}</h3>
          <p>Markets Covered</p>
        </div>
      </div>

      {features.orderThreadsEnabled && (
        <div className="farmer-table-card liquid-glass">
          <div className="farmer-table-header">
            <h2>Incoming Order Requests</h2>
          </div>

          {incomingOrders.length === 0 && (
            <p className="farmer-empty">No pending order requests.</p>
          )}

          {incomingOrders.length > 0 && (
            <div className="farmer-table-wrapper">
              <table className="farmer-stock-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Quantity</th>
                    <th>Market</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {incomingOrders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.id.slice(0, 8).toUpperCase()}</td>
                      <td>{order.requestedQtyKg || "-"} kg</td>
                      <td>{order.market || "-"}</td>
                      <td>{toOrderStatusLabel(order.status)}</td>
                      <td>
                        <div className="order-action-group">
                          <button
                            className="btn green"
                            disabled={busyOrderId === order.id}
                            onClick={() => handleOrderResponse(order.id, "accept")}
                          >
                            Accept
                          </button>
                          <button
                            className="btn red"
                            disabled={busyOrderId === order.id}
                            onClick={() => handleOrderResponse(order.id, "reject")}
                          >
                            Reject
                          </button>
                          <button
                            className="btn"
                            onClick={() => navigate(`/dashboard/orders/${order.id}`)}
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ================= TABLE ================= */}
      <div className="farmer-table-card liquid-glass">
        <div className="farmer-table-header">
          <h2>Your Stock Listings</h2>

          <button
            className="btn"
            onClick={() => navigate("/dashboard/stock")}
          >
            + Submit Stock
          </button>
        </div>

        {loading && <p>Loading your stock…</p>}

        {!loading && error && (
          <p className="farmer-empty">{error}</p>
        )}

        {!loading && !error && stocks.length === 0 && (
          <p className="farmer-empty">
            No stock submitted yet
          </p>
        )}

        {!loading && !error && stocks.length > 0 && (
          <div className="farmer-table-wrapper">
            <table className="farmer-stock-table">
              <thead>
                <tr>
                  <th>Vegetable</th>
                  <th>Market</th>
                  <th>Pickup Location</th>
                  <th>Quality</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <tr
                    key={s.id}
                    className={features.predictionsEnabled ? "clickable-row" : ""}
                    onClick={() =>
                      features.predictionsEnabled
                        ? goToPrediction(s.vegetable, s.market)
                        : undefined
                    }
                    title={
                      features.predictionsEnabled
                        ? "View price prediction"
                        : "Predictions are disabled"
                    }
                  >
                    <td>{s.vegetable}</td>
                    <td>{s.market}</td>
                    <td>{s.pickupLocation || "-"}</td>
                    <td className={`quality ${s.quality}`}>
                      {s.quality || "-"}
                    </td>
                    <td>{s.quantity} kg</td>
                    <td>LKR {s.price}</td>
                    <td>
                      {s.createdAt?.toDate
                        ? s.createdAt
                            .toDate()
                            .toLocaleDateString()
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
