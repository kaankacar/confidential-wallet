import { Buffer } from "buffer";
// @stellar/stellar-sdk expects a global Buffer in the browser.
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
