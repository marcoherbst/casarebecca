import React from "react";
import { createRoot } from "react-dom/client";
import AuthShell from "./app/AuthShell";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthShell />
  </React.StrictMode>,
);
