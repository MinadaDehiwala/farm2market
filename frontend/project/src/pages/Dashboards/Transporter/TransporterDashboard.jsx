import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

import { db } from "../../../js/firebase";
import { useAuth } from "../../../state/authStore";
import { useRuntimeConfig } from "../../../state/runtimeConfigStore";
import {
  claimTransportRequest,
  toFirebaseCallableMessage,
  updateDeliveryStatus,
} from "../../../js/orderThreadApi";
import { canRevealPhone, maskPhone } from "../../../js/orders";

import "../../../styles/transporter-dashboard.css";

export default function TransporterDashboard() {
  const { user } = useAuth();
  const { features } = useRuntimeConfig();
  const navigate = useNavigate();

  const [openJobs, setOpenJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [showContact, setShowContact] = useState(false);
  const [activeOrder, setActiveOrder] = useState(null);
  const [buyerProfile, setBuyerProfile] = useState(null);
  const [farmerProfile, setFarmerProfile] = useState(null);
  const [working, setWorking] = useState(false);

  /* ================= ACTIVE JOB ================= */
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "transport_requests"),
      where("transporterId", "==", user.uid),
      where("status", "in", ["accepted", "paused"])
    );

    return onSnapshot(q, (snap) => {
      let rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => !row.archivedAt);
      if (features.orderThreadsEnabled) {
        rows = rows.filter((row) => !!row.orderId);
      }

      setActiveJob(rows[0] || null);
    });
  }, [features.orderThreadsEnabled, user]);

  /* ================= OPEN JOBS ================= */
  useEffect(() => {
    if (!user || activeJob) {
      setOpenJobs([]);
      return;
    }

    const q = query(
      collection(db, "transport_requests"),
      where("status", "==", "open")
    );

    return onSnapshot(q, (snap) => {
      let rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => !row.archivedAt);
      if (features.orderThreadsEnabled) {
        rows = rows.filter((row) => !!row.orderId);
      }
      setOpenJobs(rows);
    });
  }, [features.orderThreadsEnabled, user, activeJob]);

  /* ================= COMPLETED JOBS ================= */
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "transport_requests"),
      where("transporterId", "==", user.uid),
      where("status", "==", "completed")
    );

    return onSnapshot(q, (snap) => {
      let rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => !row.archivedAt);
      if (features.orderThreadsEnabled) {
        rows = rows.filter((row) => !!row.orderId);
      }
      setCompletedJobs(rows);
    });
  }, [features.orderThreadsEnabled, user]);

  /* ================= LOAD ORDER CONTACT CONTEXT ================= */
  useEffect(() => {
    if (!activeJob?.orderId) {
      setActiveOrder(null);
      setBuyerProfile(null);
      setFarmerProfile(null);
      return;
    }

    let active = true;

    (async () => {
      const orderSnap = await getDoc(doc(db, "orders", activeJob.orderId));
      if (!orderSnap.exists() || !active) return;

      const order = { id: orderSnap.id, ...orderSnap.data() };
      setActiveOrder(order);

      const [buyerSnap, farmerSnap] = await Promise.all([
        order.buyerId ? getDoc(doc(db, "users", order.buyerId)) : Promise.resolve(null),
        order.farmerId ? getDoc(doc(db, "users", order.farmerId)) : Promise.resolve(null),
      ]);

      if (!active) return;

      setBuyerProfile(buyerSnap?.exists() ? buyerSnap.data() : null);
      setFarmerProfile(farmerSnap?.exists() ? farmerSnap.data() : null);
    })().catch(() => {
      if (!active) return;
      setActiveOrder(null);
      setBuyerProfile(null);
      setFarmerProfile(null);
    });

    return () => {
      active = false;
    };
  }, [activeJob?.orderId]);

  /* ================= ACTIONS ================= */

  const updateStatusLegacy = async (status) => {
    if (!activeJob) return;

    await runTransaction(db, async (tx) => {
      tx.update(doc(db, "transport_requests", activeJob.id), {
        status,
        updatedAt: serverTimestamp(),
      });
    });
  };

  const updateStatus = async (status) => {
    if (!activeJob) return;

    if (activeJob.orderId) {
      const mappedStatus = status === "accepted" ? "resumed" : status;
      try {
        setWorking(true);
        await updateDeliveryStatus({
          transportRequestId: activeJob.id,
          status: mappedStatus,
        });
      } catch (err) {
        toast.error(toFirebaseCallableMessage(err, "Unable to update status"));
      } finally {
        setWorking(false);
      }
      return;
    }

    try {
      setWorking(true);
      await updateStatusLegacy(status);
    } catch {
      toast.error("Unable to update status");
    } finally {
      setWorking(false);
    }
  };

  const acceptJobLegacy = async (jobId) => {
    const activeSnap = await getDocs(
      query(
        collection(db, "transport_requests"),
        where("transporterId", "==", user.uid),
        where("status", "in", ["accepted", "paused"])
      )
    );

    if (!activeSnap.empty) {
      alert("You already have an active delivery.");
      return;
    }

    await runTransaction(db, async (tx) => {
      const jobRef = doc(db, "transport_requests", jobId);
      const job = (await tx.get(jobRef)).data();

      const stockRef = doc(db, "stocks", job.stockId);
      const stock = (await tx.get(stockRef)).data();

      if (stock.transportStatus !== "available") {
        throw new Error("Stock already in delivery.");
      }

      tx.update(jobRef, {
        status: "accepted",
        transporterId: user.uid,
        updatedAt: serverTimestamp(),
      });

      tx.update(stockRef, { transportStatus: "in_delivery" });
    });
  };

  const acceptJob = async (job) => {
    if (job?.orderId) {
      try {
        setWorking(true);
        await claimTransportRequest({ transportRequestId: job.id });
      } catch (err) {
        toast.error(toFirebaseCallableMessage(err, "Unable to claim job"));
      } finally {
        setWorking(false);
      }
      return;
    }

    try {
      setWorking(true);
      await acceptJobLegacy(job.id);
    } catch {
      toast.error("Unable to accept job");
    } finally {
      setWorking(false);
    }
  };

  const completeJobLegacy = async () => {
    await runTransaction(db, async (tx) => {
      tx.update(doc(db, "transport_requests", activeJob.id), {
        status: "completed",
        updatedAt: serverTimestamp(),
      });

      tx.update(doc(db, "stocks", activeJob.stockId), {
        transportStatus: "delivered",
      });
    });
  };

  const completeJob = async () => {
    if (!activeJob) return;

    if (activeJob.orderId) {
      await updateStatus("completed");
      return;
    }

    try {
      setWorking(true);
      await completeJobLegacy();
    } catch {
      toast.error("Unable to complete job");
    } finally {
      setWorking(false);
    }
  };

  const cancelJobLegacy = async () => {
    await runTransaction(db, async (tx) => {
      tx.update(doc(db, "transport_requests", activeJob.id), {
        status: "open",
        transporterId: null,
        updatedAt: serverTimestamp(),
      });

      tx.update(doc(db, "stocks", activeJob.stockId), {
        transportStatus: "available",
      });
    });
  };

  const cancelJob = async () => {
    if (!activeJob) return;

    if (activeJob.orderId) {
      await updateStatus("cancelled");
      return;
    }

    try {
      setWorking(true);
      await cancelJobLegacy();
    } catch {
      toast.error("Unable to cancel job");
    } finally {
      setWorking(false);
    }
  };

  const mapUrl = `https://maps.google.com/maps?q=${encodeURIComponent(
    activeJob?.pickupLocation || "Sri Lanka"
  )}&z=10&output=embed`;

  const showPhone = canRevealPhone(activeOrder?.status || "requested");

  return (
    <div className="dashboard-container transporter-dashboard">
      {/* ================= HEADER ================= */}
      <header className="transporter-header">
        <div>
          <h1 className="dashboard-title">Transporter Dashboard</h1>
          <p className="dashboard-subtitle">One delivery at a time</p>
        </div>

        <button
          className="btn ghost"
          onClick={() => (window.location.href = "/")}
        >
          ← Home
        </button>
      </header>

      <div className="transporter-layout">
        {/* LEFT */}
        <div className="transporter-left">
          {activeJob && (
            <section className="transporter-main liquid-glass">
              <h2>Current Delivery</h2>

              {/* UBER STYLE PROGRESS */}
              <div className="uber-progress">
                <div className="progress-label start">
                  📍 {activeJob.pickupLocation}
                </div>

                <div className="track" />
                <div className="fill" />
                <div className="vehicle">🚚</div>

                <div className="progress-label end">
                  🏁 {activeJob.market}
                </div>
              </div>

              <p>
                <strong>Vegetable:</strong> {activeJob.vegetable}
              </p>
              <p>
                <strong>Pickup:</strong> {activeJob.pickupLocation}
              </p>
              <p>
                <strong>Market:</strong> {activeJob.market}
              </p>
              {activeJob.requestedQtyKg && (
                <p>
                  <strong>Qty:</strong> {activeJob.requestedQtyKg} kg
                </p>
              )}

              <div className="action-row">
                {activeJob.status === "accepted" && (
                  <button
                    className="btn blue"
                    disabled={working}
                    onClick={() => updateStatus("paused")}
                  >
                    Pause
                  </button>
                )}

                {activeJob.status === "paused" && (
                  <button
                    className="btn blue"
                    disabled={working}
                    onClick={() => updateStatus("accepted")}
                  >
                    Resume
                  </button>
                )}

                {activeJob.orderId && (
                  <button
                    className="btn"
                    disabled={working}
                    onClick={() => updateStatus("picked_up")}
                  >
                    Mark Picked Up
                  </button>
                )}

                <button className="btn green" disabled={working} onClick={completeJob}>
                  Finish Delivery
                </button>

                <button className="btn red" disabled={working} onClick={cancelJob}>
                  Cancel
                </button>

                <button
                  className="btn white"
                  onClick={() => setShowContact(true)}
                >
                  Contact
                </button>

                {activeJob.orderId && (
                  <button
                    className="btn"
                    onClick={() => navigate(`/dashboard/orders/${activeJob.orderId}`)}
                  >
                    Open Thread
                  </button>
                )}
              </div>
            </section>
          )}

          {!activeJob && (
            <section className="transporter-main liquid-glass">
              <h2>Available Transport Jobs</h2>

              {openJobs.length === 0 && (
                <p className="empty-hint">🚚 No jobs available right now</p>
              )}

              <div className="transporter-jobs">
                {openJobs.map((job) => (
                  <div key={job.id} className="transporter-job-card">
                    <p>
                      <strong>Vegetable:</strong> {job.vegetable}
                    </p>
                    <p>
                      <strong>Pickup:</strong> {job.pickupLocation}
                    </p>
                    <p>
                      <strong>Market:</strong> {job.market}
                    </p>
                    {job.requestedQtyKg && (
                      <p>
                        <strong>Qty:</strong> {job.requestedQtyKg} kg
                      </p>
                    )}

                    <button
                      className="btn"
                      disabled={working}
                      onClick={() => acceptJob(job)}
                    >
                      Accept Transport
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* COMPLETED */}
          <section className="transporter-main liquid-glass">
            <h2>Previous Deliveries</h2>

            {completedJobs.length === 0 && (
              <p className="empty-hint">No completed deliveries yet.</p>
            )}

            {completedJobs.map((job) => (
              <div key={job.id} className="completed-card">
                <p>
                  <strong>{job.vegetable}</strong> → {job.market}
                </p>
              </div>
            ))}
          </section>
        </div>

        {/* MAP */}
        <div className="transporter-map liquid-glass">
          <h3>Route Preview</h3>
          <div className="map-frame">
            <iframe title="map" src={mapUrl} />
          </div>
        </div>
      </div>

      {/* CONTACT MODAL */}
      {showContact && (
        <div
          className="modal-overlay"
          onClick={() => setShowContact(false)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Contact Details</h3>
            {activeJob?.orderId ? (
              <>
                <p>
                  <strong>Farmer:</strong>{" "}
                  {farmerProfile
                    ? `${farmerProfile.firstName || ""} ${farmerProfile.lastName || ""}`.trim() || "Unknown"
                    : "Unknown"}
                </p>
                <p>
                  <strong>Farmer Phone:</strong>{" "}
                  {showPhone
                    ? farmerProfile?.phone || activeJob.phone || "Not available"
                    : maskPhone(farmerProfile?.phone || activeJob.phone)}
                </p>
                <p>
                  <strong>Buyer:</strong>{" "}
                  {buyerProfile
                    ? `${buyerProfile.firstName || ""} ${buyerProfile.lastName || ""}`.trim() || "Unknown"
                    : "Unknown"}
                </p>
                <p>
                  <strong>Buyer Phone:</strong>{" "}
                  {showPhone
                    ? buyerProfile?.phone || "Not available"
                    : maskPhone(buyerProfile?.phone)}
                </p>
              </>
            ) : (
              <p>
                <strong>Phone:</strong>{" "}
                {activeJob?.phone || "Not available"}
              </p>
            )}
            <button className="btn" onClick={() => setShowContact(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
