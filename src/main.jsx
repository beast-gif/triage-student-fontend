import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import App from "./App.jsx";
import Splash from "./Splash.jsx";
import RespondPage from "./appointments/RespondPage.jsx";
import ReschedulePage from "./appointments/ReschedulePage.jsx";
import "./index.css";

/**
 * Routes, unchanged from before: the portal owns everything except the
 * two links that arrive by email.
 *
 * <Splash /> sits outside <Routes> on purpose. Inside, it would remount
 * and replay on every navigation; outside, it belongs to the session and
 * plays once. It renders nothing at all after it has finished.
 */
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Splash />
      <Routes>
        <Route path="/respond/:appointmentId" element={<RespondPage />} />
        <Route path="/reschedule/:appointmentId" element={<ReschedulePage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);