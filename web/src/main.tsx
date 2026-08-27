import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Band8 root element is missing");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
