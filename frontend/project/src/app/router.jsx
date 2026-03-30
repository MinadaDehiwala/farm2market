import { createBrowserRouter } from "react-router-dom";
import { lazy, Suspense } from "react";

/* ======================================================
   Layouts
====================================================== */
import PublicLayout from "../layouts/PublicLayout";
import DashboardLayout from "../layouts/DashboardLayout";

/* ======================================================
   Guards
====================================================== */
import AuthGuard from "../js/auth-guard.jsx";
import RoleGuard from "../js/role-guard.jsx";

/* ======================================================
   Public pages
====================================================== */
import Landing from "../pages/Landing/Landing";
import About from "../pages/About/About";
import Contact from "../pages/Contact/Contact";
import Profile from "../pages/Profile/Profile";
import TestingExplained from "../pages/TestingExplained/TestingExplained";

/* ======================================================
   Dashboard pages (lazy)
====================================================== */
const CommonDashboard = lazy(() =>
  import("../pages/Dashboards/CommonDashboard")
);
const FarmerDashboard = lazy(() =>
  import("../pages/Dashboards/Farmer/FarmerDashboard")
);
const TransporterDashboard = lazy(() =>
  import("../pages/Dashboards/Transporter/TransporterDashboard")
);
const PredictionDashboard = lazy(() =>
  import("../pages/Dashboards/PredictionDashboard")
);
const StockDashboard = lazy(() =>
  import("../pages/Dashboards/Stock/StockDashboard")
);
const OrdersDashboard = lazy(() =>
  import("../pages/Dashboards/Orders/OrdersDashboard")
);
const OrderDetailDashboard = lazy(() =>
  import("../pages/Dashboards/Orders/OrderDetailDashboard")
);
const AdminControlCenter = lazy(() =>
  import("../pages/Admin/AdminControlCenter")
);

/* ======================================================
   Shared fallbacks
====================================================== */
function PageLoader() {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      Loading...
    </div>
  );
}

function RouteError() {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>Page unavailable</h2>
      <p>Please refresh or try again later.</p>
    </div>
  );
}

/* ======================================================
   Router definition
====================================================== */
const router = createBrowserRouter([
  /* =========================
     Public routes
  ========================= */
  {
    path: "/",
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Landing /> },
      { path: "about", element: <About /> },
      { path: "contact", element: <Contact /> },
      { path: "test", element: <TestingExplained /> },
      {
        path: "profile",
        element: (
          <AuthGuard>
            <Profile />
          </AuthGuard>
        ),
      },
    ],
  },

  /* =========================
     Dashboard routes
  ========================= */
  {
    path: "/dashboard",
    element: <DashboardLayout />,
    errorElement: <RouteError />,
    children: [
      /* BUYER DASHBOARD ONLY */
      {
        index: true,
        element: (
          <AuthGuard>
            <RoleGuard allow={["buyer"]}>
              <Suspense fallback={<PageLoader />}>
                <CommonDashboard />
              </Suspense>
            </RoleGuard>
          </AuthGuard>
        ),
      },

      /* FARMER DASHBOARD */
      {
        path: "farmer",
        element: (
          <AuthGuard>
            <RoleGuard allow={["farmer"]}>
              <Suspense fallback={<PageLoader />}>
                <FarmerDashboard />
              </Suspense>
            </RoleGuard>
          </AuthGuard>
        ),
      },

      /* TRANSPORTER DASHBOARD */
      {
        path: "transporter",
        element: (
          <AuthGuard>
            <RoleGuard allow={["transporter"]}>
              <Suspense fallback={<PageLoader />}>
                <TransporterDashboard />
              </Suspense>
            </RoleGuard>
          </AuthGuard>
        ),
      },

      /* PREDICTIONS */
      {
        path: "predictions",
        element: (
          <AuthGuard>
            <RoleGuard allow={["buyer", "transporter", "farmer"]}>
              <Suspense fallback={<PageLoader />}>
                <PredictionDashboard />
              </Suspense>
            </RoleGuard>
          </AuthGuard>
        ),
      },

      /* FARMER-ONLY STOCK SUBMISSION */
      {
        path: "stock",
        element: (
          <AuthGuard>
            <RoleGuard allow={["farmer"]}>
              <Suspense fallback={<PageLoader />}>
                <StockDashboard />
              </Suspense>
            </RoleGuard>
          </AuthGuard>
        ),
      },

      /* SHARED ORDERS */
      {
        path: "orders",
        element: (
          <AuthGuard>
            <RoleGuard allow={["buyer", "transporter", "farmer"]}>
              <Suspense fallback={<PageLoader />}>
                <OrdersDashboard />
              </Suspense>
            </RoleGuard>
          </AuthGuard>
        ),
      },
      {
        path: "orders/:orderId",
        element: (
          <AuthGuard>
            <RoleGuard allow={["buyer", "transporter", "farmer"]}>
              <Suspense fallback={<PageLoader />}>
                <OrderDetailDashboard />
              </Suspense>
            </RoleGuard>
          </AuthGuard>
        ),
      },
    ],
  },

  {
    path: "/admin",
    element: (
      <Suspense fallback={<PageLoader />}>
        <AdminControlCenter />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },

  /* =========================
     Catch-all
  ========================= */
  {
    path: "*",
    element: <RouteError />,
  },
]);

export default router;
