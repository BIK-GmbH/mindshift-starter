import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import DialogHost from "./components/DialogHost";
import SplashScreen from "./components/SplashScreen";
import { DialogProvider } from "./lib/DialogContext";
import { SearchModalProvider } from "./lib/SearchModalContext";
import { SettingsModalProvider } from "./lib/SettingsModalContext";
import { ThemeProvider } from "./lib/ThemeContext";
import "./i18n";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <DialogProvider>
        <SettingsModalProvider>
          <BrowserRouter>
            <SearchModalProvider>
              <App />
              <DialogHost />
              <SplashScreen />
            </SearchModalProvider>
          </BrowserRouter>
        </SettingsModalProvider>
      </DialogProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
