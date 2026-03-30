import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { db } from "../../../js/firebase";
import { useAuth } from "../../../state/authStore";
import { useRuntimeConfig } from "../../../state/runtimeConfigStore";
import { respondToOrder, toFirebaseCallableMessage } from "../../../js/orderThreadApi";
import { formatTimestamp, toOrderStatusLabel } from "../../../js/orders";

import "../../../styles/orders-dashboard.css";

export default function OrdersDashboard() {
  const { user, role } = useAuth();
  const { features } = useRuntimeConfig();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyOrderId, setBusyOrderId] = useState("");

  useEffect(() => {
    if (!features.orderThreadsEnabled || !user || !role) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let field = "buyerId";
    if (role === "farmer") field = "farmerId";
    if (role === "transporter") field = "transporterId";

    const q = query(
      collection(db, "orders"),
      where(field, "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setOrders(
          snap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .filter((order) => !order.archivedAt)
        );
        setLoading(false);
      },
      () => {
        setError("Unable to load orders.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [features.orderThreadsEnabled, role, user]);

  const handleRespond = async (orderId, action) => {
    try {
      setBusyOrderId(orderId);
      await respondToOrder({ orderId, action });
      toast.success(action === "accept" ? "Order accepted" : "Order rejected");
    } catch (err) {
      toast.error(
        toFirebaseCallableMessage(
          err,
          action === "accept" ? "Unable to accept order" : "Unable to reject order"
        )
      );
    } finally {
      setBusyOrderId("");
    }
  };

  if (!features.orderThreadsEnabled) {
    return (
      <div className="dashboard-container orders-dashboard">
        <p>Order threads are currently disabled by the admin.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container orders-dashboard">
      <header className="orders-header">
        <div>
          <h1 className="dashboard-title">Orders</h1>
          <p className="dashboard-subtitle">Track requests, delivery progress, and thread updates</p>
        </div>
      </header>

      <section className="orders-list-card liquid-glass">
        {loading && <p>Loading orders...</p>}
        {!loading && error && <p className="orders-empty">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <p className="orders-empty">No orders found yet.</p>
        )}

        {!loading && !error && orders.length > 0 && (
          <div className="orders-list">
            {orders.map((order) => (
              <div key={order.id} className="order-item">
                <div>
                  <p className="order-title">Order #{order.id.slice(0, 8).toUpperCase()}</p>
                  <p className="order-meta">
                    {toOrderStatusLabel(order.status)} · {order.requestedQtyKg || "-"} kg · {order.market || "-"}
                  </p>
                  <p className="order-time">Created: {formatTimestamp(order.createdAt)}</p>
                </div>

                <div className="order-actions">
                  {role === "farmer" && order.status === "requested" && (
                    <>
                      <button
                        className="btn green"
                        disabled={busyOrderId === order.id}
                        onClick={() => handleRespond(order.id, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        className="btn red"
                        disabled={busyOrderId === order.id}
                        onClick={() => handleRespond(order.id, "reject")}
                      >
                        Reject
                      </button>
                    </>
                  )}

                  <button
                    className="btn"
                    onClick={() => navigate(`/dashboard/orders/${order.id}`)}
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
