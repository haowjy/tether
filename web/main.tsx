import { AppController } from "./app/controller";
import { createBrowserPlatform } from "./platform/browser";

// The shell and design system follow; for now the app boots and holds its state.
await AppController.start(createBrowserPlatform());
