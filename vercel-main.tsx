import React from "react";
import { createRoot } from "react-dom/client";
import BimStreamer from "./app/BimStreamer";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BimStreamer />
  </React.StrictMode>,
);
