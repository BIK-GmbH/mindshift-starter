import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { SettingsModalProvider } from "./lib/SettingsModalContext";
import { ThemeProvider } from "./lib/ThemeContext";
import "./i18n";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SettingsModalProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SettingsModalProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
