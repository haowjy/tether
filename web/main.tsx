import { render } from "preact";
import { App } from "./app/App";
import { AppController } from "./app/controller";
import { createBrowserPlatform } from "./platform/browser";
import { applyViewport, trackInputKind } from "./ui/theme";
import "./ui/tokens/index.css";

const root = document.getElementById("app");
if (!root) throw new Error("index.html lacks #app");
trackInputKind();
const app = await AppController.start(createBrowserPlatform(), { applyViewport });
render(<App app={app} />, root);
