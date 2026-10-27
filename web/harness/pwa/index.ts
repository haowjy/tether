// PWA states on Home. The service worker itself runs only in the built bundle;
// here the test platform stands in for it: a fixture opens with the `updates` and `install`
// capabilities, and a reviewer raises the banner with
// `window.__harness.platform.setUpdate("ready")`.
import type { Fixtures } from "../fixture";
import { LISTING, SAVED } from "../shared";

export const fixtures: Fixtures = {
  /** Admitted, two saved tabs, `updates` offered: raise "Update ready" with `setUpdate("ready")`. */
  updatable: { options: () => ({ workspace: SAVED, pwa: true }), daemon: (d) => { d.listing = LISTING; } },
  /** The offline launch (§9.4): the saved workspace opens from the cache, and the daemon can't be reached. */
  offlineLaunch: { options: () => ({ workspace: SAVED, pwa: true }), daemon: (d) => { d.info = "down"; } },
};
