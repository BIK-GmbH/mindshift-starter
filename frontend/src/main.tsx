import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import DialogHost from "./components/DialogHost";
import SplashScreen from "./components/SplashScreen";
import { AdminModalProvider } from "./lib/AdminModalContext";
import { DialogProvider } from "./lib/DialogContext";
import { SearchModalProvider } from "./lib/SearchModalContext";
import { SettingsModalProvider } from "./lib/SettingsModalContext";
import { ThemeProvider } from "./lib/ThemeContext";
import { ToastProvider } from "./lib/ToastContext";
import "./i18n";
import "./lib/pdfjsWorker";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <DialogProvider>
          <SettingsModalProvider>
            <AdminModalProvider>
              <BrowserRouter>
                <SearchModalProvider>
                  <App />
                  <DialogHost />
                  <SplashScreen />
                </SearchModalProvider>
              </BrowserRouter>
            </AdminModalProvider>
          </SettingsModalProvider>
        </DialogProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
