import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import App from "./App.jsx";
import RespondPage from "./appointments/RespondPage.jsx";
import ReschedulePage from "./appointments/ReschedulePage.jsx";
import "./index.css";

/**
 * Two standalone routes sit outside the portal: they are opened from an
 * email, by someone who may not be the student and shouldn't land in a
 * chat interface. Everything else is the portal itself, which switches
 * between the assistant and the faculty desk in state rather than by URL.
 */
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/respond/:appointmentId" element={<RespondPage />} />
        <Route path="/reschedule/:appointmentId" element={<ReschedulePage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);