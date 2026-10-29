import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { bindEvents } from "./lib/events";
import { useStore } from "./store";
import "./styles.css";

bindEvents();
void useStore.getState().init();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
